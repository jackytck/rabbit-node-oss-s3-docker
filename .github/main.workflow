workflow "Build workflow" {
  on = "push"
  resolves = ["push"]
}

action "build" {
  uses = "actions/docker/cli@master"
  args = "build -t rabbit-node-oss-s3-docker ."
}

action "login" {
  uses = "actions/docker/login@master"
  needs = ["build"]
  secrets = ["DOCKER_USERNAME", "DOCKER_PASSWORD"]
}

action "tag" {
  uses = "actions/docker/cli@master"
  needs = ["login"]
  args = "tag rabbit-node-oss-s3-docker jackytck/rabbit-node-oss-s3-docker:v0.0.3"
}

action "push" {
  uses = "actions/docker/cli@master"
  needs = ["tag"]
  args = "push jackytck/rabbit-node-oss-s3-docker:v0.0.3"
}
