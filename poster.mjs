/* 影视海报聚合：优酷 / 爱奇艺 / 腾讯视频 / 芒果TV
   四个平台接口形态各不相同（优酷要 MTOP 签名、腾讯要 POST + page_context 分页），
   在这里统一抹平成 { ok, items: [{ title, poster, url, corner, year }] }，
   由 worker.js（线上）与 server.js（本地）共用。 */

const UA_PC =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const UA_MOBILE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

/* 一行海报的条数 */
export const PAGE_SIZE = 20;
const TIMEOUT = 12000;

export const SITES = ["youku", "iqiyi", "tencent", "mango"];
export const CATS = ["tv", "movie", "variety", "anime"];

/* ---------- 通用请求 ---------- */
async function req(url, opt) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const res = await fetch(url, Object.assign({ signal: ctl.signal }, opt || {}));
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function getJson(url, headers) {
  const res = await req(url, { headers });
  return JSON.parse(await res.text());
}

async function postJson(url, body, headers) {
  const res = await req(url, { method: "POST", headers, body });
  return JSON.parse(await res.text());
}

const https = (u) => String(u || "").replace(/^http:\/\//i, "https://");
const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();
const clip = (s, n) => {
  const t = clean(s);
  return t.length > n ? t.slice(0, n) + "…" : t;
};

/* 演员字段：有的平台给数组，有的给 JSON 字符串，有的给空格/逗号分隔的串 */
function joinNames(v) {
  if (!v) return "";
  let arr = v;
  if (typeof v === "string") {
    const s = v.trim();
    if (s.charAt(0) === "[") {
      try { arr = JSON.parse(s); } catch (e) { arr = s.replace(/^\[|\]$/g, ""); }
    } else arr = s;
  }
  if (!Array.isArray(arr)) arr = String(arr).split(/[,，、\s]+/).filter(Boolean);
  return arr
    .map((x) => (typeof x === "string" ? x : (x && (x.name || x.cName || x.title)) || ""))
    .filter(Boolean)
    .slice(0, 10)
    .join(" / ");
}

/* 腾讯的角标是按位置编号的对象：{"1":{"info":{"text":"2026"}},"2":{"info":{"text":"上新","type":"1"}}}
   取带颜色那个（type=1）；没有就取第一个非纯年份的文案 */
function txBadge(v) {
  if (!v) return "";
  let o = v;
  if (typeof v === "string") { try { o = JSON.parse(v); } catch (e) { return ""; } }
  if (!o || typeof o !== "object") return "";
  const list = Array.isArray(o) ? o : Object.keys(o).map((k) => o[k]);
  const items = list.map((x) => (x && x.info) || x || {}).filter(Boolean);
  const colored = items.find((x) => String(x.type) === "1" && clean(x.text));
  if (colored) return clean(colored.text);
  return items.map((x) => clean(x.text)).find((x) => x && !/^\d{4}$/.test(x)) || "";
}

/* 腾讯的评分藏在 chnlist_search_label 的「评分 9.5」标签里 */
function txRating(v) {
  if (!v) return "";
  let arr = v;
  if (typeof v === "string") { try { arr = JSON.parse(v); } catch (e) { return ""; } }
  if (!Array.isArray(arr)) return "";
  const hit = arr.find((x) => x && /^评分/.test(String(x.label)));
  return hit ? clean(String(hit.label).replace(/^评分\s*/, "")) : "";
}

/* 统一日期：优先完整上映/上线日，取不到退回年份，都没有就空
   四个平台日期完整度不同——腾讯有 publish_date，爱奇艺有 period（20261020），
   芒果只有 year，优酷没有任何日期字段 */
function fmtDate(v) {
  const s = clean(v);
  if (!s || s === "0") return "";
  /* 20261020 -> 2026-10-20 */
  const m8 = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m8) return m8[1] + "-" + m8[2] + "-" + m8[3];
  /* 2026-10-23 / 2026/10/23 / 2026.10.23 */
  const md = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (md) {
    const p2 = (n) => ("0" + n).slice(-2);
    return md[1] + "-" + p2(md[2]) + "-" + p2(md[3]);
  }
  /* 只有年份 */
  if (/^(19|20)\d{2}$/.test(s)) return s;
  return "";
}

