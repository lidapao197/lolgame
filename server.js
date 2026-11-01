/* 本地开发服务器：node server.js（或 PORT=8080 node server.js）
   行为与 worker.js 一致：/api 代理腾讯 LPL 数据（补 CORS 头）、/poster 聚合影视海报，
   其余返回 public/ 静态文件。
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
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
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
  res.writeHead(status || 200, Object.assign({ "content-type": "application/json; charset=utf-8" }, CORS));
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

/* 弹幕源清单：读写 public/data/danmaku.json（部署到纯静态/Worker 时只能读） */
const DATA_DIR = path.join(PUBLIC_DIR, "data");
const DM_FILE = path.join(DATA_DIR, "danmaku.json");
const DM_LIMIT = 200;

function readDanmakuFile() {
  try {
    /* 去掉 BOM：手工用编辑器/记事本存过的文件带 BOM，JSON.parse 会直接抛错，
       失败后按空列表处理会让下一次写入把旧数据全冲掉 */
    const j = JSON.parse(fs.readFileSync(DM_FILE, "utf8").replace(/^\uFEFF/, ""));
    const items = Array.isArray(j) ? j : (j && Array.isArray(j.items) ? j.items : []);
    return items
      .filter((it) => it && it.name)
      .map((it) => {
        const rec = { name: String(it.name), url: String(it.url || "") };
        /* ok 记录上次探测的可用性，未测过则不带该字段 */
        if (typeof it.ok === "boolean") rec.ok = it.ok;
        return rec;
      });
  } catch (e) {
    return [];
  }
}

function writeDanmakuFile(items) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DM_FILE, JSON.stringify({ items: items }, null, 2) + "\n", "utf8");
}

/* 读取请求体，超过 limit 字节直接断开，避免大包占内存 */
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > limit) { reject(new Error("body too large")); req.destroy(); }
    });
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

async function handleDanmaku(req, res, url) {
  if (req.method === "OPTIONS") { res.writeHead(204, CORS); return res.end(); }

  if (req.method === "GET") {
    res.writeHead(200, Object.assign({
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }, CORS));
    return res.end(JSON.stringify({ ok: true, items: readDanmakuFile() }));
  }

  /* 删除：按 name + url 精确匹配，找不到就原样返回，不算失败 */
  if (req.method === "DELETE") {
    const name = (url.searchParams.get("name") || "").trim();
    const target = (url.searchParams.get("url") || "").trim();
    if (!name || !target) return json(res, { ok: false, error: "name and url required" }, 400);

    const items = readDanmakuFile();
    const idx = items.findIndex((it) => it.name === name && it.url === target);
    if (idx >= 0) {
      items.splice(idx, 1);
      try {
        writeDanmakuFile(items);
      } catch (e) {
        return json(res, { ok: false, error: "write failed: " + ((e && e.message) || "unknown") }, 500);
      }
    }
    return json(res, { ok: true, items: items });
  }

  /* POST / PATCH 都要 JSON body */
  if (req.method !== "POST" && req.method !== "PATCH") {
    return json(res, { ok: false, error: "method not allowed" }, 405);
  }

  let body;
  try {
    body = JSON.parse(await readBody(req, 16384));
  } catch (e) {
    return json(res, { ok: false, error: "invalid json" }, 400);
  }

  /* PATCH /danmaku { items: [{ name, url, ok }] }：回写探测结果，供下次打开直接显示灯色 */
  if (req.method === "PATCH") {
    const updates = Array.isArray(body && body.items) ? body.items : [];
    if (!updates.length) return json(res, { ok: false, error: "items required" }, 400);

    const items = readDanmakuFile();
    let changed = 0;
    updates.forEach((u) => {
      if (!u || typeof u.ok !== "boolean") return;
      const rec = items.find((it) => it.name === String(u.name || "").trim() && it.url === String(u.url || "").trim());
      if (rec && rec.ok !== u.ok) { rec.ok = u.ok; changed++; }
    });

    if (changed) {
      try {
        writeDanmakuFile(items);
      } catch (e) {
        return json(res, { ok: false, error: "write failed: " + ((e && e.message) || "unknown") }, 500);
      }
    }
    return json(res, { ok: true, items: items });
  }

  const name = String((body && body.name) || "").trim().slice(0, 60);
  const link = String((body && body.url) || "").trim().slice(0, 500);
  if (!name || !link) return json(res, { ok: false, error: "name and url required" }, 400);

  const items = readDanmakuFile();
  if (items.length >= DM_LIMIT) return json(res, { ok: false, error: "too many items" }, 400);
  const rec = { name: name, url: link };
  if (typeof (body && body.ok) === "boolean") rec.ok = body.ok;
  items.push(rec);

  try {
    writeDanmakuFile(items);
  } catch (e) {
    return json(res, { ok: false, error: "write failed: " + ((e && e.message) || "unknown") }, 500);
  }
  return json(res, { ok: true, items: items });
}

/* 影视海报聚合：与 worker.js 共用 poster.mjs（ESM，这里动态 import） */
let posterModule = null;
async function handlePoster(res, url) {
  try {
    if (!posterModule) posterModule = await import("./poster.mjs");
    const r = await posterModule.fetchPosters(
      url.searchParams.get("site"),
      url.searchParams.get("cat"),
      url.searchParams.get("page")
    );
    res.writeHead(r.ok ? 200 : 502, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=300"
    });
    res.end(JSON.stringify(r));
  } catch (e) {
    json(res, { ok: false, error: (e && e.message) || "poster error" }, 500);
  }
}

/* 静态文件：只允许 public/ 目录内的路径 */
function serveStatic(res, pathname) {  let filePath = path.normalize(path.join(PUBLIC_DIR, pathname === "/" ? "index.html" : pathname));
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
  } else if (url.pathname === "/poster") {
    handlePoster(res, url);
  } else if (url.pathname === "/danmaku") {
    handleDanmaku(req, res, url).catch((e) => json(res, { ok: false, error: (e && e.message) || "unknown" }, 500));
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
