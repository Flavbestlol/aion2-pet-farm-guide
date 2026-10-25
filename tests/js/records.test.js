// The overlay's record rules (overlay/web/records.js): which copy of the counts wins, how two soul
// logs become one, and which pet list from Flav-Toolkit is the same one again. node --test tests/js/*.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../../overlay/web/records.js");

const T = 1_760_000_000_000;

test("the newer counts win: the pet list's time first, then the last soul", () => {
  const a = { levels: { 1: 1 }, points: {}, syncedAt: T };
  const b = { levels: { 1: 2 }, points: {}, syncedAt: T + 1 };
  assert.equal(R.newerPets(a, b), b);
  const c = { ...a, lastGain: { pet: 1, at: T + 50 } };
  assert.equal(R.newerPets(a, c), c);
  assert.equal(R.newerPets(a, { ...a }, "b").syncedAt, T);
  assert.equal(R.newerPets(null, a), a);
  assert.equal(R.newerPets({ junk: 1 }, null), null);
});

test("two soul logs: each pickup once, even with each program's own capture time", () => {
  const a2 = { log: [[T, 1015, 1, "A", "L"], [T + 10, 1120, 1, "A", "L"], [T + 5000, 1015, 1, "A", "L"]], levelLog: [] };
  const core = { log: [[T + 3, 1015, 1, "A", "L"], [T + 12, 1120, 1, "A", "L"], [T + 9000, 1015, 1, "A", "L"]], levelLog: [] };
  const m = R.mergeLogs(a2, core);
  assert.deepEqual(m.log.map((e) => e[0]), [T, T + 10, T + 5000, T + 9000]);
});

test("five quick pickups of one pet in both logs stay five", () => {
  const burst = (d) => ({ log: [0, 100, 200, 300, 400].map((t) => [T + t + d, 1015, 1, "A", "L"]), levelLog: [] });
  assert.equal(R.mergeLogs(burst(0), burst(7)).log.length, 5);
  assert.equal(R.mergeLogs(burst(0), burst(0)).log.length, 5);
});

test("one log only, or a log the other never saw", () => {
  const a = { log: [[T, 1, 1]], levelLog: [[T, 1, 2]] };
  assert.equal(R.mergeLogs(a, null), a);
  assert.equal(R.mergeLogs(null, a), a);
  assert.equal(R.mergeLogs(a, { log: [[T + 60000, 1, 1]] }).log.length, 2);
});

test("a pet list no newer than the counts is the same one again", () => {
  const saved = { levels: {}, points: {}, syncedAt: T, lastGain: { pet: 1, at: T + 60000 } };
  assert.equal(R.staleList(T, saved), true); // Flav-Toolkit's kept list after a reconnect
  assert.equal(R.staleList(T + 30000, saved), true); // older than a soul counted since
  assert.equal(R.staleList(T + 120000, saved), false); // a new login
  assert.equal(R.staleList(T, null), false);
});

test("servers: only what A2 Tools keeps (1000–2999)", () => {
  assert.equal(R.validServer(1012), 1012);
  for (const s of [0, 999, 3000, 11304, -1, "1012", null]) assert.equal(R.validServer(s), 0);
});
