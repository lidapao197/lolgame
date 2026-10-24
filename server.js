/* 本地开发服务器：node server.js（或 PORT=8080 node server.js）
   行为与 worker.js 一致：/api 代理腾讯 LPL 数据（补 CORS 头），其余返回 public/ 静态文件。
   只用 Node 内置模块，无需安装依赖；需要 Node 18+（内置 fetch）。 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");

/* 与 worker.js 相同的上游限制与请求头 */
const ALLOWED_HOSTS = ["lpl.qq.com"];
const UPSTREAM_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Referer": "https://lpl.qq.com/",
  "Accept": "*/*"
};
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Max-Age": "86400"
};

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2"
};

function json(res, obj, status) {
  res.writeHead(status, Object.assign({ "content-type": "application/json; charset=utf-8" }, CORS));
  res.end(JSON.stringify(obj));
}

/* /api 代理：逻辑与 worker.js 保持一致 */
async function handleApi(req, res, url) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    return res.end();
  }
  if (req.method !== "GET") return json(res, { error: "method not allowed" }, 405);

  const target = url.searchParams.get("u") || "";
  let host = "";
  try { host = new URL(target).host; } catch (e) { return json(res, { error: "invalid url" }, 400); }
  if (ALLOWED_HOSTS.indexOf(host) === -1) return json(res, { error: "host not allowed: " + host }, 403);

  let upstream;
  try {
    upstream = await fetch(target, { headers: UPSTREAM_HEADERS, signal: AbortSignal.timeout(15000) });
  } catch (e) {
    return json(res, { error: "upstream error: " + ((e && e.message) || "unknown") }, 502);
  }

  const body = await upstream.text();
  res.writeHead(upstream.status, Object.assign({
    "content-type": upstream.headers.get("content-type") || "text/plain; charset=utf-8",
    "cache-control": "public, max-age=60"
  }, CORS));
  res.end(body);
}

/* 静态文件：只允许 public/ 目录内的路径 */
function serveStatic(res, pathname) {
  let filePath = path.normalize(path.join(PUBLIC_DIR, pathname === "/" ? "index.html" : pathname));
  if (filePath !== PUBLIC_DIR && filePath.indexOf(PUBLIC_DIR + path.sep) !== 0) {
    return json(res, { error: "forbidden" }, 403);
  }

  fs.stat(filePath, (err, stat) => {
    if (!err && stat.isDirectory()) filePath = path.join(filePath, "index.html");
    fs.readFile(filePath, (err2, data) => {
      if (err2) return json(res, { error: "not found" }, 404);
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { "content-type": MIME[ext] || "application/octet-stream" });
      res.end(data);
    });
  });
}

if (typeof fetch !== "function") {
  console.error("需要 Node 18+（内置 fetch），当前版本：" + process.version);
  process.exit(1);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/api") {
    handleApi(req, res, url).catch((e) => json(res, { error: (e && e.message) || "unknown" }, 500));
  } else {
    serveStatic(res, url.pathname);
  }
});

/* 端口被占用（如上一个服务忘关）时自动向后换空闲端口，最多试 10 个，其余错误退出 */
let curPort = PORT;
server.on("error", (e) => {
  if (e && e.code === "EADDRINUSE" && curPort - PORT < 10) {
    curPort++;
    console.log("端口 " + (curPort - 1) + " 已被占用，自动改用 " + curPort);
    server.listen(curPort);
    return;
  }
  console.error("服务启动失败：" + ((e && e.message) || "未知错误"));
  process.exit(1);
});

server.listen(PORT, () => {
  console.log("============本地服务已启动：");
  console.log("http://localhost:" + curPort);
  console.log("============按 Ctrl+C 停止");
});
