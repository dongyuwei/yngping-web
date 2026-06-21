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

async function handleRequest(rime, req, res) {
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
      endpoints: {
        'GET /translate?pinyin=<pinyin>&index=<n>': 'Translate pinyin to 汉字',
        'POST /translate': 'Body: {"pinyin":"...","index":0}',
        'GET /candidates?pinyin=<pinyin>': 'List candidates for pinyin',
        'POST /candidates': 'Body: {"pinyin":"..."}',
        'GET /health': 'Health check',
      },
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/health') {
    sendJSON(res, 200, { ok: true, schema: rime.schema });
    return;
  }

  let pinyin;
  let index = 0;

  if (req.method === 'GET' && (pathname === '/translate' || pathname === '/candidates')) {
    pinyin = query.pinyin;
    if (query.index != null) index = parseInt(query.index, 10) || 0;
  } else if (req.method === 'POST' && (pathname === '/translate' || pathname === '/candidates')) {
    const raw = await readBody(req);
    let body;
    try { body = JSON.parse(raw); } catch (_) {
      sendJSON(res, 400, { error: 'invalid JSON body' });
      return;
    }
    pinyin = body.pinyin;
    if (body.index != null) index = body.index;
  } else {
    sendJSON(res, 404, { error: 'not found', path: pathname });
    return;
  }

  if (!pinyin || typeof pinyin !== 'string') {
    sendJSON(res, 400, { error: 'pinyin is required' });
    return;
  }

  try {
    if (pathname === '/translate') {
      const result = await rime.translate(pinyin, { index });
      sendJSON(res, 200, { pinyin, index, text: result.text });
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

  process.stderr.write(`[rime-api] initialising engine (schema=${schema || 'luna_pinyin'})...\n`);
  const rime = await Rime.create({ schema, wasmDir, verbose });
  process.stderr.write(`[rime-api] engine ready. listening on http://0.0.0.0:${port}\n`);

  const server = http.createServer((req, res) => {
    handleRequest(rime, req, res).catch((e) => {
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
