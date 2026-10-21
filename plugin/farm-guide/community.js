// Community knowledge from Th3Ruthless' "AION 2 Pet Farming Routes" (Global edition, sources 08 Oct 2026,
// reviewed 12 Oct 2026; Elyos and Asmodian editions). Its monster → pet pairs match FG_DATA one for one,
// so this file only adds what the database doesn't say: how to reach the islands, where each faction
// starts in the Abyss and what it takes to enter, which continent sources a check could not confirm,
// and where the pets nobody farms come from. Runs after data.js, before engine.js; it adds to FG_DATA.
(function (D) {
  "use strict";
  if (!D) return;
  const C = (D.community = {
    credit: "Th3Ruthless · AION 2 Pet Farming Routes (reviewed 12 Oct 2026)",
    // Island stops: the first trip is by Windstream from a landmark on the mainland ("via" is a zone on
    // the same map; the Windstream is on its edge facing the island). Visitors from the other side
    // (through a Rift) use the Windstream too.
    islands: [
      { map: "L", zone: "Crimson Isle", via: "Scarlet Forest Observation Site", how: "Windstream north of Scarlet Forest Observation Site", npc: "Takis" },
      { map: "L", zone: "Eternal Isle", via: "Southern Tolbas Forest", how: "Windstream at the SW Tolbas Forest cliff", npc: "Ahtan" },
      { map: "D", zone: "Spirit Isle", via: "Basfelt Waterfall", how: "Windstream at the Basfelt waterfall", npc: "Milo" },
      { map: "D", zone: "Immortal Isle", via: "Sanctum Outpost", how: "Windstream on the Sanctum Outpost cliff", npc: "Nivena" },
    ],
    // Chaotic Lower Reshanta: each side starts at its own Root and farms the fragment area next to it
    // (Black Fragments and Devastated Remnants give the same four pets).
    abyss: { minLevel: 45, gear: 1000, base: { elyos: "Latesran Western Root", asmodian: "Latesran Eastern Root" } },
    // Bosses and dungeons for pets with no field source (Field bosses: plan a separate attempt).
    acquire: {
      "Elite Klaw": "Field boss Bodyguard Teegant · Verteron Fortress Ruins",
      "Elite Guardite": "Field boss Divine Ansas · Contaminated Sanctum",
      "Black Smoke Murute": "Boss Black Smoke Murute · Fire Temple",
      "Red Spark Ignus": "Boss Red Spark Ignus · Fire Temple",
      "Elite Dratona": "Predator Colossus Balakh · Morheim (Lv 80 field boss)",
      "Elite Karnif": "Crimson Blizzard Renulf · Morheim (Lv 80 field boss)",
      "Harcon": "Enhanced Harcon · Krao Cave",
      "Phantasmal Lakshmi": "Phantasmal Lakshmi · Draupnir",
      "Predator Saraswati": "Predator Saraswati · Draupnir",
      "Pretor Veil Administrator": "Gluttonous Egetis · Eltnen (Lv 80 field boss)",
      "Furious Feruk": "Maybe a Nightmare dungeon boss (unconfirmed) · chests and merchants for sure",
      "Gatekeeper Pinopi": "Maybe a Nightmare dungeon boss (unconfirmed) · chests and merchants for sure",
      "Kernon": "Maybe Kernon of the West, named Lv 45 in Verteron (unconfirmed) · chests and merchants for sure",
      "Sentinel K'nash": "Maybe Sentinel K'nash, named Lv 45 in Verteron (unconfirmed) · chests and merchants for sure",
    },
    // The six pets whose souls drop inside dungeons (one boss each, at every difficulty), from the
    // game's own drop tables (A2 Tools Pet Souls, gamesouls.py). Field souls don't drop in dungeons.
    dungeons: [
      { name: "Fire Temple", pets: ["Black Smoke Murute", "Red Spark Ignus", "Silver Blade Rotan"] },
      { name: "Krao Cave", pets: ["Harcon"] },
      { name: "Draupnir", pets: ["Phantasmal Lakshmi", "Predator Saraswati"] },
    ],
    // Spacetime Rifts: open every 3 hours on both continents, 10 minutes each, at these minutes after
    // midnight server time (the game's event table, as A2 Tools' Event Timers plugin reads it). A
    // server's region is its id's second digit; its time zone is the region's.
    rift: {
      starts: [120, 300, 480, 660, 840, 1020, 1200, 1380], minutes: 10,
      zones: { 1: "America/New_York", 2: "America/Los_Angeles", 3: "Europe/Berlin", 4: "America/Sao_Paulo", 5: "Asia/Seoul" },
    },
    // Map ids in the game's map-load record: 1010 is World_L_A and 101xxx its layers (A2 Tools' own
    // captures); 1110 is Altgard and 20 Lower Reshanta, the Abyss (the game's map table, as A2 Tools'
    // pet-sources tool reads it). Others are learned from where your souls come from.
    worlds: { 1010: "L", 1110: "D", 20: "A" },
    // Continent sources the community check could not confirm against the soul-item records. They stay
    // in the guide, weighted down and marked, so a confirmed source (often in the Abyss) comes first.
    held: {
      "Wandering Klaw": "Klaw: not confirmed. Sure source: Abyss Klaw Mutant (Sulfur Tree Island)",
      "Trained Karnif": "Modified Karnif: not confirmed. Sure source: Abyss Karnif (Abyss fragments)",
      "Unruly Karnif": "Modified Karnif: not confirmed. Sure source: Abyss Karnif (Abyss fragments)",
      "Dratona Tinkerer": "Not confirmed for Dratona (and not the Dratona Tinkerer pet, which is chest-only)",
    },
  });

  // Monsters whose picture (MetaBot's) is another creature's: they show their pet's portrait,
  // which is the creature itself. (Every Drakan Guard Dog source has the Drakan rider's picture.)
  C.artFromPet = ["Drakan Guard Dog"];

  const pidByName = {};
  for (const [pid, p] of Object.entries(D.pets)) pidByName[p.n.en] = pid;
  C.acquireBy = {};
  for (const [name, how] of Object.entries(C.acquire)) if (pidByName[name]) C.acquireBy[pidByName[name]] = how;
  for (const mob of Object.values(D.mobs)) if (C.held[mob.n]) mob.held = C.held[mob.n];
  for (const mob of Object.values(D.mobs)) if (D.pets[mob.pet] && C.artFromPet.includes(D.pets[mob.pet].n.en)) mob.artPet = true;
  C.dungeonOf = {}; // pet id → the dungeon its souls drop in
  for (const d of C.dungeons) d.pids = d.pets.map((n) => pidByName[n]).filter(Boolean);
  for (const d of C.dungeons) for (const pid of d.pids) C.dungeonOf[pid] = d.name;
  // the Abyss Kibelisks belong to a side
  const A = D.maps.A;
  if (A) for (const k of A.kib) {
    if (k[2] === C.abyss.base.elyos) k[4] = "elyos";
    else if (k[2] === C.abyss.base.asmodian) k[4] = "asmodian";
  }
})(typeof FG_DATA !== "undefined" ? FG_DATA : null);
