# Blockers

Items that could not be resolved autonomously. Each entry has the exact fix and the workaround in use.

## B1. No PostgreSQL credentials on this machine

- **Found:** 2026-11-20, at the start of M1.
- **Symptom:** `psql -h localhost -U postgres -w` → `fe_sendauth: no password supplied`. There is no `.env`, no `pgpass.conf` and no `PG*` environment variable. Guessing a password is not acceptable.
- **One-line fix** (run once in the project root, replacing `YOUR_PASSWORD` with the local `postgres` password):

  ```powershell
  Copy-Item .env.example .env; (Get-Content .env) -replace 'postgres:CHANGE_ME@', 'postgres:YOUR_PASSWORD@' | Set-Content -Encoding utf8 .env
  ```

  `pnpm db:migrate` then creates the `relief_dev` database if it is missing, enables `pg_trgm` and applies all migrations. `pnpm test` creates and drops `relief_test_<random>` on the same server.
- **Workaround in use:** when `DATABASE_URL` / `TEST_DATABASE_URL` cannot connect, the test suite falls back to **PGlite** (`@electric-sql/pglite`, PostgreSQL compiled to WebAssembly, with the `pg_trgm` extension). It runs the same Drizzle migrations and the same SQL. This fallback is for **tests and measurements only**; `pnpm dev` and `pnpm seed` require the real server. Every measurement in `docs/EVALUATION.md` states which engine produced it.
