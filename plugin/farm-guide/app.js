// Farm Guide: where to farm each pet's souls, in what order, with a map, and what each area pays.
// Counts come from the game through three decoders (pet-list at login, soul-gained, level-up);
// a fourth (map-load) says when you're inside a dungeon.
(function () {
  "use strict";
  const D = FG_DATA, E = FGEngine;
  // FG_HOST is set by the Farm Guide Overlay app (its own window over the game); absent in A2 Tools.
  const HOST = window.FG_HOST || null;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const h = (tag, cls, text) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
  };
  const els = {
    top: $(".top"), prev: $(".nav.prev"), next: $(".nav.next"), stopno: $(".stopno"), zone: $(".zone"),
    t2: $(".t2"), sub: $(".t2 .sub"), flash: $(".t2 .flash"), tabs: $(".tabs"),
    card: $(".card"), dial: $(".dial"), ringFill: $(".ring .fill"), mobImg: $(".dial .mob img"), badge: $(".dial .badge"),
    badgeImg: $(".dial .badge img"), pct: $(".dial .pct"), verb: $(".kill .verb"), mobname: $(".mobname"), per: $(".kill .per"),
    petname: $(".petname"), roll: $(".petline .roll"), left: $(".petline .left"), lv: $(".lvline .lv"), lvbar: $(".lvline .bar i"),
    pts: $(".lvline .pts"), kills: $(".kills"), travel: $(".travel"), arrow: $(".travel .arrow"), tp: $(".travel .tp"),
    walk: $(".travel .walk"), trnote: $(".travel .trnote"), alike: $(".info .alike"), queue: $(".queue"), mapwrap: $(".mapwrap"), mapzone: $(".mapzone"), mapgrip: $(".mapgrip"), mbShape: $(".mb-shape"), mbLoop: $(".mb-loop"), mbIcons: $(".mb-icons"), loot: $(".loot"), emptyGuide: $(".empty-guide"),
    search: $(".search"), filter: $(".chips.filter"), petlist: $(".petlist"), stats: $('[data-pane="stats"]'),
    settings: $(".settings"), ver: $(".credit .ver"), toasts: $("#toasts"),
    tip: $(".tip"), tipmob: $(".tipmob"), tipsub: $(".tipsub"), tipring: $(".tipring .f"), tippet: $(".tippet"), tipmobimg: $(".tipmobimg"), tipnav: $(".tipnav"), tipstreak: $(".tipstreak"),
    foldbtn: $(".foldbtn"), sizebtn: $(".sizebtn"), cgrip: $(".cgrip"), maptitle: $(".maptitle"),
    title: $(".top .title"), sl: $(".stoplist"), slSeg: $(".sl-seg"), slFind: $(".sl-find"), slDone: $(".sl-done"), slSum: $(".sl-sum"), slBody: $(".sl-body"),
    track: $(".loot .track"), ticker: $(".loot .ticker"), notice: $(".notice"), suggest: $(".suggest"), streak: $(".dial .streak"),
    qwrap: $(".qwrap"), qstyle: $(".qstyle"), editbtn: $(".editbtn"), editbar: $(".editbar"), editpop: $(".editpop"),
  };
  const RING = 2 * Math.PI * 46;
  const QRING = 2 * Math.PI * 19;
  const RARITY = ["#C3C3C3", "#19E048", "#379AFF", "#FFD02B", "#C57CFF"];
  const RARITY_NAME = ["Common", "Rare", "Legend", "Unique", "Special"];

  // ── state ────────────────────────────────────────────────────
  const DEFAULTS = {
    faction: "auto", goal: 3, order: "priority", priority: ["cogni", "natura", "fera", "varian"], rift: true,
    levelPenalty: false, myLevel: 0, autoNext: true, effects: true, sounds: true, volume: 0.5, map: true, filter: "todo",
    loot: true, freeAuto: true, freeAfter: 3, locked: false, smartOpen: true, theme: "classic", tip: false, tipPos: "bottom", tipAuto: 0, tipIdle: 3, folded: false,
    mapShape: null, mapSize: null, mapFold: false, mapLoop: true, mapIcons: true, tipResume: "open", sOpen: { you: true },
    dungeonFold: "fold", slShowDone: false, riftAlert: "on", abyssAlert: "on",
    // sizes: the open guide is compact or full (folded is the tip); farmSize is what to go back to
    // once you're farming, compactMap shows the map in compact, mapWhen: "always" | "way" (full only)
    view: "compact", farmSize: "compact", compactMap: false, mapWhen: "always", cw: 0, gw: 0,
    // the monster list as rings or bars; the layout you set in edit mode (overlay), per size:
    // { compact: { part: { x, y, w, s, pic, hide } }, full: {…} }
    qStyle: "ring", layout: null,
    // per-part options: directions "full" | "short" (the teleport only), the loot strip "all" |
    // "rare" (rare and up), finished monsters in the list shown or not
    travelText: "full", lootMin: "all", qDone: true,
    // the monster's level bar and kills line, the map's see-through level, at most N monsters in
    // the list (0: all), a slim one-line header
    showLv: true, showKills: true, mapAlpha: 1, qMax: 0, slimHead: false,
    // the tour: the tips you've seen (by id), or none ever again
    tourSeen: [], tourOff: false,
  };
  let prefs = { ...DEFAULTS };
  let character = null;
  let key = null; // storage key of the server shown
  let pets = { levels: {}, points: {}, syncedAt: 0 };
  let rstate = { cur: null, base: {}, seen: {} };
  let log = []; // [time, pet, amount, area, map]
  let levelLog = []; // [time, pet, level]
  let route = []; // the route the guide follows now: routes[mode]
  // Three routes: the main one (your side's map), the Abyss route (Lower Reshanta, the PvP zone,
  // from Lv 45) and the Rift route (the other side's map, for when a Rift is open). The main one
  // first; the Abyss one when you go in; the Rift one when you're over there.
  let routes = { main: [], abyss: [], rift: [] }, mode = "main";
  const MODES = ["main", "abyss", "rift"];
  const MODE_ICON = { main: "🧭 ", abyss: "⚔️ ", rift: "🌀 " };
  const MODE_NAME = { main: "Main route", abyss: "Abyss route", rift: "Rift route" };
  // the Abyss opens at Lv 45 (unknown level: let it through)
  const abyssOpen = () => { const ab = D.community && D.community.abyss, lv = settings().myLevel; return !ab || !lv || lv >= ab.minLevel; };
  // where to go when a route is done: the next one with work
  function nextRoute(from) {
    const order = from === "main" ? ["abyss", "rift"] : from === "abyss" ? ["main", "rift"] : ["main", "abyss"];
    return order.find((m) => (m !== "abyss" || abyssOpen()) && routes[m].some(hasWork)) || null;
  }
  let idx = 0;
  let guide = null; // { pid, spots, i }
  let tab = "guide";
  document.body.dataset.tab = "guide";
  let lang = "en";
  let readyAt = Infinity;
  let focusPick = null; // pet picked by clicking the queue
  let busy = false; // a stop-complete sequence is running
  let model = null;
  const qEls = new Map();
  const spotCache = new Map();

  // ── helpers ──────────────────────────────────────────────────
  const petName = (pid) => { const n = D.pets[pid]?.n || {}; return n[lang] || n.en || `Pet #${pid}`; };
  const genusOf = (pid) => D.pets[pid]?.g || "special";
  const colorOf = (pid) => E.GENUS_COLOR[genusOf(pid)];
  const portrait = (pid) => `img/p/${pid}.webp`;
  const mobArt = (npc) => { const m = D.mobs[npc]; return !m ? "" : m.artPet && m.pet ? portrait(m.pet) : m.art ? `img/m/${m.art}` : ""; };
  const level = (pid) => Math.min(E.MAX_LEVEL, pets.levels[pid] || 0);
  const pointsOf = (pid) => pets.points[pid] || 0;
  const leftOf = (pid) => E.soulsLeft(level(pid), pointsOf(pid), prefs.goal);
  const serverOf = (k) => Number(String(k || "").match(/^server-(\d+)/)?.[1]) || 0;
  function faction() {
    if (prefs.faction !== "auto") return prefs.faction;
    const s = serverOf(key) || Number(character?.serverId) || 0;
    return s >= 2000 && s < 3000 ? "asmodian" : "elyos";
  }
  const settings = () => ({
    faction: faction(), goal: prefs.goal, order: prefs.order, priority: prefs.priority, rift: prefs.rift,
    levelPenalty: prefs.levelPenalty, myLevel: prefs.myLevel || Number(character?.level) || 0,
  });
  const fmtPct = (p) => (p >= 10 ? `${Math.round(p)}%` : p >= 1 ? `${p.toFixed(1)}%` : `${p.toFixed(2)}%`);
  const fmtDur = (ms) => {
    const m = Math.round(ms / 60000);
    return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
  };
  const mapLabel = (m) => D.maps[m].name;
  const center = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
  const visible = (el) => !!el && el.offsetParent !== null && el.getBoundingClientRect().width > 0;
  function bestSpot(pid) {
    if (!D.pets[pid]) return []; // a pet newer than this data snapshot
    if (!spotCache.has(pid)) spotCache.set(pid, E.bestSpots(D, pid, settings()));
    return spotCache.get(pid);
  }

  // ── storage ──────────────────────────────────────────────────
  const keyFor = (c) => (Number(c?.serverId) > 0 ? `server-${Number(c.serverId)}` : null);
  let saveTimer = 0;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 700);
  }
  function flush() {
    if (!key) return;
    a2.storage.set(`pets-${key}`, pets).catch(() => {});
    a2.storage.set(`route-${key}`, rstate).catch(() => {});
    if (log.length > 6000) log = log.slice(-5000);
    if (levelLog.length > 1500) levelLog = levelLog.slice(-1000);
    for (const m of ["base", "seen"]) {
      const keys = Object.keys(rstate[m] || {});
      if (keys.length > 300) for (const k of keys.slice(0, keys.length - 300)) delete rstate[m][k];
    }
    a2.storage.set(`log-${key}`, { log, levelLog }).catch(() => {});
    a2.storage.set("last", key).catch(() => {});
  }
  const savePrefs = () => a2.storage.set("prefs", prefs).catch(() => {});
  async function useKey(k) {
    if (!k || k === key) return;
    clearTimeout(saveTimer);
    if (key) flush();
    const get = (n) => a2.storage.get(`${n}-${k}`).catch(() => null);
    const [p, r, l] = await Promise.all([get("pets"), get("route"), get("log")]);
    pets = p && p.levels ? p : { levels: {}, points: {}, syncedAt: 0 };
    rstate = r && r.base ? r : { cur: null, base: {}, seen: {} };
    log = (l && l.log) || [];
    levelLog = (l && l.levelLog) || [];
    key = k; // only now: a save during the reads still went to the old key, with the old data
    completedKey = null;
    rebuild();
  }

  // ── route ────────────────────────────────────────────────────
  function rebuild() {
    spotCache.clear();
    if (typeof petRows !== "undefined") petRows.clear(); // tags (Rift/Abyss) depend on the faction
    const st = settings();
    routes.main = E.buildRoute(D, pets.levels, pets.points, { ...st, rift: false, noAbyss: true });
    routes.abyss = E.buildRoute(D, pets.levels, pets.points, { ...st, abyssOnly: true });
    routes.rift = st.rift ? E.buildRoute(D, pets.levels, pets.points, { ...st, riftOnly: true }) : [];
    mode = MODES.includes(rstate.mode) && routes[rstate.mode].length ? rstate.mode : "main";
    // the main route is done: the next one's turn (the Abyss from Lv 45, then the Rift)
    if (!routes.main.length && mode === "main") {
      const order = ["abyss", "rift"].filter((m) => (m !== "abyss" || abyssOpen()) && routes[m].length);
      if (order.length) mode = order[0];
    }
    route = routes[mode];
    if (rstate.curBy && rstate.curBy[mode]) rstate.cur = rstate.curBy[mode];
    try { closeStops(true); } catch (e) {} // its rows point into the old route
    // stay on the stop you were on; if the new route has no such stop, the closest one on that map
    let i = rstate.cur ? route.findIndex((s) => s.key === rstate.cur) : -1;
    const [m, x, y] = String(rstate.cur || "").split(":");
    if (i < 0 && m) {
      let bd = Infinity;
      route.forEach((s, j) => { if (s.map === m) { const d = Math.hypot(s.x - x, s.y - y); if (d < bd) (bd = d), (i = j); } });
    }
    idx = Math.max(0, i);
    if (route[idx] && !hasWork(route[idx])) idx = nextWork(idx, 1, true);
    model = null;
  }
  const hasWork = (stop) => stop.pets.some((p) => leftOf(p) > 0);
  function nextWork(from, dir, includeSelf = false) {
    const n = route.length;
    if (!n) return 0;
    for (let k = includeSelf ? 0 : 1; k <= n; k++) {
      const j = (((from + dir * k) % n) + n) % n;
      if (hasWork(route[j])) return j;
    }
    return from;
  }
  // follow the other route: back where you were on it (or its first stop with work)
  function setMode(m, why) {
    if (m === mode || !routes[m] || !routes[m].length) return false;
    if (guide) { guide = null; }
    if (typeof cancelFree === "function") cancelFree();
    mode = m;
    rstate.mode = m;
    route = routes[m];
    const k = rstate.curBy && rstate.curBy[m];
    let i = k ? route.findIndex((s) => s.key === k) : -1;
    if (i < 0) i = 0;
    if (!hasWork(route[i])) i = nextWork(i, 1, true);
    try { closeStops(true); } catch (e) {}
    setStop(i);
    document.body.classList.toggle("riftmode", m === "rift");
    document.body.classList.toggle("abyssmode", m === "abyss");
    if (why) flash(why);
    render();
    return true;
  }
  const currentStop = () => (guide ? guide.spots[guide.i] : route[idx]) || null;
  let smartOpened = null; // the stop key the guide opened itself for (it folds back at the first soul there)
  function setStop(i) {
    if (typeof cancelFree === "function") cancelFree();
    offer = null;
    idx = Math.max(0, Math.min(route.length - 1, i));
    rstate.cur = route[idx]?.key || null;
    rstate.curBy = { ...(rstate.curBy || {}), [mode]: rstate.cur };
    smartOpened = null;
    focusPick = null;
    model = null;
    save();
  }
  function startGuide(pid) {
    const spots = bestSpot(pid).map((s) => ({ ...s, key: `pet:${pid}:${s.map}:${s.x}:${s.y}`, bonus: [] }));
    if (!spots.length) return;
    cancelFree();
    smartOpened = null;
    guide = { pid, spots, i: 0 };
    focusPick = null;
    model = null;
    selectTab("guide");
    render();
  }
  function stopGuide() {
    guide = null;
    model = null;
    render();
  }

  // ── the current stop, worked out once per change ─────────────
  function getModel() {
    const stop = currentStop();
    if (!stop) return null;
    if (model && model.stop === stop && model.ver === countsVer) return model;
    const s = settings();
    const contents = E.stopContents(D, stop, s);
    const queue = E.stopQueue(D, stop, contents, pets.levels, pets.points, s);
    // in the Abyss, the pets you can only get here (not on your side's map) come first
    if (stop.map === "A") { const k = (r) => (r.bonus ? 2 : E.abyssOnlyPet(D, r.pid, s) ? 0 : 1); queue.sort((a, b) => k(a) - k(b)); }
    let tr = E.travel(D, stop, s);
    // the Abyss route is one walk from your base: from the second stop on, the way is from the last
    // stop (there's no Kibelisk in the Abyss but the two bases), when that's nearer
    if (mode === "abyss" && !guide && stop.map === "A" && idx > 0 && route[idx] === stop) {
      const prev = route[idx - 1], d = prev && prev.map === "A" ? Math.hypot(stop.x - prev.x, stop.y - prev.y) : Infinity;
      if (tr && d < tr.dist) {
        const deg = E.bearing(prev.x, prev.y, stop.x, stop.y);
        tr = { from: true, name: E.zoneAt(D, "A", prev.x, prev.y).split(" - ").pop(), tp: 0, x: prev.x, y: prev.y, dist: Math.round(d), deg, dir: E.dirName(deg), rift: false, here: false };
      }
    }
    const zone = E.zoneAt(D, stop.map, stop.x, stop.y);
    const loot = E.stopLoot(D, contents, 8);
    // ring baseline: souls left on each of the stop's pets when it was first shown
    // (not before the first sync, or the login's counts would show as progress)
    const base = pets.syncedAt ? (rstate.base[stop.key] = rstate.base[stop.key] || {}) : {};
    for (const p of stop.pets) if (base[p] === undefined || base[p] < leftOf(p)) base[p] = leftOf(p);
    // map: a marker per pet, and the spawns around
    const markers = [], dots = [];
    const done = !queue.some((r) => !r.bonus);
    if (!done && completedKey === stop.key) completedKey = null; // it has work again (goal raised): may complete again
    const focus = done ? null : pickFocus(queue);
    for (const row of queue) {
      const c = contents[row.pid];
      if (!c) continue;
      const color = colorOf(row.pid);
      markers.push({ pid: row.pid, x: c.x, y: c.y, n: c.spawns, color, img: portrait(row.pid), focus: row.pid === focus?.pid, bonus: row.bonus });
      for (const npc of D.pets[row.pid].d) {
        const mob = D.mobs[npc];
        if (mob.map !== stop.map) continue;
        for (let i = 0; i < mob.pts.length; i += 3) {
          const x = mob.pts[i], y = mob.pts[i + 1];
          if (Math.abs(x - stop.x) > 700 || Math.abs(y - stop.y) > 700) continue;
          const c = mob.pts[i + 2];
          dots.push({ pid: row.pid, x, y, c, camp: c >= 3 ? E.campR(c) : 0, color, focus: row.pid === focus?.pid, bonus: row.bonus });
        }
      }
    }
    // the farming loop: pockets of what's still to farm here, in running order from where you come in
    const entry = tr ? (tr.wind && tr.gate ? tr.gate : { x: tr.x, y: tr.y }) : null;
    const live = queue.filter((r) => r.left > 0), left = Object.fromEntries(live.map((r) => [r.pid, r.left]));
    const loop = done ? null : E.farmLoop(D, stop, live.map((r) => r.pid), s, entry, live.filter((r) => !r.bonus).map((r) => String(r.pid)), left);
    model = { stop, ver: countsVer, contents, queue, tr, zone, loot, markers, dots, focus, base, done, loop };
    return model;
  }
  let countsVer = 0;
  const touched = () => { countsVer++; model = null; };
  function pickFocus(queue) {
    const main = queue.filter((r) => !r.bonus);
    if (focusPick) { const r = queue.find((q) => q.pid === focusPick); if (r) return r; focusPick = null; }
    return main[0] || null;
  }
  function stopProgress(m) {
    let total = 0, got = 0;
    for (const p of m.stop.pets) {
      const b = m.base[p] || 0;
      total += b;
      got += Math.max(0, b - leftOf(p));
    }
    return total ? Math.min(1, got / total) : 1;
  }

  // ── rendering ────────────────────────────────────────────────
  function render(opts = {}) {
    renderHeader();
    renderTip();
    if (tab === "guide") renderGuide(opts);
    if (tab === "pets") renderPets();
    if (tab === "stats") renderStats();
    if (tab === "settings") renderSettings();
  }
  const glassy = () => prefs.theme === "ingame"; // the in-game theme drops the emoji from titles
  // pets still below the goal that the route can't take, and why (a field boss, the Abyss below
  // Lv 45, the other side with Rift trips off)
  function offRoute() {
    const s = settings(), inRoute = new Set([...routes.main, ...routes.abyss, ...routes.rift].flatMap((st) => st.pets));
    const ab = D.community && D.community.abyss;
    return Object.keys(D.pets).filter((p) => E.isFarmable(D, p) && leftOf(p) > 0 && !inRoute.has(p)).map((pid) => {
      const mobs = D.pets[pid].d.map((n) => D.mobs[n]), maps = new Set(mobs.map((m) => m.map));
      const why = mobs.every((m) => m.r === 2) ? "field boss"
        : ab && s.myLevel && s.myLevel < ab.minLevel && maps.has("A") && !maps.has(E.ownMap(s)) ? `Abyss, Lv ${ab.minLevel}+`
        : !s.rift && maps.has(E.otherMap(s)) && !maps.has(E.ownMap(s)) ? "Rift route is off" : "no regular spot";
      return { pid, why };
    });
  }
  function renderHeader() {
    document.body.classList.toggle("riftmode", mode === "rift" && !guide);
    document.body.classList.toggle("abyssmode", mode === "abyss" && !guide);
    const stop = currentStop();
    const m = stop ? getModel() : null;
    if (!stop) {
      els.stopno.textContent = "🧭";
      const rest = pets.syncedAt ? offRoute() : [];
      els.zone.textContent = !pets.syncedAt ? "Farm Guide" : rest.length ? "Route done" : "Every pet is done";
      els.sub.textContent = !pets.syncedAt ? "Log in (or relog) to read your pets" : rest.length ? `${rest.length} pet${rest.length === 1 ? "" : "s"} left off the route: see Pets` : "Nothing left to farm with these settings";
      els.prev.disabled = els.next.disabled = true;
      return;
    }
    els.prev.disabled = els.next.disabled = false;
    if (guide && guide.auto) {
      els.stopno.textContent = `${glassy() ? "" : "🎲 "}Free farming`;
      els.zone.textContent = `· ${m.zone}`;
      els.prev.title = "Back to the route";
      els.next.disabled = true;
      els.next.title = "";
    } else if (guide) {
      els.stopno.textContent = `${glassy() ? "" : "🎯 "}${petName(guide.pid)}`;
      els.zone.textContent = `· spot ${guide.i + 1}/${guide.spots.length}`;
      els.prev.title = guide.i === 0 ? "Back to the route" : "Previous spot";
      els.next.title = "Next spot";
    } else {
      els.stopno.textContent = `${glassy() ? "" : MODE_ICON[mode]}${mode === "rift" ? "Rift" : mode === "abyss" ? "Abyss" : "Stop"} ${idx + 1}/${route.length}`;
      els.zone.textContent = `· ${m.zone}`;
      els.prev.title = "Previous stop";
      els.next.title = "Next stop";
    }
    els.sub.replaceChildren();
    const where = h("span", stop.map === "A" ? "tag-abyss" : stop.rift ? "tag-rift" : "", `${stop.rift ? "Rift · " : ""}${mapLabel(stop.map)}`);
    const n = m.queue.filter((r) => !r.bonus).length;
    els.sub.append(where, n ? ` · ${n} pet${n === 1 ? "" : "s"}` : " · stop complete");
    const extra = m.queue.length - n;
    if (extra) els.sub.append(` (+${extra} bonus)`);
    if (guide && guide.auto) els.sub.append(h("span", "free-tag", " · picked up from your kills"));
  }
  let flashTimer = 0;
  function flash(text) {
    if (isFolded()) tipFlash(text);
    els.flash.textContent = text;
    els.t2.classList.add("flashing");
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => els.t2.classList.remove("flashing"), 2800);
  }

  // the map shows: in full (always, or only on the way there), in compact only if you asked for it
  const mapOn = (m) => !!prefs.map && (isCompact() ? !!prefs.compactMap : prefs.mapWhen !== "way" || editing || travelling(m));
  function renderGuide(opts = {}) {
    const m = getModel();
    const has = !!m;
    els.card.hidden = !has;
    els.qwrap.hidden = !has;
    els.loot.hidden = !has || !prefs.loot || !lootRows(m).length;
    renderNotice();
    const showMap = has && mapOn(m);
    if ((els.mapzone.style.display !== "none") !== showMap && mapView) setTimeout(() => mapView.resize(), 30);
    els.mapzone.style.display = showMap ? "" : "none";
    if (has) els.travel.classList.toggle("going", travelling(m));
    els.emptyGuide.hidden = has;
    if (has && !tourOn) maybeTour();
    // a part set to show only on the way there, or only while farming (never while you edit it)
    if (has && HOST) {
      const way = travelling(m);
      for (const b of EDIT_PARTS) {
        const el = partEl(b), w = peek(b).when;
        if (el) el.classList.toggle("ewhen", !editing && ((w === "way" && !way) || (w === "farm" && way)));
      }
    }
    if (!has) {
      const rest = pets.syncedAt ? offRoute() : [];
      els.emptyGuide.replaceChildren(h("b", "", !pets.syncedAt ? "Waiting for your pets" : rest.length ? "Route done" : "All done"),
        !pets.syncedAt ? "Log in to a character (or relog) so the game sends your pet list."
          : rest.length ? `${rest.length} pet${rest.length === 1 ? " is" : "s are"} still below your goal but can't be a route stop: ${rest.slice(0, 3).map((r) => `${petName(r.pid)} (${r.why})`).join(", ")}${rest.length > 3 ? "…" : ""}. Click one in the Pets tab to be guided to it.`
          : "Every pet you can farm has reached your goal level. Raise the goal in Settings to keep going.");
      return;
    }
    els.maptitle.textContent = `${m.zone} · ${mapLabel(m.stop.map)}`;
    renderFocus(m, opts);
    renderSuggest();
    renderStreak();
    renderQueue(m);
    if (prefs.loot) renderLoot(m);
    if (mapView && showMap) {
      mapView.setStop({ key: m.stop.key, map: m.stop.map, x: m.stop.x, y: m.stop.y, r: m.stop.r, markers: m.markers, dots: m.dots,
        kib: m.tr ? { x: m.tr.x, y: m.tr.y, name: m.tr.name, tp: m.tr.rift ? 0 : m.tr.tp } : null, gate: m.tr && m.tr.wind ? m.tr.gate : null, loop: m.loop ? { ...m.loop, ...loopPos(m) } : null }, { mode: rstate.seen[m.stop.key] ? "farm" : "way" });
    }
  }
  function setImg(img, src, animate) {
    if (img.getAttribute("src") === src) return;
    img.style.visibility = src ? "" : "hidden";
    if (src) img.src = src;
    else img.removeAttribute("src");
    if (animate) { img.classList.remove("swap"); void img.offsetWidth; img.classList.add("swap"); }
  }
  function renderFocus(m, opts) {
    const f = m.focus;
    const frac = stopProgress(m);
    const complete = !f;
    els.ringFill.style.strokeDashoffset = String(RING * (1 - frac));
    els.pct.textContent = frac > 0 && frac < 0.01 ? "<1%" : `${Math.floor(frac * 100)}%`;
    els.dial.classList.toggle("complete", complete);
    els.card.classList.toggle("complete", complete);
    els.dial.classList.toggle("breathe", !complete && prefs.effects);
    if (complete) {
      // only bonus pets (or nothing) left here
      els.card.style.setProperty("--genus", "#6fe3a1");
      setImg(els.mobImg, "", false);
      setImg(els.badgeImg, "", false);
      els.badge.hidden = true;
      els.verb.textContent = "";
      els.mobname.textContent = "Stop complete";
      els.per.textContent = "";
      els.petname.textContent = guide ? petName(guide.pid) : "Every pet here is done";
      els.left.hidden = true;
      els.lv.textContent = "";
      els.lvbar.style.width = "100%";
      els.pts.textContent = "";
      els.kills.textContent = route.length > 1 && !guide ? "Next stop with ›" : "";
      els.alike.hidden = true;
      renderTravel(m);
      return;
    }
    const pid = f.pid, mob = D.mobs[f.top], g = genusOf(pid);
    els.card.style.setProperty("--genus", colorOf(pid));
    els.card.classList.remove("complete");
    els.dial.style.setProperty("--genus", colorOf(pid));
    setRingColor(colorOf(pid));
    els.badge.hidden = false;
    const swap = opts.swap !== false && els.badge.dataset.pid && els.badge.dataset.pid !== pid;
    els.badge.dataset.pid = pid;
    setImg(els.mobImg, mobArt(f.top), swap);
    setImg(els.badgeImg, portrait(pid), swap);
    els.badge.title = `${petName(pid)} (${E.GENUS_NAME[g]})`;
    els.verb.textContent = "Kill";
    els.mobname.textContent = mob.n;
    const per = ((mob.pct || 100) / 100) * (mob.w || 1);
    els.per.textContent = `+${+per.toFixed(2)}`;
    els.per.title = `${+per.toFixed(2)} soul${per === 1 ? "" : "s"} per kill on average`;
    els.petname.textContent = petName(pid);
    els.petname.title = `${petName(pid)}: ${E.GENUS_NAME[g]}`;
    els.left.hidden = false;
    if (!opts.keepRoll) {
      els.roll._rollId = (els.roll._rollId || 0) + 1; // cancels a roll still running for another pet
      els.roll.textContent = String(f.left);
    }
    const lv = level(pid), need = E.NEEDED[lv];
    els.lv.textContent = `Lv${lv}`;
    els.lvbar.style.width = need ? `${(pointsOf(pid) / need) * 100}%` : "100%";
    els.pts.textContent = need ? `${pointsOf(pid)}/${need}` : "max";
    const spawns = m.contents[pid]?.spawns || 0;
    const eta = etaOf(m);
    els.kills.textContent = `≈${f.kills} kills${eta.pet ? ` · ${fmtEta(eta.pet)} at your pace` : ""} · ${spawns} spawn${spawns === 1 ? "" : "s"} here · Lv${mob.lv}${mob.r ? (mob.r === 2 ? " hero" : " elite") : ""}`;
    els.kills.title = eta.stop ? `This stop: ${fmtEta(eta.stop)} at your pace (souls you got here in the last 10 minutes)` : "";
    renderAlike(m, f, mob);
    renderTravel(m);
  }
  // A warning under the target: an unconfirmed source, or a look-alike here whose pet you've finished
  // (same kind of monster, another name, another pet: kills on it are wasted).
  function renderAlike(m, f, mob) {
    let msg = "", tip = "";
    if (mob.held) (msg = "⚠ Unconfirmed source"), (tip = `${mob.held}. From ${D.community.credit}`);
    else {
      const waste = E.lookAlikes(D, m.stop, f.top).filter((a) => leftOf(a.pet) === 0 || !E.isFarmable(D, a.pet)).slice(0, 2);
      if (waste.length) {
        const names = waste.map((a) => D.mobs[a.npc].n);
        msg = waste.length === 1 ? `Skip ${names[0]} (${petName(waste[0].pet)} is done)` : `Skip ${names.join(", ")} (pets done)`;
        tip = waste.map((a) => `${D.mobs[a.npc].n} → ${petName(a.pet)} (${a.n} here)`).join("\n") + "\nSame kind of monster, another name: read the full name before you pull.";
      }
    }
    // in the Abyss, a pet you can also farm at home: say where, and how it compares
    let home = null;
    const st = settings();
    if (!msg && m.stop.map === "A" && !guide && !E.abyssOnlyPet(D, f.pid, st)) {
      const own = E.ownMap(st), spot = bestSpot(f.pid).find((x) => x.map === own);
      if (spot) {
        const here = m.contents[f.pid]?.spawns || 0;
        home = spot;
        msg = `🏠 Also in ${mapLabel(own)}: ${E.zoneAt(D, own, spot.x, spot.y).split(" - ").pop()} · ${spot.count} spawns${here ? ` (${here} here)` : ""}`;
        tip = `${petName(f.pid)} isn't only in the Abyss. ${spot.count > here ? "There are more of them at home: " : ""}click to be guided there.\nThe Abyss route puts the pets you can only get here first.`;
      }
    }
    els.alike.hidden = !msg;
    els.alike.textContent = msg;
    els.alike.title = tip;
    els.alike.classList.toggle("outside", !!home);
    els.alike.dataset.pid = home ? f.pid : "";
  }
  // "Also at home": guided to that pet's best spot on your side's map
  els.alike.addEventListener("click", () => {
    const pid = els.alike.dataset.pid;
    if (!pid) return;
    startGuide(pid);
    if (guide) { const i = guide.spots.findIndex((x) => x.map === E.ownMap(settings())); if (i > 0) { guide.i = i; model = null; render(); } }
  });
  // the in-game theme's ring: from a light tint to the pet's genus colour
  const ringStops = [$("#ggrad .g0"), $("#ggrad .g1")];
  function setRingColor(hex) {
    const n = parseInt(hex.slice(1), 16), mix = (c) => Math.round(c + (255 - c) * 0.55);
    ringStops[0].setAttribute("stop-color", `rgb(${mix((n >> 16) & 255)},${mix((n >> 8) & 255)},${mix(n & 255)})`);
    ringStops[1].setAttribute("stop-color", hex);
  }
  // ── pace: how fast you're really getting souls, from your own recent kills ──
  // souls per minute for these pets over the last 10 minutes; null until there's enough to go on
  function paceOf(pids, minutes = 10) {
    const now = Date.now(), from = now - minutes * 60000, set = new Set(pids.map(String));
    let n = 0, first = Infinity;
    for (let i = log.length - 1; i >= 0; i--) {
      const [t, pid, amt] = log[i];
      if (!(t >= from)) continue; // the log is mostly in order, but a replayed soul can carry an old time
      if (!set.has(String(pid))) continue;
      n += amt;
      first = Math.min(first, t);
    }
    if (n < 3) return null;
    const span = Math.max(now - first, 60000) / 60000; // at least a minute, so 3 quick kills don't promise the moon
    return n / span;
  }
  const fmtEta = (min) => { const r = Math.round(min); return min < 1 ? "<1 min" : r < 60 ? `~${r} min` : `~${Math.floor(r / 60)} h ${String(r % 60).padStart(2, "0")}`; };
  // minutes to finish the focused pet, and the whole stop, at your pace (null when unknown)
  function etaOf(m) {
    if (!m || !m.focus) return { pet: null, stop: null };
    const pp = paceOf([m.focus.pid]);
    const main = m.queue.filter((r) => !r.bonus);
    const sp = paceOf(main.map((r) => r.pid));
    const leftStop = main.reduce((a, r) => a + r.left, 0);
    return { pet: pp ? m.focus.left / pp : null, stop: sp ? leftStop / sp : null };
  }
  // on the way to a stop: nothing collected there yet
  const travelling = (m) => !!m && !m.done && !rstate.seen[m.stop.key] && !(guide && guide.auto);

  // how a travel step reads: a teleport on your side, a landmark through a Rift (its Kibelisks aren't yours)
  const fmtDist = (d) => (d >= 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d / 10) * 10} m`);
  const trFrom = (t) => (t.from ? `from ${t.name}` : t.rift ? `near ${t.name}` : t.tp ? `Teleport #${t.tp} ${t.name}` : `Go to ${t.name}`);
  function trWalk(t, short) {
    if (t.wind) return `then ${fmtDist(t.dist)} ${t.dir} to the Windstream${short ? "" : " · ride it over"}`;
    if (t.here) return short ? "right there" : "The circle is right at the Kibelisk";
    return `then ${fmtDist(t.dist)} ${t.dir}`;
  }
  // ── where you are on the loop: the pocket most of the last soul's pet spawns in ──
  // A belief over the pockets, sharpened by each soul (a pet that spawns in one pocket gives you away,
  // one spread over all of them doesn't), softened between souls since you keep moving.
  let loopBelief = null; // { key, at, items: [{ x, y, b }] }
  const LOOP_STALE = 4 * 60000;
  function noteLoopSoul(m0, pid) {
    const L = m0 && m0.loop;
    if (!L || L.pockets.length < 2) return;
    const n = L.pockets.length, now = Date.now();
    const tot = L.pockets.reduce((a, p) => a + (p.pets[pid] || 0), 0);
    if (!tot) return;
    const prev = loopBelief && loopBelief.key === m0.stop.key && now - loopBelief.at < LOOP_STALE ? loopBelief.items : null;
    const items = L.pockets.map((p) => {
      let pb = 1 / n;
      if (prev) {
        let bd = Infinity, f = null;
        for (const q of prev) { const d = Math.hypot(q.x - p.x, q.y - p.y); if (d <= Math.max(q.r, p.r) && d < bd) (bd = d), (f = q); }
        pb = f ? f.b : 0.5 / n;
      }
      return { x: p.x, y: p.y, r: p.r, b: Math.pow(pb, 0.6) * ((p.pets[pid] || 0) / tot + 0.03) };
    });
    const sum = items.reduce((a, i) => a + i.b, 0) || 1;
    for (const i of items) i.b /= sum;
    loopBelief = { key: m0.stop.key, at: now, items };
  }
  function loopPos(m) {
    const L = m.loop;
    if (!L || !loopBelief || loopBelief.key !== m.stop.key || Date.now() - loopBelief.at > LOOP_STALE) return { here: -1, next: -1 };
    const top = loopBelief.items.reduce((a, i) => (i.b > a.b ? i : a), { b: 0 });
    if (top.b < 0.5) return { here: -1, next: -1 };
    // the same place only if it's inside both pockets' reach (a recomputed loop can relabel or drop pockets)
    let here = -1, bd = Infinity;
    L.pockets.forEach((p, i) => { const d = Math.hypot(p.x - top.x, p.y - top.y); if (d <= Math.max(p.r, top.r || 0) && d < bd) (bd = d), (here = i); });
    return { here, next: here < 0 ? -1 : (here + 1) % L.pockets.length };
  }
  const SHAPE_NAME = { "back and forth": "Back and forth", triangle: "Triangle loop", square: "Square loop", circle: "Loop", camp: "Camp" };
  function loopLine(m) {
    const L = m.loop;
    if (!L || prefs.mapLoop === false) return "";
    if (L.shape === "camp") return `Camp: circle it, pulling from the edge · ~${L.len} m a lap`;
    if (L.pockets.length < 2) return "One pocket: stay in the circle and pull what spawns";
    const ls = L.pockets.map((p) => p.label);
    const path = L.shape === "back and forth" ? `${ls[0]} ↔ ${ls[1]}` : ls.length > 5 ? `${ls.length} spots, ${ls[0]} → ${ls[ls.length - 1]} → ${ls[0]}` : `${ls.join(" → ")} → ${ls[0]}`;
    const { here, next } = loopPos(m);
    const souls = L.souls >= 1 ? ` · up to ~${Math.round(L.souls)} souls a lap` : "";
    return `${SHAPE_NAME[L.shape] || "Loop"}: ${path} · ${L.len} m${here >= 0 ? ` · at ${ls[here]}, next ${ls[next]}` : souls}`;
  }
  // places this character has farmed (first-visit notes): kept with the route, per character
  function islesOf() {
    const all = (rstate.isles = rstate.isles && typeof rstate.isles === "object" ? rstate.isles : {});
    const who = String(character?.name || character?.id || "_");
    return (all[who] = all[who] && typeof all[who] === "object" ? all[who] : {});
  }
  const firstVisit = (t) => !!(t && t.first && !islesOf()[t.first.zone]);
  // a line under the way there, for the first visit: the island's Windstream, the Abyss' requirements
  function trNote(m) {
    const t = m.tr, isles = islesOf();
    if (!travelling(m)) { const l = loopLine(m); if (l) return l; }
    if (firstVisit(t)) return `First visit: ${t.first.how}`;
    const ab = D.community && D.community.abyss;
    if (m.stop.map === "A" && ab && !isles.A) return `Needs Lv ${ab.minLevel}+ · gear ${ab.gear.toLocaleString("en")} · PvP area`;
    return "";
  }
  function renderTravel(m) {
    const t = m.tr, stop = m.stop;
    els.travel.classList.toggle("here", !!t && !!t.here);
    els.travel.classList.toggle("short", prefs.travelText === "short"); // the teleport only
    els.travel.classList.toggle("wind", !!t && !!t.wind);
    const note = trNote(m);
    els.trnote.hidden = !note;
    els.trnote.textContent = note;
    if (!t) { els.tp.textContent = mapLabel(stop.map); els.walk.textContent = ""; return; }
    els.arrow.style.transform = `rotate(${t.deg}deg)`;
    els.tp.replaceChildren();
    if (stop.rift) els.tp.append(h("span", "tag-rift", `Rift to ${mapLabel(stop.map)} · `));
    else if (stop.map === "A") els.tp.append(h("span", "tag-abyss", "Abyss · "));
    if (t.from) { els.tp.append("From the last stop, "); els.tp.append(h("b", "", t.name)); }
    else if (t.rift) { els.tp.append("near "); els.tp.append(h("b", "", t.name)); }
    else { els.tp.append(t.tp ? "Teleport " : "Go to "); els.tp.append(h("b", "", t.tp ? `#${t.tp} ${t.name}` : t.name)); }
    els.walk.textContent = trWalk(t, false);
    const is = t.wind || t.first;
    els.travel.title = [t.rift ? "Through a Rift: the Kibelisks over there aren't yours, so this one is just a landmark from your landing" : "",
      is ? `${is.zone}: ${is.how}${is.npc ? `, ${is.npc} stands by it` : ""}. Once you've been, the island's own Kibelisk (if it has one) takes you straight there` : "",
      m.stop.map === "A" && D.community ? `Chaotic Lower Reshanta: start from your side's Root (${D.community.abyss.base[E.sideOf(settings())]}); the fragment area next to it gives the same pets as the one by the other base` : ""].filter(Boolean).join("\n");
  }
  function qCell(row) {
    let el = qEls.get(row.pid);
    if (!el) {
      el = h("button", "qcell enter");
      el.type = "button";
      el.dataset.pid = row.pid;
      const r = h("div", "qr");
      r.innerHTML = `<svg viewBox="0 0 42 42"><circle class="t" cx="21" cy="21" r="19"/><circle class="f" cx="21" cy="21" r="19" stroke-dasharray="${QRING}" stroke-dashoffset="${QRING}"/></svg>`;
      const img = h("img");
      img.alt = "";
      img.src = portrait(row.pid);
      img.draggable = false;
      const mi = h("img", "qm");
      mi.alt = "";
      mi.draggable = false;
      r.append(mi, img);
      // the bar view: name and %, the bar and the souls left
      const qb = h("span", "qb"), bar = h("span", "qbar");
      bar.append(h("i"));
      qb.append(h("span", "qn"), h("span", "qp"), bar, h("span", "ql"));
      el.append(r, h("span", "n"), qb);
      el.style.setProperty("--genus", colorOf(row.pid));
      el.addEventListener("animationend", (e) => { if (e.animationName === "pop-in") el.classList.remove("enter"); if (e.animationName === "pulse") el.classList.remove("hit"); });
      qEls.set(row.pid, el);
    }
    const total = E.soulsTotal(prefs.goal);
    el.querySelector(".f").style.strokeDashoffset = String(QRING * (row.left / total));
    el.querySelector(".n").textContent = String(row.left);
    const qm = el.querySelector(".qm"), art = mobArt(row.top);
    if (qm.getAttribute("src") !== art) { if (art) qm.src = art; else qm.removeAttribute("src"); }
    const mob = D.mobs[row.top];
    const done = Math.max(0, Math.min(1, 1 - row.left / total));
    el.querySelector(".qn").textContent = mob ? mob.n : petName(row.pid);
    el.querySelector(".qp").textContent = `${Math.floor(done * 100)}%`;
    el.querySelector(".ql").textContent = `${row.left} left`;
    el.dataset.p = `${(done * 100).toFixed(1)}%`;
    if (!el.classList.contains("grow0")) el.querySelector(".qbar i").style.setProperty("--p", el.dataset.p);
    el.title = `${mob ? `${mob.n} → ` : ""}${petName(row.pid)} · ${row.left} left${row.bonus ? " · bonus: also drops here, its own stop is elsewhere" : ""}`;
    el.classList.toggle("bonus", row.bonus);
    return el;
  }
  function renderQueue(m) {
    const st = settings();
    const order = m.queue.map((row) => {
      const el = qCell(row);
      el.classList.toggle("now", row.pid === m.focus?.pid);
      el.classList.toggle("fin", row.left <= 0 && row.pid !== m.focus?.pid);
      // in the Abyss: this one you can also farm at home
      const home = m.stop.map === "A" && !E.abyssOnlyPet(D, row.pid, st);
      el.classList.toggle("home", home);
      if (home) el.title += ` · also in ${mapLabel(E.ownMap(st))}`;
      return el;
    });
    // at most N monsters: the first N, and always the one you're farming
    const max = Number(prefs.qMax) || 0;
    const listed = order.filter((el) => !(el.classList.contains("fin") && prefs.qDone === false));
    let keepN = new Set(listed);
    if (max > 0 && listed.length > max) {
      const now = listed.find((el) => el.classList.contains("now"));
      const first = listed.slice(0, max);
      if (now && !first.includes(now)) first[max - 1] = now;
      keepN = new Set(first);
    }
    for (const el of order) el.classList.toggle("over", listed.includes(el) && !keepN.has(el));
    els.qwrap.dataset.more = listed.length > keepN.size ? `+${listed.length - keepN.size}` : "";
    const keep = new Set(order);
    // pets that left: pop out, then their cell goes (no empty gap)
    for (const [pid, el] of qEls) {
      if (keep.has(el)) continue;
      qEls.delete(pid);
      if (!el.isConnected || !prefs.effects) { el.remove(); continue; }
      el.classList.add("leave");
      const kill = () => el.remove();
      el.addEventListener("animationend", kill, { once: true });
      setTimeout(kill, 700);
    }
    let ref = els.queue.firstChild;
    for (const el of order) {
      while (ref && ref.classList.contains("leave")) ref = ref.nextSibling;
      if (el === ref) { ref = ref.nextSibling; continue; }
      els.queue.insertBefore(el, ref);
    }
  }
  // "Also drops": a slow ticker, right to left, rebuilt only when the list changes.
  let lootKey = "";
  function lootChip(r) {
    const [name, rar, icon] = r.item;
    const el = h("span", "item");
    el.style.setProperty("--rar", RARITY[rar] || RARITY[0]);
    if (icon) { const img = h("img"); img.src = `img/i/${icon}`; img.alt = ""; el.append(img); }
    el.append(h("span", "nm", name), h("span", "p", fmtPct(r.pct)));
    el.title = `${name} (${RARITY_NAME[rar]}): ${fmtPct(r.pct)} per kill here, ≈${Math.max(1, Math.round(100 / r.pct))} kills each`;
    return el;
  }
  // the loot strip: everything, or rare and up (Common is rarity 0)
  const lootRows = (m) => (prefs.lootMin === "rare" ? m.loot.filter((r) => (r.item[1] || 0) >= 1) : m.loot);
  function renderLoot(m) {
    const rows = lootRows(m);
    const k = `${m.stop.key}|${rows.map((r) => r.idx).join(",")}`;
    if (k === lootKey) return;
    lootKey = k;
    const track = els.track;
    track.classList.remove("run");
    track.replaceChildren(...rows.map(lootChip));
    requestAnimationFrame(() => {
      if (lootKey !== k) return; // another stop's list replaced this one meanwhile
      const box = els.ticker.clientWidth, w = track.scrollWidth;
      if (!box) { lootKey = ""; return; } // not on screen yet: measure next time
      const still = !prefs.effects || (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
      if (w <= box + 2 || still) return; // fits, or no motion wanted
      track.append(...rows.map(lootChip)); // a second copy makes the loop seamless
      track.style.setProperty("--dur", `${Math.max(14, (w + 4) / 24).toFixed(1)}s`);
      track.classList.add("run");
    });
  }
  // Not synced yet: the pet list comes only at login, and only to plugins loaded at that moment.
  function renderNotice() {
    els.notice.classList.toggle("dg", place.dungeon && !!pets.syncedAt);
    if (place.dungeon && pets.syncedAt) {
      // opened inside a dungeon: say why there's nothing to farm, and which bosses drop souls you need
      const need = dungeonNeeds(), here = dungeonName();
      els.notice.hidden = false;
      els.notice.replaceChildren(h("b", "", here ? `${here}: no field souls here. ` : "In a dungeon: no field souls here. "),
        "Your route waits outside and picks up when you leave.",
        ...need.map((d) => h("div", "dgline" + (d.name === here ? " here" : ""), `${d.name} boss souls: ${d.pids.map((pid) => `${petName(pid)} Lv ${pets.levels[pid] || 0}`).join(" · ")}`)));
      return;
    }
    els.notice.hidden = !!pets.syncedAt;
    if (pets.syncedAt) return;
    els.notice.replaceChildren(h("b", "", "Your pets aren't synced yet. "),
      "The game sends your pet list only when you log in, and A2 Tools passes it only to plugins already loaded. Go to character select and back in (keep this window loaded) and your levels will appear.");
  }

  // ── kill streak ──────────────────────────────────────────────
  const STREAK_GAP = 45000;
  let streak = { n: 0, at: 0 };
  const FIRE_NAME = ["", "Warming up", "On fire", "Blazing", "Inferno"];
  let streakBest = 0, streakEndTimer = 0;
  function bumpStreak(at) {
    const tierBefore = Date.now() - streak.at > STREAK_GAP ? 0 : Sound.tierOf(streak.n);
    if (at - streak.at > STREAK_GAP) streak.n = 0;
    streak.n++;
    streak.at = at;
    streakBest = Math.max(streakBest, streak.n);
    const tier = Sound.tierOf(streak.n);
    // the fuse under the counter starts again: 45 s to the next soul
    els.streak.style.setProperty("--gap", `${STREAK_GAP / 1000}s`);
    els.streak.classList.remove("burning"); void els.streak.offsetWidth; els.streak.classList.add("burning");
    clearTimeout(streakEndTimer);
    streakEndTimer = setTimeout(streakEnded, STREAK_GAP + 250);
    if (streak.n >= 5) setTimeout(() => embers(tier), 380);
    if (tier > tierBefore) {
      setTimeout(() => {
        Sound.streakUp(tier);
        flash(`🔥 ${FIRE_NAME[tier]} · ${streak.n} in a row`);
        fireCall(tier);
        els.streak.classList.remove("up"); void els.streak.offsetWidth; els.streak.classList.add("up");
      }, 260);
    }
  }
  // where the fire is: the dial when it's on screen, else the tip
  function fireAt() {
    const el = isFolded() ? els.tip.querySelector(".tipicon") : visible(els.dial) ? els.dial : null;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.width / 2 };
  }
  // embers off the dial with every soul while the streak burns; more, and hotter, as it climbs
  function embers(tier) {
    const at = fireAt();
    if (at && FX.flames) FX.flames(at.x, at.y, at.r, tier);
  }
  // a new tier: its name, big, over the dial (or the tip)
  function fireCall(tier) {
    const at = fireAt();
    if (!at || !prefs.effects) return;
    const el = h("div", `firecall${tier >= 4 ? " t4" : ""}`, `${FIRE_NAME[tier]}!`);
    el.style.left = `${at.x}px`;
    el.style.top = `${at.y - at.r - 6}px`;
    document.body.append(el);
    setTimeout(() => el.remove(), 1600);
    if (at && FX.shockwave) FX.shockwave(at.x, at.y, tier >= 4 ? "#a9cbff" : "#ff9a3c", { rings: 2, radius: at.r + 26 });
  }
  // the fire goes out: say how far it went (from 10 in a row)
  function streakEnded() {
    const n = streak.n;
    renderStreak();
    if (streakNow() || n < 10) return;
    const msg = `🔥 Streak over · ${n} in a row${n >= streakBest ? " · your best today" : ""}`;
    if (isFolded()) tipFlash(msg, 3600); else flash(msg);
  }
  const streakNow = () => (Date.now() - streak.at <= STREAK_GAP ? streak.n : 0);
  function renderStreak() {
    if (prefs.tip) renderTip();
    const n = streakNow(), tier = n >= 5 ? Sound.tierOf(n) : 0;
    els.streak.hidden = n < 5;
    els.streak.textContent = `🔥 ${n}`;
    els.streak.dataset.tier = String(tier);
    els.dial.dataset.fire = String(prefs.effects ? tier : 0);
    els.tip.dataset.fire = String(prefs.effects ? tier : 0);
  }
  setInterval(() => { if (!els.streak.hidden && streakNow() < 5) renderStreak(); }, 5000);

  // ── free route: farming something off the route ──────────────
  // A few souls in a row for a pet that isn't on the stop shown means you're farming it somewhere
  // else: the guide picks it up there (or offers to), and offers a better spot when there is one.
  let offer = null, offerAt = 0; // a pet the guide offers to switch to (auto-switch off, or a guide you picked)
  const dismissed = new Set();
  function inferSpot(pid) {
    const s = settings();
    const cands = E.bestSpots(D, pid, s, 6);
    if (!cands.length) return null;
    const now = Date.now();
    // where you are: near the other pets you picked up souls for in the last 15 minutes
    const others = [...new Set(log.filter((e) => now - e[0] < 15 * 60000 && String(e[1]) !== pid).map((e) => String(e[1])))].filter((p) => D.pets[p]);
    let pick = null, bd = Infinity;
    for (const c of cands) for (const o of others) { const d = E.distToPet(D, o, c.map, c.x, c.y); if (d < bd) (bd = d), (pick = c); }
    if (pick && bd <= 500) return pick;
    // or near the route stop you were on
    const cur = route[idx];
    if (cur) {
      let b2 = Infinity, p2 = null;
      for (const c of cands) if (c.map === cur.map) { const d = Math.hypot(c.x - cur.x, c.y - cur.y); if (d < b2) (b2 = d), (p2 = c); }
      if (p2 && b2 <= 900) return p2;
    }
    // else the spot whose monsters suit your level best, own map first
    const my = s.myLevel;
    if (my) {
      const lvOf = (c) => { const ns = Object.keys(c.npcs); return ns.reduce((a, n) => a + D.mobs[n].lv, 0) / ns.length; };
      const own = cands.filter((c) => c.map === cands[0].map);
      own.sort((a, b) => Math.abs(lvOf(a) - my) - Math.abs(lvOf(b) - my) || b.count - a.count);
      return own[0];
    }
    return cands[0];
  }
  function freeStop(pid, spot) {
    const near = E.petsNear(D, spot.map, spot.x, spot.y, E.STOP_R, (p) => p !== pid && E.isFarmable(D, p) && leftOf(p) > 0);
    return { map: spot.map, x: spot.x, y: spot.y, r: E.STOP_R, pets: [pid, ...near.filter((n) => n.spawns >= 2).map((n) => n.pid)],
      bonus: [], key: `free:${pid}:${spot.map}:${spot.x}:${spot.y}`, rift: spot.map === E.otherMap(settings()), count: spot.count };
  }
  // the pet's spawns inside a farm circle there, counted the same way as the map's ×N
  const spawnsAt = (pid, s) => E.petsNear(D, s.map, s.x, s.y, E.STOP_R, (p) => p === pid)[0]?.spawns || 0;
  function betterSpot(pid, spot) {
    if (dismissed.has(pid)) return null;
    const best = E.bestSpots(D, pid, settings())[0];
    if (!best) return null;
    const far = best.map !== spot.map || Math.hypot(best.x - spot.x, best.y - spot.y) > 150;
    const here = spawnsAt(pid, spot), there = spawnsAt(pid, best);
    return far && there >= here * 1.35 && there - here >= 4 ? { ...best, count: there, here } : null; // clearly denser, not a sideways move
  }
  function enterFree(pid) {
    if (busy || !D.pets[pid] || leftOf(pid) === 0) return;
    const spot = inferSpot(pid);
    if (!spot) return;
    offer = null;
    const stop = freeStop(pid, spot);
    guide = { pid, spots: [stop], i: 0, auto: true, suggest: betterSpot(pid, spot) };
    rstate.seen[stop.key] = true; // you're already there: show the farm circle
    focusPick = pid;
    model = null;
    if (tab === "guide" && prefs.effects) { els.card.classList.remove("in"); void els.card.offsetWidth; els.card.classList.add("in"); setTimeout(() => els.card.classList.remove("in"), 600); }
    toast(`🎲 Free farming: ${petName(pid)}`, "", 2600);
    Sound.tick();
    render({ swap: true });
  }
  function leaveFree(text) {
    guide = null;
    model = null;
    focusPick = null;
    clearTimeout(freeTimer);
    if (text) toast(text, "", 2400);
    // the route's stop may have been finished while you were free farming
    if (route.length && !hasWork(route[idx]) && prefs.autoNext) {
      const n = nextWork(idx, 1);
      if (n !== idx) setStop(n);
    }
    render();
  }
  function goBetter() {
    if (!guide || !guide.suggest) return;
    const stop = freeStop(guide.pid, guide.suggest);
    guide.spots = [stop];
    guide.i = 0;
    guide.suggest = null;
    rstate.seen[stop.key] = false; // show the way there
    model = null;
    render({ swap: false });
  }
  // Follow what you're actually killing. Live souls of the last 10 minutes, newest last.
  // A pet "leads" when, since its first soul in the last 5 minutes, it got at least as many souls
  // as anything else that's shown: kills of other things in between don't reset it.
  const recent = [];
  function trackFree(pid, m0, live) {
    if (!live || !D.pets[pid] || !E.isFarmable(D, pid)) return;
    const now = Date.now();
    recent.push([now, pid]);
    while (recent.length && now - recent[0][0] > 10 * 60000) recent.shift();
    const N = prefs.freeAfter;
    // souls since the first one (in the last 5 minutes) that passes `test`, tallied by `key`
    const tally = (test, key) => {
      const from = recent.findIndex(([t, p]) => now - t <= 5 * 60000 && test(p));
      const out = new Map();
      if (from < 0) return out;
      for (let i = from; i < recent.length; i++) { const k = key(recent[i][1]); out.set(k, (out.get(k) || 0) + 1); }
      return out;
    };
    const shownSet = new Set(m0 ? m0.queue.map((r) => r.pid) : []);
    const inShown = shownSet.has(pid);
    const leads = (mine, others) => mine >= Math.max(0, ...others);

    // free mode: the route's stop pets taking over → back to the route
    if (guide && guide.auto && !inShown) {
      const rs = route[idx];
      const onRoute = (p) => !!rs && (rs.pets.includes(p) || (rs.bonus || []).includes(p));
      if (onRoute(pid)) {
        const t = tally(onRoute, (p) => (onRoute(p) ? "route" : shownSet.has(p) ? "free" : "other"));
        if ((t.get("route") || 0) >= N && leads(t.get("route") || 0, [t.get("free") || 0])) return leaveFree("🧭 Back on the route");
        return;
      }
    }
    // a pet at this spot that isn't the focus: after 2 souls, if it leads, the dial follows it
    if (inShown) {
      if (offer === pid) offer = null;
      const focus = m0.focus && m0.focus.pid;
      if (pid === focus) return;
      const t = tally((p) => p === pid, (p) => p);
      const mine = t.get(pid) || 0;
      if (mine >= Math.min(2, N) && leads(mine, [t.get(focus) || 0])) {
        focusPick = pid;
        model = null;
        flash(`🎯 Now farming ${petName(pid)}`);
        render({ swap: true });
      }
      return;
    }
    // a pet that isn't here at all: N souls in 5 minutes, and it leads → farm it where you are
    if (leftOf(pid) === 0) return;
    const t = tally((p) => p === pid, (p) => p);
    const mine = t.get(pid) || 0;
    if (mine < N || !leads(mine, [...shownSet].map((p) => t.get(p) || 0))) return;
    // a guide you picked yourself (Pets tab) is only offered the switch, never replaced
    if (prefs.freeAuto && !(guide && !guide.auto)) scheduleFree(pid, 900, 0);
    else if (offer !== pid) { offer = pid; offerAt = now; renderSuggest(); }
  }
  let freeTimer = 0, freePid = null;
  function scheduleFree(pid, ms, tries) {
    if (freePid === pid && freeTimer) return; // already on its way
    clearTimeout(freeTimer);
    freePid = pid;
    freeTimer = setTimeout(() => {
      freeTimer = 0;
      freePid = null;
      // still worth it? (you may have moved to a stop with this pet, or picked a guide meanwhile)
      if (guide && guide.auto && guide.pid === pid) return;
      if (guide && !guide.auto) return;
      if (getModel()?.queue.some((r) => r.pid === pid)) return;
      if (busy) { if (tries < 4) scheduleFree(pid, 1500, tries + 1); return; }
      enterFree(pid);
    }, ms);
  }
  function cancelFree() {
    clearTimeout(freeTimer);
    freeTimer = 0;
    freePid = null;
  }
  function renderSuggest() {
    const box = els.suggest;
    const mk = (text, yes, no, yesLabel, noLabel) => {
      box.replaceChildren();
      const st = h("div", "st");
      st.append(...text);
      const sb = h("div", "sb");
      const y = h("button", "btn gold", yesLabel), n = h("button", "btn", noLabel);
      y.type = n.type = "button";
      y.addEventListener("click", yes);
      n.addEventListener("click", no);
      sb.append(y, n);
      box.append(st, sb);
      box.hidden = false;
    };
    if (offer && (Date.now() - offerAt > 10 * 60000 || getModel()?.queue.some((r) => r.pid === offer))) offer = null;
    if (offer && D.pets[offer] && leftOf(offer) > 0 && !(guide && guide.pid === offer)) {
      const pid = offer;
      return mk(["You're farming ", h("b", "", petName(pid)), ". Guide it from where you are?"],
        () => { cancelFree(); enterFree(pid); }, () => { offer = null; renderSuggest(); }, "Yes", "No");
    }
    if (abyssOffer && (mode === "abyss" || place.world !== "A")) abyssOffer = null;
    if (abyssOffer) {
      const st = settings(), work = routes.abyss.filter(hasWork);
      const only = new Set(work.flatMap((x) => x.pets).filter((p) => E.abyssOnlyPet(D, p, st) && leftOf(p) > 0)).size;
      return mk(["⚔️ ", h("b", "", "You're in the Abyss"), ` · ${work.length} Abyss stop${work.length === 1 ? "" : "s"}${only ? `, ${only} pet${only === 1 ? "" : "s"} you can't farm at home` : ""}. Switch to the Abyss route?`],
        () => { abyssOffer = null; setMode("abyss", "⚔️ Abyss route"); renderSuggest(); }, () => { abyssOffer = null; renderSuggest(); }, "Abyss route", "Not now");
    }
    if (riftOffer && (mode === "rift" || Date.now() > riftOffer.until)) riftOffer = null;
    if (riftOffer) {
      const open = Date.now() >= riftOffer.opensAt, st = settings();
      const only = new Set(routes.rift.flatMap((x) => x.pets).filter((p) => E.riftOnlyPet(D, p, st) && leftOf(p) > 0)).size;
      return mk(["🌀 ", h("b", "", open ? "A Rift is open" : `Rift opens at ${fmtClock(riftOffer.opensAt)}`),
        ` · ${routes.rift.filter(hasWork).length} Rift stops${only ? `, ${only} pets you can only farm in ${mapLabel(E.otherMap(st))}` : ""}. Switch to the Rift route?`],
        () => { riftOffer = null; setMode("rift", "🌀 Rift route"); renderSuggest(); }, () => { riftOffer = null; renderSuggest(); }, "Rift route", "Not now");
    }
    if (guide && guide.auto && guide.suggest) {
      const b = guide.suggest, cur = guide.spots[0];
      const zone = E.zoneAt(D, b.map, b.x, b.y);
      return mk(["Better spot for ", h("b", "", petName(guide.pid)), `: ${zone}${b.map !== cur.map ? ` (${mapLabel(b.map)})` : ""}, ${b.count} spawns vs ${b.here} here.`],
        goBetter, () => { dismissed.add(guide.pid); guide.suggest = null; renderSuggest(); }, "Go there", "Stay");
    }
    box.hidden = true;
  }

  // ── souls coming in ──────────────────────────────────────────
  function applySoul(pid, amount, at) {
    const before = { level: level(pid), points: pointsOf(pid), left: leftOf(pid) };
    pets.points[pid] = (pets.points[pid] || 0) + amount;
    // the game resets a pet's points as it levels (no carry-over: A2 Tools' Pet Soul Tracker, 0.4.x)
    const lv = pets.levels[pid] || 0;
    if (lv < E.MAX_LEVEL && pets.points[pid] >= E.NEEDED[lv]) {
      pets.levels[pid] = lv + 1;
      pets.points[pid] = 0;
    }
    pets.lastGain = { pet: pid, at: Number(at) || Date.now() };
    touched();
    return { before, after: { level: level(pid), points: pointsOf(pid), left: leftOf(pid) } };
  }
  function areaFor(pid, live) {
    const m = live ? getModel() : null; // a replayed soul says nothing about where you are now
    if (m && m.contents[pid]) return { area: m.zone, map: m.stop.map, here: true };
    const s = bestSpot(pid)[0];
    if (s) return { area: E.zoneAt(D, s.map, s.x, s.y), map: s.map, here: false };
    return { area: "Elsewhere", map: "", here: false };
  }
  // ── where you are: the open world or a dungeon (A2 Tools reads the game's map load, "21 36") ──
  // A dungeon or raid's map id is its dungeon id, 600000–699999 (the meter's own rule); anything else
  // (the open world, the Abyss, seals, quest scenes) is outside. Field souls don't drop inside, so the
  // guide folds away and waits; six pets' souls come from dungeon bosses (community.dungeons).
  // A "dungeon" where field souls keep coming is learned as farmland, so a wrong guess fixes itself.
  const CM = D.community || {};
  let place = { map: 0, dungeon: false }, dungeonFolded = false, placeTimer = 0;
  let places = { field: [], names: {}, worlds: {} }; // learned: farmland map ids, dungeon names, which continent a map id is
  const fieldHits = {};
  const isDungeonMap = (id) => id >= 600000 && id < 700000 && !places.field.includes(id);
  const dungeonName = () => places.names[place.map] || "";
  function onMapLoad(data, live) {
    const id = Number(data && data.map) || 0;
    if (!id) return;
    const was = place.dungeon, wasWorld = place.world;
    place = { map: id, dungeon: isDungeonMap(id), world: worldOf(id) };
    if (live) followWorld(wasWorld);
    document.body.classList.toggle("indungeon", place.dungeon);
    clearTimeout(placeTimer);
    if (live) {
      if (place.dungeon && !was) enterDungeon(true);
      else if (!place.dungeon && was) leaveDungeon();
    } else {
      // replayed: the last one says where you are now; once they're all in, go by it quietly
      placeTimer = setTimeout(() => { if (place.dungeon) enterDungeon(false); }, 1800);
    }
    render();
  }
  // ── which continent you're on: your own, or the other side's through a Rift ──
  const worldOf = (id) => places.worlds[id] || (CM.worlds && CM.worlds[id]) || (id >= 101000 && id < 102000 ? "L" : id >= 111000 && id < 112000 ? "D" : null);
  let riftAuto = false; // the guide switched to the Rift route by itself (so it switches back too)
  let abyssOffer = null;
  function followWorld(was) {
    const st = settings(), other = E.otherMap(st), own = E.ownMap(st);
    // into the Abyss: offer its route (or say there's nothing left to farm in there)
    if (place.world === "A" && was !== "A") return enterAbyss();
    if (was === "A" && place.world !== "A") {
      abyssOffer = null;
      if (mode === "abyss") setMode(routes.main.some(hasWork) ? "main" : nextRoute("abyss") || "main", "🧭 Out of the Abyss: back on the main route");
      renderSuggest();
      if (place.world !== other) return;
    }
    if (place.world === other && mode === "main" && routes.rift.some(hasWork)) {
      if (setMode("rift", `🌀 ${mapLabel(other)}: on the Rift route`)) { riftAuto = true; riftOffer = null; Sound.open(); }
    } else if (place.world && place.world !== other && was === other && mode === "rift") {
      riftAuto = false;
      setMode("main", place.world === own ? "🧭 Home again: back on the main route" : "🧭 Back on the main route");
    }
  }
  function enterAbyss() {
    if (mode === "abyss" || prefs.abyssAlert === "off") return;
    if (!routes.abyss.some(hasWork)) {
      // nothing left in here: say so once, quietly
      const msg = "⚔️ The Abyss: every pet you can farm here is done";
      toast(msg, "done", 4500);
      if (isFolded()) tipFlash(msg, 5000);
      return;
    }
    abyssOffer = { at: Date.now() };
    if (isFolded()) tipFlash(`⚔️ You're in the Abyss · ${routes.abyss.filter(hasWork).length} Abyss stops`, 6000);
    Sound.list(true);
    renderSuggest();
  }
  // a live soul says which continent you're on: a pet that spawns on only one of them gives it away.
  // That names the map id of the last map load too, so the next trip there is known on arrival.
  const worldVotes = {};
  function noteWorldSoul(pid) {
    const maps = [...new Set((D.pets[pid]?.d || []).map((n) => D.mobs[n]?.map).filter(Boolean))];
    if (!maps.length) return;
    if (place.map && !place.dungeon && !places.worlds[place.map]) {
      const v = (worldVotes[place.map] = worldVotes[place.map] ? worldVotes[place.map].filter((m) => maps.includes(m)) : maps);
      if (v.length === 1) { places.worlds[place.map] = v[0]; a2.storage.set("places", places).catch(() => {}); }
    }
    if (maps.length === 1 && place.world !== maps[0]) {
      const was = place.world;
      place.world = maps[0];
      followWorld(was);
    }
  }

  // ── Rifts: when the next one opens (the game's schedule, in your server's time) ──
  function serverZone() {
    const id = Number(character?.serverId) || serverOf(key) || 0;
    return (CM.rift && id >= 1000 && CM.rift.zones[String(id)[1]]) || null;
  }
  // { open: true, until } while one is open, else { open: false, at } (unix ms)
  function riftClock(now = Date.now()) {
    const R = CM.rift, tz = serverZone();
    if (!R) return null;
    let mins, secs;
    try {
      const p = new Intl.DateTimeFormat("en-US", { timeZone: tz || undefined, hourCycle: "h23", hour: "numeric", minute: "numeric", second: "numeric" }).formatToParts(new Date(now));
      const g = (t) => Number(p.find((x) => x.type === t)?.value || 0);
      mins = g("hour") * 60 + g("minute");
      secs = g("second");
    } catch (e) { return null; }
    for (const st of R.starts) if (mins >= st && mins < st + R.minutes) return { open: true, until: now + ((st + R.minutes - mins) * 60 - secs) * 1000, tz };
    const next = R.starts.find((st) => st > mins) ?? R.starts[0] + 1440;
    return { open: false, at: now + ((next - mins) * 60 - secs) * 1000, tz };
  }
  const fmtClock = (ms) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const fmtIn = (ms) => { const m = Math.max(0, Math.round(ms / 60000)); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`; };
  let riftOffer = null, riftSeen = 0;
  // 5 minutes before a Rift (and as it opens): offer the Rift route, once per Rift
  function riftTick() {
    if (!prefs.rift || prefs.riftAlert === "off" || !routes.rift.some(hasWork)) return;
    const c = riftClock();
    if (!c) return;
    const opensAt = c.open ? c.until - CM.rift.minutes * 60000 : c.at;
    const soon = !c.open && c.at - Date.now() <= 5 * 60000;
    if (!(c.open || soon) || riftSeen === Math.round(opensAt / 60000) || mode === "rift") return;
    riftSeen = Math.round(opensAt / 60000);
    riftOffer = { opensAt, until: opensAt + CM.rift.minutes * 60000 };
    const only = new Set(routes.rift.flatMap((s) => s.pets).filter((p) => E.riftOnlyPet(D, p, settings()) && leftOf(p) > 0)).size;
    const msg = c.open ? "🌀 A Rift is open now" : `🌀 Rift opens in ${fmtIn(c.at - Date.now())}`;
    if (isFolded()) tipFlash(`${msg}${only ? ` · ${only} pets only there` : ""}`, 6000);
    Sound.list(true);
    renderSuggest();
  }
  setInterval(riftTick, 15000);

  function enterDungeon(loud) {
    if (prefs.dungeonFold === "off" || !prefs.tip || prefs.folded) return;
    fold();
    dungeonFolded = true; // we folded it: leaving opens it again
    if (loud) tipFlash("Field souls don't drop in here", 3200);
  }
  function leaveDungeon() {
    const reopen = dungeonFolded && prefs.tip && isFolded();
    dungeonFolded = false;
    tipFlashUntil = 0; // the "in here" message goes with you
    if (reopen) unfold();
  }
  // a soul inside: a dungeon pet names the dungeon; field souls three times over make it farmland
  function notePlaceSoul(pid) {
    const dn = CM.dungeonOf && CM.dungeonOf[pid];
    if (dn) { if (places.names[place.map] !== dn) { places.names[place.map] = dn; a2.storage.set("places", places).catch(() => {}); } return; }
    fieldHits[place.map] = (fieldHits[place.map] || 0) + 1;
    if (fieldHits[place.map] < 3) return;
    places.field.push(place.map);
    a2.storage.set("places", places).catch(() => {});
    place.dungeon = false;
    document.body.classList.remove("indungeon");
    leaveDungeon();
    flash("Souls drop here: the guide is back on");
  }
  // the dungeon pets you still need, by dungeon (the one you're in first)
  function dungeonNeeds() {
    const out = [];
    for (const d of CM.dungeons || []) {
      const left = d.pids.filter((pid) => (pets.levels[pid] || 0) < prefs.goal && D.pets[pid]);
      if (left.length) out.push({ name: d.name, pids: left });
    }
    const here = dungeonName();
    return out.sort((a, b) => (b.name === here) - (a.name === here));
  }

  // One soul pickup (one kill) can feed several pets: 0D 90 is a list of (pet, amount). Events
  // from before 1.23 (saved logs, bridge.json the overlay replays) are one { pet, amount }.
  const soulsIn = (data) => (Array.isArray(data?.souls) ? data.souls : data && data.pet != null ? [{ pet: data.pet, amount: data.amount }] : []);
  // kill: true for the first pet of a pickup only, so a kill that feeds two pets is still one
  // kill for the streak and the idle/fold logic, and two pets' souls everywhere else
  function onSoul({ pet, amount }, isLive, at, kill = true) {
    const pid = String(pet);
    amount = Number(amount) || 1;
    const m0 = place.dungeon ? null : getModel(); // inside a dungeon a soul says nothing about the stop
    let where = { area: "Elsewhere", map: "", here: false };
    if (isLive && place.dungeon) where = { area: dungeonName() || "Dungeon", map: "", here: false };
    else try { where = areaFor(pid, isLive); } catch (e) { console.warn(e); }
    const now = Number(at) || Date.now(); // when the meter read it (a replayed soul keeps its own time)
    if (isLive) {
      if (kill) bumpStreak(Date.now());
      if (place.dungeon) notePlaceSoul(pid);
      else noteWorldSoul(pid);
      // back to hunting after the guide folded itself: open it again (Settings: When hunting resumes)
      if (kill && idleFolded && isFolded() && prefs.tipResume !== "stay" && !place.dungeon) { idleFolded = false; unfold(); }
      if (kill) armIdleFold();
    }
    log.push([now, Number(pid), amount, where.area, where.map]);
    if (isLive) setTimeout(renderCompanion, 0);
    const { before, after } = applySoul(pid, amount, now);
    if (after.level > before.level) levelLog.push([now, Number(pid), after.level]);
    if (where.here && m0) {
      // the first soul at a stop the guide opened by itself for the way there: fold back, you've arrived
      if (isLive && ((smartOpened && smartOpened === m0.stop.key) || (autoFull && autoFull === m0.stop.key)) && !isFolded()) {
        smartOpened = null;
        autoFull = null;
        backToFarmSize(m0.stop.key);
      }
      rstate.seen[m0.stop.key] = true;
      if (isLive) noteLoopSoul(m0, String(pid));
      // you've been there: the first-visit notes (island Windstream, Abyss requirements) go
      const isles = islesOf(), is = E.islandAt(D, m0.stop.map, m0.stop.x, m0.stop.y);
      if (is) isles[is.zone] = true;
      if (m0.stop.map === "A") isles.A = true;
    }
    save();
    if (isLive && isFolded() && place.dungeon && D.pets[pid]) { tipSoul(pid, amount, before, after); return render(); }
    if (isLive && isFolded() && m0 && D.pets[pid]) {
      tipSoul(pid, amount, before, after);
      render();
      afterChange(m0, true);
      return trackFree(pid, m0, isLive);
    }
    if (!isLive || tab !== "guide" || !m0 || !D.pets[pid]) {
      if (isLive && after.level > before.level) levelToast(pid, after.level);
      if (isLive) Sound.soul(genusOf(pid), streakNow());
      render();
      if (isLive && tab === "pets") pulsePetRow(pid, amount);
      afterChange(m0, isLive);
      return trackFree(pid, m0, isLive);
    }
    animateSoul(pid, amount, before, after, m0, where.here);
    trackFree(pid, m0, isLive);
  }
  // A stop that just became complete: celebrate (live, on the guide) or quietly move on (replay).
  let completedKey = null, pendingComplete = null;
  function afterChange(m0, live) {
    const m = getModel();
    if (!m || !m0 || m0.stop !== m.stop || m0.done || !m.done) return;
    if (!live) {
      if (!guide && prefs.autoNext && route.length) { const n = nextWork(idx, 1); if (n !== idx) { setStop(n); render(); } }
      return;
    }
    // folded counts as the guide: the tip shows it, whatever tab was open when it folded
    if (tab === "guide" || isFolded()) setTimeout(stopComplete, 400);
    else pendingComplete = m.stop.key;
  }
  function animateSoul(pid, amount, before, after, m0, here) {
    const color = colorOf(pid);
    const isFocus = m0.focus && m0.focus.pid === pid;
    const cell = qEls.get(pid);
    const target = isFocus ? els.dial : visible(cell) ? cell : null;
    if (!here || !target) {
      // a soul for a pet not at this stop
      flash(`+${amount} ${petName(pid)} · ${after.left} left`);
      Sound.soul(genusOf(pid), streakNow());
      if (after.level > before.level) levelToast(pid, after.level);
      render();
      return afterChange(m0, true);
    }
    // first soul here: the map glides from the way there into the farm circle
    if (mapView && mapOn(m0) && mapView.mode === "way") mapView.setMode("farm", 1000);
    if (mapView && mapOn(m0)) mapView.pulse();
    const c = m0.contents[pid];
    const tc = center(target);
    const from = mapView && mapOn(m0) && mapView.visible() && c ? mapView.toScreen(c.x, c.y) : visible(els.travel) ? center(els.travel) : { x: tc.x + 44, y: tc.y - 56 };
    FX.orb(from, () => center(target), color, () => land(pid, amount, before, after, target, isFocus, m0));
  }
  function land(pid, amount, before, after, target, isFocus, m0) {
    try {
      const at = center(target);
      Sound.soul(genusOf(pid), streakNow());
      FX.burst(at.x, at.y, colorOf(pid), { count: isFocus ? 22 : 12, speed: isFocus ? 150 : 90, spread: isFocus ? 60 : 30, glints: isFocus ? 4 : 2 });
      FX.plus(at.x, at.y - (isFocus ? 40 : 18), `+${amount}`);
      if (isFocus) { els.dial.classList.remove("pulse"); void els.dial.offsetWidth; els.dial.classList.add("pulse"); }
      else target.classList.add("hit");
      const levelled = after.level > before.level;
      const finished = after.left === 0;
      const m1 = getModel();
      // only the soul that finished the stop celebrates it
      const stopDone = !!m1 && m1.stop === m0.stop && !m0.done && m1.done;
      if (finished) {
        Sound.done();
        if (mapView) mapView.fadeOut(pid);
        const next = m1 && m1.focus ? petName(m1.focus.pid) : null;
        flash(next ? `✓ ${petName(pid)} done — next: ${next}` : `✓ ${petName(pid)} done`);
      }
      render({ keepRoll: isFocus && !finished, swap: true });
      if (isFocus && !finished) FX.roll(els.roll, before.left, after.left, 500);
      if (levelled) setTimeout(() => celebrateLevel(pid, after.level, isFocus ? els.dial : target), finished ? 250 : 120);
      if (stopDone) setTimeout(stopComplete, levelled ? 1300 : 650);
    } catch (e) {
      console.error(e);
      render();
    }
  }
  function celebrateLevel(pid, lv, el) {
    const at = center(el);
    FX.shockwave(at.x, at.y, "#ffe7a6", { rings: 3, radius: 70 });
    FX.burst(at.x, at.y, colorOf(pid), { count: 34, speed: 200, spread: 70, glints: 6 });
    Sound.level();
    levelToast(pid, lv);
  }
  function levelToast(pid, lv) {
    const g = genusOf(pid);
    const gain = E.effectGain(g, lv);
    const t = toast(`✨ ${petName(pid)} reached Lv ${lv}!`, "level", 4200);
    const row = h("div", "ts");
    gain.forEach(([k, v], i) => {
      const c = h("span", "chip-stat");
      c.append(h("b", "", `+${v}${k.endsWith("%") ? "%" : ""}`), ` ${k.replace(/ %$/, "")}`);
      c.style.animationDelay = `${0.25 + i * 0.12}s`;
      row.append(c);
    });
    const exp = h("span", "chip-stat");
    exp.append(h("b", "", `+${E.INSIGHT_EXP[lv]}`), ` ${E.GENUS_NAME[g]} insight EXP`);
    exp.style.animationDelay = `${0.25 + gain.length * 0.12}s`;
    row.append(exp);
    t.append(row);
  }
  function stopComplete() {
    const m = getModel();
    if (busy || !m || !m.done || completedKey === m.stop.key) return;
    completedKey = m.stop.key;
    pendingComplete = null;
    busy = true;
    const at = center(isFolded() ? els.tip.querySelector(".tipicon") : els.dial);
    if (isFolded()) tipFlash("🏁 Stop complete");
    FX.shockwave(at.x, at.y, "#6fe3a1", { rings: 3, radius: 60 });
    FX.burst(at.x, at.y, "#6fe3a1", { count: 30, speed: 170, spread: 60, glints: 6 });
    Sound.stop();
    let nextHint = "";
    if (!guide && route.length > 1) {
      const n = nextWork(idx, 1), ns = route[n];
      if (ns && n !== idx) {
        const t = E.travel(D, ns, settings());
        nextHint = ` — next: ${E.zoneAt(D, ns.map, ns.x, ns.y)}${t && t.tp && !t.rift ? `, teleport #${t.tp}` : ""}${t && (t.wind || firstVisit(t)) ? `${t.wind ? ", then" : " (first visit:"} its Windstream${t.wind ? "" : ")"}` : ""}`;
      }
    }
    toast(guide && !guide.auto ? `🏁 ${petName(guide.pid)} is done here` : guide ? "🏁 Done here" : `🏁 Stop complete${nextHint}`, "done", 3200);
    const advance = () => {
      if (guide && guide.auto && currentStop() === m.stop) { busy = false; return leaveFree("🧭 Back on the route"); }
      if (guide || currentStop() !== m.stop) { busy = false; return render(); }
      const n = nextWork(idx, 1);
      if (n === idx && !hasWork(route[idx])) {
        busy = false;
        const nx = nextRoute(mode);
        if (nx) return setMode(nx, `${MODE_ICON[nx]}${MODE_NAME[mode]} done: the ${MODE_NAME[nx]} is next`);
        return render();
      }
      if (!isFolded()) els.card.classList.add("out");
      setTimeout(() => {
        els.card.classList.remove("out");
        busy = false;
        setStop(n);
        render({ swap: false });
        // a new stop: open the guide on the way there (map + directions); it folds again at the first soul
        if (prefs.smartOpen && !place.dungeon && ((prefs.tip && prefs.folded) || isCompact())) {
          const k = currentStop()?.key;
          if (k) { rstate.seen[k] = false; save(); } // you are on the way there now
          if (tab !== "guide") selectTab("guide");
          if (isFolded()) { smartOpened = k; prefs.view = "full"; unfold(true); }
          else { autoFull = k; setView("full"); }
        }
        els.card.classList.add("in");
        setTimeout(() => els.card.classList.remove("in"), 600);
        Sound.tick();
      }, prefs.effects ? 450 : 0);
    };
    if (prefs.autoNext) setTimeout(advance, 1800);
    else busy = false;
  }
  function toast(text, cls = "", ms = 3600) {
    const el = h("div", `toast ${cls}`);
    el.append(h("div", "tt", text));
    els.toasts.append(el);
    while (els.toasts.children.length > 2) els.toasts.firstChild.remove();
    setTimeout(() => { el.classList.add("go"); setTimeout(() => el.remove(), 350); }, ms);
    el.addEventListener("click", () => el.remove());
    return el;
  }

  // ── pets tab ─────────────────────────────────────────────────
  function petInfo(pid) {
    const p = D.pets[pid];
    const maps = new Set(p.d.map((n) => D.mobs[n].map));
    const own = E.ownMap(settings()), other = E.otherMap(settings());
    const tags = [];
    const acq = D.community && D.community.acquireBy[pid];
    const bossOnly = p.d.length > 0 && p.d.every((n) => D.mobs[n].r === 2);
    if (p.unrel) tags.push(["closed", "Not open"]);
    else if (bossOnly || (acq && !acq.startsWith("Maybe"))) tags.push(["boss", "Boss"]);
    else if (!p.d.length) tags.push(p.box.length ? ["chest", "Chest only"] : ["closed", "Other"]);
    else if (!maps.has(own) && !maps.has("A") && maps.has(other)) tags.push(["rift", "Rift only"]);
    else if (!maps.has(own) && maps.has("A") && !maps.has(other)) tags.push(["abyss", "Abyss only"]);
    else {
      // not on your side's map: the Abyss route has it (and the Rift route, if it's over there too)
      if (!maps.has(own) && maps.has("A")) tags.push(["abyss", "Abyss"]);
      // also in the Abyss, or on the other side's map: those routes have it too (which map that is: your faction)
      else if (maps.has("A")) tags.push(["abyss2", "Abyss too"]);
      if (maps.has(other)) tags.push(["rift2", `Rift too`]);
    }
    if (p.dun) tags.push(["", "Dungeon"]);
    // how to get it, when it isn't a route pet: the boss or dungeon, else the chests
    let how = "";
    if (acq) how = acq;
    else if (!p.d.length && p.box.length) how = `Chests: ${p.box.slice(0, 2).map((b) => b[0].replace(/ \(Bound\)/, "").replace("Chestt", "Chest")).join(", ")}${p.oth.includes("Random shop") ? " · random merchants" : ""}`;
    const held = p.d.filter((n) => D.mobs[n].held).map((n) => D.mobs[n].n);
    return { p, tags, how, held };
  }
  function renderPets() {
    const q = els.search.value.trim().toLocaleLowerCase();
    const all = Object.keys(D.pets).filter((pid) => D.pets[pid].g !== "special");
    const farm = (pid) => E.isFarmable(D, pid);
    const done = (pid) => leftOf(pid) === 0;
    const filters = [
      ["todo", "To farm", (pid) => farm(pid) && !done(pid)],
      ["all", "All", () => true],
      ...E.GENERA.map((g) => [g, E.GENUS_NAME[g], (pid) => D.pets[pid].g === g && !done(pid), E.GENUS_COLOR[g]]),
      // pets you can farm over a Rift (the other side's map), Rift-only ones first in the sort
      ["abyss", "⚔️ Abyss", (pid) => farm(pid) && !done(pid) && D.pets[pid].d.some((n) => D.mobs[n].map === "A"), "var(--abyss)"],
      ["rift", "🌀 Rift", (pid) => farm(pid) && !done(pid) && D.pets[pid].d.some((n) => D.mobs[n].map === E.otherMap(settings())), "var(--rift)"],
      ["done", "Done", done],
    ];
    const matches = (pid) => {
      if (!q) return true;
      const p = D.pets[pid];
      return petName(pid).toLocaleLowerCase().includes(q) || (p.n.en || "").toLowerCase().includes(q) || p.d.some((n) => D.mobs[n].n.toLowerCase().includes(q));
    };
    els.filter.replaceChildren(...filters.map(([id, label, fn, color]) => {
      const b = h("button");
      b.type = "button";
      b.dataset.f = id;
      b.append(label, h("span", "c", String(all.filter((p) => fn(p) && matches(p)).length)));
      b.setAttribute("aria-pressed", String(prefs.filter === id));
      if (color) b.style.setProperty("--chip", color);
      return b;
    }));
    const fn = (filters.find((f) => f[0] === prefs.filter) || filters[0])[2];
    const byLeft = (a, b) => (leftOf(a) === 0) - (leftOf(b) === 0) || leftOf(a) - leftOf(b) || petName(a).localeCompare(petName(b));
    const list = all.filter((p) => fn(p) && matches(p));
    // farming now: pets you picked up souls for in the last 30 minutes, newest first
    const farming = farmingNow();
    const top = list.filter((p) => farming.has(p) && leftOf(p) > 0).sort((a, b) => farming.get(b).at - farming.get(a).at).slice(0, 6);
    const topSet = new Set(top);
    const rest = list.filter((p) => !topSet.has(p)).sort(byLeft).slice(0, 250);
    const ordered = [];
    if (top.length) {
      ordered.push(groupRow("farm", `Farming now · ${top.length}`));
      for (const pid of top) ordered.push(updateRow(petRow(pid), pid, farming.get(pid)));
      ordered.push(groupRow("rest", (filters.find((f) => f[0] === prefs.filter) || filters[0])[1]));
    }
    for (const pid of rest) ordered.push(updateRow(petRow(pid), pid, null));
    if (!list.length) ordered.push(h("li", "listnote", q ? "No pet matches." : "Nothing here."));
    // FLIP: rows that moved glide to their new place instead of jumping
    const before = new Map();
    for (const el of els.petlist.children) before.set(el, el.getBoundingClientRect().top);
    const same = ordered.length === els.petlist.children.length && ordered.every((el, i) => els.petlist.children[i] === el);
    if (!same) els.petlist.replaceChildren(...ordered);
    if (!same && prefs.effects && before.size) {
      for (const el of ordered) {
        if (!before.has(el)) continue;
        const dy = before.get(el) - el.getBoundingClientRect().top;
        if (Math.abs(dy) > 1 && Math.abs(dy) < 1500) el.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: 480, easing: "cubic-bezier(.2,.8,.2,1)" });
      }
    }
  }
  // souls per pet in the last 30 minutes, and when the last one came
  function farmingNow() {
    const out = new Map(), now = Date.now();
    for (let i = log.length - 1; i >= 0; i--) {
      const [t, pid, amt] = log[i];
      if (now - t > 30 * 60000) break;
      const k = String(pid);
      const e = out.get(k) || { at: t, n: 0 };
      e.n += amt;
      e.at = Math.max(e.at, t);
      out.set(k, e);
    }
    return out;
  }
  const petRows = new Map();
  const groupRows = {};
  function groupRow(id, text) {
    const li = (groupRows[id] = groupRows[id] || h("li", `group g-${id}`));
    li.dataset.g = id;
    li.textContent = text;
    return li;
  }
  function petRow(pid) {
    let li = petRows.get(pid);
    if (li) return li;
    const { p, tags, how, held } = petInfo(pid);
    li = h("li", "petrow");
    li.dataset.pid = pid;
    li.style.setProperty("--genus", colorOf(pid));
    const img = h("img", "pic");
    img.src = portrait(pid);
    img.alt = "";
    img.loading = "lazy";
    const mid = h("div", "mid");
    const nm = h("div", "nm");
    const name = h("b", "", petName(pid)), lv = h("span", "lv"), now = h("span", "now");
    nm.append(name, lv, now);
    const sub = h("div", "sub");
    const bar = h("span", "bar"), fill = h("i");
    bar.append(fill);
    const tg = h("span", "tags");
    for (const [c, t] of tags) tg.append(h("span", `tag ${c}`, t));
    sub.append(bar, tg);
    mid.append(nm, sub);
    if (how) mid.append(h("div", "how", how));
    const lft = h("div", "lft"), num = h("span", "cnt"), small = h("small");
    lft.append(num, small);
    const best = p.d.map((n) => D.mobs[n]).sort((a, b) => b.pts.length - a.pts.length)[0];
    li.title = (best ? `${best.n} (Lv${best.lv}) in ${mapLabel(best.map)}: click to be guided there` : p.box.length ? `Chests: ${p.box.map((b) => `${b[0]} ${b[1]}`).join(", ")}` : (p.oth.join(", ") || "No source known"))
      + (held.length ? `\nUnconfirmed: ${held.join(", ")} (community check)` : "") + (how && best ? `\n${how}` : "");
    li.append(img, mid, lft);
    li._r = { name, lv, now, fill, num, small };
    petRows.set(pid, li);
    return li;
  }
  function updateRow(li, pid, farm) {
    const r = li._r;
    const lv = level(pid), need = E.NEEDED[lv], left = leftOf(pid);
    li.classList.toggle("done", left === 0);
    li.classList.toggle("guiding", guide?.pid === pid);
    li.classList.toggle("farming", !!farm);
    r.name.textContent = petName(pid);
    r.lv.textContent = lv >= E.MAX_LEVEL ? "MAX" : `Lv${lv} · ${pointsOf(pid)}/${need}`;
    r.now.hidden = !farm;
    if (farm) r.now.textContent = `+${farm.n}`;
    r.now.title = farm ? `${farm.n} soul${farm.n === 1 ? "" : "s"} in the last 30 minutes` : "";
    r.num.textContent = left === 0 ? "✓" : String(left);
    r.small.textContent = left === 0 ? "done" : "left";
    const pct = need ? (pointsOf(pid) / need) * 100 : 100;
    if (li._lv !== undefined && lv > li._lv && prefs.effects) {
      // a level: the bar fills up, flashes, then starts again from the new level's count
      r.fill.style.width = "100%";
      li.classList.add("lvup");
      setTimeout(() => {
        r.fill.style.transition = "none";
        r.fill.style.width = "0%";
        void r.fill.offsetWidth;
        r.fill.style.transition = "";
        r.fill.style.width = `${need ? (pointsOf(pid) / need) * 100 : 100}%`;
        li.classList.remove("lvup");
      }, 750);
    } else if (!li.classList.contains("lvup")) r.fill.style.width = `${pct}%`;
    li._lv = lv;
    return li;
  }
  // a soul while the Pets tab is open: the row glows and a +1 rises from its count
  function pulsePetRow(pid, amount) {
    const li = petRows.get(pid);
    if (!li || !li.isConnected || !visible(li)) return;
    li.classList.remove("gain"); void li.offsetWidth; li.classList.add("gain");
    // a row gliding up to "Farming now": the +1 rises once it has arrived
    const moving = li.getAnimations ? li.getAnimations().some((a) => a.playState === "running") : false;
    setTimeout(() => {
      const r = li._r.num.getBoundingClientRect();
      if (r.top > 0 && r.bottom < window.innerHeight) FX.plus(r.left + r.width / 2, r.top, `+${amount}`, colorOf(pid));
    }, moving ? 480 : 0);
  }

  // ── stats tab ────────────────────────────────────────────────
  function renderStats() {
    const st = E.sessionStats([...log].sort((a, b) => a[0] - b[0]), Date.now());
    const box = els.stats;
    box.replaceChildren();
    const grid = h("div", "statgrid");
    const stat = (v, k, hot) => { const s = h("div", `stat${hot ? " hot" : ""}`); s.append(h("div", "v", v), h("div", "k", k)); return s; };
    const ses = st.session;
    grid.append(
      stat(ses ? String(ses.souls) : "0", "souls this session", true),
      stat(ses && ses.ms >= 300000 ? String(Math.round(ses.perHour)) : "–", "souls per hour"),
      stat(ses ? fmtDur(ses.ms) : "–", "farming time"),
      stat(String(st.today.souls), "today"),
      stat(st.today.ms >= 300000 ? String(Math.round(st.today.perHour)) : "–", "per hour today"),
      stat(String(st.all.souls), "all time"),
    );
    box.append(grid);
    // best areas
    // an area needs a few souls and a few minutes before its rate means anything
    const rated = (a) => a.souls >= 3 && a.ms >= 180000;
    const areas = Object.values(st.areas).sort((a, b) => rated(b) - rated(a) || (rated(a) ? b.perHour - a.perHour : 0) || b.souls - a.souls);
    const h3a = h("h3", "", "Best areas");
    h3a.append(h("small", "", "souls per hour of farming there"));
    box.append(h3a);
    if (!areas.length) box.append(h("p", "note", "Pick up souls and each area you farm shows up here, ranked by souls per hour."));
    else {
      const ul = h("ul", "areas");
      const max = Math.max(...areas.filter(rated).map((a) => a.perHour), 1);
      areas.slice(0, 10).forEach((a, i) => {
        const li = h("li", `area${i === 0 && rated(a) ? " best" : ""}`);
        const nm = h("span", "nm", a.area);
        if (a.map) nm.append(h("small", "", mapLabel(a.map)));
        const s = h("span", "s", String(a.souls));
        s.append(h("small", "", "souls"));
        const hr = h("span", "h", rated(a) ? String(Math.round(a.perHour)) : "–");
        hr.append(h("small", "", "/h"));
        const bar = h("span", "bar");
        const fill = h("i");
        fill.style.width = rated(a) ? `${(a.perHour / max) * 100}%` : "0%";
        bar.append(fill);
        li.append(nm, s, hr, bar);
        li.title = `${a.souls} souls in ${fmtDur(a.ms)} of farming${a.today ? `, ${a.today} today` : ""}`;
        ul.append(li);
      });
      box.append(ul);
      box.append(h("p", "note", "A soul counts for the area of the stop you were on when it dropped there; otherwise for that pet's best spot."));
    }
    // stats from pets
    const tot = E.totalEffects(D, pets.levels);
    const h3s = h("h3", "", "Stats from your pets");
    h3s.append(h("small", "", "owned effects, by genus"));
    box.append(h3s);
    const sum = h("div", "gs");
    sum.style.display = "flex"; sum.style.flexWrap = "wrap"; sum.style.gap = "4px";
    for (const [k, v] of Object.entries(tot.sum)) { const c = h("span", "chip-stat"); c.append(h("b", "", `+${v}${k.endsWith("%") ? "%" : ""}`), ` ${k.replace(/ %$/, "")}`); sum.append(c); }
    if (!Object.keys(tot.sum).length) sum.append(h("span", "note", "No pets yet."));
    box.append(sum);
    for (const g of E.GENERA) {
      const G = tot.byGenus[g];
      const total = Object.values(D.pets).filter((p) => p.g === g).length;
      const row = h("div", "genus");
      row.style.setProperty("--genus", E.GENUS_COLOR[g]);
      const owned = G ? G.pets : 0;
      const gn = h("span", "gn", `${E.GENUS_NAME[g]}`);
      gn.append(h("span", "", ` · ${owned}/${total} pets${G ? ` · ${G.levels[3]} at Lv3` : ""}`));
      gn.lastChild.style.cssText = "color:var(--mute);font-weight:400";
      const gl = h("span", "gl", G ? `insight Lv ${G.level}` : "insight Lv 1");
      gl.title = G ? `${G.exp.toLocaleString()} EXP from pets (500 per new pet, 250 at Lv2 and Lv3); analyses add more` : "";
      const gb = h("span", "gb");
      const fill = h("i");
      fill.style.width = G && G.expToNext ? `${(G.expInLevel / G.expToNext) * 100}%` : G ? "100%" : "0%";
      gb.append(fill);
      const gs = h("div", "gs");
      if (G) for (const [k, v] of Object.entries(G.stats)) { const c = h("span", "chip-stat"); c.append(h("b", "", `+${v}${k.endsWith("%") ? "%" : ""}`), ` ${k.replace(/ %$/, "")}`); gs.append(c); }
      row.append(gn, gl, gb, gs);
      box.append(row);
    }
    box.append(h("p", "note", "Insight level is an estimate from your pets alone (genus analyses also give EXP). Effect values: wikily.gg and MetaBot.GG."));
    // level-ups today
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const ups = levelLog.filter((e) => e[0] >= +today);
    if (ups.length) {
      box.append(h("h3", "", `Level-ups today: ${ups.length}`));
      const row = h("div", "gs");
      row.style.display = "flex"; row.style.flexWrap = "wrap"; row.style.gap = "4px";
      for (const [, pid, lv] of ups.slice(-24)) row.append(h("span", "chip-stat", `${petName(String(pid))} Lv${lv}`));
      box.append(row);
    }
    const btns = h("div", "btnrow");
    const reset = h("button", "btn", "Reset stats");
    reset.type = "button";
    reset.addEventListener("click", () => {
      if (reset.dataset.armed) { log = []; levelLog = []; save(); renderStats(); return; }
      reset.dataset.armed = "1";
      reset.textContent = "Click again to reset";
      setTimeout(() => { delete reset.dataset.armed; reset.textContent = "Reset stats"; }, 3000);
    });
    btns.append(reset);
    box.append(btns);
  }

  // ── settings tab ─────────────────────────────────────────────
  function renderSettings() {
    const f = els.settings;
    f.replaceChildren();
    let into = f;
    const sOpen = (prefs.sOpen = prefs.sOpen && typeof prefs.sOpen === "object" ? prefs.sOpen : { you: true });
    // a collapsible group: its header shows what's set inside, so you rarely need to open it
    const group = (id, title, summary) => {
      const g = h("section", "sgroup");
      g.classList.toggle("open", !!sOpen[id]);
      const hd = h("button", "shead");
      hd.type = "button";
      hd.setAttribute("aria-expanded", String(!!sOpen[id]));
      hd.append(h("span", "st", title), h("span", "ss", summary || ""), h("span", "sc", "›"));
      hd.addEventListener("click", () => {
        sOpen[id] = !sOpen[id];
        g.classList.toggle("open", sOpen[id]);
        hd.setAttribute("aria-expanded", String(sOpen[id]));
        savePrefs();
        Sound.tick();
      });
      const body = h("div", "sbody"), inner = h("div", "sin");
      body.append(inner);
      g.append(hd, body);
      f.append(g);
      into = inner;
    };
    const row = (label, hint, control) => {
      const r = h("div", "row");
      const l = h("div", "lbl", label);
      if (hint) l.append(h("small", "", hint));
      r.append(l, control);
      into.append(r);
    };
    const seg = (keyName, options, after) => {
      const s = h("div", "seg");
      for (const [v, label] of options) {
        const b = h("button", "", label);
        b.type = "button";
        b.setAttribute("aria-pressed", String(prefs[keyName] === v));
        b.addEventListener("click", () => { prefs[keyName] = v; savePrefs(); if (after) after(); renderSettings(); });
        s.append(b);
      }
      return s;
    };
    const toggle = (keyName, after) => {
      const b = h("button", "toggle");
      b.type = "button";
      b.setAttribute("aria-pressed", String(!!prefs[keyName]));
      b.setAttribute("aria-label", keyName);
      b.addEventListener("click", () => { prefs[keyName] = !prefs[keyName]; savePrefs(); applyPrefs(); if (after) after(); renderSettings(); });
      return b;
    };
    const onOff = (v) => (v ? "on" : "off");
    const reroute = () => { rebuild(); renderHeader(); };
    const side = serverOf(key) ? (faction() === "asmodian" ? "Asmodian" : "Elyos") : "Elyos";
    const lvNow = prefs.myLevel || Number(character?.level) || 0;

    // ── your character ──
    group("you", "Your character", `${prefs.faction === "auto" ? side : prefs.faction === "asmodian" ? "Asmodian" : "Elyos"}${lvNow ? ` · Lv ${lvNow}` : ""} · goal Lv ${prefs.goal}${pets.syncedAt ? "" : " · pet list missing"}`);
    const synced = pets.syncedAt ? `${new Date(pets.syncedAt).toLocaleString()} · ${Object.keys(pets.levels).length} pets · ${key || "?"}` : "Not yet: relog with this plugin loaded";
    const syncInfo = h("span", "chip-stat", pets.syncedAt ? "✓" : "✗");
    syncInfo.style.color = pets.syncedAt ? "var(--done)" : "#ff8a7a";
    row("Pet list", synced, syncInfo);
    row("Faction", prefs.faction === "auto" ? `Auto: ${side}${serverOf(key) ? ` (server ${serverOf(key)})` : ""}` : "", seg("faction", [["auto", "Auto"], ["elyos", "Elyos"], ["asmodian", "Asmodian"]], reroute));
    const lvl = h("input", "num");
    lvl.type = "number";
    lvl.min = "0";
    lvl.max = "60";
    lvl.value = String(prefs.myLevel || "");
    lvl.placeholder = String(character?.level || "auto");
    lvl.addEventListener("change", () => { prefs.myLevel = Math.max(0, Math.min(60, Number(lvl.value) || 0)); savePrefs(); reroute(); }); // the level decides the Abyss (Lv 45+) and, with the penalty, low monsters
    row("My level", prefs.myLevel ? "Set by hand (empty = from the game)" : `From the game${character?.level ? `: ${character.level}` : ""}`, lvl);
    row("Goal level", `${E.soulsTotal(prefs.goal)} souls per pet`, seg("goal", [[1, "1"], [2, "2"], [3, "3"]], () => { rstate.base = {}; reroute(); }));

    // ── route ──
    group("route", "Route", `${prefs.order === "nearest" ? "Fewest stops" : "By genus"} · Rift route ${onOff(prefs.rift)} · free route ${onOff(prefs.freeAuto)}`);
    row("Route order", prefs.order === "nearest" ? "Fewest stops" : "One genus at a time", seg("order", [["priority", "Priority"], ["nearest", "Fewest stops"]], reroute));
    if (prefs.order !== "nearest") {
      const p = h("div", "prio");
      prefs.priority.forEach((g, i) => {
        const b = h("button", "", `${i + 1}. ${E.GENUS_NAME[g]}`);
        b.type = "button";
        b.style.setProperty("--g", E.GENUS_COLOR[g]);
        b.title = i ? "Move up" : "First";
        b.addEventListener("click", () => {
          if (!i) return;
          const pr = [...prefs.priority];
          [pr[i - 1], pr[i]] = [pr[i], pr[i - 1]];
          prefs.priority = pr;
          savePrefs();
          reroute();
          renderSettings();
        });
        p.append(b);
      });
      row("Priority", "Click a genus to move it up", p);
    }
    row("Rift route", "A second route on the other side's map, for when a Rift is open. The main route stays on your side", toggle("rift", reroute));
    if (prefs.rift) row("Rift alerts", "5 minutes before each Rift: offer the Rift route", seg("riftAlert", [["on", "On"], ["off", "Off"]]));
    row("Abyss route", "When you enter the Abyss: offer the Abyss route, or say when every pet in there is done", seg("abyssAlert", [["on", "Ask"], ["off", "Off"]]));
    row("Skip low monsters", "Count monsters 10+ levels below you as rare (they're often cleared by others)", toggle("levelPenalty", reroute));
    row("Next stop by itself", "When every pet at a stop is done", toggle("autoNext"));
    row("Free route", "Farming a pet that isn't on the stop? The guide picks it up where you are", toggle("freeAuto"));
    row("Switch after", "Souls in a row for that pet", seg("freeAfter", [[2, "2"], [3, "3"], [5, "5"]]));

    // ── size & folding ──
    {
      const idle = prefs.tipIdle ? `${prefs.tipIdle} min` : "off";
      const SIZE = { tip: "tip", compact: "compact", full: "full" };
      group("tip", "Size & folding", `${prefs.smartOpen ? "smart size" : "stays as you set it"}${prefs.tip ? ` · fold after ${idle}` : ""}`);
      // one choice: the guide sizes itself, or stays the size you pick with the size button
      const sz = h("div", "seg");
      for (const [v, label] of [[true, "Smart"], [false, "Stay as I set it"]]) {
        const b = h("button", "", label);
        b.type = "button";
        b.setAttribute("aria-pressed", String(!!prefs.smartOpen === v));
        b.addEventListener("click", () => { prefs.smartOpen = v; savePrefs(); renderSettings(); });
        sz.append(b);
      }
      row("Sizing", prefs.smartOpen
        ? `Smart: on the way to a new stop, the full guide with the map; 3 s after your first soul there, back to ${prefs.farmSize === "full" ? "full" : prefs.farmSize === "tip" ? "the tip" : "compact"} (the size you last picked with the button by the padlock)`
        : `Stays ${prefs.farmSize === "full" ? "full" : "compact"}: the size you picked with the button by the padlock, until you switch it`, sz);
      row("Map in compact", "Show the map in the compact guide too", toggle("compactMap", () => { applyView(); render(); }));
      row("Monster list", "Rings, or bars that fill up. Or the small button at the end of the list", seg("qStyle", [["ring", "Rings"], ["bar", "Bars"]], applyQStyle));
      row("Finished monsters", "In the monster list, once their pet is done", seg("qDone", [[true, "Show"], [false, "Hide"]], applyQStyle));
      row("Monsters shown", "At most this many in the list (the one you farm always shows)", seg("qMax", [[0, "All"], [3, "3"], [5, "5"], [8, "8"]], () => render()));
      row("Header", "Slim: one line, the stop and zone", seg("slimHead", [[false, "Normal"], [true, "Slim"]], applyPartOpts));
      row("Directions", "The full route (where to walk, the farming loop), or just the teleport", seg("travelText", [["full", "Full route"], ["short", "Teleport only"]], () => render()));
      if (HOST) {
        const lb = h("div", "btnrow");
        const ed = h("button", "btn gold", "Edit layout");
        ed.type = "button";
        ed.addEventListener("click", () => startEdit());
        const rs = h("button", "btn", "Reset");
        rs.type = "button";
        rs.title = "Both sizes back to how they were";
        rs.addEventListener("click", () => { prefs.layout = null; prefs.mapSize = null; savePrefs(); applyLayout(); applyMapFrame(); render(); flash("↺ Layout back to how it was"); });
        lb.append(ed, rs);
        const n = prefs.layout ? Object.values(prefs.layout).reduce((a, V) => a + Object.values(V || {}).filter((L) => L && Object.keys(L).length).length, 0) : 0;
        row("Layout", `Move, resize or hide any part of the guide: the pencil by the padlock${n ? ` · ${n} part${n === 1 ? "" : "s"} changed` : ""}`, lb);
      }
      if (!HOST) row("Tip mode", "Fold the guide into a small tip; click the tip to open it. Shrink the window by its edge to fit", toggle("tip", () => { prefs.folded = false; applyTip(); render(); }));
      if (prefs.tip) {
        if (!HOST) row("Tip position", "", seg("tipPos", [["top", "Top"], ["bottom", "Bottom"], ["left", "Left"], ["right", "Right"], ["center", "Middle"]], applyTip));
        row("Fold when hunting stops", "No pet souls for this long", seg("tipIdle", [[0, "Off"], [1, "1 min"], [3, "3 min"], [5, "5 min"]], applyTip));
        if (prefs.tipIdle) row("When hunting resumes", "After it folded by itself", seg("tipResume", [["open", "Open again"], ["stay", "Stay folded"]]));
        row("Fold when mouse leaves", HOST ? "Mouse away from the guide for this long" : "No mouse in this window for this long", seg("tipAuto", [[0, "Off"], [20, "20 s"], [60, "1 min"]], applyTip));
        row("In dungeons", "Field souls don't drop inside: fold away, and open again when you leave", seg("dungeonFold", [["fold", "Fold"], ["off", "Leave it"]]));
      }
    }

    // ── map ──
    group("map", "Map", prefs.map ? `${prefs.mapLoop === false ? "loop off" : "farming loop on"} · loot strip ${onOff(prefs.loot)}` : "hidden");
    row("Map", "Shape, size, loop and icons: the small buttons under the map", toggle("map", () => render()));
    if (prefs.map) row("Show the map", "In the full guide. On the way: only until you start farming at the stop", seg("mapWhen", [["always", "Always"], ["way", "On the way"]], () => render()));
    row("Also drops", "The scrolling loot strip under the map", toggle("loot", () => { lootKey = ""; render(); }));
    if (prefs.loot) row("Drops shown", "Every drop, or only Rare and up", seg("lootMin", [["all", "All"], ["rare", "Rare and up"]], () => { lootKey = ""; render(); }));

    // ── tips ──
    {
      const tb = h("div", "btnrow");
      const again = h("button", "btn", "Show the tour again");
      again.type = "button";
      again.addEventListener("click", () => { prefs.tourSeen = []; prefs.tourOff = false; savePrefs(); selectTab("guide"); });
      group("tips", "Tips", prefs.tourOff ? "off" : "on");
      const onoff = h("div", "seg");
      for (const [v, label] of [[false, "On"], [true, "Off"]]) {
        const b = h("button", "", label);
        b.type = "button";
        b.setAttribute("aria-pressed", String(!!prefs.tourOff === v));
        b.addEventListener("click", () => { prefs.tourOff = v; savePrefs(); renderSettings(); });
        onoff.append(b);
      }
      row("Tips", prefs.tourOff ? "Off: no tips, not even for new features" : "A quick tour the first time, then a tip for each new feature, once", onoff);
      tb.append(again);
      row("Tour", "See every tip again, now", tb);
    }

    // ── look ──
    const THEMES = HOST ? [["hud", "HUD"], ["apple", "Apple"], ["ingame", "In-game"], ["classic", "Classic"]] : [["classic", "Classic"], ["ingame", "In-game"]];
    const themeHint = { hud: "No panel: each part floats over the game on its own", apple: "Clean white type on soft glass", ingame: HOST ? "Styled like AION 2's own HUD" : "In-game: also drag the meter's opacity slider (title bar) all the way down", classic: "The gold-on-dark panel" };
    group("look", "Look", `${(THEMES.find((t) => t[0] === prefs.theme) || ["", prefs.theme])[1]} · effects ${onOff(prefs.effects)}`);
    row("Theme", themeHint[prefs.theme] || "", seg("theme", THEMES, () => { applyPrefs(); lootKey = ""; render(); }));
    if (HOST && HOST.settings) HOST.settings({ row, seg, toggle, h, prefs, savePrefs }, "look");
    row("Effects", "Orbs, sparks, rings and the scrolling loot", toggle("effects", () => { lootKey = ""; }));

    // ── sound ──
    group("sound", "Sound", prefs.sounds ? `on · ${Math.round(prefs.volume * 100)}%` : "off");
    row("Sounds", "Chimes after your first click in this window", toggle("sounds"));
    const vol = h("input");
    vol.type = "range";
    vol.min = "0";
    vol.max = "1";
    vol.step = "0.05";
    vol.value = String(prefs.volume);
    vol.addEventListener("input", () => { prefs.volume = Number(vol.value); applyPrefs(); });
    vol.addEventListener("change", () => { savePrefs(); Sound.soul("cogni"); });
    row("Volume", "", vol);

    // ── the overlay app ──
    if (HOST && HOST.settings) {
      group("overlay", "Overlay", HOST.summary ? HOST.summary() : "");
      HOST.settings({ row, seg, toggle, h, prefs, savePrefs }, "app");
    }

    into = f;
    const btns = h("div", "btnrow");
    const rb = h("button", "btn gold", "Rebuild route");
    rb.type = "button";
    rb.addEventListener("click", () => { rstate.base = {}; rebuild(); if (route.length) setStop(nextWork(0, 1, true)); toast(route.length ? `Route rebuilt: ${route.length} stops` : "Nothing left to farm with these settings"); render(); });
    const test = h("button", "btn", "Preview a soul");
    test.type = "button";
    test.title = "Shows the soul animation without changing your counts";
    test.addEventListener("click", () => { selectTab("guide"); setTimeout(previewSoul, 150); });
    btns.append(rb, test);
    f.append(btns);
    els.ver.textContent = `Data snapshot ${D.v} · ${route.length} stops · ${Object.keys(D.pets).filter((p) => E.isFarmable(D, p)).length} farmable pets`;
    els.ver.title = D.community ? `Spawns and drops: MetaBot.GG. Island Windstreams, Abyss bases, bosses and unconfirmed sources: ${D.community.credit}` : "";
  }
  // the small recording card (plugin, while the overlay is on screen)
  const compEl = document.querySelector(".reccard"), compN = document.querySelector(".reccard .cn");
  function renderCompanion() {
    if (!compEl) return;
    const on = document.body.classList.contains("companion");
    compEl.hidden = !on;
    if (!on) return;
    const st = E.sessionStats([...log].sort((a, b) => a[0] - b[0]), Date.now());
    compN.textContent = String(st.session && Date.now() - st.session.last < 30 * 60000 ? st.session.souls : 0);
  }
  window.FG_renderCompanion = renderCompanion;
  function previewSoul() {
    const m = getModel();
    if (!m || !m.focus) return;
    const pid = m.focus.pid;
    const c = m.contents[pid];
    const from = mapView && mapView.visible() && c ? mapView.toScreen(c.x, c.y) : center(els.travel);
    if (mapView) mapView.pulse();
    FX.orb(from, () => center(els.dial), colorOf(pid), () => {
      const at = center(els.dial);
      Sound.soul(genusOf(pid), streakNow());
      FX.burst(at.x, at.y, colorOf(pid), { count: 22, speed: 150, spread: 60 });
      FX.plus(at.x, at.y - 40, "+1");
      els.dial.classList.remove("pulse"); void els.dial.offsetWidth; els.dial.classList.add("pulse");
    });
  }
  // ── the map's frame: shape, size and fold, right on the map ──
  const MAP_MIN = 120, MAP_MAX = 460;
  const isHud = () => document.body.classList.contains("hud");
  const mapShape = () => prefs.mapShape || (isHud() ? "round" : "square");
  const defaultMapSize = () => (isHud() ? 210 : 230);
  function applyMapFrame() {
    const round = mapShape() === "round";
    document.body.classList.toggle("map-round", round);
    document.body.classList.toggle("map-square", !round);
    document.body.classList.toggle("map-sized", round || isHud() || !!prefs.mapSize);
    document.body.style.setProperty("--msz", `${mapFit && !els.mapzone.classList.contains("detached") ? Math.min(mapFit, mapNat()) : mapNat()}px`);
    els.mapzone.classList.toggle("folded", !!prefs.mapFold);
    els.mbShape.title = round ? "Round map: click for square" : "Square map: click for round";
    els.mbLoop.setAttribute("aria-pressed", String(prefs.mapLoop !== false));
    els.mbIcons.setAttribute("aria-pressed", String(prefs.mapIcons !== false));
    els.mbIcons.title = prefs.mapIcons === false ? "Show the monster icons" : "Hide the monster icons (see the loop clearly)";
    if (mapView) { mapView.showLoop = prefs.mapLoop !== false; mapView.showIcons = prefs.mapIcons !== false; mapView.kick(); }
  }
  function setMapFold(fold) {
    if (fold === !!prefs.mapFold) return;
    const w = els.mapwrap, z = els.mapzone;
    prefs.mapFold = fold;
    savePrefs();
    Sound.slide(!fold);
    if (!prefs.effects || !w.offsetParent) { applyMapFrame(); return; }
    let done = false;
    const end = () => { if (done) return; done = true; w.style.height = ""; w.style.flex = ""; if (mapView) mapView.resize(); };
    if (fold) {
      w.style.height = `${w.offsetHeight}px`;
      w.style.flex = "none";
      void w.offsetHeight;
      applyMapFrame();
    } else {
      // how tall it will be: measure open, without the animation
      z.classList.add("resizing"); z.classList.remove("folded");
      const target = w.offsetHeight;
      z.classList.add("folded"); void w.offsetHeight; z.classList.remove("resizing");
      w.style.height = "0px"; w.style.flex = "none";
      applyMapFrame();
      void w.offsetHeight;
      w.style.height = `${target}px`;
    }
    w.addEventListener("transitionend", function te(e) { if (e.target === w && e.propertyName === "height") { w.removeEventListener("transitionend", te); end(); } });
    setTimeout(end, 600);
  }
  els.mbShape.addEventListener("click", () => {
    prefs.mapShape = mapShape() === "round" ? "square" : "round";
    savePrefs(); applyMapFrame(); Sound.tick();
  });
  els.mbIcons.addEventListener("click", () => {
    prefs.mapIcons = prefs.mapIcons === false;
    savePrefs(); applyMapFrame(); Sound.tick();
  });
  els.mbLoop.addEventListener("click", () => {
    prefs.mapLoop = prefs.mapLoop === false;
    savePrefs(); applyMapFrame(); Sound.tick();
    model = null; render();
  });
  // resize: drag the grip; double-click it for the default size
  els.mapgrip.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const w = els.mapwrap, k = w.getBoundingClientRect().width / (w.offsetWidth || 1) || 1;
    const both = mapShape() === "round" || isHud(), flip = document.body.classList.contains("side-right") ? -1 : 1;
    const st = { x: e.clientX, y: e.clientY, s: prefs.mapSize || (both ? defaultMapSize() : w.offsetHeight) };
    els.mapzone.classList.add("resizing");
    els.mapgrip.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const dx = ((ev.clientX - st.x) / k) * flip, dy = (ev.clientY - st.y) / k;
      const d = both ? (dx + dy) / 2 : dy;
      prefs.mapSize = Math.round(Math.max(MAP_MIN, Math.min(MAP_MAX, st.s + d)));
      applyMapFrame();
    };
    const up = () => {
      els.mapgrip.removeEventListener("pointermove", move);
      els.mapgrip.removeEventListener("pointerup", up);
      els.mapgrip.removeEventListener("pointercancel", up);
      els.mapzone.classList.remove("resizing");
      savePrefs();
    };
    els.mapgrip.addEventListener("pointermove", move);
    els.mapgrip.addEventListener("pointerup", up);
    els.mapgrip.addEventListener("pointercancel", up);
  });
  els.mapgrip.addEventListener("dblclick", (e) => { e.stopPropagation(); prefs.mapSize = null; savePrefs(); applyMapFrame(); });
  // the guide's width (in the overlay, compact and full alike): drag its grip; double-click for the default
  const GW_MIN = 260, GW_MAX = 520;
  els.cgrip.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || prefs.locked) return;
    e.preventDefault();
    e.stopPropagation();
    const app = $("#app"), flip = document.body.classList.contains("dock-right") ? -1 : 1; // docked right, it grows to the left
    const z = app.getBoundingClientRect().width / (app.offsetWidth || 1) || 1;
    const st = { x: e.clientX, w: app.offsetWidth };
    els.cgrip.setPointerCapture(e.pointerId);
    document.body.classList.add("resizing-c");
    const move = (ev) => {
      prefs.gw = Math.round(Math.max(GW_MIN, Math.min(GW_MAX, st.w + (flip * (ev.clientX - st.x)) / z)));
      document.documentElement.style.setProperty("--gw", `${prefs.gw}px`);
      if (HOST && HOST.onFold) HOST.onFold(isFolded());
    };
    const up = () => {
      document.body.classList.remove("resizing-c");
      els.cgrip.removeEventListener("pointermove", move);
      els.cgrip.removeEventListener("pointerup", up);
      els.cgrip.removeEventListener("pointercancel", up);
      savePrefs();
    };
    els.cgrip.addEventListener("pointermove", move);
    els.cgrip.addEventListener("pointerup", up);
    els.cgrip.addEventListener("pointercancel", up);
  });
  els.cgrip.addEventListener("dblclick", (e) => { e.stopPropagation(); prefs.gw = 0; savePrefs(); applyView(); });
  // ── the monster list: rings or bars ──
  // The small button at the end of the list switches. The cells glide from the row into the stack
  // (or back), the list's height glides with them, and the bars fill up from empty.
  const kOf = (el) => (el.getBoundingClientRect().width / (el.offsetWidth || 1)) || 1; // screen px per CSS px
  // the part options that are just a look: one place applies them all
  function applyPartOpts() {
    const cls = document.body.classList;
    cls.toggle("nolv", prefs.showLv === false);
    cls.toggle("nokills", prefs.showKills === false);
    cls.toggle("slimhead", !!prefs.slimHead);
    const a = Number(prefs.mapAlpha) || 1;
    if (a < 1) els.mapwrap.style.setProperty("--malpha", String(a)); else els.mapwrap.style.removeProperty("--malpha");
  }
  function applyQStyle() {
    applyPartOpts();
    const bars = prefs.qStyle === "bar";
    els.qwrap.classList.toggle("nodone", prefs.qDone === false);
    els.qwrap.classList.toggle("bars", bars);
    els.qstyle.title = bars ? "Show the monsters as rings" : "Show the monsters as bars";
    els.qstyle.setAttribute("aria-label", els.qstyle.title);
  }
  function setQStyle(style) {
    if ((prefs.qStyle || "ring") === style) return;
    prefs.qStyle = style;
    savePrefs();
    const q = els.queue, cells = [...q.children].filter((c) => !c.classList.contains("leave"));
    const anim = !!prefs.effects && visible(q) && cells.length > 0;
    const first = anim ? cells.map((c) => c.getBoundingClientRect()) : null;
    const h0 = q.offsetHeight;
    if (anim && style === "bar") for (const c of cells) { c.classList.add("grow0"); c.querySelector(".qbar i").style.setProperty("--p", "0%"); }
    applyQStyle();
    Sound.tick();
    if (HOST && HOST.onFold) HOST.onFold(isFolded());
    if (!anim) return;
    const k = kOf(q), h1 = q.offsetHeight;
    cells.forEach((c, i) => {
      const r = c.getBoundingClientRect();
      c.classList.remove("flip");
      c.style.transform = `translate(${(first[i].left - r.left) / k}px, ${(first[i].top - r.top) / k}px)`;
    });
    q.style.height = `${h0}px`;
    q.classList.add("morph");
    void q.offsetHeight;
    for (const c of cells) { c.classList.add("flip"); c.style.transform = ""; }
    q.style.height = `${h1}px`;
    // the bars fill up from empty, a little after the rows land
    setTimeout(() => { for (const c of cells) { c.classList.remove("grow0"); c.querySelector(".qbar i").style.setProperty("--p", c.dataset.p || "0%"); } }, 160);
    clearTimeout(q._morph);
    q._morph = setTimeout(() => { q.classList.remove("morph"); q.style.height = ""; for (const c of cells) c.classList.remove("flip"); if (HOST && HOST.onFold) HOST.onFold(isFolded()); }, 480);
  }
  els.qstyle.addEventListener("click", (e) => { e.stopPropagation(); setQStyle(prefs.qStyle === "bar" ? "ring" : "bar"); });

  // ── a size switch: the bottom rolls up to the header, or down from it; the header stays put ──
  // (the overlay keeps the header where it is; here the guide's bottom edge glides to its new place)
  let morphTimer = 0;
  function morphView(apply) {
    const app = $("#app"), cls = document.body.classList;
    if (HOST && HOST.holdHeader) HOST.holdHeader(); // the header stays where it is; the bottom moves
    clearTimeout(morphTimer);
    app.classList.remove("morphing", "morph-in");
    app.style.clipPath = "";
    if (!prefs.effects || tab !== "guide" || isFolded() || editing || !app.getBoundingClientRect().height) return apply();
    const h0 = app.offsetHeight;
    // how tall the other size is: measure it once, without painting it
    const was = [cls.contains("vcompact"), cls.contains("vcmap")];
    cls.toggle("vcompact", isCompact());
    cls.toggle("vcmap", isCompact() && !!prefs.compactMap);
    const h1 = app.offsetHeight;
    cls.toggle("vcompact", was[0]);
    cls.toggle("vcmap", was[1]);
    if (Math.abs(h1 - h0) < 6) return apply();
    const clip = (b) => `inset(-2000px -2000px ${Math.max(0, b)}px -2000px)`;
    const done = () => { app.classList.remove("morphing"); app.style.clipPath = ""; };
    if (h1 < h0) {
      // smaller: the bottom rolls up to the new height first, then the compact guide is there
      app.style.clipPath = clip(0);
      void app.offsetHeight;
      app.classList.add("morphing");
      app.style.clipPath = clip(h0 - h1);
      morphTimer = setTimeout(() => {
        done();
        apply();
        app.classList.add("morph-in");
        morphTimer = setTimeout(() => app.classList.remove("morph-in"), 360);
      }, 280);
    } else {
      // bigger: the full guide is there at once, its bottom rolls down from where compact ended
      apply();
      const h2 = app.offsetHeight;
      app.style.clipPath = clip(h2 - h0);
      void app.offsetHeight;
      app.classList.add("morphing", "morph-in");
      app.style.clipPath = clip(0);
      morphTimer = setTimeout(() => { done(); app.classList.remove("morph-in"); }, 340);
    }
  }

  // ── edit mode (the overlay): move, resize, hide any part; click one for its options ──
  // A part you drag leaves the guide's column (the rest closes up) and keeps its place against the
  // guide, measured from the edge the guide is docked to, so it follows the guide anywhere. Scroll
  // over a part to make it bigger or smaller; click it for its options; double-click to put it back.
  // Each size (compact, full) has its own layout.
  const EDIT_PARTS = ["focus", "travel", "queue", "map", "loot"];
  const PART_NAME = { focus: "Monster", travel: "Directions", queue: "Monster list", map: "Map", loot: "Also drops", header: "Header" };
  const partEl = (b) => (b === "header" ? els.top : $(`[data-edit="${b}"]`));
  let editing = false, picked = null;
  const viewKey = () => (isCompact() ? "compact" : "full");
  function lay(b, view = viewKey()) {
    if (!prefs.layout || typeof prefs.layout !== "object") prefs.layout = {};
    const V = prefs.layout[view] && typeof prefs.layout[view] === "object" ? prefs.layout[view] : (prefs.layout[view] = {});
    return V[b] && typeof V[b] === "object" ? V[b] : (V[b] = {});
  }
  const peek = (b, view = viewKey()) => (HOST && prefs.layout && prefs.layout[view] && prefs.layout[view][b]) || {};
  const isOff = (b, view = viewKey()) => {
    const L = peek(b, view);
    if (b === "map") return !prefs.map || (view === "compact" ? !prefs.compactMap : !!L.hide);
    if (b === "loot") return !prefs.loot || !!L.hide;
    return !!L.hide;
  };
  const flipX = () => (document.body.classList.contains("dock-right") ? -1 : 1);
  function applyLayout() {
    let moved = false;
    for (const b of EDIT_PARTS) {
      const el = partEl(b), L = peek(b);
      if (!el) continue;
      const s = b !== "map" && L.s && L.s !== 1 ? L.s : 0;
      if (s) el.style.setProperty("--ez", String(s)); else el.style.removeProperty("--ez");
      const det = isMoved(L);
      el.classList.toggle("detached", det);
      if (det) {
        moved = true;
        if (L.w) el.style.setProperty("--ew", `${L.w}px`); else el.style.removeProperty("--ew");
      } else for (const v of ["--ex", "--ey", "--ew"]) el.style.removeProperty(v);
      el.classList.toggle("ehide", !!L.hide && !(b === "map" && isCompact()));
    }
    const pic = peek("focus").pic;
    if (pic && pic !== 1) els.dial.style.setProperty("--pic", String(pic)); else els.dial.style.removeProperty("--pic");
    document.body.classList.toggle("edited", moved);
    placeDetached();
  }
  // A part you moved is pinned to the screen (where you put it, as a share of the screen, so a
  // different resolution keeps the layout): moving the guide by its header doesn't take it along.
  // It's placed from where the guide is now, and kept on screen.
  const isMoved = (L) => Number.isFinite(L.px) || Number.isFinite(L.x);
  function placeDetached() {
    const box = HOST && HOST.appBox ? HOST.appBox() : null;
    if (!box || isFolded()) return;
    const W = innerWidth, H = innerHeight;
    for (const b of EDIT_PARTS) {
      const el = partEl(b);
      if (!el || !el.classList.contains("detached")) continue;
      const L = peek(b), s = (b === "map" ? 1 : L.s || 1) * box.z;
      const w = el.offsetWidth * s, hh = el.offsetHeight * s;
      if (!Number.isFinite(L.px)) {
        // a layout from 1.20.0: kept against the guide's docked edge; pin it where it is now
        const right = document.body.classList.contains("dock-right");
        const P = lay(b);
        P.px = (right ? box.pl + box.pw - L.x * box.z - w : box.pl + L.x * box.z) / W;
        P.py = (box.pt + L.y * box.z) / H;
        delete P.x; delete P.y;
        savePrefs();
      }
      const sx = Math.max(4, Math.min(W - w - 4, L.px * W)), sy = Math.max(4, Math.min(H - hh - 4, L.py * H));
      el.style.setProperty("--ex", `${(sx - box.pl) / box.z - box.border}px`);
      el.style.setProperty("--ey", `${(sy - box.pt) / box.z - box.border}px`);
    }
  }
  window.FG_afterLayout = () => { placeDetached(); placePop(); };
  // The guide fits the room under its header (the overlay says how much there is): when the full
  // guide is taller than that, the map gets smaller, so the header never has to move up.
  let mapFit = 0;
  const mapNat = () => prefs.mapSize || defaultMapSize();
  window.FG_fitRoom = (room) => {
    const z = els.mapzone, nat = Math.max(MAP_MIN, Math.min(mapNat(), $("#app").offsetWidth - 16)); // never wider than the guide
    const can = tab === "guide" && document.body.classList.contains("map-sized") && !z.classList.contains("detached") && !prefs.mapFold &&
      z.style.display !== "none" && getComputedStyle(z).display !== "none";
    let fit = 0;
    const cls = document.body.classList, was = cls.contains("tight");
    cls.remove("tight"); // measured at full height
    if (can) {
      document.body.style.setProperty("--msz", `${nat}px`);
      const over = $("#app").offsetHeight - room;
      if (over > 0) fit = Math.max(MAP_MIN, Math.round(nat - over));
    }
    document.body.style.setProperty("--msz", `${fit || nat}px`);
    if (fit !== mapFit) { mapFit = fit; if (mapView) setTimeout(() => mapView.resize(), 30); }
    // still too tall with the smallest map: it scrolls inside (the bottom fades), the header stays
    const tight = tab === "guide" && $("#app").offsetHeight > room + 1;
    cls.toggle("tight", tight);
    if (tight !== was && mapView) setTimeout(() => mapView.resize(), 30);
  };
  function relayout() {
    applyView();
    applyLayout();
    applyMapFrame();
    render();
    if (editing) renderEditBar();
    if (HOST && HOST.onFold) HOST.onFold(isFolded());
  }

  function startEdit() {
    if (!HOST || editing || prefs.locked) return;
    if (isFolded()) unfold(true);
    editing = true;
    document.body.classList.add("editing");
    closeStops(true);
    if (tab !== "guide") selectTab("guide");
    els.editbar.hidden = false;
    renderEditBar();
    render();
    Sound.open();
    if (HOST.onFold) HOST.onFold(false);
  }
  function endEdit() {
    if (!editing) return;
    editing = false;
    closePop();
    document.body.classList.remove("editing");
    els.editbar.hidden = true;
    savePrefs();
    render();
    Sound.close();
    if (HOST && HOST.onFold) HOST.onFold(isFolded());
  }
  els.editbtn.hidden = !HOST;
  els.editbtn.addEventListener("click", (e) => { e.stopPropagation(); editing ? endEdit() : startEdit(); });
  addEventListener("keydown", (e) => { if (editing && e.key === "Escape") { if (picked) closePop(); else endEdit(); } });

  function renderEditBar() {
    const bar = els.editbar;
    let view = bar.querySelector(".eb-view");
    if (!view) {
      view = h("div", "eb-view");
      for (const [v, label] of [["compact", "Compact"], ["full", "Full"]]) {
        const b = h("button", "", label);
        b.type = "button";
        b.dataset.v = v;
        b.title = `Edit the ${label.toLowerCase()} guide (each size has its own layout)`;
        b.addEventListener("click", () => { closePop(); setView(v, true); relayout(); });
        view.append(b);
      }
      bar.querySelector(".eb-t").after(view);
    }
    for (const b of view.children) b.setAttribute("aria-pressed", String(b.dataset.v === viewKey()));
    let pre = bar.querySelector(".eb-presets");
    if (!pre) {
      pre = h("div", "eb-presets");
      pre.append(h("span", "", "Presets:"));
      for (const [id, label, hint] of PRESETS) {
        const b = h("button", "eb-pre", label);
        b.type = "button";
        b.title = hint;
        b.dataset.id = id;
        b.addEventListener("click", () => applyPreset(id));
        pre.append(b);
      }
      bar.querySelector(".eb-hidden").before(pre);
    }
    const hid = bar.querySelector(".eb-hidden");
    hid.replaceChildren();
    const off = EDIT_PARTS.filter((b) => !(b === "loot" && isCompact()) && isOff(b));
    if (off.length) hid.append(h("span", "", "Hidden:"));
    for (const b of off) {
      const c = h("button", "eb-chip", PART_NAME[b]);
      c.type = "button";
      c.title = `Show ${PART_NAME[b].toLowerCase()} again`;
      c.addEventListener("click", () => showPart(b));
      hid.append(c);
    }
  }
  {
    els.editbar.querySelector(".eb-done").addEventListener("click", () => endEdit());
    els.editbar.querySelector(".eb-reset").addEventListener("click", () => {
      closePop();
      if (prefs.layout) delete prefs.layout[viewKey()];
      prefs.mapSize = null;
      if (isCompact()) prefs.compactMap = false; else prefs.map = true;
      prefs.loot = true;
      savePrefs();
      relayout();
      flash(`↺ ${isCompact() ? "Compact" : "Full"} guide back to how it was`);
    });
  }
  // ── presets: a whole layout in one click ──
  // Built from where the guide is now and how big your screen is (never fixed pixels), then
  // pinned to the screen like anything you move yourself, so they fit any monitor or resolution.
  const PRESETS = [
    ["standard", "Standard", "Everything in one column, as it comes"],
    ["minimal", "Minimal", "The monster and a bar per monster to kill; short directions; no loot strip"],
    ["mapside", "Map beside", "The map next to the guide, in compact too"],
    ["focus", "Big picture", "A bigger monster picture, rings for the list"],
  ];
  function applyPreset(id) {
    closePop();
    const box = HOST && HOST.appBox ? HOST.appBox() : null;
    prefs.layout = null;
    prefs.mapSize = null;
    prefs.map = true;
    prefs.loot = true;
    prefs.travelText = "full";
    prefs.qStyle = "ring";
    prefs.compactMap = false;
    if (id === "minimal") {
      prefs.qStyle = "bar";
      prefs.travelText = "short";
      prefs.layout = { compact: {}, full: { loot: { hide: true } } };
    }
    if (id === "focus") prefs.layout = { compact: { focus: { pic: 1.25 } }, full: { focus: { pic: 1.25 }, loot: { hide: true } } };
    if (id === "mapside" && box) {
      // beside the guide, on the side toward the middle of the screen, level with the header
      const W = innerWidth, H = innerHeight, msz = 220, mw = (msz + 4) * box.z, gap = 12 * box.z;
      const right = document.body.classList.contains("dock-right");
      const x = right ? box.pl - gap - mw : box.pl + box.pw + gap;
      const at = { px: Math.max(4, Math.min(W - mw - 4, x)) / W, py: Math.max(4, box.pt) / H };
      prefs.mapSize = msz;
      prefs.compactMap = true;
      prefs.layout = { compact: { map: { ...at } }, full: { map: { ...at } } };
    }
    savePrefs();
    applyQStyle();
    lootKey = "";
    relayout();
    flash(`✨ ${PRESETS.find((p) => p[0] === id)[1]} layout`);
    Sound.tick();
  }
  function hidePart(b) {
    closePop();
    if (b === "map" && isCompact()) prefs.compactMap = false;
    else lay(b).hide = true;
    savePrefs();
    relayout();
    Sound.slide(false);
  }
  function showPart(b) {
    if (b === "map") { prefs.map = true; if (isCompact()) prefs.compactMap = true; }
    if (b === "loot") prefs.loot = true;
    delete lay(b).hide;
    savePrefs();
    relayout();
    Sound.slide(true);
    const el = partEl(b);
    if (el) { el.classList.add("picked"); setTimeout(() => el.classList.remove("picked"), 900); }
  }
  function putBack(b) {
    const L = lay(b);
    delete L.x; delete L.y; delete L.px; delete L.py; delete L.w;
    savePrefs();
    relayout();
  }
  // size: the map by its own size (a crisp canvas), the rest by scale
  const sizeOf = (b) => (b === "map" ? prefs.mapSize || defaultMapSize() : peek(b).s || 1);
  function resizePart(b, dir, fine) {
    if (b === "map") {
      if (!document.body.classList.contains("map-sized")) prefs.mapSize = Math.round(els.mapwrap.offsetHeight);
      prefs.mapSize = Math.round(Math.max(MAP_MIN, Math.min(MAP_MAX, sizeOf("map") + dir * (fine ? 10 : 20))));
      applyMapFrame();
      if (mapView) setTimeout(() => mapView.resize(), 40);
    } else {
      const L = lay(b);
      L.s = Math.round(Math.max(0.5, Math.min(1.8, (L.s || 1) + dir * (fine ? 0.05 : 0.1))) * 100) / 100;
      if (L.s === 1) delete L.s;
      applyLayout();
    }
    savePrefs();
    if (picked === b) fillPop();
    if (HOST && HOST.onFold) HOST.onFold(isFolded());
  }

  // ── dragging a part ──
  let eDrag = null;
  const guides = [];
  function showGuides(xs, ys) {
    while (guides.length) guides.pop().remove();
    for (const x of xs) { const g = h("div", "eguide v"); g.style.cssText = `left:${x}px;top:0;height:100vh`; document.body.append(g); guides.push(g); }
    for (const y of ys) { const g = h("div", "eguide h"); g.style.cssText = `top:${y}px;left:0;width:100vw`; document.body.append(g); guides.push(g); }
  }
  function detach(b, el) {
    const app = $("#app"), k = kOf(app), r = el.getBoundingClientRect(), L = lay(b);
    if (b === "map" && !document.body.classList.contains("map-sized")) { prefs.mapSize = Math.round(els.mapwrap.offsetHeight); applyMapFrame(); }
    // the map and the monster list are as wide as what they show; the text parts keep their width
    if (b === "map" || b === "queue") delete L.w;
    else L.w = Math.round(r.width / k / (L.s || 1));
    L.px = r.left / innerWidth;
    L.py = r.top / innerHeight;
    applyLayout();
    // where it landed may differ by a border or padding: line it up exactly
    const n = el.getBoundingClientRect();
    L.px += (r.left - n.left) / innerWidth;
    L.py += (r.top - n.top) / innerHeight;
    applyLayout();
  }
  document.addEventListener("pointerdown", (e) => {
    if (!editing || e.button !== 0) return;
    const el = e.target.closest && e.target.closest("[data-edit]");
    if (!el) { if (picked && !e.target.closest(".editpop, .editbar")) closePop(); return; }
    e.preventDefault();
    e.stopPropagation();
    eDrag = { b: el.dataset.edit, el, x: e.clientX, y: e.clientY, id: e.pointerId, moved: false };
  }, true);
  addEventListener("pointermove", (e) => {
    const d = eDrag;
    if (!d || e.pointerId !== d.id) return;
    if (e.buttons === 0) return endPartDrag(e);
    let dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved) {
      if (Math.hypot(dx, dy) < 5) return;
      d.moved = true;
      closePop();
      if (!d.el.classList.contains("detached")) detach(d.b, d.el);
      d.el.classList.add("grabbing");
      d.r0 = d.el.getBoundingClientRect();
      // what it lines up with: the header and every other part on screen
      d.xs = []; d.ys = [];
      for (const o of [$(".top"), ...$$("[data-edit]")]) {
        if (o === d.el || !visible(o)) continue;
        const r = o.getBoundingClientRect();
        d.xs.push(r.left, r.right);
        d.ys.push(r.top, r.bottom);
      }
      if (HOST && HOST.capture) HOST.capture(true);
    }
    const { r0 } = d, snap = 7;
    let nl = r0.left + dx, nt = r0.top + dy;
    const gx = [], gy = [];
    if (!e.altKey) {
      let best = snap + 1, bx = 0, gxv = null;
      for (const x of d.xs) for (const edge of [nl, nl + r0.width]) { const dd = x - edge; if (Math.abs(dd) < Math.abs(best)) { best = dd; bx = dd; gxv = x; } }
      if (gxv !== null && Math.abs(best) <= snap) { nl += bx; gx.push(gxv); }
      best = snap + 1; let by = 0, gyv = null;
      for (const y of d.ys) for (const edge of [nt, nt + r0.height]) { const dd = y - edge; if (Math.abs(dd) < Math.abs(best)) { best = dd; by = dd; gyv = y; } }
      if (gyv !== null && Math.abs(best) <= snap) { nt += by; gy.push(gyv); }
    }
    nl = Math.max(4, Math.min(innerWidth - r0.width - 4, nl));
    nt = Math.max(4, Math.min(innerHeight - r0.height - 4, nt));
    showGuides(gx, gy);
    const L = lay(d.b);
    L.px = nl / innerWidth;
    L.py = nt / innerHeight;
    placeDetached();
  });
  function endPartDrag(e) {
    const d = eDrag;
    if (!d || (e && e.pointerId !== undefined && e.pointerId !== d.id)) return;
    eDrag = null;
    showGuides([], []);
    if (!d.moved) return openPop(d.b);
    d.el.classList.remove("grabbing");
    const L = lay(d.b);
    L.px = Math.round(L.px * 10000) / 10000; L.py = Math.round(L.py * 10000) / 10000;
    savePrefs();
    applyLayout();
    if (HOST && HOST.capture) HOST.capture(false);
    if (HOST && HOST.onFold) HOST.onFold(isFolded());
    Sound.tick();
  }
  addEventListener("pointerup", endPartDrag);
  addEventListener("pointercancel", endPartDrag);
  addEventListener("blur", () => { if (eDrag) endPartDrag(); });
  // the header in edit mode: a click (not a drag, that moves the guide) opens its options
  let hdDown = null;
  document.addEventListener("pointerdown", (e) => { hdDown = editing && e.target.closest && e.target.closest(".top") && !e.target.closest("button") ? [e.clientX, e.clientY] : null; }, true);
  document.addEventListener("click", (e) => {
    if (!editing || !hdDown || !e.target.closest || !e.target.closest(".top") || e.target.closest("button")) return;
    const moved = Math.hypot(e.clientX - hdDown[0], e.clientY - hdDown[1]) > 5;
    hdDown = null;
    e.preventDefault();
    e.stopPropagation();
    if (!moved) openPop("header");
  }, true);
  document.addEventListener("dblclick", (e) => {
    if (!editing) return;
    const el = e.target.closest && e.target.closest("[data-edit]");
    if (el && el.classList.contains("detached")) { e.preventDefault(); e.stopPropagation(); closePop(); putBack(el.dataset.edit); }
  }, true);
  // scroll over a part: bigger or smaller (Ctrl + scroll still sizes the whole overlay)
  document.addEventListener("wheel", (e) => {
    if (!editing || e.ctrlKey) return;
    const el = e.target.closest && e.target.closest("[data-edit]");
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    resizePart(el.dataset.edit, e.deltaY < 0 ? 1 : -1, true);
  }, { passive: false, capture: true });

  // ── a part's options ──
  function closePop() {
    if (picked) { const el = partEl(picked); if (el) el.classList.remove("picked"); }
    picked = null;
    els.editpop.hidden = true;
  }
  function openPop(b) {
    if (picked === b) return closePop();
    closePop();
    picked = b;
    partEl(b).classList.add("picked");
    els.editpop.hidden = false;
    fillPop();
    Sound.tick();
  }
  function fillPop() {
    const b = picked, pop = els.editpop, L = peek(b);
    if (!b) return;
    pop.replaceChildren();
    const hd = h("div", "ep-h");
    const x = h("button", "ep-x", "×");
    x.type = "button";
    x.title = "Close";
    x.addEventListener("click", closePop);
    hd.append(h("b", "", PART_NAME[b]), x);
    pop.append(hd);
    const row = (label, ctl) => { const r = h("div", "ep-r"); r.append(h("span", "", label), ctl); pop.append(r); };
    const step = (text, minus, plus) => {
      const s = h("div", "ep-step");
      const m = h("button", "", "−"), p = h("button", "", "+");
      m.type = p.type = "button";
      m.addEventListener("click", minus);
      p.addEventListener("click", plus);
      s.append(m, h("b", "", text), p);
      return s;
    };
    const seg = (opts, cur, set) => {
      const s = h("div", "ep-seg");
      for (const [v, label] of opts) {
        const btn = h("button", "", label);
        btn.type = "button";
        btn.setAttribute("aria-pressed", String(v === cur));
        btn.addEventListener("click", () => { set(v); savePrefs(); fillPop(); Sound.tick(); });
        s.append(btn);
      }
      return s;
    };
    if (b === "header") {
      // the header isn't moved (dragging it moves the guide): it has a style
      row("Style", seg([[false, "Normal"], [true, "Slim"]], !!prefs.slimHead, (v) => { prefs.slimHead = v; applyPartOpts(); if (HOST && HOST.onFold) HOST.onFold(false); }));
      pop.append(h("div", "ep-note", "Slim: one line, the stop and zone. Messages show in its place for a moment."));
      placePop();
      return;
    }
    row("Size", step(b === "map" ? `${sizeOf("map")}px` : `${Math.round(sizeOf(b) * 100)}%`, () => resizePart(b, -1), () => resizePart(b, 1)));
    // any part: always, only on the way to a stop, or only while you farm there
    row("Shows", seg([["", "Always"], ["way", "On the way"], ["farm", "Farming"]], L.when || "", (v) => { const P = lay(b); if (v) P.when = v; else delete P.when; render(); }));
    if (b === "focus") {
      row("Level bar", seg([[true, "Show"], [false, "Hide"]], prefs.showLv !== false, (v) => { prefs.showLv = v; applyPartOpts(); }));
      row("Kills line", seg([[true, "Show"], [false, "Hide"]], prefs.showKills !== false, (v) => { prefs.showKills = v; applyPartOpts(); }));
      const pic = (v) => { const P = lay("focus"); P.pic = Math.round(Math.max(0.6, Math.min(1.6, (P.pic || 1) + v)) * 100) / 100; if (P.pic === 1) delete P.pic; savePrefs(); applyLayout(); fillPop(); if (HOST && HOST.onFold) HOST.onFold(false); };
      row("Picture", step(`${Math.round((L.pic || 1) * 100)}%`, () => pic(-0.1), () => pic(0.1)));
    }
    if (b === "queue") {
      row("Style", seg([["ring", "Rings"], ["bar", "Bars"]], prefs.qStyle === "bar" ? "bar" : "ring", setQStyle));
      row("Finished ones", seg([[true, "Show"], [false, "Hide"]], prefs.qDone !== false, (v) => { prefs.qDone = v; applyQStyle(); render(); }));
      row("At most", seg([[0, "All"], [3, "3"], [5, "5"], [8, "8"]], Number(prefs.qMax) || 0, (v) => { prefs.qMax = v; render(); }));
    }
    if (b === "travel") row("Text", seg([["full", "Full route"], ["short", "Teleport only"]], prefs.travelText === "short" ? "short" : "full", (v) => { prefs.travelText = v; render(); }));
    if (b === "loot") row("Drops", seg([["all", "All"], ["rare", "Rare and up"]], prefs.lootMin === "rare" ? "rare" : "all", (v) => { prefs.lootMin = v; lootKey = ""; render(); }));
    if (b === "map") {
      row("Shape", seg([["round", "Round"], ["square", "Square"]], mapShape(), (v) => { prefs.mapShape = v; applyMapFrame(); }));
      row("Farming loop", seg([[true, "On"], [false, "Off"]], prefs.mapLoop !== false, (v) => { prefs.mapLoop = v; applyMapFrame(); model = null; render(); }));
      row("Monster icons", seg([[true, "On"], [false, "Off"]], prefs.mapIcons !== false, (v) => { prefs.mapIcons = v; applyMapFrame(); }));
      const alpha = (v) => { prefs.mapAlpha = Math.round(Math.max(0.3, Math.min(1, (Number(prefs.mapAlpha) || 1) + v)) * 10) / 10; savePrefs(); applyPartOpts(); fillPop(); };
      row("See-through", step(`${Math.round((1 - (Number(prefs.mapAlpha) || 1)) * 100)}%`, () => alpha(0.1), () => alpha(-0.1)));
    }
    const foot = h("div", "ep-foot");
    const btn = (text, cls, fn, title) => { const k = h("button", `btn ${cls}`, text); k.type = "button"; if (title) k.title = title; k.addEventListener("click", fn); foot.append(k); };
    if (isMoved(L)) btn("Put back", "", () => { const v = b; closePop(); putBack(v); }, "Back into the guide's column (or double-click it)");
    btn("Reset", "", () => {
      const P = lay(b);
      for (const k of ["x", "y", "px", "py", "w", "s", "pic", "when"]) delete P[k];
      if (b === "map") prefs.mapSize = null;
      savePrefs();
      relayout();
      fillPop();
    }, "Its place, size and options as they were");
    btn("Hide", "ep-hide", () => hidePart(b), "Hide it (bring it back from the bar at the top)");
    pop.append(foot);
    placePop();
  }
  // next to the part: on the side with room, kept on screen
  function placePop() {
    const pop = els.editpop, el = picked && partEl(picked);
    if (!el || pop.hidden) return;
    // its left/top and size are in the overlay's size (zoom); its pop-in scale doesn't count
    const kz = parseFloat(getComputedStyle(pop).zoom) || 1;
    const r = el.getBoundingClientRect(), W = innerWidth, H = innerHeight, pw = pop.offsetWidth * kz, ph = pop.offsetHeight * kz, gap = 12;
    let x = r.right + gap <= W - pw - 6 ? r.right + gap : r.left - gap - pw >= 6 ? r.left - gap - pw : Math.min(W - pw - 6, Math.max(6, r.left));
    let y = x === r.right + gap || x === r.left - gap - pw ? r.top : r.bottom + gap;
    if (y + ph > H - 6) y = Math.max(6, H - ph - 6);
    pop.style.left = `${Math.max(6, x) / kz}px`;
    pop.style.top = `${y / kz}px`;
  }

  // ── the tour: a few tips, once ──
  // New players get the whole tour the first time the guide is open. After an update, only the
  // tips for what's new show (each tip has an id; the ones you've seen are remembered). "Don't
  // show tips again" turns it off for good; Settings › Tips can show it again.
  // Adding a feature: add a tip here with a new id, and players see just that one, once.
  const TOUR = [
    { id: "route", el: ".top .title", t: "Your route", b: "The stop you're on. Click its name for every stop on the route; the arrows go to the previous or next one." },
    { id: "size", el: ".sizebtn", t: "Compact or full", b: "Compact shows just what you farm. Full adds the map and the tabs. The header stays where it is when you switch." },
    { id: "list", el: ".qstyle", t: "Every monster here", b: "Click a monster to farm it first. This button shows them as rings or as bars that fill up." },
    { id: "lock", el: ".lockbtn", t: "Lock it", b: "Locked, every click goes through to the game. Ctrl+Alt+L locks and unlocks." },
    { id: "edit", el: ".editbtn", host: true, t: "Make it yours", b: "Move, resize or hide any part: drag it, scroll over it, or click it for its options. To hide the map, click it here and pick Hide. Presets set up a whole layout in one click." },
    { id: "options", el: ".editbtn", host: true, t: "Options for every part", b: "In edit mode, click a part for its options: hide the monster's level bar, a see-through map, only the first few monsters, a slim header (click the header), or a part that shows only on the way or only while farming." },
    { id: "grip", el: ".cgrip", host: true, t: "Wider or narrower", b: "Drag this corner. Compact and full share the width." },
    { id: "fold", el: ".foldbtn", t: "Fold it away", b: "Folds the guide into a small tip; click the tip to open it again. Drag the header or the tip anywhere on screen." },
  ];
  let tourOn = null, tourTimer = 0;
  const tourEls = { card: null, ring: null };
  const tourSteps = () => {
    const seen = new Set(Array.isArray(prefs.tourSeen) ? prefs.tourSeen : []);
    return TOUR.filter((s) => !seen.has(s.id) && (!s.host || HOST));
  };
  // a moment after the guide is open and showing a stop, if there's anything new to show
  function maybeTour() {
    clearTimeout(tourTimer);
    if (tourOn || prefs.tourOff || (navigator.webdriver && !window.__forceTour)) return;
    tourTimer = setTimeout(() => {
      if (tourOn || prefs.tourOff || isFolded() || editing || tab !== "guide" || !getModel() || slOpen) return;
      const steps = tourSteps().filter((s) => { const e = $(s.el); return e && e.getBoundingClientRect().width > 0; });
      if (!steps.length) return;
      const fresh = steps.length === TOUR.filter((s) => !s.host || HOST).length || !(prefs.tourSeen || []).length;
      startTour(steps, fresh);
    }, 1800);
  }
  function startTour(steps, fresh) {
    tourOn = { steps, i: 0, fresh };
    if (!tourEls.card) {
      tourEls.ring = h("div", "tourring");
      tourEls.card = h("div", "tourcard");
      tourEls.card.setAttribute("role", "dialog");
      document.body.append(tourEls.ring, tourEls.card);
    }
    showTourStep();
    if (HOST && HOST.onFold) HOST.onFold(false); // the card takes the mouse
  }
  function markSeen(ids) {
    const seen = new Set(Array.isArray(prefs.tourSeen) ? prefs.tourSeen : []);
    for (const id of ids) seen.add(id);
    prefs.tourSeen = [...seen];
    savePrefs();
  }
  function endTour(all) {
    if (!tourOn) return;
    markSeen(all ? tourOn.steps.map((s) => s.id) : tourOn.steps.slice(0, tourOn.i + 1).map((s) => s.id));
    tourOn = null;
    tourEls.card.classList.remove("in");
    tourEls.ring.classList.remove("in");
    setTimeout(() => { if (!tourOn) { tourEls.card.hidden = true; tourEls.ring.hidden = true; if (HOST && HOST.onFold) HOST.onFold(isFolded()); } }, 260);
  }
  function showTourStep() {
    const T = tourOn, step = T.steps[T.i], target = $(step.el);
    if (!target || !target.getBoundingClientRect().width) { if (T.i < T.steps.length - 1) { T.i++; return showTourStep(); } return endTour(true); }
    const card = tourEls.card, ring = tourEls.ring;
    card.replaceChildren();
    const last = T.i === T.steps.length - 1;
    card.append(h("div", "tc-k", `${T.fresh ? "Quick tour" : "New in this version"} · ${T.i + 1}/${T.steps.length}`), h("div", "tc-t", step.t), h("div", "tc-b", step.b));
    const foot = h("div", "tc-f");
    const never = h("label", "tc-never");
    const cb = h("input");
    cb.type = "checkbox";
    never.append(cb, " Don't show tips again");
    const skip = h("button", "btn", "Skip");
    const next = h("button", "btn gold", last ? "Done" : "Next");
    skip.type = next.type = "button";
    const close = (all) => { if (cb.checked) { prefs.tourOff = true; savePrefs(); } endTour(all); };
    skip.addEventListener("click", () => close(true));
    next.addEventListener("click", () => { if (last || cb.checked) return close(true); markSeen([step.id]); T.i++; showTourStep(); Sound.tick(); });
    foot.append(never, h("span", "sp"), skip, next);
    card.append(foot);
    card.hidden = ring.hidden = false;
    placeTour(target);
    requestAnimationFrame(() => { card.classList.add("in"); ring.classList.add("in"); });
  }
  // the ring around the part, the card beside it (below, or above when there's no room)
  function placeTour(target) {
    const card = tourEls.card, ring = tourEls.ring;
    const r = target.getBoundingClientRect(), W = innerWidth, H = innerHeight, pad = 5;
    const kz = parseFloat(getComputedStyle(card).zoom) || 1;
    ring.style.cssText = `left:${r.left - pad}px;top:${r.top - pad}px;width:${r.width + pad * 2}px;height:${r.height + pad * 2}px`;
    const cw = card.offsetWidth * kz, ch = card.offsetHeight * kz;
    let x = Math.max(8, Math.min(W - cw - 8, r.left + r.width / 2 - cw / 2));
    let y = r.bottom + 12 + ch <= H - 8 ? r.bottom + 12 : Math.max(8, r.top - 12 - ch);
    card.style.left = `${x / kz}px`;
    card.style.top = `${y / kz}px`;
  }
  addEventListener("resize", () => { if (tourOn) showTourStep(); });
  window.FG_tourOpen = () => !!tourOn;

  function applyPrefs() {
    // the map's own fold button is gone (edit mode hides the map): a folded map is a hidden one
    if (prefs.mapFold) { prefs.mapFold = false; prefs.map = false; }
    applyLock();
    applyTip();
    applyView();
    if (prefs.theme === "glass") prefs.theme = "ingame";
    if (!HOST && (prefs.theme === "apple" || prefs.theme === "hud")) prefs.theme = "ingame";
    document.body.classList.toggle("ingame", prefs.theme === "ingame");
    document.body.classList.toggle("apple", prefs.theme === "apple" || prefs.theme === "hud");
    document.body.classList.toggle("hud", prefs.theme === "hud");
    if (mapView && mapView.theme !== prefs.theme) mapView.setTheme(prefs.theme);
    applyMapFrame();
    applyQStyle();
    applyLayout();
    FX.enabled = !!prefs.effects;
    Sound.enabled = !!prefs.sounds;
    Sound.volume = prefs.volume;
    document.body.classList.toggle("nofx", !prefs.effects);
  }

  // ── sizes: the tip, compact, full ──
  // Compact is the farming view; full has the tabs and the map. The size button switches between
  // them (and that becomes the size you farm in). On a new stop the guide shows the full guide with
  // the way there, and goes back to your farming size 3 s after your first soul there.
  const isCompact = () => prefs.view === "compact";
  function applyView() {
    document.body.classList.toggle("vcompact", isCompact());
    document.body.classList.toggle("vcmap", isCompact() && !!prefs.compactMap);
    els.sizebtn.title = isCompact() ? "Full guide: the map, the tabs and everything" : "Compact: just what you're farming";
    els.sizebtn.setAttribute("aria-label", isCompact() ? "Full guide" : "Compact guide");
    // one width for compact and full (the overlay): from the old compact width the first time
    if (!prefs.gw && prefs.cw) { prefs.gw = Math.max(GW_MIN, Math.min(GW_MAX, prefs.cw)); prefs.cw = 0; }
    document.documentElement.style.setProperty("--gw", prefs.gw ? `${prefs.gw}px` : "");
    if (isCompact() && tab !== "guide") selectTab("guide");
    if (mapView) setTimeout(() => mapView.resize(), 60);
    applyLayout(); // each size has its own layout
    if (editing) renderEditBar();
    if (HOST && HOST.onFold) HOST.onFold(isFolded());
  }
  // manual: you picked it, so it's also the size you farm in from now on
  function setView(v, manual) {
    if (editing && !manual) return; // nothing switches by itself while you edit the layout
    if (manual && v !== "tip") prefs.farmSize = v;
    if (v === "tip") { savePrefs(); return fold(); }
    const was = prefs.view;
    prefs.view = v;
    savePrefs();
    if (isFolded()) return unfold(true);
    if (was === v) return;
    morphView(() => { applyView(); render(); });
  }
  els.sizebtn.addEventListener("click", () => { autoFull = null; setView(isCompact() ? "full" : "compact", true); });
  let autoFull = null; // the stop key the guide went full for by itself (it goes back to your farming size there)
  // back to the size you farm in (a few seconds after your first soul at a stop it opened itself for)
  function backToFarmSize(key) {
    setTimeout(() => {
      if (editing || currentStop()?.key !== key || Date.now() - lastUse < 2500) return; // you moved on, or you're using it
      if (prefs.farmSize === "tip") { if (prefs.tip) fold(); }
      else if (!isFolded() && prefs.view !== prefs.farmSize) setView(prefs.farmSize);
    }, 3000);
  }

  // ── tip mode: the guide folds into a small tip; a click opens it ──
  const ORIGIN = { top: "50% 0%", bottom: "50% 100%", left: "0% 50%", right: "100% 50%", center: "50% 50%" };
  const isFolded = () => !!(prefs.tip && prefs.folded);
  let tipFlashUntil = 0, tipFlashTimer = 0, foldTimer = 0;
  function applyTip() {
    const folded = isFolded();
    document.body.classList.toggle("tipmode", !!prefs.tip);
    document.body.classList.toggle("folded", folded);
    els.tip.dataset.pos = prefs.tipPos;
    els.tip.hidden = !folded;
    els.foldbtn.hidden = !prefs.tip;
    const [ox, oy] = (ORIGIN[prefs.tipPos] || ORIGIN.bottom).split(" ");
    const app = $("#app");
    app.style.setProperty("--tip-x", ox);
    app.style.setProperty("--tip-y", oy);
    if (HOST && HOST.onFold) HOST.onFold(folded);
    armAutoFold();
    armIdleFold();
  }
  function fold() {
    if (!prefs.tip || prefs.folded || editing) return;
    closeStops(true);
    idleFolded = false;
    smartOpened = null;
    prefs.folded = true;
    savePrefs();
    applyTip();
    renderTip();
    els.tip.classList.remove("peek"); void els.tip.offsetWidth; els.tip.classList.add("peek");
    Sound.close();
  }
  // opens to the size for now: the full guide on the way to a stop, else the size you farm in
  function unfold(keepView) {
    if (!prefs.folded) return;
    if (!keepView) {
      const m = getModel();
      prefs.view = (prefs.smartOpen && travelling(m)) || prefs.farmSize === "full" ? "full" : "compact";
      if (prefs.view === "full" && travelling(m)) autoFull = m.stop.key;
    }
    idleFolded = false;
    dungeonFolded = false; // opened (by you, or on the way out): leaving doesn't open it again
    prefs.folded = false;
    savePrefs();
    applyTip();
    applyView();
    if (tab !== "guide") selectTab("guide");
    else render();
    if (mapView) setTimeout(() => mapView.resize(), 50);
    Sound.open();
  }
  // fold by itself after a while with no mouse or keys in the window
  function armAutoFold() {
    clearTimeout(foldTimer);
    if (prefs.tip && !prefs.folded && prefs.tipAuto > 0) foldTimer = setTimeout(fold, prefs.tipAuto * 1000);
  }
  let lastUse = 0; // the last time you used the guide (mouse or keys on it)
  for (const ev of ["pointermove", "pointerdown", "wheel", "keydown"]) window.addEventListener(ev, () => { lastUse = Date.now(); if (prefs.tip && !prefs.folded) armAutoFold(); }, { passive: true });
  els.tip.addEventListener("click", (e) => {
    if (prefs.locked && !e.altKey) { els.tip.classList.remove("hit"); void els.tip.offsetWidth; els.tip.classList.add("hit"); return tipFlash("🔒 Locked · Alt+click to open · Ctrl+Alt+L unlocks", 2600); }
    unfold();
  });
  // fold when the hunting stops: no souls for a few minutes
  let idleTimer = 0;
  // folded because hunting stopped (not by you): the next soul can open it again
  let idleFolded = false;
  function armIdleFold() {
    clearTimeout(idleTimer);
    if (prefs.tip && !prefs.folded && prefs.tipIdle > 0) idleTimer = setTimeout(idleCheck, prefs.tipIdle * 60000);
  }
  // no souls for a while: fold, but never while you're using the guide (Settings, Pets, Stats, or
  // the mouse on it in the last minute); look again a bit later
  function idleCheck() {
    if (!prefs.tip || prefs.folded || !(prefs.tipIdle > 0)) return;
    const using = tab !== "guide" || Date.now() - lastUse < 60000 || busy;
    if (using) { clearTimeout(idleTimer); idleTimer = setTimeout(idleCheck, 30000); return; }
    fold();
    idleFolded = true;
  }
  els.foldbtn.addEventListener("click", fold);
  function tipFlash(text, ms = 2600) {
    tipFlashUntil = Date.now() + ms;
    els.tipsub.textContent = text;
    clearTimeout(tipFlashTimer);
    tipFlashTimer = setTimeout(renderTip, ms + 30);
  }
  function renderTip() {
    if (!prefs.tip) return;
    els.tip.classList.toggle("dungeon", place.dungeon);
    if (place.dungeon) {
      // inside a dungeon: no stop to farm. Name the dungeon (once a boss soul told us) and its pets
      const need = dungeonNeeds(), here = dungeonName(), mine = need.find((d) => d.name === here);
      els.tip.classList.remove("travel");
      els.tipmob.textContent = here || "In a dungeon";
      if (Date.now() > tipFlashUntil) els.tipsub.textContent = mine ? `Boss souls: ${mine.pids.map(petName).join(", ")}` : "The guide waits outside";
      els.tipring.style.strokeDashoffset = "122.5";
      els.tippet.hidden = true;
      els.tipmobimg.removeAttribute("src");
      els.tipmobimg.style.visibility = "hidden";
      els.tipstreak.hidden = true;
      els.tip.title = "In a dungeon: field souls don't drop here, so the guide folds away until you leave. Souls from bosses still count. Click to open it anyway";
      return;
    }
    const m = getModel();
    const f = m && m.focus;
    if (!m) {
      els.tipmob.textContent = "Farm Guide";
      if (Date.now() > tipFlashUntil) els.tipsub.textContent = pets.syncedAt ? "Every pet is done" : "Relog to read your pets";
      els.tipring.style.strokeDashoffset = "122.5";
      els.tippet.hidden = true;
      return;
    }
    const frac = stopProgress(m);
    els.tip.style.setProperty("--genus", f ? colorOf(f.pid) : "var(--done)");
    els.tipring.style.strokeDashoffset = String(122.5 * (1 - frac));
    // two faces: on the way (where to teleport, which way), and farming (what to kill, how long)
    const going = travelling(m) && m.tr;
    els.tip.classList.toggle("travel", !!going);
    if (going) {
      els.tipnav.style.transform = `rotate(${m.tr.deg}deg)`;
      const t0 = trFrom(m.tr);
      els.tipmob.textContent = m.tr.rift ? `Rift · ${t0[0].toUpperCase()}${t0.slice(1)}` : t0;
      if (Date.now() > tipFlashUntil) els.tipsub.textContent = firstVisit(m.tr) ? `First visit: by Windstream · ${m.zone}` : `${trWalk(m.tr, true)} · ${m.zone}`;
    } else {
      els.tipmob.textContent = f ? D.mobs[f.top].n : "Stop complete";
      const eta = etaOf(m);
      if (Date.now() > tipFlashUntil) els.tipsub.textContent = f ? `${f.left} left${eta.pet ? ` · ${fmtEta(eta.pet)}` : ""} · ${petName(f.pid)}` : `${m.zone} · ${mapLabel(m.stop.map)}`;
    }
    els.tippet.hidden = !f;
    const art = f ? mobArt(f.top) : "";
    if (els.tipmobimg.getAttribute("src") !== art) { if (art) els.tipmobimg.src = art; else els.tipmobimg.removeAttribute("src"); }
    els.tipmobimg.style.visibility = art ? "" : "hidden";
    if (f && els.tippet.getAttribute("src") !== portrait(f.pid)) els.tippet.src = portrait(f.pid);
    const n = streakNow();
    els.tipstreak.hidden = n < 5;
    els.tipstreak.textContent = `🔥${n}`;
    els.tip.dataset.fire = String(prefs.effects && n >= 5 ? Sound.tierOf(n) : 0);
    els.tip.title = going ? `On the way to ${m.zone}: ${m.tr.rift ? "from your Rift landing" : "teleport"}, then follow the arrow${m.tr.wind ? " to the Windstream" : ""}. Click to open the guide with the map` : f ? `${D.mobs[f.top].n}: ${f.left} souls left for ${petName(f.pid)}. Click to open the guide` : "Click to open the guide";
  }
  // a soul while folded: the tip takes the hit
  function tipSoul(pid, amount, before, after) {
    const icon = els.tip.querySelector(".tipicon");
    const at = center(icon);
    Sound.soul(genusOf(pid), streakNow());
    FX.burst(at.x, at.y, colorOf(pid), { count: 14, speed: 100, spread: 34, glints: 2 });
    FX.plus(at.x, at.y - 24, `+${amount}`, colorOf(pid));
    els.tip.classList.remove("hit"); void els.tip.offsetWidth; els.tip.classList.add("hit");
    if (after.level > before.level) {
      setTimeout(() => {
        FX.shockwave(at.x, at.y, "#ffe7a6", { rings: 3, radius: 46 });
        Sound.level();
        const gain = E.effectGain(genusOf(pid), after.level).map(([k, v]) => `+${v}${k.endsWith("%") ? "%" : ""} ${k.replace(/ %$/, "")}`).join(" · ");
        tipFlash(`✨ ${petName(pid)} Lv ${after.level}${gain ? ` · ${gain}` : ""}`, 3600);
      }, 150);
    } else if (after.left === 0) {
      Sound.done();
      tipFlash(`✓ ${petName(pid)} done`);
    }
  }

  // ── tabs and buttons ─────────────────────────────────────────
  function selectTab(t) {
    if (t !== "guide" && editing) endEdit();
    // the other tabs live in the full guide
    if (t !== "guide" && isCompact()) { prefs.view = "full"; savePrefs(); document.body.classList.remove("vcompact", "vcmap"); if (mapView) setTimeout(() => mapView.resize(), 60); }
    if (t !== tab) closeStops(true);
    tab = t;
    document.body.dataset.tab = t;
    for (const b of $$(".tabs button")) b.setAttribute("aria-selected", String(b.dataset.tab === t));
    els.tabs.style.setProperty("--i", String(["guide", "pets", "stats", "settings"].indexOf(t)));
    const changed = document.body.dataset.tabWas !== t;
    document.body.dataset.tabWas = t;
    for (const p of $$(".pane")) {
      p.hidden = p.dataset.pane !== t;
      // the tab coming in slides in (the themes that animate it say how)
      if (!p.hidden && changed) { p.classList.remove("tabin"); void p.offsetWidth; p.classList.add("tabin"); clearTimeout(p._tabin); p._tabin = setTimeout(() => p.classList.remove("tabin"), 900); }
    }
    render();
    if (t === "guide" && mapView) mapView.resize();
    if (t === "guide" && pendingComplete && currentStop()?.key === pendingComplete) setTimeout(stopComplete, 300);
  }
  els.tabs.addEventListener("click", (e) => { const b = e.target.closest("button[data-tab]"); if (b) selectTab(b.dataset.tab); });
  els.prev.addEventListener("click", () => {
    if (guide && guide.auto) return leaveFree();
    if (guide) { if (guide.i === 0) return stopGuide(); guide.i--; model = null; return render(); }
    setStop((idx - 1 + route.length) % route.length);
    render();
  });
  els.next.addEventListener("click", () => {
    if (guide && guide.auto) return;
    if (guide) { guide.i = (guide.i + 1) % guide.spots.length; model = null; return render(); }
    setStop((idx + 1) % route.length);
    render();
  });
  // ── the stop list: click the title, pick any stop (no clicking through them one by one) ──
  // Each stop shows how far its pets are toward your goal level (souls collected out of all the souls
  // those pets need from scratch), what's left, and who's there. Done stops hide behind a chip.
  let slOpen = false, slCloseTimer = 0, slDown = null, slView = "main"; // which route the list shows
  const SL_RC = 2 * Math.PI * 13;
  function stopRows(list) {
    const tot = E.soulsTotal(prefs.goal);
    return list.map((s, i) => {
      let left = 0;
      const live = [];
      for (const p of s.pets) { const l = leftOf(p); left += l; if (l > 0) live.push(p); }
      const need = s.pets.length * tot;
      const pct = left <= 0 ? 100 : Math.min(99, Math.floor(100 * (1 - left / Math.max(need, left))));
      const zone = E.zoneAt(D, s.map, s.x, s.y);
      const mobs = s.pets.flatMap((p) => (D.pets[p]?.d || []).map((n) => D.mobs[n]?.n || ""));
      const find = [zone, mapLabel(s.map), ...s.pets.map(petName), ...mobs].join("|").toLowerCase();
      return { i, s, zone, left, pct, live, done: left <= 0, find };
    });
  }
  // Main | Abyss | Rift: the routes, with how many stops each still has
  function renderSlSeg() {
    const seg = els.slSeg;
    const tabs = [["main", "Main"], ["abyss", "⚔️ Abyss"], ["rift", "🌀 Rift"]].filter(([m]) => m === "main" || routes[m].length);
    seg.hidden = tabs.length < 2;
    if (seg.hidden) return;
    const n = (m) => routes[m].filter(hasWork).length;
    seg.style.setProperty("--n", String(tabs.length));
    seg.replaceChildren(...tabs.map(([m, label]) => {
      const b = h("button", "sl-tab " + m);
      b.type = "button";
      b.dataset.m = m;
      b.setAttribute("aria-pressed", String(slView === m));
      b.append(label, h("span", "c", String(n(m))));
      if (m === mode && !guide) b.append(h("i", "here"));
      return b;
    }));
    seg.style.setProperty("--x", `${Math.max(0, tabs.findIndex(([m]) => m === slView)) * 100}%`);
  }
  function slGroup(s) { return s.map === "A" ? (slView === "abyss" ? (s.bucket ? "Also outside the Abyss" : "Only in the Abyss") : "Abyss") : `${s.rift ? "Rift · " : ""}${mapLabel(s.map)}`; }
  function renderStops() {
    if (!routes[slView].length) slView = mode;
    const viewing = slView === mode && !guide; // the list of the route you're on: it has a "you are here"
    const rows = stopRows(routes[slView]);
    renderSlSeg();
    const q = els.slFind.value.trim().toLowerCase();
    const doneN = rows.filter((r) => r.done).length;
    const shown = rows.filter((r) => (prefs.slShowDone || !r.done || (viewing && r.i === idx)) && (!q || r.find.includes(q)));
    // the whole route at a glance
    const left = rows.reduce((a, r) => a + r.left, 0), all = rows.length;
    els.slSum.replaceChildren(`${all - doneN}/${all} stops to go · ${left.toLocaleString()} souls left${q ? ` · ${shown.length} match${shown.length === 1 ? "" : "es"}` : ""}`);
    if (slView === "abyss") {
      // how to get in, and from what level
      const ab = D.community && D.community.abyss, st = settings();
      if (ab) els.slSum.append(h("div", "sl-abyss", `⚔️ Lower Reshanta · Lv ${ab.minLevel}+ · start at your base, ${ab.base[E.sideOf(st)]}${abyssOpen() ? "" : ` · you're Lv ${st.myLevel}`}`));
    }
    if (slView === "rift") {
      // when you can go: the next Rift, in your clock
      const c = riftClock();
      if (c) els.slSum.append(h("div", "sl-rift" + (c.open ? " open" : ""), c.open ? `🌀 A Rift is open · closes in ${fmtIn(c.until - Date.now())}` : `🌀 Next Rift ${fmtClock(c.at)} · in ${fmtIn(c.at - Date.now())}${c.tz ? "" : " (log in for your server's time)"}`));
    }
    els.slDone.textContent = prefs.slShowDone ? `Hide done` : `${doneN} done`;
    els.slDone.setAttribute("aria-pressed", String(!!prefs.slShowDone));
    els.slDone.hidden = !doneN;
    els.slDone.title = prefs.slShowDone ? "Hide the stops you've finished" : "Show the stops you've finished";
    const out = [];
    let group = null, k = 0;
    for (const r of shown) {
      const g = slGroup(r.s);
      if (g !== group) {
        group = g;
        let n = 0; // this run of stops on one map (the route can come back to a map later)
        for (let j = shown.indexOf(r); j < shown.length && slGroup(shown[j].s) === g; j++) n++;
        out.push(h("div", "sl-group" + (r.s.map === "A" ? " abyss" : r.s.rift ? " rift" : ""), `${g} · ${n}`));
      }
      const here = viewing && r.i === idx;
      const row = h("button", "sl-row" + (here ? " cur" : "") + (r.done ? " done" : ""));
      row.type = "button";
      row.dataset.i = r.i;
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", String(here));
      row.style.setProperty("--i", Math.min(k++, 16));
      const num = h("span", "sl-num", String(r.i + 1));
      const mid = h("span", "sl-mid");
      mid.append(h("span", "sl-zone", r.zone));
      const pets = h("span", "sl-pets");
      const st0 = settings();
      for (const p of r.live.slice(0, 5)) {
        const im = h("img", "sl-pet" + ((slView === "rift" && E.riftOnlyPet(D, p, st0)) || (slView === "abyss" && E.abyssOnlyPet(D, p, st0)) ? " only" : ""));
        im.src = portrait(p);
        im.alt = "";
        im.style.setProperty("--c", colorOf(p));
        pets.append(im);
      }
      if (r.live.length > 5) pets.append(h("span", "sl-more", `+${r.live.length - 5}`));
      pets.append(h("span", "sl-left", r.done ? "done" : `${r.live.length} pet${r.live.length === 1 ? "" : "s"} · ${r.left.toLocaleString()} left`));
      mid.append(pets);
      const ring = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      ring.setAttribute("viewBox", "0 0 32 32");
      ring.setAttribute("class", "sl-ring");
      ring.innerHTML = `<circle class="t" cx="16" cy="16" r="13"/><circle class="f" cx="16" cy="16" r="13" style="stroke-dasharray:${SL_RC};stroke-dashoffset:${SL_RC}" data-off="${SL_RC * (1 - r.pct / 100)}"/>`;
      const pc = h("span", "sl-pct");
      pc.append(ring, h("b", "", r.done ? "✓" : `${r.pct}%`));
      row.title = `Stop ${r.i + 1}: ${r.zone} (${slGroup(r.s)})\n${r.done ? "Done" : `${r.pct}% of the way to Lv ${prefs.goal} for its pets · ${r.left.toLocaleString()} souls left`}\n${r.s.pets.map((p) => `${petName(p)} · ${leftOf(p)} left`).join("\n")}`;
      row.append(num, mid, pc);
      out.push(row);
    }
    if (!shown.length) out.push(h("div", "sl-empty", q ? "Nothing on the route matches" : "Every stop is done"));
    els.slBody.replaceChildren(...out);
  }
  // the rings fill once the rows are in
  function slFill() {
    for (const c of els.slBody.querySelectorAll(".sl-ring .f")) c.style.strokeDashoffset = c.dataset.off;
  }
  function placeStops() {
    const top = els.top, app = $("#app");
    els.sl.style.left = `${top.offsetLeft}px`;
    els.sl.style.top = `${top.offsetTop + top.offsetHeight + 4}px`;
    els.sl.style.width = `${Math.max(top.offsetWidth, 300)}px`;
    // in a card, stay inside it; floating (HUD), stay on screen
    const room = app.clientHeight > 200 && getComputedStyle(app).overflow !== "visible"
      ? app.clientHeight - (top.offsetTop + top.offsetHeight + 12)
      : innerHeight / (parseFloat(getComputedStyle(app).zoom) || 1) - els.top.getBoundingClientRect().bottom / (parseFloat(getComputedStyle(app).zoom) || 1) - 16;
    els.sl.style.setProperty("--sl-max", `${Math.max(180, Math.min(460, room))}px`);
  }
  function openStops() {
    if (slOpen || !(routes.main.length || routes.rift.length) || prefs.locked || isFolded()) return;
    slOpen = true;
    slView = mode;
    clearTimeout(slCloseTimer);
    renderStops();
    placeStops();
    els.sl.hidden = false;
    // the current stop in the middle of the list
    const cur = els.slBody.querySelector(".sl-row.cur");
    els.slBody.scrollTop = cur ? cur.offsetTop - els.slBody.clientHeight / 2 + cur.offsetHeight / 2 : 0;
    void els.sl.offsetWidth;
    els.sl.classList.add("open");
    els.title.classList.add("open");
    els.title.setAttribute("aria-expanded", "true");
    setTimeout(slFill, 140);
    Sound.list(true);
  }
  function closeStops(quiet) {
    if (!slOpen) return;
    slOpen = false;
    els.sl.classList.remove("open");
    els.title.classList.remove("open");
    els.title.setAttribute("aria-expanded", "false");
    if (!quiet) Sound.list(false);
    slCloseTimer = setTimeout(() => { if (!slOpen) { els.sl.hidden = true; els.slFind.value = ""; } }, 300);
  }
  function pickStop(i) {
    closeStops(true);
    Sound.pick();
    if (slView !== mode) { setMode(slView, `${MODE_ICON[slView]}${MODE_NAME[slView]}`); riftAuto = false; }
    if (guide) { guide = null; model = null; }
    if (i === idx) return render();
    if (!isFolded()) els.card.classList.add("out");
    setTimeout(() => {
      els.card.classList.remove("out");
      setStop(i);
      render({ swap: false });
      els.card.classList.add("in");
      setTimeout(() => els.card.classList.remove("in"), 600);
    }, prefs.effects ? 260 : 0);
  }
  window.FG_stopsOpen = () => slOpen;
  els.title.addEventListener("pointerdown", (e) => { slDown = [e.clientX, e.clientY]; });
  els.title.addEventListener("click", (e) => {
    // the overlay drags the guide by its header: a drag that ends here is not a click
    if (slDown && Math.hypot(e.clientX - slDown[0], e.clientY - slDown[1]) > 5) return;
    slOpen ? closeStops() : openStops();
  });
  els.title.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); slOpen ? closeStops() : openStops(); } });
  els.slBody.addEventListener("click", (e) => { const b = e.target.closest(".sl-row"); if (b) pickStop(Number(b.dataset.i)); });
  els.slFind.addEventListener("input", () => { renderStops(); els.slBody.scrollTop = 0; slFill(); });
  els.slSeg.addEventListener("click", (e) => {
    const b = e.target.closest(".sl-tab");
    if (!b || b.dataset.m === slView) return;
    slView = b.dataset.m;
    Sound.tick();
    els.slBody.classList.remove("swap"); void els.slBody.offsetWidth; els.slBody.classList.add("swap");
    renderStops();
    const cur = els.slBody.querySelector(".sl-row.cur");
    els.slBody.scrollTop = cur ? cur.offsetTop - els.slBody.clientHeight / 2 : 0;
    setTimeout(slFill, 60);
  });
  els.slDone.addEventListener("click", () => { prefs.slShowDone = !prefs.slShowDone; savePrefs(); renderStops(); slFill(); });
  document.addEventListener("pointerdown", (e) => { if (slOpen && !e.target.closest(".stoplist, .top .title")) closeStops(); }, true);
  document.addEventListener("keydown", (e) => {
    if (!slOpen) return;
    if (e.key === "Escape") return closeStops();
    if (e.key === "Enter" && e.target === els.slFind) { const b = els.slBody.querySelector(".sl-row"); if (b) pickStop(Number(b.dataset.i)); }
  });

  els.queue.addEventListener("click", (e) => {
    const b = e.target.closest(".qcell");
    if (!b || b.classList.contains("leave")) return;
    focusPick = b.dataset.pid;
    model = null;
    render();
  });
  els.search.addEventListener("input", renderPets);
  els.filter.addEventListener("click", (e) => { const b = e.target.closest("button[data-f]"); if (!b) return; prefs.filter = b.dataset.f; savePrefs(); renderPets(); });
  els.petlist.addEventListener("click", (e) => {
    const li = e.target.closest("li[data-pid]");
    if (!li) return;
    if (E.isFarmable(D, li.dataset.pid)) startGuide(li.dataset.pid);
    else toast(li.title || "No farm spot known for this pet");
  });
  // ── lock: the padlock locks and unlocks with a click (or Ctrl+Alt+L); while locked, nothing else
  // in the guide takes a click, so a stray click mid-fight does nothing ──
  const lockBtn = $(".lockbtn");
  let hintAt = 0;
  function applyLock() {
    document.body.classList.toggle("locked", !!prefs.locked);
    lockBtn.setAttribute("aria-pressed", String(!!prefs.locked));
    lockBtn.title = prefs.locked ? "Locked · click to unlock (or Ctrl+Alt+L)" : "Lock Farm Guide against accidental clicks (Ctrl+Alt+L)";
    lockBtn.setAttribute("aria-label", prefs.locked ? "Unlock Farm Guide" : "Lock Farm Guide");
    if (prefs.locked && editing) endEdit(); // locked, it takes no clicks: nothing to edit with
  }
  function lockedHint() {
    if (Date.now() - hintAt < 2500) return;
    hintAt = Date.now();
    flash("🔒 Locked · click the padlock to unlock");
  }
  lockBtn.addEventListener("click", (e) => {
    if (!prefs.locked) {
      prefs.locked = true;
      Sound.tick();
      flash("🔒 Locked · click the padlock (or Ctrl+Alt+L) to unlock");
    } else {
      prefs.locked = false;
      Sound.tick();
      flash("🔓 Unlocked");
    }
    applyLock();
    savePrefs();
  });
  // locked: clicks land on the page itself; say how to unlock, now and then
  document.addEventListener("pointerdown", (e) => { if (prefs.locked && !e.target.closest(".lockbtn")) lockedHint(); });
  document.addEventListener("keydown", (e) => {
    if (prefs.locked || HOST) return; // over the game, keys belong to the game
    if (e.target.closest("input")) return;
    if (e.key === "ArrowLeft") els.prev.click();
    if (e.key === "ArrowRight") els.next.click();
  });

  // ── the game's records ───────────────────────────────────────
  let chain = Promise.resolve();
  const queued = (fn) => { chain = chain.then(fn).catch((e) => console.error(e)); };
  const isLive = (meta) => Date.now() - readyAt > 1500 && (!meta?.at || Date.now() - meta.at < 15000);
  async function keyForEvent(meta, isList) {
    const k = keyFor(meta?.character) || (isList ? "server-unknown" : key || (await a2.storage.get("last").catch(() => null)) || "server-unknown");
    await useKey(k);
  }
  // A pet list that came before the meter knew the server was filed under "server-unknown":
  // hand it to the server once it's known, if that server has nothing newer.
  async function adoptUnknown(k) {
    const u = key === "server-unknown" ? pets : await a2.storage.get("pets-server-unknown").catch(() => null);
    if (!u || !u.syncedAt || Date.now() - u.syncedAt > 30 * 60000) return;
    const t = await a2.storage.get(`pets-${k}`).catch(() => null);
    if (t && t.syncedAt >= u.syncedAt) return;
    await a2.storage.set(`pets-${k}`, u).catch(() => {});
    // empty the unknown slot, in memory too, or the key switch's flush would write the list back
    if (key === "server-unknown") pets = { levels: {}, points: {}, syncedAt: 0 };
    await a2.storage.set("pets-server-unknown", { levels: {}, points: {}, syncedAt: 0 }).catch(() => {});
  }
  a2.on("character", (c) => queued(async () => {
    const k0 = key, lv0 = settings().myLevel;
    character = c || null;
    const k = keyFor(c);
    if (k) { await adoptUnknown(k); await useKey(k); }
    // same character, new level (or the overlay learning it mid-session): the Abyss and the penalty follow it
    if (key === k0 && settings().myLevel !== lv0) rebuild();
    render();
  }));
  a2.on("decoded:pet-list", (data, meta) => queued(async () => {
    await keyForEvent(meta, true);
    // stamped with when the meter read it, so the plugin and the overlay agree on which list is newer
    pets = { levels: {}, points: {}, syncedAt: Number(meta?.at) || Date.now() };
    for (const { pet, level: lv } of data.levels || []) pets.levels[pet] = lv;
    for (const { pet, points } of data.points || []) pets.points[pet] = points;
    touched();
    rebuild();
    save();
    if (isLive(meta)) flash(`Synced ${Object.keys(pets.levels).length} pets · ${route.length} stops`);
    render();
  }));
  a2.on("decoded:soul-gained", (data, meta) => queued(async () => {
    await keyForEvent(meta, false);
    soulsIn(data).forEach((soul, i) => onSoul(soul, isLive(meta), meta?.at, i === 0));
  }));
  a2.on("decoded:level-up", (data, meta) => queued(async () => {
    await keyForEvent(meta, false);
    const pid = String(data.pet);
    if ((pets.levels[pid] || 0) >= data.level) return; // already levelled from its souls
    const m0 = getModel();
    pets.levels[pid] = data.level;
    pets.points[pid] = 0;
    levelLog.push([Number(meta?.at) || Date.now(), Number(pid), data.level]);
    touched();
    save();
    const live = isLive(meta);
    if (live && isFolded()) tipFlash(`✨ ${petName(pid)} Lv ${data.level}`, 3600);
    else if (live && tab === "guide" && visible(els.dial)) celebrateLevel(pid, data.level, els.dial);
    else if (live) levelToast(pid, data.level);
    render();
    afterChange(m0, live);
  }));
  // where you are, on every zone load (the meter reads the game's map load; numbers only)
  a2.on("decoded:map-load", (data, meta) => queued(async () => onMapLoad(data, isLive(meta))));
  a2.on("language", (code) => { lang = typeof code === "string" ? code : "en"; render(); });
  a2.on("compact", (on) => {
    document.body.classList.toggle("compact", !!on);
    if (on && tab !== "guide") selectTab("guide"); // the tabs are hidden while folded
    if (mapView) mapView.resize();
  });

  // ── start ────────────────────────────────────────────────────
  let mapView = null;
  try { mapView = new MapView(els.mapwrap, D); } catch (e) { console.error(e); }
  if (mapView) mapView.onToggle = (mode) => { const s = currentStop(); if (s) { rstate.seen[s.key] = mode === "farm"; save(); } };
  (async () => {
    prefs = { ...DEFAULTS, ...(HOST ? HOST.defaults || {} : {}), ...((await a2.storage.get("prefs").catch(() => null)) || {}) };
    if (HOST) prefs.tip = true; // the overlay is always a tip that opens into the guide
    applyPrefs();
    const pl = await a2.storage.get("places").catch(() => null);
    if (pl) places = { field: Array.isArray(pl.field) ? pl.field : [], names: pl.names || {}, worlds: pl.worlds || {} };
    const last = await a2.storage.get("last").catch(() => null);
    if (last) await useKey(last);
    else rebuild();
    render();
    await a2.ready();
    readyAt = Date.now();
    // keep "per hour" and session times fresh while the stats tab is open
    setInterval(() => { if (tab === "stats") renderStats(); }, 30000);
  })().catch((e) => { console.error(e); render(); });
  window.addEventListener("beforeunload", flush);
  // ── hooks for the overlay host ──
  if (HOST) {
    // the plugin in A2 Tools records the counts; take its saved copy when it differs from ours
    // newer means: a later pet list, or the same list with at least our last soul applied
    window.FG_adopt = (k, p, l) => {
      if (k !== key || !p || !p.levels) return;
      const theirs = [p.syncedAt || 0, (p.lastGain && p.lastGain.at) || 0], ours = [pets.syncedAt || 0, (pets.lastGain && pets.lastGain.at) || 0];
      const newer = theirs[0] > ours[0] || (theirs[0] === ours[0] && theirs[1] >= ours[1]);
      if (newer && JSON.stringify([p.levels, p.points]) !== JSON.stringify([pets.levels, pets.points])) {
        const resync = p.syncedAt !== pets.syncedAt;
        pets = p;
        touched();
        if (resync) rebuild();
        render();
      }
      if (l && Array.isArray(l.log) && l.log.length >= log.length) { log = l.log; levelLog = l.levelLog || levelLog; }
    };
    window.FG_key = () => key;
    // when the game starts: what your last session gave, and what's left (from your own soul log)
    // after a break (30 min or more since your last soul): one quiet line, hello and what's left
    window.FG_recap = () => {
      const last = log.reduce((a, e) => Math.max(a, e[0]), 0);
      if (log.length < 3 || Date.now() - last < 30 * 60000) return;
      const todo = Object.keys(D.pets).filter((p) => E.isFarmable(D, p) && leftOf(p) > 0).length;
      const line = `👋 Welcome back · ${todo} pet${todo === 1 ? "" : "s"} to go`;
      if (isFolded()) tipFlash(line, 4000); else flash(line);
    };
    window.FG_toggleLock = () => { prefs.locked = !prefs.locked; applyLock(); savePrefs(); flash(prefs.locked ? "🔒 Locked" : "🔓 Unlocked"); if (isFolded()) tipFlash(prefs.locked ? "🔒 Locked" : "🔓 Unlocked", 1500); };
    window.FG_isLocked = () => !!prefs.locked;
    window.FG_fold = (on) => (on ? fold() : unfold());
    window.FG_isFolded = isFolded;
    window.FG_model = () => getModel(); // tests and tools: the current stop as the guide sees it
    window.FG_prefs = () => prefs;
    window.FG_applyPrefs = () => { applyPrefs(); render(); };
  }
})();
