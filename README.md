[![build status][travis-image]][travis-url]

[travis-image]: https://travis-ci.org/jackytck/rabbit-node-oss-s3-docker.svg?branch=master
[travis-url]: https://travis-ci.org/jackytck/rabbit-node-oss-s3-docker

For uploading and removing files from S3 or OSS via rabbit.

### Sample cloud-worker.env
```bash
# cloud-worker.env
# rabbit
RABBIT_HOST=1.2.3.4
RABBIT_USER=XXXXXXXXXXXXX
RABBIT_PASSWORD=XXXXXXXXXXXXX
RABBIT_PORT=5672
RABBIT_QUEUE=cloud-file-ops
RABBIT_PING=heart-ping
RABBIT_PONG=heart-pong

# aws
AWS_ACCESS=XXXXXXXXXXXXX
AWS_SECRET=XXXXXXXXXXXXX
AWS_DEFAULT_REGION=ap-southeast-1

# oss (international)
OSS_ACCESS=XXXXXXXXXXXXX
OSS_SECRET=XXXXXXXXXXXXX

# app
CONCURRENCY=10

# heartbeat
HOST_NAME=Cloud-File-Worker-jacky
HOST_TYPE=cloud-file-worker
TZ=Asia/Hong_Kong
```

### Run
```bash
docker run --env-file cloud-worker.env -v /tmp:/tmp --name cloud-file-worker -d jackytck/rabbit-node-oss-s3-docker:v0.0.1
```

### Upload single file
```json
{
  "ops": "upload",
  "args": {
    "cloud": "oss",
    "bucket": "my-bucket",
    "region": "oss-cn-shenzhen",
    "src": "/tmp/nat/DJI_0001.JPG",
    "dst": "public/test.jpg"
  },
  "done": [
    {
      "queue": "cloud-file-ops",
      "msg": "any msg"
    }
  ],
  "error": [
    {
      "queue": "cloud-file-ops-error",
      "msg": "any msg"
    }
  ]
}
```

### Download single file
```json
{
  "ops": "download",
  "args": {
    "cloud": "s3",
    "bucket": "my-bucket",
    "region": "ap-southeast-1",
    "src": "5a8e58db7b2395618209913c/thumbnail_512.JPG",
    "dst": "/tmp/nat.jpg"
  }
}
```

### Remove single file
```json
{
  "ops": "remove",
  "args": {
    "cloud": "oss",
    "bucket": "my-bucket",
    "region": "oss-cn-shenzhen",
    "dst": "public/test.jpg"
  },
  "done": [
    {
      "queue": "cloud-file-ops",
      "msg": "any msg"
    }
  ],
  "error": [
    {
      "queue": "cloud-file-ops-error",
      "msg": "any msg"
    }
  ]
}
```

### Sync entire local directory to cloud
```json
{
  "ops": "sync-dir-up",
  "args": {
    "cloud": "oss",
    "bucket": "my-bucket",
    "region": "oss-cn-shenzhen",
    "src": "/tmp/data-1G",
    "dst": "test-big",
    "remove": true,
    "exclude": ["pages", "logos"]
  }
}
```

### Sync entire cloud path to local directory
```json
{
  "ops": "sync-dir-down",
  "args": {
    "cloud": "oss",
    "bucket": "my-bucket",
    "region": "oss-cn-shenzhen",
    "src": "test-big",
    "dst": "/tmp/data-1G",
    "remove": true,
    "verbose": true
  },
  "done": [
    {
      "queue": "sync-down",
      "msg": "test-big"
    }
  ]
}
```

### Copy local files of source directory to target directory
```json
{
  "ops": "copy",
  "args": {
    "cloud": "local",
    "src": "/mnt/data/user_drive/5d8976c09f428c798c5fc3b0",
    "dst": "/data/user_drive/5d8976c09f428c798c5fc3b0"
  }
}
```
