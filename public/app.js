(() => {
  "use strict";

  const TZ = "Europe/Istanbul";
  const STORAGE_THEME = "sy-theme";
  const STORAGE_SOURCE = "sy-source";

  const MEALS = [
    { id: "kahvalti", name: "Kahvaltı", icon: "sunrise" },
    { id: "ogle", name: "Öğle", icon: "sun" },
    { id: "aksam", name: "Akşam", icon: "moon" },
  ];

  const SOURCE_META = {
    kyk: {
      short: "KYK Yurtları",
      title: "KYK Sivas Yurtları",
      color: "var(--src-kyk)",
      soft: "var(--src-kyk-soft)",
      ink: "var(--src-kyk-ink)",
    },
    cu: {
      short: "CÜ Öğrenci",
      title: "CÜ Öğrenci Yemekhanesi",
      color: "var(--src-cu)",
      soft: "var(--src-cu-soft)",
      ink: "var(--src-cu-ink)",
    },
    hastane: {
      short: "CÜTF Hastane",
      title: "CÜTF Hastane Yemekhanesi",
      color: "var(--src-hastane)",
      soft: "var(--src-hastane-soft)",
      ink: "var(--src-hastane-ink)",
    },
  };

  const DEFAULT_META = {
    color: "var(--src-default)",
    soft: "var(--src-default-soft)",
    ink: "var(--src-default-ink)",
  };

  const POPULAR_QUERIES = [
    "Sivas Köfte",
    "Köfte",
    "Baklava",
    "Pizza",
    "Hamburger",
    "Tantuni",
    "Mantı",
    "Balık",
    "Kuru Fasulye",
    "Menemen",
  ];

  /* ------------------------------------------------------------------------
     Date & Turkish Helpers
     ------------------------------------------------------------------------ */

  const makeFmt = (opts) => new Intl.DateTimeFormat("tr-TR", { timeZone: TZ, ...opts });
  const fmtFullDate = makeFmt({ day: "numeric", month: "long", weekday: "long" });
  const fmtDayMonth = makeFmt({ day: "numeric", month: "long" });
  const fmtMonthShort = makeFmt({ month: "short" });
  const fmtMonthYear = makeFmt({ month: "long", year: "numeric" });
  const fmtWdShort = makeFmt({ weekday: "short" });
  const fmtWdLong = makeFmt({ weekday: "long" });
  const fmtStamp = makeFmt({ day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  const fmtTimeOnly = makeFmt({ hour: "2-digit", minute: "2-digit" });

  function trLower(str) {
    return String(str).replace(/I/g, "ı").replace(/İ/g, "i").toLocaleLowerCase("tr-TR");
  }

  function isoToDate(iso) {
    return new Date(`${iso}T12:00:00+03:00`);
  }

  function dateToIso(dt) {
    const parts = Object.fromEntries(
      makeFmt({ year: "numeric", month: "2-digit", day: "2-digit" })
        .formatToParts(dt)
        .map((p) => [p.type, p.value])
    );
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  function todayIso() {
    return dateToIso(new Date());
  }

  function hourTr() {
    return Number(makeFmt({ hour: "2-digit", hourCycle: "h23" }).format(new Date()));
  }

  function addDays(iso, delta) {
    const dt = isoToDate(iso);
    dt.setUTCDate(dt.getUTCDate() + delta);
    return dateToIso(dt);
  }

  function dayDiff(aIso, bIso) {
    return Math.round((isoToDate(aIso) - isoToDate(bIso)) / 86400000);
  }

  function isWeekend(iso) {
    const wd = isoToDate(iso).getUTCDay(); // 0=Sun, 6=Sat (at 12:00+03:00 = 09:00 UTC same day)
    return wd === 0 || wd === 6;
  }

  function mondayOfWeek(iso) {
    const wd = isoToDate(iso).getUTCDay(); // 0=Sun..6=Sat
    const diff = wd === 0 ? -6 : 1 - wd;
    return addDays(iso, diff);
  }

  function sourceMeta(src) {
    const known = SOURCE_META[src.id];
    if (known) return known;
    return {
      short: src.name,
      title: src.name,
      ...DEFAULT_META,
    };
  }

  function cleanItemText(text) {
    return text
      .replace(/\s*\+\s*/g, " + ")
      .replace(/([^\s(])\(/g, "$1 (")
      .replace(/\s+/g, " ")
      .trim();
  }

  function parseAlternatives(raw) {
    const text = cleanItemText(raw);
    const parts = text.split(" / ").map((p) => p.trim()).filter(Boolean);
    if (parts.length <= 1) return [text];

    // Abbreviations like "Tavuk Pirzola / P. Kızartma" stay inline
    if (parts.some((p) => /^\S{1,3}\./.test(p))) return [text];

    // Multi-word modifiers like "Tulum / Örgü / Ezine / Tel / Çeçil Peynir" stay inline
    const leadingSingleWords = parts.slice(0, -1).every((p) => p.split(" ").length === 1);
    if (parts.length > 2 && leadingSingleWords) return [text];

    // 2-part modifier pairs like "Siyah / Yeşil Zeytin", "Peynirli / Ispanaklı Börek"
    if (parts.length === 2 && parts[0].split(" ").length === 1) {
      const p0 = trLower(parts[0]);
      if (/(lı|li|lu|lü)$/.test(p0) || /^(siyah|yeşil|beyaz|kırmızı|sade|taze|kaşar|acılı)$/.test(p0)) {
        return [text];
      }
    }

    return parts;
  }

  function currentMealIndicator() {
    const h = hourTr();
    if (h < 7) return { id: "kahvalti", label: "Sıradaki öğün" };
    if (h < 10) return { id: "kahvalti", label: "Güncel öğün" };
    if (h < 11) return { id: "ogle", label: "Sıradaki öğün" };
    if (h < 15) return { id: "ogle", label: "Güncel öğün" };
    if (h < 17) return { id: "aksam", label: "Sıradaki öğün" };
    if (h < 22) return { id: "aksam", label: "Güncel öğün" };
    return null;
  }

  /* ------------------------------------------------------------------------
     DOM & SVG Helpers (XSS-safe: no innerHTML with dynamic data)
     ------------------------------------------------------------------------ */

  const $ = (id) => document.getElementById(id);

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") {
        node.className = v;
      } else if (k === "style" && typeof v === "object") {
        for (const [sk, sv] of Object.entries(v)) {
          if (sk.startsWith("--")) node.style.setProperty(sk, sv);
          else node.style[sk] = sv;
        }
      } else if (k.startsWith("on") && typeof v === "function") {
        node.addEventListener(k.slice(2), v);
      } else {
        node.setAttribute(k, v === true ? "" : String(v));
      }
    }
    for (const child of children.flat(Infinity)) {
      if (child == null || child === false) continue;
      node.append(child.nodeType ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  function svgIcon(name, size = 16) {
    const ns = "http://www.w3.org/2000/svg";
    const s = document.createElementNS(ns, "svg");
    s.setAttribute("viewBox", "0 0 20 20");
    s.setAttribute("fill", "none");
    s.setAttribute("width", String(size));
    s.setAttribute("height", String(size));
    s.setAttribute("aria-hidden", "true");

    const add = (tag, attrs) => {
      const n = document.createElementNS(ns, tag);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
      s.appendChild(n);
    };

    const stroke = { stroke: "currentColor", "stroke-width": "1.6", "stroke-linecap": "round", "stroke-linejoin": "round" };

    switch (name) {
      case "sunrise":
        add("path", { ...stroke, d: "M3 14.5h14M10 4v2.5M4.8 9.2l1.6 1.6M15.2 9.2l-1.6 1.6M6 14.5a4 4 0 0 1 8 0" });
        break;
      case "sun":
        add("circle", { ...stroke, cx: "10", cy: "10", r: "3.4" });
        add("path", { ...stroke, d: "M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.8 4.8l1.4 1.4M13.8 13.8l1.4 1.4M15.2 4.8l-1.4 1.4M6.2 13.8l-1.4 1.4" });
        break;
      case "moon":
        add("path", { ...stroke, d: "M15.8 12.2A6.3 6.3 0 0 1 7.8 4.2a6.3 6.3 0 1 0 8 8Z" });
        break;
      case "chev-left":
        add("path", { ...stroke, d: "M12.5 5 7.5 10l5 5" });
        break;
      case "chev-right":
        add("path", { ...stroke, d: "M7.5 5 12.5 10l-5 5" });
        break;
      case "copy":
        add("rect", { ...stroke, x: "7", y: "7", width: "9.5", height: "9.5", rx: "2" });
        add("path", { ...stroke, d: "M13 7V5a1.5 1.5 0 0 0-1.5-1.5H5A1.5 1.5 0 0 0 3.5 5v6.5A1.5 1.5 0 0 0 5 13h2" });
        break;
      case "external":
        add("path", { ...stroke, d: "M11 4.5h4.5V9M15.5 4.5l-6 6M14 11.5v3a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 4 14.5v-7A1.5 1.5 0 0 1 5.5 6h3" });
        break;
      case "search":
        add("circle", { ...stroke, cx: "9", cy: "9", r: "5.5" });
        add("path", { ...stroke, d: "m13.5 13.5 3.5 3.5" });
        break;
      case "x":
        add("path", { ...stroke, d: "m5.5 5.5 9 9M14.5 5.5l-9 9" });
        break;
      case "flame":
        add("path", { ...stroke, d: "M10.4 3.2c.3 2.4-1.4 3.6-1.4 5.3 0 1 .8 1.8 1.8 1.8s1.7-.7 1.9-1.7c1.4 1.1 2.3 2.6 2.3 4.3a5 5 0 1 1-10 0c0-3 2.2-5.7 5.4-9.7Z" });
        break;
      case "calendar-off":
        add("rect", { ...stroke, x: "3", y: "4.5", width: "14", height: "12.5", rx: "2" });
        add("path", { ...stroke, d: "M3 8.5h14M7 2.8v3M13 2.8v3M8 12.5h4" });
        break;
      case "alert":
        add("circle", { ...stroke, cx: "10", cy: "10", r: "7" });
        add("path", { ...stroke, d: "M10 6.8v4M10 13.4h.01" });
        break;
      default:
        break;
    }
    return s;
  }

  function highlightMatch(text, query) {
    const clean = cleanItemText(text);
    const q = trLower(query.trim());
    if (!q) return document.createTextNode(clean);

    const lower = trLower(clean);
    const frag = document.createDocumentFragment();
    let idx = 0;
    let pos = lower.indexOf(q, idx);
    if (pos === -1) return document.createTextNode(clean);

    while (pos !== -1) {
      if (pos > idx) frag.append(document.createTextNode(clean.slice(idx, pos)));
      frag.append(el("mark", {}, clean.slice(pos, pos + q.length)));
      idx = pos + q.length;
      pos = lower.indexOf(q, idx);
    }
    if (idx < clean.length) frag.append(document.createTextNode(clean.slice(idx)));
    return frag;
  }

  /* ------------------------------------------------------------------------
     Toast & Clipboard
     ------------------------------------------------------------------------ */

  let toastTimer = null;
  function showToast(message) {
    const toast = $("toast");
    toast.textContent = message;
    toast.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2400);
  }

  async function copyText(text, okMessage = "Menü panoya kopyalandı") {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = el("textarea", { style: { position: "fixed", opacity: "0" } });
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }
      showToast(okMessage);
    } catch {
      showToast("Kopyalama başarısız oldu");
    }
  }

  function formatEntryForCopy(dateIso, source, mealName, entry) {
    const m = sourceMeta(source);
    const label = source.meal_labels && source.meal_labels[entry.meal] ? ` (${source.meal_labels[entry.meal]})` : "";
    const lines = [
      `${fmtFullDate.format(isoToDate(dateIso))} — ${m.title}`,
      `${mealName}${label}:`,
      ...entry.items.map((item) => `• ${cleanItemText(item)}`),
    ];
    const extras = [...(entry.notes || [])];
    if (entry.calories) extras.push(entry.calories);
    if (extras.length) lines.push(`Not: ${extras.join(" · ")}`);
    return lines.join("\n");
  }

  function formatDayForCopy(dateIso, sources) {
    const header = `${fmtFullDate.format(isoToDate(dateIso))} — Sivas Yemek`;
    const blocks = [];
    for (const meal of MEALS) {
      const mealLines = [];
      for (const src of sources) {
        const match = src.entries.find((e) => e.date === dateIso && e.meal === meal.id);
        if (!match) continue;
        const m = sourceMeta(src);
        const label = src.meal_labels && src.meal_labels[meal.id] ? ` (${src.meal_labels[meal.id]})` : "";
        mealLines.push(`▪ ${m.title}${label}`);
        for (const item of match.items) mealLines.push(`  • ${cleanItemText(item)}`);
        if (match.calories) mealLines.push(`  (${match.calories})`);
      }
      if (mealLines.length) {
        blocks.push(`[${meal.name}]\n${mealLines.join("\n")}`);
      }
    }
    return blocks.length ? `${header}\n\n${blocks.join("\n\n")}` : header;
  }

  /* ------------------------------------------------------------------------
     App State
     ------------------------------------------------------------------------ */

  const state = {
    data: null,
    view: "daily", // "daily" | "weekly" | "search"
    selectedDate: null,
    sourceFilter: "all", // "all" | source.id
    searchQuery: "",
    allDates: [],
    dateSourceMap: new Map(), // date -> Set(source.id)
  };

  function loadSavedSource() {
    try {
      return localStorage.getItem(STORAGE_SOURCE) || "all";
    } catch {
      return "all";
    }
  }

  function saveSource(val) {
    try {
      localStorage.setItem(STORAGE_SOURCE, val);
    } catch {}
  }

  function activeSources() {
    if (!state.data) return [];
    if (state.sourceFilter === "all") return state.data.sources;
    return state.data.sources.filter((s) => s.id === state.sourceFilter);
  }

  function indexData() {
    const dateSet = new Set();
    const map = new Map();
    for (const src of state.data.sources) {
      for (const e of src.entries) {
        dateSet.add(e.date);
        if (!map.has(e.date)) map.set(e.date, new Set());
        map.get(e.date).add(src.id);
      }
    }
    state.allDates = [...dateSet].sort();
    state.dateSourceMap = map;
  }

  function datesForActiveFilter() {
    if (state.sourceFilter === "all") return state.allDates;
    return state.allDates.filter((d) => {
      const set = state.dateSourceMap.get(d);
      return set && set.has(state.sourceFilter);
    });
  }

  function nextAvailableDate(fromIso, dates) {
    return dates.find((d) => d > fromIso) || dates[dates.length - 1] || null;
  }

  function parseHash() {
    const raw = decodeURIComponent(location.hash.replace(/^#/, ""));
    if (!raw || raw === "bugun") return { view: "daily", date: null };
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { view: "daily", date: raw };
    if (raw === "haftalik") return { view: "weekly", date: null };
    if (raw.startsWith("hafta/")) {
      const d = raw.slice(6);
      if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return { view: "weekly", date: d };
    }
    if (raw === "ara" || raw.startsWith("ara/")) {
      return { view: "search", query: raw.startsWith("ara/") ? raw.slice(4) : "" };
    }
    return { view: "daily", date: null };
  }

  function syncHash() {
    let target = "";
    if (state.view === "daily" && state.selectedDate) {
      target = `#${state.selectedDate}`;
    } else if (state.view === "weekly" && state.selectedDate) {
      target = `#hafta/${state.selectedDate}`;
    } else if (state.view === "search") {
      target = state.searchQuery.trim()
        ? `#ara/${encodeURIComponent(state.searchQuery.trim())}`
        : "#ara";
    }
    if (target && location.hash !== target) {
      history.replaceState(null, "", target);
    }
  }

  function pickInitialDate(requestedDate) {
    const today = todayIso();
    if (requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) return requestedDate;
    if (state.allDates.includes(today) || !state.allDates.length) return today;
    return state.allDates.find((d) => d >= today) || state.allDates[state.allDates.length - 1];
  }

  /* ------------------------------------------------------------------------
     Theme Handling
     ------------------------------------------------------------------------ */

  function currentTheme() {
    return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  }

  function updateThemeButtonLabel() {
    const btn = $("theme-toggle");
    if (!btn) return;
    const isDark = currentTheme() === "dark";
    const label = isDark ? "Aydınlık temaya geç" : "Karanlık temaya geç";
    btn.setAttribute("aria-label", label);
    btn.setAttribute("title", label);
  }

  function toggleTheme() {
    const next = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem(STORAGE_THEME, next);
    } catch {}
    updateThemeButtonLabel();
  }

  /* ------------------------------------------------------------------------
     Header & Source Filter Rendering
     ------------------------------------------------------------------------ */

  function renderViewTabs() {
    document.querySelectorAll(".view-tab").forEach((btn) => {
      const active = btn.dataset.view === state.view;
      btn.setAttribute("aria-selected", String(active));
    });
  }

  function renderSourceFilters() {
    const strip = $("filter-strip");
    const container = $("source-filters");
    if (!state.data || !state.data.sources.length) {
      strip.hidden = true;
      return;
    }
    strip.hidden = false;

    const pills = [
      el(
        "button",
        {
          type: "button",
          class: "filter-pill",
          "aria-pressed": String(state.sourceFilter === "all"),
          onclick: () => setSourceFilter("all"),
        },
        "Tüm Yemekhaneler"
      ),
      ...state.data.sources.map((src) => {
        const meta = sourceMeta(src);
        return el(
          "button",
          {
            type: "button",
            class: "filter-pill filter-pill-source",
            "aria-pressed": String(state.sourceFilter === src.id),
            style: {
              "--pill-color": meta.color,
              "--pill-soft": meta.soft,
              "--pill-ink": meta.ink,
            },
            onclick: () => setSourceFilter(src.id),
          },
          el("span", { class: "filter-dot", "aria-hidden": "true" }),
          meta.short
        );
      }),
    ];

    container.replaceChildren(...pills);
  }

  /* ------------------------------------------------------------------------
     Daily View Rendering
     ------------------------------------------------------------------------ */

  function buildMenuCard(source, meal, entry) {
    const meta = sourceMeta(source);
    const mealLabel = source.meal_labels && source.meal_labels[entry.meal];

    const subPills = [];
    if (mealLabel) {
      subPills.push(el("span", { class: "sub-pill" }, mealLabel));
    }
    if (entry.calories) {
      subPills.push(el("span", { class: "sub-pill kcal" }, svgIcon("flame", 12), entry.calories));
    }

    const listItems = entry.items.map((rawItem, idx) => {
      const alts = parseAlternatives(rawItem);
      const body =
        alts.length > 1
          ? el(
              "div",
              { class: "alt-list" },
              alts.map((alt, i) =>
                el(
                  "div",
                  { class: "alt-option" },
                  i > 0 ? el("span", { class: "alt-or" }, "veya") : null,
                  el("span", {}, alt)
                )
              )
            )
          : el("span", { class: "menu-item-single" }, alts[0]);

      return el(
        "li",
        { class: "menu-item" },
        el("span", { class: "menu-item-idx", "aria-hidden": "true" }, String(idx + 1)),
        el("div", { class: "menu-item-body" }, body)
      );
    });

    const notes = entry.notes || [];

    return el(
      "article",
      {
        class: "menu-card",
        style: {
          "--card-accent": meta.color,
          "--card-accent-soft": meta.soft,
          "--card-accent-ink": meta.ink,
        },
      },
      el(
        "header",
        { class: "card-head" },
        el(
          "div",
          { class: "card-source-wrap" },
          el(
            "h3",
            { class: "card-source-name" },
            el("span", { class: "card-source-dot", "aria-hidden": "true" }),
            meta.title
          ),
          subPills.length ? el("div", { class: "card-sub-pills" }, subPills) : null
        ),
        el(
          "button",
          {
            type: "button",
            class: "card-copy-btn",
            "aria-label": `${meta.title} ${meal.name} menüsünü kopyala`,
            title: "Menüyü kopyala",
            onclick: () => copyText(formatEntryForCopy(state.selectedDate, source, meal.name, entry)),
          },
          svgIcon("copy", 15)
        )
      ),
      el("ul", { class: "menu-list" }, listItems),
      notes.length
        ? el(
            "footer",
            { class: "card-foot" },
            notes.map((n) => el("span", { class: "note-chip" }, n))
          )
        : null
    );
  }

  function renderDateStrip(today) {
    const stripDates = state.allDates.includes(today)
      ? state.allDates
      : [...state.allDates, today].sort();

    const sources = activeSources();
    const children = [];
    let lastMonth = null;

    for (const d of stripDates) {
      const dt = isoToDate(d);
      const ym = d.slice(0, 7);
      if (lastMonth !== null && ym !== lastMonth) {
        children.push(el("div", { class: "month-marker", "aria-hidden": "true" }, fmtMonthShort.format(dt)));
      }
      lastMonth = ym;

      const availableSources = state.dateSourceMap.get(d);
      const dots = sources
        .filter((src) => availableSources && availableSources.has(src.id))
        .map((src) =>
          el("span", {
            class: "dp-dot",
            style: { background: sourceMeta(src).color },
          })
        );

      const isToday = d === today;
      const isSelected = d === state.selectedDate;
      const pill = el(
        "button",
        {
          type: "button",
          class: `day-pill${isToday ? " is-today" : ""}${isWeekend(d) ? " is-weekend" : ""}`,
          "aria-pressed": String(isSelected),
          "aria-label": `${fmtFullDate.format(dt)}${isToday ? ", bugün" : ""}`,
          "data-date": d,
          onclick: () => selectDate(d),
        },
        el("span", { class: "dp-wd" }, isToday ? "Bugün" : fmtWdShort.format(dt)),
        el("span", { class: "dp-num" }, String(Number(d.slice(8)))),
        el("span", { class: "dp-dots", "aria-hidden": "true" }, dots)
      );
      children.push(pill);
    }

    const nav = el("nav", { class: "date-strip", id: "date-strip", "aria-label": "Gün seçimi" }, children);
    return el("div", { class: "date-strip-shell" }, nav);
  }

  function renderDailyView() {
    const root = $("main-content");
    const today = todayIso();
    const d = state.selectedDate;
    const dt = isoToDate(d);
    const diff = dayDiff(d, today);
    const sources = activeSources();

    // Collect meal sections
    const liveMeal = diff === 0 ? currentMealIndicator() : null;
    let totalCards = 0;
    const activeSourceIdsToday = new Set();

    const sections = MEALS.map((meal) => {
      const cards = [];
      for (const src of sources) {
        const entry = src.entries.find((e) => e.date === d && e.meal === meal.id);
        if (entry) {
          cards.push(buildMenuCard(src, meal, entry));
          totalCards += 1;
          activeSourceIdsToday.add(src.id);
        }
      }
      if (!cards.length) return null;

      const isLive = liveMeal && liveMeal.id === meal.id;
      return el(
        "section",
        { class: "meal-section", "aria-labelledby": `meal-${meal.id}` },
        el(
          "div",
          { class: "meal-header" },
          el(
            "div",
            { class: "meal-title-wrap" },
            el("span", { class: "meal-icon" }, svgIcon(meal.icon, 18)),
            el("h2", { class: "meal-title", id: `meal-${meal.id}` }, meal.name),
            isLive
              ? el(
                  "span",
                  { class: "meal-live-badge" },
                  el("span", { class: "meal-live-dot", "aria-hidden": "true" }),
                  liveMeal.label
                )
              : null
          ),
          el("span", { class: "meal-count" }, `${cards.length} yemekhane`)
        ),
        el("div", { class: "cards-grid" }, cards)
      );
    }).filter(Boolean);

    // Relative label badge
    let relText = null;
    let relMuted = false;
    if (diff === 0) relText = "Bugün";
    else if (diff === 1) relText = "Yarın";
    else if (diff === -1) {
      relText = "Dün";
      relMuted = true;
    } else if (diff < 0) {
      relText = `${Math.abs(diff)} gün önce`;
      relMuted = true;
    } else {
      relText = `${diff} gün sonra`;
    }

    const summaryText =
      totalCards > 0
        ? `${activeSourceIdsToday.size} yemekhane · ${totalCards} öğün`
        : "Bu gün için menü yok";

    // Prev / Next navigation bounds
    const dateIdx = state.allDates.indexOf(d);
    const prevDate = dateIdx > 0 ? state.allDates[dateIdx - 1] : addDays(d, -1);
    const nextDate = dateIdx >= 0 && dateIdx < state.allDates.length - 1 ? state.allDates[dateIdx + 1] : addDays(d, 1);
    const minDate = state.allDates[0];
    const maxDate = state.allDates[state.allDates.length - 1];
    const canPrev = !minDate || d > minDate;
    const canNext = !maxDate || d < maxDate;

    const hero = el(
      "section",
      { class: "daily-hero", "aria-label": "Seçili gün" },
      el(
        "div",
        { class: "daily-hero-text" },
        el(
          "div",
          { class: "date-badges" },
          el("span", { class: `rel-badge${relMuted ? " muted" : ""}` }, relText),
          el("span", { class: "meta-summary" }, summaryText)
        ),
        el("h1", { class: "date-heading" }, fmtFullDate.format(dt))
      ),
      el(
        "div",
        { class: "daily-controls" },
        el(
          "div",
          { class: "btn-group" },
          el(
            "button",
            {
              type: "button",
              disabled: !canPrev,
              "aria-label": "Önceki gün",
              title: "Önceki gün (←)",
              onclick: () => canPrev && selectDate(prevDate),
            },
            svgIcon("chev-left", 16)
          ),
          el(
            "button",
            {
              type: "button",
              disabled: diff === 0,
              onclick: () => selectDate(today),
            },
            "Bugün"
          ),
          el(
            "button",
            {
              type: "button",
              disabled: !canNext,
              "aria-label": "Sonraki gün",
              title: "Sonraki gün (→)",
              onclick: () => canNext && selectDate(nextDate),
            },
            svgIcon("chev-right", 16)
          )
        ),
        totalCards > 0
          ? el(
              "button",
              {
                type: "button",
                class: "btn",
                onclick: () => copyText(formatDayForCopy(d, sources), "Günün menüsü panoya kopyalandı"),
              },
              svgIcon("copy", 15),
              "Günü kopyala"
            )
          : null
      )
    );

    // Late evening nudge on Today to jump to Tomorrow
    const tomorrow = addDays(today, 1);
    const showEveningNudge = diff === 0 && hourTr() >= 21 && state.allDates.includes(tomorrow);
    const nudge = showEveningNudge
      ? el(
          "div",
          { class: "evening-nudge" },
          el("span", {}, "Akşam yemeği saati geçti. Yarının menüsüne göz atmak ister misiniz?"),
          el(
            "button",
            { type: "button", class: "btn btn-primary", onclick: () => selectDate(tomorrow) },
            "Yarının menüsü",
            svgIcon("chev-right", 15)
          )
        )
      : null;

    // Empty state
    let body;
    if (sections.length) {
      body = el("div", { class: "meals-stack" }, sections);
    } else {
      const filteredDates = datesForActiveFilter();
      const nextAvail = nextAvailableDate(d, filteredDates);
      const isWeekendCu = state.sourceFilter === "cu" && isWeekend(d);
      const emptyMsg = isWeekendCu
        ? "Cumhuriyet Üniversitesi öğrenci yemekhanesi hafta sonları hizmet vermemektedir."
        : state.sourceFilter !== "all"
          ? "Seçili yemekhane için bu tarihte yayınlanmış bir menü bulunmuyor."
          : "Bu tarih için yayınlanmış bir yemek listesi bulunmuyor.";

      body = el(
        "div",
        { class: "state-card" },
        el("div", { class: "state-icon" }, svgIcon("calendar-off", 22)),
        el("h2", {}, "Menü bulunamadı"),
        el("p", {}, emptyMsg),
        el(
          "div",
          { class: "state-actions" },
          nextAvail && nextAvail !== d
            ? el(
                "button",
                { type: "button", class: "btn btn-primary", onclick: () => selectDate(nextAvail) },
                `${fmtDayMonth.format(isoToDate(nextAvail))} menüsüne git`
              )
            : null,
          state.sourceFilter !== "all"
            ? el(
                "button",
                { type: "button", class: "btn", onclick: () => setSourceFilter("all") },
                "Tüm yemekhaneleri göster"
              )
            : null,
          diff !== 0
            ? el("button", { type: "button", class: "btn", onclick: () => selectDate(today) }, "Bugüne dön")
            : null
        )
      );
    }

    const dateStrip = renderDateStrip(today);
    root.replaceChildren(...[hero, nudge, dateStrip, body].filter(Boolean));

    document.title = `${fmtFullDate.format(dt)} · Sivas Yemek`;

    // Center active day in horizontal strip
    requestAnimationFrame(() => {
      const activePill = root.querySelector('#date-strip .day-pill[aria-pressed="true"]');
      if (activePill) {
        activePill.scrollIntoView({ block: "nearest", inline: "center", behavior: "auto" });
      }
    });
  }

  /* ------------------------------------------------------------------------
     Weekly View Rendering
     ------------------------------------------------------------------------ */

  function renderWeeklyView() {
    const root = $("main-content");
    const today = todayIso();
    const monday = mondayOfWeek(state.selectedDate);
    const sunday = addDays(monday, 6);
    const weekDays = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
    const sources = activeSources();

    const sameMonth = monday.slice(0, 7) === sunday.slice(0, 7);
    const rangeLabel = sameMonth
      ? `${Number(monday.slice(8))} – ${Number(sunday.slice(8))} ${fmtMonthYear.format(isoToDate(sunday))}`
      : `${fmtDayMonth.format(isoToDate(monday))} – ${fmtDayMonth.format(isoToDate(sunday))} ${sunday.slice(0, 4)}`;

    const isCurrentWeek = monday === mondayOfWeek(today);

    const header = el(
      "section",
      { class: "week-header" },
      el(
        "div",
        {},
        el("h1", { class: "week-title" }, rangeLabel),
        el(
          "p",
          { class: "week-sub" },
          state.sourceFilter === "all"
            ? "Tüm yemekhanelerin haftalık özeti · Detay için herhangi bir güne tıklayın"
            : `${sourceMeta(sources[0]).title} haftalık özeti`
        )
      ),
      el(
        "div",
        { class: "btn-group" },
        el(
          "button",
          {
            type: "button",
            "aria-label": "Önceki hafta",
            onclick: () => {
              state.selectedDate = addDays(monday, -7);
              syncHash();
              renderWeeklyView();
            },
          },
          svgIcon("chev-left", 16),
          "Önceki"
        ),
        el(
          "button",
          {
            type: "button",
            disabled: isCurrentWeek,
            onclick: () => {
              state.selectedDate = today;
              syncHash();
              renderWeeklyView();
            },
          },
          "Bu Hafta"
        ),
        el(
          "button",
          {
            type: "button",
            "aria-label": "Sonraki hafta",
            onclick: () => {
              state.selectedDate = addDays(monday, 7);
              syncHash();
              renderWeeklyView();
            },
          },
          "Sonraki",
          svgIcon("chev-right", 16)
        )
      )
    );

    const dayCards = weekDays.map((d) => {
      const dt = isoToDate(d);
      const isToday = d === today;
      const blocks = [];

      for (const meal of MEALS) {
        for (const src of sources) {
          const entry = src.entries.find((e) => e.date === d && e.meal === meal.id);
          if (!entry) continue;
          const meta = sourceMeta(src);
          blocks.push(
            el(
              "div",
              { class: "week-meal-block" },
              el(
                "div",
                { class: "week-meal-meta" },
                el(
                  "span",
                  { class: "week-source-tag", style: { "--tag-ink": meta.ink } },
                  el("span", { class: "filter-dot", style: { "--pill-color": meta.color } }),
                  meta.short
                ),
                el("span", { class: "week-meal-tag" }, meal.name)
              ),
              el(
                "ul",
                { class: "week-items-list" },
                entry.items.map((item) => el("li", {}, cleanItemText(item)))
              )
            )
          );
        }
      }

      return el(
        "article",
        { class: `week-day-card${isToday ? " is-today" : ""}${!blocks.length ? " is-empty" : ""}` },
        el(
          "button",
          {
            type: "button",
            class: "week-day-head",
            onclick: () => {
              state.selectedDate = d;
              setView("daily");
            },
          },
          el(
            "span",
            { class: "week-day-name" },
            fmtWdLong.format(dt),
            isToday ? el("span", { class: "rel-badge" }, "Bugün") : null
          ),
          el("span", { class: "week-day-date" }, fmtDayMonth.format(dt))
        ),
        el(
          "div",
          { class: "week-day-body" },
          blocks.length ? blocks : el("p", { class: "week-empty-note" }, "Bu gün için kayıtlı menü yok.")
        )
      );
    });

    root.replaceChildren(header, el("div", { class: "week-grid" }, dayCards));
    document.title = `Haftalık Menü (${rangeLabel}) · Sivas Yemek`;
  }

  /* ------------------------------------------------------------------------
     Search View Rendering
     ------------------------------------------------------------------------ */

  function availableQuickChips() {
    const sources = activeSources();
    return POPULAR_QUERIES.filter((q) => {
      const nq = trLower(q);
      return sources.some((s) => s.entries.some((e) => e.items.some((i) => trLower(i).includes(nq))));
    });
  }

  function renderSearchResults() {
    const resultsWrap = $("search-results");
    if (!resultsWrap) return;

    const query = state.searchQuery.trim();
    const clearBtn = $("search-clear-btn");
    if (clearBtn) clearBtn.hidden = !query;

    if (query.length < 2) {
      resultsWrap.replaceChildren(
        el(
          "div",
          { class: "state-card" },
          el("div", { class: "state-icon" }, svgIcon("search", 22)),
          el("h2", {}, "Menülerde arayın"),
          el(
            "p",
            {},
            "Sevdiğiniz yemeğin hangi gün ve hangi yemekhanede çıktığını görmek için en az 2 harf yazın veya yukarıdaki popüler etiketlerden birini seçin."
          )
        )
      );
      return;
    }

    const q = trLower(query);
    const today = todayIso();
    const sources = activeSources();
    const matches = [];

    for (const src of sources) {
      for (const entry of src.entries) {
        const hit =
          entry.items.some((item) => trLower(item).includes(q)) ||
          (entry.notes && entry.notes.some((n) => trLower(n).includes(q)));
        if (hit) {
          matches.push({ src, entry });
        }
      }
    }

    if (!matches.length) {
      resultsWrap.replaceChildren(
        el(
          "div",
          { class: "state-card" },
          el("div", { class: "state-icon" }, svgIcon("search", 22)),
          el("h2", {}, "Eşleşen yemek bulunamadı"),
          el("p", {}, `“${query}” için kayıtlı menülerde bir sonuç yok.`),
          state.sourceFilter !== "all"
            ? el(
                "div",
                { class: "state-actions" },
                el(
                  "button",
                  { type: "button", class: "btn btn-primary", onclick: () => setSourceFilter("all") },
                  "Tüm yemekhanelerde ara"
                )
              )
            : null
        )
      );
      return;
    }

    const mealOrder = { kahvalti: 0, ogle: 1, aksam: 2 };
    const upcoming = matches
      .filter((m) => m.entry.date >= today)
      .sort((a, b) => a.entry.date.localeCompare(b.entry.date) || mealOrder[a.entry.meal] - mealOrder[b.entry.meal]);
    const past = matches
      .filter((m) => m.entry.date < today)
      .sort((a, b) => b.entry.date.localeCompare(a.entry.date) || mealOrder[a.entry.meal] - mealOrder[b.entry.meal]);

    const buildResultCard = ({ src, entry }, isPast) => {
      const meta = sourceMeta(src);
      const mealObj = MEALS.find((m) => m.id === entry.meal);
      const isToday = entry.date === today;

      return el(
        "button",
        {
          type: "button",
          class: `search-result-card${isPast ? " is-past" : ""}`,
          onclick: () => {
            state.selectedDate = entry.date;
            setView("daily");
          },
        },
        el(
          "div",
          { class: "search-result-meta" },
          el(
            "span",
            { class: "search-result-date" },
            fmtFullDate.format(isoToDate(entry.date)),
            isToday ? el("span", { class: "rel-badge" }, "Bugün") : null
          ),
          el(
            "span",
            { class: "search-result-source" },
            el("span", { class: "filter-dot", style: { "--pill-color": meta.color } }),
            `${meta.short} · ${mealObj ? mealObj.name : entry.meal}`
          )
        ),
        el(
          "div",
          { class: "search-result-items" },
          entry.items.map((item) => {
            const matched = trLower(item).includes(q);
            return el("span", { class: matched ? "is-match" : null }, highlightMatch(item, query));
          })
        )
      );
    };

    const blocks = [];
    if (upcoming.length) {
      blocks.push(
        el("div", { class: "search-group-title" }, el("span", {}, "Bugün ve yaklaşan günler"), el("span", {}, `${upcoming.length} sonuç`)),
        el("div", { class: "search-results-list" }, upcoming.map((m) => buildResultCard(m, false)))
      );
    }
    if (past.length) {
      blocks.push(
        el("div", { class: "search-group-title" }, el("span", {}, "Geçmiş günler"), el("span", {}, `${past.length} sonuç`)),
        el("div", { class: "search-results-list" }, past.map((m) => buildResultCard(m, true)))
      );
    }

    resultsWrap.replaceChildren(...blocks);
  }

  function renderSearchView(autoFocus = false) {
    const root = $("main-content");
    const chips = availableQuickChips();

    const input = el("input", {
      type: "search",
      id: "search-input",
      class: "search-input",
      placeholder: "Yemek adı yazın… (ör. Sivas köfte, baklava, mantı)",
      value: state.searchQuery,
      autocomplete: "off",
      spellcheck: "false",
      "aria-label": "Menülerde yemek ara",
      oninput: (e) => {
        state.searchQuery = e.target.value;
        syncHash();
        renderSearchResults();
      },
    });

    const clearBtn = el(
      "button",
      {
        type: "button",
        id: "search-clear-btn",
        class: "search-clear",
        hidden: !state.searchQuery.trim(),
        "aria-label": "Aramayı temizle",
        onclick: () => {
          state.searchQuery = "";
          input.value = "";
          syncHash();
          renderSearchResults();
          input.focus();
        },
      },
      svgIcon("x", 15)
    );

    const shell = el(
      "div",
      { class: "search-shell" },
      el(
        "div",
        { class: "search-hero" },
        el("h1", { class: "search-title" }, "Menülerde Ara"),
        el(
          "p",
          { class: "search-sub" },
          "Yayınlanan tüm tarihlerde hangi yemeğin ne zaman ve nerede çıkacağını anında bulun."
        )
      ),
      el(
        "div",
        { class: "search-box" },
        el("span", { class: "search-box-icon" }, svgIcon("search", 18)),
        input,
        clearBtn
      ),
      chips.length
        ? el(
            "div",
            { class: "quick-chips" },
            el("span", { class: "quick-chips-label" }, "Hızlı ara:"),
            chips.map((label) =>
              el(
                "button",
                {
                  type: "button",
                  class: "chip-btn",
                  onclick: () => {
                    state.searchQuery = label;
                    input.value = label;
                    syncHash();
                    renderSearchResults();
                  },
                },
                label
              )
            )
          )
        : null,
      el("div", { id: "search-results" })
    );

    root.replaceChildren(shell);
    renderSearchResults();
    document.title = "Menülerde Ara · Sivas Yemek";

    if (autoFocus) {
      requestAnimationFrame(() => input.focus());
    }
  }

  /* ------------------------------------------------------------------------
     Footer & Source Status Rendering
     ------------------------------------------------------------------------ */

  function renderFooterStatus() {
    const list = $("source-status-list");
    const headerSync = $("header-sync");
    const footerGen = $("footer-generated");

    const cards = state.data.sources.map((src) => {
      const meta = sourceMeta(src);
      let badgeClass = "pending";
      let badgeText = "Bekleniyor";
      let detail = "İlk veri güncellemesi bekleniyor.";

      if (src.ok === true && src.last_success) {
        badgeClass = "ok";
        badgeText = "Güncel";
        detail = `Son güncelleme: ${fmtStamp.format(new Date(src.last_success))} (${src.entries.length} öğün kaydı).`;
      } else if (src.ok === false && src.last_success) {
        badgeClass = "warn";
        badgeText = "Önbellek";
        const nextStr = src.next_run ? fmtTimeOnly.format(new Date(src.next_run)) : "yakında";
        detail = `Kaynak şu an yanıt vermiyor; ${fmtStamp.format(new Date(src.last_success))} tarihli liste gösteriliyor. Sonraki deneme: ${nextStr}.`;
      } else if (src.ok === false) {
        badgeClass = "err";
        badgeText = "Erişilemiyor";
        const nextStr = src.next_run ? fmtTimeOnly.format(new Date(src.next_run)) : "yakında";
        detail = `Veri henüz alınamadı. Sonraki deneme: ${nextStr}.`;
      }

      return el(
        "li",
        { class: "status-card" },
        el(
          "div",
          { class: "status-card-top" },
          el(
            "a",
            {
              href: src.url,
              class: "status-source-link",
              target: "_blank",
              rel: "noopener noreferrer",
            },
            el("span", { class: "filter-dot", style: { "--pill-color": meta.color } }),
            meta.title,
            svgIcon("external", 13)
          ),
          el("span", { class: `status-pill ${badgeClass}` }, badgeText)
        ),
        el("p", { class: "status-detail" }, detail)
      );
    });

    list.replaceChildren(...cards);

    const lastSuccessTimes = state.data.sources.map((s) => s.last_success).filter(Boolean).sort();
    if (lastSuccessTimes.length) {
      const latest = fmtStamp.format(new Date(lastSuccessTimes[lastSuccessTimes.length - 1]));
      headerSync.textContent = `Güncellendi · ${latest}`;
      footerGen.textContent = `Son senkronizasyon: ${latest}`;
    } else {
      headerSync.textContent = "Veri bekleniyor";
      footerGen.textContent = "";
    }
  }

  /* ------------------------------------------------------------------------
     State Transitions
     ------------------------------------------------------------------------ */

  function renderCurrentView(opts = {}) {
    renderViewTabs();
    renderSourceFilters();
    if (state.view === "daily") renderDailyView();
    else if (state.view === "weekly") renderWeeklyView();
    else if (state.view === "search") renderSearchView(Boolean(opts.autoFocusSearch));
  }

  function setView(view, opts = {}) {
    state.view = view;
    syncHash();
    renderCurrentView(opts);
  }

  function selectDate(iso) {
    state.selectedDate = iso;
    if (state.view !== "daily") state.view = "daily";
    syncHash();
    renderCurrentView();
  }

  function setSourceFilter(sourceId) {
    state.sourceFilter = sourceId;
    saveSource(sourceId);
    renderSourceFilters();
    if (state.view === "search") {
      // Keep input intact, just refresh chips/results
      renderSearchView(false);
    } else {
      renderCurrentView();
    }
  }

  /* ------------------------------------------------------------------------
     Error State & Boot
     ------------------------------------------------------------------------ */

  function renderLoadError() {
    $("header-sync").textContent = "Bağlantı hatası";
    $("filter-strip").hidden = true;
    $("main-content").replaceChildren(
      el(
        "div",
        { class: "state-card" },
        el("div", { class: "state-icon" }, svgIcon("alert", 24)),
        el("h2", {}, "Menüler yüklenemedi"),
        el("p", {}, "Sunucuya şu an ulaşılamıyor. İnternet bağlantınızı kontrol edip tekrar deneyebilirsiniz."),
        el(
          "div",
          { class: "state-actions" },
          el(
            "button",
            { type: "button", class: "btn btn-primary", onclick: () => loadData() },
            "Tekrar dene"
          )
        )
      )
    );
  }

  async function loadData() {
    try {
      const res = await fetch("/api/menus.json", { cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      state.data = await res.json();
    } catch {
      renderLoadError();
      return;
    }

    indexData();

    // Validate persisted source filter against actual backend sources
    const savedSrc = loadSavedSource();
    const validIds = new Set(state.data.sources.map((s) => s.id));
    state.sourceFilter = savedSrc !== "all" && validIds.has(savedSrc) ? savedSrc : "all";

    const parsed = parseHash();
    state.view = parsed.view;
    state.selectedDate = pickInitialDate(parsed.date);
    if (parsed.query) state.searchQuery = parsed.query;

    renderFooterStatus();
    renderCurrentView();
    syncHash();
  }

  /* ------------------------------------------------------------------------
     Event Wiring
     ------------------------------------------------------------------------ */

  function initEvents() {
    updateThemeButtonLabel();

    $("theme-toggle").addEventListener("click", toggleTheme);

    $("brand-home").addEventListener("click", (e) => {
      e.preventDefault();
      if (!state.data) return;
      state.selectedDate = pickInitialDate(todayIso());
      setView("daily");
    });

    document.querySelectorAll(".view-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (!state.data) return;
        const target = btn.dataset.view;
        setView(target, { autoFocusSearch: target === "search" });
      });
    });

    window.addEventListener("hashchange", () => {
      if (!state.data) return;
      const parsed = parseHash();
      state.view = parsed.view;
      if (parsed.date) state.selectedDate = parsed.date;
      if (parsed.query !== undefined) state.searchQuery = parsed.query;
      renderCurrentView();
    });

    document.addEventListener("keydown", (e) => {
      if (!state.data) return;
      const tag = document.activeElement && document.activeElement.tagName;
      const isTyping = tag === "INPUT" || tag === "TEXTAREA" || (document.activeElement && document.activeElement.isContentEditable);

      if (e.key === "/" && !isTyping && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setView("search", { autoFocusSearch: true });
        return;
      }

      if (isTyping || e.ctrlKey || e.metaKey || e.altKey) return;

      if (state.view === "daily" && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        const delta = e.key === "ArrowLeft" ? -1 : 1;
        const idx = state.allDates.indexOf(state.selectedDate);
        let next = null;
        if (idx >= 0) {
          next = state.allDates[idx + delta] || null;
        } else {
          next = addDays(state.selectedDate, delta);
        }
        if (next) {
          e.preventDefault();
          selectDate(next);
        }
      }
    });
  }

  initEvents();
  loadData();
})();
