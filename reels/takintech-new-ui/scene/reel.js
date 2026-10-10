/* TakinTech new-UI reel: deterministic timeline renderer.
 * Every visual is a pure function of time t. window.__seek(t) draws one frame,
 * window.__CUES lists sound-design cue points derived from the same timeline
 * (scripts/sound.py reads them, so picture and sound never drift apart). */
(function () {
  'use strict';

  const C = window.__CONFIG;
  const A = window.__ASSETS || { exists: {}, logo: null };
  const W = C.video.width, H = C.video.height;
  const COL = C.brand.colors;
  for (const [k, v] of Object.entries(COL)) document.documentElement.style.setProperty('--' + k, v);
  const SC = Object.fromEntries(C.scenes.map(s => [s.id, s]));

  // ---------------------------------------------------------------- math
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const P = (t, a, b) => clamp((t - a) / (b - a));
  const E = {
    outExpo: t => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
    inExpo: t => (t <= 0 ? 0 : Math.pow(2, 10 * t - 10)),
    outCubic: t => 1 - Math.pow(1 - t, 3),
    inCubic: t => t * t * t,
    inOutCubic: t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    outBack: t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
    outElastic: t => (t <= 0 ? 0 : t >= 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI / 3)) + 1),
  };
  const hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
  function rng(seed) {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function rgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  // ---------------------------------------------------------------- dom
  const $ = s => document.querySelector(s);
  function el(tag, cls, parent, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    if (parent) parent.appendChild(e);
    return e;
  }
  const css = (e, o) => Object.assign(e.style, o);

  function words(text, parent, style) {
    const line = el('div', 'line', parent);
    if (style) css(line, style);
    const parts = text.split(' ').filter(Boolean);
    const ws = parts.map((w, i) => {
      const s = el('span', 'word', line);
      s.textContent = w;
      if (i < parts.length - 1) line.appendChild(document.createTextNode(' '));
      return s;
    });
    return { line, ws };
  }

  function wordsIn(ws, t, t0, o = {}) {
    const st = o.stagger ?? 0.07, d = o.dur ?? 0.55, dy = o.dy ?? 46, bl = o.blur ?? 14, s0 = o.scale ?? 0.88;
    ws.forEach((w, i) => {
      const a = P(t, t0 + i * st, t0 + i * st + d);
      const e = E.outExpo(a);
      w.style.opacity = clamp(a * 3);
      w.style.transform = `translateY(${(1 - e) * dy}px) scale(${lerp(s0, 1, E.outBack(a))})`;
      w.style.filter = bl && e < 0.999 ? `blur(${(1 - e) * bl}px)` : 'none';
    });
  }

  const ICON = {
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" width="50" height="50" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>',
    cursor: '<svg viewBox="0 0 24 24" width="64" height="64"><path d="M4 2.5l15 10.2-6.6 1.3 3.9 7.3-3 1.6-3.9-7.4-5.4 4.3z" fill="#fff" stroke="#0b1020" stroke-width="1.2" stroke-linejoin="round"/></svg>',
  };

  // ---------------------------------------------------------------- assets
  const pending = [];

  // Wireframe stand-in for a screenshot that has not been supplied yet.
  // Deliberately grey and labelled so it can never pass for the real UI.
  function placeholder(kind, label) {
    const [w, h] = { desktop: [1440, 900], desktopFull: [1440, 5200], mobile: [390, 2600] }[kind];
    const m = kind === 'mobile', pad = m ? 22 : 96, r = rng(label.length * 97 + w);
    let s = '';
    const rect = (x, y, rw, rh, f, rx = 10) => { s += `<rect x="${x}" y="${y}" width="${rw}" height="${rh}" rx="${rx}" fill="${f}"/>`; };
    const tag = (x, y) => {
      const fs = m ? 15 : 28;
      s += `<text x="${x}" y="${y}" font-family="DejaVu Sans, sans-serif" font-weight="bold" font-size="${fs}" fill="#94a3b8" letter-spacing="2">PLACEHOLDER · ${label}</text>`;
    };
    rect(0, 0, w, h, '#eef1f7', 0);
    const nav = m ? 64 : 84;
    rect(0, 0, w, nav, '#ffffff', 0);
    rect(w - pad - (m ? 96 : 170), nav / 2 - 14, m ? 96 : 170, 28, '#c3cde0', 8);
    if (m) rect(pad, nav / 2 - 12, 40, 24, '#d6dce8', 6);
    else for (let i = 0; i < 5; i++) rect(pad + i * 132, nav / 2 - 8, 100, 16, '#d6dce8', 8);
    let y = nav, sec = 0;
    while (y < h) {
      const sh = sec === 0 ? (m ? 640 : 820) : (m ? 520 + r() * 200 : 640 + r() * 220);
      rect(0, y, w, sh, sec % 2 ? '#f7f9fc' : '#eef1f7', 0);
      tag(pad, y + (m ? 34 : 56));
      if (sec === 0) {
        const tw = m ? w - pad * 2 : 620;
        rect(w - pad - tw, y + (m ? 90 : 170), tw, m ? 34 : 62, '#9aa7c0');
        rect(w - pad - tw * 0.8, y + (m ? 138 : 252), tw * 0.8, m ? 34 : 62, '#9aa7c0');
        for (let i = 0; i < 3; i++) rect(w - pad - tw * (0.95 - i * 0.12), y + (m ? 200 : 360) + i * (m ? 22 : 34), tw * (0.95 - i * 0.12), m ? 10 : 16, '#c9d2e3', 6);
        rect(w - pad - (m ? 150 : 220), y + (m ? 280 : 490), m ? 150 : 220, m ? 44 : 64, '#7b8cff', 32);
        if (m) rect(pad, y + 350, w - pad * 2, 250, '#d9e0ec', 18);
        else rect(pad, y + 150, 560, 540, '#d9e0ec', 24);
      } else {
        rect(w / 2 - (m ? 120 : 220), y + (m ? 70 : 110), m ? 240 : 440, m ? 26 : 44, '#9aa7c0');
        const cols = m ? 1 : 3, gap = m ? 16 : 36;
        const cw = (w - pad * 2 - gap * (cols - 1)) / cols, rows = m ? 2 : 1;
        for (let rr = 0; rr < rows; rr++) {
          for (let c = 0; c < cols; c++) {
            const x = pad + c * (cw + gap), yy = y + (m ? 130 : 210) + rr * (m ? 190 : 0);
            const ch = m ? 170 : sh - 300;
            rect(x, yy, cw, ch, '#ffffff', 20);
            rect(x + 20, yy + 20, cw - 40, ch * 0.45, '#e2e8f2', 14);
            rect(x + 20, yy + ch * 0.45 + 40, cw * 0.6, m ? 14 : 20, '#b8c3d8', 8);
            rect(x + 20, yy + ch * 0.45 + (m ? 64 : 76), cw * 0.8, m ? 10 : 14, '#d5dce8', 6);
          }
        }
      }
      y += sh; sec++;
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${s}</svg>`;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  const PLACEHOLDER_LOGO =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">' +
    '<polygon points="200,30 347,115 347,285 200,370 53,285 53,115" fill="#2ee6d6" fill-opacity=".10" stroke="#2ee6d6" stroke-width="5" stroke-dasharray="18 12"/>' +
    '<polygon points="200,100 287,150 287,250 200,300 113,250 113,150" fill="none" stroke="#3d7bff" stroke-width="5"/>' +
    '<text x="200" y="212" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-weight="bold" font-size="34" fill="#ffffff">LOGO</text>' +
    '<text x="200" y="244" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-size="17" fill="#8a97b8">placeholder</text></svg>';

  function src(path, kind) {
    if (path && A.exists[path]) return '../' + path;
    return placeholder(kind, (path || 'missing').split('/').pop());
  }

  function img(parent, url) {
    const i = el('img', '', parent);
    i.src = url;
    pending.push(i.decode().catch(() => {}));
    return i;
  }

  // ---------------------------------------------------------------- mockups
  function browser(parent, box, url, small) {
    const root = el('div', 'browser' + (small ? ' sm' : ''), parent);
    css(root, { left: box.x + 'px', top: box.y + 'px', width: box.w + 'px', height: box.h + 'px' });
    el('div', 'bar', root, `<span class="dots"><i></i><i></i><i></i></span><div class="url">${ICON.lock}<span>${C.brand.domain}</span></div>`);
    const vp = el('div', 'viewport', root);
    const layer = el('div', 'layer', vp);
    css(layer, { width: box.w + 'px' });
    const im = img(layer, url);
    const sb = el('div', 'scrollbar', vp);
    const barH = small ? 44 : 56;
    return { root, vp, layer, img: im, sb, vw: box.w, vh: box.h - barH };
  }

  // Scroll a mockup's screenshot to `frac` of its scrollable height.
  function setScroll(b, frac, extraScale = 1) {
    const ih = b.img.naturalHeight * b.vw / Math.max(1, b.img.naturalWidth);
    const max = Math.max(0, ih - b.vh);
    b.layer.style.transform = `translateY(${-frac * max}px) scale(${extraScale})`;
    if (max > 4) {
      const th = Math.max(40, b.vh * b.vh / ih);
      css(b.sb, { display: 'block', height: th + 'px', top: frac * (b.vh - th) + 'px' });
    } else b.sb.style.display = 'none';
  }

  function cap(parent, text, o = {}) {
    const root = el('div', 'cap', parent);
    const w = words(text, root);
    if (o.size) w.line.style.fontSize = o.size + 'px';
    w.ws[w.ws.length - 1].classList.add('grad');
    const bar = el('div', 'bar', root);
    return { root, ws: w.ws, bar };
  }
  function capIn(c, t, t0) {
    wordsIn(c.ws, t, t0, { stagger: 0.075, dur: 0.6, dy: 50 });
    const b = E.outExpo(P(t, t0 + 0.2, t0 + 0.9));
    c.bar.style.transform = `scaleX(${b})`;
    c.bar.style.opacity = b;
  }

  // ---------------------------------------------------------------- stage
  const cam = $('#cam');
  const S = {};
  for (const s of C.scenes) S[s.id] = el('div', 'scene', cam);
  const scr = C.screens;

  // ---- hook
  const hookWrap = el('div', '', S.hook);
  css(hookWrap, { position: 'absolute', left: 0, right: 0, top: '600px', textAlign: 'center' });
  const hl1 = words(SC.hook.lines[0], hookWrap, { fontSize: '84px', fontWeight: 500, color: 'var(--muted)' });
  const h2row = el('div', 'line', hookWrap);
  const h2 = el('div', '', h2row);
  css(h2, { position: 'relative', display: 'inline-block', fontSize: '236px', fontWeight: 900, lineHeight: 1.15, letterSpacing: '-4px' });
  const h2main = el('span', 'grad', h2);
  h2main.textContent = SC.hook.lines[1];
  css(h2main, { filter: 'drop-shadow(0 0 40px rgba(61,123,255,.55))' });
  const ghosts = ['#ff2bd6', '#19e3ff'].map(c => {
    const g = el('span', '', h2);
    g.textContent = SC.hook.lines[1];
    css(g, { position: 'absolute', inset: 0, color: c, mixBlendMode: 'screen', opacity: 0 });
    return g;
  });
  const hl3 = words(SC.hook.lines[2], hookWrap, { fontSize: '112px', fontWeight: 900, marginTop: '-10px' });

  // ---- reveal
  const rvTitle = el('div', '', S.reveal);
  css(rvTitle, { position: 'absolute', top: '262px', left: 0, right: 0, textAlign: 'center' });
  const rl1 = words(SC.reveal.lines[0], rvTitle, { fontSize: '68px', fontWeight: 500, color: 'var(--muted)' });
  const rl2 = words(SC.reveal.lines[1], rvTitle, { fontSize: '112px', fontWeight: 900, marginTop: '-8px' });
  rl2.ws.forEach(w => w.classList.add('grad'));
  const pillWrap = el('div', '', rvTitle);
  css(pillWrap, { marginTop: '22px' });
  const pill = el('div', 'pill', pillWrap, `<span class="dot"></span><span>${C.brand.domain}</span>`);
  const rvP = el('div', 'persp', S.reveal);
  const rvGlow = el('div', 'floor-glow', rvP);
  css(rvGlow, { left: '90px', width: '900px', top: '1270px', height: '240px' });
  const rvB = browser(rvP, { x: 70, y: 730, w: 940, h: 640 }, src(scr.desktop_hero, 'desktop'));

  // ---- scroll
  const scCap = cap(S.scroll, SC.scroll.caption);
  const scP = el('div', 'persp', S.scroll);
  const scGlow = el('div', 'floor-glow', scP);
  css(scGlow, { left: '90px', width: '900px', top: '1380px', height: '220px' });
  const scB = browser(scP, { x: 70, y: 450, w: 940, h: 1030 }, src(scr.desktop_full, 'desktopFull'));

  // ---- detail
  const dCap = cap(S.detail, SC.detail.caption);
  const dP = el('div', 'persp', S.detail);
  const dGlow = el('div', 'floor-glow', dP);
  css(dGlow, { left: '90px', width: '900px', top: '1130px', height: '220px' });
  const dB = browser(dP, { x: 70, y: 540, w: 940, h: 640 }, src(scr.detail, 'desktop'));
  const hl = el('div', 'hl', dB.layer);

  // ---- mobile
  const mCap = cap(S.mobile, SC.mobile.caption);
  const mP = el('div', 'persp', S.mobile);
  const mDesk = browser(mP, { x: 40, y: 760, w: 620, h: 410 }, src(scr.desktop_hero, 'desktop'), true);
  const phone = el('div', 'phone', mP);
  css(phone, { left: '490px', top: '470px', width: '450px', height: '950px' });
  const pScreen = el('div', 'screen', phone);
  const pLayer = el('div', 'layer', pScreen);
  const pImg = img(pLayer, src(scr.mobile_full, 'mobile'));
  el('div', 'island', phone);
  const pB = { layer: pLayer, img: pImg, sb: el('div', 'scrollbar', pScreen), vw: 418, vh: 918 };

  // ---- montage
  const mtCap = cap(S.montage, SC.montage.caption);
  const mtP = el('div', 'persp', S.montage);
  const cards = scr.montage.map(p => browser(mtP, { x: 110, y: 660, w: 860, h: 570 }, src(p, 'desktop'), true));
  const cardRot = [-6, 5, -3.5, 3.2], cardX = [-26, 30, -14, 18], cardY = [-30, 14, 36, -8];

  // ---- cta
  const ctCap = cap(S.cta, SC.cta.caption, { size: 96 });
  ctCap.root.style.top = '480px';
  const addr = el('div', 'addr', S.cta, `<span style="color:var(--accent);display:flex">${ICON.lock}</span><span class="typed"></span><span class="caret"></span>`);
  css(addr, { top: '780px' });
  const typed = addr.querySelector('.typed'), caret = addr.querySelector('.caret');
  const btn = el('div', 'btn', S.cta, `<span>${SC.cta.button || 'ورود به سایت'}</span>${ICON.arrow}`);
  css(btn, { top: '1010px' });
  const ripple = el('div', 'ripple', S.cta);
  const cursor = el('div', 'cursor', S.cta, ICON.cursor);

  // ---- outro
  const logoBox = el('div', 'logo-box', S.outro);
  const logoGlow = el('div', 'floor-glow', logoBox);
  const logoInner = el('div', 'logo-inner', logoBox);
  const sweepBox = el('div', 'sweep', logoInner);
  const sweepBar = el('div', '', sweepBox);
  css(sweepBar, {
    position: 'absolute', top: 0, bottom: 0, width: '45%',
    background: 'linear-gradient(100deg, transparent, rgba(255,255,255,.95) 50%, transparent)',
  });
  const tagline = el('div', 'tagline', S.outro);
  tagline.textContent = (C.outro && C.outro.tagline) || '';
  let logo = { kind: 'png', shapes: [], w: 520, h: 520, el: null };

  function setupLogo() {
    const L = A.logo;
    let aspect = 1, maskUrl;
    if (L && L.type === 'png') {
      const i = el('img', '', logoInner);
      i.src = L.data;
      logo = { kind: 'png', el: i, shapes: [] };
      pending.push(i.decode().catch(() => {}));
      maskUrl = L.data;
    } else {
      const svgText = L && L.type === 'svg' ? L.text : PLACEHOLDER_LOGO;
      logoInner.insertAdjacentHTML('afterbegin', svgText);
      const svg = logoInner.querySelector('svg');
      svg.removeAttribute('width'); svg.removeAttribute('height');
      svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      const vb = svg.viewBox && svg.viewBox.baseVal;
      if (vb && vb.width) aspect = vb.width / vb.height;
      const shapes = [...svg.querySelectorAll('path,circle,rect,ellipse,polygon,polyline,line')].map(s => {
        const cs = getComputedStyle(s);
        let len = 0;
        try { len = s.getTotalLength(); } catch (e) { /* not measurable */ }
        const fo = parseFloat(cs.fillOpacity), so = parseFloat(cs.strokeOpacity);
        return {
          s, len, fo: isNaN(fo) ? 1 : fo, so: isNaN(so) ? 1 : so,
          hadStroke: cs.stroke !== 'none' && parseFloat(cs.strokeWidth) > 0,
          stroke: cs.stroke, sw: cs.strokeWidth,
        };
      });
      const others = [...svg.querySelectorAll('text,image,use')];
      logo = { kind: 'svg', el: svg, shapes, others };
      maskUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText);
    }
    return Promise.all(pending).then(() => {
      if (logo.kind === 'png') aspect = logo.el.naturalWidth / Math.max(1, logo.el.naturalHeight);
      const maxW = 760, maxH = 500;
      let w = maxW, h = maxW / aspect;
      if (h > maxH) { h = maxH; w = maxH * aspect; }
      logo.w = w; logo.h = h;
      css(logoInner, { width: w + 'px', height: h + 'px' });
      css(logoGlow, { left: -w * 0.8 + 'px', top: -h * 0.8 + 'px', width: w * 1.6 + 'px', height: h * 1.6 + 'px' });
      sweepBox.style.webkitMaskImage = `url("${maskUrl}")`;
      sweepBox.style.maskImage = `url("${maskUrl}")`;
      css(tagline, { top: 900 + h / 2 + 70 + 'px' });
    });
  }

  // ---------------------------------------------------------------- canvases
  const bg = $('#bg').getContext('2d');
  const fx = $('#fx').getContext('2d');
  const gr = $('#grain').getContext('2d');

  const HEX_R = 54, HEX_W = Math.sqrt(3) * HEX_R;
  const hexes = [];
  for (let row = -1, i = 0; row * HEX_R * 1.5 < H + HEX_R * 2; row++) {
    for (let c = -1; c * HEX_W < W + HEX_W; c++, i++) {
      hexes.push({ x: c * HEX_W + (row & 1 ? HEX_W / 2 : 0), y: row * HEX_R * 1.5, i });
    }
  }
  const HEX_V = [...Array(6)].map((_, k) => {
    const a = Math.PI / 6 + k * Math.PI / 3;
    return [Math.cos(a) * (HEX_R - 3), Math.sin(a) * (HEX_R - 3)];
  });
  function hexPath(g, x, y, r = 1) {
    g.moveTo(x + HEX_V[0][0] * r, y + HEX_V[0][1] * r);
    for (let k = 1; k < 6; k++) g.lineTo(x + HEX_V[k][0] * r, y + HEX_V[k][1] * r);
    g.closePath();
  }
  function blob(g, x, y, r, color, a) {
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, rgba(color, a));
    grd.addColorStop(1, rgba(color, 0));
    g.fillStyle = grd;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }

  const T_OUT = SC.outro.start;
  const LOGO_CX = 540, LOGO_CY = 900;

  function drawBG(t) {
    const g = bg;
    g.globalCompositeOperation = 'source-over';
    const lin = g.createLinearGradient(0, 0, 0, H);
    lin.addColorStop(0, COL.bg2); lin.addColorStop(0.55, COL.bg); lin.addColorStop(1, '#020309');
    g.fillStyle = lin; g.fillRect(0, 0, W, H);

    const energy = t < 4 ? lerp(0.35, 0.75, P(t, 0, 4)) : t < T_OUT ? 1 : lerp(0.8, 0.45, P(t, T_OUT + 2, 32));
    g.globalCompositeOperation = 'lighter';
    blob(g, 540 + Math.sin(t * 0.5) * 260, 520 + Math.cos(t * 0.37) * 160, 720, COL.primary, 0.22 * energy);
    blob(g, 300 + Math.cos(t * 0.43) * 200, 1400 + Math.sin(t * 0.31) * 200, 650, COL.violet, 0.2 * energy);
    blob(g, 820 + Math.sin(t * 0.29 + 1) * 180, 1050 + Math.cos(t * 0.53) * 260, 520, COL.accent, 0.1 * energy);
    if (t >= T_OUT) blob(g, LOGO_CX, LOGO_CY, 620, COL.primary, 0.35 * E.outCubic(P(t, T_OUT + 0.6, T_OUT + 1.4)));
    g.globalCompositeOperation = 'source-over';

    // hex grid: a scan line sweeps down; in the outro a ring collapses
    // onto the logo and a shockwave answers it
    const scanY = ((t * 420) % (H + 800)) - 400;
    const inOut = t >= T_OUT;
    const ringIn = lerp(1500, 0, E.inCubic(P(t, T_OUT, T_OUT + 1)));
    const ringOut = lerp(0, 1700, E.outCubic(P(t, T_OUT + 1, T_OUT + 2.4)));
    g.lineWidth = 1.6;
    for (const hx of hexes) {
      let a;
      if (!inOut) {
        const d = (hx.y - scanY) / 140;
        a = 0.05 + Math.exp(-d * d) * 0.18;
        a *= energy;
      } else {
        const dist = Math.hypot(hx.x - LOGO_CX, hx.y - LOGO_CY);
        const d1 = (dist - ringIn) / 110, d2 = (dist - ringOut) / 130;
        const fadeIn = t < T_OUT + 1 ? 1 : 0;
        const fadeOut = 1 - P(t, T_OUT + 1.6, T_OUT + 2.6);
        a = 0.035 + Math.exp(-d1 * d1) * 0.4 * fadeIn + Math.exp(-d2 * d2) * 0.35 * fadeOut;
      }
      const lit = hash(hx.i * 13.1 + Math.floor(t * 3)) > 0.982;
      g.beginPath(); hexPath(g, hx.x, hx.y);
      g.strokeStyle = rgba(COL.accent, a);
      g.stroke();
      if (lit && !inOut) { g.fillStyle = rgba(COL.primary, 0.08 * energy); g.fill(); }
    }

    // outro: the big hexagon frame around the logo draws itself
    if (inOut) {
      const dp = E.inOutCubic(P(t, T_OUT + 0.3, T_OUT + 1.1));
      const rot = (t - T_OUT) * 0.06;
      const R = 420 + 14 * Math.sin((t - T_OUT) * 1.4);
      g.save();
      g.translate(LOGO_CX, LOGO_CY); g.rotate(rot);
      g.beginPath();
      for (let k = 0; k <= 6; k++) {
        const a = -Math.PI / 2 + k * Math.PI / 3;
        k ? g.lineTo(Math.cos(a) * R, Math.sin(a) * R) : g.moveTo(Math.cos(a) * R, Math.sin(a) * R);
      }
      const per = 6 * R;
      g.setLineDash([per * dp, per]);
      g.lineWidth = 3;
      g.shadowColor = COL.accent; g.shadowBlur = 30;
      g.strokeStyle = rgba(COL.accent, 0.75 * (1 - 0.5 * P(t, T_OUT + 3, 32)));
      g.stroke();
      g.setLineDash([]);
      g.restore();
    }
  }

  const dust = [...Array(70)].map((_, i) => {
    const r = rng(i * 7 + 3);
    return { x: r() * W, y: r() * H, v: 20 + r() * 60, s: 1 + r() * 2.6, ph: r() * 6.28 };
  });
  const burst = [...Array(110)].map((_, i) => {
    const r = rng(i * 13 + 11);
    const a = r() * Math.PI * 2;
    return { dx: Math.cos(a), dy: Math.sin(a), v: 500 + r() * 1300, s: 1.5 + r() * 3.5, c: [COL.accent, COL.primary, '#ffffff'][i % 3] };
  });
  const T_IMPACT = T_OUT + 1;

  function drawFX(t) {
    const g = fx;
    g.clearRect(0, 0, W, H);
    g.globalCompositeOperation = 'lighter';
    for (const d of dust) {
      const y = ((d.y - t * d.v) % H + H) % H;
      const a = 0.25 + 0.25 * Math.sin(t * 2 + d.ph);
      g.fillStyle = rgba(COL.accent, a * 0.6);
      g.beginPath(); g.arc(d.x + Math.sin(t + d.ph) * 14, y, d.s, 0, 6.283); g.fill();
    }
    const dt = t - T_IMPACT;
    if (dt >= 0 && dt < 2.5) {
      const k = 2.6;
      for (const b of burst) {
        const dist = b.v * (1 - Math.exp(-k * dt)) / k;
        const a = Math.exp(-dt * 1.6);
        g.fillStyle = rgba(b.c, a);
        g.beginPath(); g.arc(LOGO_CX + b.dx * dist, LOGO_CY + b.dy * dist, b.s * (1 - dt / 3), 0, 6.283); g.fill();
      }
    }
    g.globalCompositeOperation = 'source-over';
  }

  const noise = document.createElement('canvas');
  noise.width = noise.height = 256;
  {
    const nc = noise.getContext('2d'), id = nc.createImageData(256, 256), r = rng(42);
    for (let i = 0; i < id.data.length; i += 4) {
      const v = (r() * 255) | 0;
      id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255;
    }
    nc.putImageData(id, 0, 0);
  }
  function drawGrain(t) {
    const f = Math.floor(t * C.video.fps);
    const ox = (hash(f) * 256) | 0, oy = (hash(f + 0.5) * 256) | 0;
    for (let x = -ox; x < W; x += 256) for (let y = -oy; y < H; y += 256) gr.drawImage(noise, x, y);
  }

  // ---------------------------------------------------------------- global fx
  const WHIPS = [SC.scroll.start, SC.detail.start, SC.mobile.start, SC.montage.start];
  const nCards = cards.length;
  const cardT = i => SC.montage.start + i * ((SC.montage.end - SC.montage.start) / nCards);
  const IMPACTS = [[SC.reveal.start, 18], ...cards.map((_, i) => [cardT(i), i === nCards - 1 ? 9 : 6]), [T_IMPACT, 14]];
  const FLASHES = [[SC.reveal.start, 0.85, 0.35], ...cards.map((_, i) => [cardT(i), 0.18, 0.12]), [SC.cta.start, 0.4, 0.25], [T_IMPACT, 0.7, 0.5]];

  function whipX(t, s, inn, out) {
    let x = 0;
    if (inn && t < s.start + 0.3) x = (1 - E.outCubic(P(t, s.start, s.start + 0.3))) * 1150;
    if (out && t > s.end - 0.25) x = -E.inCubic(P(t, s.end - 0.25, s.end)) * 1150;
    return x;
  }

  function globals(t) {
    let x = 0, y = 0, r = 0;
    for (const [ti, amp] of IMPACTS) {
      const dt = t - ti;
      if (dt < 0 || dt > 0.7) continue;
      const k = amp * Math.exp(-dt * 8);
      x += Math.sin(dt * 93) * k; y += Math.cos(dt * 71) * k; r += Math.sin(dt * 57) * k * 0.02;
    }
    cam.style.transform = `translate(${x}px,${y}px) rotate(${r}deg)`;

    let blur = 0;
    for (const b of WHIPS) { const d = (t - b) / 0.11; blur += 70 * Math.exp(-d * d); }
    $('#mblurStd').setAttribute('stdDeviation', `${blur.toFixed(2)} 0`);
    cam.style.filter = blur > 0.6 ? 'url(#mblur)' : 'none';

    let fl = 0;
    for (const [ti, amp, dec] of FLASHES) {
      const dt = t - ti;
      if (dt >= 0 && dt < dec * 2) fl = Math.max(fl, amp * Math.exp(-dt / dec * 3));
    }
    $('#flash').style.opacity = fl;
    $('#fade').style.opacity = E.inCubic(P(t, C.video.duration - 0.8, C.video.duration - 0.05));
  }

  // ---------------------------------------------------------------- scenes
  function upHook(t) {
    wordsIn(hl1.ws, t, 0.15, { dur: 0.6, stagger: 0.12 });
    const a = P(t, 1.0, 1.45), e = E.outExpo(a);
    h2.style.opacity = clamp(a * 4);
    h2.style.transform = `scale(${lerp(1.8, 1, e) + 0.02 * Math.sin(t * 3)})`;
    const glitch = (t >= 1.0 && t < 1.5) || (t >= 2.95 && t < 3.12) || (t >= 3.55 && t < 3.7);
    const f = Math.floor(t * 40);
    ghosts.forEach((g, k) => {
      if (!glitch) { g.style.opacity = 0; return; }
      const j = hash(f * 3.1 + k * 17), top = hash(f + k * 5) * 70;
      g.style.opacity = 0.85;
      g.style.transform = `translateX(${(j - 0.5) * 56}px)`;
      g.style.clipPath = `inset(${top}% 0 ${Math.max(0, 100 - top - 18 - hash(f * 1.7 + k) * 30)}% 0)`;
    });
    h2main.style.transform = glitch ? `skewX(${(hash(f * 2.3) - 0.5) * 14}deg) translateX(${(hash(f * 4.1) - 0.5) * 18}px)` : 'none';
    h2.style.filter = e < 0.999 ? `blur(${(1 - e) * 20}px)` : 'none';
    wordsIn(hl3.ws, t, 2.0, { stagger: 0.14, dur: 0.55, dy: 70, blur: 18 });

    const x = P(t, 3.3, 4.0), ex = E.inExpo(x);
    hookWrap.style.transform = `scale(${1 + ex * 1.7})`;
    hookWrap.style.opacity = 1 - E.inCubic(x);
    hookWrap.style.filter = ex > 0.001 ? `blur(${ex * 16}px)` : 'none';
  }

  function upReveal(t) {
    const s = SC.reveal.start;
    wordsIn(rl1.ws, t, s + 0.05, { stagger: 0.08 });
    wordsIn(rl2.ws, t, s + 0.18, { stagger: 0.1, dy: 70, blur: 20 });
    const pa = P(t, s + 0.55, s + 1.1);
    pill.style.opacity = clamp(pa * 3);
    pill.style.transform = `scale(${lerp(0.5, 1, E.outBack(pa))})`;
    const b = E.outExpo(P(t, s, s + 1.0)), d = E.inOutCubic(P(t, s + 1, SC.reveal.end));
    rvB.root.style.transform =
      `translateY(${(1 - b) * 1000 + Math.sin(t * 2) * 6}px) rotateX(${lerp(55, 9, b) - d * 6}deg) ` +
      `rotateY(${lerp(0, -7, b) + d * 12}deg) scale(${lerp(0.75, 1, b)})`;
    rvGlow.style.opacity = b * 0.9;
    setScroll(rvB, E.inOutCubic(P(t, s + 1.4, s + 3.7)) * 0.12);
    S.reveal.style.transform = `translateX(${whipX(t, SC.reveal, false, true)}px)`;
  }

  function upScroll(t) {
    const s = SC.scroll.start;
    capIn(scCap, t, s + 0.1);
    const r = E.inOutCubic(P(t, s, SC.scroll.end));
    scB.root.style.transform = `rotateY(${lerp(7, -7, r)}deg) rotateX(${lerp(4, 1, r)}deg)`;
    const f = E.inOutCubic(P(t, s + 0.35, s + 1.75)) * 0.42 + E.inOutCubic(P(t, s + 2.05, s + 3.65)) * 0.5;
    setScroll(scB, f);
    S.scroll.style.transform = `translateX(${whipX(t, SC.scroll, true, true)}px)`;
  }

  function upDetail(t) {
    const s = SC.detail.start;
    capIn(dCap, t, s + 0.1);
    const vw = dB.vw, vh = dB.vh;
    const ih = dB.img.naturalHeight * vw / Math.max(1, dB.img.naturalWidth);
    const f = scr.detail_focus;
    const rx = f.x * vw, ry = f.y * ih, rw = f.w * vw, rh = f.h * ih;
    const z = E.inOutCubic(P(t, s + 1.1, s + 2.35));
    const sF = Math.min(vw / rw, vh / rh) * 0.86;
    const sc = lerp(1, sF, z) * (1 + 0.05 * E.inOutCubic(P(t, s + 2.35, SC.detail.end)));
    const cx = lerp(vw / 2, rx + rw / 2, z), cy = lerp(vh / 2, ry + rh / 2, z);
    dB.layer.style.transform = `translate(${vw / 2 - sc * cx}px,${vh / 2 - sc * cy}px) scale(${sc})`;
    const ha = P(t, s + 0.35, s + 0.9);
    const dim = 0.6 * E.outCubic(P(t, s + 0.45, s + 1.0));
    css(hl, {
      left: rx + 'px', top: ry + 'px', width: rw + 'px', height: rh + 'px',
      opacity: clamp(ha * 3), transform: `scale(${lerp(1.25, 1, E.outBack(ha))})`,
      borderWidth: 4 / sc + 'px', borderRadius: 18 / sc + 'px',
      boxShadow: `0 0 0 4000px rgba(4,8,18,${dim}), 0 0 ${40 / sc}px rgba(46,230,214,.75)`,
    });
    const b = E.outExpo(P(t, s, s + 0.6));
    dB.root.style.transform = `rotateX(${lerp(8, 0, z)}deg) scale(${lerp(0.94, 1.06, z) * lerp(0.9, 1, b)})`;
    dGlow.style.opacity = 0.8;
    S.detail.style.transform = `translateX(${whipX(t, SC.detail, true, true)}px)`;
  }

  function upMobile(t) {
    const s = SC.mobile.start;
    capIn(mCap, t, s + 0.1);
    const a = P(t, s + 0.05, s + 0.95);
    phone.style.transform =
      `translateY(${(1 - E.outExpo(a)) * 1100 + Math.sin(t * 2.2) * 8}px) rotate(${lerp(14, 0, E.outBack(a))}deg)`;
    const d = E.outExpo(P(t, s + 0.25, s + 1.1));
    mDesk.root.style.transform = `translateX(${(1 - d) * -700}px) rotateY(24deg) scale(.94)`;
    mDesk.root.style.opacity = 0.85 * d;
    setScroll(pB, E.inOutCubic(P(t, s + 1.0, s + 2.2)) * 0.4 + E.inOutCubic(P(t, s + 2.5, s + 3.65)) * 0.45);
    setScroll(mDesk, E.inOutCubic(P(t, s + 1.2, SC.mobile.end)) * 0.2);
    S.mobile.style.transform = `translateX(${whipX(t, SC.mobile, true, true)}px)`;
  }

  function upMontage(t) {
    const s = SC.montage.start;
    capIn(mtCap, t, s + 0.05);
    const step = (SC.montage.end - s) / nCards;
    cards.forEach((c, i) => {
      const ti = cardT(i);
      const e = E.outExpo(P(t, ti, ti + 0.28));
      const depth = Math.max(0, Math.floor((t - ti) / step));
      c.root.style.opacity = t < ti ? 0 : 1;
      c.root.style.zIndex = i + 1;
      c.root.style.transform =
        `translate(${cardX[i % 4]}px,${cardY[i % 4]}px) rotate(${cardRot[i % 4] * e}deg) scale(${lerp(1.45, 1, e) * Math.pow(0.95, depth)})`;
      c.root.style.filter = `brightness(${Math.pow(0.78, depth).toFixed(3)})`;
    });
    const z = E.inExpo(P(t, SC.montage.end - 0.25, SC.montage.end));
    S.montage.style.opacity = 1 - z;
    S.montage.style.transform = `translateX(${whipX(t, SC.montage, true, false)}px) scale(${1 + z * 2.2})`;
  }

  const TYPE_START = SC.cta.start + 0.4, TYPE_DUR = 1.0;
  const T_ENTER = SC.cta.start + 1.55, T_BTN = SC.cta.start + 1.65, T_CLICK = SC.cta.start + 2.6;
  function upCta(t) {
    const s = SC.cta.start, dom = C.brand.domain;
    capIn(ctCap, t, s + 0.1);
    const ap = E.outExpo(P(t, s + 0.05, s + 0.6));
    const enter = t >= T_ENTER ? Math.exp(-(t - T_ENTER) * 5) : 0;
    css(addr, {
      opacity: ap,
      transform: `translateY(${(1 - ap) * 60}px) scale(${lerp(0.9, 1, ap) + enter * 0.04})`,
      borderColor: enter > 0.02 ? rgba(COL.accent, 0.4 + enter * 0.6) : 'rgba(255,255,255,.16)',
      boxShadow: `0 30px 80px rgba(0,0,0,.5), 0 0 ${60 + enter * 80}px ${rgba(COL.accent, 0.25 + enter * 0.5)}`,
    });
    const n = t < TYPE_START ? 0 : Math.min(dom.length, Math.floor((t - TYPE_START) / (TYPE_DUR / dom.length)) + 1);
    typed.textContent = dom.slice(0, n);
    const typing = t >= TYPE_START && t < TYPE_START + TYPE_DUR + 0.1;
    caret.style.opacity = typing || Math.floor((t - s) * 2.4) % 2 === 0 ? 1 : 0;

    const ba = P(t, T_BTN, T_BTN + 0.55);
    const press = t >= T_CLICK && t < T_CLICK + 0.25 ? Math.sin(P(t, T_CLICK, T_CLICK + 0.25) * Math.PI) : 0;
    const pulse = t > T_CLICK + 0.3 ? 0.5 + 0.5 * Math.sin((t - T_CLICK) * 6) : 0;
    css(btn, {
      opacity: clamp(ba * 3),
      transform: `scale(${lerp(0.6, 1, E.outBack(ba)) - press * 0.06})`,
      boxShadow: `0 24px 70px rgba(61,123,255,${0.55 + pulse * 0.25}), 0 0 ${pulse * 60}px ${rgba(COL.accent, 0.5)}, inset 0 2px 0 rgba(255,255,255,.25)`,
    });

    const btnCx = 540, btnCy = 1010 + 66;
    const cm = E.inOutCubic(P(t, T_CLICK - 0.75, T_CLICK - 0.05));
    const cx = lerp(930, btnCx + 40, cm), cy = lerp(1560, btnCy + 10, cm) - Math.sin(cm * Math.PI) * 90;
    css(cursor, {
      left: cx + 'px', top: cy + 'px',
      opacity: clamp(P(t, T_CLICK - 0.8, T_CLICK - 0.6)),
      transform: `scale(${1 - press * 0.18})`,
    });
    const rp = P(t, T_CLICK, T_CLICK + 0.6), rs = E.outCubic(rp) * 460;
    css(ripple, {
      left: btnCx + 40 - rs / 2 + 'px', top: btnCy + 10 - rs / 2 + 'px', width: rs + 'px', height: rs + 'px',
      opacity: t >= T_CLICK ? 1 - rp : 0,
    });

    const x = P(t, SC.cta.end - 0.35, SC.cta.end);
    S.cta.style.transform = `scale(${1 + E.inExpo(x) * 0.6})`;
    S.cta.style.opacity = 1 - E.inCubic(x);
  }

  function upOutro(t) {
    const s = T_OUT, ti = T_IMPACT;
    const intro = E.outExpo(P(t, s + 0.4, ti));
    const pop = t >= ti ? E.outElastic(P(t, ti, ti + 0.9)) : 0;
    const push = 1 + 0.04 * E.inOutCubic(P(t, ti + 0.5, C.video.duration));
    logoInner.style.transform =
      `translate(-50%,-50%) scale(${(lerp(0.82, 0.96, intro) + (t >= ti ? 0.04 * pop : 0)) * push})`;
    if (logo.kind === 'svg' && logo.shapes.length) {
      const n = logo.shapes.length;
      logo.shapes.forEach((sh, i) => {
        const d0 = s + 0.45 + (i / n) * 0.35;
        const dp = E.inOutCubic(P(t, d0, d0 + 0.75));
        const fp = E.outCubic(P(t, ti - 0.05, ti + 0.6));
        const st = sh.s.style;
        if (sh.len > 0) {
          st.strokeDasharray = `${sh.len}`;
          st.strokeDashoffset = `${sh.len * (1 - dp)}`;
        }
        st.vectorEffect = 'non-scaling-stroke';
        st.stroke = sh.hadStroke && fp > 0.5 ? sh.stroke : COL.accent;
        st.strokeWidth = sh.hadStroke && fp > 0.5 ? sh.sw : `${lerp(2.5, 0, fp)}px`;
        st.strokeOpacity = sh.hadStroke ? sh.so : 1 - fp;
        st.fillOpacity = sh.fo * fp;
      });
      logo.others.forEach(o => { o.style.opacity = E.outCubic(P(t, ti - 0.05, ti + 0.6)); });
      logo.el.style.opacity = t < s + 0.4 ? 0 : 1;
      logo.el.style.filter = `drop-shadow(0 0 ${lerp(10, 34, t >= ti ? Math.exp(-(t - ti) * 2) : intro)}px ${rgba(COL.accent, 0.6)})`;
    } else if (logo.el) {
      const r = E.outExpo(P(t, s + 0.6, ti + 0.3));
      logo.el.style.clipPath = `circle(${r * 75}% at 50% 50%)`;
      logo.el.style.filter = `blur(${(1 - r) * 18}px) drop-shadow(0 0 ${t >= ti ? 10 + 26 * Math.exp(-(t - ti) * 2) : 10}px ${rgba(COL.accent, 0.6)})`;
      logo.el.style.opacity = r;
    }
    logoGlow.style.opacity = 0.35 + 0.65 * (t >= ti ? Math.exp(-(t - ti) * 1.5) : intro * 0.4);
    const sw = P(t, ti + 1.2, ti + 2.0);
    sweepBox.style.opacity = sw > 0 && sw < 1 ? 1 : 0;
    sweepBar.style.left = `${lerp(-50, 110, E.inOutCubic(sw))}%`;
    const ta = P(t, ti + 1.4, ti + 2.0);
    tagline.style.opacity = E.outCubic(ta);
    tagline.style.transform = `translateY(${(1 - E.outExpo(ta)) * 30}px)`;
  }

  const UPDATERS = { hook: upHook, reveal: upReveal, scroll: upScroll, detail: upDetail, mobile: upMobile, montage: upMontage, cta: upCta, outro: upOutro };

  window.__seek = function (t) {
    drawBG(t);
    for (const s of C.scenes) {
      const on = t >= s.start && (t < s.end || s === C.scenes[C.scenes.length - 1]);
      S[s.id].style.display = on ? 'block' : 'none';
      if (on) UPDATERS[s.id](t);
    }
    drawFX(t);
    drawGrain(t);
    globals(t);
  };

  // ---------------------------------------------------------------- cues
  const cues = [];
  const cue = (t, type, gain = 1, extra = {}) => cues.push({ t: Math.round(t * 1000) / 1000, type, gain, ...extra });
  cue(0.15, 'tick', 0.5); cue(0.27, 'tick', 0.35);
  cue(1.0, 'glitch', 0.8); cue(1.0, 'hit', 0.7);
  SC.hook.lines[2].split(' ').forEach((_, i) => cue(2.0 + i * 0.14, 'pop', 0.45));
  cue(2.95, 'glitch', 0.45); cue(3.55, 'glitch', 0.4);
  cue(1.5, 'riser', 0.9, { dur: SC.reveal.start - 1.5 });
  cue(SC.reveal.start, 'impact', 1.0); cue(SC.reveal.start + 0.02, 'whoosh', 0.8);
  cue(SC.reveal.start + 0.55, 'pop', 0.6);
  WHIPS.forEach(b => cue(b - 0.14, 'whip', 0.85));
  [SC.scroll, SC.detail, SC.mobile, SC.montage].forEach(s => cue(s.start + 0.12, 'pop', 0.4));
  cue(SC.scroll.start + 0.35, 'swipe', 0.45); cue(SC.scroll.start + 2.05, 'swipe', 0.45);
  cue(SC.detail.start + 0.35, 'blip', 0.65); cue(SC.detail.start + 1.1, 'zoom', 0.75, { dur: 1.25 });
  cue(SC.mobile.start + 0.05, 'whoosh', 0.7);
  cue(SC.mobile.start + 1.0, 'swipe', 0.35); cue(SC.mobile.start + 2.5, 'swipe', 0.35);
  cards.forEach((_, i) => cue(cardT(i), 'slam', i === nCards - 1 ? 0.95 : 0.75));
  cue(SC.montage.end - 0.45, 'zoomthrough', 0.8, { dur: 0.45 });
  cue(SC.cta.start + 0.12, 'pop', 0.45);
  for (let i = 0; i < C.brand.domain.length; i++) cue(TYPE_START + i * (TYPE_DUR / C.brand.domain.length), 'key', 0.35 + 0.2 * hash(i));
  cue(T_ENTER, 'enter', 0.7); cue(T_BTN, 'pop', 0.6);
  cue(T_CLICK, 'click', 0.9); cue(T_CLICK + 0.02, 'sparkle', 0.5);
  cue(T_OUT - 0.1, 'swell', 0.9, { dur: T_IMPACT - T_OUT + 0.1 });
  cue(T_OUT, 'subdrop', 0.7);
  cue(T_OUT + 0.45, 'draw', 0.5, { dur: 1.0 });
  cue(T_IMPACT, 'impact', 1.0); cue(T_IMPACT, 'shimmer', 0.75);
  cue(T_IMPACT + 1.2, 'sweep', 0.55);
  cues.sort((a, b) => a.t - b.t);
  window.__CUES = cues;

  // ---------------------------------------------------------------- ready
  const fontLoads = [400, 500, 700, 800, 900].map(w => document.fonts.load(`${w} 100px Vaz`, 'تکین abc'));
  window.__ready = Promise.all(fontLoads)
    .then(() => setupLogo())
    .then(() => document.fonts.ready)
    .then(() => { window.__seek(0); return true; });
})();
