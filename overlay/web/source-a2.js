// Farm Guide Overlay: A2 Tools as the source of game records. Everything the overlay knows about the
// A2 Tools DPS Meter is here (and in src-tauri/src/a2/): when A2 Tools support is dropped, this file
// goes, with its <script> line in assemble.py.
//  - game records come from the plugin's bridge.json (A2 Tools' plugin-data folder), the moment the
//    plugin writes them;
//  - counts and the soul log are read from the plugin's own saved files (it records; we show);
//  - our heartbeat tells the plugin we're on screen (it then hides, or shows a small card);
//  - the installer's step that adds the plugin to A2 Tools is finished here when it couldn't be.
(function () {
  "use strict";
  const OV = window.FG_OV;
  const { invoke, listen, read, fire, card } = OV;
  const prefs = () => OV.prefs();
  const VERSION = () => OV.version();
  const $ = (s) => document.querySelector(s);

  // the plugin's choices the overlay doesn't start from, and its own window setting
  Object.assign(window.FG_HOST.defaults, { keepPlugin: false, pluginView: "hidden" });

  // ── after the installer: it adds the plugin to A2 Tools, and the rest finishes here (see setup.rs) ──
  // A2 Tools was open (its settings can't be changed then) or isn't installed yet: say what to do,
  // and carry on by ourselves once it's done.
  let setupShown = "", waitCard = null;
  async function setupCheck() {
    const s = String(await invoke("plugin_setup").catch(() => "none"));
    const again = (ms) => setTimeout(setupCheck, ms);
    if (s === "waiting") {
      if (setupShown !== "waiting") {
        setupShown = "waiting";
        waitCard = card({
          always: true,
          title: "One last step",
          body: ["Close the A2 Tools DPS Meter for a moment, so the guide can add itself to it.", "Then start the meter again. This happens only once."],
          buttons: [["OK", () => { waitCard = null; }, true]],
        });
      }
      again(3000);
    } else if (s === "nometer") {
      if (!setupShown) {
        setupShown = "nometer";
        card({
          always: true,
          title: "Get the A2 Tools DPS Meter",
          body: ["The guide runs inside the free A2 Tools DPS Meter, which isn't on this PC yet.", "Install it and start it once. The guide finishes setting itself up after that."],
          buttons: [["Open a2tools.app", () => { invoke("open_link", { url: "https://a2tools.app" }).catch(() => {}); }, true], ["Later", null]],
        });
      }
      again(10000);
    } else if (s.startsWith("added")) {
      if (waitCard) { waitCard.close(); waitCard = null; }
      card({
        always: true,
        title: "The guide is in A2 Tools",
        body: ["Start the A2 Tools DPS Meter again: the guide opens with it.", "Then log in to your character. The game sends your pet levels only at login."],
        buttons: s === "added:start" ? [["Start A2 Tools", () => { invoke("start_meter").catch(() => {}); }, true], ["Later", null]] : [["OK", null, true]],
      });
    } else if (s.startsWith("failed:")) {
      card({
        always: true, tone: "warn",
        title: "Couldn't add the guide to A2 Tools",
        body: [s.slice(7), "Add it by hand: in A2 Tools, Settings › Plugins, turn on Plugin developer mode, click Load plugin folder… and pick the farm-guide folder inside the guide's install folder."],
      });
    }
    return s;
  }
  // ── the plugin's records ──────────────────────────────────────────
  // Events are delivered once: by seq within one plugin run; across a plugin restart (new run id,
  // seq may start again) by time. Anything older than our start is already in the saved counts.
  let cursor = null, run = null, lastAt = Date.now() - 1000, lastEventAt = 0;
  function deliver(e) {
    lastAt = Math.max(lastAt, Number(e.at) || 0);
    lastEventAt = Date.now();
    if (e.ev === "character") fire("character", e.data);
    else fire(e.ev, e.data, { character: e.character, at: e.at });
  }
  function onBridge(text) {
    let b;
    try { b = JSON.parse(text); } catch { return; } // caught mid-write: the next change brings it whole
    if (!b || !Number.isFinite(b.seq)) return;
    const list = Array.isArray(b.events) ? b.events : [];
    if (cursor === null) {
      cursor = b.seq;
      run = b.run ?? null;
      if (b.character) fire("character", b.character);
      for (const e of list) if (Number(e.at) > lastAt) deliver(e); // arrived while we were starting
      return;
    }
    if ((b.run ?? null) !== run || b.seq < cursor) {
      run = b.run ?? null;
      for (const e of list) if (Number(e.at) > lastAt) deliver(e);
      cursor = b.seq;
    } else {
      for (const e of list) if (e.seq > cursor) deliver(e);
      cursor = b.seq;
    }
    scheduleResync(1500);
  }
  // the plugin is the record: after it saves, take its counts and log if ours drifted
  let resyncTimer = 0;
  function scheduleResync(ms) {
    clearTimeout(resyncTimer);
    resyncTimer = setTimeout(resync, ms);
  }
  async function resync() {
    if (Date.now() - lastEventAt < 2500) return scheduleResync(2500); // the plugin may not have saved the latest yet
    const k = window.FG_key ? window.FG_key() : null;
    if (!k || !window.FG_adopt) return;
    const [p, l] = await Promise.all([read("plugin", `pets-${k}`), read("plugin", `log-${k}`)]);
    window.FG_adopt(k, p, l);
  }
  async function startBridge() {
    const t = await invoke("read_file", { scope: "plugin", key: "bridge" }).catch(() => null);
    if (t) onBridge(t);
    await listen("bridge", (e) => onBridge(String(e.payload || "")));
    setInterval(resync, 15000);
    setInterval(checkPlugin, 5000);
    checkPlugin();
  }

  // ── is the plugin running in A2 Tools? ──
  async function checkPlugin() {
    // alive if it beat lately, or recorded something lately (Windows slows a background window's timers
    // to about once a minute, but recording runs on game events)
    // and a plugin that hid itself for us is fine: hidden, its timers sleep but game events still
    // wake it to record (it beat at least once after hiding, so it was running then)
    const [b, br, hid] = await Promise.all([read("plugin", "pluginbeat"), read("plugin", "bridge"), read("plugin", "hidbyus")]);
    const fresh = (o) => !!o && Date.now() - Number(o.at) < 75000;
    const hiddenOk = typeof hid === "number" && hid > 0 && !!b && Number(b.at) >= hid - 1000;
    const ok = fresh(b) || fresh(br) || hiddenOk;
    const n = $(".ovnotice");
    if (n) n.hidden = ok;
    document.body.classList.toggle("noplugin", !ok);
  }

  // ── our heartbeat: while we run, the plugin shows a small recording card and stays quiet ──
  function beat() {
    const p = prefs();
    const view = p.pluginView || (p.keepPlugin ? "full" : "hidden");
    invoke("write_file", { scope: "plugin", key: "overlay", value: JSON.stringify({ at: Date.now(), v: VERSION(), pluginView: view, keepPlugin: view === "full" }) }).catch(() => {});
  }
  setInterval(beat, 2000);
  // closing: tell the plugin we're gone, so it shows itself again
  const goodbye = () => invoke("write_file", { scope: "plugin", key: "overlay", value: JSON.stringify({ at: 0, v: VERSION() }) }).catch(() => {});

  document.addEventListener("DOMContentLoaded", () => {
    const n = $(".ovnotice");
    if (n) n.innerHTML = "<b>Nothing is being recorded.</b> Open Farm Guide in A2 Tools (Settings → Plugins → Open). While this overlay runs it tucks itself away and keeps recording.";
    beat();
  });

  OV.sources.a2 = {
    id: "a2",
    label: "A2 Tools",
    // the plugin's records: counts, soul log, which server was played last
    owns: (key) => /^(pets-|log-|last$)/.test(key),
    readOwned: (key) => read("plugin", key),
    // first start: take the plugin's choices, but start as a tip in the Apple theme
    async firstPrefs() {
      const p = await read("plugin", "prefs");
      if (!p) return null;
      for (const k of ["theme", "tip", "folded", "tipPos", "locked", "tipAuto"]) delete p[k];
      return p;
    },
    start: startBridge,
    setupCheck,
    shutdown: goodbye,
    lockHint: "Same keys as A2 Tools, and they lock together. Locked: clicks go through to the game, except the padlock: click it to unlock",
    pluginUpdated: "A2 Tools picks it up when you click Check for updates (Settings › Plugins), or the next time it starts.",
    pluginUpdatedToo: (v) => `The plugin was updated to ${v} too: in A2 Tools, Settings › Plugins › Check for updates.`,
    settings({ row, seg }) {
      row("A2 Tools window", "While the overlay runs. Hidden: out of the way, still recording. Card: a small recording card. Full: the whole guide", seg("pluginView", [["hidden", "Hidden"], ["card", "Card"], ["full", "Full"]], beat));
    },
  };
})();
