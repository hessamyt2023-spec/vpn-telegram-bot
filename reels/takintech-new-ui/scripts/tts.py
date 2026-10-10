#!/usr/bin/env python3
"""Generate the Persian narration lines with Microsoft neural TTS (edge-tts).

    pip install edge-tts
    python3 scripts/tts.py                 # voice/rate from config.json
    python3 scripts/tts.py --voice fa-IR-DilaraNeural

Writes build/voice/01.mp3 ... one file per narration line; scripts/sound.py
places each one at its start time. Recorded takes in assets/voice/ win over
these. Needs network access to speech.platform.bing.com.
"""
import argparse
import asyncio
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


async def main():
    cfg = json.loads((ROOT / "config.json").read_text(encoding="utf-8"))["narration"]
    ap = argparse.ArgumentParser()
    ap.add_argument("--voice", default=cfg["voice"], help="fa-IR-FaridNeural (male) or fa-IR-DilaraNeural (female)")
    ap.add_argument("--rate", default=cfg.get("rate", "+0%"))
    ap.add_argument("--pitch", default=cfg.get("pitch", "+0Hz"))
    a = ap.parse_args()
    try:
        import edge_tts
    except ImportError:
        sys.exit("edge-tts is not installed: pip install edge-tts")
    out = ROOT / "build" / "voice"
    out.mkdir(parents=True, exist_ok=True)
    for i, line in enumerate(cfg["lines"], 1):
        path = out / f"{i:02d}.mp3"
        await edge_tts.Communicate(line["text"], a.voice, rate=a.rate, pitch=a.pitch).save(str(path))
        print(f"[tts] {path.relative_to(ROOT)}  {line['text']}")


if __name__ == "__main__":
    asyncio.run(main())
