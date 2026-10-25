// Farm Guide Overlay: the rules for the player's records, whichever source they come from. Pure (no
// page, no files), so tests/js/records.test.js runs them as they are.
//  - The overlay keeps its own copy of the counts and the soul log; A2 Tools' plugin keeps one too.
//    Reading takes the newer counts and both logs, so moving between A2 Tools and Flav-Toolkit
//    loses nothing.
//  - Flav-Toolkit hands a late overlay the last pet list again: a list older than what we already
//    counted is not applied (it would undo the souls counted since).
(function (root) {
  "use strict";

  // when a copy of the counts was last right: the pet list's time, then the last soul's
  const stamp = (p) => [Number(p && p.syncedAt) || 0, Number(p && p.lastGain && p.lastGain.at) || 0];
  const later = (a, b) => a[0] !== b[0] ? a[0] > b[0] : a[1] > b[1];

  /** The newer of two copies of the counts (`prefer` wins a tie). */
  function newerPets(a, b, prefer) {
    const ok = (p) => !!p && typeof p === "object" && !!p.levels;
    if (!ok(a)) return ok(b) ? b : null;
    if (!ok(b)) return a;
    const sa = stamp(a), sb = stamp(b);
    if (later(sa, sb)) return a;
    if (later(sb, sa)) return b;
    return prefer === "b" ? b : a;
  }

  // One pickup once. A2 Tools and Flav-Toolkit each stamp a pickup with their own capture time, so
  // the same pickup in both logs is the same pet and amount a moment apart: matched one to one, so
  // five quick kills in both logs stay five, not ten and not one.
  const NEAR_MS = 1500;
  function union(x, y, keep) {
    const ok = (e) => Array.isArray(e) && e.length >= 3 && Number.isFinite(Number(e[0]));
    const a = (Array.isArray(x) ? x : []).filter(ok), out = [...a];
    const free = new Map(); // pet|amount → times in a not matched yet
    for (const e of a) { const k = `${e[1]}|${e[2]}`; (free.get(k) || free.set(k, []).get(k)).push(Number(e[0])); }
    for (const e of (Array.isArray(y) ? y : []).filter(ok)) {
      const ts = free.get(`${e[1]}|${e[2]}`) || [];
      let best = -1;
      for (let i = 0; i < ts.length; i++) if (Math.abs(ts[i] - Number(e[0])) <= NEAR_MS && (best < 0 || Math.abs(ts[i] - Number(e[0])) < Math.abs(ts[best] - Number(e[0])))) best = i;
      if (best >= 0) ts.splice(best, 1);
      else out.push(e);
    }
    return out.sort((p, q) => p[0] - q[0]).slice(-keep);
  }

  /** Both soul logs in one, each pickup once, oldest first (as long as the guide keeps them). */
  function mergeLogs(a, b) {
    const ok = (l) => !!l && typeof l === "object";
    if (!ok(a)) return ok(b) ? b : null;
    if (!ok(b)) return a;
    return { ...a, ...b, log: union(a.log, b.log, 5000), levelLog: union(a.levelLog, b.levelLog, 1000) };
  }

  /** A pet list that is not newer than the counts we have (Flav-Toolkit's kept one, again). */
  function staleList(at, saved) {
    if (!saved || !saved.levels) return false;
    const [synced, gain] = stamp(saved);
    return Number(at) > 0 && Number(at) <= Math.max(synced, gain);
  }

  /** The server from `my_server`: A2 Tools keeps only 1000–2999 (0 = not known). */
  const validServer = (s) => (Number.isInteger(s) && s >= 1000 && s <= 2999 ? s : 0);

  /** Read just now (a login), not handed again by Flav-Toolkit after a reconnect. */
  const isLive = (at, now = Date.now()) => Number(at) > 0 && now - Number(at) < 10000;

  const api = { newerPets, mergeLogs, staleList, validServer, isLive };
  root.FG_RECORDS = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
