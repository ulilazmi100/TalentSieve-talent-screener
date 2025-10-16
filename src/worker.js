// src/worker.js (patched)
require('dotenv').config();

const { Worker } = require('bullmq');
const IORedis = require('ioredis');
const pool = require('./db');
const { runEvaluation } = require('./pipeline');

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

const connection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
  connectTimeout: 10000,
  enableReadyCheck: true
});

connection.on('error', (err) => {
  console.error('Redis connection error (worker):', err && err.message ? err.message : err);
});
connection.on('connect', () => console.log('Worker connected to Redis:', REDIS_URL));
connection.on('ready', () => console.log('Worker Redis client ready'));

const worker = new Worker('evaluation', async job => {
  const { jobId, job_title, cv_id, project_id } = job.data;
  try {
    await runEvaluation({ jobId, job_title, cv_id, project_id });
  } catch (err) {
    // log full stack to console
    console.error('job failed (detailed):', err && err.stack ? err.stack : err);

    // attempt to persist detailed worker_logs into DB (demo or real)
    try {
      const payload = { error: (err && err.message) ? err.message : String(err), stack: (err && err.stack) ? err.stack : null };
      await pool.query('UPDATE jobs SET status=$1, worker_logs=$2, updated_at=NOW() WHERE id=$3', ['failed', JSON.stringify(payload), jobId]);
    } catch (dbErr) {
      console.error('Failed to record job failure in DB:', dbErr && dbErr.stack ? dbErr.stack : dbErr);
    }

    // rethrow to let bullmq mark job failed
    throw err;
  }
}, { connection });

worker.on('completed', async (job) => {
  console.log('job completed', job.id);
});
worker.on('failed', (job, err) => {
  console.error('job failed event', job.id, err && err.message ? err.message : err);
});

process.on('SIGINT', async () => {
  console.log('Worker shutting down...');
  await worker.close();
  connection.disconnect();
  process.exit(0);
});
