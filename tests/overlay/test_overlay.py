"""The overlay's page in headless Chromium with a stand-in for its Rust side (fake_tauri.js).

    FG_NO_ART=1 python3 overlay/assemble.py && python3 tests/overlay/test_overlay.py

Checks how game records reach the guide from each source, and what the overlay keeps.
Needs: pip install playwright && playwright install chromium
"""
import functools, http.server, json, sys, threading, time
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent.parent
UI = ROOT / "overlay" / "ui"
FAKE = (Path(__file__).parent / "fake_tauri.js").read_text()
if not (UI / "index.html").is_file():
    sys.exit("assemble the page first: FG_NO_ART=1 python3 overlay/assemble.py")

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


handler = functools.partial(Quiet, directory=str(UI))
server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{server.server_address[1]}/index.html"

failures, errors = [], []


def check(name, ok, detail=""):
    print(("✅ " if ok else "❌ ") + name + (f"  ({detail})" if detail and not ok else ""))
    if not ok:
        failures.append(name)


CHAR = {"name": "Sampleton", "serverId": 1012, "level": 45}


def pets_list(D_ids, level=0, points=0):
    return {"levels": [{"pet": int(i), "level": level} for i in D_ids], "points": [{"pet": int(i), "points": points} for i in D_ids]}


def boot(browser, files=None, source=None, kind=None, game=None, tour=False, version=None):
    page = browser.new_page(viewport={"width": 1600, "height": 900})
    page.on("console", lambda m: errors.append(f"{m.type}: {m.text}") if m.type == "error" and "Failed to load resource" not in m.text else None)
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    init = "window.__FILES=" + json.dumps(files or {}) + ";"
    if source is not None:
        init += "window.__source=" + json.dumps(source) + ";"
    if kind is not None:
        init += "window.__kind=" + json.dumps(kind) + ";"
    if game is not None:
        init += "window.__game=" + json.dumps(game) + ";"
    if tour:
        init += "window.__forceTour=true;"
    if version is not None:
        init += "window.__version=" + json.dumps(version) + ";"
    page.add_init_script(init + FAKE)
    page.goto(URL)
    page.wait_for_function("() => typeof window.FG_key === 'function'", timeout=15000)
    page.wait_for_timeout(600)
    return page


def farmable(page):
    return page.evaluate("() => Object.keys(FG_DATA.pets).filter((p) => FGEngine.isFarmable(FG_DATA, p))")


