(function () {
  const $ = (s) => document.querySelector(s);
  const pad = (n) => String(n).padStart(2, "0");
  const WEEK_CN = ["日", "一", "二", "三", "四", "五", "六"];
  const WEEK_FULL = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
  const PREF = "calendar.pref.v4";

  /* ---------- 分类与语料 ---------- */
  const CATS = [
    { n: "LPL", c: "#4f46e5", bg: "#eef2ff" },
    { n: "LCK", c: "#db2777", bg: "#fdf2f8" },
    { n: "国际赛", c: "#d97706", bg: "#fffbeb" },
    { n: "训练赛", c: "#059669", bg: "#ecfdf5" },
    { n: "直播活动", c: "#0891b2", bg: "#ecfeff" },
    { n: "休赛日", c: "#dc2626", bg: "#fef2f2" }
  ];
  const TITLES = {
    LPL: ["JDG vs TES", "BLG vs WBG", "TES vs AL", "LNG vs FPX", "WBG vs NIP", "AL vs TT"],
    LCK: ["T1 vs GEN", "HLE vs DK", "KT vs DRX", "GEN vs HLE", "DK vs BFX"],
    国际赛: ["MSI 小组赛", "全球总决赛 · 淘汰赛", "洲际对抗赛", "季中冠军赛 · 半决赛"],
    训练赛: ["队内训练赛", "约战 T1", "约战 GEN", "战术复盘", "青训队对抗"],
    直播活动: ["官方直播", "选手见面会", "解说复盘直播", "新版本爆料"],
    休赛日: ["休赛日", "转会期", "休整日"]
  };
  const PLACES = ["上海 · 虹馆", "首尔 · LoL Park", "线上直播", "北京 · 主场", "成都 · 主场", "深圳 · 主场"];
  const OWNERS = ["春季赛", "夏季赛", "常规赛", "季后赛", "总决赛", "表演赛"];

  /* ---------- 稳定随机（同一天永远相同） ---------- */
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function prng(seed) {
    let s = seed >>> 0;
    return function () { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  }
  const fmtT = (m) => pad(Math.floor(m / 60)) + ":" + pad(m % 60);

  const cache = {};
  function eventsFor(y, m, d) {
    const k = y + "-" + pad(m + 1) + "-" + pad(d);
    if (cache[k]) return cache[k];

    const rnd = prng(hash(k));
    const wd = new Date(y, m, d).getDay();
    let n;
    if (wd === 0) n = rnd() < 0.6 ? 0 : 1;
    else if (wd === 6) n = rnd() < 0.45 ? 0 : 1;
    else n = rnd() < 0.16 ? 0 : (rnd() < 0.5 ? 1 : (rnd() < 0.8 ? 2 : 3));

    const used = [];
    const out = [];
    for (let i = 0; i < n; i++) {
      const cat = CATS[Math.floor(rnd() * CATS.length)];
      const pool = TITLES[cat.n];
      const title = pool[Math.floor(rnd() * pool.length)];

      if (cat.n === "休赛日") {
        out.push({ title, cat: cat.n, color: cat.c, bg: cat.bg, allDay: true, place: "—", owner: "全体" });
        continue;
      }
      let start = 9 * 60 + Math.floor(rnd() * 9) * 60 + (rnd() < 0.5 ? 0 : 30);
      let guard = 0;
      while (used.some((u) => Math.abs(u - start) < 60) && guard++ < 12) {
        start = 9 * 60 + Math.floor(rnd() * 9) * 60 + (rnd() < 0.5 ? 0 : 30);
      }
      used.push(start);
      const dur = [30, 60, 90][Math.floor(rnd() * 3)];
      out.push({
        title, cat: cat.n, color: cat.c, bg: cat.bg, allDay: false,
        start, end: start + dur, dur,
        place: PLACES[Math.floor(rnd() * PLACES.length)],
        owner: OWNERS[Math.floor(rnd() * OWNERS.length)]
      });
    }
    out.sort((a, b) => (a.allDay ? -1 : a.start) - (b.allDay ? -1 : b.start));
    cache[k] = out;
    return out;
  }

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
  function renderLegend() {
    $("#legend").innerHTML =
      CATS.map((c) => '<span class="lg"><i style="background:' + c.c + '"></i>' + c.n + "</span>").join("") +
      '<span class="sp">点击任意日期查看详情</span>';
  }

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
    const total = countMonth(view.y, view.m);
    const isNow = t0.getFullYear() === view.y && t0.getMonth() === view.m;
    $("#sub").textContent = (isNow ? "今天 " + (t0.getMonth() + 1) + " 月 " + t0.getDate() + " 日 · " : "") +
      "本月 " + total + " 场赛程";
  }

  function countMonth(y, m) {
    const total = new Date(y, m + 1, 0).getDate();
    let n = 0;
    for (let d = 1; d <= total; d++) n += eventsFor(y, m, d).length;
    return n;
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
      const list = eventsFor(y, m, dd);

      let cls = "day";
      if (wd === 0 || wd === 6) cls += " we";
      if (isOther) cls += " other";
      if (isToday) cls += " today";
      if (k === sel) cls += " sel";

      let items = "";
      list.slice(0, 3).forEach((e) => {
        items += '<div class="chip" style="--chipbg:' + e.bg + ";--chipfg:" + e.color + '">' +
          "<i></i>" + (e.allDay ? "<b>全天</b>" : "<b>" + fmtT(e.start) + "</b>") +
          "<span>" + e.title + "</span></div>";
      });
      if (list.length > 3) items += '<div class="more">+' + (list.length - 3) + " 项</div>";

      html += '<button class="' + cls + '" data-k="' + k + '" style="animation-delay:' + i * 5 + 'ms">' +
        '<div class="head"><span class="num">' + dd + "</span></div>" +
        '<div class="items">' + items + "</div></button>";
    }
    $("#days").innerHTML = html;

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
    const list = eventsFor(d.getFullYear(), d.getMonth(), d.getDate());
    const wd = d.getDay();

    $("#dTitle").textContent = (d.getMonth() + 1) + " 月 " + d.getDate() + " 日";
    $("#dMeta").innerHTML = d.getFullYear() + " 年 · <b>星期" + WEEK_CN[wd] + "</b>" +
      (sel === todayKey ? " · 今天" : "");

    let minutes = 0;
    list.forEach((e) => { if (!e.allDay) minutes += e.dur; });
    const busy = list.filter((e) => !e.allDay).length;
    $("#sCount").textContent = list.length;
    $("#sHours").textContent = minutes >= 60 ? (minutes / 60).toFixed(1).replace(".0", "") + "h" : minutes + "m";
    $("#sFree").textContent = (wd === 0 || wd === 6) ? "休息日" : Math.max(0, 4 - busy);

    if (!list.length) {
      $("#dlist").innerHTML = '<div class="empty"><span class="em">🎮</span>这一天没有比赛<br>好好休息，等下一场开打</div>';
    } else {
      $("#dlist").innerHTML = list.map((e, i) =>
        '<div class="card-evt" style="--c:' + e.color + ";--cbg:" + e.bg + ';animation-delay:' + i * 40 + 'ms">' +
        '<span class="bar"></span><div class="bd">' +
        '<div class="t">' + e.title + "</div>" +
        '<div class="m"><span class="when">' + (e.allDay ? "全天" : fmtT(e.start) + " – " + fmtT(e.end)) + "</span>" +
        '<span class="tagx">' + e.cat + "</span>" +
        (e.allDay ? "" : "<span>" + e.place + " · " + e.owner + "</span>") +
        (e.allDay ? "" : "<span>" + e.dur + " 分钟</span>") +
        "</div></div></div>"
      ).join("");
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

  /* ---------- 初始化 ---------- */
  applyTheme(); renderLegend(); renderWeekdays(); render();
})();
