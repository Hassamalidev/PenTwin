"""Converts images to grayscale PGM, for scripts/real-measure.ts.

    python -I scripts/to-pgm.py <folder of images> <new folder for .pgm files> [name prefix]
"""
import sys
from pathlib import Path

from PIL import Image

source, target = Path(sys.argv[1]), Path(sys.argv[2])
prefix = sys.argv[3] if len(sys.argv) > 3 else ""
target.mkdir(parents=True, exist_ok=True)
for path in sorted(source.iterdir()):
    if path.suffix.lower() in {".png", ".jpg", ".jpeg", ".tif", ".tiff"} and path.name.startswith(prefix):
        Image.open(path).convert("L").save(target / (path.stem + ".pgm"))
