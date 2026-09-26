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

  /* 接口无 CORS 头，浏览器直连会被拦截。
     首选同源代理 /api（由 worker.js / functions/api.js 提供，线上部署必备），
     再退到公共代理，最后才直连（本地 file:// 打开时只有公共代理可用） */
  const API_PROXY = "/api?u=";
  const proxyUrls = (url) => [
    API_PROXY + encodeURIComponent(url),
    "https://api.allorigins.win/raw?url=" + encodeURIComponent(url),
    "https://api.codetabs.com/v1/proxy/?quest=" + encodeURIComponent(url),
    url
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

  /* 单一数据源（LPL）：赛事列表、当前选中的 sGameId、按日期索引的对阵、战队表 */
  let games = [];
  let curGameId = "";
  let source = { name: "LPL", state: "loading", n: 0 };
  let bucket = {};
  let matches = {};
  let teams = {};
  let teamsTask = null;

  /* 按日期排序后交给日历渲染 */
  function applyMatches() {
    Object.keys(bucket).forEach((day) => bucket[day].sort((a, b) => a.time.localeCompare(b.time)));
    matches = bucket;
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
    for (const u of proxyUrls(url)) {
      let raw = null;
      try { raw = await httpGet(u); } catch (e) { /* 尝试下一个 */ }
      /* 代理不可用时常返回 404 页面 / index.html，按首字符排除 HTML */
      if (raw && raw.charCodeAt(0) !== 60 && !/^<!DOCTYPE|^<html/i.test(raw)) return raw;
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
  /* 队名：优先用腾讯战队表的简称，取不到就用对阵自带的名称 */
  function nameOf(m, side) {
    const fallback = (side === "a" ? m.na : m.nb) || "待定";
    const t = teamOf(side === "a" ? m.aid : m.bid);
    return (t && (t.TeamShortName || t.TeamName)) || fallback;
  }
  /* 队徽：按 TeamId 从战队表取 */
  function teamLogo(m, side) {
    const t = teamOf(side === "a" ? m.aid : m.bid);
    if (!t) return "";
    const u = t.TeamLogo || t.TeamLogoDeep || "";
    return u.indexOf("//") === 0 ? "https:" + u : u;
  }

  /* ---------- 赛事下拉：自定义按钮 + 弹出面板，常驻显示 ---------- */
  const gsel = { root: $("#gsel"), btn: $("#gselBtn"), txt: $("#gselTxt"), menu: $("#gselMenu") };

  /* 状态占位：loading / fail / empty —— 按钮显示文案并禁止展开 */
  function setGameSelState(text, kind) {
    gsel.txt.textContent = text;
    gsel.root.dataset.state = kind || "loading";
    gsel.btn.disabled = true;
    gsel.menu.hidden = true;
    gsel.root.classList.remove("open");
    gsel.btn.setAttribute("aria-expanded", "false");
  }

  /* 高亮当前赛事并同步按钮文案 */
  function markGameSel(id) {
    const cur = games.find((g) => String(g.sGameId) === String(id));
    const name = (cur && cur.sGameName) || "LPL";
    gsel.txt.textContent = name;
    source.name = name;
    gsel.menu.querySelectorAll(".gsel-item").forEach((b) => {
      b.classList.toggle("on", b.dataset.id === String(id));
    });
  }

  function renderGameSel() {
    gsel.menu.innerHTML = games.map((g) =>
      '<button type="button" class="gsel-item" role="option" data-id="' + esc(g.sGameId) + '">' +
      "<i></i><span>" + esc(g.sGameName || g.sGameId) + "</span></button>"
    ).join("");
    gsel.btn.disabled = false;
    gsel.root.dataset.state = "ready";
    const saved = String(pref.game || "");
    curGameId = games.some((g) => String(g.sGameId) === saved) ? saved : String(games[0].sGameId);
    markGameSel(curGameId);
  }

  function toggleGameSel(open) {
    if (gsel.btn.disabled) return;
    const on = open === undefined ? gsel.menu.hidden : !!open;
    gsel.menu.hidden = !on;
    gsel.root.classList.toggle("open", on);
    gsel.btn.setAttribute("aria-expanded", String(on));
    if (on) {
      const cur = gsel.menu.querySelector(".gsel-item.on");
      if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: "nearest" });
    }
  }

  gsel.btn.addEventListener("click", (e) => { e.stopPropagation(); toggleGameSel(); });
  gsel.menu.addEventListener("click", (e) => {
    const it = e.target.closest(".gsel-item");
    if (!it) return;
    toggleGameSel(false);
    const id = String(it.dataset.id);
    if (id === String(curGameId)) return;
    curGameId = id; pref.game = id; save();
    markGameSel(id);
    loadMatches(id);
  });
  document.addEventListener("click", (e) => { if (!gsel.root.contains(e.target)) toggleGameSel(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") toggleGameSel(false); });

  /* ---------- 取赛事列表，填选项框，再加载选中赛事的对阵 ---------- */
  async function loadGames() {
    setGameSelState("正在请求数据…", "loading");
    const fail = (why) => {
      source.state = "fail"; renderHeader(); setGameSelState("赛事请求失败", "fail");
      toast("LPL 赛事获取失败：" + why, "err");
    };

    const raw = await getRaw(GAME_API);
    if (!raw) { fail("赛事列表接口无响应"); return; }

    let data;
    try { data = JSON.parse(raw); }
    catch (e) { fail("赛事列表解析出错"); return; }

    const all = (data.gameList || []).filter((g) => g && g.sGameId);
    if (!all.length) {
      source.state = "fail"; renderHeader(); setGameSelState("赛事为空", "empty");
      toast("LPL 赛事获取失败：赛事列表为空", "err");
      return;
    }

    /* 只保留赛程区间与今年有交集的赛事 */
    const y = String(t0.getFullYear());
    const inYear = all.filter((g) => {
      const sy = String(g.sDate || "").slice(0, 4);
      const ey = String(g.eDate || "").slice(0, 4);
      return (!sy || sy <= y) && (!ey || ey >= y);
    });
    games = inYear.length ? inYear : all;

    if (!games.length) { fail("未取到赛事列表"); return; }

    renderGameSel();
    renderHeader();
    await loadMatches(curGameId);
  }

  /* ---------- 加载某个赛事的对阵 ---------- */
  async function loadMatches(sGameId) {
    source.state = "loading";
    renderHeader();

    const results = await Promise.all([getRaw(matchApi(sGameId)), ensureTeams()]);
    const raw = results[0];
    if (!raw) { source.state = "fail"; renderHeader(); toast("LPL 对阵获取失败：接口无响应", "err"); return; }

    let list;
    try { list = (JSON.parse(raw).msg) || []; }
    catch (e) { source.state = "fail"; renderHeader(); toast("LPL 对阵获取失败：数据解析出错", "err"); return; }

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
        sa: m.ScoreA, sb: m.ScoreB,
        mode: m.GameModeName || "",
        stage: m.GameProcName || "",
        type: m.GameTypeName || "",
        place: m.GamePlaceName || "",
        status: String(m.MatchStatus || "")
      });
    });

    bucket = next;
    source.state = "ready";
    source.n = list.length;
    applyMatches();

    if (!list.length) {
      /* 该赛事没有对阵：保留赛事列表可切换，仅把按钮文案标成「赛事为空」 */
      gsel.txt.textContent = "赛事为空";
      gsel.root.dataset.state = "empty";
      toast("该赛事暂无对阵", "err");
      return;
    }
    gsel.root.dataset.state = "ready";
    toast("LPL 赛事获取成功：" + list.length + " 场", "ok");
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
    const tail = source.state === "ready" ? source.n + " 场"
      : source.state === "fail" ? "加载失败" : "加载中…";
    $("#sub").textContent = source.name + "　" + tail;
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

  /* ---------- 初始化 ---------- */
  applyTheme(); renderWeekdays(); render();
  setGameSelState("正在请求数据…", "loading");
  /* 兜底：加载函数内未捕获的异常也给出失败提示 */
  loadGames().catch((e) => {
    source.state = "fail"; renderHeader(); setGameSelState("赛事请求失败", "fail");
    toast("LPL 赛事获取失败：" + ((e && e.message) || "未知错误"), "err");
  });
})();
