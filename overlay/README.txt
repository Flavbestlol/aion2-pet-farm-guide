AION 2 PET FARM GUIDE 1.25.4
============================

The Farm Guide drawn straight over AION 2: no window, no box, no background you didn't choose.
A small tip (the monster to kill, souls left, a progress ring) sits wherever you drag it; click it
and the guide opens from it. Everywhere else your clicks go to the game.

HOW IT WORKS
  Something must read the game for the guide. Flav-Toolkit is the main way; the A2 Tools DPS Meter
  is the backup. Switching between them loses nothing.
  - Flav-Toolkit 0.3 or later (main): the guide is one of its add-ons. Flav-Toolkit reads your pet
    levels and souls with the guide's own decoders (the farm-guide folder beside this exe), and its
    hub lists the guide (Start, Stop, Open, Settings). The overlay records your progress itself, so
    keep it running while you farm: turn on "Start with Flav-Toolkit" on the guide's page in the hub.
  - A2 Tools (backup): keep the Farm Guide plugin loaded in A2 Tools (version 1.16.0 or later).
    While the overlay runs, its window hides itself and keeps recording (Settings > Overlay > A2
    Tools window: Hidden, a small Card, or the Full guide).
  - When both run, the guide reads from Flav-Toolkit and A2 Tools stands by; if Flav-Toolkit stops,
    the guide carries on from A2 Tools by itself. Settings > Overlay > Game records says which.
  - The overlay never touches the game, Flav-Toolkit or A2 Tools. It reads what they hand it,
    writes its own files, and (with A2 Tools) watches for Ctrl+Alt+L.

START
  Pet Farm Guide is a Flav-Toolkit add-on: Flav-Toolkit installs it (hub > Get add-ons), starts it
  and stops it. Turn on "Start with Flav-Toolkit" on the guide's page in the hub so the overlay runs
  while you play: it stays invisible until AION 2 is running, and hides while you're in another
  window (Settings > Show). The game must run in Borderless / Windowed mode.
  A2 Tools as the backup reader: load this folder's farm-guide folder in A2 Tools (Settings >
  Plugins > Plugin developer mode > Load plugin folder...).
  The paw in Flav-Toolkit's dock opens the guide; click it again to put the guide away (tip and
  all) until the next click or the hub's Open. The overlay has no tray icon of its own: the dock
  and the hub open it, the hub stops it.

UPDATES
  From Flav-Toolkit: its hub tells you when a new version is out (Get add-ons, the dock, a toast)
  and installs it, checked against its signed catalogue. Repair puts back a missing or changed
  file; Roll back returns to the version before. The overlay itself reaches no network.

USE
  - Click the tip: the guide opens. The fold button (top right of the guide) closes it again.
    It also folds by itself when you stop getting pet souls (Settings > Tip & folding), and opens
    again when you start collecting souls (or stays folded: When hunting resumes).
  - Drag the tip, or the guide by its title, to anywhere on the screen. Let go near an edge and it
    snaps to it. The guide grows out of the edge it's docked to: on the left it fades toward the
    right, on the right it mirrors (Settings > Docked side: Auto / Left / Right).
  - Lock: click the padlock. With A2 Tools, Ctrl+Alt+L locks and unlocks
    too, together with A2 Tools' own lock. Locked: everything lets clicks through to the game
    except the padlock (click it to unlock). Folded and locked: Alt+click the tip to open it.
  - Layout: the pencil by the padlock. Move, resize or hide any part of the guide, and click a part
    for its own options: show it always, only on the way, or only while farming; how many monsters
    the list shows; the monster's level bar and kills line; a see-through map; a slim header.
SMART
  - On the way to a stop, the tip shows the teleport number and an arrow pointing the way;
    once you're farming it shows souls left and the time to finish at your pace.
  - When a stop is done while the guide is folded, it opens by itself on the next stop's map and
    directions, and folds again at your first soul there (Settings > Open on a new stop).
  - When you start AION 2, a short recap of your last session: souls, time, level-ups, your best
    area per hour, and what's still to go.
  - Islands: Eternal and Immortal Isle have no Kibelisk, so the guide sends you to the Windstream
    (teleport, walk, ride; the map draws it). On Crimson and Spirit Isle it says how to get there
    the first time.
  - Abyss: farms the fragment area next to your own base, says it needs Lv 45+ and gear 1,000, and
    leaves it out below Lv 45.
  - Elites count for half and field bosses are never a stop (the Pets tab shows where they are).
    Sources a community check couldn't confirm are marked and come last.
  - "Skip ..." under the monster: a look-alike here that gives a pet you've already finished.
  - Through a Rift, Kibelisks over there are landmarks ("near ..."), not teleports.
  - Farming loop: once you're at a stop, the map draws a loop through every spawn spot of the pets
    still to farm within about 200 m: densest spots first, until ~90% of the souls there are on it,
    far strays left off, in the shortest order (exact up to 12 spots). Monsters the database only
    knows as a camp (a centre and a count) are drawn as an area; a lone camp gets a ring to walk
    around it. As pets finish, the loop rebuilds around what's left. Your souls tell it where you
    are: "at B, next C".
  - Under the map: round/square, loop on/off, monster icons on/off, and hide (it folds away). Drag the map's corner grip
    to resize it; double-click the grip for the default size.
  - Settings tab: theme (HUD / Apple / In-game / Classic), size, background (0 = fully clear), and more.
    The same settings are in Flav-Toolkit's hub (the guide's page there, and Settings) from
    Flav-Toolkit 0.18; Look, Size, See-through, Animations and Sounds can be set there for every
    add-on at once.
  - Settings > Overlay: Reset position (the tip back in place), Next screen (with more than one
    monitor), Close overlay.
  - An orange dot on the tip = nothing is being recorded, and the guide says why: Flav-Toolkit
    isn't reading the game (the guide shows Flav-Toolkit's own reason), or, with A2 Tools, the
    Farm Guide plugin isn't running there (A2 Tools > Settings > Plugins > Open).

FILES
  Your overlay settings and records:  %APPDATA%\app.farmguide.overlay (kept when Flav-Toolkit
                                       updates or removes the guide)
  The plugin's records (A2 Tools):     %APPDATA%\com.a2tools.dps-meter\plugin-data\farm-guide

Data: MetaBot.GG (metabot.gg/en/aion-2) and the A2 Tools Pet Soul Tracker.
Island Windstreams, Abyss bases, bosses and unconfirmed sources: Th3Ruthless,
"AION 2 Pet Farming Routes" (reviewed 12 Oct 2026).
