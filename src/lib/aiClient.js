const path = require('path');
const { fetch } = require('undici');

const DEFAULT_GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const DEFAULT_GEMINI_EMBED = process.env.GEMINI_EMBED_MODEL || 'gemini-embedding-001';

function randomPlaceholderVector(len=1536, seed=1) {
  const out = new Array(len).fill(0).map((_, i) => ((i + seed) % 100) / 100);
  return out;
}

function loadPromptsModuleSync() {
  const promptsPath = path.join(process.cwd(), 'prompts', 'prompts.js');
  return require(promptsPath);
}
function loadDemoFixtureSync() {
  const demoPath = path.join(process.cwd(), 'prompts', 'demo_fixture.js');
  return require(demoPath);
}
const DEMO_FIXTURE = loadDemoFixtureSync();

function stripCodeFences(s) {
  if (!s || typeof s !== 'string') return s;
  return s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
}
function tryParseJSON(text) {
  if (!text || typeof text !== 'string') return null;
  try { return JSON.parse(text); } catch (e) {}
  const codeBlock = text.match(/```json\s*([\s\S]*?)\s*```/i) || text.match(/```([\s\S]*?)```/i);
  if (codeBlock) {
    try { return JSON.parse(codeBlock[1]); } catch (e) {}
  }
  const first = text.indexOf('{'), last = text.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) {
    const candidate = text.slice(first, last + 1);
    try { return JSON.parse(candidate); } catch (e) {}
  }
  return null;
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function extractEmbeddingFromResponse(data) {
  // Robust extraction for many possible Gemini embedding response shapes.
  // Returns an array of numbers or null.
  if (!data) return null;

  // 1) "embedding": { "values": [...] } or "embedding": { "embedding": [...] }
  if (data.embedding) {
    if (Array.isArray(data.embedding)) return data.embedding;
    if (Array.isArray(data.embedding.values)) return data.embedding.values;
    if (Array.isArray(data.embedding.embedding)) return data.embedding.embedding;
  }

  // 2) "embeddings": [{ "embedding": [...] }, ...]
  if (Array.isArray(data.embeddings) && data.embeddings[0]?.embedding && Array.isArray(data.embeddings[0].embedding)) {
    return data.embeddings[0].embedding;
  }

  // 3) "results": [{ "embedding": [...] }, ...] (some older / alternate shapes)
  if (Array.isArray(data.results) && data.results[0]?.embedding && Array.isArray(data.results[0].embedding)) {
    return data.results[0].embedding;
  }

  // 4) "data": [{ "embedding": [...] }, ...]
  if (Array.isArray(data.data) && data.data[0]?.embedding && Array.isArray(data.data[0].embedding)) {
    return data.data[0].embedding;
  }

  // 5) "data": [{ "values": [...] }, ...]
  if (Array.isArray(data.data) && data.data[0]?.values && Array.isArray(data.data[0].values)) {
    return data.data[0].values;
  }

  // 6) direct "embedding" array field
  if (Array.isArray(data.embedding)) return data.embedding;

  return null;
}