/* ==========================================================
   优酷：MTOP 签名（_m_h5_tk 令牌 + md5 签名）
   ========================================================== */
const YK_APP = "24679788";
const YK_API = "mtop.youku.columbus.home.query";
const YK_CAT = { tv: "电视剧", movie: "电影", variety: "综艺", anime: "动漫" };
const ykTok = { tk: "", ck: "", ts: 0 };
const ykPageCache = new Map();

/* md5：Workers 没有内置实现，这里自带一份 */
function md5(str) {
  const s = unescape(encodeURIComponent(String(str)));
  const n = s.length, w = [];
  for (let i = 0; i < n; i++) w[i >> 2] = (w[i >> 2] || 0) | (s.charCodeAt(i) << ((i % 4) * 8));
  w[n >> 2] = (w[n >> 2] || 0) | (0x80 << ((n % 4) * 8));
  const bits = n * 8;
  const total = (((n + 8) >> 6) + 1) * 16;
  while (w.length < total) w.push(0);
  w[total - 2] = bits & 0xffffffff;
  w[total - 1] = Math.floor(bits / 4294967296);
  const K = [], S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  for (let q = 0; q < 64; q++) K[q] = Math.floor(Math.abs(Math.sin(q + 1)) * 4294967296);
  let a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
  const add = (x, y) => (x + y) & 0xffffffff;
  const rol = (x, k) => (x << k) | (x >>> (32 - k));
  for (let off = 0; off < total; off += 16) {
    let oa = a, ob = b, oc = c, od = d;
    for (let i = 0; i < 64; i++) {
      let f, g;
      if (i < 16) { f = (b & c) | (~b & d); g = i; }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; }
      else { f = c ^ (b | ~d); g = (7 * i) % 16; }
      const tmp = d; d = c; c = b;
      b = add(b, rol(add(add(a, f), add(K[i], w[off + g] | 0)), S[(i >> 4) * 4 + (i % 4)]));
      a = tmp;
    }
    a = add(a, oa); b = add(b, ob); c = add(c, oc); d = add(d, od);
  }
  const hex = (x) => {
    let o = "";
    for (let k = 0; k < 4; k++) o += ("0" + ((x >>> (k * 8)) & 0xff).toString(16)).slice(-2);
    return o;
  };
  return hex(a) + hex(b) + hex(c) + hex(d);
}

function ykSysInfo() {
  return JSON.stringify({
    device: "pcweb", os: "pcweb", ver: "1.0.0.0", userAgent: UA_PC,
    guid: "1590141704165YXe", appPackageKey: "com.youku.pcweb", young: 0,
    brand: "", network: "", ouid: "", idfa: "", scale: "", operator: "",
    resolution: "", pid: "36370125020498", appkey: YK_APP, childGender: 0, disableUserRec: "0"
  });
}

/* 一次原始调用：顺手把新的 _m_h5_tk 令牌存下来给下次签名用 */
async function ykRaw(data) {
  const t = String(Date.now());
  const sign = md5(ykTok.tk + "&" + t + "&" + YK_APP + "&" + data);
  const url =
    "https://acs.youku.com/h5/" + YK_API + "/1.0/?jsv=2.6.1&appKey=" + YK_APP +
    "&t=" + t + "&sign=" + sign + "&api=" + YK_API + "&v=1.0&dataType=json&type=originaljson&data=" +
    encodeURIComponent(data);
  const res = await req(url, {
    headers: { "User-Agent": UA_PC, Referer: "https://www.youku.com/ku/webtv", Cookie: ykTok.ck }
  });
  let sc = "";
  try {
    const arr = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    sc = arr.length ? arr.join("|") : (res.headers.get("set-cookie") || "");
  } catch (e) { sc = res.headers.get("set-cookie") || ""; }
  const m1 = sc.match(/_m_h5_tk=([^;|,]+)/);
  const m2 = sc.match(/_m_h5_tk_enc=([^;|,]+)/);
  if (m1) {
    ykTok.tk = m1[1].split("_")[0];
    ykTok.ck = "_m_h5_tk=" + m1[1] + "; _m_h5_tk_enc=" + (m2 ? m2[1] : "");
    ykTok.ts = Date.now();
  }
  const txt = await res.text();
  try { return JSON.parse(txt); } catch (e) { return null; }
}

