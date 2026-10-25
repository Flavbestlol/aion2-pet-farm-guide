"""Get the repository ready for Flav-Toolkit's add-on packager (its catalogue entry runs this first).

    python tools/store_build.py

Flav-Toolkit's CI then runs `cargo build --release --locked -p farm-guide-overlay` at the root and
zips what the catalogue entry lists: the exe, addon.json, emblem.png, LICENSE, README.txt and the
farm-guide folder this writes.

What it does:
  1. The game's images and map tiles are not in git. It takes them from a release zip of this
     repository pinned by size and SHA-256 below (ART), and refuses anything else.
  2. farm-guide/ at the root: the plugin as in git, plus those images and tiles. Flav-Toolkit
     runs its decoders from here (addon.json `decoders`), and A2 Tools can load it from the
     installed folder as the backup reader.
  3. The overlay's page, assembled from that folder (overlay/assemble.py), so the exe carries it.

FG_NO_ART=1 skips the images (CI's check build); FG_ART_ZIP=<file> uses a local copy of the zip
(it must still match ART).
"""
import hashlib, os, shutil, subprocess, sys, tempfile, urllib.request, zipfile
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parent.parent
# the game's images and map tiles: the plugin zip of release v1.24.0 (its farm-guide/img and
# farm-guide/tiles). A new set of images means a new pinned zip here, never an unpinned download.
ART = {
    "url": "https://github.com/Flavbestlol/aion2-pet-farm-guide/releases/download/v1.24.0/Farm-Guide-Plugin-1.24.0.zip",
    "size": 7198952,
    "sha256": "10e0892775cb1836e6db9485acf37309313152945d6ddea969d1f9d170d34584",
}
ART_DIRS = ("img", "tiles")
ART_TYPES = {".png", ".jpg", ".jpeg", ".webp", ".svg", ".gif"}
OUT = ROOT / "farm-guide"


def fail(msg):
    sys.exit(f"store_build: {msg}")


def art_zip(into):
    """The pinned zip's bytes, checked."""
    local = os.environ.get("FG_ART_ZIP")
    if local:
        data = Path(local).read_bytes()
    else:
        req = urllib.request.Request(ART["url"], headers={"User-Agent": "aion2-pet-farm-guide-store-build"})
        with urllib.request.urlopen(req, timeout=120) as r:
            data = r.read(ART["size"] + 1)
    if len(data) != ART["size"] or hashlib.sha256(data).hexdigest() != ART["sha256"]:
        fail("the images zip isn't the pinned one (size or SHA-256 differ): refused")
    path = Path(into) / "art.zip"
    path.write_bytes(data)
    return path


def unpack_art(zip_path, plugin):
    """Only farm-guide/img/** and farm-guide/tiles/** pictures, each path checked."""
    n = 0
    with zipfile.ZipFile(zip_path) as z:
        for info in z.infolist():
            if info.is_dir():
                continue
            p = PurePosixPath(info.filename)
            parts = p.parts
            if len(parts) < 3 or parts[0] != "farm-guide" or parts[1] not in ART_DIRS:
                continue
            if any(part in ("", ".", "..") or "\\" in part or ":" in part for part in parts) or p.suffix.lower() not in ART_TYPES:
                fail(f"an unexpected path in the images zip: {info.filename}")
            dest = plugin.joinpath(*parts[1:])
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(z.read(info))
            n += 1
    if n == 0:
        fail("the images zip holds no images")
    return n


def main():
    src = ROOT / "plugin" / "farm-guide"
    tracked = subprocess.run(["git", "ls-files", "-z", "plugin/farm-guide"], cwd=ROOT, capture_output=True, check=True).stdout.decode()
    files = [f for f in tracked.split("\0") if f]
    if not files:
        fail("no plugin files in git")
    shutil.rmtree(OUT, ignore_errors=True)
    OUT.mkdir()
    for f in files:
        rel = Path(f).relative_to("plugin/farm-guide")
        (OUT / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / f, OUT / rel)
    if os.environ.get("FG_NO_ART") == "1":
        print("store_build: no images (FG_NO_ART=1)")
    else:
        with tempfile.TemporaryDirectory() as tmp:
            n = unpack_art(art_zip(tmp), OUT)
        print(f"store_build: {n} images and tiles")
    env = dict(os.environ, FG_PLUGIN=str(OUT))
    subprocess.run([sys.executable, str(ROOT / "overlay" / "assemble.py")], cwd=ROOT, env=env, check=True)
    print(f"store_build: farm-guide/ ready ({sum(1 for p in OUT.rglob('*') if p.is_file())} files), the page assembled")


if __name__ == "__main__":
    main()