with sync_playwright() as p:
    browser = p.chromium.launch()

    # ── A2 Tools: the plugin records, the overlay shows ──
    page = boot(browser)
    ids = farmable(page)
    page.evaluate("(c) => { const b = { v: 2, run: 1, seq: 0, character: c, events: [] }; window.__files.plugin.bridge = JSON.stringify(b); window.__emitHost('bridge', window.__files.plugin.bridge); }", CHAR)
    page.evaluate("([d]) => window.__pluginEvent('decoded:pet-list', d)", [pets_list(ids[:40])])
    page.wait_for_timeout(900)
    check("A2 Tools: a pet list from bridge.json files the counts under the server", page.evaluate("() => FG_key()") == "server-1012")
    check("A2 Tools: the overlay keeps its own copy of the counts too (for moving to Flav-Toolkit)", "pets-server-1012" in page.evaluate("() => Object.keys(window.__files.own)"))
    check("A2 Tools: the overlay never writes the plugin's records", sorted(page.evaluate("() => Object.keys(window.__files.plugin)")) == ["bridge", "overlay"], page.evaluate("() => Object.keys(window.__files.plugin)"))
    hb = page.evaluate("() => window.__files.plugin.overlay")
    check("A2 Tools: the overlay's heartbeat reaches the plugin", bool(hb) and json.loads(hb)["at"] > 0, hb)
    note = page.evaluate("() => document.querySelector('.ovnotice').textContent")
    check("A2 Tools: the not-recording notice says what to do", "A2 Tools" in note, note)
    # no tray icon any more: Settings › Overlay holds Reset position, Next screen and Close overlay
    page.evaluate("() => document.querySelector('.tabs button[data-tab=\"settings\"]')?.click()")
    page.wait_for_timeout(400)
    btn = lambda label: page.evaluate("(l) => { const b = [...document.querySelectorAll('.btnrow .btn')].find((x) => x.textContent === l); if (b) b.click(); return !!b; }", label)
    check("Settings: a Next screen button moves the overlay to the next monitor", btn("Next screen") and page.evaluate("() => window.__calls.some(([c]) => c === 'next_screen')"))
    check("Settings: a Close overlay button", btn("Close overlay"))
    page.wait_for_timeout(400)
    order = page.evaluate("""() => window.__calls.map(([c, a]) => c === 'quit' ? 'quit' : c === 'write_file' && a.key === 'overlay' && JSON.parse(a.value).at === 0 ? 'bye' : null).filter(Boolean)""")
    check("A2 Tools: closing tells the plugin first, then quits", order[:2] == ["bye", "quit"], order)
    page.close()

    # the plugin's saved counts are what the overlay starts from
    saved = {"levels": {ids[0]: 2}, "points": {ids[0]: 5}, "syncedAt": int(time.time() * 1000) - 3600_000}
    page = boot(browser, {"plugin": {"pets-server-1012": json.dumps(saved), "last": json.dumps("server-1012")}})
    page.wait_for_timeout(500)
    check("A2 Tools: starts from the plugin's saved counts", page.evaluate("() => FG_key()") == "server-1012")
    page.close()

    # ── Flav-Toolkit: the overlay records itself ──
    now = int(time.time() * 1000)
    page = boot(browser, source={"feed": True, "core": "0.3.0 (edfb155, 2026-10-25)", "status": {"capturing": True, "game": True, "source": "live", "text": "Reading the game"}})
    ids = farmable(page)
    feed = lambda e: page.evaluate("(e) => window.__emitHost('feed', e)", e)
    own = lambda k: page.evaluate("(k) => window.__files.own[k] ? JSON.parse(window.__files.own[k]) : null", k)
    check("Flav-Toolkit: in use while its feed is connected", page.evaluate("() => FG_OV.active") == "feed")
    feed({"type": "my_server", "at_ms": now - 60000, "server": 1012})
    feed({"type": "my_profile", "at_ms": now - 60000, "name": "Sampleton", "class": "Cleric", "level": 45})
    login = now - 60000
    feed({"type": "decoded", "at_ms": login, "plugin": "farm-guide", "decoder": "pet-list", "data": pets_list(ids[:40])})
    page.wait_for_timeout(700)
    check("Flav-Toolkit: the pet list is filed under my_server's server", page.evaluate("() => FG_key()") == "server-1012")
    saved = own("pets-server-1012")
    check("Flav-Toolkit: the overlay keeps the counts itself", bool(saved) and saved.get("syncedAt") == login, saved and saved.get("syncedAt"))
    pet = int(ids[0])
    feed({"type": "decoded", "at_ms": now - 1000, "plugin": "farm-guide", "decoder": "soul-gained", "data": {"souls": [{"pet": pet, "amount": 1}, {"pet": int(ids[1]), "amount": 1}]}})
    page.wait_for_timeout(700)
    saved = own("pets-server-1012")
    pts = saved["points"].get(str(pet)) if saved else None
    check("Flav-Toolkit: a kill feeding two pets counts both", saved and pts == 1 and saved["points"].get(str(ids[1])) == 1, saved and saved["points"])
    log = own("log-server-1012")
    check("Flav-Toolkit: the soul log is kept", bool(log) and len(log["log"]) == 2, log)
    # A2 Tools still writes bridge.json meanwhile: not counted twice
    page.evaluate("(c) => { window.__files.plugin.bridge = JSON.stringify({ v: 2, run: 7, seq: 0, character: c, events: [] }); window.__emitHost('bridge', window.__files.plugin.bridge); }", CHAR)
    page.evaluate("(p) => window.__pluginEvent('decoded:soul-gained', { souls: [{ pet: p, amount: 1 }] })", pet)
    page.wait_for_timeout(600)
    check("Flav-Toolkit: A2 Tools' bridge isn't counted while the feed is the source", own("pets-server-1012")["points"].get(str(pet)) == 1)
    # a reconnect hands the kept pet list again: the souls since are kept
    page.evaluate("() => window.__emitHost('source', { feed: false })")
    page.wait_for_timeout(200)
    page.evaluate("() => window.__emitHost('source', { feed: true, core: '0.3.0', status: { capturing: true, game: true, source: 'live', text: 'Reading the game' } })")
    feed({"type": "my_server", "at_ms": login, "server": 1012})
    feed({"type": "decoded", "at_ms": login, "plugin": "farm-guide", "decoder": "pet-list", "data": pets_list(ids[:40])})
    page.wait_for_timeout(700)
    check("Flav-Toolkit: the kept pet list again doesn't undo the souls since", own("pets-server-1012")["points"].get(str(pet)) == 1, own("pets-server-1012")["points"].get(str(pet)))
    # a relog on another server: the new list comes a moment before my_server
    feed({"type": "decoded", "at_ms": int(time.time() * 1000), "plugin": "farm-guide", "decoder": "pet-list", "data": pets_list(ids[:10])})
    page.wait_for_timeout(150)
    feed({"type": "my_server", "at_ms": int(time.time() * 1000), "server": 2020})
    page.wait_for_timeout(700)
    check("Flav-Toolkit: a new login's list waits for its server", page.evaluate("() => FG_key()") == "server-2020" and own("pets-server-2020") is not None, page.evaluate("() => FG_key()"))
    check("Flav-Toolkit: the other server's counts are untouched", own("pets-server-1012")["points"].get(str(pet)) == 1)
    # a relog on yet another server whose my_server comes late (after the hold): never filed under the server before
    feed({"type": "decoded", "at_ms": int(time.time() * 1000), "plugin": "farm-guide", "decoder": "pet-list", "data": pets_list(ids[:7], level=9)})
    page.wait_for_timeout(2200)
    feed({"type": "my_server", "at_ms": int(time.time() * 1000), "server": 2030})
    page.wait_for_timeout(900)
    late = own("pets-server-2030")
    check("Flav-Toolkit: a list whose server comes late lands under that server, not the one before", page.evaluate("() => FG_key()") == "server-2030" and late is not None and len(late["levels"]) == 7, page.evaluate("() => FG_key()"))
    check("Flav-Toolkit: … and the server before keeps its counts", len(own("pets-server-2020")["levels"]) == 10)
    # back on 1012 for the rest
    feed({"type": "my_server", "at_ms": int(time.time() * 1000), "server": 1012})
    page.wait_for_timeout(400)
    # the hub's Settings opens the guide's settings
    page.evaluate("() => window.__emitHost('show', 'settings')")
    page.wait_for_timeout(700)
    srow = page.evaluate("() => [...document.querySelectorAll('.row')].find((r) => r.textContent.startsWith('Game records'))?.textContent || ''")
    check("Flav-Toolkit: Settings say where the records come from", "Flav-Toolkit" in srow, srow)
    # Flav-Toolkit closes: back to A2 Tools, and the souls counted meanwhile are still there
    page.evaluate("() => window.__emitHost('source', { feed: false })")
    page.wait_for_timeout(300)
    check("Flav-Toolkit gone: back to A2 Tools", page.evaluate("() => FG_OV.active") == "a2")
    merged = page.evaluate("() => FG_OV.records.get('log-server-1012')")
    check("Flav-Toolkit gone: the soul log from its time is still read", bool(merged) and len(merged["log"]) >= 2)
    page.close()

    # Flav-Toolkit stops right after a pickup that A2 Tools' bridge brings a moment later: counted once
    page = boot(browser, source={"feed": True, "core": "0.3.0", "status": {"capturing": True, "game": True, "source": "live", "text": "Reading the game"}})
    feed = lambda e: page.evaluate("(e) => window.__emitHost('feed', e)", e)
    own = lambda k: page.evaluate("(k) => window.__files.own[k] ? JSON.parse(window.__files.own[k]) : null", k)
    page.evaluate("(c) => { window.__files.plugin.bridge = JSON.stringify({ v: 2, run: 7, seq: 0, character: c, events: [] }); window.__emitHost('bridge', window.__files.plugin.bridge); }", CHAR)
    feed({"type": "my_server", "at_ms": now - 60000, "server": 1012})
    feed({"type": "decoded", "at_ms": now - 60000, "plugin": "farm-guide", "decoder": "pet-list", "data": pets_list(ids[:40])})
    page.wait_for_timeout(700)
    t = int(time.time() * 1000)
    feed({"type": "decoded", "at_ms": t, "plugin": "farm-guide", "decoder": "soul-gained", "data": {"souls": [{"pet": int(ids[5]), "amount": 1}]}})
    page.wait_for_timeout(60)
    page.evaluate("() => window.__emitHost('source', { feed: false })")
    page.evaluate("([x, at]) => window.__pluginEvent('decoded:soul-gained', { souls: [{ pet: x, amount: 1 }] }, at)", [int(ids[5]), t + 40])
    page.wait_for_timeout(1000)
    got = own("pets-server-1012")["points"].get(str(ids[5]))
    n = sum(1 for e in own("log-server-1012")["log"] if e[1] == int(ids[5]))
    check("Flav-Toolkit → A2 Tools mid-pickup: the same pickup counts once", got == 1 and n == 1, (got, n))
    # … and a later pickup from A2 Tools counts as usual
    page.evaluate("(x) => window.__pluginEvent('decoded:soul-gained', { souls: [{ pet: x, amount: 1 }] })", int(ids[5]))
    page.wait_for_timeout(800)
    check("Flav-Toolkit → A2 Tools: the next pickup counts", own("pets-server-1012")["points"].get(str(ids[5])) == 2)
    page.close()

    # A2 Tools' resync merges its soul log with ours (a long history must not push out Flav-Toolkit's pickups)
    plog = [[now - 9_000_000 + i * 1000, pet, 1, "A", "L"] for i in range(5200)]
    feedonly = [[now - 600_000 + i * 1000, int(ids[1]), 1, "F", "L"] for i in range(3)]
    p0 = {"levels": {str(pet): 2}, "points": {str(pet): 5}, "syncedAt": now - 9_500_000}
    files = {"own": {"pets-server-1012": json.dumps({**p0, "syncedAt": now - 900_000}), "log-server-1012": json.dumps({"log": plog[-4000:] + feedonly, "levelLog": []}), "last": json.dumps("server-1012")},
             "plugin": {"pets-server-1012": json.dumps(p0), "log-server-1012": json.dumps({"log": plog, "levelLog": []}), "last": json.dumps("server-1012"),
                        "bridge": json.dumps({"v": 2, "run": 1, "seq": 0, "character": CHAR, "events": []})}}
    page = boot(browser, files)
    own = lambda k: page.evaluate("(k) => window.__files.own[k] ? JSON.parse(window.__files.own[k]) : null", k)
    page.evaluate("() => window.__emitHost('bridge', window.__files.plugin.bridge)")
    page.wait_for_timeout(2200)
    page.evaluate("(x) => window.__pluginEvent('decoded:soul-gained', { souls: [{ pet: x, amount: 1 }] })", pet)
    page.wait_for_timeout(1200)
    left = sum(1 for e in own("log-server-1012")["log"] if e[3] == "F")
    check("A2 Tools' resync keeps the pickups only Flav-Toolkit saw", left == 3, left)
    page.close()

    # a recording Flav-Toolkit plays is not your play
    page = boot(browser, source={"feed": True, "core": "0.3.0", "status": {"capturing": True, "game": True, "source": "replay", "text": "Playing a recording"}})
    page.evaluate("(e) => window.__emitHost('feed', e)", {"type": "my_server", "at_ms": now, "server": 1012})
    page.evaluate("(e) => window.__emitHost('feed', e)", {"type": "decoded", "at_ms": now, "plugin": "farm-guide", "decoder": "pet-list", "data": pets_list(ids[:5])})
    page.wait_for_timeout(700)
    check("Flav-Toolkit playing a recording: nothing is recorded", not any(k.startswith("pets-") for k in page.evaluate("() => Object.keys(window.__files.own)")))
    page.close()

    # moving from A2 Tools to Flav-Toolkit: the plugin's newer counts and log carry over
    older = {"levels": {ids[0]: 1}, "points": {ids[0]: 0}, "syncedAt": now - 7200_000}
    newer = {"levels": {ids[0]: 2}, "points": {ids[0]: 7}, "syncedAt": now - 3600_000}
    files = {"own": {"pets-server-1012": json.dumps(older), "log-server-1012": json.dumps({"log": [[now - 7000_000, pet, 1, "A", "L"]], "levelLog": []})},
             "plugin": {"pets-server-1012": json.dumps(newer), "log-server-1012": json.dumps({"log": [[now - 3000_000, pet, 2, "B", "L"]], "levelLog": []})}}
    page = boot(browser, files, source={"feed": True, "core": "0.3.0", "status": {"capturing": True, "game": True, "source": "live", "text": "Reading the game"}})
    got = page.evaluate("() => FG_OV.records.get('pets-server-1012')")
    check("A2 Tools → Flav-Toolkit: the newer counts win", got["points"].get(str(pet)) == 7, got)
    got = page.evaluate("() => FG_OV.records.get('log-server-1012')")
    check("A2 Tools → Flav-Toolkit: both soul logs, each pickup once", len(got["log"]) == 2, got)
    page.close()

    # ── how this copy came (1.25.0: the guide installs and updates from Flav-Toolkit only) ──
    title = lambda page: page.evaluate("() => document.querySelector('.ovcard .oc-t')?.textContent || ''")
    def click_card(page, label):
        page.evaluate("(l) => [...document.querySelectorAll('.ovcard .oc-btn')].find((b) => b.textContent === l)?.click()", label)
        page.wait_for_timeout(450)

    # installed by Flav-Toolkit's Get add-ons: Flav-Toolkit starts and updates it
    page = boot(browser, kind="store")
    page.wait_for_timeout(500)
    calls = page.evaluate("() => window.__calls")
    check("store copy: no Start with Windows question", "Start with Windows" not in title(page), title(page))
    check("store copy: no move notice", "now comes with Flav-Toolkit" not in title(page), title(page))
    check("store copy: its own Start with Windows entry is taken away", ["autostart", {"on": False}] in calls)
    calls = page.evaluate("() => window.__calls")
    check("no copy checks GitHub for updates any more", not any(c[0].startswith("update_") for c in calls))
    settings_text = lambda page: page.evaluate("() => { document.querySelector('.tabs button[data-tab=\"settings\"]')?.click(); return new Promise((r) => setTimeout(() => r(document.body.innerText), 400)); }")
    text = settings_text(page)
    check("store copy: Settings say Flav-Toolkit starts and updates it", "Flav-Toolkit starts and stops the guide" in text and "its hub tells you when a new version is out" in text)
    check("store copy: no Start with Windows switch", "Start with Windows" not in text)
    page.close()

    # a copy from the old setup: the move notice once, after the Start with Windows question
    page = boot(browser, kind="setup")
    page.wait_for_timeout(500)
    check("setup copy: the Start with Windows question first", title(page) == "Start with Windows?", title(page))
    click_card(page, "No thanks")
    check("setup copy: then the move to Flav-Toolkit", title(page) == "Pet Farm Guide now comes with Flav-Toolkit", title(page))
    body = page.evaluate("() => document.querySelector('.ovcard .oc-b')?.textContent || ''")
    check("setup copy: it says how to remove the old copy and keep the data", "Settings › Apps" in body and "answer No" in body, body)
    click_card(page, "Get Flav-Toolkit")
    calls = page.evaluate("() => window.__calls")
    check("setup copy: Get Flav-Toolkit opens its release page", ["open_link", {"url": "https://github.com/Flavbestlol/flav-toolkit/releases/latest"}] in calls)
    prefs = json.loads(page.evaluate("() => window.__files.own.prefs || '{}'") or "{}")
    check("setup copy: the notice is told once", prefs.get("ovMoveTold") is True, prefs)
    page.close()
    page = boot(browser, {"own": {"prefs": json.dumps(prefs)}}, kind="setup")
    page.wait_for_timeout(500)
    check("setup copy: not told again at the next start", title(page) == "", title(page))
    text = settings_text(page)
    check("setup copy: Settings say it gets no more updates, and how to move", "None for this copy" in text)
    page.close()

    # ── the tour waits for the guide to be on screen (CORE, 2026-10-25: a tip around a lone button
    # while the game wasn't in front) ──
    tour_ids = ["route", "size", "list", "lock", "edit", "grip", "fold"]  # every tip but "options"
    prefs = {"folded": False, "tourSeen": tour_ids, "ovV": 2, "theme": "hud", "ovAutostartAsked": True, "ovMoveTold": True}
    saved = {"levels": {ids[0]: 2}, "points": {ids[0]: 5}, "syncedAt": int(time.time() * 1000) - 3600_000}
    files = {"own": {"prefs": json.dumps(prefs)}, "plugin": {"pets-server-1012": json.dumps(saved), "last": json.dumps("server-1012")}}
    tour_up = lambda page: page.evaluate("() => !!document.querySelector('.tourcard.in') && getComputedStyle(document.querySelector('.tourcard')).visibility === 'visible'")
    page = boot(browser, files, kind="store", game=[False, False], tour=True)
    page.wait_for_timeout(3000)
    check("tour: the guide has a stop to show", bool(page.evaluate("() => !!FG_model()")))
    check("tour: no tip while the game isn't in front (the guide is hidden)", not tour_up(page))
    check("tour: it doesn't even start then (nothing marked seen behind a hidden guide)", not page.evaluate("() => FG_tourOpen()"))
    page.evaluate("() => window.__emitHost('game', [true, true])")
    page.wait_for_timeout(3000)
    check("tour: the tip shows once the guide does", tour_up(page))
    on = page.evaluate("() => { const e = document.querySelector('.editbtn'); return e && e.checkVisibility({ opacityProperty: true, visibilityProperty: true }); }")
    check("tour: and its ring is around a button you can see", bool(on))
    page.evaluate("() => window.__emitHost('game', [false, false])")
    page.wait_for_timeout(600)
    check("tour: the tip hides with the guide when the game leaves", not page.evaluate("() => getComputedStyle(document.querySelector('.tourcard')).visibility === 'visible'"))
    page.close()

    # ── Flav-Toolkit's dock (core 0.12.0, `show toggle`): its icon opens the guide, a second click puts it away ──
    feedsrc = {"feed": True, "core": "0.12.0", "status": {"capturing": True, "game": True, "source": "live", "text": "Reading the game"}}
    page = boot(browser, {"own": {"prefs": json.dumps({"folded": True, "ovAutostartAsked": True, "ovMoveTold": True, "tourOff": True})}}, source=feedsrc, kind="store")
    hidden = lambda: page.evaluate("() => document.body.classList.contains('nogame')")
    folded = lambda: page.evaluate("() => FG_isFolded()")
    show = lambda w: (page.evaluate("(w) => window.__emitHost('show', w)", w), page.wait_for_timeout(400))
    check("dock: starts shown, folded into its tip", not hidden() and folded())
    show("toggle")
    check("dock: a click on the folded tip's icon opens the guide", not hidden() and not folded())
    show("toggle")
    check("dock: a second click puts it away, tip and all", hidden())
    hits = page.evaluate("() => window.__calls.filter(([c]) => c === 'set_hits').slice(-1)[0][1].rects")
    check("dock: put away, every click goes to the game", hits == [], hits)
    show("toggle")
    check("dock: a third click brings it back, open", not hidden() and not folded())
    show("toggle")
    show("open")
    check("dock: the hub's Open brings it back too", not hidden() and not folded())
    page.close()

    # ── the guide's settings in Flav-Toolkit's hub (ADDONS.md 4d) ──
    hubp = {"folded": True, "ovAutostartAsked": True, "ovMoveTold": True, "tourOff": True, "theme": "hud", "ovScale": 1, "ovBg": 0.66, "goal": 3, "rift": False}
    page = boot(browser, {"own": {"prefs": json.dumps(hubp)}}, source=feedsrc, kind="store", version="9.8.7")
    page.wait_for_timeout(700)
    sent = lambda: page.evaluate("() => window.__calls.filter(([c]) => c === 'feed_settings').map(([, a]) => a.groups)")
    item = lambda groups, key: next((i for g in groups for i in g["items"] if i["key"] == key), None)
    first = sent()
    check("hub settings: described once Flav-Toolkit is the source", len(first) == 1, len(first))
    groups = first[-1] if first else []
    names = [g["id"] for g in groups]
    check("hub settings: the Settings tab's groups, the overlay's last", names == ["you", "route", "tip", "map", "tips", "look", "sound", "overlay"], names)
    keys = [i["key"] for g in groups for i in g["items"]]
    check("hub settings: every key once", len(keys) == len(set(keys)), keys)
    check("hub settings: no list, layout or size of a part", not any(k in keys for k in ("priority", "layout", "mapSize", "gw", "view")), keys)
    th, sc, bg, fx, so = (item(groups, k) for k in ("theme", "ovScale", "ovBg", "effects", "sounds"))
    check("hub settings: theme is the shared Look (game = In-game)", th and th["value"] == "hud" and th["shared"] == {"id": "look", "map": {"game": "ingame"}} and ["ingame", "In-game"] in th["choices"], th)
    check("hub settings: Size is shared, 60–150 %", sc and sc["shared"] == {"id": "size"} and (sc["min"], sc["max"], sc["value"], sc.get("percent")) == (0.6, 1.5, 1, True), sc)
    check("hub settings: the background is the shared See-through (0–100 % → 0–0.9)", bg and bg["shared"] == {"id": "solid", "scale": 0.01} and bg["value"] == 0.66 and bg["max"] == 0.9, bg)
    check("hub settings: effects and sounds are the shared Animations and Sounds", fx and fx["shared"] == {"id": "motion"} and so and so["shared"] == {"id": "sounds"}, (fx, so))
    auto = item(groups, "ovAutostart")
    check("hub settings: a store copy's Start with Windows is shown greyed, with why", auto and auto.get("disabled") == "The store's copy starts with Flav-Toolkit", auto)
    check("hub settings: choices travel as text (goal 3 → \"3\")", item(groups, "goal")["value"] == "3" and ["2", "2"] in item(groups, "goal")["choices"], item(groups, "goal"))
    check("hub settings: Rift alerts greyed while the Rift route is off", item(groups, "riftAlert").get("disabled"), item(groups, "riftAlert"))
    check("hub settings: Tour and Next screen are buttons", item(groups, "tourAgain")["kind"] == "action" and item(groups, "nextScreen")["kind"] == "action", (item(groups, "tourAgain"), item(groups, "nextScreen")))
    out = ROOT / "tests" / "overlay" / "out"
    out.mkdir(exist_ok=True)
    (out / "hub-settings.json").write_text(json.dumps(groups, indent=1))  # tests/feed_core checks it against the core's rules

    # changes from the hub
    hub = lambda k, v: (page.evaluate("([k, v]) => window.__emitHost('setting', { key: k, value: v })", [k, v]), page.wait_for_timeout(500))
    hub("theme", "ingame")
    check("hub → theme In-game: the guide changes look", page.evaluate("() => FG_prefs().theme === 'ingame' && document.body.classList.contains('ingame')"))
    check("hub → theme: described again with the new value", item(sent()[-1], "theme")["value"] == "ingame", item(sent()[-1], "theme"))
    hub("ovScale", 1.2)
    check("hub → Size 120 %: the overlay grows", page.evaluate("() => getComputedStyle(document.documentElement).getPropertyValue('--ov-scale').trim()") == "1.2")
    hub("ovBg", 0.5)
    check("hub → See-through: the background follows", page.evaluate("() => getComputedStyle(document.documentElement).getPropertyValue('--ov-bg').trim()") == "0.5")
    hub("goal", "2")
    check("hub → Goal level \"2\": stored as the number 2", page.evaluate("() => FG_prefs().goal") == 2)
    hub("effects", False)
    check("hub → Animations off: no effects", page.evaluate("() => FG_prefs().effects === false && document.body.classList.contains('nofx')"))
    saved = page.evaluate("() => JSON.parse(window.__files.own.prefs)")
    check("hub → each change is saved as the guide saves it", saved.get("theme") == "ingame" and saved.get("goal") == 2 and saved.get("ovScale") == 1.2, {k: saved.get(k) for k in ("theme", "goal", "ovScale")})
    n = len(sent())
    hub("riftAlert", "off")
    hub("ovAutostart", True)
    hub("nope", 1)
    hub("goal", "7")
    check("hub → greyed, unknown or invalid: nothing changes, nothing sent", len(sent()) == n and page.evaluate("() => FG_prefs().riftAlert === 'on' && FG_prefs().goal === 2 && !window.__calls.some(([c, a]) => c === 'autostart' && a.on)"), len(sent()) - n)
    hub("nextScreen", True)
    check("hub → Next screen: the overlay moves", page.evaluate("() => window.__calls.some(([c]) => c === 'next_screen')"))
    page.evaluate("() => document.querySelector('.tabs button[data-tab=\"settings\"]')?.click()")
    page.wait_for_timeout(400)
    page.evaluate("() => FG_hubSettings.set('freeAuto', !FG_prefs().freeAuto)")  # warm-up: settings tab open
    page.wait_for_timeout(500)
    n = len(sent())
    page.evaluate("() => { const b = [...document.querySelectorAll('.row')].find((r) => r.textContent.startsWith('Next stop by itself'))?.querySelector('button.toggle'); b && b.click(); }")
    page.wait_for_timeout(600)
    check("a change in the guide's own Settings tab reaches the hub", len(sent()) == n + 1 and item(sent()[-1], "autoNext")["value"] == page.evaluate("() => FG_prefs().autoNext"), len(sent()) - n)
    page.evaluate("() => FG_OV.prefsSaved()")
    page.wait_for_timeout(500)
    check("a save that changes nothing the hub shows sends nothing", len(sent()) == n + 1, len(sent()) - n)
    check("Settings › Overlay shows addon.json's version, not a built-in one", "Version 9.8.7" in page.evaluate("() => document.body.innerText"))
    page.close()

    # an older core (no feed, A2 Tools): nothing is described
    page = boot(browser, version="9.8.7")
    page.wait_for_timeout(500)
    check("hub settings: nothing sent without Flav-Toolkit", not page.evaluate("() => window.__calls.some(([c]) => c === 'feed_settings')"))
    page.close()

    browser.close()

server.shutdown()
if errors:
    print("console:\n  " + "\n  ".join(errors[:20]))
if failures or errors:
    sys.exit(1)
print("all good")
