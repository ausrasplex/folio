#!/bin/sh
# Test helper for the throwaway container database only (never a real install): recreate, migrate, seed.
psql -h localhost -U postgres -q -c "DROP DATABASE IF EXISTS folio WITH (FORCE);" -c "CREATE DATABASE folio OWNER folio;" && npx prisma migrate deploy >/dev/null && npx tsx --env-file=.env prisma/seed.ts
