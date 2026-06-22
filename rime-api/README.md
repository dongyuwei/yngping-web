# rime-api

CLI and HTTP API wrapper around `librime` compiled to WebAssembly
(`wasm/rime_console.wasm`). Input pinyin, get 汉字.

## Files

| File | Purpose |
|------|---------|
| `rime.js` | Core wrapper module — loads the wasm glue, exposes `Rime.create()`, `translate()`, `candidates()` |
| `cli.js` | Command-line interface |
| `server.js` | HTTP API server |

## Quick start

```bash
# CLI — translate a single pinyin string
node rime-api/cli.js nihao
# → 你好

# Translate via stdin
echo "nihao shijie" | node rime-api/cli.js
# → 你好世界

# List candidates instead of auto-committing
node rime-api/cli.js --candidates nihao
# 0: 你好
# 1: 妳好
# 2: 逆号
# ...

# Pick the second candidate (0-based index)
node rime-api/cli.js --index 1 nihao
# → 妳好

# Use the Fuzhou dialect schema instead of Mandarin pinyin
node rime-api/cli.js --schema Fuzhou nihao

# HTTP server
PORT=3000 node rime-api/server.js &
curl 'http://localhost:3000/translate?pinyin=nihao'
# → {"pinyin":"nihao","index":0,"text":"你好"}

curl 'http://localhost:3000/candidates?pinyin=nihao'
# → {"pinyin":"nihao","input":"nihao","candidates":[{"text":"你好","comment":""},...]}

# POST with JSON body
curl -X POST http://localhost:3000/translate \
  -H 'Content-Type: application/json' \
  -d '{"pinyin":"nihao","index":1}'
# → {"pinyin":"nihao","index":1,"text":"妳好"}

# Pinyin → 汉字 → English via Ollama (OpenAI-compatible /v1/chat/completions)
OLLAMA_BASE_URL=http://10.144.209.129:11434 \
OLLAMA_MODEL=huihui_ai/hy-mt1.5-abliterated:1.8b \
PORT=3000 node rime-api/server.js &
curl 'http://localhost:3000/translate?pinyin=wozhunbeizhezhouerqingjia&toEnglish=1'
# → {"pinyin":"wozhunbeizhezhouerqingjia","index":0,
#    "text":"我准备这周二请假",
#    "english":"I'm planning to take leave this Tuesday."}
```

## Programmatic usage

```js
const Rime = require('./rime-api/rime');

(async () => {
  const rime = await Rime.create({ schema: 'luna_pinyin' });

  // Translate — commits the first candidate and returns the text
  const { text } = await rime.translate('nihao');
  console.log(text); // 你好

  // Pick a specific candidate (0-based)
  const { text: text2 } = await rime.translate('nihao', { index: 1 });
  console.log(text2); // 妳好

  // List candidates without committing
  const { candidates } = await rime.candidates('nihao');
  for (const c of candidates) {
    console.log(c.text, c.comment);
  }

  rime.close();
})();
```

## API

### `Rime.create(options)` → `Promise<Rime>`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `schema` | `string` | `luna_pinyin` | Rime schema id. Bundled schemas: `luna_pinyin`, `pinyin`, `Fuzhou` |
| `wasmDir` | `string` | `../wasm` | Directory containing `rime_console.{js,wasm,data}` |
| `verbose` | `boolean` | `false` | Print rime engine logs to stderr |

### `rime.translate(pinyin, options)` → `Promise<{text: string}>`

Sends pinyin to the engine, commits the candidate at `options.index`
(0-based, default 0) and returns the committed text.

Multi-word input with spaces is supported — each space commits the
current composition segment:

```js
await rime.translate('nihao shijie'); // → { text: '你好世界' }
```

### `rime.candidates(pinyin)` → `Promise<Result>`

Returns the candidate list without committing.

```js
{
  input: 'nihao',
  candidates: [
    { text: '你好', comment: '' },
    { text: '妳好', comment: '' },
    ...
  ],
  page: 0,
  isLastPage: true,
  highlightIndex: 0
}
```

