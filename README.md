# TalentSieve-RAG-Talent-Screener

## Automated, AI-Driven Candidate Evaluation Pipeline for Modern Hiring

This project implements a backend service to automate the initial screening of a job application. It receives a candidate's CV and project report, evaluates them against a specific job description and case study brief, and produces a structured, AI-generated evaluation report.

Combination of **backend engineering** with **AI workflows**, including prompt design, LLM chaining, retrieval (RAG), and resilience.

This repository demonstrates a complete backend pipeline including PDF parsing, vectorization,
RAG (retrieval-augmented generation) using Qdrant, LLM calls using Gemini (or other providers),
and a resilient worker queue with BullMQ + Redis.

-----


## Important notes (behavioral / canonical keys)
- **DEMO_MODE default:** The codebase often runs in demo mode by default (`DEMO_MODE=true`) when the environment variable is not explicitly set. To run against real Postgres/Qdrant/Redis/LLMs, set `DEMO_MODE=false` in your `.env` before starting the API & worker.
- **Canonical request keys:** The canonical keys for requests are `cv_id` and `project_id`. The server also accepts several common aliases (e.g., `cv_doc_id`, `cvDocId`, `projectId`, `report_doc_id`) for convenience, but responses and stored results follow the canonical shape described below.
- **Result schema:** The final evaluation result stored at `jobs.result` and returned by `GET /result/{id}` contains exactly the following user-facing fields:
  * `cv_match_rate` — number between 0.00 and 1.00
  * `cv_feedback` — short string feedback about the CV
  * `project_score` — number on 1-5 scale (float)
  * `project_feedback` — short string feedback about the project
  * `overall_summary` — concise human-readable recommendation/summary
  
-----

## 🌟 Key Features

* **RESTful API Endpoints**:
      * `POST /upload`: Handles multipart file uploads (CV and Project Report) and returns unique document IDs.
      * `POST /evaluate`: Triggers the non-blocking, asynchronous AI evaluation pipeline and immediately returns a job ID. **Canonical request body fields:** `job_title`, `cv_id`, `project_id`.
      * `GET /result/{id}`: Retrieves the current status and the final structured result of an evaluation job.
  * **AI Evaluation Pipeline (LLM Chaining)**: A multi-stage process for evaluation, concluding with a final synthesis call:
    1.  **CV Evaluation**: Calculates `cv_match_rate` and provides `cv_feedback` based on the Job Description and CV Scoring Rubric.
    2.  **Project Report Evaluation**: Generates `project_score` and `project_feedback` based on the Case Study Brief and Project Scoring Rubric.
  * **Retrieval-Augmented Generation (RAG)**: All System-Internal Documents (Job Description, Case Study Brief, Scoring Rubrics) are ingested into a **Qdrant** Vector Database to ensure accurate, context-aware evaluations.
  * **Long-Running Process Handling**: Implements a dedicated job queuing mechanism using **Redis** and **BullMQ** to manage the multi-step, time-consuming LLM calls, ensuring the `/evaluate` endpoint is non-blocking.
  * **Resilience and Control**: Includes mechanisms to handle API failures (timeouts, rate limits) with retries/back-off, and controls LLM temperature for stable responses.

-----

## ⚙️ Technology Stack and Design Rationale (might change, not final)

| Component | Choice | Rationale |
| :--- | :--- | :--- |
| **Backend Framework** | **Node.js (Express/NestJS)** | Chosen for its high-performance, non-blocking I/O model, which is ideal for managing API requests while offloading long-running, external LLM calls to a separate worker process. |
| **LLM Provider** | **Gemini API** / **OpenRouter** | Gemini is selected for its multimodal capabilities and strong performance in reasoning tasks. OpenRouter provides a robust fallback/aggregation layer for API resilience and rate-limit management. |
| **Vector Database** | **Qdrant** | A production-grade vector similarity search engine chosen for its performance, comprehensive API, and horizontal scalability, essential for a reliable RAG implementation. |
| **Asynchronous Handler** | **Redis** / **BullMQ** | BullMQ is a feature-rich, promise-based queue system for Node.js. It leverages Redis to reliably manage and persist background evaluation tasks, implement automatic retries, and ensure the API adheres to the non-blocking requirement. |
| **Primary Database** | **PostgreSQL** | Used for managing persistent application data, including storing file metadata (IDs), job status, and final evaluation results. |

-----

## 💻 API Usage Examples (might change, not final)

### 1\. Upload Candidate Files

**`POST /upload`**

  * **Body:** `multipart/form-data`
      * `file_cv`: `[Your CV file.pdf]`
      * `file_report`: `[Your Project Report.pdf]`
  * **Example Response (Success):**

