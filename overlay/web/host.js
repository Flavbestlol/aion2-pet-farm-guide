// Farm Guide Overlay: the host page. It stands in for A2 Tools' SDK (window.a2) so the same guide
// code runs here, in a transparent window over the game:
//  - game records come from a source: Flav-Toolkit's feed while it runs (source-feed.js), else
//    A2 Tools' plugin (source-a2.js, everything about A2 Tools);
//  - the counts and the soul log: our own copy, merged with the plugin's (records.js);
//  - our own settings and route position live in the overlay's folder;
//  - the tip and the guide float anywhere on screen; everything else lets clicks through to the game.
(function () {
  "use strict";
  const T = window.__TAURI__;
  const invoke = (cmd, args) => T.core.invoke(cmd, args);
  const listen = (ev, fn) => T.event.listen(ev, fn);
  const $ = (s) => document.querySelector(s);

  // ── window.a2, as the guide expects it ─────────────────────────────
  const handlers = {};
  const fire = (ev, data, meta = {}) => {
    for (const fn of handlers[ev] || []) {
      try { fn(data, { character: meta.character ?? null, at: meta.at ?? null }); } catch (e) { console.error(e); }
    }
  };
  const read = async (scope, key) => {
    const t = await invoke("read_file", { scope, key }).catch(() => null);
    if (t == null || t === "") return null;
    try { return JSON.parse(t); } catch { return null; }
  };
  // what a source of game records may use (source-a2.js, source-feed.js); each adds itself to sources
  const OV = (window.FG_OV = { invoke, listen, read, fire, card: (spec) => card(spec), prefs: () => prefs(), version: () => VERSION, sources: {}, active: "a2" });
  const A2 = () => OV.sources.a2 || null;
  const FEED = () => OV.sources.feed || null;

  // ── the player's records (counts, soul log, the server played last) ──
  // We keep our own copy whichever source is in use; A2 Tools' plugin keeps its own. Reading takes
  // the newer counts and both logs (records.js), so moving between the sources loses nothing.
  const R = window.FG_RECORDS;
  const RECORD = /^(pets-|log-|last$)/;
  OV.records = {
    async get(key) {
      const fromA2 = OV.active === "a2";
      const [own, theirs] = await Promise.all([read("own", key), A2() ? A2().readOwned(key) : null]);
      if (key.startsWith("pets-")) return R.newerPets(own, theirs, fromA2 ? "b" : "a");
      if (key.startsWith("log-")) return R.mergeLogs(own, theirs);
      return fromA2 ? theirs ?? own : own ?? theirs; // last
    },
    set: (key, value) => invoke("write_file", { scope: "own", key, value: JSON.stringify(value) }),
  };
  // which source is in use: Flav-Toolkit while its feed is connected, A2 Tools otherwise
  OV.setActive = (id) => {
    if (id === OV.active) return;
    OV.active = id;
    document.body.dataset.source = id;
    const n = $(".ovnotice");
    if (n) n.hidden = true; // the new source says soon enough whether it records
    if (id === "feed") feedHello();
  };
  // the first time Flav-Toolkit is the source: say so, once
  function feedHello() {
    const p = prefs();
    if (!window.FG_prefs || p.ovFeedSeen) return;
    p.ovFeedSeen = true;
    a2.storage.set("prefs", p);
    card({
      title: "Reading the game from Flav-Toolkit",
      body: ["Flav-Toolkit is running, so the guide gets your pets from it, with the same counts as before.", A2() ? "A2 Tools isn't needed for the guide while Flav-Toolkit runs; without Flav-Toolkit it reads from A2 Tools again." : "Without Flav-Toolkit, nothing is recorded."],
      foot: "Settings › Overlay shows where your records come from.",
    });
  }
  window.a2 = Object.freeze({
    on(ev, fn) { (handlers[ev] ||= []).push(fn); },
    storage: Object.freeze({
      async get(key) {
        if (RECORD.test(key)) return OV.records.get(key);
        const own = await read("own", key);
        if (own != null || key !== "prefs") return own;
        // first start: the source may have the player's choices already
        return (await A2()?.firstPrefs?.()) ?? null;
      },
      async set(key, value) {
        await invoke("write_file", { scope: "own", key, value: JSON.stringify(value) });
      },
    }),
    notify: async () => true,
    window: Object.freeze({ show: async () => {}, hide: async () => {} }),
    ready: async () => { A2()?.start(); FEED()?.start(); return true; },
  });

  // ── the overlay's own settings, shown in the guide's Settings tab ──
  window.FG_HOST = {
    overlay: true,
    defaults: { theme: "hud", tip: true, folded: true, tipIdle: 3, tipAuto: 0, ovSide: "auto", ovScale: 1, ovBg: 0.66, ovShow: "front", ovAutostart: false, ovAutostartAsked: false, ovFace: "middle" },
    onFold: () => requestAnimationFrame(layout),
    // where the guide is on screen (parts you moved are pinned to the screen, placed from this)
    appBox: () => lastBox,
    // hold the header where it is now (a size switch is coming)
    holdHeader() { if (lastBox && !(window.FG_isFolded && window.FG_isFolded())) pinTop = lastBox.pt; },
    // edit mode: while you drag a part, the whole window takes the mouse (it may leave the guide)
    capture(on) { lastHits = ""; invoke("set_capture", { on: !!on }).catch(() => {}); if (!on) sendHits(); },
    summary() {
      const p = prefs();
      const from = OV.active === "feed" ? "Flav-Toolkit" : A2() ? "A2 Tools" : "nothing";
      const show = { front: "game in front", running: "game running", always: "always" }[p.ovShow || "front"];
      if (kind === "store") return `records from ${from} · shows when ${show} · started and updated by Flav-Toolkit`;
      return `records from ${from} · shows when ${show} · starts with Windows ${p.ovAutostart ? "on" : "off"} · no more updates: move to Flav-Toolkit`;
    },
    settings({ row, seg, toggle, h, prefs, savePrefs }, part) {
      if (part === "look") {
      const sz = h("input");
      sz.type = "range"; sz.min = "0.6"; sz.max = "1.5"; sz.step = "0.05"; sz.value = String(prefs.ovScale || 1);
      row("Size", `${Math.round((prefs.ovScale || 1) * 100)}% · or hold Ctrl and scroll over the guide`, sz);
      sz.addEventListener("input", () => { prefs.ovScale = Number(sz.value); applyLook(); layout(); const d = sz.closest(".row")?.querySelector("small"); if (d) d.textContent = `${Math.round(prefs.ovScale * 100)}% · or hold Ctrl and scroll over the guide`; });
      sz.addEventListener("change", savePrefs);
      const bg = h("input");
      bg.type = "range"; bg.min = "0"; bg.max = "0.9"; bg.step = "0.05"; bg.value = String(prefs.ovBg ?? 0.66);
      bg.addEventListener("input", () => { prefs.ovBg = Number(bg.value); applyLook(); });
      bg.addEventListener("change", savePrefs);
      row("Background", "From fully clear to solid", bg);
      row("Docked side", "Auto: the edge nearest the tip. The guide grows out of that edge", seg("ovSide", [["auto", "Auto"], ["left", "Left"], ["right", "Right"]], layout));
      row("Layout faces", "Middle: the dial and text sit toward the centre of the screen. Edge: toward the edge it's docked to", seg("ovFace", [["middle", "Middle"], ["edge", "Edge"]], layout));
      return;
      }
      row("Show", "Hidden whenever AION 2 isn't running; and, if you like, while you're in another window", seg("ovShow", [["front", "Game in front"], ["running", "Game running"], ["always", "Always"]], updateShow));
      if (kind === "store") {
        row("Starts with", "Flav-Toolkit starts and stops the guide: turn on Start with Flav-Toolkit on its page in the hub", h("span", "chip-stat", "Flav-Toolkit"));
        row("Updates", STORE_UPDATES, h("span", "chip-stat", VERSION));
      } else {
      row("Start with Windows", "Off unless you turn it on. When on, it waits hidden until you start AION 2", toggle("ovAutostart", () => { prefs.ovAutostartAsked = true; savePrefs(); invoke("autostart", { on: !!prefs.ovAutostart }).catch(() => {}); }));
      const mv = h("button", "btn", "How");
      mv.type = "button";
      mv.addEventListener("click", () => moveCard(true));
      row("Updates", "None for this copy: Pet Farm Guide now installs and updates from Flav-Toolkit (Get add-ons). Your progress comes with you", mv);
      }
      const feed = OV.active === "feed";
      const src = h("span", "chip-stat", feed ? "Flav-Toolkit" : A2() ? "A2 Tools" : "None");
      row("Game records", feed ? `From Flav-Toolkit (${FEED().summary()}). Without it, from A2 Tools again` : `From A2 Tools. Start Flav-Toolkit and the guide reads from it instead${FEED()?.summary() ? ` · ${FEED().summary()}` : ""}`, src);
      A2()?.settings?.({ row, seg, toggle, h, prefs, savePrefs });
      const k = h("span", "chip-stat", feed ? "Padlock" : "Ctrl+Alt+L");
      row("Lock / unlock", (feed ? FEED() : A2())?.lockHint || "Locked: clicks go through to the game, except the padlock: click it to unlock", k);
      const btns = h("div", "btnrow");
      const reset = h("button", "btn", "Reset position");
      reset.type = "button";
      reset.addEventListener("click", () => { anchor = { ...DEFAULT_ANCHOR }; pinTop = null; saveAnchor(); layout(); });
      const quit = h("button", "btn", "Close overlay");
      quit.type = "button";
      quit.addEventListener("click", () => shutdown());
      btns.append(reset, quit);
      row("Overlay", `Version ${VERSION}`, btns);
    },
  };
  const VERSION = "1.22.0";

  // ── a card in the middle of the screen: questions and news from the overlay itself ──
  // One at a time; it takes the mouse while it's up (see hits).
  let cardEl = null, cardQueue = [];
  function card(spec) {
    if (cardEl) { cardQueue.push(spec); return; }
    const el = document.createElement("div");
    el.className = "ovcard" + (spec.tone ? ` ${spec.tone}` : "") + (spec.always ? " always" : "");
    el.setAttribute("role", "dialog");
    const t = document.createElement("div"); t.className = "oc-t"; t.textContent = spec.title;
    const b = document.createElement("div"); b.className = "oc-b";
    for (const line of [].concat(spec.body || [])) { const p = document.createElement("p"); p.textContent = line; b.append(p); }
    const prog = document.createElement("div"); prog.className = "oc-prog"; prog.hidden = true; prog.innerHTML = "<i></i>";
    const status = document.createElement("div"); status.className = "oc-s";
    const btns = document.createElement("div"); btns.className = "oc-btns";
    for (const [label, fn, primary] of spec.buttons || [["OK", null, true]]) {
      const x = document.createElement("button"); x.type = "button"; x.className = "oc-btn" + (primary ? " primary" : ""); x.textContent = label;
      x.addEventListener("click", async () => { const keep = fn ? await fn(api) : false; if (!keep) api.close(); });
      btns.append(x);
    }
    el.append(t, b, prog, status, btns);
    if (spec.foot) { const f = document.createElement("div"); f.className = "oc-f"; f.textContent = spec.foot; el.append(f); }
    document.body.append(el);
    const api = {
      el, always: !!spec.always, status(text, err) { status.textContent = text || ""; status.classList.toggle("err", !!err); },
      progress(k) { prog.hidden = k == null; prog.firstChild.style.width = `${Math.round(Math.min(1, k || 0) * 100)}%`; },
      busy(on) { for (const x of btns.children) x.disabled = !!on; },
      close() { el.classList.add("out"); setTimeout(() => { el.remove(); if (cardEl === api) { cardEl = null; const n = cardQueue.shift(); if (n) card(n); } sendHits(); }, 260); },
    };
    cardEl = api;
    requestAnimationFrame(() => { el.classList.add("in"); sendHits(); });
    return api;
  }
  const savePrefsNow = () => { const p = prefs(); a2.storage.set("prefs", p); };

  // ── start with Windows: only if you say so ──
  // Earlier versions turned it on by themselves. Now nothing is set until you answer once.
  function askAutostart() {
    card({
      title: "Start with Windows?",
      body: ["Farm Guide Overlay can start when you sign in to Windows and wait, hidden, until you play AION 2.", "It does nothing else in the background."],
      foot: "You can change this any time in Settings › Overlay.",
      buttons: [
        ["Yes, start with Windows", () => { const p = prefs(); p.ovAutostart = true; p.ovAutostartAsked = true; savePrefsNow(); invoke("autostart", { on: true }).catch(() => {}); }, true],
        ["No thanks", () => { const p = prefs(); p.ovAutostart = false; p.ovAutostartAsked = true; savePrefsNow(); invoke("autostart", { on: false }).catch(() => {}); }],
      ],
    });
  }

  // ── moving to Flav-Toolkit: from 1.25.0 the guide installs and updates only from Flav-Toolkit's
  // Get add-ons. A copy from the old setup (or put in place by hand) says so once, and in Settings.
  function moveCard(always) {
    const setup = kind === "setup";
    card({
      always: !!always,
      title: "Pet Farm Guide now comes with Flav-Toolkit",
      body: [
        "This copy keeps working, but it gets no more updates.",
        "Install Flav-Toolkit, then in its hub: Get add-ons › Pet Farm Guide › Install. Your progress comes with you (it's kept in your own folder, not in the guide's).",
        setup
          ? "Then remove this copy: Windows Settings › Apps › AION 2 Pet Farm Guide › Uninstall, and answer No when it asks to delete your data."
          : "Then close this copy and delete its folder. Your progress stays.",
      ],
      buttons: [
        ["Get Flav-Toolkit", () => { invoke("open_link", { url: "https://github.com/Flavbestlol/flav-toolkit/releases/latest" }).catch(() => {}); }, true],
        ["Later", null],
      ],
    });
  }

  // what you chose in the installer ("Start with Windows"), taken once as your answer
  async function fromInstaller() {
    const inst = await read("own", "installer");
    if (!inst) return null;
    const p = prefs();
    if (typeof inst.autostart === "boolean") { p.ovAutostart = inst.autostart; p.ovAutostartAsked = true; savePrefsNow(); }
    invoke("write_file", { scope: "own", key: "installer", value: "" }).catch(() => {});
    return inst;
  }

  // how this copy came: "store" (Flav-Toolkit's Get add-ons: it updates and starts the guide),
  // "setup" (the old installer) or "hand". Set at start (install.rs install_kind). From 1.25.0 the
  // overlay has no updater of its own: Flav-Toolkit updates the copies it installed, older copies
  // are told to move (moveCard).
  let kind = "hand";
  const STORE_UPDATES = "From Flav-Toolkit: its hub tells you when a new version is out (Get add-ons) and installs it";

  const prefs = () => (window.FG_prefs ? window.FG_prefs() : {});
  function applyLook() {
    const p = prefs();
    document.documentElement.style.setProperty("--ov-scale", String(p.ovScale || 1));
    document.documentElement.style.setProperty("--ov-bg", String(p.ovBg ?? 0.66));
  }
  // How a zoomed element's left/top map to the screen depends on the engine's zoom rules:
  // measure it once per scale instead of assuming.
  // Measured on a probe: a hidden fixed box with the same zoom and nothing else, so a fold or pop-in
  // animation (transforms) or a measure taken before the zoom applied can't skew it. Measuring the
  // guide itself once cached 1 at XL, and a guide or tip docked right then hung off the screen.
  const kCache = {};
  let probe = null;
  function placeK(_el, z) {
    if (z === 1) return 1;
    if (kCache[z]) return kCache[z];
    if (!probe) {
      probe = document.createElement("div");
      probe.style.cssText = "position:fixed;top:0;left:0;width:10px;height:10px;visibility:hidden;pointer-events:none;zoom:var(--ov-scale)";
      document.body.append(probe);
    }
    probe.style.left = "0px";
    const a = probe.getBoundingClientRect().left;
    probe.style.left = "100px";
    const b = probe.getBoundingClientRect().left;
    const k = (b - a) / 100;
    if (!(k > 0.2) || Math.abs(k - 1) < 1e-3) return z; // the zoom not applied yet: assume it, measure next time
    return (kCache[z] = k);
  }

  // ── where the tip sits; the guide opens from it toward the middle of the screen ──
  const DEFAULT_ANCHOR = { fx: 0.03, fy: 0.36 }; // left side, above the chat: open space in AION 2's HUD
  let anchor = { ...DEFAULT_ANCHOR };
  const saveAnchor = () => invoke("write_file", { scope: "own", key: "anchor", value: JSON.stringify(anchor) }).catch(() => {});
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const ICON = 25; // from the tip's edge to its icon's centre, in CSS px before scaling
  let tipBox = null;
  let frameH = 0; // the guide tab's height on screen, last seen: where the header goes on every tab // the tip's last measured size on screen [w, h], kept while it is hidden
  // Where the header sits while the guide is open. A size switch, or a part that comes or goes,
  // changes how tall the guide is, never where its header is: the bottom moves, the header stays
  // under your mouse. It moves only when you drag it, or as little as it takes to stay on screen.
  let pinTop = null;
  let lastBox = null, lastTip = null; // where the guide and the tip are on screen, from the last layout
  function layout() {
    const tip = $(".tip"), app = $("#app"), toasts = $("#toasts");
    if (!tip || !app) return;
    applyLook();
    const W = innerWidth, H = innerHeight, z = Number(prefs().ovScale || 1);
    const ax = clamp(anchor.fx, 0, 1) * W, ay = clamp(anchor.fy, 0, 1) * H;
    const side = prefs().ovSide || "auto";
    // while you drag, the side it's docked to stays as it was (it's decided when you let go): it
    // used to flip as you crossed the middle of the screen, and the guide jumped off your mouse
    const right = drag && drag.moved ? drag.right : side === "auto" ? ax > W / 2 : side === "right", bottom = ay > H / 2;
    tip.classList.toggle("flip", right);
    document.body.classList.toggle("dock-right", right);
    // the layout faces the other way from the edge it's docked to: docked left, it reads from the
    // middle of the screen (dial and text toward the centre); docked right, the opposite
    document.body.classList.toggle("side-right", (prefs().ovFace || "middle") === "edge" ? right : !right);
    // zoomed elements take left/top in their own (zoomed) units.
    // The tip's size comes from its layout box, never its on-screen box: while it pops in (scale .6→1)
    // or is hovered (1.04) the on-screen box is the wrong size, and a tip docked right was placed by
    // that smaller width and hung off the screen until its text next changed.
    if (tip.offsetWidth) tipBox = [tip.offsetWidth * z, tip.offsetHeight * z];
    const [tw, th] = tipBox || [220 * z, 52 * z];
    const tl = clamp(right ? ax + ICON * z - tw : ax - ICON * z, 6, W - tw - 6);
    const tt = clamp(ay - th / 2, 6, H - th - 6);
    const tk = placeK(tip, z), k = tk;
    tip.style.left = `${tl / tk}px`;
    tip.style.top = `${tt / tk}px`;
    lastTip = { tl, tt, tw, th };
    // The guide's height decides where the header sits, on every tab: Pets / Stats / Settings fit
    // under that same header (scrolling inside) instead of moving it. Placed by their own (fixed)
    // height, the header and tabs jumped up or down when you left the guide tab, by up to 200 px.
    const onGuide = (document.body.dataset.tab || "guide") === "guide";
    if (onGuide) app.style.maxHeight = "";
    const folded = window.FG_isFolded ? window.FG_isFolded() : false;
    // the room under the header: the guide fits itself into it (the map gets smaller) rather
    // than the header moving up when the full guide is taller than the space below it
    const room = Math.max(300 * z, H - 8 - (pinTop !== null && !folded ? clamp(pinTop, 8, H) : 8)) / z;
    document.documentElement.style.setProperty("--room", `${Math.floor(room)}px`);
    if (!folded && window.FG_fitRoom) { try { window.FG_fitRoom(room); } catch (e) { console.warn(e); } }
    const pw = app.offsetWidth * z, ah = app.offsetHeight * z;
    if (onGuide && ah > 0) frameH = ah;
    const ph = frameH || ah;
    const pl = clamp(right ? ax + ICON * z - pw : ax - ICON * z, 8, W - pw - 8);
    if (folded) pinTop = null;
    const pt = pinTop !== null ? clamp(pinTop, 8, H - ph - 8) : clamp(bottom ? ay + ICON * z - ph : ay - ICON * z, 8, H - ph - 8);
    if (pinTop !== null) pinTop = pt;
    lastBox = { pl, pt, pw, ph, z, border: app.clientLeft || 0 };
    if (!onGuide) {
      const room = Math.max(240 * z, H - 8 - pt) / z; // the sheet: down to the screen's edge at most
      if (app.style.maxHeight !== `${room}px`) app.style.maxHeight = `${room}px`;
    }
    const bh = app.offsetHeight * z; // what's on screen now, for the messages at its bottom
    app.style.left = `${pl / k}px`;
    app.style.top = `${pt / k}px`;
    // the guide grows out of the tip and shrinks back into it
    app.style.setProperty("--tip-x", `${(ax - pl) / z}px`);
    app.style.setProperty("--tip-y", `${(ay - pt) / z}px`);
    // messages sit at the bottom inside the guide; the compact guide is small, so they go just
    // outside it instead (below, or above when there's no room below)
    if (toasts) {
      const compact = onGuide && document.body.classList.contains("vcompact");
      toasts.style.left = `${pl + (compact ? 0 : 10 * z)}px`;
      toasts.style.width = `${Math.max(pw - (compact ? 0 : 20 * z), 260 * z)}px`;
      toasts.style.right = "auto";
      if (compact && H - (pt + bh) > 150 * z) { toasts.style.bottom = "auto"; toasts.style.top = `${pt + bh + 6 * z}px`; toasts.classList.add("below"); }
      else { toasts.style.top = "auto"; toasts.style.bottom = `${compact ? H - pt + 6 * z : H - (pt + bh) + 10 * z}px`; toasts.classList.remove("below"); }
    }
    // parts you moved off the guide (edit mode) stay on screen wherever the guide goes
    if (window.FG_afterLayout) { try { window.FG_afterLayout(); } catch (e) { console.warn(e); } }
    sendHits();
  }
  addEventListener("resize", layout);

  // ── dragging the tip or the guide's header moves both ──
  // The part you hold stays exactly under your mouse: the guide (or the tip) moves by what the
  // mouse moves, and the anchor follows from it. Which side it docks to is decided when you let go.
  let drag = null, justDragged = false;
  function startDrag(e, kind) {
    if (e.button !== 0 || (window.FG_isLocked && window.FG_isLocked())) return;
    drag = { kind, x: e.clientX, y: e.clientY, moved: false, id: e.pointerId, el: e.currentTarget, right: document.body.classList.contains("dock-right") };
  }
  const isRight = (cx) => { const side = prefs().ovSide || "auto"; return side === "auto" ? cx > innerWidth / 2 : side === "right"; };
  function moveDrag(e) {
    if (!drag || e.pointerId !== drag.id) return;
    if (e.buttons === 0) return endDrag(e); // the button came up somewhere we didn't hear (Alt+Tab, Win key)
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    if (!drag.moved) {
      if (!lastBox || !lastTip) layout();
      drag.moved = true;
      drag.box = { ...lastBox };
      drag.tip = { ...lastTip };
      try { drag.el.setPointerCapture(drag.id); } catch {}
      document.body.classList.add("dragging");
      document.body.classList.remove("snapping");
      lastHits = ""; // while dragging the whole window takes the mouse
      invoke("set_capture", { on: true }).catch(() => {});
    }
    placeDragged(dx, dy, drag.right);
    layout();
  }
  // the anchor (where the tip sits, the end the guide grows from) for the guide or tip at this spot
  function placeDragged(dx, dy, right) {
    const W = innerWidth, H = innerHeight, z = Number(prefs().ovScale || 1);
    if (drag.kind === "panel") {
      const b = drag.box;
      // lower than its height allows is fine: it fits itself into the room under the header
      const pl = clamp(b.pl + dx, 8, W - b.pw - 8), pt = clamp(b.pt + dy, 8, H - Math.min(b.ph, 300 * z) - 8);
      const bottom = pt + b.ph / 2 > H / 2;
      anchor = { fx: clamp((right ? pl + b.pw - ICON * z : pl + ICON * z) / W, 0, 1), fy: clamp((bottom ? pt + b.ph - ICON * z : pt + ICON * z) / H, 0, 1) };
      pinTop = pt;
      return { pl, pt };
    }
    const t = drag.tip;
    const tl = clamp(t.tl + dx, 6, W - t.tw - 6), tt = clamp(t.tt + dy, 6, H - t.th - 6);
    anchor = { fx: clamp((right ? tl + t.tw - ICON * z : tl + ICON * z) / W, 0, 1), fy: clamp((tt + t.th / 2) / H, 0, 1) };
    return { tl, tt };
  }
  function endDrag(e) {
    if (!drag || (e.pointerId !== undefined && e.pointerId !== drag.id)) return;
    const d = drag;
    if (d.moved) {
      const W = innerWidth, H = innerHeight, z = Number(prefs().ovScale || 1), near = 48 * z;
      const dx = (e.clientX ?? d.x) - d.x, dy = (e.clientY ?? d.y) - d.y;
      let snapped = false;
      if (d.kind === "panel") {
        // let go: dock to the side its middle is on, and settle against a screen edge if it's close
        const b = d.box, { pl, pt } = placeDragged(dx, dy, d.right);
        let nl = pl, nt = pt;
        if (nl < 8 + near) nl = 8; else if (nl + b.pw > W - 8 - near) nl = W - b.pw - 8;
        if (nt < 8 + near) nt = 8;
        snapped = nl !== pl || nt !== pt;
        const right = isRight(nl + b.pw / 2);
        d.box = { ...b, pl: 0, pt: 0 };
        placeDragged(nl, nt, right);
      } else {
        const t = d.tip, { tl } = placeDragged(dx, dy, d.right);
        placeDragged(dx, dy, isRight(tl + t.tw / 2));
      }
      drag = null;
      if (d.kind === "tip") snapToEdge();
      else if (snapped) { document.body.classList.add("snapping"); setTimeout(() => document.body.classList.remove("snapping"), 450); }
      layout();
      justDragged = true;
      setTimeout(() => { justDragged = false; }, 0);
      saveAnchor();
      document.body.classList.remove("dragging");
      invoke("set_capture", { on: false }).catch(() => {});
    }
    drag = null;
  }
  // The guide opens out of the tip; from the moment you use it (or it switches size), its header
  // stays put: whatever grows or shrinks, the bottom moves. Pinned on the first touch, not when it
  // opens, so a guide still settling in (its pictures, its size) is never pinned in a wrong place.
  addEventListener("pointerdown", (e) => { if (pinTop === null && e.target.closest && e.target.closest("#app")) window.FG_HOST.holdHeader(); }, true);
  // let go near a screen edge: the tip settles against it, with a little spring
  function snapToEdge() {
    const W = innerWidth, H = innerHeight, z = Number(prefs().ovScale || 1);
    const m = (ICON + 8) * z, near = 48 * z;
    const x = anchor.fx * W, y = anchor.fy * H;
    let nx = x, ny = y;
    if (x < m + near) nx = m;
    else if (x > W - m - near) nx = W - m;
    if (y < 34 * z + near) ny = 34 * z;
    else if (y > H - 34 * z - near) ny = H - 34 * z;
    if (nx === x && ny === y) return;
    anchor = { fx: nx / W, fy: ny / H };
    document.body.classList.add("snapping");
    layout();
    setTimeout(() => document.body.classList.remove("snapping"), 450);
  }
  function bindDrag() {
    const tip = $(".tip"), top = $(".top");
    tip.addEventListener("pointerdown", (e) => startDrag(e, "tip"));
    top.addEventListener("pointerdown", (e) => { if (!e.target.closest("button, input")) startDrag(e, "panel"); });
    // the whole window listens: a fast drag leaves the tip or header before the capture takes hold
    addEventListener("pointermove", moveDrag);
    addEventListener("pointerup", endDrag);
    addEventListener("pointercancel", endDrag);
    addEventListener("lostpointercapture", endDrag);
    addEventListener("blur", () => { if (drag) endDrag({ pointerId: drag.id }); });
    // a drag that ends on the tip is not a click
    tip.addEventListener("click", (e) => { if (justDragged) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);
  }

  // ── only while AION 2 runs (and is in front, by default) ──
  let game = { running: true, front: true }, shown = true, hideTimer = 0;
  function wantShown() {
    const how = prefs().ovShow || "front";
    return how === "always" || (game.running && (how === "running" || game.front));
  }
  function updateShow() {
    const want = wantShown();
    clearTimeout(hideTimer);
    if (want) return setShown(true);
    // a short grace, so Alt+Tab past it or a click on A2 Tools doesn't make it blink
    hideTimer = setTimeout(() => setShown(wantShown()), game.running ? 1200 : 0);
  }
  function setShown(on) {
    if (on === shown) return;
    shown = on;
    document.body.classList.toggle("nogame", !on);
    invoke("set_showing", { on }).catch(() => {});
    if (on) requestAnimationFrame(layout);
    sendHits();
  }
  let recapDone = false;
  function maybeRecap() {
    if (recapDone || !window.FG_recap) return;
    recapDone = true;
    setTimeout(() => { try { window.FG_recap(); } catch (e) { console.warn(e); } }, 2500);
  }
  listen("game", (e) => {
    const [running, front] = e.payload || [true, true];
    if (!running) recapDone = false; // the next game start gets its own recap
    game = { running: !!running, front: !!front };
    updateShow();
    if (running && front) maybeRecap();
  });

  // ── click-through: tell the window which parts take the mouse ──
  let lastHits = "";
  function hits() {
    const out = [];
    const add = (el) => {
      if (!el || el.hidden || el.offsetParent === null && getComputedStyle(el).position !== "fixed") return;
      const r = el.getBoundingClientRect();
      if (r.width > 1 && r.height > 1) out.push([Math.floor(r.left), Math.floor(r.top), Math.ceil(r.width), Math.ceil(r.height)]);
    };
    // a setup card shows (and takes clicks) even before the game runs
    if (cardEl && (shown || cardEl.always)) add(cardEl.el);
    if (!shown) return out; // hidden: the whole screen belongs to the game
    const folded = window.FG_isFolded ? window.FG_isFolded() : true;
    const locked = window.FG_isLocked ? window.FG_isLocked() : false;
    if (locked) add(folded ? $(".tip") : $(".lockbtn")); // locked: only the padlock (open) or the tip (folded) takes a click
    else if (folded) add($(".tip"));
    else if (document.body.classList.contains("hud") && document.body.dataset.tab === "guide") {
      // no card: only the floating parts take the mouse; the gaps between them belong to the game
      for (const sel of [".top", ".tabs", ".dial", ".info", ".travel", ".suggest", ".notice", ".ovnotice", ".mapwrap", ".mapbar", ".loot .ticker", ".cgrip", ".alike", ".qstyle"]) add($(sel));
      if (window.FG_stopsOpen && window.FG_stopsOpen()) add($(".stoplist"));
      for (const q of document.querySelectorAll(".qcell")) add(q);
      for (const t of document.querySelectorAll("#toasts .toast")) add(t);
    } else {
      add($("#app"));
      for (const d of document.querySelectorAll("[data-edit].detached")) add(d); // moved off the guide
      for (const t of document.querySelectorAll("#toasts .toast")) add(t);
    }
    if (!folded) add($(".tourcard")); // the tour's card (its Next / Skip)
    // edit mode: every part takes the mouse as a whole (to drag it), plus the edit bar and its options
    if (!folded && document.body.classList.contains("editing")) {
      for (const b of document.querySelectorAll("[data-edit]")) add(b);
      add($(".editbar"));
      add($(".editpop"));
    }
    return out;
  }
  function sendHits() {
    const h = hits();
    // the padlock always takes a click (it unlocks); everything else is click-through while locked
    const altOnly = false;
    const s = JSON.stringify([h, altOnly]);
    if (s === lastHits) return;
    lastHits = s;
    invoke("set_hits", { rects: h, altOnly }).catch(() => {});
  }
  setInterval(sendHits, 150);

  // ── Ctrl + scroll over the guide or the tip: bigger or smaller (60% to 150%) ──
  let zoomSave = 0;
  addEventListener("wheel", (e) => {
    if (!e.ctrlKey || !e.target.closest || !e.target.closest("#app, .tip")) return;
    e.preventDefault();
    const p = prefs();
    p.ovScale = Math.round(Math.max(0.6, Math.min(1.5, (Number(p.ovScale) || 1) + (e.deltaY < 0 ? 0.05 : -0.05))) * 100) / 100;
    applyLook();
    layout();
    clearTimeout(zoomSave);
    zoomSave = setTimeout(savePrefsNow, 400);
  }, { passive: false, capture: true });

  // ── links (Ko-fi, credits): open in the browser, never inside the overlay ──
  document.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest("a[href]");
    if (!a) return;
    e.preventDefault();
    if (/^https:\/\//.test(a.href)) invoke("open_link", { url: a.href }).catch(() => {});
  }, true);

  // ── typing (Pets search): the window takes focus only while a field is in use ──
  document.addEventListener("pointerdown", (e) => {
    if (e.target.closest("input[type=search], input[type=number]")) invoke("set_focus", { on: true }).catch(() => {});
  }, true);
  document.addEventListener("focusout", (e) => {
    if (e.target.matches && e.target.matches("input")) invoke("set_focus", { on: false }).catch(() => {});
  });

  // ── closing: the source says goodbye first (A2 Tools' plugin comes back), then we quit ──
  async function shutdown() {
    await Promise.resolve(A2()?.shutdown?.()).catch(() => {});
    invoke("quit").catch(() => {});
  }

  // ── keys and tray ─────────────────────────────────────────────────
  // Ctrl+Alt+L: A2 Tools toggles its own lock on the same keys; src-tauri/src/a2 reads its new state so
  // both always agree (null when it can't tell: then we just toggle)
  listen("hotkey-lock", (e) => {
    const want = e.payload;
    const now = window.FG_isLocked ? window.FG_isLocked() : false;
    if (window.FG_toggleLock && (typeof want !== "boolean" || want !== now)) window.FG_toggleLock();
    sendHits();
  });
  listen("tray", (e) => {
    const a = String(e.payload || "");
    if (a === "open") window.FG_fold && window.FG_fold(false);
    if (a === "lock") window.FG_toggleLock && window.FG_toggleLock();
    if (a === "reset") { anchor = { ...DEFAULT_ANCHOR }; saveAnchor(); layout(); }
    if (a === "quit") shutdown();
    sendHits();
  });

  // ── start ─────────────────────────────────────────────────────────
  document.addEventListener("DOMContentLoaded", async () => {
    document.body.classList.add("ov");
    const a = await read("own", "anchor");
    if (a && Number.isFinite(a.fx) && Number.isFinite(a.fy)) anchor = a;
    bindDrag();
    setTimeout(() => {
      const p = prefs();
      if (p.ovV !== 2) { p.ovV = 2; p.theme = "hud"; window.FG_applyPrefs && window.FG_applyPrefs(); a2.storage.set("prefs", p); }
    }, 200);
    const gs = await invoke("game_state").catch(() => null);
    if (Array.isArray(gs)) game = { running: !!gs[0], front: !!gs[1] };
    setTimeout(async () => {
      updateShow();
      if (game.running && game.front) maybeRecap();
      const inst = await fromInstaller().catch(() => null);
      const st = await Promise.resolve(A2()?.setupCheck?.() ?? "none").catch(() => "none");
      if (inst && st === "none") {
        card({
          always: true,
          title: "The guide is ready",
          body: ["It appears over AION 2 while you play: a small tip you can drag anywhere. Click it to open the guide.", "It waits in the tray (bottom right of the taskbar) until then."],
          buttons: [["Got it", null, true]],
        });
      }
      const p = prefs();
      kind = await invoke("install_kind").catch(() => "hand");
      if (kind === "store") {
        // Flav-Toolkit starts the guide: no entry of our own (one an older copy left goes too)
        invoke("autostart", { on: false }).catch(() => {});
      } else {
        // start with Windows only when you chose it; earlier versions turned it on by themselves
        if (!p.ovAutostartAsked) { invoke("autostart", { on: false }).catch(() => {}); askAutostart(); }
        else invoke("autostart", { on: !!p.ovAutostart }).catch(() => {}); // keeps the entry pointing at this exe
        if (!p.ovMoveTold) { p.ovMoveTold = true; savePrefsNow(); moveCard(false); }
      }
    }, 300);
    // layout once the guide has rendered, then keep the tip's place as its text changes
    const ro = new ResizeObserver(() => layout());
    ro.observe($(".tip"));
    ro.observe($("#app"));
    setTimeout(layout, 50);
    setTimeout(layout, 600);
  });
})();