async function callGeminiEmbedding(input) {
  if (String(process.env.DEMO_MODE || 'true').toLowerCase() === 'true') {
    const size = Number(process.env.QDRANT_VECTOR_SIZE || 1536);
    const seed = (typeof input === 'string' && input.length) ? input.length : 1;
    return randomPlaceholderVector(size, seed);
  }
  const rawKey = process.env.GEMINI_API_KEY || '';
  const API_KEY = rawKey.trim();
  const MODEL = process.env.GEMINI_EMBED_MODEL || DEFAULT_GEMINI_EMBED;
  if (!API_KEY) throw { source: 'provider', provider: 'gemini', code: 'MISSING_API_KEY', message: 'Gemini API key not configured' };

  // Try two common endpoints: embedText (older) and embedContent (newer)
  const endpoints = [
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:embedText`,
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:embedContent`
  ];
  const payload1 = { text: input };
  const payload2 = { content: { parts: [{ text: input }] } };

  async function doRequest(url, body, useQueryKey = false) {
    const finalUrl = useQueryKey ? `${url}?key=${encodeURIComponent(API_KEY)}` : url;
    const headers = { 'Content-Type': 'application/json' };
    if (!useQueryKey) headers['x-goog-api-key'] = API_KEY;
    const r = await fetch(finalUrl, { method: 'POST', headers, body: JSON.stringify(body) });
    const text = await r.text();
    return { status: r.status, text, url: finalUrl };
  }

  let lastResp = null;
  const maxAttempts = 3;

  for (const [idx, endpoint] of endpoints.entries()) {
    const body = idx === 0 ? payload1 : payload2;
    let attempt = 0;
    while (attempt < maxAttempts) {
      attempt++;
      let resp = await doRequest(endpoint, body, false);
      if ([401,403,404].includes(resp.status)) {
        resp = await doRequest(endpoint, body, true);
      }
      lastResp = resp;
      if (resp.status >= 200 && resp.status < 300) {
        let data = null;
        try { data = JSON.parse(resp.text); } catch (e) { data = null; }
        const extracted = extractEmbeddingFromResponse(data);
        if (Array.isArray(extracted)) return extracted;
        // If response parsed but no embedding found, throw parse error with details
        throw { source: 'provider', provider: 'gemini', code: 'PARSE_ERROR', message: 'Unable to parse embedding array from response', details: resp.text };
      }
      if (resp.status >= 500 && resp.status < 600 && attempt < maxAttempts) {
        await sleep(500 * Math.pow(2, attempt - 1));
        continue;
      }
      break;
    }
  }

  const details = lastResp ? lastResp.text : 'No response body';
  const status = lastResp ? lastResp.status : 'unknown';
  throw { source: 'provider', provider: 'gemini', code: 'PROVIDER_ERROR', status, message: 'Gemini embedding API error', details };
}

