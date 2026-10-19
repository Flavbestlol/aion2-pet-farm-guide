// Bridge to the Farm Guide Overlay app (a separate window drawn over the game).
// A2 Tools saves this plugin's storage as files on disk, so:
//  - every game record is written straight away to "bridge" (bridge.json), which the overlay watches;
//  - the overlay writes a heartbeat to "overlay" (overlay.json) every 2 s. While it's alive, this
//    window hides itself (it keeps recording in the background) and stays silent, and comes back
//    when the overlay closes;
//  - "pluginbeat" tells the overlay this plugin is running.
(function () {
  "use strict";
  const MAX = 200;
  const run = Date.now(); // a new run id each time the plugin starts: the overlay then goes by time
  let seq = 0, events = [], character = null, loaded = false;
  const early = [];
  let writing = false, dirty = false;
  async function write() {
    if (writing) { dirty = true; return; }
    writing = true;
    try {
      do {
        dirty = false;
        await a2.storage.set("bridge", { v: 2, run, seq, at: Date.now(), character, events }).catch(() => {});
      } while (dirty);
    } finally { writing = false; }
  }
  function push(ev, data, meta) {
    if (!loaded) return early.push([ev, data, meta]);
    seq += 1;
    if (meta && meta.character) character = meta.character;
    // only the latest pet list is worth keeping (they're big); the file stays well under 1 MB
    if (ev === "decoded:pet-list") events = events.filter((e) => e.ev !== "decoded:pet-list");
    events.push({ seq, ev, data, character: (meta && meta.character) || character, at: (meta && meta.at) || Date.now() });
    if (events.length > MAX) events = events.slice(-MAX);
    write();
  }
  for (const ev of ["decoded:pet-list", "decoded:soul-gained", "decoded:level-up", "decoded:map-load"]) a2.on(ev, (data, meta) => push(ev, data, meta));
  a2.on("character", (c) => { if (c) { character = c; push("character", c, { character: c }); } });
  a2.storage.get("bridge").then((b) => {
    if (b && Number.isFinite(b.seq)) { seq = b.seq; events = Array.isArray(b.events) ? b.events.slice(-MAX) : []; character = character || b.character || null; }
  }).catch(() => {}).finally(() => { loaded = true; for (const e of early.splice(0)) push(...e); });

  // ── the overlay's heartbeat ──
  // While the overlay is on screen this window goes quiet (the overlay plays the sounds) and, as the
  // overlay's setting says: hides itself (the default; a hidden plugin still records: game events wake
  // it, only its timers sleep), shows a small recording card, or stays the full guide.
  let hidden = null; // what we last asked A2 Tools for
  window.FG_MUTED = false;
  const viewOf = (hb) => hb.pluginView || (hb.keepPlugin ? "full" : "hidden");
  async function check() {
    const hb = await a2.storage.get("overlay").catch(() => null);
    const alive = !!hb && Number(hb.at) > 0 && Date.now() - Number(hb.at) < 8000;
    window.FG_MUTED = alive;
    const view = alive ? viewOf(hb) : "full";
    if (document.body.classList.contains("companion") !== (view === "card")) {
      document.body.classList.toggle("companion", view === "card");
      if (window.FG_renderCompanion) window.FG_renderCompanion();
    }
    const wantHidden = view === "hidden";
    if (wantHidden === hidden) return;
    if (hidden === null && !wantHidden) {
      // first look after a start: show the window only if we hid it (A2 Tools remembers it hidden)
      const was = await a2.storage.get("hidbyus").catch(() => null);
      hidden = false;
      if (!was) return;
    }
    hidden = wantHidden;
    a2.storage.set("hidbyus", wantHidden ? Date.now() : false).catch(() => {});
    (wantHidden ? a2.window.hide() : a2.window.show()).catch(() => {});
  }
  setInterval(check, 2000);
  check();
  const beat = () => a2.storage.set("pluginbeat", { at: Date.now() }).catch(() => {});
  setInterval(beat, 5000);
  beat();
})();
