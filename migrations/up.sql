-- migrations/up.sql
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  filename TEXT,
  type TEXT,
  storage_path TEXT,
  extracted_text TEXT,
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  job_title TEXT,
  cv_id TEXT REFERENCES documents(id),
  project_id TEXT REFERENCES documents(id),
  status TEXT,
  result JSONB,
  worker_logs JSONB,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);
