/* Cloudflare Worker：/api 代理腾讯 LPL 数据（补 CORS 头）、/poster 聚合影视海报，
   其余请求回落到静态资源 */

import { fetchPosters } from "./poster.mjs";

/* 只放行官方数据域名，避免被当成开放代理 */
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

function fail(msg, status) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: Object.assign({ "content-type": "application/json; charset=utf-8" }, CORS)
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    /* 影视海报：/poster?site=youku&cat=tv&page=1 */
    if (url.pathname === "/poster") {
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
      if (request.method !== "GET") return fail("method not allowed", 405);
      const r = await fetchPosters(url.searchParams.get("site"), url.searchParams.get("cat"), url.searchParams.get("page"));
      if (!r.ok) return fail(r.error || "fetch failed", 502);
      return new Response(JSON.stringify(r), {
        headers: Object.assign({
          "content-type": "application/json; charset=utf-8",
          "cache-control": "public, max-age=300"
        }, CORS)
      });
    }

    /* 弹幕源清单：Worker 无文件系统，只读 public/data/danmaku.json；
       写入仅本地 node server.js 支持，前端会退化为本地缓存 */
    if (url.pathname === "/danmaku") {
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
      if (request.method !== "GET") return fail("read-only: 请用本地 node server.js 写入", 501);
      let items = [];
      try {
        const r = await env.ASSETS.fetch(new URL("/data/danmaku.json", url).toString());
        const j = await r.json();
        items = Array.isArray(j) ? j : (j && Array.isArray(j.items) ? j.items : []);
      } catch (e) { /* 文件缺失按空列表处理 */ }
      return new Response(JSON.stringify({ ok: true, items: items }), {
        headers: Object.assign({
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store"
        }, CORS)
      });
    }

    /* 非 /api 请求直接返回静态文件 */
    if (url.pathname !== "/api") return env.ASSETS.fetch(request);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (request.method !== "GET") return fail("method not allowed", 405);

    const target = new URL(request.url).searchParams.get("u") || "";
    let host = "";
    try { host = new URL(target).host; } catch (e) { return fail("invalid url", 400); }
    if (ALLOWED_HOSTS.indexOf(host) === -1) return fail("host not allowed: " + host, 403);

    let upstream;
    try {
      upstream = await fetch(target, { headers: UPSTREAM_HEADERS, cf: { cacheTtl: 60 } });
    } catch (e) {
      return fail("upstream error: " + ((e && e.message) || "unknown"), 502);
    }

    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: Object.assign({
        "content-type": upstream.headers.get("content-type") || "text/plain; charset=utf-8",
        "cache-control": "public, max-age=60"
      }, CORS)
    });
  }
};
