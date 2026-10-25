"""Assemble the overlay's web files: the guide from the plugin, plus the overlay host."""
import os, shutil, re
from pathlib import Path
ROOT = Path(__file__).resolve().parent
# the plugin folder (with its images and map tiles: the release zip has them all)
PLUGIN = Path(os.environ.get('FG_PLUGIN', ROOT.parent / 'plugin' / 'farm-guide')).resolve()
WEB = ROOT / 'web'; UI = ROOT / 'ui'
shutil.rmtree(UI, ignore_errors=True); UI.mkdir(parents=True)
for f in ['data.js', 'community.js', 'engine.js', 'fx.js', 'map.js', 'app.js', 'style.css', 'ingame.css']:
    shutil.copy(PLUGIN / f, UI / f)
# the game's images and map tiles are not in git (fetched or bundled at release time): CI checks the
# build without them (FG_NO_ART=1), with empty folders in their place
for d in ['img', 'tiles']:
    if os.environ.get('FG_NO_ART') == '1' and not (PLUGIN / d).is_dir():
        (UI / d).mkdir()
    else:
        shutil.copytree(PLUGIN / d, UI / d)
for f in ['records.js', 'host.js', 'source-a2.js', 'source-feed.js', 'overlay.css', 'apple.css', 'hud.css']:
    shutil.copy(WEB / f, UI / f)
html = (PLUGIN / 'index.html').read_text(encoding='utf-8')
# the host stands in for A2 Tools' SDK; then the sources of game records: A2 Tools (source-a2.js)
# and Flav-Toolkit (source-feed.js)
html = html.replace('<script src="/_sdk/a2.js"></script>', '<script src="records.js"></script>\n    <script src="host.js"></script>\n    <script src="source-a2.js"></script>\n    <script src="source-feed.js"></script>')
html = html.replace('\n    <script src="bridge.js"></script>', '')
html = html.replace('<link rel="stylesheet" href="ingame.css" />', '<link rel="stylesheet" href="ingame.css" />\n    <link rel="stylesheet" href="apple.css" />\n    <link rel="stylesheet" href="overlay.css" />\n    <link rel="stylesheet" href="hud.css" />')
html = html.replace('<title>Farm Guide</title>', '<title>Farm Guide Overlay</title>')
# "nothing is being recorded": the source in use fills in what to do
notice = '\n      <div class="ovnotice" hidden></div>'
html = html.replace('      </header>', '      </header>' + notice, 1)
assert 'host.js' in html and 'source-a2.js' in html and 'source-feed.js' in html and 'overlay.css' in html and 'ovnotice' in html and 'bridge.js' not in html
(UI / 'index.html').write_text(html, encoding='utf-8')
print('ui assembled', sum(1 for _ in UI.rglob('*')), 'files')
