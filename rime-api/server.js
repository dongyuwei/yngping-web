#!/usr/bin/env node
'use strict';

const http = require('http');
const url = require('url');
const Rime = require('./rime');

function sendJSON(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(json);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function jsonRequest(method, targetUrl, headers, bodyObj) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(targetUrl); } catch (e) { return reject(new Error('bad url: ' + targetUrl)); }
    const body = bodyObj ? JSON.stringify(bodyObj) : null;
    const opts = {
      method,
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      headers: { ...headers },
    };
    if (body != null) {
      opts.headers['Content-Type'] = 'application/json';
      opts.headers['Content-Length'] = Buffer.byteLength(body);
    }
    const req = http.request(opts, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`HTTP ${res.statusCode} from ${targetUrl}: ${data.slice(0, 200)}`));
        }
        try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('invalid JSON from ' + targetUrl)); }
      });
    });
    req.on('error', reject);
    if (body != null) req.write(body);
    req.end();
  });
}

async function translateToEnglish(text, ollamaCfg) {
  const payload = {
    model: ollamaCfg.model,
    messages: [
      { role: 'system', content: ollamaCfg.systemPrompt },
      { role: 'user', content: `将以下中文翻译成英文：${text}` },
    ],
    temperature: ollamaCfg.temperature,
    stream: false,
  };
  const endpoint = ollamaCfg.baseUrl.replace(/\/$/, '') + '/v1/chat/completions';
  const resp = await jsonRequest('POST', endpoint, {}, payload);
  const out = resp && resp.choices && resp.choices[0] && resp.choices[0].message && resp.choices[0].message.content;
  if (!out) throw new Error('ollama returned no content');
  return String(out).trim();
}

async function handleRequest(rime, ollamaCfg, req, res) {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;
  const query = parsed.query || {};

  if (req.method === 'OPTIONS') {
    sendJSON(res, 204, {});
    return;
  }

  if (req.method === 'GET' && pathname === '/') {
    sendJSON(res, 200, {
      service: 'rime-api',
      schema: rime.schema,
      ollama: ollamaCfg.enabled ? { baseUrl: ollamaCfg.baseUrl, model: ollamaCfg.model } : null,
      endpoints: {
        'GET /translate?pinyin=<pinyin>&index=<n>&toEnglish=1': 'Translate pinyin to 汉字 (optionally to English via Ollama)',
        'POST /translate': 'Body: {"pinyin":"...","index":0,"toEnglish":true}',
        'GET /candidates?pinyin=<pinyin>': 'List candidates for pinyin',
        'POST /candidates': 'Body: {"pinyin":"..."}',
        'GET /health': 'Health check',
      },
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/health') {
    sendJSON(res, 200, { ok: true, schema: rime.schema, ollama: ollamaCfg.enabled });
    return;
  }

  let pinyin;
  let index = 0;
  let toEnglish = false;

  if (req.method === 'GET' && (pathname === '/translate' || pathname === '/candidates')) {
    pinyin = query.pinyin;
    if (query.index != null) index = parseInt(query.index, 10) || 0;
    if (query.toEnglish != null) toEnglish = /^(true|1|yes)$/i.test(String(query.toEnglish));
  } else if (req.method === 'POST' && (pathname === '/translate' || pathname === '/candidates')) {
    const raw = await readBody(req);
    let body;
    try { body = JSON.parse(raw); } catch (_) {
      sendJSON(res, 400, { error: 'invalid JSON body' });
      return;
    }
    pinyin = body.pinyin;
    if (body.index != null) index = body.index;
    if (body.toEnglish != null) toEnglish = !!body.toEnglish;
  } else {
    sendJSON(res, 404, { error: 'not found', path: pathname });
    return;
  }

  if (!pinyin || typeof pinyin !== 'string') {
    sendJSON(res, 400, { error: 'pinyin is required' });
    return;
  }

  if (toEnglish && !ollamaCfg.enabled) {
    sendJSON(res, 503, { error: 'toEnglish requested but Ollama is not configured (set OLLAMA_BASE_URL / OLLAMA_MODEL)' });
    return;
  }

  try {
    if (pathname === '/translate') {
      const result = await rime.translate(pinyin, { index });
      const out = { pinyin, index, text: result.text };
      if (toEnglish) {
        try {
          out.english = await translateToEnglish(result.text, ollamaCfg);
        } catch (e) {
          out.english = null;
          out.englishError = (e && e.message) || String(e);
        }
      }
      sendJSON(res, 200, out);
    } else {
      const result = await rime.candidates(pinyin);
      sendJSON(res, 200, { pinyin, ...result });
    }
  } catch (e) {
    sendJSON(res, 500, { error: (e && e.message) || String(e) });
  }
}

async function main() {
  const port = parseInt(process.env.PORT || '3000', 10);
  const schema = process.env.RIME_SCHEMA;
  const wasmDir = process.env.RIME_WASM_DIR;
  const verbose = process.env.RIME_VERBOSE === '1';

  const ollamaCfg = {
    baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
    model: process.env.OLLAMA_MODEL || 'huihui_ai/hy-mt1.5-abliterated:1.8b',
    systemPrompt: process.env.OLLAMA_SYSTEM_PROMPT || '你是一个专业的翻译助手',
    temperature: parseFloat(process.env.OLLAMA_TEMPERATURE || '0.7'),
  };
  ollamaCfg.enabled = !!(ollamaCfg.baseUrl && ollamaCfg.model);

  process.stderr.write(`[rime-api] initialising engine (schema=${schema || 'luna_pinyin'})...\n`);
  const rime = await Rime.create({ schema, wasmDir, verbose });
  process.stderr.write(`[rime-api] engine ready. listening on http://0.0.0.0:${port}\n`);
  if (ollamaCfg.enabled) {
    process.stderr.write(`[rime-api] ollama enabled: ${ollamaCfg.baseUrl} (model=${ollamaCfg.model})\n`);
  } else {
    process.stderr.write(`[rime-api] ollama disabled (set OLLAMA_BASE_URL / OLLAMA_MODEL to enable toEnglish)\n`);
  }

  const server = http.createServer((req, res) => {
    handleRequest(rime, ollamaCfg, req, res).catch((e) => {
      sendJSON(res, 500, { error: (e && e.message) || String(e) });
    });
  });

  server.listen(port, '0.0.0.0');

  const shutdown = () => {
    process.stderr.write('\n[rime-api] shutting down...\n');
    rime.close();
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  process.stderr.write('[rime-api] fatal: ' + (e && e.stack || e) + '\n');
  process.exit(1);
});
