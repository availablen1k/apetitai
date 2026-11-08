# AGENTS.md

## Project

Apetit TraceFlow: a localhost-only React/Vite app with a Node.js (Fastify, TypeScript) API and SQLite.
There is no authentication and no Base44 or other hosted backend. Read `README_LOCAL.md` first.

## Layout

- `src/` — frontend (React 18, shadcn/Radix, Recharts, FI/EN via `src/lib/i18n.jsx`). All data access goes through `src/api/client.js`.
- `server/` — API. `server/app.ts` (routes), `server/domain/` (pure logic: CSV parsing, dataset catalog, rules, inventory engine, method constants), `server/services/` (imports, quality, calculations, lineage, routing, workbook, Gemini), `server/db/` (SQLite + migrations).
- `nature_model/` — the Python/SQLite nature model (Track D). Its own README, HANDOVER and tests apply inside that folder. TraceFlow reads `nature_model/analysis/nature/nature.sqlite` read-only (`server/services/nature.ts`) and runs its tools as queued Python jobs (`server/services/natureJobs.ts`); Gemini calls its 22 catalogued queries as read-only tools (`server/services/natureAgent.ts`).
- `scripts/` — dev runner, setup, challenge import, benchmark, fixtures, sample workbook.
- `tests/` — `unit/`, `api/` (Fastify inject, in-memory SQLite), `e2e/` (real `npm run dev` + headless Chrome). DEMO fixtures in `tests/fixtures/demo/`.

## Rules for changes

- Source rows, corrections, calculation runs and audit events are append-only (database triggers). Corrections are overlays; never edit source rows.
- Nothing is approved automatically: not by rules, not by Gemini. Approval needs a reviewer label and an explicit decision.
- Every number must trace to source records and a factor; do not hard-code business figures in the UI.
- API keys are read only by the backend from environment variables; never expose them to the frontend.
- Never write to the nature database from TypeScript. Builds, saved query runs and nutrient runs go through the Python tools as jobs; keep `validateParameters` in step with `nature_model/tools/nature_queries.py` (a test compares them).
- Never give the model SQL text or a SQL tool; nature tools take a catalogued query id and validated parameters only.
- Run `npm run lint`, `npm run typecheck`, `npm test` and, for UI or startup changes, `npm run test:e2e` before finishing. For changes under `nature_model/`, also run `npm run nature:test`.
