// src/pipeline.js
// Reworked pipeline: Qdrant REST HTTP calls (undici) instead of @qdrant/js-client-rest library.
// This avoids client-version mismatches inside containers and is robust across environments.

const pdf = require('pdf-parse');
const fs = require('fs');
const pool = require('./db');
const aiClient = require('./lib/aiClient');
// Load uuid.v4 robustly (works with ESM or CommonJS). Fallback to crypto.randomUUID().
let uuidv4;
try {
  const _u = require('uuid');
  if (_u && typeof _u.v4 === 'function') uuidv4 = _u.v4;
  else if (_u && _u.default && typeof _u.default.v4 === 'function') uuidv4 = _u.default.v4;
} catch (e) { /* ignore */ }
if (!uuidv4) {
  const { randomUUID } = require('crypto');
  uuidv4 = () => randomUUID();
}
const { v4: _uuid4_unused } = { v4: uuidv4 }; // keep lint tools happy

const { v4: uuidV4 } = (() => ({ v4: uuidv4 }))();

const { fetch } = require('undici');

const DEMO = String(process.env.DEMO_MODE || 'false').toLowerCase() === 'true';
const QDRANT_URL = (process.env.QDRANT_URL || 'http://127.0.0.1:6333').replace(/\/$/, '');
const COLLECTION_NAME = process.env.QDRANT_COLLECTION || 'case_study_docs';
const QDRANT_VECTOR_SIZE = parseInt(process.env.QDRANT_VECTOR_SIZE || '1536', 10);

// ---------- Qdrant HTTP helpers ----------
async function qdrantListCollections() {
  const url = `${QDRANT_URL}/collections`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`qdrant list collections failed: ${r.status}`);
  return r.json();
}

async function qdrantCreateCollection(collectionName, size) {
  const url = `${QDRANT_URL}/collections/${encodeURIComponent(collectionName)}`;
  const body = {
    vectors: { size: Number(size), distance: 'Cosine' }
  };
  const r = await fetch(url, { method: 'PUT', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`qdrant create collection failed: ${r.status} ${txt}`);
  }
  return r.json().catch(() => ({}));
}

