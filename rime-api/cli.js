#!/usr/bin/env node
'use strict';

const Rime = require('./rime');

function parseArgs(argv) {
  const opts = {
    schema: process.env.RIME_SCHEMA,
    wasmDir: process.env.RIME_WASM_DIR,
    verbose: false,
    index: 0,
    candidates: false,
    help: false,
    inputs: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') opts.help = true;
    else if (a === '--verbose' || a === '-v') opts.verbose = true;
    else if (a === '--candidates' || a === '-c') opts.candidates = true;
    else if (a === '--schema') opts.schema = argv[++i];
    else if (a.startsWith('--schema=')) opts.schema = a.slice('--schema='.length);
    else if (a === '--wasm-dir') opts.wasmDir = argv[++i];
    else if (a.startsWith('--wasm-dir=')) opts.wasmDir = a.slice('--wasm-dir='.length);
    else if (a === '--index' || a === '-n') opts.index = parseInt(argv[++i], 10) || 0;
    else if (a.startsWith('--index=')) opts.index = parseInt(a.slice('--index='.length), 10) || 0;
    else if (a.startsWith('-')) { opts.help = true; }
    else opts.inputs.push(a);
  }
  return opts;
}

function printHelp() {
  process.stdout.write(
`rime-cli — pinyin to 汉字 via librime wasm

USAGE
  node cli.js [OPTIONS] <pinyin>
  echo <pinyin> | node cli.js [OPTIONS]

OPTIONS
  --schema <id>       Rime schema id (default: luna_pinyin)
  --index <n>         Select candidate n (0-based, default: 0)
  --candidates, -c    Print all candidates instead of committing
  --wasm-dir <path>   Path to directory with rime_console.{js,wasm,data}
  --verbose, -v       Print rime engine logs to stderr
  -h, --help          Show this help

EXAMPLES
  node cli.js nihao                  # → 你好
  node cli.js --index 1 nihao        # → 妳好
  node cli.js --candidates nihao     # → list candidates
  echo "nihao shijie" | node cli.js  # → 你好世界
  node cli.js --schema Fuzhou nihao  # → Fuzhou dialect output

ENV
  RIME_SCHEMA         Default schema id
  RIME_WASM_DIR       Default wasm directory
`);
}

async function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    const handle = () => {
      let chunk;
      while ((chunk = process.stdin.read()) !== null) {
        data += chunk;
      }
    };
    process.stdin.setEncoding('utf8');
    process.stdin.on('readable', handle);
    process.stdin.on('end', () => resolve(data.trim()));
    process.stdin.on('error', () => resolve(''));
    setTimeout(() => {
      if (data === '' && process.stdin.isTTY) resolve('');
    }, 100);
  });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  let input = opts.inputs.join(' ');
  if (!input) {
    const stdin = await readStdin();
    input = stdin;
  }
  if (!input) {
    process.stderr.write('error: no input. See --help.\n');
    process.exit(2);
  }

  const rime = await Rime.create({
    schema: opts.schema,
    wasmDir: opts.wasmDir,
    verbose: opts.verbose,
  });

  try {
    if (opts.candidates) {
      const result = await rime.candidates(input);
      for (let i = 0; i < result.candidates.length; i++) {
        const c = result.candidates[i];
        const comment = c.comment ? '  ' + c.comment : '';
        process.stdout.write(`${i}: ${c.text}${comment}\n`);
      }
    } else {
      const result = await rime.translate(input, { index: opts.index });
      process.stdout.write(result.text + '\n');
    }
  } finally {
    rime.close();
  }
}

main().catch((e) => {
  process.stderr.write('error: ' + (e && e.stack || e) + '\n');
  process.exit(1);
});
