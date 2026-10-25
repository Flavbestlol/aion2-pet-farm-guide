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


def boot(browser, files=None, source=None):
    page = browser.new_page(viewport={"width": 1600, "height": 900})
    page.on("console", lambda m: errors.append(f"{m.type}: {m.text}") if m.type == "error" and "Failed to load resource" not in m.text else None)
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    init = "window.__FILES=" + json.dumps(files or {}) + ";"
    if source is not None:
        init += "window.__source=" + json.dumps(source) + ";"
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
    check("A2 Tools: the plugin owns the counts (the overlay writes none of its own)", not any(k.startswith("pets-") for k in page.evaluate("() => Object.keys(window.__files.own)")))
    hb = page.evaluate("() => window.__files.plugin.overlay")
    check("A2 Tools: the overlay's heartbeat reaches the plugin", bool(hb) and json.loads(hb)["at"] > 0, hb)
    note = page.evaluate("() => document.querySelector('.ovnotice').textContent")
    check("A2 Tools: the not-recording notice says what to do", "A2 Tools" in note, note)
    page.evaluate("() => window.__emitHost('tray', 'quit')")
    page.wait_for_timeout(400)
    hb = json.loads(page.evaluate("() => window.__files.plugin.overlay"))
    check("A2 Tools: closing tells the plugin first, then quits", hb["at"] == 0 and page.evaluate("() => !!window.__quit"))
    page.close()

    # the plugin's saved counts are what the overlay starts from
    saved = {"levels": {ids[0]: 2}, "points": {ids[0]: 5}, "syncedAt": int(time.time() * 1000) - 3600_000}
    page = boot(browser, {"plugin": {"pets-server-1012": json.dumps(saved), "last": json.dumps("server-1012")}})
    page.wait_for_timeout(500)
    check("A2 Tools: starts from the plugin's saved counts", page.evaluate("() => FG_key()") == "server-1012")
    page.close()

    browser.close()

server.shutdown()
if errors:
    print("console:\n  " + "\n  ".join(errors[:20]))
if failures or errors:
    sys.exit(1)
print("all good")
