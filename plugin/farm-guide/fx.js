// Effects: soul orbs, sparks, shockwaves and chimes. One canvas over the window; the loop runs only
// while something moves. A drawing error never stops the loop, and every orb lands (deadline).
(function () {
  "use strict";
  const canvas = document.getElementById("fx");
  const ctx = canvas.getContext("2d");
  let W = 0, H = 0, dpr = 1;
  const items = []; // live effects: { update(dt, now) → bool alive, draw(ctx) }
  let raf = 0, last = 0;
  const reduced = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const FX = { enabled: true };

  function resize() {
    dpr = window.devicePixelRatio || 1;
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }
  resize();
  window.addEventListener("resize", resize);

  function loop(now) {
    raf = 0;
    const dt = Math.min(50, now - (last || now));
    last = now;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      let alive = false;
      try {
        alive = it.update(dt, now);
        if (alive) {
          ctx.save();
          it.draw(ctx, now);
          ctx.restore();
        }
      } catch (e) {
        console.warn("fx", e);
        alive = false;
      }
      if (!alive) {
        items.splice(i, 1);
        try { it.done && it.done(); } catch (e) { console.warn(e); }
      }
    }
    if (items.length) raf = requestAnimationFrame(loop);
    else { last = 0; ctx.clearRect(0, 0, W, H); }
  }
  function add(it) {
    items.push(it);
    if (!raf) raf = requestAnimationFrame(loop);
  }
  const on = () => FX.enabled && !reduced() && !window.FG_MUTED;

  function rgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

  // A spark: a tiny glowing dot with velocity, drag and fading life.
  function spark(x, y, vx, vy, color, life, size) {
    let t = 0;
    return {
      update(dt) {
        t += dt;
        x += (vx * dt) / 1000;
        y += (vy * dt) / 1000;
        vx *= 0.93;
        vy = vy * 0.93 + (dt / 1000) * 60;
        return t < life;
      },
      draw(c) {
        const a = 1 - t / life;
        c.globalCompositeOperation = "lighter";
        c.fillStyle = rgba(color, a);
        c.beginPath();
        c.arc(x, y, size * (0.4 + 0.6 * a), 0, Math.PI * 2);
        c.fill();
      },
    };
  }

  // A soul orb flies in an arc from `from` to `to()` (a function, so it follows the target), leaving
  // a trail of sparks; calls onLand once, even if a frame throws or the window is hidden.
  FX.orb = function (from, to, color, onLand, opts = {}) {
    let landed = false;
    const land = () => { if (!landed) { landed = true; try { onLand && onLand(); } catch (e) { console.warn(e); } } };
    const dur = opts.duration || 820;
    setTimeout(land, dur + 600); // deadline
    if (!on()) { setTimeout(land, 60); return; }
    const delay = opts.delay || 0;
    let t = -delay, px = from.x, py = from.y;
    const tail = [];
    add({
      update(dt) {
        t += dt;
        if (t >= dur) { land(); return false; }
        return true;
      },
      draw(c) {
        if (t < 0) return;
        const p = easeInOut(t / dur);
        const end = to();
        const lift = Math.min(90, Math.hypot(end.x - from.x, end.y - from.y) * 0.45);
        const cx = (from.x + end.x) / 2 + (opts.bend || 0.25) * (end.y - from.y), cy = Math.min(from.y, end.y) - lift;
        const x = (1 - p) * (1 - p) * from.x + 2 * (1 - p) * p * cx + p * p * end.x;
        const y = (1 - p) * (1 - p) * from.y + 2 * (1 - p) * p * cy + p * p * end.y;
        // a comet tail through the last positions, plus loose sparks
        tail.push({ x, y });
        if (tail.length > 14) tail.shift();
        c.globalCompositeOperation = "lighter";
        c.lineCap = "round";
        for (let i = 1; i < tail.length; i++) {
          const k = i / tail.length;
          c.strokeStyle = rgba(color, k * 0.55);
          c.lineWidth = 1 + k * 6;
          c.beginPath();
          c.moveTo(tail[i - 1].x, tail[i - 1].y);
          c.lineTo(tail[i].x, tail[i].y);
          c.stroke();
        }
        if (Math.random() < 0.7) {
          const a = Math.random() * Math.PI * 2, v = 20 + Math.random() * 50;
          items.push(spark(x + (Math.random() - 0.5) * 6, y + (Math.random() - 0.5) * 6, Math.cos(a) * v + (px - x) * 2, Math.sin(a) * v + (py - y) * 2, Math.random() < 0.3 ? "#fff3cf" : color, 300 + Math.random() * 350, 1 + Math.random() * 1.6));
        }
        px = x; py = y;
        const r = 7 + Math.sin(t / 60) * 0.8;
        c.globalCompositeOperation = "lighter";
        const g = c.createRadialGradient(x, y, 0, x, y, r * 3.2);
        g.addColorStop(0, "rgba(255,255,255,0.95)");
        g.addColorStop(0.25, rgba(color, 0.9));
        g.addColorStop(1, rgba(color, 0));
        c.fillStyle = g;
        c.beginPath();
        c.arc(x, y, r * 3.2, 0, Math.PI * 2);
        c.fill();
      },
    });
  };

  // A burst of sparks, sized to the target (capped so it never floods the window).
  FX.burst = function (x, y, color, opts = {}) {
    if (!on()) return;
    const n = opts.count || 22;
    const speed = Math.min(opts.speed || 160, 260);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.3;
      const v = speed * (0.45 + Math.random() * 0.6);
      add(spark(x, y, Math.cos(a) * v, Math.sin(a) * v, i % 3 ? color : "#fff3cf", 450 + Math.random() * 350, 1.4 + Math.random() * 1.8));
    }
    // star glints
    const glints = opts.glints ?? 4;
    for (let i = 0; i < glints; i++) {
      const gx = x + (Math.random() - 0.5) * (opts.spread || 60), gy = y + (Math.random() - 0.5) * (opts.spread || 60);
      let t = -i * 70;
      const life = 520;
      add({
        update(dt) { t += dt; return t < life; },
        draw(c) {
          if (t < 0) return;
          const k = t / life, s = Math.sin(k * Math.PI) * 7;
          c.globalCompositeOperation = "lighter";
          c.strokeStyle = rgba("#fff3cf", 1 - k);
          c.lineWidth = 1.2;
          c.beginPath();
          c.moveTo(gx - s, gy); c.lineTo(gx + s, gy);
          c.moveTo(gx, gy - s); c.lineTo(gx, gy + s);
          c.stroke();
        },
      });
    }
  };

  // Fire off a ring (a kill streak): embers rise from around it, drift and flicker out. Hotter
  // tiers send more, bigger and faster; the top tier burns blue-white.
  FX.flames = function (x, y, r, tier = 1) {
    if (!on()) return;
    const hot = tier >= 4;
    const cols = hot ? ["#cfe2ff", "#8fb8ff", "#ffffff", "#6f8dff"] : ["#ffb347", "#ff7a1a", "#ffd88a", "#ff5a1f"];
    const n = [0, 8, 14, 22, 30][Math.min(4, tier)] || 8;
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.5; // mostly from the top half
      let px = x + Math.cos(a) * r * (0.85 + Math.random() * 0.2), py = y + Math.sin(a) * r * (0.85 + Math.random() * 0.2);
      let vx = (Math.random() - 0.5) * 26, vy = -(40 + Math.random() * 60 + tier * 14);
      const life = 600 + Math.random() * 500 + tier * 80, size = 1.4 + Math.random() * (1.4 + tier * 0.5), col = cols[i % cols.length];
      let t = -Math.random() * 120;
      add({
        update(dt) {
          t += dt;
          if (t < 0) return true;
          px += (vx * dt) / 1000 + Math.sin((t + i * 40) / 90) * 0.35;
          py += (vy * dt) / 1000;
          vy *= 0.985;
          return t < life;
        },
        draw(c) {
          if (t < 0) return;
          const k = t / life, fl = 0.75 + 0.25 * Math.sin(t / 30 + i);
          c.globalCompositeOperation = "lighter";
          c.fillStyle = rgba(col, (1 - k) * fl);
          c.beginPath();
          c.ellipse(px, py, size * (1 - k * 0.6), size * (1.6 - k), 0, 0, Math.PI * 2);
          c.fill();
        },
      });
    }
  };

  // Expanding rings. A staggered ring waits for its start (no negative radius).
  FX.shockwave = function (x, y, color, opts = {}) {
    if (!on()) return;
    const rings = opts.rings || 3, max = Math.min(opts.radius || 70, 90);
    for (let i = 0; i < rings; i++) {
      let t = -i * 140;
      const life = 750;
      add({
        update(dt) { t += dt; return t < life; },
        draw(c) {
          if (t <= 0) return;
          const k = t / life;
          const r = Math.max(0.1, max * (1 - Math.pow(1 - k, 3)));
          c.globalCompositeOperation = "lighter";
          c.strokeStyle = rgba(color, (1 - k) * 0.9);
          c.lineWidth = 3 * (1 - k) + 0.5;
          c.beginPath();
          c.arc(x, y, r, 0, Math.PI * 2);
          c.stroke();
        },
      });
    }
  };

  // Floating "+1" over a point, as DOM text so it stays crisp.
  FX.plus = function (x, y, text, color) {
    if (!on()) return;
    const el = document.createElement("div");
    el.className = "plus";
    el.textContent = text;
    if (color) el.style.color = color;
    el.style.left = `${x}px`;
    el.style.top = `${y - 10}px`;
    document.body.appendChild(el);
    el.addEventListener("animationend", () => el.remove());
    setTimeout(() => el.remove(), 1600);
  };

  // A number that rolls from one value to another.
  FX.roll = function (el, from, to, ms = 500) {
    const id = (el._rollId = (el._rollId || 0) + 1); // a newer roll or text cancels this one
    if (!on() || from === to) { el.textContent = String(to); return; }
    const t0 = performance.now();
    const step = (now) => {
      if (el._rollId !== id) return;
      const k = Math.min(1, (now - t0) / ms);
      el.textContent = String(Math.round(from + (to - from) * easeInOut(k)));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  // ── sound: tiny WebAudio chimes, no files ────────────────────────
  // Browsers allow audio only after a first click inside the window.
  const Sound = { enabled: true, volume: 0.5, ctx: null };
  function unlock() {
    if (Sound.ctx) { if (Sound.ctx.state === "suspended") Sound.ctx.resume().catch(() => {}); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) Sound.ctx = new AC();
    } catch (e) { /* no audio */ }
  }
  window.addEventListener("pointerdown", unlock, true);
  window.addEventListener("keydown", unlock, true);
  function tone(freq, start, dur, gain, type = "sine") {
    const c = Sound.ctx;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.value = freq;
    const t = c.currentTime + start;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain * Sound.volume, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
  function play(fn) {
    if (!Sound.enabled || window.FG_MUTED || !Sound.ctx || Sound.ctx.state !== "running") return;
    try { fn(); } catch (e) { console.warn(e); }
  }
  // Each genus rings at its own key. A kill streak walks a pentatonic melody up and down (never an
  // endless climb), and every streak tier adds one quiet layer: sparkle, then a soft beat, then harmony.
  const BASE = { cogni: 659.25, natura: 587.33, fera: 523.25, varian: 698.46, special: 783.99 };
  const MELODY = [0, 2, 4, 7, 9, 12, 9, 7, 4, 2]; // semitones, the major pentatonic there and back
  const TIERS = [5, 10, 20, 40];
  Sound.tierOf = (streak) => TIERS.filter((t) => streak >= t).length;
  function thump(start, gain) {
    const c = Sound.ctx;
    const o = c.createOscillator(), g = c.createGain();
    const t = c.currentTime + start;
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.16);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain * Sound.volume, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + 0.3);
  }
  Sound.soul = (genus, streak = 1) => play(() => {
    const tier = Sound.tierOf(streak);
    const f = (BASE[genus] || 659.25) * Math.pow(2, MELODY[(Math.max(1, streak) - 1) % MELODY.length] / 12);
    tone(f, 0, 0.38, 0.15);
    tone(f * 1.5, 0.05, 0.4, 0.06);
    if (tier >= 1) tone(f * 2, 0.02, 0.22, 0.05, "triangle"); // sparkle
    if (tier >= 2) thump(0, 0.22); // the beat
    if (tier >= 3) { tone(f * 1.25, 0.09, 0.45, 0.05); tone(f, 0.16, 0.3, 0.045); } // harmony + echo
    if (tier >= 4) { tone(f * 4, 0.04, 0.12, 0.025, "triangle"); tone(f * 3, 0.1, 0.12, 0.025, "triangle"); } // shimmer
  });
  // A short riff when a streak reaches a new tier.
  Sound.streakUp = (tier) => play(() => {
    const root = 523.25 * Math.pow(2, Math.min(tier, 4) / 12);
    [0, 4, 7, 12].forEach((st, i) => tone(root * Math.pow(2, st / 12), i * 0.07, 0.35, 0.09, i === 3 ? "triangle" : "sine"));
    thump(0, 0.18);
    thump(0.21, 0.14);
  });
  Sound.level = () => play(() => {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, i * 0.085, 0.6, 0.14));
    tone(1567.98, 0.34, 0.9, 0.06, "triangle");
  });
  Sound.done = () => play(() => {
    [587.33, 880, 1174.66].forEach((f, i) => tone(f, i * 0.06, 0.5, 0.12));
  });
  Sound.stop = () => play(() => {
    [392, 493.88, 587.33, 783.99].forEach((f) => tone(f, 0, 1.4, 0.08));
    [783.99, 987.77, 1174.66, 1567.98].forEach((f, i) => tone(f, 0.12 + i * 0.09, 0.8, 0.09));
  });
  Sound.tick = () => play(() => tone(1320, 0, 0.06, 0.05, "triangle"));
  // ── opening and folding: their own family, nothing like the soul chimes ──
  // a pitch glide (a bubble's "bloop"), a breath of air, and a soft bell or a soft tuck at the end
  function glide(f0, f1, start, dur, gain, type = "sine") {
    const c = Sound.ctx;
    const o = c.createOscillator(), g = c.createGain();
    const t = c.currentTime + start;
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.8);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain * Sound.volume, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
  let noiseBuf = null;
  function air(f0, f1, start, dur, gain) {
    const c = Sound.ctx;
    if (!noiseBuf) {
      noiseBuf = c.createBuffer(1, Math.round(c.sampleRate * 0.6), c.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = c.createBufferSource(), bp = c.createBiquadFilter(), g = c.createGain();
    const t = c.currentTime + start;
    src.buffer = noiseBuf;
    bp.type = "bandpass";
    bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(f0, t);
    bp.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain * Sound.volume, t + dur * 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp).connect(g).connect(c.destination);
    src.start(t);
    src.stop(t + dur + 0.02);
  }
  // the guide pops out of the tip: up-glide, airy whoosh rising, a little bell on top
  Sound.open = () => play(() => {
    glide(320, 760, 0, 0.16, 0.13);
    air(900, 4200, 0, 0.22, 0.05);
    tone(1174.66, 0.11, 0.32, 0.045);
    tone(1760, 0.14, 0.22, 0.02, "triangle");
  });
  // it tucks back into the tip: down-glide, the air falling, a soft low "tuck"
  Sound.close = () => play(() => {
    air(3600, 700, 0, 0.2, 0.045);
    glide(720, 300, 0.02, 0.16, 0.11);
    glide(150, 70, 0.13, 0.12, 0.14);
  });
  // the map sliding away / back: just the air, quieter
  Sound.slide = (up) => play(() => air(up ? 900 : 2800, up ? 2800 : 800, 0, 0.2, 0.1));

  // the stop list: a light "riffle" as it drops (a card fan: three quick high plucks over a short
  // breath), the same falling back as it closes, and a clean two-note "set" when you pick a stop
  Sound.list = (open) => play(() => {
    air(open ? 2400 : 5200, open ? 5200 : 2000, 0, 0.13, 0.035);
    const f = open ? [1318.5, 1568, 1975.5] : [1975.5, 1568, 1318.5];
    f.forEach((x, i) => tone(x, 0.015 + i * 0.035, 0.09, 0.022, "triangle"));
  });
  Sound.pick = () => play(() => {
    glide(520, 880, 0, 0.09, 0.08);
    tone(1046.5, 0.05, 0.22, 0.045);
    tone(1568, 0.1, 0.3, 0.035);
  });

  window.FX = FX;
  window.Sound = Sound;
})();
