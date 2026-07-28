#!/bin/sh
# Production start for Railway: apply migrations, then serve.
#
# Deliberately verbose. When a deploy fails on Railway all you get is the
# container log, so each stage announces itself and failures explain what to fix
# rather than leaving an opaque non-zero exit.
set -e

echo "==> Starting Ogilvy Fun Club"

if [ -z "$DATABASE_URL" ]; then
  echo "FATAL: DATABASE_URL is not set."
  echo "       Add a Postgres plugin to the Railway project, then set this"
  echo "       service variable:  DATABASE_URL=\${{Postgres.DATABASE_URL}}"
  exit 1
fi

echo "==> Applying database migrations"
if ! npx prisma migrate deploy; then
  echo "FATAL: prisma migrate deploy failed."
  echo "       Usually DATABASE_URL points at an unreachable database, or the"
  echo "       Postgres plugin is not linked to this service."
  exit 1
fi

# Bind explicitly to 0.0.0.0. Docker sets HOSTNAME to the container id, and
# `next start` will try to use it as the bind address, which can leave the
# server unreachable from Railway's health check.
PORT="${PORT:-3000}"
echo "==> Serving on 0.0.0.0:$PORT"
exec npx next start -H 0.0.0.0 -p "$PORT"
