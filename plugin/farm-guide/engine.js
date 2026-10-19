// Farm Guide engine: where to farm, in what order, and what it pays.
// Pure functions over FG_DATA and the player's pet counts, so it also runs in Node for tests.
(function (root) {
  "use strict";

  // Souls a pet needs to go from level N to N + 1 (same as the game; points reset at each level).
  const NEEDED = [5, 25, 75];
  const MAX_LEVEL = 3;
  const GENERA = ["cogni", "natura", "fera", "varian"];
  const GENUS_NAME = { cogni: "Cogni", natura: "Natura", fera: "Fera", varian: "Varian", special: "Special" };
  const GENUS_COLOR = { cogni: "#4fa3ff", natura: "#5fe08a", fera: "#ff5a5a", varian: "#ff6fc8", special: "#b07cff" };
  // A pet's "owned effect" at its insight level (wikily.gg genus pages, matches MetaBot's type bonus table).
  const OWNED_EFFECT = {
    cogni: [{}, { HP: 10 }, { HP: 20, "Critical Hit": 1 }, { HP: 30, "Critical Hit": 2, Might: 1 }],
    fera: [{}, { "Mount Ground Speed": 1 }, { "Mount Ground Speed": 2, "Accuracy Bonus": 1 }, { "Mount Ground Speed": 3, "Accuracy Bonus": 2, Dexterity: 1 }],
    natura: [{}, { Stamina: 3 }, { Stamina: 6, "Crit Hit Resist": 1 }, { Stamina: 9, "Crit Hit Resist": 2, Precision: 1 }],
    varian: [{}, { "Sprint Cost Reduction %": 0.1 }, { "Sprint Cost Reduction %": 0.2, "Evasion Bonus": 1 }, { "Sprint Cost Reduction %": 0.3, "Evasion Bonus": 2, Constitution: 1 }],
    special: [{}, {}, {}, {}],
  };
  // Genus insight EXP each pet level grants, and the EXP each genus level needs.
  const INSIGHT_EXP = [0, 500, 250, 250];
  const GENUS_LEVEL_EXP = [500, 1500, 3000, 5000, 10000, 20000, 40000, 70000, 100000];

  const STOP_R = 80; // metres, a route stop's circle
  const SPOT_R = 60; // metres, a single pet's best spot
  const CELL = 100;

  // ── pets and counts ───────────────────────────────────────────
  function soulsLeft(level, points, goal) {
    let left = 0;
    for (let l = level; l < goal; l++) left += NEEDED[l];
    return Math.max(0, left - (level < goal ? points : 0));
  }
  function soulsTotal(goal) {
    return soulsLeft(0, 0, goal);
  }
  function effectGain(genus, toLevel) {
    const eff = OWNED_EFFECT[genus] || OWNED_EFFECT.special;
    const now = eff[toLevel] || {}, before = eff[toLevel - 1] || {};
    const out = [];
    for (const [k, v] of Object.entries(now)) {
      const d = +(v - (before[k] || 0)).toFixed(2);
      if (d) out.push([k, d]);
    }
    return out;
  }
  function totalEffects(D, levels) {
    const sum = {}, byGenus = {};
    for (const [id, p] of Object.entries(D.pets)) {
      const lv = Math.min(MAX_LEVEL, levels[id] || 0);
      if (!lv) continue;
      const g = p.g;
      byGenus[g] = byGenus[g] || { pets: 0, exp: 0, levels: [0, 0, 0, 0], stats: {} };
      const G = byGenus[g];
      G.pets++;
      G.levels[lv]++;
      for (let l = 1; l <= lv; l++) G.exp += INSIGHT_EXP[l];
      for (const [k, v] of Object.entries(OWNED_EFFECT[g]?.[lv] || {})) {
        G.stats[k] = +((G.stats[k] || 0) + v).toFixed(2);
        sum[k] = +((sum[k] || 0) + v).toFixed(2);
      }
    }
    for (const G of Object.values(byGenus)) {
      let lv = 1, exp = G.exp;
      while (lv < 10 && exp >= GENUS_LEVEL_EXP[lv - 1]) exp -= GENUS_LEVEL_EXP[lv - 1], lv++;
      G.level = lv;
      G.expInLevel = exp;
      G.expToNext = lv < 10 ? GENUS_LEVEL_EXP[lv - 1] : 0;
    }
    return { sum, byGenus };
  }

  // ── geometry ─────────────────────────────────────────────────
  function pointInPoly(x, y, f) {
    let inside = false;
    for (let i = 0, j = f.length - 2; i < f.length; j = i, i += 2) {
      const xi = f[i], yi = f[i + 1], xj = f[j], yj = f[j + 1];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function polyArea(f) {
    let a = 0;
    for (let i = 0, j = f.length - 2; i < f.length; j = i, i += 2) a += (f[j] + f[i]) * (f[j + 1] - f[i + 1]);
    return Math.abs(a / 2);
  }
  // The smallest zone containing a point: the sub-area's name.
  const zoneCache = new Map();
  function zoneAt(D, mapKey, x, y) {
    const key = `${mapKey}:${Math.round(x / 10)}:${Math.round(y / 10)}`;
    if (zoneCache.has(key)) return zoneCache.get(key);
    let best = null, bestA = Infinity;
    for (const z of D.maps[mapKey].zones) {
      if (!pointInPoly(x, y, z[3])) continue;
      const a = z._a || (z._a = polyArea(z[3]));
      if (a < bestA) (bestA = a), (best = z);
    }
    const name = best ? best[0] : D.maps[mapKey].name;
    zoneCache.set(key, name);
    return name;
  }
  const DIRS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
  // Map north is up: y grows southwards.
  function bearing(fx, fy, tx, ty) {
    return (Math.atan2(tx - fx, -(ty - fy)) * 180) / Math.PI;
  }
  function dirName(deg) {
    return DIRS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
  }

  // ── which maps a pet can be farmed on ─────────────────────────
  function sideOf(settings) {
    return settings.faction === "asmodian" ? "asmodian" : "elyos";
  }
  function ownMap(settings) {
    return sideOf(settings) === "asmodian" ? "D" : "L";
  }
  function otherMap(settings) {
    return sideOf(settings) === "asmodian" ? "L" : "D";
  }
  function mapRank(mapKey, settings) {
    return mapKey === ownMap(settings) ? 0 : mapKey === "A" ? 1 : 2;
  }
  // The maps each pet may be farmed on: own map and Abyss; the other side's
  // map (through a Rift) only when the pet has no spot on those, and Rift trips are on.
  function allowedMaps(D, pid, settings) {
    const pet = D.pets[pid];
    const maps = new Set(pet.d.map((n) => D.mobs[n].map));
    const own = ownMap(settings), other = otherMap(settings);
    // the Rift route: every unfinished pet that spawns on the other side's map, nothing else
    if (settings.riftOnly) return maps.has(other) ? new Set([other]) : new Set();
    const ok = new Set();
    if (maps.has(own)) ok.add(own);
    if (maps.has("A")) ok.add("A");
    if (!ok.size && maps.has(other) && settings.rift) ok.add(other);
    // the Abyss opens at Lv 45: below that, a pet with another source goes there instead
    const ab = D.community && D.community.abyss;
    if (ab && !settings.anyLevel && settings.myLevel && settings.myLevel < ab.minLevel && ok.has("A")) {
      ok.delete("A");
      if (!ok.size && maps.has(other) && settings.rift) ok.add(other);
    }
    return ok;
  }
  // a pet whose souls you can only farm on the other side's map (no spot at home, none in the Abyss)
  function riftOnlyPet(D, pid, settings) {
    const maps = new Set(D.pets[pid].d.map((n) => D.mobs[n].map));
    return maps.has(otherMap(settings)) && !maps.has(ownMap(settings)) && !maps.has("A");
  }
  function isFarmable(D, pid) {
    const p = D.pets[pid];
    return p && p.g !== "special" && !p.unrel && p.d.length > 0;
  }

  // Monsters far below me are slow to find in the open world: optional penalty.
  // Elites take longer to kill, so they count for half; continent sources a community check could not
  // confirm count for less, so a sure source wins when there is one.
  function mobWeight(mob, settings) {
    let w = 1;
    if (settings.levelPenalty && settings.myLevel && mob.lv < settings.myLevel - 10) w *= 0.15;
    if (mob.r === 1) w *= 0.5;
    if (mob.held) w *= 0.4;
    return w;
  }
  // In the Abyss, farm the area next to your own side's base; the one by the other base is a fallback.
  function placeWeight(D, map, x, y, settings) {
    if (map !== "A") return 1;
    let own = Infinity, foe = Infinity;
    const side = sideOf(settings);
    for (const k of D.maps.A.kib) {
      if (!k[4]) continue;
      const d = Math.hypot(k[0] - x, k[1] - y);
      if (k[4] === side) own = Math.min(own, d); else foe = Math.min(foe, d);
    }
    return foe < own ? 0.5 : 1;
  }

  // ── spatial index of spawn points ─────────────────────────────
  // spawns[map] = [{x,y,c,npc,pet,wt}], grid[map] = Map("cx:cy" → [indices])
  // Field bosses (rank 2) are a separate attempt, never a stop: the route leaves them out (bosses: true keeps them).
  function buildIndex(D, pids, settings, bosses = false) {
    const spawns = {}, grid = {};
    for (const pid of pids) {
      const maps = allowedMaps(D, pid, settings);
      for (const npc of D.pets[pid].d) {
        const mob = D.mobs[npc];
        if (!maps.has(mob.map)) continue;
        if (mob.r === 2 && !bosses) continue;
        const wt = mobWeight(mob, settings);
        const list = (spawns[mob.map] = spawns[mob.map] || []);
        const g = (grid[mob.map] = grid[mob.map] || new Map());
        for (let i = 0; i < mob.pts.length; i += 3) {
          const s = { x: mob.pts[i], y: mob.pts[i + 1], c: mob.pts[i + 2], npc, pet: pid, wt: wt * placeWeight(D, mob.map, mob.pts[i], mob.pts[i + 1], settings) };
          const k = `${Math.floor(s.x / CELL)}:${Math.floor(s.y / CELL)}`;
          if (!g.has(k)) g.set(k, []);
          g.get(k).push(list.length);
          list.push(s);
        }
      }
    }
    return { spawns, grid };
  }
  function near(index, map, x, y, r, fn) {
    const list = index.spawns[map], g = index.grid[map];
    if (!list) return;
    const r2 = r * r;
    const c0 = Math.floor((x - r) / CELL), c1 = Math.floor((x + r) / CELL);
    const d0 = Math.floor((y - r) / CELL), d1 = Math.floor((y + r) / CELL);
    for (let cx = c0; cx <= c1; cx++)
      for (let cy = d0; cy <= d1; cy++) {
        const cell = g.get(`${cx}:${cy}`);
        if (!cell) continue;
        for (const i of cell) {
          const s = list[i];
          const dx = s.x - x, dy = s.y - y;
          if (dx * dx + dy * dy <= r2) fn(s);
        }
      }
  }

  // ── best spots for one pet ────────────────────────────────────
  // Greedy circles that hold the most of the pet's spawns, refined to their weighted centre;
  // up to 3 per map, own map first, then Abyss, then the other side (Rift).
  function bestSpots(D, pid, settings, perMap = 3) {
    // asked for by name: every source counts (bosses, the other side, the Abyss at any level)
    const all = { ...settings, rift: true, anyLevel: true };
    const index = buildIndex(D, [pid], all, true);
    const spots = [];
    for (const map of Object.keys(index.spawns)) {
      const used = new Set();
      for (let k = 0; k < perMap; k++) {
        let best = null;
        for (const s of index.spawns[map]) {
          if (used.has(s)) continue;
          let sum = 0;
          near(index, map, s.x, s.y, SPOT_R, (t) => { if (!used.has(t)) sum += t.c * t.wt; });
          if (!best || sum > best.sum) best = { x: s.x, y: s.y, sum };
        }
        if (!best || best.sum <= 0) break;
        // refine: weighted centre of what the circle holds, then recount there
        let wx = 0, wy = 0, w = 0;
        near(index, map, best.x, best.y, SPOT_R, (t) => { if (!used.has(t)) (wx += t.x * t.c), (wy += t.y * t.c), (w += t.c); });
        const cx = wx / w, cy = wy / w;
        let count = 0;
        const npcs = {};
        near(index, map, cx, cy, SPOT_R, (t) => {
          if (used.has(t)) return;
          count += t.c;
          npcs[t.npc] = (npcs[t.npc] || 0) + t.c;
          used.add(t);
        });
        const named = Object.keys(npcs).every((n) => D.mobs[n].r > 0);
        spots.push({ map, x: Math.round(cx), y: Math.round(cy), r: SPOT_R, count, npcs, named, pets: [pid],
          rift: map === otherMap(settings) });
        if (k > 0 && count < (perMap > 3 ? 1 : 2)) break;
      }
    }
    spots.sort((a, b) => a.named - b.named || mapRank(a.map, settings) - mapRank(b.map, settings) || b.count - a.count);
    return spots;
  }

  // ── the route over every unfinished pet ───────────────────────
  // Candidates are spawn points snapped to a 20 m lattice; a pet is "covered" at a stop when it
  // has at least max(0.5 × its best density, min(best, 2)) spawns there. Greedy by priority buckets
  // (or nearest = most pets per stop), with bonus pets scoring 0.35. Stops are ordered own map →
  // Abyss → Rift, nearest-neighbour within a map.
  function buildRoute(D, levels, points, settings) {
    const goal = settings.goal || 3;
    const todo = Object.keys(D.pets).filter((pid) => isFarmable(D, pid) && (levels[pid] || 0) < goal && allowedMaps(D, pid, settings).size);
    const index = buildIndex(D, todo, settings);
    const cands = [];
    for (const map of Object.keys(index.spawns)) {
      const seen = new Set();
      for (const s of index.spawns[map]) {
        const x = Math.round(s.x / 20) * 20, y = Math.round(s.y / 20) * 20;
        const k = `${x}:${y}`;
        if (seen.has(k)) continue;
        seen.add(k);
        const dens = {};
        near(index, map, x, y, STOP_R, (t) => { dens[t.pet] = (dens[t.pet] || 0) + t.c * t.wt; });
        cands.push({ map, x, y, dens });
      }
    }
    const best = {};
    for (const c of cands) for (const [p, v] of Object.entries(c.dens)) if (!best[p] || v > best[p]) best[p] = v;
    const covers = (c, p) => (c.dens[p] || 0) >= Math.max(0.5 * best[p], Math.min(best[p], 2));
    for (const c of cands) c.cov = Object.keys(c.dens).filter((p) => covers(c, p));

    const order = settings.order === "nearest" ? null : settings.priority || GENERA;
    const left = new Set(todo.filter((p) => best[p]));
    const stops = [];
    while (left.size) {
      let bucket = null;
      if (order) for (const g of order) if ([...left].some((p) => D.pets[p].g === g)) { bucket = g; break; }
      let pick = null, pickScore = 0, pickDens = 0;
      for (const c of cands) {
        let score = 0, dens = 0;
        for (const p of c.cov) {
          if (!left.has(p)) continue;
          score += !bucket || D.pets[p].g === bucket ? 1 : 0.35;
          dens += c.dens[p];
        }
        if (bucket && !c.cov.some((p) => left.has(p) && D.pets[p].g === bucket)) continue;
        if (score > pickScore || (score === pickScore && dens > pickDens)) (pick = c), (pickScore = score), (pickDens = dens);
      }
      if (!pick) break;
      const pets = pick.cov.filter((p) => left.has(p));
      for (const p of pets) left.delete(p);
      let bk = order ? order.indexOf(bucket) : 0;
      // the Rift route: stops with pets you can only get over there come first (the Rift is short)
      if (settings.riftOnly && !pets.some((p) => riftOnlyPet(D, p, settings))) bk += 100;
      stops.push({ map: pick.map, x: pick.x, y: pick.y, r: STOP_R, pets, dens: pick.dens, bucket: bk });
    }
    // bonus pets: unfinished pets that also drop at the stop, assigned to another stop
    for (const s of stops) s.bonus = Object.keys(s.dens).filter((p) => !s.pets.includes(p) && covers(s, p));
    return orderStops(stops, settings);
  }
  // Priority mode keeps the buckets in order (Cogni stops first...); within a bucket, own map →
  // Abyss → Rift, nearest-neighbour inside a map.
  function orderStops(stops, settings) {
    const out = [];
    const groups = [];
    for (const s of stops) {
      const g = `${s.bucket}:${mapRank(s.map, settings)}`;
      if (!groups.includes(g)) groups.push(g);
    }
    groups.sort((a, b) => { const [ab, am] = a.split(":").map(Number), [bb, bm] = b.split(":").map(Number); return ab - bb || am - bm; });
    for (const g of groups) {
      const rest = stops.filter((s) => `${s.bucket}:${mapRank(s.map, settings)}` === g);
      // start from the stop with the most pets, then always the nearest one
      rest.sort((a, b) => b.pets.length - a.pets.length);
      let cur = rest.shift();
      while (cur) {
        out.push(cur);
        let bi = -1, bd = Infinity;
        rest.forEach((s, i) => { const d = Math.hypot(s.x - cur.x, s.y - cur.y); if (d < bd) (bd = d), (bi = i); });
        cur = bi >= 0 ? rest.splice(bi, 1)[0] : null;
      }
    }
    for (const s of out) {
      s.key = `${s.map}:${s.x}:${s.y}`;
      s.rift = mapRank(s.map, settings) === 2;
    }
    return out;
  }

  // ── a stop in detail ──────────────────────────────────────────
  // What spawns inside the circle, per pet and per monster.
  function stopContents(D, stop, settings) {
    const per = {};
    const wanted = new Set([...stop.pets, ...(stop.bonus || [])]);
    for (const pid of wanted) {
      for (const npc of D.pets[pid].d) {
        const mob = D.mobs[npc];
        if (mob.map !== stop.map) continue;
        let n = 0, wx = 0, wy = 0;
        for (let i = 0; i < mob.pts.length; i += 3) {
          const dx = mob.pts[i] - stop.x, dy = mob.pts[i + 1] - stop.y;
          if (dx * dx + dy * dy <= stop.r * stop.r) (n += mob.pts[i + 2]), (wx += mob.pts[i] * mob.pts[i + 2]), (wy += mob.pts[i + 1] * mob.pts[i + 2]);
        }
        if (!n) continue;
        const e = (per[pid] = per[pid] || { pet: pid, spawns: 0, mobs: [], x: 0, y: 0 });
        e.spawns += n;
        e.x += wx;
        e.y += wy;
        e.mobs.push({ npc, n, v: n * mobWeight(mob, settings) });
      }
    }
    for (const e of Object.values(per)) {
      e.x /= e.spawns;
      e.y /= e.spawns;
      e.mobs.sort((a, b) => b.v - a.v || b.n - a.n); // the one worth killing first: most spawns, elites and unsure sources discounted
    }
    return per;
  }
  // Expected kills to finish a pet here: souls left ÷ (drop chance × souls per kill).
  function expectedKills(D, pid, left, npc) {
    const mob = D.mobs[npc];
    const per = ((mob.pct || 100) / 100) * (mob.w || 1);
    return Math.ceil(left / per);
  }
  // The pets of a stop in farming order: fewest expected kills first (closest to done),
  // then the denser one. Bonus pets go last.
  function stopQueue(D, stop, contents, levels, points, settings) {
    const goal = settings.goal || 3;
    const row = (pid, bonus) => {
      const c = contents[pid];
      const left = soulsLeft(levels[pid] || 0, points[pid] || 0, goal);
      const top = c ? c.mobs[0] : null;
      return { pid, bonus, left, spawns: c ? c.spawns : 0, top: top ? top.npc : D.pets[pid].d[0],
        kills: top ? expectedKills(D, pid, left, top.npc) : Infinity, x: c?.x, y: c?.y };
    };
    const main = stop.pets.map((p) => row(p, false)).filter((r) => r.left > 0);
    const bonus = (stop.bonus || []).map((p) => row(p, true)).filter((r) => r.left > 0 && r.spawns > 0);
    const cmp = (a, b) => a.kills - b.kills || b.spawns - a.spawns;
    main.sort(cmp);
    bonus.sort(cmp);
    return main.concat(bonus);
  }
  // ── the farming loop at a stop ────────────────────────────────
  // A patrol route through the actual spawn points, not through the middle of the circle:
  //  1. every spawn of a pet still to farm here is worth its souls per kill (elites and unsure sources
  //     discounted, like the route);
  //  2. waypoints are picked greedily: each one gathers what spawns within pull range of it (PULL m),
  //     and joins the loop only if what it gathers is worth the detour (SOUL_M metres of walking per
  //     soul); every pet that brought you here gets at least its best waypoint, wherever it is;
  //  3. the waypoints are put in the shortest closed order (cheapest insertion, then 2-opt), starting
  //     at the one nearest where you come in, going first towards the richer side.
  // So a lone spawn far off is skipped, a dense edge pulls the loop out to the edge, and one monster
  // gets a loop that strings its own spawn spots together.
  // The farming area is wider than the stop's circle (AREA m): spawns just outside it are still worth
  // a detour if they're dense. Monsters the database only knows as a camp (one point with a count)
  // are an area of about campR(count) metres: the loop reaches its edge, and a lone camp gets a ring.
  // Pets nearly done (under 10 souls left) count half, finished ones not at all, so the loop reshapes
  // as pets finish.
  const PULL = 18, MAX_WP = 30, WP_GAP = 20, AREA = 200, EXACT = 12;
  // coverage: stop once COVER of the area's souls are on the loop; a spot whose detour is over OUTLIER
  // times the typical one so far is a stray and stays off
  const COVER = 0.9, OUTLIER = 3;
  const campR = (c) => Math.max(12, Math.min(45, 8 + 4 * Math.sqrt(c)));
  function farmLoop(D, stop, pids, settings, entry, main, left) {
    const isMain = (pid) => !main || main.includes(String(pid));
    const pts = [];
    const r2 = Math.max(stop.r, AREA) ** 2;
    for (const pid of pids) {
      const need = !left || left[pid] === undefined ? 1 : left[pid] <= 0 ? 0 : left[pid] < 10 ? 0.5 : 1;
      if (!need) continue;
      for (const npc of D.pets[pid].d) {
        const mob = D.mobs[npc];
        if (mob.map !== stop.map || mob.r === 2) continue;
        const per = ((mob.pct || 100) / 100) * (mob.w || 1) * mobWeight(mob, settings) * need;
        for (let i = 0; i < mob.pts.length; i += 3) {
          const dx = mob.pts[i] - stop.x, dy = mob.pts[i + 1] - stop.y;
          if (dx * dx + dy * dy > r2) continue;
          const c = mob.pts[i + 2];
          pts.push({ x: mob.pts[i], y: mob.pts[i + 1], v: c * per, pid: String(pid), npc, camp: c >= 3 ? campR(c) : 0 });
        }
      }
    }
    if (!pts.length) return null;
    // within pull: a camp counts once you reach its edge
    const near = (x, y) => pts.filter((p) => Math.hypot(p.x - x, p.y - y) <= PULL + p.camp * 0.6);
    // candidate waypoints: each spawn spot, and the centre of what's around it
    const cands = [];
    for (const p of pts) {
      const g = near(p.x, p.y), v = g.reduce((a, q) => a + q.v, 0);
      cands.push({ x: p.x, y: p.y });
      cands.push({ x: g.reduce((a, q) => a + q.x * q.v, 0) / v, y: g.reduce((a, q) => a + q.y * q.v, 0) / v });
    }
    for (const c of cands) c.g = near(c.x, c.y);
    const covered = new Set();
    const gain = (c, only) => c.g.reduce((a, q) => a + (covered.has(q) || (only && q.pid !== only) ? 0 : q.v), 0);
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const tour = [];
    const insertCost = (c) => {
      if (!tour.length) return 0;
      if (tour.length === 1) return 2 * dist(tour[0], c);
      let best = Infinity, at = 0;
      for (let i = 0; i < tour.length; i++) {
        const a = tour[i], b = tour[(i + 1) % tour.length];
        const d = dist(a, c) + dist(c, b) - dist(a, b);
        if (d < best) (best = d), (at = i + 1);
      }
      c._at = at;
      return best;
    };
    const take = (c) => {
      insertCost(c);
      if (tour.length < 2) tour.push(c); else tour.splice(c._at, 0, c);
      for (const q of c.g) covered.add(q);
    };
    const mains = [...new Set(pts.filter((p) => isMain(p.pid)).map((p) => p.pid))];
    const total = pts.reduce((a, p) => a + p.v, 0);
    let V = 0;
    const costs = [];
    const median = () => { const c = costs.slice().sort((a, b) => a - b); return c.length ? c[c.length >> 1] : 0; };
    while (tour.length < MAX_WP) {
      // a pet that brought you here and isn't on the loop yet: its best waypoint first
      const missing = mains.find((pid) => !pts.some((p) => p.pid === pid && covered.has(p)));
      if (!missing && V >= total * COVER) break;
      let best = null, bs = -Infinity, bv = 0, bc = 0;
      for (const c of cands) {
        // waypoints stay apart: two within a pull of each other are one stop (unless a pet needs it)
        if (!missing && tour.some((t) => dist(t, c) < WP_GAP)) continue;
        const v = missing ? gain(c, missing) : gain(c);
        if (v <= 0) continue;
        const cost = insertCost(c);
        if (!missing && costs.length >= 2 && cost > Math.max(60, OUTLIER * median())) continue; // a stray
        // densest first: souls per metre of extra walking (the first spot: the richest)
        const sc = missing ? v * 1e6 - cost : tour.length ? gain(c) / Math.max(cost, 10) : gain(c);
        if (sc > bs) (bs = sc), (best = c), (bv = gain(c)), (bc = cost);
      }
      if (!best) break;
      take(best);
      V += bv;
      if (tour.length > 1) costs.push(bc);
    }
    if (!tour.length) return null;
    // the shortest closed order, exactly (Held-Karp: at most 10 waypoints, ~100k steps)
    const n = tour.length;
    if (n > 3 && n <= EXACT) {
      const N = 1 << n, dp = new Float64Array(N * n).fill(Infinity), par = new Int8Array(N * n).fill(-1);
      dp[1 * n + 0] = 0;
      for (let m = 1; m < N; m += 2)
        for (let j = 0; j < n; j++) {
          const cur = dp[m * n + j];
          if (cur === Infinity || !(m & (1 << j))) continue;
          for (let k = 1; k < n; k++) {
            if (m & (1 << k)) continue;
            const nm = m | (1 << k), v = cur + dist(tour[j], tour[k]);
            if (v < dp[nm * n + k]) (dp[nm * n + k] = v), (par[nm * n + k] = j);
          }
        }
      let last = 1, bl = Infinity;
      for (let j = 1; j < n; j++) { const v = dp[(N - 1) * n + j] + dist(tour[j], tour[0]); if (v < bl) (bl = v), (last = j); }
      const seq = [];
      for (let m = N - 1, j = last; j >= 0; ) { seq.push(j); const pj = par[m * n + j]; m &= ~(1 << j); j = pj; if (m === 0) break; }
      if (!seq.includes(0)) seq.push(0);
      const ordered = seq.reverse().map((k) => tour[k]);
      if (ordered.length === n) tour.splice(0, n, ...ordered);
    }
    if (n > EXACT) {
      // too many for the exact solver: the insertion order, then 2-opt (undo every crossing)
      for (let pass = 0, better = true; better && pass < 50; pass++) {
        better = false;
        for (let i = 0; i < n - 1; i++)
          for (let k = i + 2; k < n; k++) {
            const a = tour[i], b = tour[i + 1], c = tour[k], d = tour[(k + 1) % n];
            if (a === d) continue;
            if (dist(a, c) + dist(b, d) < dist(a, b) + dist(c, d) - 0.01) {
              tour.splice(i + 1, k - i, ...tour.slice(i + 1, k + 1).reverse());
              better = true;
            }
          }
      }
    }
    // start nearest the way in; go first to the richer neighbour
    const ex = entry ? entry.x : stop.x, ey = entry ? entry.y : stop.y;
    let s0 = 0;
    tour.forEach((c, i) => { if (Math.hypot(c.x - ex, c.y - ey) < Math.hypot(tour[s0].x - ex, tour[s0].y - ey)) s0 = i; });
    let order = tour.slice(s0).concat(tour.slice(0, s0));
    const val = (c) => c.g.reduce((a, q) => a + q.v, 0);
    if (n > 2 && val(order[n - 1]) > val(order[1])) order = [order[0], ...order.slice(1).reverse()];
    // each spawn belongs to its nearest waypoint (for "what's here" and "where am I")
    const own = order.map(() => []);
    for (const p of pts) {
      if (!covered.has(p)) continue;
      let bi = 0;
      order.forEach((c, i) => { if (dist(c, p) < dist(order[bi], p)) bi = i; });
      own[bi].push(p);
    }
    const pockets = order.map((c, i) => {
      const pets = {}, mobs = {};
      let r = 6, v = 0;
      for (const p of own[i]) {
        pets[p.pid] = (pets[p.pid] || 0) + p.v;
        mobs[p.npc] = (mobs[p.npc] || 0) + p.v;
        r = Math.max(r, dist(c, p) + 3);
        v += p.v;
      }
      const camp = own[i].reduce((a, p) => Math.max(a, p.camp && dist(c, p) < p.camp ? p.camp : 0), 0);
      return { x: Math.round(c.x), y: Math.round(c.y), w: v, r: Math.round(camp || Math.min(r, PULL + 3)), camp: Math.round(camp), pets, mobs, label: i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(64 + Math.floor(i / 26), 65 + (i % 26)) };
    });
    let len = 0;
    for (let i = 0; i < n; i++) len += n === 1 ? 0 : dist(order[i], order[(i + 1) % n]);
    const souls = [...covered].reduce((a, q) => a + q.v, 0), all = pts.reduce((a, q) => a + q.v, 0);
    // one camp on its own: walk a ring around it
    const ring = n === 1 && pockets[0].camp ? pockets[0].camp : 0;
    if (ring) len = 2 * Math.PI * ring;
    const shape = ring ? "camp" : n <= 1 ? "spot" : n === 2 ? "back and forth" : n === 3 ? "triangle" : n === 4 ? "square" : "circle";
    return { pockets, len: Math.round(len), shape, ring, souls: Math.round(souls * 10) / 10, share: all ? souls / all : 1 };
  }
  // ── islands (community.js): reached by Windstream from a mainland landmark ──
  function islandAt(D, mapKey, x, y) {
    const C = D.community;
    if (!C) return null;
    for (const is of C.islands) {
      if (is.map !== mapKey) continue;
      if (D.maps[mapKey].zones.some((z) => z[0] === is.zone && pointInPoly(x, y, z[3]))) return is;
    }
    return null;
  }
  // where the Windstream is: the edge of the landmark zone that faces the island
  function gateOf(D, is) {
    if (is._gate !== undefined) return is._gate;
    const zones = D.maps[is.map].zones;
    let cx = 0, cy = 0, n = 0;
    for (const z of zones) if (z[0] === is.zone) for (let i = 0; i < z[3].length; i += 2) (cx += z[3][i]), (cy += z[3][i + 1]), n++;
    let g = null, gd = Infinity;
    if (n) {
      cx /= n; cy /= n;
      for (const z of zones) if (z[0] === is.via) for (let i = 0; i < z[3].length; i += 2) {
        const d = Math.hypot(z[3][i] - cx, z[3][i + 1] - cy);
        if (d < gd) (gd = d), (g = { x: z[3][i], y: z[3][i + 1] });
      }
    }
    return (is._gate = g);
  }
  const route = (k, fx, fy, tx, ty) => {
    const deg = bearing(fx, fy, tx, ty);
    return { kib: k, name: k[2], tp: k[3], x: k[0], y: k[1], dist: Math.round(Math.hypot(tx - fx, ty - fy)), deg, dir: dirName(deg) };
  };
  // Look-alikes: other monsters inside the circle with the same last name word ("… Zaif") that give
  // another pet. A similar name can award a different pet.
  function lookAlikes(D, stop, npc) {
    const T = D.mobs[npc];
    if (!T) return [];
    const head = T.n.split(" ").pop(), out = [], r2 = stop.r * stop.r;
    for (const [id, mob] of Object.entries(D.mobs)) {
      if (id === String(npc) || mob.map !== stop.map || String(mob.pet) === String(T.pet) || mob.n.split(" ").pop() !== head) continue;
      let n = 0;
      for (let i = 0; i < mob.pts.length; i += 3) {
        const dx = mob.pts[i] - stop.x, dy = mob.pts[i + 1] - stop.y;
        if (dx * dx + dy * dy <= r2) n += mob.pts[i + 2];
      }
      if (n) out.push({ npc: id, pet: String(mob.pet), n });
    }
    return out.sort((a, b) => b.n - a.n);
  }
  // How to get there: the nearest Kibelisk (in the Abyss, your side's), distance and direction.
  // On the other side's map (through a Rift) its Kibelisks are landmarks, not teleports. An island
  // with no Kibelisk of its own is reached by its Windstream: the Kibelisk nearest that, the walk to
  // it, then the ride. An island that has one gets a "first visit" Windstream note.
  function travel(D, stop, settings) {
    const map = D.maps[stop.map];
    const side = sideOf(settings);
    const rift = stop.map === otherMap(settings);
    const nearest = (x, y, ok) => {
      let best = null, bd = Infinity;
      for (const k of map.kib) {
        if (k[4] && k[4] !== side) continue;
        if (ok && !ok(k)) continue;
        const d = Math.hypot(k[0] - x, k[1] - y);
        if (d < bd) (bd = d), (best = k);
      }
      return best;
    };
    const is = islandAt(D, stop.map, stop.x, stop.y);
    const onIsland = (k) => !!is && k[3] > 0 && islandAt(D, stop.map, k[0], k[1]) === is;
    if (is) {
      const own = rift ? null : nearest(stop.x, stop.y, onIsland);
      const g = gateOf(D, is);
      if (own) return { ...route(own, own[0], own[1], stop.x, stop.y), rift, here: Math.hypot(own[0] - stop.x, own[1] - stop.y) <= stop.r, first: is, gate: g };
      if (g) {
        // the walk goes to the Windstream; a numbered Kibelisk next to it if there is one
        const k = nearest(g.x, g.y, (k) => rift || k[3] > 0) || nearest(g.x, g.y);
        if (k) return { ...route(k, k[0], k[1], g.x, g.y), rift, here: false, wind: is, gate: g };
      }
    }
    const best = nearest(stop.x, stop.y);
    if (!best) return null;
    return { ...route(best, best[0], best[1], stop.x, stop.y), rift, here: Math.hypot(best[0] - stop.x, best[1] - stop.y) <= stop.r };
  }
  // What else the monsters inside the circle drop, per 100 kills, weighted by how many spawn there.
  function stopLoot(D, contents, limit = 6) {
    const agg = new Map();
    let total = 0;
    for (const c of Object.values(contents))
      for (const { npc, n } of c.mobs) {
        total += n;
        for (const [it, pct] of D.mobs[npc].loot) agg.set(it, (agg.get(it) || 0) + pct * n);
      }
    if (!total) return [];
    const rows = [...agg.entries()].map(([it, v]) => ({ item: D.items[it], idx: it, pct: v / total }));
    // worth the trip: rarer first, then the likelier; drop the near-impossible
    rows.sort((a, b) => b.item[1] - a.item[1] || b.pct - a.pct);
    return rows.filter((r) => r.pct >= 0.05).slice(0, limit);
  }

  // ── stats from collected souls ────────────────────────────────
  // log entries: [t, pet, amount, area, map]
  const GAP = 5 * 60 * 1000;
  function sessionStats(log, now) {
    const out = { areas: {}, today: { souls: 0, ms: 0 }, all: { souls: 0, ms: 0 }, session: null };
    const day = new Date(now);
    day.setHours(0, 0, 0, 0);
    let prev = null, sess = null;
    for (const e of log) {
      const [t, , amt, area, map] = e;
      const a = (out.areas[area] = out.areas[area] || { area, map, souls: 0, ms: 0, last: 0, today: 0 });
      a.souls += amt;
      if (t >= +day) (a.today += amt), (out.today.souls += amt);
      out.all.souls += amt;
      // active time: gaps under 5 minutes count, else one minute for a new start
      const dt = prev && t - prev[0] < GAP ? t - prev[0] : 60000;
      if (prev && prev[3] === area && t - prev[0] < GAP) a.ms += dt;
      else a.ms += 60000;
      out.all.ms += dt;
      if (t >= +day) out.today.ms += dt;
      a.last = t;
      if (!sess || t - prev[0] >= GAP * 6) sess = { start: t, souls: 0, ms: 0, pets: new Set() };
      sess.souls += amt;
      sess.ms += dt;
      sess.pets.add(e[1]);
      sess.last = t;
      prev = e;
    }
    if (sess && now - sess.last < GAP * 6) out.session = { ...sess, pets: sess.pets.size };
    for (const a of Object.values(out.areas)) a.perHour = a.ms ? (a.souls / a.ms) * 3600000 : 0;
    const rate = (o) => (o.ms ? (o.souls / o.ms) * 3600000 : 0);
    out.today.perHour = rate(out.today);
    out.all.perHour = rate(out.all);
    if (out.session) out.session.perHour = rate(out.session);
    return out;
  }

  // Distance from a point to the nearest spawn of a pet's monsters on a map (Infinity if none there).
  function distToPet(D, pid, map, x, y) {
    let best = Infinity;
    for (const npc of D.pets[pid]?.d || []) {
      const mob = D.mobs[npc];
      if (mob.map !== map) continue;
      for (let i = 0; i < mob.pts.length; i += 3) {
        const d = Math.hypot(mob.pts[i] - x, mob.pts[i + 1] - y);
        if (d < best) best = d;
      }
    }
    return best;
  }
  // Pets whose monsters spawn inside a circle, with how many spawns each.
  function petsNear(D, map, x, y, r, keep) {
    const out = [];
    for (const [pid, p] of Object.entries(D.pets)) {
      if (keep && !keep(pid)) continue;
      let n = 0;
      for (const npc of p.d) {
        const mob = D.mobs[npc];
        if (mob.map !== map) continue;
        for (let i = 0; i < mob.pts.length; i += 3) if (Math.hypot(mob.pts[i] - x, mob.pts[i + 1] - y) <= r) n += mob.pts[i + 2];
      }
      if (n) out.push({ pid, spawns: n });
    }
    return out.sort((a, b) => b.spawns - a.spawns);
  }

  const api = { NEEDED, MAX_LEVEL, GENERA, GENUS_NAME, GENUS_COLOR, OWNED_EFFECT, INSIGHT_EXP, GENUS_LEVEL_EXP, STOP_R,
    riftOnlyPet, soulsLeft, soulsTotal, effectGain, totalEffects, zoneAt, bearing, dirName, sideOf, ownMap, otherMap, mapRank,
    allowedMaps, isFarmable, bestSpots, buildRoute, islandAt, gateOf, lookAlikes, farmLoop, campR, stopContents, stopQueue, travel, stopLoot, expectedKills, sessionStats, distToPet, petsNear };
  root.FGEngine = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
