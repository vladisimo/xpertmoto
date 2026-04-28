-- Executed once on first container start (from docker-entrypoint-initdb.d/).
-- On subsequent starts, Postgres skips init scripts when the data volume
-- already exists, so this is safe to keep idempotent.

-- pg_stat_statements exposes per-query latency/IO stats — loaded via
-- shared_preload_libraries in docker-compose postgres service command.
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- pg_trgm: installed here so a fresh dev DB is trigram-ready before any
-- migrations run. Migration 20260418010732 is also idempotent.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- btree_gist: required by the Booking overlap exclusion constraint.
-- Matches what prisma/migrations sets up, but ensures it's present from
-- the start of the DB's life so early migrations succeed cleanly.
CREATE EXTENSION IF NOT EXISTS btree_gist;
