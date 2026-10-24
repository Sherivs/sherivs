#!/usr/bin/env bash
# Sherivs Simulation Lab — isolated LOCAL Postgres 17 + PostgREST. Never prod, never `supabase link`.
# Usage: tools/sim-lab/up.sh   (run from repo root or anywhere)
set -euo pipefail
cd "$(dirname "$0")"; mkdir -p bin load
PORT=54329
if [ ! -x bin/pg/bin/postgres ]; then
  curl -sfL -o bin/pg.jar https://repo1.maven.org/maven2/io/zonky/test/postgres/embedded-postgres-binaries-linux-amd64/17.2.0/embedded-postgres-binaries-linux-amd64-17.2.0.jar
  (cd bin && unzip -oq pg.jar && mkdir -p pg && tar xJf postgres-linux-x86_64.txz -C pg)
fi
[ -x bin/postgrest ] || curl -sfL https://github.com/PostgREST/postgrest/releases/download/v12.2.3/postgrest-v12.2.3-linux-static-x64.tar.xz | tar xJ -C bin
[ -x bin/k6 ] || (curl -sfL https://github.com/grafana/k6/releases/download/v0.54.0/k6-v0.54.0-linux-amd64.tar.gz | tar xz -C bin && mv bin/k6-v0.54.0-linux-amd64/k6 bin/)
[ -d node_modules/pg ] || npm i --no-save --silent pg@8
B=bin/pg/bin
$B/pg_ctl -D data stop -m fast >/dev/null 2>&1 || true
rm -rf data && $B/initdb -D data -U postgres -A trust -E UTF8 >/dev/null
$B/pg_ctl -D data -o "-p $PORT -k /tmp -c listen_addresses=127.0.0.1 -c max_connections=500 -c shared_buffers=1GB" -l pg.log start >/dev/null
sleep 2
node -e "const pg=require('pg');(async()=>{const c=new pg.Client({host:'127.0.0.1',port:$PORT,user:'postgres'});await c.connect();await c.query(require('fs').readFileSync('bootstrap.sql','utf8'));await c.end()})()"
node migrate.mjs
[ -f load/.jwt-secret ] || (umask 077; node -e "require('fs').writeFileSync('load/.jwt-secret', require('crypto').randomBytes(48).toString('base64url'))")
echo "sim DB up on 127.0.0.1:$PORT. Next: node sim/gen.mjs && node sim/scenarios.mjs"
