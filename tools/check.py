"""Repository rules, checked in CI (and before a release): python3 tools/check.py

- every JSON file parses;
- one version for the whole add-on: addon.json's, the plugin's, the overlay's (Cargo.toml, Cargo.lock,
  tauri.conf.json) and its README.txt's; the page reads it from addon.json, never hard-codes one;
- no key, certificate, capture or recording is tracked;
- the plugin stays under A2 Tools' 8 MB catalogue limit (its game images are not in git: counted
  only when present);
- addon.json (what Flav-Toolkit's packager reads, at the root) agrees with the plugin, and the
  overlay reaches no network;
- the overlay has no tray icon (Flav-Toolkit's dock and hub open, hide and stop it).
"""
import json, re, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
problems = []


def bad(msg):
    problems.append(msg)


def tracked():
    out = subprocess.run(["git", "ls-files", "-z"], cwd=ROOT, capture_output=True, check=True).stdout
    return [p for p in out.decode().split("\0") if p]


files = tracked()

# JSON parses (a byte-order mark is fine, as A2 Tools and Flav-Toolkit accept one)
for f in files:
    if f.endswith(".json"):
        try:
            json.loads((ROOT / f).read_text(encoding="utf-8-sig"))
        except Exception as e:  # noqa: BLE001
            bad(f"{f}: not valid JSON ({e})")

# one version, six places (the hub shows addon.json's; the overlay page reads it from there)
tauri = ROOT / "overlay/src-tauri"
cargo = re.search(r'^version\s*=\s*"([^"]+)"', (tauri / "Cargo.toml").read_text(), re.M)
conf = json.loads((tauri / "tauri.conf.json").read_text()).get("version")
lock = re.search(r'name = "farm-guide-overlay"\nversion = "([^"]+)"', (ROOT / "Cargo.lock").read_text())
readme = re.match(r"AION 2 PET FARM GUIDE (\S+)\n", (ROOT / "overlay/README.txt").read_text(encoding="utf-8"))
versions = {
    "addon.json": json.loads((ROOT / "addon.json").read_text(encoding="utf-8")).get("version"),
    "plugin manifest.json": json.loads((ROOT / "plugin/farm-guide/manifest.json").read_text(encoding="utf-8-sig")).get("version"),
    "Cargo.toml": cargo and cargo.group(1),
    "Cargo.lock": lock and lock.group(1),
    "tauri.conf.json": conf,
    "README.txt": readme and readme.group(1),
}
if len(set(versions.values())) != 1 or None in versions.values():
    bad(f"the version differs: {versions}")
for f in files:
    if f.startswith("overlay/web/") and f.endswith(".js") and re.search(r'VERSION\s*=\s*"\d', (ROOT / f).read_text(encoding="utf-8")):
        bad(f"{f}: a hard-coded version (the page reads addon.json's: invoke('addon_version'))")

# no tray icon of its own: Flav-Toolkit's dock and hub are the way in and out
if "tray-icon" in (tauri / "Cargo.toml").read_text() or "TrayIconBuilder" in (tauri / "src/main.rs").read_text():
    bad("the overlay has no tray icon (Flav-Toolkit's dock and hub open, hide and stop it): no tray-icon feature, no TrayIconBuilder")

# nothing private
FORBIDDEN = re.compile(r"(\.key|\.pem|\.p12|\.pfx|\.pcap|\.pcapng|\.etl|\.env)$|(^|/)(captures|recordings|keys|Private)/", re.I)
for f in files:
    if FORBIDDEN.search(f):
        bad(f"{f}: keys, captures and recordings never go in git")

# the plugin's size
plugin = ROOT / "plugin/farm-guide"
size = sum(p.stat().st_size for p in plugin.rglob("*") if p.is_file())
if size > 8 * 1024 * 1024:
    bad(f"the plugin is {size / 1048576:.1f} MB: A2 Tools' limit is 8 MB")

manifest = json.loads((plugin / "manifest.json").read_text(encoding="utf-8-sig"))
if manifest.get("id") != "farm-guide":
    bad("plugin/farm-guide/manifest.json: the id must stay farm-guide")

# addon.json (Flav-Toolkit's hub): the plugin's version, decoders that exist, the emblem's limits
addon = json.loads((ROOT / "addon.json").read_text(encoding="utf-8"))
if addon.get("permissions", {}).get("network"):
    bad("addon.json: the overlay reaches no network (Flav-Toolkit downloads its updates): permissions.network stays empty")
dec = addon.get("decoders", {})
if dec.get("manifest") != "farm-guide/manifest.json":
    bad("addon.json: decoders.manifest must be farm-guide/manifest.json (the plugin folder beside the exe)")
names = {d.get("name") for d in manifest.get("decoders", [])}
for k in dec.get("keep", []):
    if k not in names:
        bad(f"addon.json keeps {k!r}, which the plugin has no decoder for")
for k in ("soul-gained", "level-up"):
    if k in dec.get("keep", []):
        bad(f"addon.json must never keep {k!r}: a reconnect would count it twice")
emblem = (ROOT / "emblem.png").read_bytes()
w, h = int.from_bytes(emblem[16:20], "big"), int.from_bytes(emblem[20:24], "big")
if not emblem.startswith(b"\x89PNG") or (w, h) != (128, 128) or len(emblem) > 64 * 1024:
    bad(f"emblem.png must be a 128 x 128 PNG of at most 64 KB ({w} x {h}, {len(emblem)} bytes)")

if problems:
    print("\n".join("✗ " + p for p in problems))
    sys.exit(1)
print(f"✓ {len(files)} files: JSON, versions ({versions['Cargo.toml']}), nothing private, plugin {size / 1048576:.1f} MB")