async function qdrantUpsertPoints(collectionName, points, wait = true) {
  if (!Array.isArray(points) || points.length === 0) return { status: 'ok' };
  const url = `${QDRANT_URL}/collections/${encodeURIComponent(collectionName)}/points?wait=${wait ? 'true' : 'false'}`;
  const body = { points };
  const r = await fetch(url, { method: 'PUT', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
  const text = await r.text();
  if (!r.ok) throw new Error(`qdrant upsert failed: ${r.status} ${text}`);
  try { return JSON.parse(text); } catch (e) { return { raw: text }; }
}

async function qdrantSearch(collectionName, vector, limit = 5, with_payload = true) {
  const url = `${QDRANT_URL}/collections/${encodeURIComponent(collectionName)}/points/search`;
  const body = { vector, limit, with_payload };
  const r = await fetch(url, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
  const text = await r.text();
  if (!r.ok) throw new Error(`qdrant search failed: ${r.status} ${text}`);
  return JSON.parse(text);
}

// ensure collection exists (idempotent)
async function ensureCollection() {
  if (DEMO) return;
  try {
    const info = await qdrantListCollections();
    const names = (info?.collections || []).map(c => c.name);
    if (!names.includes(COLLECTION_NAME)) {
      await qdrantCreateCollection(COLLECTION_NAME, QDRANT_VECTOR_SIZE);
    }
  } catch (e) {
    console.warn('qdrant ensureCollection warning (continuing):', e && e.message ? e.message : e);
    // do not throw here; allow pipeline to continue (fallbacks will help)
  }
}

// ---------- Text extraction & chunking ----------
async function extractTextFromFile(pathToFile) {
  try {
    const data = fs.readFileSync(pathToFile);
    try {
      const parsed = await pdf(data);
      if (parsed && typeof parsed.text === 'string' && parsed.text.trim().length > 0) {
        return parsed.text;
      }
    } catch (pdfErr) {
      console.warn('pdf-parse failed for', pathToFile, 'err:', pdfErr && pdfErr.message ? pdfErr.message : pdfErr);
    }
    try {
      const asText = data.toString('utf8').trim();
      if (asText.length > 0) return asText;
    } catch (txtErr) {
      console.warn('Plain-text fallback failed for', pathToFile, txtErr && txtErr.message ? txtErr.message : txtErr);
    }
    return '[unable to extract text from document]';
  } catch (fsErr) {
    throw new Error(`MISSING_FILE:${pathToFile} (${fsErr.message})`);
  }
}

function chunkText(text, size = 1000, overlap = 200) {
  if (!text) return [];
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    const chunk = text.slice(i, Math.min(i + size, text.length));
    chunks.push(chunk);
    i += (size - overlap);
  }
  return chunks.filter(Boolean);
}

// ---------- Embeddings ----------
async function embedTextsGemini(texts) {
  const embeddings = [];
  for (let t of texts) {
    const input = (t || '').slice(0, 4000);
    const vec = await aiClient.generateEmbedding({ provider: process.env.DEFAULT_PROVIDER || 'gemini', input });
    if (!Array.isArray(vec)) throw new Error('embedding not array');
    embeddings.push(vec);
  }
  return embeddings;
}

// ---------- Upsert & Search (using REST) ----------
async function upsertChunksToQdrant(docId, chunks) {
  if (!chunks || chunks.length === 0) return [];
  if (DEMO) {
    // In demo mode we still return generated ids but skip network I/O
    return chunks.map(c => c.id);
  }

  try {
    await ensureCollection();
    const texts = chunks.map(c => c.text);
    const vectors = await embedTextsGemini(texts);

    const points = chunks.map((c, idx) => ({
      id: c.qdrantPointId || c.id,    // qdrantPointId when available; fall back to old id
      vector: vectors[idx],
      payload: { text: c.text, document_id: docId, chunk_id: (c.chunkId || c.id) }
    }));

    await qdrantUpsertPoints(COLLECTION_NAME, points, true);
    return points.map(p => p.id);
  } catch (e) {
    console.warn('qdrant upsert warning (continuing):', e && e.message ? e.message : e);
    // return chunk ids so pipeline can proceed
    return chunks.map(c => c.id);
  }
}

async function retrieveTopK(queryText, k = 5) {
  if (DEMO) return []; // no retrieval in demo mode
  try {
    const embed = await aiClient.generateEmbedding({ provider: process.env.DEFAULT_PROVIDER || 'gemini', input: queryText });
    const resp = await qdrantSearch(COLLECTION_NAME, embed, k, true);
    // Normalize response: resp.result or resp?.result?.[0] sometimes
    if (resp && Array.isArray(resp.result)) {
      return resp.result;
    }
    if (Array.isArray(resp)) return resp;
    return resp;
  } catch (e) {
    console.warn('qdrant search warning (continuing):', e && e.message ? e.message : e);
    return [];
  }
}

// ---------- LLM scoring & heuristics ----------
// REPLACED computeScoresFromLLM to return fields matching the brief exactly.

async function computeScoresFromLLM(structuredCV, projectReport, jobTitle) {
  const prompts = require('../prompts/prompts');
  const cvPrompt = prompts.buildCvPrompt({ structuredCV, jobTitle });
  const projectPrompt = prompts.buildProjectPrompt({ projectReport, jobTitle });

  const { validateCvOutput, validateProjectOutput } = require('./validators/validate');
  const { scoreCvHeuristic, scoreProjectHeuristic } = require('./fallback/scorer');

  let cvResp = null;
  let projectResp = null;
  try {
    cvResp = await aiClient.generateForProvider({ provider: process.env.DEFAULT_PROVIDER || 'gemini', userPrompt: cvPrompt, extra: { maxOutputTokens: 1200 } });
  } catch (e) {
    cvResp = null;
  }
  try {
    projectResp = await aiClient.generateForProvider({ provider: process.env.DEFAULT_PROVIDER || 'gemini', userPrompt: projectPrompt, extra: { maxOutputTokens: 1200 } });
  } catch (e) {
    projectResp = null;
  }

  let safeCv, safeProject;

  if (cvResp && cvResp.parsed) {
    const { valid } = validateCvOutput(cvResp.parsed);
    if (valid) safeCv = cvResp.parsed;
    else {
      safeCv = scoreCvHeuristic(structuredCV.raw_text || '');
      safeCv.cv_feedback = safeCv.cv_feedback || 'Fallback heuristic used due to invalid LLM output.';
    }
  } else {
    safeCv = scoreCvHeuristic(structuredCV.raw_text || '');
    safeCv.cv_feedback = safeCv.cv_feedback || 'Fallback heuristic used due to LLM error.';
  }

  if (projectResp && projectResp.parsed) {
    const { valid } = validateProjectOutput(projectResp.parsed);
    if (valid) safeProject = projectResp.parsed;
    else {
      safeProject = scoreProjectHeuristic(projectReport.raw_text || '');
      safeProject.project_feedback = safeProject.project_feedback || 'Fallback heuristic used due to invalid LLM output.';
    }
  } else {
    safeProject = scoreProjectHeuristic(projectReport.raw_text || '');
    safeProject.project_feedback = safeProject.project_feedback || 'Fallback heuristic used due to LLM error.';
  }

  // Compute normalized CV match rate (0.00-1.00)
  const weighted = (safeCv.technical_skills * 0.4) + (safeCv.experience_level * 0.25) + (safeCv.relevant_achievements * 0.2) + (safeCv.cultural_fit * 0.15);
  const cv_match_rate = +(Math.max(0, Math.min(5, weighted)) / 5.0).toFixed(2);

  // Project score: keep in 1-5 scale (float)
  const projectWeighted = (safeProject.correctness * 0.3) + (safeProject.code_quality * 0.25) + (safeProject.resilience * 0.2) + (safeProject.documentation * 0.15) + (safeProject.creativity * 0.1);
  const project_score = +Math.max(1, Math.min(5, projectWeighted)).toFixed(2);

  // Build an overall textual summary consistent with README style.
  // Normalize project_score into 0..1 for combined summary
  const project_norm = (project_score - 1) / 4; // maps 1..5 -> 0..1
  const combined = +( (cv_match_rate * 0.6) + (project_norm * 0.4) ).toFixed(2); // weighted combined score 0..1

  let overall_summary = '';
  if (combined >= 0.8 && project_score >= 4) {
    overall_summary = 'Strong candidate fit. Good technical match and project quality.';
  } else if (combined >= 0.6) {
    overall_summary = 'Good candidate fit with some areas to improve; consider for interview with targeted questions.';
  } else if (combined >= 0.45) {
    overall_summary = 'Potential fit but needs improvement on either background or project robustness.';
  } else {
    overall_summary = 'Weak match to the role based on current CV and project report.';
  }

  // Add a short actionable sentence referencing both CV & Project feedback
  // Keep it concise and human-readable like the brief examples.
  overall_summary += ` CV note: ${safeCv.cv_feedback.split('.').slice(0,2).join('. ')}. Project note: ${Array.isArray(safeProject.project_feedback) ? safeProject.project_feedback.join('. ').slice(0,120) : (safeProject.project_feedback || '').slice(0,120)}.`

  return {
    cv_match_rate,
    cv_feedback: safeCv.cv_feedback || '',
    project_score,
    project_feedback: safeProject.project_feedback || '',
    overall_summary
  };
}

// ---------- Orchestration ----------
async function runEvaluation({ jobId, job_title, cv_id, project_id }) {
  await pool.query('UPDATE jobs SET status=$1, updated_at=NOW() WHERE id=$2', ['processing', jobId]);

  const cvRes = await pool.query('SELECT storage_path FROM documents WHERE id=$1', [cv_id]);
  const projRes = await pool.query('SELECT storage_path FROM documents WHERE id=$1', [project_id]);
  if (cvRes.rowCount === 0 || projRes.rowCount === 0) throw new Error('documents not found');

  const cvPath = cvRes.rows[0].storage_path;
  const projectPath = projRes.rows[0].storage_path;

  const cvText = await extractTextFromFile(cvPath);
  const projectText = await extractTextFromFile(projectPath);

  const cvChunksRaw = chunkText(cvText, 1200, 200);
  const projChunksRaw = chunkText(projectText, 1200, 200);

  // generate a stable chunk id for DB/payload, but use a qdrantPointId that is a plain UUID
  const cvChunks = cvChunksRaw.map((t, i) => {
    const chunkId = `cv_${i}_${uuidv4()}`;           // human/readable id used in payload
    const qdrantPointId = uuidv4();                 // valid UUID for Qdrant point id
    return { chunkId, qdrantPointId, text: t };
  });
  const projChunks = projChunksRaw.map((t, i) => {
    const chunkId = `proj_${i}_${uuidv4()}`;
    const qdrantPointId = uuidv4();
    return { chunkId, qdrantPointId, text: t };
  });


  // Upsert to Qdrant (REST) when not in DEMO
  await upsertChunksToQdrant(cv_id, cvChunks);
  await upsertChunksToQdrant(project_id, projChunks);

  // Retrieve context hits (search)
  const cvContextHits = await retrieveTopK(job_title + ' ' + cvText.slice(0, 1000), 5);
  const projContextHits = await retrieveTopK(job_title + ' ' + projectText.slice(0, 1000), 5);

  const structuredCV = { raw_text: cvText.slice(0, 5000), top_hits: cvContextHits };
  const projectReport = { raw_text: projectText.slice(0, 5000), top_hits: projContextHits };

  const scores = await computeScoresFromLLM(structuredCV, projectReport, job_title);

  await pool.query('UPDATE jobs SET status=$1, result=$2, updated_at=NOW() WHERE id=$3', ['completed', scores, jobId]);
}

module.exports = { runEvaluation };
