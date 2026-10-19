"""Build the files for one GitHub release of AION 2 Pet Farm Guide, signed.

    python make_release.py --plugin <farm-guide folder> --overlay <"Farm Guide Overlay" folder>
                           --overlay-version <v> --notes "What's new, one or two lines"
                           [--installer installer/setup.nsi] [--out release] [--key keys/farm-guide-release.key]

Writes into <out>/v<plugin version>/:
  Farm-Guide-Setup-<v>.exe         the installer: plugin and overlay, added to A2 Tools for you (needs makensis)
  Farm-Guide-Plugin-<v>.zip        the plugin (top folder farm-guide/), for updates and by-hand installs
  Farm-Guide-Overlay-<v>.zip       the overlay folder, for new installs
  Farm-Guide-Overlay.exe           the overlay alone, for the overlay's own updater
  latest.json, latest.json.sig     what's new and where, with SHA-256s; signed with the release key
  RELEASE.md                       text for the GitHub release page

Upload every file in that folder to a new GitHub release tagged v<plugin version> (mark it Latest).
The overlay finds it at releases/latest/download/latest.json and installs only what the key signed.
"""
import argparse, hashlib, json, os, shutil, subprocess, sys, tempfile, zipfile, datetime
from pathlib import Path

REPO = "Flavbestlol/aion2-pet-farm-guide"
PLUGIN_TYPES = {".html", ".js", ".css", ".json", ".png", ".jpg", ".jpeg", ".webp", ".svg", ".gif", ".md", ".txt"}
MAX_PLUGIN = 8 * 1024 * 1024  # A2 Tools' catalog limit
OVERLAY_FILES = ["Farm Guide Overlay.exe", "WebView2Loader.dll", "README.txt", "Update Overlay.cmd"]


def sha256(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def sign(data, key_file):
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    key = Ed25519PrivateKey.from_private_bytes(bytes.fromhex(Path(key_file).read_text().strip()))
    return key.sign(data).hex()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--plugin", required=True)
    ap.add_argument("--overlay", required=True)
    ap.add_argument("--overlay-version", required=True)
    ap.add_argument("--notes", required=True)
    ap.add_argument("--installer", default=str(Path(__file__).resolve().parent.parent / "installer" / "setup.nsi"))
    ap.add_argument("--out", default="release")
    ap.add_argument("--key", default=str(Path(__file__).with_name("keys") / "farm-guide-release.key"))
    a = ap.parse_args()

    plugin = Path(a.plugin)
    manifest = json.loads((plugin / "manifest.json").read_text(encoding="utf-8"))
    if manifest.get("id") != "farm-guide":
        sys.exit("that folder isn't Farm Guide")
    pv, ov = manifest["version"], a.overlay_version
    tag = f"v{pv}"
    out = Path(a.out) / tag
    out.mkdir(parents=True, exist_ok=True)

    # the plugin: only what a plugin may hold, within A2 Tools' size limit
    files, total = [], 0
    for f in sorted(plugin.rglob("*")):
        if f.is_dir():
            continue
        if f.suffix.lower() not in PLUGIN_TYPES:
            sys.exit(f"not a plugin file type: {f.relative_to(plugin)}")
        if f.name != "README.md":
            total += f.stat().st_size
        files.append(f)
    if total > MAX_PLUGIN:
        sys.exit(f"plugin is {total / 1048576:.2f} MB, over A2 Tools' 8 MB")
    pzip = out / f"Farm-Guide-Plugin-{pv}.zip"
    with zipfile.ZipFile(pzip, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for f in files:
            z.write(f, "farm-guide/" + f.relative_to(plugin).as_posix())

    # the overlay: a folder for new installs, and the exe alone for the updater
    overlay = Path(a.overlay)
    ozip = out / f"Farm-Guide-Overlay-{ov}.zip"
    with zipfile.ZipFile(ozip, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for name in OVERLAY_FILES:
            if (overlay / name).is_file():
                z.write(overlay / name, f"Farm Guide Overlay/{name}")
    exe = out / "Farm-Guide-Overlay.exe"
    exe.write_bytes((overlay / "Farm Guide Overlay.exe").read_bytes())
    if not exe.read_bytes().startswith(b"MZ"):
        sys.exit("the overlay exe isn't a Windows program")

    # the installer: the same plugin files as the zip, and the overlay
    setup = out / f"Farm-Guide-Setup-{pv}.exe"
    nsi = Path(a.installer)
    if nsi.is_file():
        with tempfile.TemporaryDirectory() as tmp:
            payload = Path(tmp)
            with zipfile.ZipFile(pzip) as z:
                z.extractall(payload)
            for name in ("Farm Guide Overlay.exe", "WebView2Loader.dll"):
                shutil.copy2(overlay / name, payload / name)
            r = subprocess.run(["makensis", "-V2", f"-DVERSION={pv}", f"-DOVERLAY_VERSION={ov}", f"-DPAYLOAD={payload}",
                                f"-DOUTFILE={setup.resolve()}", str(nsi)], capture_output=True, text=True)
            if r.returncode != 0:
                sys.exit("makensis failed:\n" + r.stdout[-3000:] + r.stderr[-3000:])
    else:
        print(f"no installer script at {nsi}: skipping the setup")

    base = f"https://github.com/{REPO}/releases/download/{tag}"
    feed = {
        "version": pv,
        "date": datetime.date.today().isoformat(),
        "notes": a.notes,
        "overlay": {"version": ov, "url": f"{base}/{exe.name}", "sha256": sha256(exe), "size": exe.stat().st_size},
        "plugin": {"version": pv, "url": f"{base}/{pzip.name}", "sha256": sha256(pzip), "size": pzip.stat().st_size},
    }
    body = json.dumps(feed, indent=2).encode()
    (out / "latest.json").write_bytes(body)
    (out / "latest.json.sig").write_text(sign(body, a.key))
    (out / "RELEASE.md").write_text(
        f"## AION 2 Pet Farm Guide {pv}\n\n{a.notes}\n\n"
        f"- **New here?** Download **`{setup.name}`** and run it. It installs the guide and adds it to the A2 Tools DPS Meter for you.\n"
        f"- **Already installed?** The overlay offers this update by itself (Settings › Overlay › Updates). Running the new setup works too.\n"
        f"- **By hand?** `{pzip.name}` (the plugin) and `{ozip.name}` (the overlay): see *Install by hand* in the README.\n\n"
        f"Plugin {pv} · Overlay {ov}.\n",
        encoding="utf-8",
    )
    print(f"release {tag} in {out}:")
    for f in sorted(out.iterdir()):
        print(f"  {f.name:34} {f.stat().st_size:>10,} bytes")


if __name__ == "__main__":
    main()