/* 令牌失效（返回 TOKEN_*）时重取一次 */
async function ykCall(data) {
  if (!ykTok.tk || Date.now() - ykTok.ts > 43200000) { try { await ykRaw(data); } catch (e) {} }
  let j = await ykRaw(data);
  if (j && j.ret && j.ret[0] && String(j.ret[0]).indexOf("TOKEN") >= 0) {
    try { await ykRaw(data); } catch (e) {}
    j = await ykRaw(data);
  }
  return j;
}

/* 在返回的组件树里捞出带标题 + 海报的条目 */
function ykCollect(o, out) {
  if (!o || typeof o !== "object") return;
  if (Array.isArray(o)) { for (const x of o) ykCollect(x, out); return; }
  const d = o.data;
  if (d && d.title && d.action && (d.img || d.hImg)) {
    const tags = (d.tags || []).map((x) => x && x.text && x.text.title).filter(Boolean);
    out.push({
      title: String(d.title),
      tags,
      img: d.img || d.hImg || "",
      desc: d.desc || "",
      update: (d.lbTexts && d.lbTexts[0] && d.lbTexts[0].title) || d.updateTips || ""
    });
  }
  for (const k in o) {
    if (k === "action" || k === "trackShow" || k === "report") continue;
    ykCollect(o[k], out);
  }
}

/* 深翻页用的 session 节点 */
function ykSession(o) {
  let res = null;
  (function walk(x) {
    if (res || !x || typeof x !== "object") return;
    if (x.session && typeof x.session === "object" && x.session.subIndex !== undefined && x.session.id) {
      res = x.session; return;
    }
    for (const k in x) walk(x[k]);
  })(o);
  return res;
}

function ykPack(cat, pageNo, session) {
  const inner = {
    utdid: "FE1oI9Z/92QCAWeOjJcxfUHN", gray: "0", pageNo: pageNo, debug: 0,
    bizKey: "kuflix_pc_home", appPackageKey: "com.youku.pcweb",
    showNodeList: 1, reqSubNode: 1, nodeKey: "ALL", ip: "127.0.0.1",
    bizContext: JSON.stringify({ filterParam: "type:" + YK_CAT[cat], category: YK_CAT[cat], optionRefresh: 1 })
  };
  if (session) {
    inner.reqSubNode = 0; inner.showNodeList = 0;
    inner.session = JSON.stringify(session);
  }
  return JSON.stringify({ ms_codes: "2019061000", params: JSON.stringify(inner), system_info: ykSysInfo() });
}

/* 优酷没有页码参数，靠 session 往后翻；走过的页都缓存下来 */
async function youku(cat, page) {
  const cacheKey = "yk:" + cat + ":" + page;
  const hit = ykPageCache.get(cacheKey);
  if (hit && Date.now() - hit.ts < 300000) return hit.items;

  let json = await ykCall(ykPack(cat, 1, null));
  let out = [];
  ykCollect(json, out);
  ykPageCache.set("yk:" + cat + ":1", { items: out, ts: Date.now() });

  let sess = ykSession(json);
  for (let p = 2; p <= page && sess; p++) {
    json = await ykCall(ykPack(cat, p, sess));
    out = [];
    ykCollect(json, out);
    if (!out.length) break;
    ykPageCache.set("yk:" + cat + ":" + p, { items: out, ts: Date.now() });
    sess = ykSession(json);
  }
  return out;
}

async function fetchYouku(cat, page) {
  const list = await youku(cat, page);
  const seen = new Set();
  const items = [];
  for (const it of list) {
    const t = clean(it.title);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    const update = clip(it.update, 24);
    /* 更新信息已经从 tags 里单拎出来了，note 里去掉它，避免弹层里重复 */
    const rest = it.tags.slice(1).filter((x) => clean(x) !== update);
    items.push({
      title: t,
      poster: https(it.img),
      url: "https://so.youku.com/search_video/q_" + encodeURIComponent(t),
      corner: clean(it.tags[0] || ""),
      note: clean(rest.join(" · ")),
      desc: clip(it.desc, 300),
      cast: "",
      update: update,
      rating: "",
      date: "",
      year: ""
    });
    if (items.length >= PAGE_SIZE) break;
  }
  return items;
}

