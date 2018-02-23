const {
  AWS_ACCESS,
  AWS_SECRET,
  RABBIT_HOST,
  RABBIT_PORT,
  RABBIT_USER,
  RABBIT_PASSWORD,
  RABBIT_QUEUE,
  OSS_ACCESS,
  OSS_SECRET
} = process.env

const config = {
  rabbit: {
    host: RABBIT_HOST,
    port: RABBIT_PORT,
    user: RABBIT_USER,
    password: RABBIT_PASSWORD,
    queue: RABBIT_QUEUE
  },
  s3: {
    access: AWS_ACCESS,
    secret: AWS_SECRET
  },
  oss: {
    access: OSS_ACCESS,
    secret: OSS_SECRET
  }
}
module.exports = config
