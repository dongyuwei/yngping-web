# yngping-web
榕拼輸入法 網頁版

基于 librime，用enscripten 编译成 wasm：
  - librime wasm: https://github.com/ztl8702/librime/commits/wasm
  - 编译成品 https://github.com/ztl8702/yngping-web/tree/master/wasm

前端UI：https://github.com/ztl8702/yngping-web/tree/master/src

## rime-api

基于 `wasm/rime_console.wasm` 封装的 CLI / HTTP API，可输入拼音输出汉字：

```bash
node rime-api/cli.js nihao                  # → 你好
node rime-api/cli.js --index 1 nihao        # → 妳好
node rime-api/cli.js --candidates nihao     # → 列出候选词
echo "nihao shijie" | node rime-api/cli.js  # → 你好世界

PORT=3000 node rime-api/server.js &
curl 'http://localhost:3000/translate?pinyin=nihao'   # → {"text":"你好"}

# 拼音 → 汉字 → 英文（结合本地 Ollama 翻译服务）
OLLAMA_BASE_URL=http://10.144.209.129:11434 node rime-api/server.js &
curl 'http://localhost:3000/translate?pinyin=wozhunbeizhezhouerqingjia&toEnglish=1'
# → {"text":"我准备这周二请假","english":"I'm planning to take leave this Tuesday."}
```

详见 [rime-api/README.md](rime-api/README.md)。

> **性能提示**: CLI 每次调用都要重启引擎（加载 wasm + 部署词库，约 3s）；
> HTTP server / 编程式 API 只在启动时付一次代价，之后每次请求约 10ms。
> 批量查询请用 server 或 `Rime.create()`，详见
> [rime-api/README.md#performance](rime-api/README.md#performance)。
