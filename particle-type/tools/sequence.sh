#!/bin/bash
# Render a frame range as SVGs, one CLI run per frame.
#
# Two things make this a shell loop rather than one process. The graph ends in a
# string rather than an image, so `cascade run --frames` refuses it — there is
# no raster render node yet, which is what PLAN viewport is about. And driving
# the runtime directly needs the project-module compiler the CLI sets up, which
# is not worth reimplementing for a preview.
#
# The cost it exposes is the honest one: pop.Simulate re-simulates from frame
# zero on every cook, so N frames is N(N+1)/2 steps. That is fine offline and it
# is exactly why interactive playback needs the checkpoint cache.
set -euo pipefail
FROM=${1:-1}; TO=${2:-120}; OUT=${3:-renders/sequence}
mkdir -p "$OUT"
for frame in $(seq "$FROM" "$TO"); do
  python3 - "$frame" <<'PY'
import json, sys
frame = float(sys.argv[1])
d = json.load(open('index.cascade'))
for n in d['nodes']:
    if n['id'] == 'sim':
        n['inputs'] = [{"name": "frame", "defaultValue": frame, "dataType": "float"}]
json.dump(d, open('.frame.cascade', 'w'), indent=2)
PY
  npx cascade run .frame.cascade --frames 1 >/dev/null 2>&1 || true
  newest=$(ls -t .cascade-cache/*.svg | head -1)
  cp "$newest" "$OUT/frame.$(printf '%04d' "$frame").svg"
  [ $((frame % 20)) -eq 0 ] && echo "frame $frame"
done
rm -f .frame.cascade
echo "wrote $((TO - FROM + 1)) frames to $OUT"
