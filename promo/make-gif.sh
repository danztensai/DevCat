#!/bin/bash
# out/demo.mp4 → ../assets/readme/demo.gif (palette per video, 12 fps, 960 px wide).
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p ../assets/readme
W="${GIF_WIDTH:-960}"; FPS="${GIF_FPS:-12}"
ffmpeg -loglevel error -y -i out/demo.mp4 -vf "fps=$FPS,scale=$W:-1:flags=lanczos,palettegen=max_colors=192:stats_mode=diff" /tmp/devcat-palette.png
ffmpeg -loglevel error -y -i out/demo.mp4 -i /tmp/devcat-palette.png \
  -lavfi "fps=$FPS,scale=$W:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=sierra2_4a:diff_mode=rectangle" ../assets/readme/demo.gif
ls -lh ../assets/readme/demo.gif
