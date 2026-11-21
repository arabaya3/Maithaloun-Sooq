#!/bin/sh
# Builds and starts MAYTHA on the server from a source tarball: deploy.sh <source.tar.gz>
set -eu
cd /opt/maytha
rm -rf src && mkdir src && tar -xzf "$1" -C src
VAPID=$(grep -E '^NEXT_PUBLIC_VAPID_PUBLIC_KEY=' app.env | cut -d= -f2- || true)
docker build --target migrator -t maytha-migrator:latest src
docker build --target runner --build-arg NEXT_PUBLIC_VAPID_PUBLIC_KEY="$VAPID" -t maytha-app:latest src
docker compose --profile deploy run --rm migrate
docker compose up -d app
docker image prune -f >/dev/null
