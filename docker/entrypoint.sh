#!/bin/sh
# Starts Folio in its container: checks the settings it cannot run without, brings the database up to date, then
# starts the web server.
set -e

if [ -z "$DATABASE_URL" ]; then
  echo "Folio: DATABASE_URL is not set. It points Folio at its PostgreSQL database, for example" >&2
  echo "       postgresql://folio:PASSWORD@192.168.1.10:5432/folio?schema=public" >&2
  exit 1
fi
if [ "${#FOLIO_SECRET}" -lt 16 ]; then
  echo "Folio: FOLIO_SECRET is missing or shorter than 16 characters. Make one with:" >&2
  echo "       openssl rand -base64 32" >&2
  echo "       Keep it safe and never change it: it encrypts account numbers and two-step secrets." >&2
  exit 1
fi

# Apply any database updates in this version. PostgreSQL can still be starting (after a reboot, say), so try for a
# couple of minutes before giving up.
tries=0
until node /opt/prisma-cli/node_modules/prisma/build/index.js migrate deploy --schema /app/prisma/schema.prisma; do
  tries=$((tries + 1))
  if [ "$tries" -ge 24 ]; then
    echo "Folio: could not reach the database to update it. Check DATABASE_URL and that PostgreSQL is running." >&2
    exit 1
  fi
  echo "Folio: waiting for the database (try $tries of 24)"
  sleep 5
done

echo "Folio: starting on port ${PORT:-3000}"
exec node /app/server.js
