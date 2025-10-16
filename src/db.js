// src/db.js
// Demo-mode forced: if DEMO_MODE=true we always use a file-backed demo DB.
// Otherwise we attempt to use a real Postgres Pool, with fallback to demo file if unreachable.

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Anchor demo DB to repository root (dir above src)
const repoRoot = path.resolve(__dirname, '..');
const connectionString = process.env.DATABASE_URL || '';
const DEMO = String(process.env.DEMO_MODE || 'true').toLowerCase() === 'true';
// prefer explicit env var, otherwise repo-root .demo_db.json
const DEMO_DB_PATH = process.env.DEMO_DB_PATH || path.join(repoRoot, '.demo_db.json');

let realPool = null;
let realPoolHealthy = false;

if (DEMO) {
  console.log('DEMO_MODE=true -> forcing file-backed demo DB. Demo DB path:', DEMO_DB_PATH);
} else {
  if (connectionString) {
    try {
      realPool = new Pool({ connectionString });
      realPool.query('SELECT 1').then(() => {
        realPoolHealthy = true;
        console.log('Postgres pool connected OK');
      }).catch((e) => {
        realPoolHealthy = false;
        console.warn('Postgres pool initial check failed:', e && e.message ? e.message : e);
      });
    } catch (e) {
      realPool = null;
      realPoolHealthy = false;
      console.warn('Failed to create Postgres pool:', e && e.message ? e.message : e);
    }
  } else {
    console.warn('No DATABASE_URL provided; running in demo file-backed DB only if DEMO_MODE=true');
    realPool = null;
    realPoolHealthy = false;
  }
}

// ----- File-backed demo DB helpers -----
function ensureDemoFile() {
  try {
    if (!fs.existsSync(DEMO_DB_PATH)) {
      const seed = { documents: {}, jobs: {} };
      const tmp = DEMO_DB_PATH + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(seed, null, 2), 'utf8');
      fs.renameSync(tmp, DEMO_DB_PATH);
    }
  } catch (e) {
    throw new Error('Unable to create demo DB file: ' + (e && e.message ? e.message : e));
  }
}

function loadDemoState() {
  ensureDemoFile();
  try {
    const txt = fs.readFileSync(DEMO_DB_PATH, 'utf8');
    return JSON.parse(txt || '{}');
  } catch (e) {
    const seed = { documents: {}, jobs: {} };
    try {
      const tmp = DEMO_DB_PATH + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(seed, null, 2), 'utf8');
      fs.renameSync(tmp, DEMO_DB_PATH);
    } catch (ee) { /* ignore */ }
    return seed;
  }
}

function saveDemoStateAtomic(state) {
  try {
    const tmp = DEMO_DB_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tmp, DEMO_DB_PATH);
  } catch (e) {
    console.warn('Failed to save demo DB state atomically:', e && e.message ? e.message : e);
    try { fs.writeFileSync(DEMO_DB_PATH, JSON.stringify(state, null, 2), 'utf8'); } catch (ee) { console.warn('Fallback write also failed:', ee && ee.message ? ee.message : ee); }
  }
}

