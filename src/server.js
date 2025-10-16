require('dotenv').config();
const express = require('express');
const multer = require('multer');
const { Queue } = require('bullmq');
const IORedis = require('ioredis');
const pool = require('./db');
// Load uuid.v4 robustly (works with ESM or CommonJS). Fallback to crypto.randomUUID().
let uuidv4;
try {
  const _u = require('uuid');
  // Many distributions expose v4 as _u.v4, or default.v4 in ESM interop.
  if (_u && typeof _u.v4 === 'function') uuidv4 = _u.v4;
  else if (_u && _u.default && typeof _u.default.v4 === 'function') uuidv4 = _u.default.v4;
} catch (e) { /* ignore */ }
if (!uuidv4) {
  const { randomUUID } = require('crypto');
  uuidv4 = () => randomUUID();
}


const path = require('path');
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');

const fs = require('fs');
try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch (e) { /* ignore */ }

const upload = multer({ dest: UPLOAD_DIR });

const PORT = process.env.PORT || 3000;
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

const connection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
  connectTimeout: 10000,
  enableReadyCheck: true
});

connection.on('error', (err) => {
  console.error('Redis connection error (server):', err && err.message ? err.message : err);
});
connection.on('connect', () => console.log('Connected to Redis:', REDIS_URL));
connection.on('ready', () => console.log('Redis client ready'));

const evaluationQueue = new Queue('evaluation', { connection });

const app = express();
app.use(express.json());

app.post('/upload', upload.fields([{ name: 'cv' }, { name: 'project_report' }]), async (req, res) => {
  try {
    const cv = req.files['cv']?.[0];
    const project = req.files['project_report']?.[0];
    if (!cv || !project) return res.status(400).json({ error: 'cv and project_report required' });

    const cvId = 'file_' + uuidv4();
    const projectId = 'file_' + uuidv4();

    await pool.query('INSERT INTO documents(id, filename, type, storage_path, created_at) VALUES($1,$2,$3,$4,NOW())', [cvId, cv.originalname, 'cv', cv.path]);
    await pool.query('INSERT INTO documents(id, filename, type, storage_path, created_at) VALUES($1,$2,$3,$4,NOW())', [projectId, project.originalname, 'project', project.path]);

    res.json({ cv_id: cvId, project_id: projectId });
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    res.status(500).json({ error: 'internal' });
  }
});

app.post('/evaluate', async (req, res) => {
  try {
    // Accept multiple common aliases for cv_id and project_id to match README / examples / scripts
    const { job_title } = req.body;
    const cv_id = req.body.cv_id || req.body.cvDocId || req.body.cv_doc_id || req.body.cvId || req.body.cv;
    const project_id = req.body.project_id || req.body.reportDocId || req.body.report_doc_id || req.body.projectId || req.body.project_id || req.body.project;

    if (!job_title || !cv_id || !project_id) {
      return res.status(400).json({ error: 'job_title, cv_id, project_id required' });
    }

    const jobId = 'job_' + uuidv4();
    await pool.query(
      'INSERT INTO jobs(id, job_title, cv_id, project_id, status, created_at) VALUES($1,$2,$3,$4,$5,NOW())',
      [jobId, job_title, cv_id, project_id, 'queued']
    );

    // Immediate response must match brief exactly
    res.json({ id: jobId, status: 'queued' });

    // Enqueue a background job for workers
    // add without blocking the response
    evaluationQueue.add('evaluate', { jobId, job_title, cv_id, project_id }, { attempts: 3, backoff: { type: 'exponential', delay: 1000 } })
      .catch(err => console.error('Failed to enqueue job:', err));

    // If running in local/demo mode, also attempt an in-process evaluation so demo script can observe completion quickly.
    if (String(process.env.DEMO_MODE || 'false').toLowerCase() === 'true') {
      (async () => {
        try {
          const pipeline = require('./pipeline');
          await pipeline.runEvaluation({ jobId, job_title, cv_id, project_id });
        } catch (e) {
          console.error('In-process demo runEvaluation error', e);
        }
      })();
    }
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    res.status(500).json({ error: 'internal' });
  }
});

app.get('/result/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const r = await pool.query('SELECT id, status, result FROM jobs WHERE id=$1', [id]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'not found' });
    const job = r.rows[0];
    res.json({ id: job.id, status: job.status, result: job.result || null });
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    res.status(500).json({ error: 'internal' });
  }
});

const server = app.listen(PORT, () => console.log(`Listening ${PORT}`));

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} already in use. Set PORT env or kill the process using the port.`);
    process.exit(1);
  }
  console.error('Server error', err);
  process.exit(1);
});

process.on('SIGINT', async () => {
  console.log('Shutting down server...');
  try {
    await evaluationQueue.close();
  } catch (e) { /* ignore */ }
  connection.disconnect();
  process.exit(0);
});


// Programmatic shutdown helper for tests and graceful termination
async function shutdown() {
  console.log('Programmatic shutdown initiated...');
  try {
    // Close the bullmq queue gracefully
    try {
      await evaluationQueue.close();
    } catch (e) {
      console.warn('Error closing evaluationQueue during shutdown:', e && e.message ? e.message : e);
    }
    // Close Redis connection
    try {
      connection.disconnect();
    } catch (e) { /* ignore */ }
    // Close DB pool if available
    try {
      if (pool && typeof pool.end === 'function') {
        await pool.end();
      }
    } catch (e) { /* ignore */ }
    // Close HTTP server
    try {
      await new Promise((resolve, reject) => {
        server.close((err) => {
          if (err) return reject(err);
          resolve();
        });
      });
    } catch (e) {
      /* ignore */
    }
  } finally {
    console.log('Programmatic shutdown complete.');
  }
}

// Attach shutdown to exported app for tests to call (supertest requires the app object)
app.shutdown = shutdown;

module.exports = app;
