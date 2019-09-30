const AliOSS = require('ali-oss-extra').default
const AwsCli = require('aws-cli-js-jt')
const amqp = require('amqplib')
const chalk = require('chalk')
const config = require('./config')
const fs = require('fs')
const fse = require('fs-extra')
const lodash = require('lodash')
const moment = require('moment')
const retry = require('async-retry')

let rabbitChannel

/**
 * Setup rabbit.
 */
async function connectRabbit () {
  try {
    const {
      user,
      password,
      host,
      port,
      queue,
      ping,
      pong
    } = config.rabbit

    const uri = `amqp://${user}:${password}@${host}:${port}`
    const connection = await amqp.connect(uri)

    rabbitChannel = await connection.createChannel()
    await rabbitChannel.assertQueue(queue, { durable: true })
    rabbitChannel.prefetch(+config.concurrency)
    rabbitChannel.consume(queue, work)

    // for heartbeat ping pong
    await rabbitChannel.assertExchange(ping, 'fanout', { durable: true })
    const tmpQueue = await rabbitChannel.assertQueue('', { exclusive: true })
    await rabbitChannel.bindQueue(tmpQueue.queue, ping, '')
    rabbitChannel.consume(tmpQueue.queue, handlePing, { noAck: true })
    await rabbitChannel.assertQueue(pong, { durable: true })

    console.log(chalk.inverse(`Connected ${host}:${port}`))
  } catch (err) {
    console.error(err)
  }
}

/**
 * Handle ping message from heartbeater.
 */
async function handlePing (message) {
  const msg = message.content.toString()
  try {
    const mach = JSON.parse(msg)
    mach.name = config.host.name
    mach.nickname = config.host.name
    mach.type = config.host.type
    mach.pong = moment().format('YYYY-MM-DD hh:mm:ss.SSSS A')
    const pong = lodash.pick(mach, [
      'name',
      'nickname',
      'type',
      'ping',
      'pong',
      'extra'
    ])
    await rabbitChannel.sendToQueue(config.rabbit.pong, new Buffer(JSON.stringify(pong)))
  } catch (err) {
    console.error(err)
  }
}

/**
 * Setup AWS client.
 */
const awsCli = new AwsCli({
  aws_access_key_id: config.s3.access,
  aws_secret_access_key: config.s3.secret
})

/**
 * Init OSS client.
 */
const initOSSClient = ({ bucket, region, timeout = '120s' }) => {
  return new AliOSS({
    bucket,
    region,
    timeout,
    accessKeyId: config.oss.access,
    accessKeySecret: config.oss.secret,
  })
}

/**
 * Main work.
 * {
 *   ops: 'upload',
 *   args: {
 *     cloud: 's3',
 *     bucket: 'some-bucket',
 *     region: 'ap-southeast-1',
 *     src: '/tmp/test.jpg',
 *     dst: 'prefix/thumbnail.jpg'
 *   },
 *   done: [{
 *     queue: "any-next-queue",
 *     msg: "any msg"
 *   }],
 *   error: [{
 *     queue: "any-error-queue",
 *     msg: "any msg"
 *   }]
 * }
 */
async function work (message) {
  let msg = {}
  try {
    // a. Parse and log message
    console.log(chalk.cyan('Received a message:'))
    msg = JSON.parse(message.content.toString())
    console.log(msg)

    if (!checkMessage(msg)) {
      // b. Expected error
      await sendCallback(msg, 'error')
      console.log('Failed')
    } else {
      // c. Cloud ops
      switch (msg.ops) {
        case 'upload':
          await upload(msg.args)
          break
        case 'download':
          await download(msg.args)
          break
        case 'remove':
          await remove(msg.args)
          break
        case 'sync-dir-up':
          await syncDirUp(msg.args)
          break
        case 'sync-dir-down':
          await syncDirDown(msg.args)
          break
        case 'copy':
          await copy(msg.args)
          break
      }
      await sendCallback(msg)
      console.log('Done')
    }
  } catch (err) {
    // d. Unexpected error
    console.error(err)
    await sendCallback(msg, 'error')
    if (msg.ops === 'sync-dir-down' && msg.args.cleanOnError) {
      await fse.remove(msg.args.dst)
    }
    console.log('Failed')
  }
  rabbitChannel.ack(message)
}

/**
 * Check essential data fields.
 */
function checkMessage (msg) {
  if (msg.ops && msg.args) {
    // s3 + oss
    if (['s3', 'oss'].includes(msg.args.cloud) && msg.args.bucket && msg.args.region) {
      return true
    }
    // local disk
    if (msg.args.cloud === 'local') {
      if (msg.ops === 'copy' && msg.args.src && msg.args.dst) {
        return true
      }
      if (msg.ops === 'remove' && msg.args.dst) {
        return true
      }
    }
  }
  return false
}

