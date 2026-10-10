#!/usr/bin/env bash
# Build the TakinTech new-UI reel end to end.
#   ./build.sh            full quality  -> out/takintech-new-ui-reel.mp4
#   ./build.sh --draft    faster JPEG frame capture for previews
#   ./build.sh --tts      (re)generate narration with edge-tts first
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p build out
PY=$(command -v python3 || command -v python)

DRAFT=""
for a in "$@"; do
  case "$a" in
    --draft) DRAFT="--draft" ;;
    --tts) "$PY" scripts/tts.py ;;
  esac
done

node scripts/render.cjs --cues-only
"$PY" scripts/sound.py
node scripts/render.cjs $DRAFT

# Two-pass loudness normalisation to Instagram's ~-14 LUFS, then mux.
STATS=$(ffmpeg -hide_banner -i build/mix.wav -af loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json -f null - 2>&1 | sed -n '/^{/,/^}/p')
mi() { echo "$STATS" | "$PY" -c "import json,sys; print(json.load(sys.stdin)['$1'])"; }
ffmpeg -hide_banner -loglevel error -y -i build/video.mp4 -i build/mix.wav \
  -af "loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=$(mi input_i):measured_TP=$(mi input_tp):measured_LRA=$(mi input_lra):measured_thresh=$(mi input_thresh):offset=$(mi target_offset):linear=true,aresample=48000" \
  -c:v copy -c:a aac -b:a 256k -ar 48000 -shortest -movflags +faststart out/takintech-new-ui-reel.mp4

echo "done -> out/takintech-new-ui-reel.mp4"
