/* Phone Assist demo server.
   Serves the static demo and keeps the API keys on the server side:
     POST /api/llm     -> GPT-5.6 Luna with structured JSON output
     GET  /api/prompts -> prompts/*.md, tools.md and kb/*.md as text
     POST /api/tts    -> ElevenLabs text to speech (audio/mpeg)
     GET  /api/config -> which services are configured
   Environment: OPENAI_API_KEY, ELEVENLABS_API_KEY, optional OPENAI_MODEL,
   OPENAI_EFFORT, ELEVENLABS_VOICE_CALLER, ELEVENLABS_VOICE_AGENT, PORT.
   A local .env file is loaded when present and never overrides real env vars. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

function loadEnvFile() {
  let text;
  try { text = fs.readFileSync(path.join(ROOT, '.env'), 'utf8'); } catch (e) { return; }
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (!process.env[key]) process.env[key] = val;
  }
}
loadEnvFile();

const PORT = Number(process.env.PORT || 8080);
const MODEL = process.env.OPENAI_MODEL || 'gpt-5.6-luna';
const DEFAULT_EFFORT = process.env.OPENAI_EFFORT || 'low';
const OPENAI_KEY = process.env.OPENAI_API_KEY || '';
const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY || '';
const VOICES = {
  caller: process.env.ELEVENLABS_VOICE_CALLER || 'EXAVITQu4vr4xnSDxMaL',   // Sarah
  agent: process.env.ELEVENLABS_VOICE_AGENT || '21m00Tcm4TlvDq8ikWAM'      // Rachel
};
const TTS_MODEL = process.env.ELEVENLABS_MODEL || 'eleven_flash_v2_5';
const BUILD = { commit: String(process.env.RENDER_GIT_COMMIT || process.env.RAILWAY_GIT_COMMIT_SHA || process.env.GIT_COMMIT || '').slice(0, 7) || 'local', started: new Date().toISOString() };
const EFFORTS = new Set(['none', 'low', 'medium', 'high', 'xhigh', 'max']);

const ttsCache = new Map();          // text|voice -> Buffer (scripted lines repeat)

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };

function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  const data = isBuf ? body : (typeof body === 'string' ? body : JSON.stringify(body));
  res.writeHead(status, Object.assign({ 'content-type': isBuf ? 'application/octet-stream' : (typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json'), 'cache-control': 'no-store' }, headers));
  res.end(data);
}

function readJson(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('Request too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(new Error('Invalid JSON body')); } });
    req.on('error', reject);
  });
}

function outputText(data) {
  if (data && typeof data.output_text === 'string' && data.output_text.trim()) return data.output_text;
  const parts = [];
  for (const item of (data && data.output) || []) {
    if (item.type !== 'message' || !Array.isArray(item.content)) continue;
    for (const c of item.content) {
      if ((c.type === 'output_text' || c.type === 'text') && c.text) parts.push(c.text);
    }
  }
  return parts.join('');
}

function refused(data) {
  for (const item of (data && data.output) || []) {
    if (item.type !== 'message' || !Array.isArray(item.content)) continue;
    if (item.content.some((c) => c.type === 'refusal')) return true;
  }
  return false;
}

/* Calls the Responses API and returns { ok, json, model } or { ok: false, status, error }. */
async function callOpenAI({ instructions, input, format, maxTokens, effort }) {
  const chosenEffort = EFFORTS.has(effort) ? effort : (EFFORTS.has(DEFAULT_EFFORT) ? DEFAULT_EFFORT : 'low');
  const maxOut = Math.min(Math.max(Number(maxTokens) || 8000, 1024), 16000);
  try {
    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { authorization: `Bearer ${OPENAI_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, instructions, input, reasoning: { effort: chosenEffort }, max_output_tokens: maxOut, text: { format } })
    });
    const data = await r.json().catch(() => null);
    if (!r.ok) {
      const msg = data && data.error && data.error.message ? data.error.message : `OpenAI request failed (${r.status}).`;
      return { ok: false, status: r.status === 401 ? 503 : 502, error: msg };
    }
    if (refused(data)) return { ok: false, status: 422, error: 'OpenAI declined this request.' };
    if (data && data.status === 'incomplete') {
      const reason = data.incomplete_details && data.incomplete_details.reason;
      return { ok: false, status: 502, error: `OpenAI stopped early (${reason || 'incomplete'}).` };
    }
    const text = outputText(data);
    if (!text) return { ok: false, status: 502, error: 'OpenAI returned no text.' };
    try { return { ok: true, json: JSON.parse(text), model: (data && data.model) || MODEL }; }
    catch (e) { return { ok: false, status: 502, error: 'OpenAI returned something that was not JSON.' }; }
  } catch (e) {
    return { ok: false, status: 502, error: (e && e.message) || 'OpenAI request failed.' };
  }
}

async function handleLlm(req, res) {
  if (!OPENAI_KEY) return send(res, 503, { error: 'OpenAI is not configured on this server (OPENAI_API_KEY missing).' });
  const body = await readJson(req);
  const { system, user, schema, maxTokens, effort } = body;
  if (!system || !user || !schema) return send(res, 400, { error: 'system, user and schema are required' });
  const r = await callOpenAI({ instructions: system, input: user, format: { type: 'json_schema', name: 'phone_assist', strict: true, schema }, maxTokens, effort });
  if (!r.ok) return send(res, r.status, { error: r.error });
  return send(res, 200, { result: r.json, model: r.model });
}

/* ---------------- prompt files ---------------- */
const PROMPT_FILES = ['system_prompt', 'phone_assist', 'phone_assist_best_reply', 'chat'];

function readText(rel) {
  try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch (e) { return ''; }
}

/* Read from disk on every request so an edit only needs a page refresh. */
function loadPromptFiles() {
  const prompts = {};
  for (const name of PROMPT_FILES) prompts[name] = readText(`prompts/${name}.md`);
  let kb = [];
  try {
    kb = fs.readdirSync(path.join(ROOT, 'kb')).filter((f) => f.endsWith('.md')).sort().map((file) => ({ file, text: readText(`kb/${file}`) }));
  } catch (e) { kb = []; }
  return { prompts, tools: readText('tools.md'), kb };
}

async function handleTts(req, res) {
  if (!ELEVEN_KEY) return send(res, 503, { error: 'ElevenLabs is not configured on this server (ELEVENLABS_API_KEY missing).' });
  const body = await readJson(req, 20_000);
  const text = String(body.text || '').slice(0, 1000);
  const role = body.voice === 'agent' ? 'agent' : 'caller';
  if (!text.trim()) return send(res, 400, { error: 'text is required' });
  const key = `${role}|${text}`;
  if (ttsCache.has(key)) return send(res, 200, ttsCache.get(key), { 'content-type': 'audio/mpeg', 'cache-control': 'private, max-age=3600' });
  try {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICES[role]}?output_format=mp3_22050_32`, {
      method: 'POST',
      headers: { 'xi-api-key': ELEVEN_KEY, 'content-type': 'application/json', accept: 'audio/mpeg' },
      body: JSON.stringify({ text, model_id: TTS_MODEL, voice_settings: { stability: 0.5, similarity_boost: 0.75 } })
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      return send(res, r.status === 401 ? 503 : 502, { error: `ElevenLabs error ${r.status}: ${detail.slice(0, 200)}` });
    }
    const buf = Buffer.from(await r.arrayBuffer());
    if (ttsCache.size > 400) ttsCache.delete(ttsCache.keys().next().value);
    ttsCache.set(key, buf);
    return send(res, 200, buf, { 'content-type': 'audio/mpeg', 'cache-control': 'private, max-age=3600' });
  } catch (e) {
    return send(res, 502, { error: (e && e.message) || 'ElevenLabs request failed.' });
  }
}

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (urlPath === '/') urlPath = '/index.html';
  const file = path.normalize(path.join(ROOT, urlPath));
  if (!file.startsWith(ROOT) || /(^|\/)(server\.mjs|package(-lock)?\.json|\.git|node_modules|\.env)/.test(urlPath)) return send(res, 404, 'Not found');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not found');
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://x');
    if (pathname === '/api/config' && req.method === 'GET') return send(res, 200, { openai: !!OPENAI_KEY, model: OPENAI_KEY ? MODEL : null, elevenlabs: !!ELEVEN_KEY, build: BUILD });
    if ((pathname === '/api/llm' || pathname === '/api/claude') && req.method === 'POST') return await handleLlm(req, res);
    if (pathname === '/api/prompts' && req.method === 'GET') return send(res, 200, loadPromptFiles());
    if (pathname === '/api/tts' && req.method === 'POST') return await handleTts(req, res);
    if (pathname.startsWith('/api/')) return send(res, 404, { error: 'Unknown API route' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    return serveStatic(req, res);
  } catch (e) {
    return send(res, 500, { error: (e && e.message) || 'Server error' });
  }
});

server.listen(PORT, () => {
  console.log(`Phone Assist demo listening on http://localhost:${PORT}  openai=${OPENAI_KEY ? MODEL : 'off'} elevenlabs=${ELEVEN_KEY ? 'on' : 'off'}`);
});
