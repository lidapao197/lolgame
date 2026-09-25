(function () {
  const $ = (s) => document.querySelector(s);
  const pad = (n) => String(n).padStart(2, "0");
  const WEEK_CN = ["日", "一", "二", "三", "四", "五", "六"];
  const WEEK_FULL = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
  const PREF = "calendar.pref.v4";

  /* ---------- 数据接口 ---------- */
  const GAME_API = "https://lpl.qq.com/web201612/data/LOL_SGameList_Info.js";
  /* 对阵接口：先取赛事列表，再用第一个赛事的 sGameId 拼接此地址 */
  const matchApi = (sGameId) =>
    "https://lpl.qq.com/web201612/data/LOL_MATCH2_MATCH_HOMEPAGE_BMATCH_LIST_" + sGameId + ".js";
  /* 战队列表（含 TeamLogo），用于按 TeamId 取战队图标 */
  const TEAM_API = "https://lpl.qq.com/web201612/data/LOL_MATCH2_TEAM_LIST.js";

  /* PandaScore 数据源（serie_id=10419 → LCK 2026） */
  const PS_TOKEN = "UfjEdq5SZxthRjK16twzR_Vbtyrb7kUBkheEyN1mG2NmCkTSO3w";
  const PS_SERIE = 10419;
  const PS_PER_PAGE = 100;
  const PS_MAX_PAGES = 5;
  const PS_LABEL = "LCK 2026 · PandaScore";
  const psApi = (page) =>
    "https://api.pandascore.co/matches?filter[serie_id]=" + PS_SERIE +
    "&page=" + page + "&size=" + PS_PER_PAGE + "&per_page=" + PS_PER_PAGE +
    "&token=" + PS_TOKEN;

  /* 接口无 CORS 头，浏览器直连会被拦截，故准备公共代理作为降级方案 */
  const proxyUrls = (url) => [
    "https://api.allorigins.win/raw?url=" + encodeURIComponent(url),
    "https://api.codetabs.com/v1/proxy/?quest=" + encodeURIComponent(url)
  ];

  /* ---------- 偏好（默认周一起始） ---------- */
  const WEEK_START = 1;
  let pref = { theme: "light" };
  try {
    const v = JSON.parse(localStorage.getItem(PREF));
    if (v) pref = Object.assign(pref, v);
  } catch (e) {}
  function save() { try { localStorage.setItem(PREF, JSON.stringify(pref)); } catch (e) {} }

  const t0 = new Date();
  const todayKey = t0.getFullYear() + "-" + pad(t0.getMonth() + 1) + "-" + pad(t0.getDate());
  let view = { y: t0.getFullYear(), m: t0.getMonth() };
  let sel = todayKey;

  /* 两个数据源（并行加载）、各自的数据桶、合并后的日程、战队表 */
  const SRC_ORDER = ["lpl", "lck"];
  const sources = {
    lpl: { name: "LPL", state: "loading", n: 0 },
    lck: { name: "LCK", state: "loading", n: 0 }
  };
  let buckets = { lpl: {}, lck: {} };
  let matches = {};
  let teams = {};
  let teamsTask = null;

  /* 把两个数据源的数据按日期合并，并统一按时间排序 */
  function mergeMatches() {
    const merged = {};
    SRC_ORDER.forEach((key) => {
      const days = buckets[key] || {};
      Object.keys(days).forEach((day) => {
        merged[day] = (merged[day] || []).concat(days[day]);
      });
    });
    Object.keys(merged).forEach((day) => merged[day].sort((a, b) => a.time.localeCompare(b.time)));
    matches = merged;
    render();
  }

  /* ---------- GET 请求 ---------- */
  function httpGet(url) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", url, true);
      xhr.timeout = 12000;
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.responseText);
        else reject(new Error("HTTP " + xhr.status));
      };
      xhr.onerror = () => reject(new Error("network error"));
      xhr.ontimeout = () => reject(new Error("timeout"));
      xhr.send();
    });
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  /* ---------- 右下角加载提示：ok=成功(绿) err=失败(红) ---------- */
  function toast(msg, kind) {
    const box = $("#toasts");
    if (!box) return;
    const el = document.createElement("div");
    el.className = "toast " + (kind === "err" ? "err" : "ok");
    el.innerHTML = '<i class="dot"></i><span>' + esc(msg) + "</span>";
    box.appendChild(el);
    setTimeout(() => {
      el.classList.add("out");
      setTimeout(() => el.remove(), 280);
    }, 3200);
  }

  /* 依次尝试直连 / 公共代理，返回原始文本 */
  async function getRaw(url) {
    for (const u of [url].concat(proxyUrls(url))) {
      try { return await httpGet(u); } catch (e) { /* 尝试下一个 */ }
    }
    return null;
  }

  /* ---------- 战队表：TeamId -> { TeamName, TeamShortName, TeamLogo } ---------- */
  function ensureTeams() {
    if (!teamsTask) teamsTask = loadTeams();
    return teamsTask;
  }
  async function loadTeams() {
    const raw = await getRaw(TEAM_API);
    if (!raw) return;
    try {
      /* 返回体为 `var TeamList={...};`，截取其中的 JSON 部分 */
      const obj = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
      const map = {};
      Object.keys(obj.msg || {}).forEach((k) => {
        const t = obj.msg[k];
        map[String(t.TeamId)] = t;
      });
      teams = map;
    } catch (e) { /* 忽略解析失败，降级为纯文字 */ }
  }
  function teamOf(id) { return teams[String(id)] || null; }
  /* 只有 LPL 才查腾讯战队表。LCK(PandaScore) 的队伍 id 会与 LPL TeamId 撞号
     （例：KT 的 PandaScore id=63，LPL 63 号是「长沙理工」），
     所以 LCK 一律用数据自带的队名与图标 */
  function useTeamTable(m) { return m.src !== "lck"; }
  function nameOf(m, side) {
    const fallback = (side === "a" ? m.na : m.nb) || "待定";
    if (!useTeamTable(m)) return fallback;
    const t = teamOf(side === "a" ? m.aid : m.bid);
    return (t && (t.TeamShortName || t.TeamName)) || fallback;
  }
  /* 优先用对阵自带的图标（PandaScore 提供明/暗两套），否则回落到腾讯战队表 */
  function teamLogo(m, side) {
    const d = side === "a" ? m.da : m.db;
    const l = side === "a" ? m.la : m.lb;
    const own = (pref.theme === "dark" && d) || l;
    if (own) return own;
    if (!useTeamTable(m)) return "";
    const t = teamOf(side === "a" ? m.aid : m.bid);
    if (!t) return "";
    const u = t.TeamLogo || t.TeamLogoDeep || "";
    return u.indexOf("//") === 0 ? "https:" + u : u;
  }

  /* ---------- LPL：先取赛事列表，用第一个赛事的 sGameId 再取对阵 ---------- */
  async function loadLPL() {
    const src = sources.lpl;
    const fail = (why) => { src.state = "fail"; renderHeader(); toast("LPL 赛事获取失败：" + why, "err"); };

    const raw = await getRaw(GAME_API);
    if (!raw) { fail("赛事列表接口无响应"); return; }

    let data;
    try { data = JSON.parse(raw); }
    catch (e) { fail("赛事列表解析出错"); return; }

    const first = (data.gameList || [])[0];
    if (!first || !first.sGameId) { fail("未取到赛事 ID"); return; }

    src.name = first.sGameName || "LPL";
    renderHeader();

    const results = await Promise.all([getRaw(matchApi(first.sGameId)), ensureTeams()]);
    const raw2 = results[0];
    if (!raw2) { fail("对阵列表接口无响应"); return; }

    let list;
    try { list = (JSON.parse(raw2).msg) || []; }
    catch (e) { fail("对阵列表解析出错"); return; }

    const next = {};
    list.forEach((m) => {
      const md = String(m.MatchDate || "");
      if (md.length < 10) return;
      const day = md.slice(0, 10);
      next[day] = next[day] || [];
      next[day].push({
        src: "lpl",
        lg: "LPL",
        time: md.slice(11, 16),
        aid: String(m.TeamA || ""), bid: String(m.TeamB || ""),
        na: m.TeamShortNameA || "", nb: m.TeamShortNameB || "",
        la: "", lb: "", da: "", db: "",
        sa: m.ScoreA, sb: m.ScoreB,
        mode: m.GameModeName || "",
        stage: m.GameProcName || "",
        type: m.GameTypeName || "",
        place: m.GamePlaceName || "",
        status: String(m.MatchStatus || "")
      });
    });
    Object.keys(next).forEach((k) => next[k].sort((a, b) => a.time.localeCompare(b.time)));

    buckets.lpl = next;
    src.state = "ready";
    src.n = list.length;
    mergeMatches();
    toast("LPL 赛事获取成功：" + list.length + " 场", "ok");
  }

  /* ---------- PandaScore：按页拉取对阵并归入日程 ---------- */
  /* ISO(UTC) → 本地日期键与 HH:MM */
  function isoLocal(iso) {
    const d = new Date(iso);
    return {
      k: d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()),
      t: pad(d.getHours()) + ":" + pad(d.getMinutes()),
      d: d
    };
  }

  const PS_STATUS = { finished: "3", running: "1" };

  function psItem(m, p) {
    const ops = Array.isArray(m.opponents) ? m.opponents : [];
    const oa = (ops[0] && ops[0].opponent) || null;
    const ob = (ops[1] && ops[1].opponent) || null;
    const results = Array.isArray(m.results) ? m.results : [];
    const scoreOf = (t) => {
      if (!t) return "";
      const r = results.find((x) => x.team_id === t.id);
      return r && r.score !== null && r.score !== undefined ? String(r.score) : "";
    };
    const st = PS_STATUS[m.status] || "0";
    const sa = st === "3" ? scoreOf(oa) : "";
    const sb = st === "3" ? scoreOf(ob) : "";

    return {
      src: "lck",
      time: p.t,
      aid: oa ? String(oa.id) : "", bid: ob ? String(ob.id) : "",
      na: (oa && (oa.acronym || oa.name)) || "待定",
      nb: (ob && (ob.acronym || ob.name)) || "待定",
      la: (oa && oa.image_url) || "", lb: (ob && ob.image_url) || "",
      da: (oa && oa.dark_mode_image_url) || "", db: (ob && ob.dark_mode_image_url) || "",
      sa: sa, sb: sb,
      lg: (m.league && m.league.name) || "LCK",
      mode: m.match_type === "best_of" && m.number_of_games ? "BO" + m.number_of_games : (m.match_type || ""),
      stage: (m.tournament && m.tournament.name) || "",
      type: (m.serie && m.serie.full_name) || "",
      place: "",
      status: st
    };
  }

  async function loadLCK() {
    const src = sources.lck;
    const fail = (why) => { src.state = "fail"; renderHeader(); toast("LCK 赛事获取失败：" + why, "err"); };

    let all = [];
    for (let page = 1; page <= PS_MAX_PAGES; page++) {
      const raw = await getRaw(psApi(page));
      if (!raw) break;
      let arr;
      try { arr = JSON.parse(raw); } catch (e) { break; }
      if (!Array.isArray(arr) || !arr.length) break;
      all = all.concat(arr);
      if (arr.length < PS_PER_PAGE) break;
    }

    if (!all.length) { fail("PandaScore 接口无数据或被限流"); return; }

    const next = {};
    all.forEach((m) => {
      const iso = m.scheduled_at || m.begin_at;
      if (!iso) return;
      const p = isoLocal(iso);
      (next[p.k] = next[p.k] || []).push(psItem(m, p));
    });
    Object.keys(next).forEach((k) => next[k].sort((a, b) => a.time.localeCompare(b.time)));

    const s = all[0] && all[0].serie;
    const lg = all[0] && all[0].league;
    src.name = ((lg && lg.name) || PS_LABEL) + " " + (s && s.full_name ? s.full_name : "");

    buckets.lck = next;
    src.state = "ready";
    src.n = all.length;
    mergeMatches();
    toast("LCK 赛事获取成功：" + all.length + " 场", "ok");
  }

  function statusText(s) {
    if (s === "3") return "已结束";
    if (s === "1") return "进行中";
    return "未开始";
  }
  function hasScore(m) { return m.status === "3" && m.sa !== "" && m.sb !== ""; }
  /* 日期格内：已结束且有比分显示比分，否则显示 vs */
  function versusHtml(m) {
    const na = esc(nameOf(m, "a")), nb = esc(nameOf(m, "b"));
    const mid = hasScore(m)
      ? '<span class="sc">' + esc(m.sa) + " : " + esc(m.sb) + "</span>"
      : '<span class="sc vs">vs</span>';
    return '<span class="ta">' + na + "</span>" + mid + '<span class="tb">' + nb + "</span>";
  }

  /* ---------- 主题 ---------- */
  function applyTheme() {
    document.documentElement.setAttribute("data-theme", pref.theme);
    $("#themeIcon").innerHTML = pref.theme === "dark"
      ? '<path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"/>'
      : '<circle cx="12" cy="12" r="4"/><path d="M12 2v1.6M12 20.4V22M2 12h1.6M20.4 12H22M4.6 4.6l1.1 1.1M18.3 18.3l1.1 1.1M19.4 4.6l-1.1 1.1M5.7 18.3l-1.1 1.1"/>';
  }

  /* ---------- 月份选择器 ---------- */
  let pickY = view.y;
  function renderPick() {
    $("#pickYear").textContent = pickY + " 年";
    $("#pickGrid").innerHTML = Array.from({ length: 12 }, (_, i) =>
      '<button data-m="' + i + '" class="' + (i === view.m && pickY === view.y ? "on" : "") + '">' +
      (i + 1) + " 月</button>"
    ).join("");
    $("#pickGrid").querySelectorAll("button").forEach((b) => {
      b.addEventListener("click", () => {
        view = { y: pickY, m: Number(b.dataset.m) };
        closePick(); render();
      });
    });
  }
  function openPick() { pickY = view.y; renderPick(); $("#mpick").classList.add("show"); }
  function closePick() { $("#mpick").classList.remove("show"); }
  function pickOpen() { return $("#mpick").classList.contains("show"); }

  /* ---------- 渲染 ---------- */
  function renderWeekdays() {
    const ws = WEEK_START;
    let html = "";
    for (let i = 0; i < 7; i++) {
      const d = (i + ws) % 7;
      html += '<div class="' + (d === 0 || d === 6 ? "we" : "") + '">' + WEEK_FULL[d] + "</div>";
    }
    $("#weekdays").innerHTML = html;
  }

  function renderHeader() {
    $("#monthBtnText").textContent = view.y + " 年 " + (view.m + 1) + " 月";
    $("#sub").textContent = SRC_ORDER.map((key) => {
      const s = sources[key];
      const tail = s.state === "ready" ? s.n + " 场"
        : s.state === "fail" ? "加载失败" : "加载中…";
      return s.name + " " + tail;
    }).join("　｜　");
  }

  /* 每个日期格可见行数上限，以及最多渲染的 chip 节点数 */
  const MAX_ROWS = 3;
  const MAX_NODES = 8;

  /* 按格子实际高度自适应显示几行，剩余场次数由右上角角标提示 */
  function fitCells() {
    $("#days").querySelectorAll(".day").forEach((el) => {
      const badge = el.querySelector(".more");
      const items = el.querySelector(".items");
      const chips = items.querySelectorAll(".chip");
      const total = Number(el.dataset.n) || 0;
      if (!chips.length) { if (badge) badge.hidden = true; return; }

      chips.forEach((c) => { c.hidden = false; });
      const gap = parseFloat(getComputedStyle(items).rowGap) || 6;
      const h = chips[0].offsetHeight;
      const avail = el.clientHeight - items.offsetTop - parseFloat(getComputedStyle(el).paddingBottom);

      let rows = h > 0 ? Math.floor((avail + gap) / (h + gap)) : MAX_ROWS;
      if (!(rows > 0)) rows = 1;
      rows = Math.min(rows, MAX_ROWS);

      const visible = Math.min(rows, chips.length);
      for (let i = visible; i < chips.length; i++) chips[i].hidden = true;

      const extra = total - visible;
      badge.hidden = extra <= 0;
      if (extra > 0) badge.textContent = "+" + (extra > 99 ? 99 : extra);
    });
  }

  function renderDays() {
    const ws = WEEK_START;
    const first = new Date(view.y, view.m, 1);
    const offset = (first.getDay() - ws + 7) % 7;
    const total = new Date(view.y, view.m + 1, 0).getDate();
    const rows = Math.ceil((offset + total) / 7);
    const cells = rows * 7;

    $("#days").style.setProperty("--rows", rows);

    let html = "";
    for (let i = 0; i < cells; i++) {
      const d = new Date(view.y, view.m, 1 - offset + i);
      const y = d.getFullYear(), m = d.getMonth(), dd = d.getDate();
      const k = y + "-" + pad(m + 1) + "-" + pad(dd);
      const wd = d.getDay();
      const isOther = m !== view.m;
      const isToday = k === todayKey;
      const list = matches[k] || [];

      let cls = "day";
      if (wd === 0 || wd === 6) cls += " we";
      if (isOther) cls += " other";
      if (isToday) cls += " today";
      if (k === sel) cls += " sel";

      /* 多行渲染，实际显示几行由 fitCells() 按格子可用高度自适应 */
      let items = "";
      list.slice(0, MAX_NODES).forEach((m) => {
        items += '<div class="chip ' + (m.src || "lpl") + '"><b>' + m.time + "</b>" + versusHtml(m) + "</div>";
      });

      html += '<button class="' + cls + '" data-k="' + k + '" data-n="' + list.length +
        '" style="animation-delay:' + i * 5 + 'ms">' +
        '<span class="more" hidden></span>' +
        '<div class="head"><span class="num">' + dd + "</span></div>" +
        '<div class="items">' + items + "</div></button>";
    }
    $("#days").innerHTML = html;
    fitCells();

    $("#days").querySelectorAll(".day").forEach((el) => {
      el.addEventListener("click", () => {
        sel = el.dataset.k;
        const p = sel.split("-").map(Number);
        if (p[1] - 1 !== view.m || p[0] !== view.y) { view = { y: p[0], m: p[1] - 1 }; render(); }
        else { markSel(); }
        openDrawer();
      });
    });
  }

  function markSel() {
    $("#days").querySelectorAll(".day").forEach((el) => el.classList.toggle("sel", el.dataset.k === sel));
  }

  function render() { renderHeader(); renderDays(); }

  /* ---------- 详情抽屉 ---------- */
  function openDrawer() {
    const p = sel.split("-").map(Number);
    const d = new Date(p[0], p[1] - 1, p[2]);
    const wd = d.getDay();

    $("#dTitle").textContent = (d.getMonth() + 1) + " 月 " + d.getDate() + " 日";
    $("#dMeta").innerHTML = d.getFullYear() + " 年 · <b>星期" + WEEK_CN[wd] + "</b>" +
      (sel === todayKey ? " · 今天" : "");

    const list = matches[sel] || [];

    if (!list.length) {
      $("#dlist").innerHTML = '<div class="empty"><span class="em">🎮</span>这一天没有比赛<br>好好休息，等下一场开打</div>';
    } else {
      $("#dlist").innerHTML = list.map((m, i) => {
        const meta = [m.lg, m.mode, m.place].filter(Boolean);
        return '<div class="card-evt" style="animation-delay:' + i * 40 + 'ms">' +
          '<div class="tags">' +
          '<span class="ts">' + m.time + "</span>" +
          meta.map((x) => '<span class="tagx">' + esc(x) + "</span>").join("") +
          "</div>" +
          '<div class="teams">' +
          '<div class="team"><img class="tlogo" src="' + esc(teamLogo(m, "a")) + '" alt="' + esc(nameOf(m, "a")) +
          '" onerror="this.style.visibility=\'hidden\'"><span>' + esc(nameOf(m, "a")) + "</span></div>" +
          '<div class="mid">' +
          (hasScore(m)
            ? '<div class="sc">' + esc(m.sa) + " : " + esc(m.sb) + "</div>"
            : '<div class="vs">VS</div>') +
          '<div class="st">' + statusText(m.status) + "</div>" +
          "</div>" +
          '<div class="team"><img class="tlogo" src="' + esc(teamLogo(m, "b")) + '" alt="' + esc(nameOf(m, "b")) +
          '" onerror="this.style.visibility=\'hidden\'"><span>' + esc(nameOf(m, "b")) + "</span></div>" +
          "</div>" +
          "</div>";
      }).join("");
    }

    $("#scrim").classList.add("show");
    $("#drawer").classList.add("show");
  }
  function closeDrawer() {
    $("#scrim").classList.remove("show");
    $("#drawer").classList.remove("show");
  }

  /* ---------- 交互 ---------- */
  function go(delta) {
    const d = new Date(view.y, view.m + delta, 1);
    view = { y: d.getFullYear(), m: d.getMonth() };
    render();
  }
  $("#prev").addEventListener("click", () => go(-1));
  $("#next").addEventListener("click", () => go(1));
  $("#today").addEventListener("click", () => {
    view = { y: t0.getFullYear(), m: t0.getMonth() };
    sel = todayKey;
    render(); openDrawer();
  });
  $("#monthBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    pickOpen() ? closePick() : openPick();
  });
  $("#mpick").addEventListener("click", (e) => e.stopPropagation());
  $("#yPrev").addEventListener("click", () => { pickY--; renderPick(); });
  $("#yNext").addEventListener("click", () => { pickY++; renderPick(); });
  $("#pickToday").addEventListener("click", () => {
    view = { y: t0.getFullYear(), m: t0.getMonth() };
    closePick(); render();
  });
  document.addEventListener("click", closePick);

  $("#theme").addEventListener("click", () => {
    pref.theme = pref.theme === "dark" ? "light" : "dark";
    save(); applyTheme();
    render();
    /* 重绘抽屉以切换明/暗版战队图标 */
    if ($("#drawer").classList.contains("show")) openDrawer();
  });
  $("#close").addEventListener("click", closeDrawer);
  $("#scrim").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { if (pickOpen()) closePick(); else closeDrawer(); return; }
    if (/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) return;
    if (e.key === "ArrowLeft") go(-1);
    else if (e.key === "ArrowRight") go(1);
    else if (e.key === "t" || e.key === "T") { view = { y: t0.getFullYear(), m: t0.getMonth() }; render(); }
  });

  /* 尺寸变化后重新计算每个格子能放几行 */
  let fitTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(fitTimer);
    fitTimer = setTimeout(fitCells, 120);
  });

  /* ---------- 初始化：LPL 与 LCK 赛程并行加载 ---------- */
  applyTheme(); renderWeekdays(); render();
  /* 兜底：加载函数内未捕获的异常也给出失败提示 */
  const safeRun = (p, label, src) => p.catch((e) => {
    src.state = "fail"; renderHeader();
    toast(label + " 赛事获取失败：" + ((e && e.message) || "未知错误"), "err");
  });
  safeRun(loadLPL(), "LPL", sources.lpl);
  safeRun(loadLCK(), "LCK", sources.lck);
})();
