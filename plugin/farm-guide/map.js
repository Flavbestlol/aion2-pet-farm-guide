// The small map: tiles on one canvas, the farm circle, spawns and markers on another above it
// (so tiles can never paint over the markers). Two views: the way there (Kibelisk + circle) and the
// farm circle; it glides between them. Drag to pan, wheel to zoom, double-click to switch views.
(function () {
  "use strict";
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const imgCache = new Map();
  function image(src, onload) {
    let e = imgCache.get(src);
    if (!e) {
      e = { img: new Image(), ok: false, bad: false, waiters: [] };
      e.img.decoding = "async";
      e.img.onload = () => { e.ok = true; for (const w of e.waiters.splice(0)) w(); };
      e.img.onerror = () => { e.bad = true; e.waiters.length = 0; };
      e.img.src = src;
      imgCache.set(src, e);
    }
    if (!e.ok && !e.bad && onload && !e.waiters.includes(onload)) e.waiters.push(onload);
    return e;
  }
  function rgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  class MapView {
    constructor(wrap, data) {
      this.D = data;
      this.wrap = wrap;
      this.tc = wrap.querySelector("canvas.tiles");
      this.oc = wrap.querySelector("canvas.overlay");
      this.t = this.tc.getContext("2d");
      this.o = this.oc.getContext("2d");
      this.hint = wrap.querySelector(".maphint");
      this.view = { cx: 4096, cy: 4096, mpp: 20 };
      this.stop = null;
      this.mode = "way";
      this.flash = 0;
      this.anim = null;
      this.raf = 0;
      this.userMoved = false;
      this.fading = new Map(); // pid → alpha, markers leaving the map
      this.onToggle = null;
      this.showLoop = true;
      this.showIcons = true;
      this.liveT = 0;
      document.addEventListener("visibilitychange", () => this.wake());
      // the guide folding/unfolding or the overlay showing/hiding changes classes on <body>
      new MutationObserver(() => this.wake()).observe(document.body, { attributes: true, attributeFilter: ["class"] });
      this.setTheme("classic");
      new ResizeObserver(() => this.resize()).observe(wrap);
      this.resize();
      this.bind();
    }
    // colours of what the map draws on top of the tiles, per theme
    setTheme(name) {
      this.theme = name;
      this.pal = name === "apple" || name === "hud"
        ? { ring: "rgba(255,255,255,0.95)", ringHi: "255,255,255", glow: "rgba(255,255,255,0.7)", walk: "rgba(255,255,255,0.92)", walkUnder: "rgba(0,0,0,0.35)",
            pill: "rgba(0,0,0,0.5)", pillText: "#ffffff", kibFill: "rgba(0,0,0,0.5)", kibLine: "#ffffff", kibGlow: "rgba(255,255,255,0.8)", kibText: "#ffffff" }
        : name === "ingame"
        ? { ring: "rgba(255,226,150,0.95)", ringHi: "255,245,215", glow: "rgba(255,214,120,0.75)", walk: "rgba(255,255,255,0.92)", walkUnder: "rgba(0,0,0,0.4)",
            pill: "rgba(8,10,14,0.62)", pillText: "#ffffff", kibFill: "rgba(8,10,14,0.6)", kibLine: "#ffffff", kibGlow: "rgba(150,210,255,0.85)", kibText: "#ffffff" }
        : { ring: "rgba(242,195,91,0.95)", ringHi: "255,231,166", glow: "rgba(242,195,91,0.8)", walk: "#f2c35b", walkUnder: "rgba(30,22,6,0.55)",
            pill: "rgba(12,15,24,0.88)", pillText: "#ece4d0", kibFill: "#1b2a44", kibLine: "#a9cbff", kibGlow: "rgba(127,178,255,0.9)", kibText: "#cfe0ff" };
      if (this.w) this.redraw();
    }
    resize() {
      // layout size, not the on-screen box: an opening/closing animation or a zoom must not shrink the canvas
      this.w = Math.max(1, this.wrap.clientWidth);
      this.h = Math.max(1, this.wrap.clientHeight);
      this.dpr = window.devicePixelRatio || 1;
      for (const c of [this.tc, this.oc]) {
        c.width = Math.round(this.w * this.dpr);
        c.height = Math.round(this.h * this.dpr);
      }
      if (this.stop && !this.anim && !this.userMoved) this.view = this.targetView(this.mode);
      this.redraw();
    }
    // ── views ──────────────────────────────────────────
    targetView(mode) {
      const s = this.stop;
      if (!s) return this.view;
      const minSide = Math.min(this.w, this.h);
      if (mode === "farm" || !s.kib) {
        // the farm view frames the circle and the whole farming loop
        let x0 = s.x - s.r, x1 = s.x + s.r, y0 = s.y - s.r, y1 = s.y + s.r;
        const L = this.showLoop && s.loop;
        if (L) for (const p of L.pockets) {
          const e = (L.ring || p.r || 0) + 6;
          x0 = Math.min(x0, p.x - e); x1 = Math.max(x1, p.x + e); y0 = Math.min(y0, p.y - e); y1 = Math.max(y1, p.y + e);
        }
        const pad = 18, round = document.body.classList.contains("map-round") ? 1.25 : 1;
        const mpp = Math.max((s.r * 2.9) / minSide, (((x1 - x0) / Math.max(40, this.w - pad * 2)) * round), (((y1 - y0) / Math.max(40, this.h - pad * 2)) * round));
        return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, mpp };
      }
      const k = s.kib, g = s.gate || k;
      const x0 = Math.min(k.x, g.x, s.x - s.r), x1 = Math.max(k.x, g.x, s.x + s.r);
      const y0 = Math.min(k.y, g.y, s.y - s.r), y1 = Math.max(k.y, g.y, s.y + s.r);
      const pad = 34;
      const mpp = Math.max((x1 - x0) / Math.max(40, this.w - pad * 2), (y1 - y0) / Math.max(40, this.h - pad * 2), (s.r * 2.9) / minSide);
      return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, mpp };
    }
    setStop(stop, { mode = "way", instant = false } = {}) {
      const changed = !this.stop || this.stop.key !== stop?.key;
      this.stop = stop;
      if (!stop) return this.redraw();
      if (changed) {
        this.fading.clear();
        this.userMoved = false;
        this.mode = mode;
        this.flyTo(this.targetView(mode), instant ? 0 : 1100);
      } else {
        // the loop reshaped (a pet finished): reframe, unless you've moved the map yourself
        const sig = stop.loop ? stop.loop.pockets.map((p) => `${p.x}:${p.y}`).join("|") + (stop.loop.ring || "") : "";
        if (sig !== this.loopSig && this.loopSig !== undefined && !this.userMoved && !this.anim && this.mode === "farm") this.flyTo(this.targetView("farm"), 700);
        else this.redraw();
      }
      this.loopSig = stop.loop ? stop.loop.pockets.map((p) => `${p.x}:${p.y}`).join("|") + (stop.loop.ring || "") : "";
      this.updateHint();
    }
    setMode(mode, ms = 1000) {
      if (!this.stop) return;
      this.mode = mode;
      this.userMoved = false;
      this.flyTo(this.targetView(mode), ms);
      this.updateHint();
    }
    updateHint() {
      if (!this.stop) return (this.hint.textContent = "");
      this.hint.textContent = this.mode === "way" ? "The way there · double-click for the farm circle" : `${this.D.maps[this.stop.map].name} · farm circle ${this.stop.r * 2} m`;
    }
    flyTo(target, ms) {
      const from = { ...this.view };
      // a long jump (another map, or far away) cuts instead of gliding
      if (!ms || from.map !== (this.stop && this.stop.map) || Math.hypot(target.cx - from.cx, target.cy - from.cy) > 2500) {
        this.view = { ...target, map: this.stop && this.stop.map };
        this.anim = null;
        return this.redraw();
      }
      this.anim = { from, to: target, t0: performance.now(), ms };
      this.kick();
    }
    pulse() {
      this.flash = performance.now();
      this.kick();
    }
    fadeOut(pid) {
      this.fading.set(String(pid), performance.now());
      this.kick();
    }
    kick() {
      if (!this.raf) this.raf = requestAnimationFrame((n) => this.frame(n));
    }
    frame(now) {
      this.raf = 0;
      let more = false;
      if (this.anim) {
        const a = this.anim;
        const k = Math.min(1, (now - a.t0) / a.ms), e = easeInOut(k);
        // zoom out a little mid-way, then in: reads as a glide rather than a slide
        const bump = Math.sin(Math.PI * e) * 0.35;
        this.view = {
          map: this.stop && this.stop.map,
          cx: a.from.cx + (a.to.cx - a.from.cx) * e,
          cy: a.from.cy + (a.to.cy - a.from.cy) * e,
          mpp: Math.exp(Math.log(a.from.mpp) + (Math.log(a.to.mpp) - Math.log(a.from.mpp)) * e + bump * Math.abs(Math.log(a.to.mpp / a.from.mpp)) * 0.5),
        };
        if (k < 1) more = true;
        else this.anim = null;
      }
      if (now - this.flash < 900) more = true;
      for (const t of this.fading.values()) if (now - t < 700) more = true;
      this.redraw(now);
      if (more) this.kick();
      else if (this.loopLive()) {
        // the loop's arrows keep moving: ~20 frames a second is plenty and cheap
        this.wake();
      }
    }
    // keep the loop's arrows moving whenever they're on screen (called after any redraw or change)
    wake() {
      if (this.raf || this.liveT || !this.loopLive()) return;
      this.liveT = setTimeout(() => { this.liveT = 0; this.liveTick(); }, 50);
    }
    // between full frames only the overlay layer is repainted (the tiles don't move)
    liveTick() {
      if (this.raf || !this.loopLive()) return;
      try { this.drawOverlay(performance.now()); } catch (e) { console.warn("overlay", e); }
      this.wake();
    }
    loopLive() {
      const L = this.stop && this.stop.loop;
      return !!(this.showLoop && L && (L.pockets.length > 1 || L.ring) && !document.hidden && this.visible() && this.stop.r / this.view.mpp > 40);
    }
    // ── coordinates ────────────────────────────────────
    toCanvas(x, y) {
      const v = this.view;
      return { x: (x - v.cx) / v.mpp + this.w / 2, y: (y - v.cy) / v.mpp + this.h / 2 };
    }
    toScreen(x, y) {
      const r = this.wrap.getBoundingClientRect();
      const p = this.toCanvas(x, y);
      const k = r.width / this.w || 1; // the card may be zoomed (overlay size setting)
      return { x: r.left + Math.max(0, Math.min(this.w, p.x)) * k, y: r.top + Math.max(0, Math.min(this.h, p.y)) * k };
    }
    visible() {
      if (this.wrap.offsetParent === null || this.w < 10 || this.h < 10) return false;
      // folded into the tip, or the overlay hidden: still laid out, but invisible
      if (typeof this.wrap.checkVisibility === "function") return this.wrap.checkVisibility({ opacityProperty: true, visibilityProperty: true });
      return !document.body.matches(".folded, .nogame");
    }
    // ── drawing ────────────────────────────────────────
    redraw(now = performance.now()) {
      try { this.drawTiles(); } catch (e) { console.warn("tiles", e); }
      try { this.drawOverlay(now); } catch (e) { console.warn("overlay", e); }
      this.wake();
    }
    drawTiles() {
      const c = this.t, s = this.stop;
      c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      if (!s) { c.clearRect(0, 0, this.w, this.h); return; }
      const m = this.D.maps[s.map];
      c.fillStyle = m.bg;
      c.fillRect(0, 0, this.w, this.h);
      const v = this.view;
      const redraw = () => this.kick();
      const ov = image(`${m.tiles}/overview.webp`, redraw);
      if (ov.ok) {
        const p = this.toCanvas(0, 0);
        c.drawImage(ov.img, p.x, p.y, m.size / v.mpp, m.size / v.mpp);
      }
      // coarse layer under the fine one, so missing fine tiles (sea) never show as holes
      const layers = [];
      if (v.mpp < 14) layers.push(m.coarse);
      if (v.mpp < 1.4) layers.push(m.fine);
      for (const z of layers) {
        const tm = 256 * Math.pow(2, m.fine - z); // metres per tile
        const x0 = Math.max(0, Math.floor((v.cx - (this.w / 2) * v.mpp) / tm));
        const x1 = Math.min(m.size / tm - 1, Math.floor((v.cx + (this.w / 2) * v.mpp) / tm));
        const y0 = Math.max(0, Math.floor((v.cy - (this.h / 2) * v.mpp) / tm));
        const y1 = Math.min(m.size / tm - 1, Math.floor((v.cy + (this.h / 2) * v.mpp) / tm));
        for (let tx = x0; tx <= x1; tx++)
          for (let ty = y0; ty <= y1; ty++) {
            if (!this.hasTile(m, z, tx, ty)) continue;
            const e = image(`${m.tiles}/${z}/${tx}/${ty}.webp`, redraw);
            if (!e.ok) continue;
            const p = this.toCanvas(tx * tm, ty * tm);
            const size = tm / v.mpp;
            c.drawImage(e.img, Math.floor(p.x), Math.floor(p.y), Math.ceil(size) + 1, Math.ceil(size) + 1);
          }
      }
    }
    hasTile(m, z, x, y) {
      if (!m._have) { m._have = {}; for (const [k, v] of Object.entries(m.have || {})) m._have[k] = new Set(v.split(" ")); }
      const set = m._have[z];
      return !set || set.has(`${x}/${y}`);
    }
    drawOverlay(now) {
      const c = this.o, s = this.stop;
      c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      c.clearRect(0, 0, this.w, this.h);
      if (!s) return;
      const v = this.view;
      const ctr = this.toCanvas(s.x, s.y);
      const rad = s.r / v.mpp;
      const abyss = s.map === "A";
      // soften the world outside the circle in the farm view
      if (rad > 30) {
        c.save();
        c.fillStyle = abyss ? "rgba(6,8,14,0.35)" : "rgba(20,16,8,0.22)";
        c.beginPath();
        c.rect(0, 0, this.w, this.h);
        c.arc(ctr.x, ctr.y, rad, 0, Math.PI * 2, true);
        c.fill("evenodd");
        c.restore();
      }
      // walk line from the Kibelisk to the circle (or to the island's Windstream, then the ride over)
      const line = (a, b, cut0, cut1, dash, under) => {
        const d = Math.hypot(b.x - a.x, b.y - a.y);
        if (d <= cut0 + cut1 + 2) return;
        const ux = (b.x - a.x) / d, uy = (b.y - a.y) / d;
        c.save();
        c.setLineDash(dash);
        c.lineDashOffset = -now / 60;
        c.beginPath();
        c.moveTo(a.x + ux * cut0, a.y + uy * cut0);
        c.lineTo(b.x - ux * cut1, b.y - uy * cut1);
        if (under) {
          c.strokeStyle = this.pal.walkUnder;
          c.lineWidth = 4;
          c.stroke();
        }
        c.strokeStyle = this.pal.walk;
        c.lineWidth = under ? 2 : 1.6;
        c.globalAlpha = under ? 1 : 0.8;
        c.stroke();
        c.restore();
      };
      if (s.kib) {
        const k = this.toCanvas(s.kib.x, s.kib.y);
        if (s.gate) {
          const g = this.toCanvas(s.gate.x, s.gate.y);
          line(k, g, 9, 7, [5, 5], true);
          line(g, ctr, 7, rad, [1.5, 6], false); // the ride
          // the Windstream: three swirls
          c.save();
          c.translate(g.x, g.y);
          c.shadowColor = this.pal.kibGlow;
          c.shadowBlur = 8;
          c.strokeStyle = this.pal.kibLine;
          c.lineWidth = 1.6;
          c.lineCap = "round";
          for (const [dy, w] of [[-4, 7], [0, 9], [4, 6]]) {
            c.beginPath();
            c.moveTo(-w, dy);
            c.quadraticCurveTo(0, dy - 3, w, dy);
            c.stroke();
          }
          c.restore();
        } else if (Math.hypot(ctr.x - k.x, ctr.y - k.y) > rad + 8) line(k, ctr, 9, rad, [5, 5], true);
      }
      // spawn dots
      const far = v.mpp > 1.6;
      for (const d of s.dots || []) {
        if (far && !d.focus) continue;
        const a = this.alphaOf(d.pid, now);
        if (a <= 0) continue;
        const p = this.toCanvas(d.x, d.y);
        if (p.x < -10 || p.y < -10 || p.x > this.w + 10 || p.y > this.h + 10) continue;
        if (d.camp) {
          // a camp the database only knows by its centre and count: drawn as an area
          const cr = Math.max(6, d.camp / v.mpp);
          c.globalAlpha = a * (d.focus ? 1 : d.bonus ? 0.5 : 0.8);
          c.fillStyle = d.color;
          c.save();
          c.globalAlpha *= 0.16;
          c.beginPath();
          c.arc(p.x, p.y, cr, 0, Math.PI * 2);
          c.fill();
          c.restore();
          c.save();
          c.setLineDash([4, 3]);
          c.strokeStyle = d.color;
          c.lineWidth = 1.4;
          c.beginPath();
          c.arc(p.x, p.y, cr, 0, Math.PI * 2);
          c.stroke();
          c.restore();
        }
        const r = (d.focus ? 3.4 : 2.6) + Math.min(3, (d.c - 1) * 0.5);
        c.globalAlpha = a * (d.focus ? 1 : d.bonus ? 0.45 : 0.75);
        c.fillStyle = "rgba(0,0,0,0.55)";
        c.beginPath();
        c.arc(p.x, p.y + 0.6, r + 1.2, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = d.color;
        c.beginPath();
        c.arc(p.x, p.y, r, 0, Math.PI * 2);
        c.fill();
        if (d.focus) {
          c.strokeStyle = "rgba(255,255,255,0.85)";
          c.lineWidth = 1;
          c.stroke();
        }
      }
      c.globalAlpha = 1;
      if (this.showLoop && s.loop && rad > 40) this.drawLoop(c, s.loop, now);
      const drawCircle = () => {
      // the circle, with a flash when a soul comes in
      const fl = Math.max(0, 1 - (now - this.flash) / 900);
      c.save();
      c.shadowColor = this.pal.glow;
      c.shadowBlur = 8 + fl * 16;
      c.strokeStyle = fl ? `rgba(${this.pal.ringHi},${0.85 + fl * 0.15})` : this.pal.ring;
      c.lineWidth = 2 + fl * 2;
      c.beginPath();
      c.arc(ctr.x, ctr.y, Math.max(far ? 19 : 6, rad), 0, Math.PI * 2);
      c.stroke();
      c.restore();
      if (rad < 14) {
        // far away: a beacon in the middle so the spot is easy to find
        c.fillStyle = this.pal.ring;
        c.beginPath();
        c.arc(ctr.x, ctr.y, 3, 0, Math.PI * 2);
        c.fill();
      }
      };
      if (!far) drawCircle();
      // pet markers: portrait + ×N, nudged apart when they overlap
      const marks = (s.markers || []).filter((m) => (this.showIcons || far) && (!far || m.focus)).map((m) => ({ ...m, p: this.toCanvas(m.x, m.y), a: this.alphaOf(m.pid, now) })).filter((m) => m.a > 0);
      const R = 12;
      for (let it = 0; it < 6; it++)
        for (let i = 0; i < marks.length; i++)
          for (let j = i + 1; j < marks.length; j++) {
            const A = marks[i].p, B = marks[j].p;
            const dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy) || 0.01;
            if (d < R * 2 + 10) {
              const push = (R * 2 + 10 - d) / 2;
              A.x -= (dx / d) * push; A.y -= (dy / d) * push;
              B.x += (dx / d) * push; B.y += (dy / d) * push;
            }
          }
      marks.sort((a, b) => a.focus - b.focus);
      for (const m of marks) {
        const { x, y } = m.p;
        if (x < -R || y < -R || x > this.w + R || y > this.h + R) continue;
        c.globalAlpha = m.a * (m.bonus ? 0.6 : 1);
        const size = m.focus ? R + 2 : R;
        c.save();
        c.shadowColor = "rgba(0,0,0,0.6)";
        c.shadowBlur = 4;
        c.fillStyle = "#1b2030";
        c.beginPath();
        c.arc(x, y, size + 2, 0, Math.PI * 2);
        c.fill();
        c.restore();
        const e = image(m.img, () => this.kick());
        if (e.ok) {
          c.save();
          c.beginPath();
          c.arc(x, y, size, 0, Math.PI * 2);
          c.clip();
          c.drawImage(e.img, x - size, y - size, size * 2, size * 2);
          c.restore();
        }
        c.strokeStyle = m.color;
        c.lineWidth = m.focus ? 2.5 : 2;
        c.beginPath();
        c.arc(x, y, size + 1, 0, Math.PI * 2);
        c.stroke();
        if (m.n > 1) {
          const label = `×${m.n}`;
          c.font = "600 10px Bahnschrift, 'Segoe UI', sans-serif";
          const tw = c.measureText(label).width + 6;
          c.fillStyle = this.pal.pill;
          this.roundRect(c, x + size - 6, y + size - 9, tw, 13, 6);
          c.fill();
          c.fillStyle = this.pal.pillText;
          c.fillText(label, x + size - 3, y + size + 1);
        }
      }
      c.globalAlpha = 1;
      // far away the circle rings the focus marker, so it is never hidden under it
      if (far) drawCircle();
      if (this.showLoop && s.loop && rad > 40) this.drawLoopLabels(c, s.loop);
      // Kibelisk: a diamond and its label, flipped left near the right edge
      if (s.kib) {
        const k = this.toCanvas(s.kib.x, s.kib.y);
        if (k.x > -20 && k.y > -20 && k.x < this.w + 20 && k.y < this.h + 20) {
          c.save();
          c.translate(k.x, k.y);
          c.rotate(Math.PI / 4);
          c.shadowColor = this.pal.kibGlow;
          c.shadowBlur = 8;
          c.fillStyle = this.pal.kibFill;
          c.fillRect(-6, -6, 12, 12);
          c.strokeStyle = this.pal.kibLine;
          c.lineWidth = 1.6;
          c.strokeRect(-6, -6, 12, 12);
          c.restore();
          const label = s.kib.tp ? `#${s.kib.tp} ${s.kib.name}` : s.kib.name;
          c.font = "600 11px Bahnschrift, 'Segoe UI', sans-serif";
          const tw = c.measureText(label).width + 10;
          let lx = k.x + 12;
          if (lx + tw > this.w - 4) lx = k.x - 12 - tw;
          lx = Math.max(4, lx);
          const ly = Math.max(4, Math.min(this.h - 20, k.y - 8));
          c.fillStyle = this.pal.pill;
          this.roundRect(c, lx, ly, tw, 16, 5);
          c.fill();
          c.fillStyle = this.pal.kibText;
          c.fillText(label, lx + 5, ly + 12);
        }
      }
    }
    // the farming loop: lettered pockets, a smooth closed path through them, arrows running along it
    drawLoop(c, L, now) {
      const v = this.view;
      const P = L.pockets.map((p) => ({ ...this.toCanvas(p.x, p.y), r: Math.max(7, p.r / v.mpp), label: p.label }));
      const gold = "255,215,106";
      if (P.length > 1 || L.ring) {
        const closed = P.length > 2 || !!L.ring;
        // Catmull-Rom through the pocket centres (a lone camp: a ring around it)
        const pts = [];
        if (L.ring) {
          const rr = L.ring / v.mpp;
          for (let k = 0; k < 64; k++) { const a = (k / 64) * Math.PI * 2 - Math.PI / 2; pts.push({ x: P[0].x + Math.cos(a) * rr, y: P[0].y + Math.sin(a) * rr }); }
        } else {
        const n = P.length, segs = closed ? n : n - 1;
        const at = (i) => (closed ? P[((i % n) + n) % n] : P[Math.max(0, Math.min(n - 1, i))]);
        for (let i = 0; i < segs; i++) {
          const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
          for (let k = 0; k < 16; k++) {
            const t = k / 16, t2 = t * t, t3 = t2 * t;
            pts.push({
              x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
              y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
            });
          }
        }
        }
        pts.push(closed ? { ...pts[0] } : { x: P[P.length - 1].x, y: P[P.length - 1].y });
        c.save();
        c.lineJoin = c.lineCap = "round";
        c.beginPath();
        pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
        c.strokeStyle = "rgba(0,0,0,0.45)";
        c.lineWidth = 5;
        c.stroke();
        c.strokeStyle = `rgba(${gold},0.55)`;
        c.lineWidth = 2;
        c.stroke();
        // arrows: evenly spaced along the path, drifting forward
        const lens = [0];
        for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
        const total = lens[lens.length - 1], gap = 34;
        if (total > gap) {
          const off = (now / 45) % gap;
          c.fillStyle = `rgba(${gold},0.95)`;
          c.shadowColor = "rgba(0,0,0,0.7)";
          c.shadowBlur = 3;
          let j = 1;
          for (let d = off; d < total; d += gap) {
            while (j < lens.length - 1 && lens[j] < d) j++;
            const a = pts[j - 1], b = pts[j], seg = lens[j] - lens[j - 1] || 1, f = (d - lens[j - 1]) / seg;
            const x = a.x + (b.x - a.x) * f, y = a.y + (b.y - a.y) * f, ang = Math.atan2(b.y - a.y, b.x - a.x);
            c.save();
            c.translate(x, y);
            c.rotate(ang);
            c.beginPath();
            c.moveTo(5, 0); c.lineTo(-3.5, -4); c.lineTo(-1.5, 0); c.lineTo(-3.5, 4); c.closePath();
            c.fill();
            c.restore();
          }
        }
        c.restore();
      }
      // waypoints: a small gold dot each; where you are gets a glowing ring, the next one a ring
      P.forEach((p, i) => {
        const here = i === L.here, next = i === L.next;
        c.save();
        if (here || next) {
          c.setLineDash(here ? [] : [3, 3]);
          c.lineWidth = here ? 2.2 : 1.4;
          c.strokeStyle = `rgba(${gold},0.95)`;
          c.fillStyle = `rgba(${gold},${here ? 0.16 : 0.07})`;
          c.beginPath();
          c.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          c.fill();
          c.stroke();
        }
        if (here) {
          const k = (now % 1400) / 1400;
          c.setLineDash([]);
          c.strokeStyle = `rgba(${gold},${0.6 * (1 - k)})`;
          c.lineWidth = 2;
          c.beginPath();
          c.arc(p.x, p.y, p.r + 4 + k * 10, 0, Math.PI * 2);
          c.stroke();
        }
        c.setLineDash([]);
        c.beginPath();
        c.arc(p.x, p.y, 3.2, 0, Math.PI * 2);
        c.fillStyle = `rgb(${gold})`;
        c.strokeStyle = "rgba(0,0,0,0.75)";
        c.lineWidth = 1.5;
        c.stroke();
        c.fill();
        c.restore();
      });
    }
    // the pocket letters go on top of everything else
    drawLoopLabels(c, L) {
      const v = this.view, gold = "255,215,106";
      L.pockets.forEach((q, i) => {
        const here = i === L.here, next = i === L.next;
        if (!(here || next || i === 0 || L.pockets.length <= 4)) return; // letters only where they help
        const p = { ...this.toCanvas(q.x, q.y), r: Math.max(7, q.r / v.mpp) };
        c.save();
        const lx = p.x - 9, ly = p.y - 10;
        c.setLineDash([]);
        c.beginPath();
        c.arc(lx, ly, 8, 0, Math.PI * 2);
        c.fillStyle = here ? `rgb(${gold})` : next ? "rgba(20,16,6,0.92)" : "rgba(8,10,14,0.82)";
        c.fill();
        c.strokeStyle = `rgba(${gold},${here || next ? 1 : 0.7})`;
        c.lineWidth = 1.2;
        c.stroke();
        c.fillStyle = here ? "#17120a" : `rgb(${gold})`;
        c.font = "700 10px Bahnschrift, 'Segoe UI', sans-serif";
        c.textAlign = "center";
        c.textBaseline = "middle";
        c.fillText(q.label, lx, ly + 0.5);
        c.restore();
      });
    }
    alphaOf(pid, now) {
      const t = this.fading.get(String(pid));
      if (t === undefined) return 1;
      return Math.max(0, 1 - (now - t) / 700);
    }
    roundRect(c, x, y, w, h, r) {
      c.beginPath();
      c.moveTo(x + r, y);
      c.arcTo(x + w, y, x + w, y + h, r);
      c.arcTo(x + w, y + h, x, y + h, r);
      c.arcTo(x, y + h, x, y, r);
      c.arcTo(x, y, x + w, y, r);
      c.closePath();
    }
    // ── interaction ────────────────────────────────────
    bind() {
      let drag = null;
      this.wrap.addEventListener("pointerdown", (e) => {
        if (e.button !== 0 || e.target.closest("button")) return;
        drag = { x: e.clientX, y: e.clientY, cx: this.view.cx, cy: this.view.cy, moved: false };
        this.wrap.setPointerCapture(e.pointerId);
      });
      this.wrap.addEventListener("pointermove", (e) => {
        if (!drag) return;
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (!drag.moved && Math.hypot(dx, dy) < 4) return;
        drag.moved = true;
        this.anim = null;
        this.userMoved = true;
        const k = this.wrap.getBoundingClientRect().width / this.w || 1;
        this.view = { ...this.view, cx: drag.cx - (dx / k) * this.view.mpp, cy: drag.cy - (dy / k) * this.view.mpp };
        this.kick();
      });
      const end = () => { drag = null; };
      this.wrap.addEventListener("pointerup", end);
      this.wrap.addEventListener("pointercancel", end);
      this.wrap.addEventListener("wheel", (e) => {
        e.preventDefault();
        if (!this.stop) return;
        const r = this.wrap.getBoundingClientRect();
        const k = r.width / this.w || 1;
        const px = (e.clientX - r.left) / k - this.w / 2, py = (e.clientY - r.top) / k - this.h / 2;
        const v = this.view;
        const size = this.D.maps[this.stop.map].size;
        const mpp = Math.max(0.25, Math.min(size / Math.min(this.w, this.h), v.mpp * Math.exp(e.deltaY * 0.0015)));
        // keep the point under the cursor in place
        this.anim = null;
        this.userMoved = true;
        this.view = { ...v, mpp, cx: v.cx + px * (v.mpp - mpp), cy: v.cy + py * (v.mpp - mpp) };
        this.kick();
      }, { passive: false });
      this.wrap.addEventListener("dblclick", (e) => {
        if (e.target.closest("button")) return;
        this.toggle();
      });
      this.wrap.querySelector(".mapview").addEventListener("click", () => this.toggle());
    }
    toggle() {
      this.setMode(this.mode === "way" ? "farm" : "way");
      if (this.onToggle) this.onToggle(this.mode);
    }
  }
  window.MapView = MapView;
})();
