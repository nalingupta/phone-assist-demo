/* Phone Assist demo server.
   Serves the static demo and keeps the API keys on the server side:
     POST /api/claude   -> Claude Haiku 5.5 with structured JSON output
     POST /api/tts      -> ElevenLabs text to speech (audio/mpeg)
     GET  /api/config   -> which services are configured
   Environment: ANTHROPIC_API_KEY, ELEVENLABS_API_KEY, optional CLAUDE_MODEL,
   ELEVENLABS_VOICE_CALLER, ELEVENLABS_VOICE_AGENT, PORT. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8080);
const MODEL = process.env.CLAUDE_MODEL || 'claude-haiku-5-5';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY || '';
const VOICES = {
  caller: process.env.ELEVENLABS_VOICE_CALLER || 'EXAVITQu4vr4xnSDxMaL',   // Sarah
  agent: process.env.ELEVENLABS_VOICE_AGENT || '21m00Tcm4TlvDq8ikWAM'      // Rachel
};
const TTS_MODEL = process.env.ELEVENLABS_MODEL || 'eleven_flash_v2_5';
const BUILD = { commit: String(process.env.RENDER_GIT_COMMIT || process.env.RAILWAY_GIT_COMMIT_SHA || process.env.GIT_COMMIT || '').slice(0, 7) || 'local', started: new Date().toISOString() };

const anthropic = ANTHROPIC_KEY ? new Anthropic({ apiKey: ANTHROPIC_KEY }) : null;
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

async function handleClaude(req, res) {
  if (!anthropic) return send(res, 503, { error: 'Claude is not configured on this server (ANTHROPIC_API_KEY missing).' });
  const body = await readJson(req);
  const { system, user, schema, maxTokens } = body;
  if (!system || !user || !schema) return send(res, 400, { error: 'system, user and schema are required' });
  try {
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: Math.min(Number(maxTokens) || 8000, 16000),
      system,
      messages: [{ role: 'user', content: user }],
      output_config: { effort: 'low', format: { type: 'json_schema', schema } }
    });
    if (msg.stop_reason === 'refusal') return send(res, 422, { error: 'Claude declined this request.' });
    const block = msg.content.find((b) => b.type === 'text');
    if (!block || !block.text) return send(res, 502, { error: 'Claude returned no text.' });
    let parsed;
    try { parsed = JSON.parse(block.text); } catch (e) { return send(res, 502, { error: 'Claude returned something that was not JSON.' }); }
    return send(res, 200, { result: parsed, model: msg.model });
  } catch (e) {
    const status = e && e.status ? e.status : 502;
    return send(res, status, { error: (e && e.message) || 'Claude request failed.' });
  }
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
    if (pathname === '/api/config' && req.method === 'GET') return send(res, 200, { claude: !!anthropic, model: anthropic ? MODEL : null, elevenlabs: !!ELEVEN_KEY, build: BUILD });
    if (pathname === '/api/claude' && req.method === 'POST') return await handleClaude(req, res);
    if (pathname === '/api/tts' && req.method === 'POST') return await handleTts(req, res);
    if (pathname.startsWith('/api/')) return send(res, 404, { error: 'Unknown API route' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    return serveStatic(req, res);
  } catch (e) {
    return send(res, 500, { error: (e && e.message) || 'Server error' });
  }
});

server.listen(PORT, () => {
  console.log(`Phone Assist demo listening on http://localhost:${PORT}  claude=${anthropic ? MODEL : 'off'} elevenlabs=${ELEVEN_KEY ? 'on' : 'off'}`);
});
