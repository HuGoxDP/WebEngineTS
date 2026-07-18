# Generates ktx2-test.png — a 512x512 sRGB checker+gradient used to build the
# KTX2 fallback-test texture (see README). Pure stdlib, no image libraries.
#
# Regenerate the KTX2 with the KTX-Software `toktx` tool:
#   python gen-test-texture.py
#   toktx --encode etc1s --genmipmap --assign_oetf srgb ktx2-test.ktx2 ktx2-test.png
import zlib
import struct

W = H = 512


def png_chunk(typ: bytes, data: bytes) -> bytes:
    body = typ + data
    return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)


def main() -> None:
    raw = bytearray()
    for y in range(H):
        raw.append(0)  # PNG filter type 0 (None) per scanline
        for x in range(W):
            checker = ((x // 64) & 1) ^ ((y // 64) & 1)
            r = (x * 255) // (W - 1)
            g = (y * 255) // (H - 1)
            b = 210 if checker else 55
            raw += bytes((r, g, b))

    idat = zlib.compress(bytes(raw), 9)
    ihdr = struct.pack(">IIBBBBB", W, H, 8, 2, 0, 0, 0)  # 8-bit, colour type 2 (RGB)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + png_chunk(b"IHDR", ihdr)
        + png_chunk(b"IDAT", idat)
        + png_chunk(b"IEND", b"")
    )
    with open("ktx2-test.png", "wb") as f:
        f.write(png)
    print(f"wrote ktx2-test.png ({W}x{H}, {len(png)} bytes)")


if __name__ == "__main__":
    main()
