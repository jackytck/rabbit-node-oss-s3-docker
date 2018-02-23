const AliOSS = require('ali-oss-extra').default
const AwsCli = require('aws-cli-js-jt')
const amqp = require('amqplib')
const chalk = require('chalk')
const config = require('./config')
const fs = require('fs')

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
      queue
    } = config.rabbit

    const uri = `amqp://${user}:${password}@${host}:${port}`
    const connection = await amqp.connect(uri)

    rabbitChannel = await connection.createChannel()
    await rabbitChannel.assertQueue(queue, { durable: true })
    rabbitChannel.prefetch(+config.concurrency)
    rabbitChannel.consume(queue, work)

    console.log(chalk.inverse(`Connected ${host}:${port}`))
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
        case 'remove':
          await remove(msg.args)
          break
      }
      await sendCallback(msg)
      console.log('Done')
    }
  } catch (err) {
    // d. Unexpected error
    console.error(err)
    await sendCallback(msg, 'error')
    console.log('Failed')
  }
  rabbitChannel.ack(message)
}

/**
 * Check essential data fields.
 */
function checkMessage (msg) {
  if (msg.ops && msg.args && ['s3', 'oss'].includes(msg.args.cloud) && msg.args.bucket && msg.args.region) {
    return true
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
  const client = new AliOSS({
    bucket,
    region,
    accessKeyId: config.oss.access,
    accessKeySecret: config.oss.secret,
    timeout: '120s'
  })
  const headers = {
    'Cache-Control': 'max-age=0'
  }
  return client.put(dst, src, { headers, timeout: '120s' })
}

function remove (args) {
  switch (args.cloud) {
    case 's3':
      return removeS3(args)
    case 'oss':
      return removeOSS(args)
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
