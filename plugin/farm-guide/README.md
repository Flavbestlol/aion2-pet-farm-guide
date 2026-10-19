# AION 2 Pet Farm Guide (A2 Tools plugin)

Tells you where to farm every pet's souls, in what order, and which areas pay best.

- **Guide:** a route over every pet still below your goal level. Each stop shows the monster to kill now
  (the pet closest to done, by expected kills), the Kibelisk to teleport to and which way to walk, the stop's
  pets in farming order, a map, and what else the monsters there drop.
- **Pets:** every pet with its level and souls left; click one to be guided to its best spots.
- **Stats:** souls this session and per hour, the best areas you farmed (souls per hour), and the stats your
  pets give (owned effects per genus, and an estimate of each genus' insight level).
- **Settings:** faction (auto from the server number), goal level, route order and genus priority, Rift trips,
  the low-level monster penalty, next stop by itself, map, effects, sounds.
- **Rift route** (separate from the main route) and a **stop list** (click the stop name).

## Install (developer mode)

1. A2 Tools DPS Meter 2.0.65 or later: **Settings → Plugins → Plugin developer mode** on.
2. **Load plugin folder…** and pick this `farm-guide` folder, then **Open**.
3. Log in (or relog) so the game sends your pet list.

After editing files, **Check for updates** reloads the window.

## Data

`data.js` is generated: farm spots, spawn points, monster art and drop tables from
[MetaBot.GG](https://metabot.gg/en/aion-2) (Global client), pet names in ten languages and the in-game
teleport numbers from the A2 Tools Pet Soul Tracker (`sources.js`, `pets.js`). Only maps open on Global
(Verteron, Altgard, Lower Reshanta) are used. Owned effects per pet level: wikily.gg genus pages, matching
MetaBot's type bonus table.

`community.js` adds what the database doesn't say, from Th3Ruthless' *AION 2 Pet Farming Routes* (Global
edition, reviewed 12 Oct 2026; its 218 monster → pet pairs match `data.js`): the Windstream to each island,
each side's Abyss base and entry needs (Lv 45, gear 1,000), the bosses and dungeons behind non-farmable pets,
and the continent sources it could not confirm (weighted down and marked in the guide).

The decoders are copied unchanged from the official Pet Soul Tracker 0.4.1.

## Permissions

- `decoder:pet-list`, `decoder:soul-gained`, `decoder:level-up`: your own pets' levels and souls.
- `decoder:map-load`: the map id of each zone you load (a number), to fold away in dungeons and follow you through a Rift.
- `events:character`: keep counts per server, pick the faction, read your level.
- `storage`: counts, route position, soul log for the stats, settings.
