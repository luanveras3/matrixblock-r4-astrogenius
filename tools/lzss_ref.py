#!/usr/bin/env python3
"""Reference cross-check for tools/bin2ota.js.

Independent Python transliteration of the official Arduino tools
(arduino-libraries/ArduinoIoTCloud extras/tools: lzss.c + bin2ota.py).
The official lzss.py needs a compiled lzss.so and cannot run on Windows,
so this port exists purely to cross-validate the Node implementation:
two independent transliterations of the same C source agreeing byte-for-byte.

Usage:
    python lzss_ref.py encode <in.bin>  <out.lzss>
    python lzss_ref.py decode <in.lzss> <out.bin>
    python lzss_ref.py ota    <in.bin>  <out.ota>     (UNOR4WIFI magic)
"""

import sys
import zlib

EI = 11
EJ = 4
P = 1
N = 1 << EI
F = (1 << EJ) + 1

MAGIC_UNOR4WIFI = 0x23411002


def lzss_encode(data: bytes) -> bytes:
    out = bytearray()
    state = {"bit_buffer": 0, "bit_mask": 128}

    def putbit1():
        state["bit_buffer"] |= state["bit_mask"]
        state["bit_mask"] >>= 1
        if state["bit_mask"] == 0:
            out.append(state["bit_buffer"])
            state["bit_buffer"] = 0
            state["bit_mask"] = 128

    def putbit0():
        state["bit_mask"] >>= 1
        if state["bit_mask"] == 0:
            out.append(state["bit_buffer"])
            state["bit_buffer"] = 0
            state["bit_mask"] = 128

    def output1(c):
        putbit1()
        mask = 256
        while True:
            mask >>= 1
            if not mask:
                break
            putbit1() if c & mask else putbit0()

    def output2(x, y):
        putbit0()
        mask = N
        while True:
            mask >>= 1
            if not mask:
                break
            putbit1() if x & mask else putbit0()
        mask = 1 << EJ
        while True:
            mask >>= 1
            if not mask:
                break
            putbit1() if y & mask else putbit0()

    buffer = bytearray(N * 2)
    pos = 0

    for i in range(N - F):
        buffer[i] = 0x20
    i = N - F
    while i < N * 2 and pos < len(data):
        buffer[i] = data[pos]
        pos += 1
        i += 1

    bufferend = i
    r = N - F
    s = 0

    while r < bufferend:
        f1 = F if F <= bufferend - r else bufferend - r
        x = 0
        y = 1
        c = buffer[r]
        for i in range(r - 1, s - 1, -1):
            if buffer[i] == c:
                j = 1
                while j < f1:
                    if buffer[i + j] != buffer[r + j]:
                        break
                    j += 1
                if j > y:
                    x = i
                    y = j
        if y <= P:
            output1(c)
        else:
            output2(x & (N - 1), y - 2)
        r += y
        s += y
        if r >= N * 2 - F:
            buffer[0:N] = buffer[N : N * 2]
            bufferend -= N
            r -= N
            s -= N
            while bufferend < N * 2 and pos < len(data):
                buffer[bufferend] = data[pos]
                bufferend += 1
                pos += 1

    if state["bit_mask"] != 128:
        out.append(state["bit_buffer"])

    return bytes(out)


def lzss_decode(data: bytes) -> bytes:
    out = bytearray()
    state = {"pos": 0, "buf": 0, "mask": 0}

    def getbit(n):
        x = 0
        for _ in range(n):
            if state["mask"] == 0:
                if state["pos"] >= len(data):
                    return -1
                state["buf"] = data[state["pos"]]
                state["pos"] += 1
                state["mask"] = 128
            x <<= 1
            if state["buf"] & state["mask"]:
                x += 1
            state["mask"] >>= 1
        return x

    buffer = bytearray(N)
    for i in range(N - F):
        buffer[i] = 0x20
    r = N - F

    while True:
        c = getbit(1)
        if c == -1:
            break
        if c:
            c = getbit(8)
            if c == -1:
                break
            out.append(c)
            buffer[r] = c
            r = (r + 1) & (N - 1)
        else:
            i = getbit(EI)
            if i == -1:
                break
            j = getbit(EJ)
            if j == -1:
                break
            for k in range(j + 2):
                c = buffer[(i + k) & (N - 1)]
                out.append(c)
                buffer[r] = c
                r = (r + 1) & (N - 1)

    return bytes(out)


def bin2ota(data: bytes, magic: int = MAGIC_UNOR4WIFI) -> bytes:
    payload = lzss_encode(data)
    version = bytes([0, 0, 0, 0, 0, 0, 0, 0x40])
    complete = magic.to_bytes(4, "little") + version + payload
    return (
        len(complete).to_bytes(4, "little")
        + zlib.crc32(complete).to_bytes(4, "little")
        + complete
    )


def main():
    if len(sys.argv) != 4 or sys.argv[1] not in ("encode", "decode", "ota"):
        print(__doc__)
        sys.exit(1)
    mode, infile, outfile = sys.argv[1:4]
    with open(infile, "rb") as f:
        data = f.read()
    fn = {"encode": lzss_encode, "decode": lzss_decode, "ota": bin2ota}[mode]
    with open(outfile, "wb") as f:
        f.write(fn(data))


if __name__ == "__main__":
    main()