async function callGemini(systemPrompt, userPrompt, opts = {}) {
  const rawKey = process.env.GEMINI_API_KEY || '';
  const GEMINI_KEY = rawKey.trim();
  const GEMINI_MODEL = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  if (!GEMINI_KEY) throw { source: 'provider', provider: 'gemini', code: 'MISSING_API_KEY', message: 'Gemini API key not configured' };

  const endpointBase = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`;
  const payload = {
    contents: [{ parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
    generationConfig: { temperature: 0.0, maxOutputTokens: opts.maxOutputTokens || 1000, candidateCount: 1 }
  };

  async function doRequest(useQueryKey = false) {
    const url = useQueryKey ? `${endpointBase}?key=${encodeURIComponent(GEMINI_KEY)}` : endpointBase;
    const headers = { 'Content-Type': 'application/json' };
    if (!useQueryKey) headers['x-goog-api-key'] = GEMINI_KEY;
    const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
    const text = await r.text();
    return { status: r.status, text };
  }

  const maxAttempts = 3;
  let attempt = 0;
  let lastResp = null;
  while (attempt < maxAttempts) {
    attempt++;
    let resp = await doRequest(false);
    if ([401, 403, 404].includes(resp.status)) {
      resp = await doRequest(true);
    }
    lastResp = resp;
    if (resp.status >= 200 && resp.status < 300) {
      let gemData = null;
      try { gemData = JSON.parse(resp.text); } catch (e) { gemData = null; }
      let assistantText = '';
      if (gemData?.candidates && Array.isArray(gemData.candidates) && gemData.candidates[0]?.content) {
        const content = gemData.candidates[0].content;
        if (content.parts && Array.isArray(content.parts) && content.parts.length > 0) {
          assistantText = content.parts.map(p => p?.text || '').join('');
        } else if (typeof content === 'string') {
          assistantText = content;
        } else {
          assistantText = '';
        }
      } else if (gemData?.responseText) {
        assistantText = gemData.responseText;
      } else {
        assistantText = resp.text;
      }
      assistantText = stripCodeFences(assistantText);
      return { assistantText, rawResponse: resp.text, gemData };
    }
    if (resp.status >= 500 && resp.status < 600 && attempt < maxAttempts) {
      await sleep(500 * Math.pow(2, attempt - 1));
      continue;
    }
    break;
  }
  const details = lastResp ? lastResp.text : 'No response body';
  const status = lastResp ? lastResp.status : 'unknown';
  throw { source: 'provider', provider: 'gemini', code: 'PROVIDER_ERROR', status, message: 'Gemini API error', details };
}

async function generatePlainText({ provider, systemPrompt, userPrompt, extra = {} }) {
  provider = (provider || process.env.DEFAULT_PROVIDER || 'gemini').toLowerCase();
  if (provider === 'gemini') {
    const { assistantText, rawResponse } = await callGemini(systemPrompt, userPrompt, { maxOutputTokens: extra.maxOutputTokens || 10000 });
    return { assistantText: stripCodeFences(assistantText), rawResponse };
  }
  throw { source: 'wrapper', code: 'UNSUPPORTED_PROVIDER', message: `Unsupported provider: ${provider}` };
}

async function generateEmbedding({ provider, input }) {
  provider = (provider || process.env.DEFAULT_PROVIDER || 'gemini').toLowerCase();
  if (provider === 'gemini') {
    const embed = await callGeminiEmbedding(input);
    return embed;
  }
  throw { source: 'wrapper', code: 'UNSUPPORTED_PROVIDER', message: `Unsupported provider: ${provider}` };
}

function getDemoSupplement({ type = 'expansion', index = 0 }) {
  if (!DEMO_FIXTURE || !Array.isArray(DEMO_FIXTURE.micro_lessons)) {
    throw { source: 'demo', code: 'NO_DEMO', message: 'No demo fixture available' };
  }
  const lessons = DEMO_FIXTURE.micro_lessons;
  const idx = Math.min(Math.max(0, Number(index) || 0), lessons.length - 1);
  const lesson = lessons[idx] || {};
  if (type === 'expansion') {
    return lesson.full_guide || (typeof lesson.fullGuideText === 'string' ? lesson.fullGuideText : '');
  }
  if (type === 'hint') {
    if (Array.isArray(lesson.hints) && lesson.hints.length > 0) return lesson.hints[0];
    return lesson.tip ? lesson.tip.split('.').slice(0,1).join('.') : (lesson.practice_task ? `Try: ${lesson.practice_task.split('.').slice(0,1).join('.')}` : 'Try a small focused attempt.');
  }
  return '';
}

async function generateForProvider({ provider, userPrompt, extra = {} }) {
  if (String(process.env.DEMO_MODE).toLowerCase() === 'true') {
    return { parsed: DEMO_FIXTURE, raw: JSON.stringify(DEMO_FIXTURE), assistantText: null };
  }
  const prompts = loadPromptsModuleSync();
  const systemPrompt = prompts.SYSTEM_PROMPT;
  provider = (provider || process.env.DEFAULT_PROVIDER || 'gemini').toLowerCase();
  if (!userPrompt || typeof userPrompt !== 'string') {
    throw { source: 'wrapper', code: 'MISSING_USER_PROMPT', message: 'userPrompt is required and must be a string' };
  }
  if (provider === 'gemini') {
    const { assistantText, rawResponse } = await callGemini(systemPrompt, userPrompt, { maxOutputTokens: extra.maxOutputTokens || 10000 });
    const cleaned = stripCodeFences(assistantText || '');
    const parsed = tryParseJSON(cleaned);
    if (parsed) return { parsed, raw: rawResponse, assistantText: cleaned };
    if (!assistantText || assistantText.trim().length === 0) throw { source: 'provider', provider: 'gemini', code: 'EMPTY_RESPONSE', message: 'Gemini returned empty text or no parts', details: rawResponse };
    throw { source: 'provider', provider: 'gemini', code: 'PARSE_ERROR', message: 'Gemini output not JSON', details: cleaned };
  }
  throw { source: 'wrapper', code: 'UNSUPPORTED_PROVIDER', message: `Unsupported provider: ${provider}` };
}

module.exports = {
  generateForProvider,
  stripCodeFences,
  tryParseJSON,
  generatePlainText,
  getDemoSupplement,
  generateEmbedding
};
