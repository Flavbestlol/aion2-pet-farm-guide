"""Repository rules, checked in CI (and before a release): python3 tools/check.py

- every JSON file parses;
- the overlay's version is the same in Cargo.toml, Cargo.lock, tauri.conf.json and host.js;
- no key, certificate, capture or recording is tracked;
- the plugin stays under A2 Tools' 8 MB catalogue limit (its game images are not in git: counted
  only when present).
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

# the overlay's version, four places
tauri = ROOT / "overlay/src-tauri"
cargo = re.search(r'^version\s*=\s*"([^"]+)"', (tauri / "Cargo.toml").read_text(), re.M)
conf = json.loads((tauri / "tauri.conf.json").read_text()).get("version")
host = re.search(r'const VERSION = "([^"]+)"', (ROOT / "overlay/web/host.js").read_text())
lock = re.search(r'name = "farm-guide-overlay"\nversion = "([^"]+)"', (tauri / "Cargo.lock").read_text())
versions = {
    "Cargo.toml": cargo and cargo.group(1),
    "Cargo.lock": lock and lock.group(1),
    "tauri.conf.json": conf,
    "host.js": host and host.group(1),
}
if len(set(versions.values())) != 1 or None in versions.values():
    bad(f"the overlay's version differs: {versions}")

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

if problems:
    print("\n".join("✗ " + p for p in problems))
    sys.exit(1)
print(f"✓ {len(files)} files: JSON, versions ({versions['Cargo.toml']}), nothing private, plugin {size / 1048576:.1f} MB")
