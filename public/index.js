(function () {
  const $ = (s) => document.querySelector(s);
  const pad = (n) => String(n).padStart(2, "0");
  const WEEK_CN = ["日", "一", "二", "三", "四", "五", "六"];
  const WEEK_FULL = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
  const PREF = "calendar.pref.v6";
  const PREF_OLD = "calendar.pref.v5";

  /* ---------- 数据接口 ---------- */
  const GAME_API = "https://lpl.qq.com/web201612/data/LOL_SGameList_Info.js";
  /* 对阵接口：先取赛事列表，再用第一个赛事的 sGameId 拼接此地址 */
  const matchApi = (sGameId) =>
    "https://lpl.qq.com/web201612/data/LOL_MATCH2_MATCH_HOMEPAGE_BMATCH_LIST_" + sGameId + ".js";
  /* 战队列表（含 TeamLogo），用于按 TeamId 取战队图标 */
  const TEAM_API = "https://lpl.qq.com/web201612/data/LOL_MATCH2_TEAM_LIST.js";

  /* 接口无 CORS 头，浏览器直连会被拦截。
     线上走同源代理 /api（worker.js 提供），再退到公共代理，最后才直连 */
  const API_PROXY = "/api?u=";
  const proxyUrls = (url) => [
    API_PROXY + encodeURIComponent(url),
    "https://api.allorigins.win/raw?url=" + encodeURIComponent(url),
    "https://api.codetabs.com/v1/proxy/?quest=" + encodeURIComponent(url),
    url
  ];

  /* ---------- 偏好（默认周一起始） ---------- */
  const WEEK_START = 1;
  /* 可选主题色，与 index.css 里的 [data-accent="..."] 一一对应 */
  const ACCENTS = ["indigo", "blue", "purple", "pink", "orange", "teal", "green"];
  let pref = { accent: "indigo", view: "home", shuffle: false, volume: 0.8, muted: false, fsite: "tencent" };
  try {
    /* v6：影视默认平台改为腾讯视频。旧偏好里除 fsite 外全部沿用 */
    const v = JSON.parse(localStorage.getItem(PREF) || localStorage.getItem(PREF_OLD) || "null");
    if (v) { delete v.fsite; pref = Object.assign(pref, v); }
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

  /* 依次尝试同源 /api → 公共代理 → 直连，返回原始文本 */
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

  /* ---------- 主题色 ---------- */
  function applyAccent() {
    if (ACCENTS.indexOf(pref.accent) < 0) pref.accent = "indigo";
    document.documentElement.setAttribute("data-accent", pref.accent);
    document.querySelectorAll(".acc-dot").forEach((b) => {
      b.classList.toggle("on", b.dataset.accent === pref.accent);
    });
  }

  /* 主题色面板：点击外部 / Esc 关闭 */
  const accPop = $("#accPop");
  function toggleAccPop(open) {
    const on = open === undefined ? accPop.hidden : !!open;
    accPop.hidden = !on;
    $("#accent").setAttribute("aria-expanded", String(on));
  }
  $("#accent").addEventListener("click", (e) => { e.stopPropagation(); toggleAccPop(); });
  accPop.addEventListener("click", (e) => {
    e.stopPropagation();
    const b = e.target.closest(".acc-dot");
    if (!b) return;
    pref.accent = b.dataset.accent;
    save(); applyAccent();
    toggleAccPop(false);
  });
  document.addEventListener("click", () => toggleAccPop(false));

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
      /* 窄屏用「一二三」短名，宽屏用「星期一」全称 */
      const name = mini ? WEEK_CN[d] : WEEK_FULL[d];
      html += '<div class="' + (d === 0 || d === 6 ? "we" : "") + '">' + name + "</div>";
    }
    $("#weekdays").innerHTML = html;
  }

  /* brand 已移除，头部只剩月份按钮，加载状态由 toast 提示 */
  function renderHeader() {
    $("#monthBtnText").textContent = view.y + " 年 " + (view.m + 1) + " 月";
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

  /* ---------- 手机版（窄屏）：日期格缩成小格，用圆点表示有比赛 ---------- */
  const mqMini = window.matchMedia("(max-width: 900px)");
  let mini = mqMini.matches;
  function applyMini() {
    if (!$("#detail")) return;
    $("#detail").hidden = !mini;
    $("#days").classList.toggle("mini", mini);
    renderWeekdays();
    markSel();
  }
  mqMini.addEventListener("change", (e) => { mini = e.matches; applyMini(); render(); });

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

      /* 桌面：多行 chip，显示几行由 fitCells() 按格子高度自适应；
         手机版：只放最多 3 个圆点表示当天有比赛 */
      let items = "";
      if (mini) {
        /* 手机版不论几场都只显示一个红点，避免小格子里挤满点 */
        items = list.length ? '<div class="dots"><i></i></div>' : "";
      } else {
        list.slice(0, MAX_NODES).forEach((m) => {
          items += '<div class="chip ' + (m.src || "lpl") + '"><b>' + m.time + "</b>" + versusHtml(m) + "</div>";
        });
      }

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
        /* 手机版不再弹抽屉，直接更新月视图下方的详情 */
        if (mini) fillList($("#mlist"), sel);
        else openDrawer();
      });
    });
  }

  function markSel() {
    $("#days").querySelectorAll(".day").forEach((el) => el.classList.toggle("sel", el.dataset.k === sel));
  }

  function render() {
    renderHeader();
    renderDays();
    if (mini) fillList($("#mlist"), sel);
  }

  /* ---------- 某一天的详情内容：右侧抽屉与手机版下方详情共用 ---------- */
  const EMPTY_DAY = '<div class="empty"><span class="em">🎮</span>这一天没有比赛<br>好好休息，等下一场开打</div>';

  function cardHtml(m, i) {
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
  }

  /* 只填列表（手机版下方直接用，没有标题栏） */
  function fillList(listEl, k) {
    if (!listEl) return;
    const list = matches[k] || [];
    listEl.innerHTML = list.length ? list.map(cardHtml).join("") : EMPTY_DAY;
  }

  function fillDay(titleEl, metaEl, listEl, k) {
    if (!titleEl || !listEl) return;
    const p = String(k).split("-").map(Number);
    const d = new Date(p[0], p[1] - 1, p[2]);
    titleEl.textContent = (d.getMonth() + 1) + " 月 " + d.getDate() + " 日";
    metaEl.innerHTML = d.getFullYear() + " 年 · <b>星期" + WEEK_CN[d.getDay()] + "</b>" +
      (k === todayKey ? " · 今天" : "");
    fillList(listEl, k);
  }

  /* ---------- 详情抽屉（桌面） ---------- */
  function openDrawer() {
    fillDay($("#dTitle"), $("#dMeta"), $("#dlist"), sel);
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
    render();
    if (!mini) openDrawer();
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

  $("#close").addEventListener("click", closeDrawer);
  $("#scrim").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (!$("#fModal").hidden) { closeFilmDetail(); return; }
      if (!accPop.hidden) { toggleAccPop(false); return; }
      if (pickOpen()) closePick(); else closeDrawer();
      return;
    }
    if (/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) return;
    /* 音乐视图下不响应日历快捷键 */
    if (curView !== "home") return;
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

  /* ---------- 顶部导航：首页 / 影视 / 音乐 视图切换 ---------- */
  const VIEWS = ["home", "film", "music"];
  let curView = VIEWS.indexOf(pref.view) >= 0 ? pref.view : "home";
  const fnavItems = Array.prototype.slice.call(document.querySelectorAll(".fnav-item"));
  function placeNavInd() {
    const on = document.querySelector(".fnav-item.on");
    const ind = $("#fnavInd");
    if (!on || !ind) return;
    ind.style.width = on.offsetWidth + "px";
    ind.style.transform = "translateX(" + on.offsetLeft + "px)";
  }
  function switchView(v, skipSave) {
    curView = VIEWS.indexOf(v) >= 0 ? v : "home";
    fnavItems.forEach((b) => b.classList.toggle("on", b.dataset.view === curView));
    placeNavInd();
    $("#viewHome").hidden = curView !== "home";
    $("#viewFilm").hidden = curView !== "film";
    $("#viewMusic").hidden = curView !== "music";
    /* 回到首页时格子高度可能变过，重算能放几行 */
    if (curView === "home") fitCells();
    /* 影视页首次进入才拉数据，避免一打开就发 4 个请求 */
    if (curView === "film") ensureFilm();
    if (!skipSave) { pref.view = curView; save(); }
  }
  fnavItems.forEach((b) => b.addEventListener("click", () => switchView(b.dataset.view)));
  window.addEventListener("resize", placeNavInd);
  window.addEventListener("load", placeNavInd);

  /* ---------- 音乐视图：播放 data/music.json 里的歌曲 ---------- */
  const MUS_API = "data/music.json";
  const audio = $("#audio");
  let songs = [];
  let curSong = -1;
  /* 播放历史：随机模式下「上一首」沿历史回退 */
  let playHistory = [];

  function fmtT(s) {
    if (!isFinite(s) || s < 0) s = 0;
    return Math.floor(s / 60) + ":" + pad(Math.floor(s % 60));
  }

  function setPlayIcon(playing) {
    /* svg 元素没有 hidden 的 DOM 属性映射，必须用 setAttribute 才能真正生效 */
    const p = $("#icPlay"), q = $("#icPause");
    if (playing) { p.setAttribute("hidden", ""); q.removeAttribute("hidden"); }
    else { p.removeAttribute("hidden"); q.setAttribute("hidden", ""); }
  }

  function renderPlaylist() {
    $("#plistHead").textContent = "播放列表 · 共 " + songs.length + " 首";
    $("#plistHead").hidden = !songs.length;
    $("#mEmpty").hidden = !!songs.length;
    $("#plist").innerHTML = songs.map((s, i) =>
      '<button type="button" class="prow" data-i="' + i + '" style="animation-delay:' + Math.min(i, 20) * 25 + 'ms">' +
      '<span class="idx">' + (i + 1) + "</span>" +
      '<span class="eq" aria-hidden="true"><i></i><i></i><i></i></span>' +
      '<span class="pcover">' +
      (s.cover
        ? '<img src="' + esc(s.cover) + '" alt="" loading="lazy" onerror="this.hidden=true;this.nextElementSibling.removeAttribute(\'hidden\')">'
        : "") +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"' + (s.cover ? " hidden" : "") + '><path d="M9 18.5V6l11-2.5V16"/><circle cx="6.5" cy="18.5" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/></svg>' +
      "</span>" +
      '<span class="pt"><b>' + esc(s.title || "未知曲目") + "</b><span>" + esc(s.artist || "未知艺术家") + "</span></span>" +
      '<span class="pd">' + (s.duration ? fmtT(s.duration) : "") + "</span>" +
      "</button>"
    ).join("");
    $("#plist").querySelectorAll(".prow").forEach((el) => {
      el.addEventListener("click", () => playIndex(Number(el.dataset.i), true));
    });
  }

  function markPlaying() {
    $("#plist").querySelectorAll(".prow").forEach((el) => {
      const i = Number(el.dataset.i);
      el.classList.toggle("on", i === curSong);
      el.classList.toggle("playing", i === curSong && !audio.paused);
    });
    const s = songs[curSong];
    $("#npTitle").textContent = s ? (s.title || "未知曲目") : "未在播放";
    $("#npArtist").textContent = s ? (s.artist || "未知艺术家") : "选择一首开始欣赏";
    const img = $("#coverImg"), ph = $("#coverPh");
    if (s && s.cover) {
      if (img.getAttribute("src") !== s.cover) img.src = s.cover;
      img.hidden = false; ph.style.display = "none";
    } else {
      img.hidden = true; img.removeAttribute("src"); ph.style.display = "";
    }
  }
  /* 封面加载失败时退回占位图标 */
  $("#coverImg").addEventListener("error", () => { $("#coverImg").hidden = true; $("#coverPh").style.display = ""; });

  function playIndex(i, autoplay, fromHistory) {
    if (!songs[i]) return;
    /* 记录历史供随机模式的「上一首」回退；从历史跳出时不重复入栈 */
    if (!fromHistory && curSong >= 0 && curSong !== i) {
      playHistory.push(curSong);
      if (playHistory.length > 300) playHistory.shift();
    }
    curSong = i;
    audio.src = songs[i].url;
    $("#trackFill").style.width = "0%";
    $("#trackThumb").style.left = "0%";
    $("#tCur").textContent = "0:00";
    $("#tDur").textContent = songs[i].duration ? fmtT(songs[i].duration) : "0:00";
    markPlaying();
    if (autoplay) audio.play().catch(() => { /* 播放失败由 error 事件提示 */ });
    pref.music = i; save();
  }

  /* 前进（手动下一首 / 播完自动连播共用）：随机挑一首不同的，顺序则循环 */
  function stepSong(d) {
    if (!songs.length) return;
    let i;
    if (pref.shuffle && songs.length > 1) {
      do { i = Math.floor(Math.random() * songs.length); } while (i === curSong);
    } else {
      i = curSong + d;
      if (i < 0) i = songs.length - 1;
      if (i >= songs.length) i = 0;
    }
    playIndex(i, true);
  }
  /* 上一首：随机模式优先沿播放历史回退，历史为空或顺序模式按序号回退 */
  function stepPrev() {
    if (!songs.length) return;
    if (pref.shuffle && playHistory.length) {
      playIndex(playHistory.pop(), true, true);
    } else {
      let i = curSong - 1;
      if (i < 0) i = songs.length - 1;
      playIndex(i, true);
    }
  }

  audio.addEventListener("play", () => { setPlayIcon(true); markPlaying(); });
  audio.addEventListener("pause", () => { setPlayIcon(false); markPlaying(); });
  audio.addEventListener("ended", () => stepSong(1));
  audio.addEventListener("loadedmetadata", () => { $("#tDur").textContent = fmtT(audio.duration); });
  audio.addEventListener("timeupdate", () => {
    const d = audio.duration || 0;
    const p = d ? (audio.currentTime / d) * 100 : 0;
    $("#trackFill").style.width = p + "%";
    $("#trackThumb").style.left = p + "%";
    $("#tCur").textContent = fmtT(audio.currentTime);
  });
  audio.addEventListener("error", () => {
    if (curSong >= 0 && audio.src) toast("播放失败：" + (songs[curSong].title || "音频链接不可用"), "err");
  });

  /* 进度条：点按与拖拽定位 */
  (function () {
    const track = $("#track");
    let dragging = false;
    function seek(e) {
      const r = track.getBoundingClientRect();
      const p = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      if (audio.duration) {
        audio.currentTime = p * audio.duration;
        $("#trackFill").style.width = p * 100 + "%";
        $("#trackThumb").style.left = p * 100 + "%";
      }
    }
    track.addEventListener("pointerdown", (e) => { dragging = true; track.setPointerCapture(e.pointerId); seek(e); });
    track.addEventListener("pointermove", (e) => { if (dragging) seek(e); });
    track.addEventListener("pointerup", () => { dragging = false; });
    track.addEventListener("pointercancel", () => { dragging = false; });
  })();

  /* ---------- 音量：滑杆拖拽 / 静音切换 / 键盘微调 ---------- */
  const VOL_ICON = {
    mute: '<path d="M4 9.6h3.1L12 5.8v12.4L7.1 14.4H4z"/><path d="M16.2 9.8l4.2 4.6M20.4 9.8l-4.2 4.6"/>',
    low: '<path d="M4 9.6h3.1L12 5.8v12.4L7.1 14.4H4z"/><path d="M15.3 9.5a3.6 3.6 0 010 5"/>',
    high: '<path d="M4 9.6h3.1L12 5.8v12.4L7.1 14.4H4z"/><path d="M15.3 9.5a3.6 3.6 0 010 5"/><path d="M18 7a7.2 7.2 0 010 10"/>'
  };

  /* 把 pref.volume / pref.muted 同步到 <audio>，并重绘图标与滑杆 */
  function applyVol() {
    const n = Number(pref.volume);
    pref.volume = isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.8;
    audio.volume = pref.volume;
    audio.muted = !!pref.muted;
    const v = pref.muted ? 0 : pref.volume;
    $("#vIcon").innerHTML = v <= 0.001 ? VOL_ICON.mute : (v < 0.5 ? VOL_ICON.low : VOL_ICON.high);
    $("#vBtn").title = pref.muted ? "取消静音" : "静音";
    $("#vBtn").classList.toggle("off", pref.muted || v <= 0.001);
    $("#vFill").style.width = v * 100 + "%";
    $("#vThumb").style.left = v * 100 + "%";
    $("#vTrack").setAttribute("aria-valuenow", String(Math.round(v * 100)));
  }

  (function () {
    const t = $("#vTrack");
    let dragging = false;
    function set(e) {
      const r = t.getBoundingClientRect();
      const v = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      pref.volume = v;
      pref.muted = v <= 0;
      applyVol(); save();
    }
    t.addEventListener("pointerdown", (e) => {
      dragging = true;
      try { t.setPointerCapture(e.pointerId); } catch (err) { /* 合成事件无有效 pointerId */ }
      set(e);
    });
    t.addEventListener("pointermove", (e) => { if (dragging) set(e); });
    t.addEventListener("pointerup", () => { dragging = false; });
    t.addEventListener("pointercancel", () => { dragging = false; });
    t.addEventListener("keydown", (e) => {
      const step = e.shiftKey ? 0.1 : 0.05;
      if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
        pref.volume = Math.max(0, pref.volume - step);
        pref.muted = pref.volume <= 0;
      } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
        pref.volume = Math.min(1, pref.volume + step);
        pref.muted = false;
      } else return;
      e.preventDefault();
      applyVol(); save();
    });
  })();

  $("#vBtn").addEventListener("click", () => {
    if (pref.muted || pref.volume <= 0) {
      pref.muted = false;
      if (pref.volume <= 0) pref.volume = 0.8;
    } else {
      pref.muted = true;
    }
    applyVol(); save();
  });

  $("#pPlay").addEventListener("click", () => {
    if (!songs.length) return;
    if (curSong < 0) return playIndex(0, true);
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  });
  $("#pPrev").addEventListener("click", () => stepPrev());
  $("#pNext").addEventListener("click", () => stepSong(1));

  /* 随机 / 顺序切换，偏好写入 localStorage */
  function applyShuffle() {
    const b = $("#pShuffle");
    b.classList.toggle("on", !!pref.shuffle);
    b.setAttribute("aria-pressed", String(!!pref.shuffle));
    b.title = pref.shuffle ? "随机播放（点击切回顺序）" : "顺序播放（点击切换随机）";
  }
  $("#pShuffle").addEventListener("click", () => {
    pref.shuffle = !pref.shuffle; save(); applyShuffle();
    toast(pref.shuffle ? "已开启随机播放" : "已切回顺序播放", "ok");
  });
  applyShuffle();
  /* 音量沿用上次设置（首次为 80%） */
  applyVol();

  /* 音乐列表是可选数据：失败时静默降级为空态，不弹提示 */
  async function loadMusic() {
    let raw = null;
    try { raw = await httpGet(MUS_API); } catch (e) { /* 空态 */ }
    if (raw) {
      try {
        const data = JSON.parse(raw);
        /* 兼容两种格式：抖音导出的 { data: [...] } 与通用 { songs: [...] }，
           字段取 play/title/author/cover/duration，其余格式取 url/title/artist/cover */
        const list = Array.isArray(data) ? data : (data.data || data.songs || []);
        songs = list.map((s) => ({
          url: s.play || s.url || "",
          title: s.title || "",
          artist: s.author || s.artist || "",
          cover: s.cover || "",
          duration: Number(s.duration) || 0
        })).filter((s) => s.url);
      } catch (e) { songs = []; }
    }
    renderPlaylist();
    if (songs.length) {
      const saved = Number(pref.music);
      playIndex(saved >= 0 && saved < songs.length ? saved : 0, false);
    }
  }

  /* ---------- 影视视图：平台 × 分类海报墙 ---------- */
  const FILM_PER_PAGE = 20;
  /* 分类顺序：电视剧 → 电影 → 动漫 → 综艺 */
  const FILM_CATS = [["tv", "电视剧"], ["movie", "电影"], ["anime", "动漫"], ["variety", "综艺"]];
  /* 平台顺序：腾讯视频排第一 */
  const FILM_SITES = ["tencent", "youku", "iqiyi", "mango"];
  const SITE_NAME = { youku: "优酷", iqiyi: "爱奇艺", tencent: "腾讯视频", mango: "芒果TV" };
  const film = {
    site: FILM_SITES.indexOf(pref.fsite) >= 0 ? pref.fsite : FILM_SITES[0],
    page: {},        // 分类 -> 当前页码
    cache: new Map(),// "site:cat:page" -> items
    started: false
  };
  const ICON_PREV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';
  const ICON_NEXT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>';

  const filmKey = (site, cat, page) => site + ":" + cat + ":" + page;
  const filmPage = (cat) => film.page[cat] || 1;

  function filmCard(it, i) {
    const corner = it.corner ? '<i class="fcorner">' + esc(it.corner) + "</i>" : "";
    const tip = it.title + (it.date ? " · " + it.date : "");
    return '<button class="fcard" type="button" data-i="' + i + '" title="' + esc(tip) + '">' +
      '<span class="fposter">' + corner +
      '<img src="' + esc(it.poster) + '" alt="" loading="lazy" referrerpolicy="no-referrer"' +
      ' onerror="this.style.opacity=0">' +
      "</span>" +
      '<b class="ftitle">' + esc(it.title) + "</b>" +
      '<span class="fdate">' + esc(it.date || "") + "</span>" +
      "</button>";
  }

  function filmSkeleton(n) {
    let h = "";
    for (let i = 0; i < n; i++) {
      h += '<div class="fcard sk"><span class="fposter"></span><b class="ftitle"></b><span class="fdate"></span></div>';
    }
    return h;
  }

  function filmRowsHtml() {
    return FILM_CATS.map(([cat, name]) =>
      '<section class="frow" data-cat="' + cat + '">' +
        '<div class="frow-head"><h3>' + name + "</h3><span class=\"fcount\"></span>" +
          '<div class="fpager"><span class="fpnum">第 1 页</span>' +
            '<button class="fbtn" type="button" data-dir="-1" title="上一页" disabled>' + ICON_PREV + "</button>" +
            '<button class="fbtn" type="button" data-dir="1" title="下一页">' + ICON_NEXT + "</button>" +
          "</div>" +
        "</div>" +
        '<div class="fstrip">' + filmSkeleton(FILM_PER_PAGE) + "</div>" +
      "</section>"
    ).join("");
  }

  async function fetchFilm(site, cat, page) {
    try {
      const res = await fetch("/poster?site=" + site + "&cat=" + cat + "&page=" + page, {
        headers: { accept: "application/json" }
      });
      if (!res.ok) return null;
      const j = await res.json();
      return j && j.ok ? j : null;
    } catch (e) {
      return null;
    }
  }

  function paintFilmRow(row, cat, items) {
    const page = filmPage(cat);
    const strip = row.querySelector(".fstrip");
    row.querySelector(".fcount").textContent = items.length ? items.length + " 部" : "";
    row.querySelector(".fpnum").textContent = "第 " + page + " 页";
    row.querySelector('[data-dir="-1"]').disabled = page <= 1;
    row.querySelector('[data-dir="1"]').disabled = items.length < FILM_PER_PAGE;
    strip.innerHTML = items.length
      ? items.map(filmCard).join("")
      : '<div class="fempty">该分类暂时没有取到内容</div>';
    strip.scrollLeft = 0;
  }

  async function loadFilmRow(cat) {
    const row = document.querySelector('.frow[data-cat="' + cat + '"]');
    if (!row) return;
    const site = film.site;
    const page = filmPage(cat);
    const key = filmKey(site, cat, page);

    if (!film.cache.has(key)) {
      row.querySelector(".fstrip").innerHTML = filmSkeleton(FILM_PER_PAGE);
      row.querySelector(".fpnum").textContent = "加载中…";
      const r = await fetchFilm(site, cat, page);
      /* 请求期间可能已切平台 / 翻页，结果丢弃 */
      if (film.site !== site || filmPage(cat) !== page) return;
      if (!r) {
        row.querySelector(".fstrip").innerHTML =
          '<div class="fempty">海报加载失败，接口可能暂时不可用' +
          '<button type="button" data-retry="1">重试</button></div>';
        row.querySelector(".fpnum").textContent = "第 " + page + " 页";
        return;
      }
      film.cache.set(key, r.items);
    }
    if (film.site !== site || filmPage(cat) !== page) return;
    paintFilmRow(row, cat, film.cache.get(key));
  }

  function ensureFilm() {
    if (film.started) return;
    film.started = true;
    $("#fRows").innerHTML = filmRowsHtml();
    markFilmTab();
    FILM_CATS.forEach(([cat]) => loadFilmRow(cat));
  }

  function markFilmTab() {
    $("#fTabs").querySelectorAll(".ftab").forEach((b) => {
      const on = b.dataset.site === film.site;
      b.classList.toggle("on", on);
      b.setAttribute("aria-selected", String(on));
    });
  }

  $("#fTabs").addEventListener("click", (e) => {
    const b = e.target.closest(".ftab");
    if (!b || b.dataset.site === film.site) return;
    film.site = b.dataset.site;
    pref.fsite = film.site; save();
    markFilmTab();
    FILM_CATS.forEach(([cat]) => { film.page[cat] = 1; });
    FILM_CATS.forEach(([cat]) => loadFilmRow(cat));
  });

  /* ---------- 影视详情弹层 ---------- */
  function openFilmDetail(it) {
    const siteName = SITE_NAME[film.site] || "";
    const img = $("#fmPoster");
    if (it.poster) { img.src = it.poster; img.hidden = false; } else { img.removeAttribute("src"); img.hidden = true; }
    img.alt = it.title;
    $("#fmTitle").textContent = it.title;

    const tags = [];
    if (siteName) tags.push('<span class="fm-tag">' + esc(siteName) + "</span>");
    if (it.corner) tags.push('<span class="fm-tag plain">' + esc(it.corner) + "</span>");
    if (it.note) tags.push('<span class="fm-tag plain">' + esc(it.note) + "</span>");
    $("#fmTags").innerHTML = tags.join("");

    const rows = [];
    if (it.rating) rows.push('<div class="fm-row"><b>评分</b><span class="fm-score">' + esc(it.rating) + "</span></div>");
    if (it.date) rows.push('<div class="fm-row"><b>上映</b><span>' + esc(it.date) + "</span></div>");
    if (it.update) rows.push('<div class="fm-row"><b>状态</b><span>' + esc(it.update) + "</span></div>");
    if (it.cast) rows.push('<div class="fm-row"><b>主演</b><span>' + esc(it.cast) + "</span></div>");
    $("#fmRows").innerHTML = rows.join("");

    const desc = it.desc || "";
    $("#fmDesc").textContent = desc || "该平台未提供简介";
    $("#fmDesc").classList.toggle("empty", !desc);

    $("#fModal").hidden = false;
    document.documentElement.classList.add("lock");
  }

  function closeFilmDetail() {
    if ($("#fModal").hidden) return;
    $("#fModal").hidden = true;
    document.documentElement.classList.remove("lock");
  }

  $("#fClose").addEventListener("click", closeFilmDetail);
  $("#fScrim").addEventListener("click", closeFilmDetail);

  $("#fRows").addEventListener("click", (e) => {
    const retry = e.target.closest("[data-retry]");
    if (retry) {
      const row = retry.closest(".frow");
      film.cache.delete(filmKey(film.site, row.dataset.cat, filmPage(row.dataset.cat)));
      loadFilmRow(row.dataset.cat);
      return;
    }
    /* 点海报 → 弹详情，不再跳转外站 */
    const card = e.target.closest(".fcard");
    if (card && card.dataset.i !== undefined) {
      const cat = card.closest(".frow").dataset.cat;
      const list = film.cache.get(filmKey(film.site, cat, filmPage(cat))) || [];
      const it = list[Number(card.dataset.i)];
      if (it) openFilmDetail(it);
      return;
    }
    const btn = e.target.closest(".fbtn");
    if (!btn || btn.disabled) return;
    const cat = btn.closest(".frow").dataset.cat;
    const next = Math.max(1, filmPage(cat) + Number(btn.dataset.dir));
    if (next === filmPage(cat)) return;
    film.page[cat] = next;
    loadFilmRow(cat);
  });

  /* ---------- 初始化 ---------- */
  applyAccent(); renderWeekdays(); applyMini(); render();
  switchView(curView, true);
  setGameSelState("正在请求数据…", "loading");
  /* 兜底：加载函数内未捕获的异常也给出失败提示 */
  loadGames().catch((e) => {
    source.state = "fail"; renderHeader(); setGameSelState("赛事请求失败", "fail");
    toast("LPL 赛事获取失败：" + ((e && e.message) || "未知错误"), "err");
  });
  loadMusic();
})();