<!-- end list -->

```json
{
  "cv_id": "cv-d41d8cd98f00b204e9800998ecf8427e",
  "project_id": "project-b204e9800998ecf8427ed41d8cd98f00"
}
```

### 2\. Trigger Evaluation

**`POST /evaluate`**

  * **Body:** `application/json`
  * **Example Body:**

<!-- end list -->

**Request (JSON):**
```json
{
  "job_title": "Product Engineer (Backend)",
  "cv_id": "cv-d41d8cd98f00b204e9800998ecf8427e",
  "project_id": "project-b204e9800998ecf8427ed41d8cd98f00"
}
```

  * **Example Response (Immediate):**

<!-- end list -->

**Immediate Response (queued):**
```json
{
  "id": "456",
  "status": "queued"
}
```

### 3\. Check Status and Retrieve Result

**`GET /result/{id}`**

  * **Path:** `/result/456`
  * **Response (While Processing):**

<!-- end list -->

```json
{
  "id": "456",
  "status": "processing"
}
```

  * **Response (Completed):**

<!-- end list -->

**Completed Result (`GET /result/456`):**
```json
{
  "id": "456",
  "status": "completed",
  "result": {
    "cv_match_rate": 0.82,
    "cv_feedback": "Strong in backend and cloud, limited AI integration experience...",
    "project_score": 4.5,
    "project_feedback": "Meets prompt chaining requirements, lacks error handling robustness...",
    "overall_summary": "Good candidate fit, would benefit from deeper RAG knowledge..."
  }
}
```

## Contents (important files)

- `src/` — application source
  - `server.js` — Express API (upload, evaluate, result)
  - `worker.js` — BullMQ worker process
  - `pipeline.js` — main pipeline: parsing, embedding, upsert, retrieval, LLM scoring
  - `lib/aiClient.js` — Gemini embedding & generation wrapper (DEMO mode available)
  - `db.js` — Postgres connection pool
  - `storage.js` — file helpers
  - `validators/` — AJV schemas & validation helpers
  - `fallback/` — heuristic scorers for safe fallback

- `prompts/` — prompt templates and demo fixture

- `migrations/` — SQL migrations up/down

- `scripts/` — helper scripts: decode sample PDFs, run sample job, test embed

- `docker-compose.yml` + `Dockerfile` — development infra & build

- `tests/` — Jest tests and sample PDFs for CI/demo

---

## Quickstart (detailed)

### Prerequisites
- Node.js >= 18 (Node 20 LTS recommended)
- Docker & Docker Compose (to run Redis, Postgres, Qdrant)
- `psql` CLI (optional; migrations can be run inside Postgres container)
- `jq` (optional, for demo script)

### 1. Install dependencies
```bash
npm install
```

### 2. Create `.env`
```bash
cp .env.example .env
# Edit .env: if you want demo mode runs keep DEMO_MODE=true.
# For real runs set DEMO_MODE=false and set GEMINI_API_KEY.
```

### 3. Start infra & services (Docker Compose)
```bash
docker compose up --build -d
```

### 4. Run DB migrations (UP)

Run migrations inside Postgres container (recommended):
```bash
docker compose exec postgres psql -U postgres -d talentsieve -f /app/migrations/up.sql
```

### 5. Decode sample PDFs (demo)
```bash
bash scripts/decode_sample_pdfs.sh
```

### 6. Start API & worker (if not using Docker to run them)
```bash
npm start       # starts API (http://localhost:3000)
# in a second terminal:
npm run worker  # starts BullMQ worker
```

### 7. Run sample job (demo)
```bash
bash scripts/run_sample_job.sh
```

scripts/run_sample_job.sh uses jq if available. If you don't have jq, the script will fall back to a small Node-based parser. For reliable output in terminal, install jq (sudo apt-get install -y jq or brew install jq).

### 8. Test Gemini embedding (real API)
To verify embedding size (useful to set `QDRANT_VECTOR_SIZE`):
```bash
export GEMINI_API_KEY="your_key_here"
node scripts/test_embed.js
```

### 9. Run tests (CI)
```bash
npm test

DEMO_MODE=true npm test #with demo mode
```

### 10. Revert migrations (DOWN)
```bash
docker compose exec postgres psql -U postgres -d postgres -f /app/migrations/down.sql
```

---

## Troubleshooting: psql errors & port in use

If `psql` complains about password or `-f`, run migrations inside the postgres container as shown above. If port 3000 is already in use, either stop the process using it or set `PORT` in `.env` and restart the app.

---

## Others
You may adapt it to your environment. Ensure you remove any API keys before sharing publicly.

## ⚠️ Disclaimer
The design, API, and anything here is still in development thus it all might change, and is not final.