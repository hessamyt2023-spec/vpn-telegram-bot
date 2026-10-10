#!/usr/bin/env python3
"""Sound design for the TakinTech reel.

Synthesises a 120 BPM music bed and every SFX from scratch (no samples, so
nothing to license), places the SFX on the cue points the visual timeline
exported (build/cues.json), drops in the narration, ducks the music under
the voice and writes build/mix.wav.

    python3 scripts/sound.py            # needs build/cues.json (render.cjs --cues-only)
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, fftconvolve, sosfilt

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build"
SR = 48000

cfg = json.loads((ROOT / "config.json").read_text(encoding="utf-8"))
cues = json.loads((BUILD / "cues.json").read_text(encoding="utf-8"))
DUR = cfg["video"]["duration"]
BPM = cfg["video"]["bpm"]
BEAT = 60.0 / BPM
BAR = BEAT * 4
SCN = {s["id"]: s for s in cfg["scenes"]}
T_DROP = SCN["reveal"]["start"]
T_OUTRO = SCN["outro"]["start"]
T_IMPACT = T_OUTRO + 1.0
N = int(DUR * SR)
rng = np.random.default_rng(7)


# ------------------------------------------------------------------ helpers
def tt(d):
    return np.arange(int(d * SR)) / SR


def mtof(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def sos(kind, fc, order=2):
    if kind == "band":
        return butter(order, fc, "bandpass", fs=SR, output="sos")
    return butter(order, min(fc, SR / 2 - 100), kind, fs=SR, output="sos")


def filt(x, kind, fc, order=2):
    return sosfilt(sos(kind, fc, order), x)


def tv_filt(x, kind, fcs, block=256):
    """Time-varying Butterworth filter: coefficients updated per block."""
    out = np.zeros_like(x)
    zi = np.zeros((1, 2))
    for i in range(0, len(x), block):
        fc = float(np.clip(fcs[min(i, len(fcs) - 1)], 30, SR / 2 - 200))
        s = sos(kind, fc, 2)
        out[i:i + block], zi = sosfilt(s, x[i:i + block], zi=zi)
    return out


def pan(p):
    a = (np.clip(p, -1, 1) + 1) * np.pi / 4
    return np.cos(a), np.sin(a)


def place(buf, sig, t, gain=1.0, p=0.0):
    """Add a mono (or stereo [n,2]) signal into stereo buf at time t."""
    i = int(round(t * SR))
    if sig.ndim == 1:
        gl, gr = pan(p)
        sig = np.stack([sig * gl, sig * gr], axis=1)
    if i < 0:
        sig, i = sig[-i:], 0
    n = min(len(sig), len(buf) - i)
    if n > 0:
        buf[i:i + n] += sig[:n] * gain


def noise(n):
    return rng.standard_normal(n)


def make_ir(dur=2.6, decay=2.6, lp_fc=7000, seed=3):
    r = np.random.default_rng(seed)
    t = np.arange(int(dur * SR)) / SR
    env = np.exp(-decay * t) * np.minimum(1, t / 0.008)
    ir = np.stack([filt(r.standard_normal(len(t)) * env, "low", lp_fc),
                   filt(r.standard_normal(len(t)) * env, "low", lp_fc)], axis=1)
    return ir / np.sqrt(np.sum(ir ** 2) / 2)


IR_HALL = make_ir()
IR_ROOM = make_ir(1.0, 5.5, 9000, 5)


def reverb(x, ir, wet=0.3):
    if x.ndim == 1:
        x = np.stack([x, x], axis=1)
    y = np.stack([fftconvolve(x[:, c], ir[:, c])[:len(x)] for c in range(2)], axis=1)
    return y * wet


def additive_saw(f, t, harmonics=12, tilt=6.0, detune_cents=(0,), weights=None):
    out = np.zeros_like(t)
    for dc in detune_cents:
        ff = f * 2 ** (dc / 1200)
        ph = rng.uniform(0, 2 * np.pi)
        for k in range(1, harmonics + 1):
            if ff * k > SR / 2 - 1000:
                break
            w = weights(k) if weights is not None else np.exp(-k / tilt)
            out += w / k * np.sin(2 * np.pi * ff * k * t + ph * k)
    return out / len(detune_cents)


# ------------------------------------------------------------------ music
PROG = [  # (bass midi, pad voicing, arp tones) : Am7 | Fmaj7 | Cmaj7 | G(add9)
    (33, [57, 60, 64, 67], [57, 60, 64, 69, 72, 76]),
    (29, [53, 57, 60, 64], [53, 57, 60, 65, 69, 72]),
    (36, [55, 60, 64, 71], [60, 64, 67, 72, 76, 79]),
    (31, [55, 59, 62, 69], [55, 59, 62, 67, 71, 74]),
]
ARP_PAT = [0, 2, 4, 5, 4, 2, 3, 1, 0, 2, 4, 5, 3, 4, 2, 1]


def kick():
    t = tt(0.45)
    f = 45 + 110 * np.exp(-t * 28)
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-t * 7.5)
    click = filt(noise(len(t)), "high", 3000) * np.exp(-t * 300) * 0.25
    return np.tanh((body + click) * 1.6)


def clap():
    t = tt(0.35)
    env = np.zeros_like(t)
    for d in (0, 0.011, 0.022):
        env += np.exp(-np.maximum(t - d, 0) * 90) * (t >= d)
    env += 0.5 * np.exp(-np.maximum(t - 0.03, 0) * 14) * (t >= 0.03)
    return filt(noise(len(t)), "band", (900, 3200)) * env * 0.8


def hat(open_=False):
    t = tt(0.25 if open_ else 0.06)
    env = np.exp(-t * (14 if open_ else 70))
    return filt(noise(len(t)), "high", 7500, 4) * env * 0.5


def snare():
    t = tt(0.25)
    tone = np.sin(2 * np.pi * 190 * t) * np.exp(-t * 30) * 0.5
    nz = filt(noise(len(t)), "band", (1500, 7000)) * np.exp(-t * 22)
    return tone + nz


def pluck(f, d=0.32):
    t = tt(d)
    out = np.zeros_like(t)
    for k in range(1, 9):
        out += (1 / k) * np.sin(2 * np.pi * f * k * t) * np.exp(-t * (7 + k * 5))
    return out * np.minimum(1, t / 0.003)


def bass_note(f, d=0.22):
    t = tt(d)
    body = additive_saw(f, t, harmonics=10, tilt=3.0)
    sub = np.sin(2 * np.pi * f * t) * 0.8
    env = np.minimum(1, t / 0.004) * np.exp(-t * 6)
    env[-int(0.01 * SR):] *= np.linspace(1, 0, int(0.01 * SR))
    return np.tanh((body * 0.6 + sub) * env * 1.4)


def pad_chord(notes, d, open_curve=None):
    t = tt(d)
    out = np.zeros_like(t)
    for m in notes:
        f = mtof(m)
        if open_curve is None:
            out += additive_saw(f, t, harmonics=14, tilt=4.0, detune_cents=(-8, 0, 7))
        else:  # brightness opens over time: per-harmonic gain follows the curve
            oc = open_curve(t)
            for dc in (-8, 0, 7):
                ff = f * 2 ** (dc / 1200)
                for k in range(1, 15):
                    w = np.exp(-k / (1.0 + 5.0 * oc))
                    out += w / k * np.sin(2 * np.pi * ff * k * t + rng.uniform(0, 6.28)) / 3
    att = np.minimum(1, t / 0.25)
    rel = np.minimum(1, (d - t) / 0.3)
    return out * att * np.clip(rel, 0, 1) / len(notes)


def sidechain(times, depth, rec=0.32):
    g = np.ones(N)
    for k in times:
        i = int(k * SR)
        n = min(int(rec * SR), N - i)
        if n <= 0:
            continue
        x = np.linspace(0, 1, n)
        g[i:i + n] = np.minimum(g[i:i + n], 1 - depth * (1 - x) ** 2)
    return g


def build_music():
    drums = np.zeros((N, 2))
    bass = np.zeros((N, 2))
    pad = np.zeros((N, 2))
    arp = np.zeros((N, 2))
    K = kick()
    kicks = []

    n_bars = int(np.ceil(DUR / BAR))
    for b in range(n_bars):
        t0 = b * BAR
        bass_m, voicing, arp_tones = PROG[b % 4]
        in_groove = T_DROP <= t0 < T_OUTRO
        # pad
        if t0 < T_DROP:
            span0, span1 = 0.0, T_DROP
            ch = pad_chord(voicing, BAR + 0.3,
                           open_curve=lambda tt_, s=t0: np.clip((tt_ + s - span0) / (span1 - span0), 0, 1) ** 1.5)
            place(pad, ch, t0, 0.55 * (0.6 + 0.4 * b / max(1, T_DROP / BAR)))
        elif t0 < T_OUTRO:
            place(pad, pad_chord(voicing, BAR + 0.3), t0, 0.5)
        # drums, bass, arp
        for beat in range(4):
            tb = t0 + beat * BEAT
            if tb >= DUR:
                break
            if in_groove and tb < T_OUTRO:
                place(drums, K, tb, 0.95)
                kicks.append(tb)
                if beat in (1, 3):
                    place(drums, clap(), tb, 0.55, 0.05)
                place(drums, hat(True), tb + BEAT / 2, 0.32, 0.25)
                place(bass, bass_note(mtof(bass_m), 0.2), tb + BEAT / 2, 0.55)
                place(bass, bass_note(mtof(bass_m), 0.12), tb + BEAT * 0.75, 0.3)
            for s16 in range(4):
                ts = tb + s16 * BEAT / 4
                if ts >= T_OUTRO:
                    continue
                if in_groove or ts >= 2.0:
                    acc = 1.0 if s16 == 2 else 0.6
                    place(drums, hat(), ts, (0.22 if in_groove else 0.12) * acc, -0.3 + 0.2 * s16)
                if in_groove or ts >= BAR:
                    idx = ARP_PAT[(beat * 4 + s16) % 16]
                    note = arp_tones[idx]
                    lvl = 0.33 if in_groove else 0.18 * (ts - BAR) / BAR + 0.05
                    place(arp, pluck(mtof(note)), ts, lvl, 0.35 if s16 % 2 else -0.35)

    # snare fill into the outro
    t_fill = T_OUTRO - BEAT
    for i in range(8):
        ts = t_fill + i * BEAT / 8
        place(drums, snare(), ts, 0.25 + 0.5 * i / 8, 0.0)

    # outro: suspended pad, then a wide chord on the logo impact + bells
    out_notes = [45, 52, 57, 59, 60, 64]  # A2 E3 A3 B3 C4 E4  (Am add9)
    ch = pad_chord(out_notes, DUR - T_OUTRO + 0.2,
                   open_curve=lambda tt_: np.clip(tt_ / 1.0, 0, 1) ** 2 * 0.8 + 0.2)
    env = np.ones(len(ch))
    tt_o = np.arange(len(ch)) / SR
    env *= np.clip(1 - (tt_o - (DUR - T_OUTRO - 1.6)) / 1.5, 0, 1)
    place(pad, ch * env, T_OUTRO, 0.75)
    bells = [(T_IMPACT + 0.0, 81), (T_IMPACT + 0.35, 88), (T_IMPACT + 0.7, 84), (T_IMPACT + 1.05, 83),
             (T_IMPACT + 1.6, 81), (T_IMPACT + 2.3, 76)]
    for tb, m in bells:
        t = tt(1.6)
        f = mtof(m)
        b_ = (np.sin(2 * np.pi * f * t) + 0.3 * np.sin(2 * np.pi * f * 2.76 * t) * np.exp(-t * 4)) * np.exp(-t * 2.5)
        place(arp, b_, tb, 0.22, 0.4 * np.sin(tb * 3))

    sc = sidechain(kicks, 1.0)
    bass *= (1 - 0.65 * (1 - sc))[:, None]
    pad *= (1 - 0.45 * (1 - sc))[:, None]
    arp *= (1 - 0.3 * (1 - sc))[:, None]

    bus = drums + bass + pad * 0.9 + arp
    bus += reverb(pad + arp * 0.7, IR_HALL, 0.32) + reverb(drums * 0.3, IR_ROOM, 0.25)
    bus = filt(bus.T, "high", 28).T
    return np.tanh(bus * 0.9)


# ------------------------------------------------------------------ sfx
def env_exp(t, k):
    return np.exp(-t * k)


def sfx_tick(c):
    t = tt(0.05)
    return np.sin(2 * np.pi * 2200 * t) * env_exp(t, 90) + filt(noise(len(t)), "high", 5000) * env_exp(t, 400) * 0.4


def sfx_pop(c):
    t = tt(0.12)
    f = 420 + 700 * (1 - np.exp(-t * 60))
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * env_exp(t, 32)
    return s + filt(noise(len(t)), "high", 4000) * env_exp(t, 500) * 0.25


def sfx_glitch(c):
    d = 0.32
    t = tt(d)
    out = np.zeros_like(t)
    seg = int(0.02 * SR)
    for i in range(0, len(t), seg):
        r = rng.random()
        n = min(seg, len(t) - i)
        tt_ = np.arange(n) / SR
        if r < 0.4:
            out[i:i + n] = np.sign(np.sin(2 * np.pi * rng.uniform(200, 1800) * tt_)) * 0.5
        elif r < 0.8:
            out[i:i + n] = np.round(noise(n) * 3) / 3 * 0.6
    out = filt(out, "band", (300, 9000))
    return out * np.minimum(1, (d - t) / 0.05)


def sfx_hit(c):
    t = tt(0.6)
    f = 40 + 90 * np.exp(-t * 20)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * env_exp(t, 6)
    nz = filt(noise(len(t)), "low", 3500) * env_exp(t, 25) * 0.5
    return np.tanh((s + nz) * 1.5)


def sfx_riser(c):
    d = c.get("dur", 2.5)
    t = tt(d)
    x = t / d
    nz = tv_filt(noise(len(t)), "low", 400 + 9000 * x ** 2) * 0.35
    f = 180 + 1300 * x ** 2.2
    tone = sum(np.sin(2 * np.pi * np.cumsum(f * m) / SR) / m for m in (1, 2.01, 3.02)) * 0.2
    env = x ** 2.2
    return (nz + tone) * env


def sfx_impact(c):
    t = tt(2.6)
    f = 32 + 45 * np.exp(-t * 6)
    boom = np.sin(2 * np.pi * np.cumsum(f) / SR) * env_exp(t, 1.6)
    crack = filt(noise(len(t)), "low", 6000) * env_exp(t, 18) * 0.7
    body = filt(noise(len(t)), "band", (80, 600)) * env_exp(t, 5) * 0.5
    dry = np.tanh((boom * 1.2 + crack + body) * 1.3)
    st = np.stack([dry, dry], axis=1)
    return st + reverb(dry * 0.6, IR_HALL, 0.5)


def whoosh_core(d, peak, lo=300, hi=6000, k=1.0):
    t = tt(d)
    x = t / d
    env = np.where(t < peak, (t / peak) ** 2, np.exp(-(t - peak) / (d - peak) * 4 * k))
    fc = lo + (hi - lo) * np.where(t < peak, t / peak, np.exp(-(t - peak) / (d - peak) * 3))
    s = tv_filt(noise(len(t)), "low", fc) * env
    pans = np.linspace(-0.8, 0.8, len(t))
    gl, gr = pan(pans)
    return np.stack([s * gl, s * gr], axis=1) * 0.9 + 0 * x[:, None]


def sfx_whoosh(c):
    return whoosh_core(0.7, 0.18)


def sfx_whip(c):
    return whoosh_core(0.4, 0.14, 500, 9000) * 1.2


def sfx_swipe(c):
    return whoosh_core(0.45, 0.15, 1500, 7000) * 0.5


def sfx_blip(c):
    t = tt(0.2)
    a = np.sin(2 * np.pi * 880 * t) * (t < 0.07)
    b = np.sin(2 * np.pi * 1320 * t) * (t >= 0.07)
    return (a + b) * env_exp(t, 14) * 0.5


def sfx_zoom(c):
    d = c.get("dur", 1.2)
    t = tt(d)
    x = t / d
    s = tv_filt(noise(len(t)), "band" if False else "low", 300 + 4000 * x) * np.sin(np.pi * x) * 0.5
    tone = np.sin(2 * np.pi * np.cumsum(220 + 440 * x) / SR) * np.sin(np.pi * x) * 0.12
    return s + tone


def sfx_slam(c):
    t = tt(0.5)
    f = 50 + 120 * np.exp(-t * 30)
    th = np.sin(2 * np.pi * np.cumsum(f) / SR) * env_exp(t, 10)
    sn = filt(noise(len(t)), "band", (800, 8000)) * env_exp(t, 20) * 0.6
    dry = np.tanh((th + sn) * 1.4)
    return np.stack([dry, dry], axis=1) + reverb(dry, IR_ROOM, 0.35)


def sfx_zoomthrough(c):
    d = c.get("dur", 0.45)
    t = tt(d)
    x = t / d
    return tv_filt(noise(len(t)), "low", 500 + 10000 * x ** 2) * x ** 2 * 0.8


def sfx_key(c):
    t = tt(0.06)
    fr = rng.uniform(2200, 3800)
    s = filt(noise(len(t)), "band", (fr * 0.8, fr * 1.25)) * env_exp(t, 160)
    th = np.sin(2 * np.pi * rng.uniform(140, 190) * t) * env_exp(t, 80) * 0.5
    return (s + th) * 0.9


def sfx_enter(c):
    t = tt(0.12)
    s = filt(noise(len(t)), "band", (1200, 3000)) * env_exp(t, 80)
    th = np.sin(2 * np.pi * 110 * t) * env_exp(t, 40)
    return s + th


def sfx_click(c):
    t = tt(0.08)
    a = filt(noise(len(t)), "high", 2500) * env_exp(t, 600)
    b = np.roll(a, int(0.045 * SR)) * 0.6
    b[:int(0.045 * SR)] = 0
    return (a + b) * 1.1 + np.sin(2 * np.pi * 900 * t) * env_exp(t, 200) * 0.3


def sfx_sparkle(c):
    t = tt(0.9)
    out = np.zeros_like(t)
    for i, m in enumerate((88, 93, 96, 100)):
        d = i * 0.06
        tt_ = np.maximum(t - d, 0)
        out += np.sin(2 * np.pi * mtof(m) * tt_) * env_exp(tt_, 6) * (t >= d)
    return np.stack([out, out], axis=1) * 0.25 + reverb(out * 0.25, IR_HALL, 0.4)


def sfx_swell(c):
    d = c.get("dur", 1.1)
    t = tt(d)
    x = t / d
    s = tv_filt(noise(len(t)), "low", 200 + 8000 * x ** 3) * x ** 3
    rev = filt(noise(len(t)), "high", 4000) * x ** 4 * 0.3
    return (s + rev) * 0.9


def sfx_subdrop(c):
    t = tt(1.4)
    f = 30 + 60 * np.exp(-t * 3)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.minimum(1, t / 0.01) * env_exp(t, 1.5)


def sfx_draw(c):
    d = c.get("dur", 1.0)
    t = tt(d)
    x = t / d
    trem = 0.6 + 0.4 * np.sin(2 * np.pi * 18 * t)
    s = filt(noise(len(t)), "band", (3000, 9000)) * trem * np.sin(np.pi * x) * 0.25
    tone = np.sin(2 * np.pi * np.cumsum(1500 + 1500 * x) / SR) * np.sin(np.pi * x) * 0.06
    return s + tone


def sfx_shimmer(c):
    t = tt(3.0)
    out = np.zeros_like(t)
    for m in (69, 76, 81, 83, 88):
        f = mtof(m)
        out += (np.sin(2 * np.pi * f * t) + 0.25 * np.sin(2 * np.pi * f * 3.01 * t)) * env_exp(t, 1.3)
    out *= 0.12
    return np.stack([out, out], axis=1) + reverb(out, IR_HALL, 0.7)


def sfx_sweep(c):
    t = tt(0.7)
    x = t / 0.7
    tone = np.sin(2 * np.pi * np.cumsum(3000 + 6000 * x) / SR) * np.sin(np.pi * x) * 0.12
    nz = filt(noise(len(t)), "high", 6000) * np.sin(np.pi * x) ** 2 * 0.25
    s = tone + nz
    gl, gr = pan(np.linspace(-0.9, 0.9, len(t)))
    return np.stack([s * gl, s * gr], axis=1)


SFX = {k[4:]: v for k, v in globals().items() if k.startswith("sfx_")}


def build_sfx():
    buf = np.zeros((N, 2))
    for c in cues:
        fn = SFX.get(c["type"])
        if fn is None:
            print(f"[sound] unknown cue type {c['type']}", file=sys.stderr)
            continue
        s = fn(c)
        place(buf, s, c["t"], c.get("gain", 1.0), 0.0)
    return buf


# ------------------------------------------------------------------ voice
VOICE_CHAIN = "highpass=f=80,acompressor=threshold=-20dB:ratio=3:attack=5:release=90,equalizer=f=3500:t=q:w=1:g=2"


def decode(path, tempo=1.0):
    af = VOICE_CHAIN + (f",atempo={tempo:.4f}" if abs(tempo - 1) > 1e-3 else "")
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-af", af, "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
        check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).astype(np.float64)


def find_audio(base):
    for ext in (".wav", ".mp3", ".m4a", ".ogg", ".flac"):
        p = base.with_suffix(ext)
        if p.exists():
            return p
    return None


def build_voice():
    """Priority: one recorded take on the timeline > per-line recordings > TTS lines."""
    voice = np.zeros(N)
    full = find_audio(ROOT / "assets" / "voice" / "narration")
    if full:
        v = decode(full)[:N]
        voice[:len(v)] = v
        print(f"[sound] narration: {full.relative_to(ROOT)}")
        return voice
    used = 0
    for i, line in enumerate(cfg["narration"]["lines"], 1):
        p = find_audio(ROOT / "assets" / "voice" / "lines" / f"{i:02d}") or find_audio(BUILD / "voice" / f"{i:02d}")
        if not p:
            continue
        v = decode(p)
        v = trim_silence(v)
        slot = line["end"] - line["start"]
        if len(v) / SR > slot:
            tempo = min(1.3, (len(v) / SR) / slot)
            v = trim_silence(decode(p, tempo))
        place_mono(voice, v, line["start"])
        used += 1
    print(f"[sound] narration: {used}/{len(cfg['narration']['lines'])} lines placed")
    return voice


def trim_silence(v, thr=0.01):
    idx = np.where(np.abs(v) > thr)[0]
    if len(idx) == 0:
        return v
    a = max(0, idx[0] - int(0.02 * SR))
    b = min(len(v), idx[-1] + int(0.08 * SR))
    return v[a:b]


def place_mono(buf, v, t):
    i = int(t * SR)
    n = min(len(v), len(buf) - i)
    if n > 0:
        buf[i:i + n] += v[:n]


def duck_gain(voice, depth=0.6):
    env = filt(np.abs(voice), "low", 8)
    env = np.clip(env / (np.max(env) + 1e-9) * 4, 0, 1)
    return 1 - depth * env


# ------------------------------------------------------------------ main
def norm(x, peak_db):
    p = np.max(np.abs(x)) + 1e-9
    return x / p * 10 ** (peak_db / 20)


def main():
    music = norm(build_music(), -6)
    sfx = norm(build_sfx(), -4)
    voice = build_voice()
    has_voice = np.max(np.abs(voice)) > 1e-4
    if has_voice:
        voice = norm(voice, -3)
        music = music * duck_gain(voice)[:, None]
    mix = music * 0.6 + sfx * 0.95 + (np.stack([voice, voice], axis=1) * 1.0 if has_voice else 0)
    fade = np.ones(N)
    nf = int(0.6 * SR)
    fade[-nf:] = np.linspace(1, 0, nf) ** 2
    mix *= fade[:, None]
    mix = np.tanh(mix * 1.1) / np.tanh(1.1)
    BUILD.mkdir(exist_ok=True)
    for name, x in (("music", music), ("sfx", sfx), ("mix", mix)):
        wavfile.write(BUILD / f"{name}.wav", SR, x.astype(np.float32))
    print(f"[sound] wrote build/mix.wav ({DUR}s, voice={'yes' if has_voice else 'no'})")


if __name__ == "__main__":
    main()
