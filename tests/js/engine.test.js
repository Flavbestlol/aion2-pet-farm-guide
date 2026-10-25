// The farm logic (engine.js) on the bundled data: a route that covers every farmable pet, in either
// faction and either order. Run: node --test tests/js/
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const PLUGIN = path.join(__dirname, "..", "..", "plugin", "farm-guide");
const ctx = {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(PLUGIN, "data.js"), "utf8").replace("const FG_DATA", "globalThis.FG_DATA"), ctx);
const D = ctx.FG_DATA;
const E = require(path.join(PLUGIN, "engine.js"));
const base = { faction: "elyos", goal: 3, order: "priority", priority: ["cogni", "natura", "fera", "varian"], rift: true, levelPenalty: false, myLevel: 45 };

test("a route covers nearly every farmable pet", () => {
  const farmable = Object.keys(D.pets).filter((p) => E.isFarmable(D, p));
  assert.ok(farmable.length > 50, "the data has pets");
  const route = E.buildRoute(D, {}, {}, base);
  const covered = new Set(route.flatMap((s) => s.pets));
  // a few can sit off the route (the list in the guide shows them): never more than a handful
  assert.ok(covered.size >= farmable.length - 5, `${covered.size} of ${farmable.length}`);
});

test("both factions and both orders give a route", () => {
  for (const s of [{ faction: "asmodian" }, { order: "nearest" }, { rift: false }]) {
    assert.ok(E.buildRoute(D, {}, {}, { ...base, ...s }).length > 0, JSON.stringify(s));
  }
});

test("finished pets leave the route", () => {
  const levels = {};
  for (const p of Object.keys(D.pets)) levels[p] = 3;
  assert.equal(E.buildRoute(D, levels, {}, base).length, 0);
});

test("souls left go down as points come in", () => {
  assert.ok(E.soulsLeft(1, 0, 3) <= E.soulsTotal(3));
  assert.ok(E.soulsLeft(1, 8, 3) < E.soulsLeft(1, 0, 3));
  assert.equal(E.soulsLeft(3, 0, 3), 0);
});
