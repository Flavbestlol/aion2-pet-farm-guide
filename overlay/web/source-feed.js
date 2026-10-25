// Farm Guide Overlay: Flav-Toolkit as the source of game records. The Rust side (src-tauri/src/feed.rs)
// reads Flav-Toolkit's feed and hands every event here; this turns them into what the guide expects
// from A2 Tools (window.a2's "decoded:…" and "character"), so the same guide code runs either way.
//  - Flav-Toolkit runs the plugin's own decoders (addon.json "decoders"): the data is A2 Tools'.
//  - Who you are comes from my_server and my_profile, not on each event as in A2 Tools.
//  - At login the pet list can come a moment before my_server: it waits for it (up to 600 ms), as
//    A2 Tools does, so the list is filed under the right server.
//  - Flav-Toolkit hands the last pet list again on every reconnect: only a list newer than our
//    counts is applied (records.js).
//  - While it's the source, the overlay records the counts itself (host.js keeps them).
(function () {
  "use strict";
  const OV = window.FG_OV;
  const R = window.FG_RECORDS;
  const { invoke, listen, fire } = OV;
  const $ = (s) => document.querySelector(s);

  let state = { feed: false }, status = null;
  let server = 0, profile = null, told = "";
  let hold = null, chain = Promise.resolve();

  const character = () => (server ? { serverId: server, name: (profile && profile.name) || "", level: (profile && Number(profile.level)) || 0 } : null);
  function sendCharacter() {
    const c = character();
    const k = JSON.stringify(c);
    if (c && k !== told && OV.active === "feed") { told = k; fire("character", c); }
  }

  async function deliver(e) {
    const ev = `decoded:${e.decoder}`;
    const c = character();
    if (ev === "decoded:pet-list") {
      const key = c ? `server-${c.serverId}` : "server-unknown";
      const saved = await OV.records.get(`pets-${key}`).catch(() => null);
      if (R.staleList(e.at_ms, saved)) return; // the same list again, or older than the souls since
    }
    fire(ev, e.data, { character: c, at: e.at_ms });
  }
  function release() {
    if (!hold) return;
    clearTimeout(hold.timer);
    const q = hold.queue;
    hold = null;
    for (const e of q) chain = chain.then(() => deliver(e)).catch(console.error);
  }
  function onEvent(e) {
    if (!e || typeof e.type !== "string") return;
    if (e.type === "my_server") {
      server = R.validServer(e.server);
      sendCharacter();
      release();
      return;
    }
    if (e.type === "my_profile") {
      profile = { name: e.name, level: e.level };
      sendCharacter();
      return;
    }
    if (e.type !== "decoded" || e.plugin !== "farm-guide" || OV.active !== "feed") return;
    if (hold) { hold.queue.push(e); return; }
    if (e.decoder === "pet-list" && R.isLive(e.at_ms)) {
      hold = { queue: [e], timer: setTimeout(release, 600) };
      return;
    }
    chain = chain.then(() => deliver(e)).catch(console.error);
  }

  // ── is anything being recorded? Flav-Toolkit says, every 2 s ──
  function showStatus() {
    if (OV.active !== "feed") return;
    const ok = !!(status && status.capturing);
    const n = $(".ovnotice");
    if (n) {
      n.replaceChildren();
      const b = document.createElement("b");
      b.textContent = "Nothing is being recorded.";
      n.append(b, ` Flav-Toolkit: ${(status && status.text) || "not reading the game"}.`);
      n.hidden = ok;
    }
    document.body.classList.toggle("noplugin", !ok);
  }

  function onSource(s) {
    state = s && typeof s === "object" ? s : { feed: false };
    if (state.feed) {
      status = state.status || status;
      told = "";
      OV.setActive("feed");
      sendCharacter();
      showStatus();
    } else {
      server = 0; profile = null; told = "";
      if (hold) { clearTimeout(hold.timer); hold = null; }
      OV.setActive("a2");
    }
  }

  OV.sources.feed = {
    id: "feed",
    label: "Flav-Toolkit",
    // the guide is ready: now the Rust side may connect (what Flav-Toolkit sends at once reaches it)
    start: () => invoke("feed_start").catch(() => {}),
    state: () => state,
    lockHint: "Locked: clicks go through to the game, except the padlock: click it to unlock. Or the tray icon's Lock",
    summary: () => (state.feed ? `Flav-Toolkit ${String(state.core || "").split(" ")[0]}` : state.refused ? `Flav-Toolkit refused: ${state.refused}` : ""),
  };

  listen("feed", (e) => onEvent(e.payload));
  listen("feed-status", (e) => { status = e.payload || null; showStatus(); });
  listen("source", (e) => onSource(e.payload));
  // the hub's Open and Settings for Pet Farm Guide
  listen("show", (e) => {
    if (window.FG_fold) window.FG_fold(false);
    if (e.payload === "settings") setTimeout(() => $('.tabs button[data-tab="settings"]')?.click(), 250);
  });
  document.addEventListener("DOMContentLoaded", () => {
    invoke("source_state").then((s) => { if (s) onSource(s); }).catch(() => {});
  });
})();
