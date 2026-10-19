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
for d in ['img', 'tiles']:
    shutil.copytree(PLUGIN / d, UI / d)
for f in ['host.js', 'overlay.css', 'apple.css', 'hud.css']:
    shutil.copy(WEB / f, UI / f)
html = (PLUGIN / 'index.html').read_text()
html = html.replace('<script src="/_sdk/a2.js"></script>', '<script src="host.js"></script>')
html = html.replace('\n    <script src="bridge.js"></script>', '')
html = html.replace('<link rel="stylesheet" href="ingame.css" />', '<link rel="stylesheet" href="ingame.css" />\n    <link rel="stylesheet" href="apple.css" />\n    <link rel="stylesheet" href="overlay.css" />\n    <link rel="stylesheet" href="hud.css" />')
html = html.replace('<title>Farm Guide</title>', '<title>Farm Guide Overlay</title>')
notice = ('\n      <div class="ovnotice" hidden><b>Nothing is being recorded.</b> Open Farm Guide in A2 Tools '
          '(Settings → Plugins → Open). While this overlay runs it tucks itself away and keeps recording.</div>')
html = html.replace('      </header>', '      </header>' + notice, 1)
assert 'host.js' in html and 'overlay.css' in html and 'ovnotice' in html and 'bridge.js' not in html
(UI / 'index.html').write_text(html)
print('ui assembled', sum(1 for _ in UI.rglob('*')), 'files')
