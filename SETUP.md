# SETUP & RUN (explicit)

Prereqs:
- Node 18+ (Node 20 recommended)
- Docker & Docker Compose
- psql CLI (optional; you can use Postgres container)
- jq (optional for demo script)

**Important:** By default the code may run in demo mode (DEMO_MODE=true). To run against real Postgres/Qdrant/Redis/LLMs, set `DEMO_MODE=false` in your `.env` before starting the API & worker.

1. Install node deps:
   npm install

2. Copy .env:
   cp .env.example .env
   Edit .env (set GEMINI_API_KEY if using real LLMs). For tests use DEMO_MODE=true.

3. Build & start infra + services (Docker Compose):
   docker compose up --build -d

4. Migrate DB (UP):
   npm run migrate:up
   OR:
   docker compose exec -T postgres psql -U postgres -d talentsieve < ./migrations/up.sql

5. To revert migrations (DOWN):
   npm run migrate:down

6. Decode sample PDFs (to prepare pdf sample especially for demo or not):
   bash scripts/decode_sample_pdfs.sh

7. Start API & Worker (if not running in Docker):
   npm start
   npm run worker

8. Run sample job (requires jq):
   bash scripts/run_sample_job.sh (can be ran through normal or demo mode)

9. Run tests:
   npm test
   DEMO_MODE=true npm test //for demo mode

Notes:
- Canonical request keys for `/evaluate` are `job_title`, `cv_id`, and `project_id`. The server accepts common aliases but the canonical shape is recommended.
- If you change Qdrant vector size, update QDRANT_VECTOR_SIZE in .env and re-create collection.
