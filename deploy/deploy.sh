#!/bin/sh
# Builds and starts MAYTHA on the server from a source tarball: deploy.sh <source.tar.gz>
set -eu
cd /opt/maytha
rm -rf src && mkdir src && tar -xzf "$1" -C src
# The build reaches the database through its localhost-only port; the app itself uses the "db" host.
sed 's#@db:5432/#@127.0.0.1:5433/#' app.env > build.env && chmod 600 build.env
trap 'rm -f build.env' EXIT
docker build --target migrator -t maytha-migrator:latest src
docker compose --profile deploy run --rm migrate
docker build --network host --secret id=appenv,src=build.env --target runner -t maytha-app:latest src
docker compose up -d app
docker image prune -f >/dev/null
