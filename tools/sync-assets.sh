#!/bin/sh
# Copy the cartridges, curated pictures and tunes from the Doom project (read-only source) into this repo, and print md5s.
#   sh tools/sync-assets.sh [SRC]        SRC defaults to ~/Projects/Doom
# Pictures: docs/img32/ (its README.txt lists them) is the curated set; if it is missing the older sets (img25 for I, img27 for II,
# img31 for III) are used and the script says so loudly (PLACEHOLDER).
set -eu
SRC=${1:-$HOME/Projects/Doom}
HERE=$(cd "$(dirname "$0")/.." && pwd)
cd "$HERE"
mkdir -p cart img audio
cp "$SRC/docs/cartridge/imp_doom_1.dck" cart/imp_doom_1.dck
cp "$SRC/docs/cartridge/doom_levels.dck" cart/imp_doom_2.dck
cp "$SRC/docs/cartridge/imp_doom_3.dck" cart/imp_doom_3.dck

pic() { # pic <site name> <source relative to docs/>
  cp "$SRC/docs/$2" "img/$1"
}
# Imp Doom I and II: title and level 1 from docs/img32 when present (else img27 for II and a placeholder-free skip is not possible: fail),
# the win banners from img25 / img27 (the games are frozen / unchanged).
if [ -f "$SRC/docs/img32/imp1_title.png" ]; then
  pic imp1_title.png img32/imp1_title.png
  pic imp1_level1.png img32/imp1_level1.png
  pic imp2_title.png img32/imp2_title.png
  pic imp2_level1.png img32/imp2_level1.png
else
  echo "PLACEHOLDER PICTURES for I / II: img32 has none; using img25 / img27"
  pic imp1_title.png img25/aa_level4_start.png
  pic imp1_level1.png img25/aa_level3_clear.png
  pic imp2_title.png img27/ab2_title.png
  pic imp2_level1.png img27/ab2_level1_start.png
fi
pic imp1_win.png img25/aa_you_win.png
# level-4 start (the same level in I and II: only the label differs), key and door cues (I)
pic imp1_level4.png img25/aa_level4_start.png
pic imp2_level4.png img27/ab2_level4_start.png
pic imp1_key.png img25/aa_key_cue_level2.png
pic imp1_door.png img25/aa_door_cue_level2.png
pic imp2_win.png img27/ab2_win.png
# Imp Doom III: docs/img32 (curated, final build) when its README.txt exists, else the older img31 set (PLACEHOLDER, said loudly).
if [ -f "$SRC/docs/img32/README.txt" ]; then
  echo "Imp Doom III pictures: docs/img32 (curated set); the green-imps picture is from img31 (img32 has none)"
  pic imp3_title.png img32/ac5_title.png
  pic imp3_level1.png img32/ac5_level1_start.png
  pic imp3_clear.png img32/ac5_level_clear.png
  pic imp3_imps.png img31/ac4_imps_level1.png
else
  echo "PLACEHOLDER PICTURES for Imp Doom III: docs/img32 is missing; using img31"
  pic imp3_title.png img31/ac4_title.png
  pic imp3_level1.png img31/ac4_level1_start.png
  pic imp3_clear.png img31/ac4_level_clear.png
  pic imp3_imps.png img31/ac4_imps_level1.png
fi

# Imp Doom III extras: a generated level 4 (cyan metal walls, mid-level) and the level-name sheet
pic imp3_level4.png img32/ac5_wall_cyan.png
pic imp3_labels.png img31/ac4_labels.png

# tunes: WAV -> MP3 (VBR quality 4, mono as the machine is)
for n in 2 3; do
  ffmpeg -v error -y -i "$SRC/docs/audio/imp_doom_${n}_tune.wav" -ac 1 -codec:a libmp3lame -q:a 4 "audio/imp_doom_${n}_tune.mp3"
done

md5sum cart/*.dck img/*.png audio/*.mp3
ls -l audio cart