function upload (args) {
  if (!fs.existsSync(args.src)) {
    throw new Error(`File not found: ${args.src}`)
  }
  switch (args.cloud) {
    case 's3':
      return uploadS3(args)
    case 'oss':
      return uploadOSS(args)
  }
}

function uploadS3 ({ bucket, region, src, dst }) {
  const cp = `s3 cp ${src} s3://${bucket}/${dst} --region ${region}`
  return awsCli.command(cp)
}

function uploadOSS ({ bucket, region, src, dst }) {
  const client = initOSSClient({ bucket, region })
  const headers = {
    'Cache-Control': 'max-age=0'
  }
  return client.put(dst, src, { headers, timeout: '120s' })
}

function download (args) {
  switch (args.cloud) {
    case 's3':
      return downloadS3(args)
    case 'oss':
      return downloadOSS(args)
  }
}

function downloadS3 ({ bucket, region, src, dst }) {
  const cp = `s3 cp s3://${bucket}/${src} ${dst} --region ${region}`
  return awsCli.command(cp)
}

function downloadOSS ({ bucket, region, src, dst }) {
  const client = initOSSClient({ bucket, region })
  return client.get(src, dst)
}

function remove (args) {
  switch (args.cloud) {
    case 's3':
      return removeS3(args)
    case 'oss':
      return removeOSS(args)
    case 'local':
      return removeLocal(args)
  }
}

function removeS3 ({ bucket, region, dst }) {
  const rm = `s3 rm s3://${bucket}/${dst} --region ${region}`
  return awsCli.command(rm)
}

function removeOSS ({ bucket, region, src, dst }) {
  const client = new AliOSS({
    bucket,
    region,
    accessKeyId: config.oss.access,
    accessKeySecret: config.oss.secret,
    timeout: '120s'
  })
  return client.delete(dst, { timeout: '120s' })
}

function removeLocal ({ dst }) {
  return fse.remove(dst)
}

function syncDirUp (args) {
  switch (args.cloud) {
    case 's3':
      return syncDirUpS3(args)
    case 'oss':
      return syncDirUpOSS(args)
  }
}

function syncDirUpS3 ({ bucket, region, src, dst, remove, exclude }) {
  let sync = `s3 sync ${src} s3://${bucket}/${dst} --no-follow-symlinks`
  if (remove) {
    sync += ' --delete'
  }
  if (exclude && exclude.length) {
    const ignore = exclude.map(x => `--exclude "${x}/*"`).join(' ')
    sync += ` ${ignore}`
  }
  console.log(sync)
  return awsCli.command(sync)
}

function syncDirUpOSS ({ bucket, region, src, dst, remove, exclude }) {
  const client = initOSSClient({ bucket, region })
  const opts = {
    remove,
    ignoreList: exclude,
    verbose: true
  }
  return client.syncDir(src, dst, opts)
}

function syncDirDown (args) {
  switch (args.cloud) {
    case 's3':
      return syncDirDownS3(args)
    case 'oss':
      return syncDirDownOSS(args)
  }
}

function syncDirDownS3 ({ bucket, region, src, dst, remove, verbose }) {
  let sync = `s3 sync s3://${bucket}/${src} ${dst}`
  if (remove) {
    sync += ' --delete'
  }
  if (!verbose) {
    sync += ' --only-show-errors'
  }
  console.log(sync)
  return awsCli.command(sync)
}

function syncDirDownOSS ({ bucket, region, src, dst, remove, retryCnt = 0, verbose }) {
  const client = initOSSClient({ bucket, region })
  const opts = {
    remove,
    verbose
  }

  const onRetry = err => {
    console.error(err)
    console.log(`Retrying ${src}...`)
  }

  // oss would throw Unknown Error if number of files are large, so retry
  return retry(async () => {
    await client.syncDirDown(src, dst, opts)
  }, {
    retries: retryCnt,
    factor: 1,
    onRetry
  })
}

function copy (args) {
  switch (args.cloud) {
    case 'local':
      return copyLocal(args)
  }
}

function copyLocal (args) {
  return fse.copy(args.src, args.dst)
}

/**
 * Send callback message to custom 'done' or 'error' queues.
 * type: done or error
 */
function sendCallback (message, type='done') {
  if (!message[type] || message[type].length === 0) {
    return
  }

  const jobs = message[type].map(msg => {
    return rabbitChannel.assertQueue(msg.queue, { durable: true })
      .then(() => rabbitChannel.sendToQueue(msg.queue, new Buffer(JSON.stringify(msg.msg))))
  })

  return Promise.all(jobs)
}

connectRabbit()