function tryParseMaybeJSON(v) {
  if (typeof v === 'string') {
    try { return JSON.parse(v); } catch (e) { return v; }
  }
  return v;
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function demoQuery(sql, params = []) {
  const raw = (sql || '').trim();

  const insertDocumentsRe = /^insert into\s+documents\s*\(/i;
  const selectStoragePathRe = /^select\s+storage_path\s+from\s+documents\s+where\s+id\s*=\s*\$1/i;
  const insertJobsRe = /^insert into\s+jobs\s*\(/i;
  const updateJobsStatusResultRe = /^update\s+jobs\s+set\s+status\s*=\s*\$1\s*,\s*result\s*=\s*\$2\s*,/i;
  const updateJobsWorkerLogsRe = /^update\s+jobs\s+set\s+status\s*=\s*\$1\s*,\s*worker_logs\s*=\s*\$2\s*,/i;
  const updateJobsStatusOnlyRe = /^update\s+jobs\s+set\s+status\s*=\s*\$1/i;
  const selectJobRe = /^select\s+id\s*,\s*status\s*,\s*result\s+from\s+jobs\s+where\s+id\s*=\s*\$1/i;

  function loadState() {
    const s = loadDemoState();
    s.documents = s.documents || {};
    s.jobs = s.jobs || {};
    return s;
  }

  if (insertDocumentsRe.test(raw)) {
    const id = params[0];
    const filename = params[1];
    const type = params[2];
    const storage_path = params[3];
    const state = loadState();
    state.documents[id] = { id, filename, type, storage_path, created_at: new Date().toISOString() };
    saveDemoStateAtomic(state);
    console.log('[demo-db] inserted document', id, storage_path);
    return { rowCount: 1 };
  }

  if (selectStoragePathRe.test(raw)) {
    const id = params[0];
    const maxAttempts = 8;
    const baseDelay = 40;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const state = loadState();
      if (state.documents && state.documents[id]) {
        return { rowCount: 1, rows: [{ storage_path: state.documents[id].storage_path }] };
      }
      await sleep(baseDelay * (attempt + 1));
    }
    return { rowCount: 0, rows: [] };
  }

  if (insertJobsRe.test(raw)) {
    const id = params[0];
    const job_title = params[1];
    const cv_id = params[2];
    const project_id = params[3];
    const status = params[4];
    const state = loadState();
    state.jobs[id] = { id, job_title, cv_id, project_id, status, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), result: null, worker_logs: null };
    saveDemoStateAtomic(state);
    console.log('[demo-db] inserted job', id, 'cv=', cv_id, 'proj=', project_id);
    return { rowCount: 1 };
  }

  if (updateJobsStatusResultRe.test(raw)) {
    const status = params[0];
    const result = tryParseMaybeJSON(params[1]);
    const id = params[2];
    const state = loadState();
    if (!state.jobs[id]) return { rowCount: 0 };
    state.jobs[id].status = status;
    state.jobs[id].result = result;
    state.jobs[id].updated_at = new Date().toISOString();
    saveDemoStateAtomic(state);
    return { rowCount: 1 };
  }

  if (updateJobsWorkerLogsRe.test(raw)) {
    const status = params[0];
    const worker_logs = tryParseMaybeJSON(params[1]);
    const id = params[2];
    const state = loadState();
    if (!state.jobs[id]) return { rowCount: 0 };
    state.jobs[id].status = status;
    state.jobs[id].worker_logs = worker_logs;
    state.jobs[id].updated_at = new Date().toISOString();
    saveDemoStateAtomic(state);
    return { rowCount: 1 };
  }

  if (updateJobsStatusOnlyRe.test(raw)) {
    const status = params[0];
    const id = params[1];
    const state = loadState();
    if (!state.jobs[id]) return { rowCount: 0 };
    state.jobs[id].status = status;
    state.jobs[id].updated_at = new Date().toISOString();
    saveDemoStateAtomic(state);
    return { rowCount: 1 };
  }

  if (selectJobRe.test(raw)) {
    const id = params[0];
    const state = loadState();
    if (!state.jobs[id]) return { rowCount: 0, rows: [] };
    const r = state.jobs[id];
    return { rowCount: 1, rows: [{ id: r.id, status: r.status, result: r.result }] };
  }

  return { rowCount: 0, rows: [] };
}

// Exported pool-like object
const pool = {
  async query(sql, params = []) {
    // If DEMO mode is forced, always use demoQuery
    if (DEMO) {
      return demoQuery(sql, params);
    }

    // Prefer real pool if healthy
    if (realPool && realPoolHealthy) {
      try {
        return await realPool.query(sql, params);
      } catch (err) {
        const msg = err && err.message ? err.message.toString().toLowerCase() : '';
        if (DEMO && (msg.includes('getaddrinfo') || err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED' || msg.includes('connect'))) {
          realPoolHealthy = false;
          console.warn('Real Postgres pool became unhealthy; switching to file-backed demo DB (DEMO_MODE=true). Error:', err && err.message ? err.message : err);
          return demoQuery(sql, params);
        }
        throw err;
      }
    }

    // If realPool exists but not healthy, try quick check
    if (realPool && !realPoolHealthy) {
      try {
        await realPool.query('SELECT 1');
        realPoolHealthy = true;
        return await realPool.query(sql, params);
      } catch (err) {
        const msg = err && err.message ? err.message.toString().toLowerCase() : '';
        if (DEMO && (msg.includes('getaddrinfo') || err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED' || msg.includes('connect'))) {
          realPoolHealthy = false;
          console.warn('Postgres unreachable; using file-backed demo DB (DEMO_MODE=true). Error:', err && err.message ? err.message : err);
          return demoQuery(sql, params);
        }
        throw err;
      }
    }

    // No real pool available -> if DEMO, use file-backed demo DB
    if (DEMO) {
      return demoQuery(sql, params);
    }

    throw new Error('Postgres pool not available and DEMO_MODE is not enabled.');
  },

  async end() {
    if (realPool) {
      try { await realPool.end(); } catch (e) { /* ignore */ }
    }
  }
};

module.exports = pool;
