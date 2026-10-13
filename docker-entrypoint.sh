#!/bin/sh
# Confi container entrypoint.
#
# Applies the SQLite schema + migrations and re-seeds the catalog on every
# start (both are idempotent, mirroring `npm start` = db:init -> db:seed).
# schema.sql/migrate.ts (and the seed source) live in the image's /app/db,
# while the DB file itself lives on the /data volume (DB_PATH), so an image
# upgrade always supplies the current schema/migrations to the existing data.
set -e

echo "[confi] db:init"
node db/init.js
echo "[confi] db:seed"
node db/seed.js

exec "$@"