### `rime.close()`

Releases the wasm module and cleans up globals.

## HTTP endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Service info |
| `GET` | `/health` | Health check (includes `ollama` availability) |
| `GET` | `/translate?pinyin=<pinyin>&index=<n>&toEnglish=1` | Translate; optionally translate 汉字 → English via Ollama |
| `POST` | `/translate` | Body: `{"pinyin":"...","index":0,"toEnglish":true}` |
| `GET` | `/candidates?pinyin=<pinyin>` | List candidates for pinyin |
| `POST` | `/candidates` | Body: `{"pinyin":"..."}` |

`toEnglish=1` (or `true`/`yes`) adds an `english` field to the response
with the English translation. If Ollama is unreachable, `english` is
`null` and `englishError` describes the failure; the 汉字 `text` is
still returned. If Ollama is not configured at all, the server returns
`503`.

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `RIME_SCHEMA` | `luna_pinyin` | Default schema |
| `RIME_WASM_DIR` | `../wasm` | Wasm directory |
| `RIME_VERBOSE` | `0` | Set to `1` for engine logs |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama base URL (OpenAI-compatible `/v1/chat/completions`) |
| `OLLAMA_MODEL` | `huihui_ai/hy-mt1.5-abliterated:1.8b` | Ollama chat model |
| `OLLAMA_SYSTEM_PROMPT` | `你是一个专业的翻译助手` | System prompt for translation |
| `OLLAMA_TEMPERATURE` | `0.7` | Sampling temperature |

## How it works

The wrapper loads `rime_console.js` (Emscripten glue) in a Node.js
`Function` sandbox, providing shims for `window`, `document`, and
`XMLHttpRequest` so the glue's data-file preloader reads
`rime_console.data` from disk. The wasm binary is passed directly via
`Module.wasmBinary`.

Schema selection is done by writing a `default.custom.yaml` patch to
the in-memory filesystem before `Module.init()` deploys the engine.
The engine processes key-press bytes via `Module.input()` and reports
results through the `window.rime_callback` callback.

When `toEnglish` is requested on `/translate`, the committed 汉字 text
is forwarded to an Ollama server (OpenAI-compatible
`/v1/chat/completions` endpoint) with a translation system prompt; the
returned English string is added to the response as `english`.

## Notes

- The engine maintains a user dictionary in memory — repeated
  translations may reorder candidates based on usage frequency.
- Only the first page of candidates (typically 5) is returned by
  `candidates()`.

## Performance

The librime engine has a heavy startup cost (wasm instantiation +
dictionary deployment, ~2.5–3s). How that cost is paid differs sharply
between the CLI and the HTTP/programmatic API:

| Mode | Per-call latency | Why |
|------|------------------|-----|
| `cli.js` (one-shot) | ~3s | Spins up Node, loads wasm, runs `Module.init()`, translates one input, exits — full startup every time |
| `server.js` (warm request) | ~10–15ms | Startup paid once at boot; each request only feeds keys to the running engine |
| Programmatic `Rime.create()` | ~3s first call, ~10ms subsequent | Same as server: one init, many `translate()` calls |

Benchmark on this machine (Apple Silicon, Node 24):

```
# CLI — 3 separate invocations
node rime-api/cli.js nihao          3.03s total
node rime-api/cli.js nihao          3.01s total
node rime-api/cli.js nihao          2.94s total

# HTTP server (warm) — 3 requests against a running server
curl localhost:3000/translate?pinyin=nihao   0.05s
curl localhost:3000/translate?pinyin=nihao   0.01s
curl localhost:3000/translate?pinyin=nihao   0.01s
```

~250× faster when the engine stays warm. For any non-trivial workload
(more than a couple of lookups), prefer:

1. **The HTTP server** for service-style or cross-process usage, or
2. **The programmatic API** to batch many lookups in one Node process.

```js
// Batch example — one startup, many translations
const rime = await Rime.create();
for (const p of ['nihao', 'shijie', 'zhongguo']) {
  console.log(p, (await rime.translate(p)).text);
}
rime.close();
```
