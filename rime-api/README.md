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
| `GET` | `/health` | Health check |
| `GET` | `/translate?pinyin=<pinyin>&index=<n>` | Translate |
| `POST` | `/translate` | Body: `{"pinyin":"...","index":0}` |
| `GET` | `/candidates?pinyin=<pinyin>` | List candidates |
| `POST` | `/candidates` | Body: `{"pinyin":"..."}` |

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `RIME_SCHEMA` | `luna_pinyin` | Default schema |
| `RIME_WASM_DIR` | `../wasm` | Wasm directory |
| `RIME_VERBOSE` | `0` | Set to `1` for engine logs |

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

## Notes

- The engine maintains a user dictionary in memory — repeated
  translations may reorder candidates based on usage frequency.
- The CLI starts a fresh engine each invocation (~1s startup). For
  bulk processing, use the HTTP server or the programmatic API.
- Only the first page of candidates (typically 5) is returned by
  `candidates()`.