/* ==========================================================
   爱奇艺：pub.m.iqiyi.com 公开列表接口
   ========================================================== */
const IQ_API = "https://pub.m.iqiyi.com/h5/main/recVideos/lib/";
const IQ_CH = { tv: 2, movie: 1, variety: 6, anime: 4 };

async function fetchIqiyi(cat, page) {
  const q = new URLSearchParams({
    page_id: String(page), mode: "11", channel_id: String(IQ_CH[cat]), ret_num: String(PAGE_SIZE + 4),
    pos: "1", type: "list", post: "list", from: "mobile_videolib",
    is_unified_interface: "1", version: "1.0.0", play_platform: "H5_QIYI"
  });
  const j = await getJson(IQ_API + "?" + q.toString(), {
    "User-Agent": UA_MOBILE, Referer: "https://m.iqiyi.com/", Accept: "application/json"
  });
  const vids = (j && j.data && j.data.videos) || [];
  const seen = new Set();
  const items = [];
  for (const v of vids) {
    const id = String(v.albumId || v.qipuId || "");
    const t = clean(v.albumName || v.shortTitle || v.name || "");
    if (!id || !t || seen.has(id)) continue;
    seen.add(id);
    items.push({
      title: t,
      poster: https(v.albumImageUrl || v.imageUrl || ""),
      url: "https://so.iqiyi.com/so/q_" + encodeURIComponent(t),
      corner: clean(v.lowerRightCorner || ""),
      note: "",
      desc: clip(v.desc, 300),
      cast: "",
      update: "",
      rating: "",
      date: fmtDate(v.period) || fmtDate(v.year),
      year: v.year ? String(v.year) : ""
    });
    if (items.length >= PAGE_SIZE) break;
  }
  return items;
}

/* ==========================================================
   芒果TV：pianku 片库接口
   ========================================================== */
const MG_API = "https://pianku.api.mgtv.com/rider/list/pcweb/v3";
const MG_CH = { tv: 2, movie: 3, variety: 1, anime: 50 };

async function fetchMango(cat, page) {
  const q = new URLSearchParams({
    allowedRC: "1", platform: "pcweb", channelId: String(MG_CH[cat]),
    pn: String(page), pc: String(PAGE_SIZE), hudong: "1", _support: "10000000"
  });
  const j = await getJson(MG_API + "?" + q.toString(), {
    Referer: "https://www.mgtv.com/lib/" + MG_CH[cat], accept: "application/json", "User-Agent": UA_PC
  });
  const docs = (j && j.data && j.data.hitDocs) || [];
  const items = [];
  for (const d of docs) {
    const t = clean(d.title);
    const id = String(d.clipId || "");
    if (!t || !id) continue;
    items.push({
      title: t,
      poster: https(d.img || d.imgUrlH || ""),
      url: "https://www.mgtv.com/h/" + id + ".html",
      corner: clean(d.rightCorner && d.rightCorner.text),
      note: clean(d.kind && d.kind.length ? d.kind.join(" · ") : ""),
      desc: clip(d.story, 300),
      cast: joinNames(d.subtitle),
      update: clean(d.updateInfo || ""),
      rating: "",
      date: fmtDate(d.year),
      year: d.year ? String(d.year) : ""
    });
    if (items.length >= PAGE_SIZE) break;
  }
  return items;
}

/* ==========================================================
   腾讯视频：POST 片库接口，分页靠 page_context 里的 offset
   ========================================================== */
const TX_API =
  "https://pbaccess.video.qq.com/trpc.multi_vector_layout.mvl_controller.MVLPageHTTPService/getMVLPage?&vversion_platform=18";
const TX_CH = { tv: "100113", movie: "100173", variety: "100109", anime: "100119" };
const TX_HEADERS = {
  "Content-Type": "application/json",
  Origin: "https://v.qq.com",
  Referer: "https://v.qq.com/tv-series-list/v-index.html",
  "User-Agent": UA_PC
};
/* channelId -> 第 1 页返回的 page_context（分页必须带上它） */
const txCtx = new Map();

