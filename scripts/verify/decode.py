"""Decode a PNG to raw RGBA for the Node verification harness.

Node has no built-in PNG decoder and the project has no dependencies, so the
harness shells out to this script. Pillow is available on the development
machine; nothing in the shipped application depends on it.

Usage:  python decode.py <input.png> <output.bin>

Output format: little-endian uint32 width, uint32 height, then width*height*4
bytes of RGBA.
"""

import struct
import sys

from PIL import Image


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__, file=sys.stderr)
        return 2

    src, dst = sys.argv[1], sys.argv[2]
    with Image.open(src) as im:
        rgba = im.convert("RGBA")
        width, height = rgba.size
        payload = rgba.tobytes()

    with open(dst, "wb") as out:
        out.write(struct.pack("<II", width, height))
        out.write(payload)
    return 0


if __name__ == "__main__":
    sys.exit(main())
