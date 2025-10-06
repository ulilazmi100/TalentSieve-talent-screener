# TalentSieve-RAG-Talent-Screener

## Automated, AI-Driven Candidate Evaluation Pipeline for Modern Hiring

This project implements a backend service to automate the initial screening of a job application. It receives a candidate's CV and project report, evaluates them against a specific job description and case study brief, and produces a structured, AI-generated evaluation report.

Combination of **backend engineering** with **AI workflows**, including prompt design, LLM chaining, retrieval (RAG), and resilience.

-----

## 🌟 Key Features

  * **RESTful API Endpoints**:
      * `POST /upload`: Handles multipart file uploads (CV and Project Report) and returns unique document IDs.
      * `POST /evaluate`: Triggers the non-blocking, asynchronous AI evaluation pipeline and immediately returns a job ID.
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

## 🚀 Setup and Running

The required system documents are provided in the repository for full reproducibility.

### Prerequisites

  * Node.js (LTS)
  * Docker (for running Redis and Qdrant locally)
  * A **Gemini API Key** and/or **OpenRouter API Key**

### 1\. Repository Clone & Install

```bash
git clone <repository-link>
cd TalentSieve-RAG-Talent-Screener
npm install
```

### 2\. Environment Setup

Configure your environment variables in a `.env` file based on the provided `.env.example`:

```bash
# Example .env configuration
LLM_API_KEY="<YOUR_GEMINI_API_KEY>"
QDRANT_URL="http://localhost:6333"
REDIS_HOST="localhost"
REDIS_PORT=6379
DATABASE_URL="postgresql://user:password@localhost:5432/talentsieve_db"
```

### 3\. Start Infrastructure (Docker)

Use Docker Compose to launch the required services (Redis, Qdrant, PostgreSQL):

```bash
docker-compose up -d
```

### 4\. Database Migration

Apply database schema migrations to set up the tables for file metadata and evaluation jobs:

```bash
# Example command using Prisma/TypeORM/etc.
npx prisma migrate dev
```

### 5\. Document Ingestion (RAG Setup)

Run the ingestion script to process and embed the system-internal documents (`Job Description`, `Case Study Brief`, `Scoring Rubrics`) into the **Qdrant** Vector Database:

```bash
node scripts/ingest_documents.js
```

### 6\. Start the Job Worker

Start the **BullMQ** worker process to handle the long-running LLM chaining tasks:

```bash
node worker/bullmq_worker.js
```

### 7\. Start the Backend Service

```bash
node server.js
# Or using a process manager for production: npm run start
```

The API will be available at `http://localhost:8000`.

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
  "cv_doc_id": "cv-d41d8cd98f00b204e9800998ecf8427e",
  "report_doc_id": "report-b204e9800998ecf8427ed41d8cd98f00"
}
```

### 2\. Trigger Evaluation

**`POST /evaluate`**

  * **Body:** `application/json`
  * **Example Body:**

<!-- end list -->

```json
{
  "job_title": "Product Engineer (Backend)",
  "cv_doc_id": "cv-d41d8cd98f00b204e9800998ecf8427e",
  "report_doc_id": "report-b204e9800998ecf8427ed41d8cd98f00"
}
```

  * **Example Response (Immediate):**

<!-- end list -->

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

## ⚠️ Disclaimer
The design, API, and anything here is still in development thus it all might change, and is not final.