function txBody(ch, ctx) {
  return JSON.stringify({
    page_params: { page_type: "operation", page_id: "channel_list", channel_id: ch, filter_params: "" },
    page_bypass_params: {
      params: { platform_id: "2", caller_id: "3000010", data_mode: "default", user_mode: "default", specified_strategy: "" },
      scene: "operation"
    },
    page_context: ctx || {}
  });
}

function txCards(j) {
  const cards = (j && j.data && j.data.modules && j.data.modules.normal && j.data.modules.normal.cards) || [];
  for (const c of cards) {
    const pc = c.children_list && c.children_list.poster_card;
    if (!pc) continue;
    const list = pc.cards || pc;
    if (list && list.length) return list;
  }
  return [];
}

async function fetchTencent(cat, page) {
  const ch = TX_CH[cat];
  let ctx = txCtx.get(ch);

  /* 首次请求不带 page_context，只为拿到分页上下文（这一页只有 12 条，不用它） */
  if (!ctx) {
    const boot = await postJson(TX_API, txBody(ch, {}), TX_HEADERS);
    ctx = (boot.data && boot.data.page_context) || {};
    txCtx.set(ch, ctx);
  }

  /* 带上 poster_size / poster_offset 再请求，才能按 20 条一页取 */
  const c = Object.assign({}, ctx);
  c._ctrl_page_index = String(page);
  c.page_index = String(page);
  for (const k of Object.keys(c)) {
    if (/_poster_size$/.test(k)) c[k] = String(PAGE_SIZE);
    if (/_poster_offset$/.test(k)) c[k] = String((page - 1) * PAGE_SIZE);
  }
  const j = await postJson(TX_API, txBody(ch, c), TX_HEADERS);
  const list = txCards(j);

  const seen = new Set();
  const items = [];
  for (const card of list) {
    const p = card.params || card;
    const cid = String(p.cid || "");
    const t = clean(p.title);
    if (!cid || !t || seen.has(cid)) continue;
    seen.add(cid);
    items.push({
      title: t,
      poster: https(p.new_pic_vt || ("https://vcover-vt-pic.puui.qpic.cn/vcover_vt_pic/0/" + cid + "/0")),
      url: "https://v.qq.com/x/cover/" + cid + ".html",
      corner: txBadge(p.latest_mark_label),
      note: clean([p.main_genre, p.area_name].filter(Boolean).join(" · ")),
      desc: clip(p.second_title, 300),
      cast: joinNames(p.sub_title || p.leading_actor),
      update: clip(p.timelong, 24),
      rating: txRating(p.chnlist_search_label),
      date: fmtDate(p.publish_date) || fmtDate(p.year),
      year: p.year ? String(p.year) : ""
    });
    if (items.length >= PAGE_SIZE) break;
  }
  return items;
}

/* ==========================================================
   对外入口
   ========================================================== */
const FETCHERS = { youku: fetchYouku, iqiyi: fetchIqiyi, tencent: fetchTencent, mango: fetchMango };
const resultCache = new Map();
const CACHE_TTL = 300000;

export async function fetchPosters(site, cat, page) {
  site = String(site || "").toLowerCase();
  cat = String(cat || "").toLowerCase();
  page = Math.max(1, Math.min(50, parseInt(page, 10) || 1));

  if (!FETCHERS[site]) return { ok: false, error: "unknown site: " + site };
  if (CATS.indexOf(cat) < 0) return { ok: false, error: "unknown category: " + cat };

  const key = site + ":" + cat + ":" + page;
  const hit = resultCache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL) {
    return { ok: true, site, cat, page, items: hit.items, hasMore: hit.items.length >= PAGE_SIZE, cached: true };
  }

  let items;
  try {
    items = await FETCHERS[site](cat, page);
  } catch (e) {
    return { ok: false, error: (e && e.message) || "upstream error" };
  }

  resultCache.set(key, { items, ts: Date.now() });
  /* 缓存别无限长，超出就清最早的 */
  if (resultCache.size > 200) {
    const firstKey = resultCache.keys().next().value;
    resultCache.delete(firstKey);
  }

  return { ok: true, site, cat, page, items, hasMore: items.length >= PAGE_SIZE };
}
