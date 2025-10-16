const { fetch } = require('undici');

function extractEmbeddingFromResponse(data) {
  if (!data) return null;

  if (data.embedding) {
    if (Array.isArray(data.embedding)) return data.embedding;
    if (Array.isArray(data.embedding.values)) return data.embedding.values;
    if (Array.isArray(data.embedding.embedding)) return data.embedding.embedding;
  }

  if (Array.isArray(data.embeddings) && data.embeddings[0]?.embedding && Array.isArray(data.embeddings[0].embedding)) {
    return data.embeddings[0].embedding;
  }

  if (Array.isArray(data.results) && data.results[0]?.embedding && Array.isArray(data.results[0].embedding)) {
    return data.results[0].embedding;
  }

  if (Array.isArray(data.data) && data.data[0]?.embedding && Array.isArray(data.data[0].embedding)) {
    return data.data[0].embedding;
  }

  if (Array.isArray(data.data) && data.data[0]?.values && Array.isArray(data.data[0].values)) {
    return data.data[0].values;
  }

  if (Array.isArray(data.embedding)) return data.embedding;

  return null;
}

async function testEmbed() {
  const API_KEY = process.env.GEMINI_API_KEY;
  if (!API_KEY) {
    console.error('Set GEMINI_API_KEY in env before running.');
    process.exit(1);
  }

  const MODEL = process.env.GEMINI_EMBED_MODEL || 'gemini-embedding-001';

  // Two endpoint styles: older :embedText and newer :embedContent
  const endpoints = [
    {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:embedText`,
      body: { text: 'Test embedding vector shape check: the quick brown fox jumps over the lazy dog.' }
    },
    {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:embedContent`,
      body: { content: { parts: [{ text: 'Test embedding vector shape check: the quick brown fox jumps over the lazy dog.' }] } }
    }
  ];

  async function doRequest(endpoint, useQueryKey = false) {
    const url = useQueryKey ? `${endpoint.url}?key=${encodeURIComponent(API_KEY)}` : endpoint.url;
    const headers = { 'Content-Type': 'application/json' };
    if (!useQueryKey) headers['x-goog-api-key'] = API_KEY;
    const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(endpoint.body) });
    const text = await r.text();
    return { status: r.status, text, url };
  }

  let lastResp = null;

  for (const endpoint of endpoints) {
    // Try header-based auth first, fallback to ?key= if header fails with 401/403/404
    try {
      let resp = await doRequest(endpoint, false);
      if ([401, 403, 404].includes(resp.status)) {
        resp = await doRequest(endpoint, true);
      }
      lastResp = resp;
      console.log('HTTP status:', resp.status);
      let data = null;
      try { data = JSON.parse(resp.text); } catch (e) { data = null; }

      if (data && resp.status >= 200 && resp.status < 300) {
        const embed = extractEmbeddingFromResponse(data);
        if (!embed) {
          console.log('Could not find embedding array in response. Full response (truncated):');
          console.log(resp.text.slice(0, 4000));
          process.exit(2);
        }
        console.log('Embedding length:', embed.length);
        console.log('First 10 values:', embed.slice(0, 10));
        // sample min/max
        let min = Number.POSITIVE_INFINITY, max = Number.NEGATIVE_INFINITY;
        for (const v of embed) {
          if (typeof v === 'number') {
            if (v < min) min = v;
            if (v > max) max = v;
          }
        }
        if (min === Number.POSITIVE_INFINITY) min = null;
        if (max === Number.NEGATIVE_INFINITY) max = null;
        console.log('Sample values (min,max):', min, max);
        process.exit(0);
      } else {
        // print error body and continue to next endpoint
        try {
          const parsed = data || JSON.parse(resp.text);
          console.log('Raw response keys:', Object.keys(parsed));
        } catch (e) {
          console.log('Response (non-JSON):', resp.text.slice(0, 4000));
        }
        // If it's a 2xx but we couldn't parse data, exit with parse error
        if (resp.status >= 200 && resp.status < 300) {
          process.exit(3);
        }
      }
    } catch (e) {
      lastResp = lastResp || { text: String(e), status: 'error' };
    }
  }

  // If we reach here, no endpoint succeeded
  console.error('All embed endpoints failed. Last response (truncated):');
  if (lastResp && lastResp.text) console.error(lastResp.text.slice(0, 4000));
  process.exit(4);
}

testEmbed().catch(e => { console.error('error', e); process.exit(99); });
