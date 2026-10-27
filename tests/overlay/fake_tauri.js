// Stand-in for the overlay's Rust side in tests: files per scope in memory, events by hand.
// A test sets window.__FILES = { plugin: {...}, own: {...} } before the page loads.
(() => {
  const start = window.__FILES || {};
  const files = { plugin: { ...(start.plugin || {}) }, own: { ...(start.own || {}) } };
  const times = { plugin: {}, own: {} };
  const listeners = {};
  window.__calls = [];
  window.__TAURI__ = {
    core: {
      invoke: async (cmd, args) => {
        window.__calls.push([cmd, args]);
        if (cmd === "read_file") return files[args.scope]?.[args.key] ?? null;
        if (cmd === "read_stamped") {
          const t = files[args.scope]?.[args.key];
          return t == null ? null : [t, times[args.scope][args.key] || 1];
        }
        if (cmd === "write_file") {
          if (args.scope === "plugin" && args.key !== "overlay") throw "only overlay.json may be written in the plugin's folder";
          files[args.scope][args.key] = args.value;
          times[args.scope][args.key] = Date.now();
          return null;
        }
        if (cmd === "autostart") return false;
        if (cmd === "install_kind") return window.__kind || "hand";
        if (cmd === "addon_version") return window.__version || "0.0.0-test";
        if (cmd === "plugin_setup") return "none";
        if (cmd === "game_state") return window.__game || [true, true];
        if (cmd === "source_state") return window.__source || null;
        if (cmd === "quit") { window.__quit = true; return null; }
        return null;
      },
    },
    event: { listen: async (ev, fn) => { (listeners[ev] ||= []).push(fn); return () => {}; } },
  };
  window.__files = files;
  window.__times = times;
  window.__emitHost = (ev, payload) => { for (const fn of listeners[ev] || []) fn({ payload }); };
  // A2 Tools' plugin: one record into bridge.json, announced as the Rust watcher does
  window.__pluginEvent = (ev, data, at = Date.now()) => {
    const b = JSON.parse(files.plugin.bridge || '{"v":2,"run":1,"seq":0,"events":[]}');
    b.seq += 1;
    b.events.push({ seq: b.seq, ev, data, character: b.character, at });
    files.plugin.bridge = JSON.stringify(b);
    window.__emitHost("bridge", files.plugin.bridge);
  };
})();
