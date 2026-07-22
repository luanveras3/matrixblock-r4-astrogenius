/*
 * bin2ota.js — convert a compiled sketch .bin into the Arduino .ota format
 * used by the OTAUpdate library of the arduino:renesas_uno core.
 *
 * Faithful Node port (CommonJS, zero dependencies) of the official Arduino
 * reference tools from arduino-libraries/ArduinoIoTCloud extras/tools:
 *   - lzss.c  (Haruhiko Okumura's LZSS, EI=11 EJ=4 P=1 — public domain)
 *   - bin2ota.py (OTA header: len + crc32 over [magic|version|payload])
 *
 * .ota layout (all little-endian):
 *   [0..3]   payload length = len(magic + version + lzss payload)
 *   [4..7]   CRC32 (zlib polynomial) over magic + version + lzss payload
 *   [8..11]  magic number — UNO R4 WiFi: VID/PID 0x2341/0x1002 -> 0x23411002
 *   [12..19] version field, byte 7 = 0x40 (payload-is-LZSS flag)
 *   [20..]   LZSS-compressed sketch .bin
 *
 * CLI: node bin2ota.js <sketch.bin> <sketch.ota>
 * API: { lzssEncode, lzssDecode, crc32, bin2ota, MAGIC_UNOR4WIFI }
 */

'use strict';

const fs = require('fs');

const MAGIC_UNOR4WIFI = 0x23411002;

/* ------------------------------- LZSS ---------------------------------- */

const EI = 11;              /* offset bits */
const EJ = 4;               /* length bits */
const P  = 1;               /* emit literal when match length <= P */
const N  = 1 << EI;         /* ring buffer size (2048) */
const F  = (1 << EJ) + 1;   /* lookahead size (17) */

function lzssEncode(input) {
  const out = [];
  let bitBuffer = 0;
  let bitMask = 128;

  const putbit1 = () => {
    bitBuffer |= bitMask;
    if ((bitMask >>= 1) === 0) {
      out.push(bitBuffer);
      bitBuffer = 0;
      bitMask = 128;
    }
  };
  const putbit0 = () => {
    if ((bitMask >>= 1) === 0) {
      out.push(bitBuffer);
      bitBuffer = 0;
      bitMask = 128;
    }
  };
  const output1 = (c) => {
    putbit1();
    let mask = 256;
    while ((mask >>= 1)) {
      if (c & mask) putbit1();
      else putbit0();
    }
  };
  const output2 = (x, y) => {
    putbit0();
    let mask = N;
    while ((mask >>= 1)) {
      if (x & mask) putbit1();
      else putbit0();
    }
    mask = 1 << EJ;
    while ((mask >>= 1)) {
      if (y & mask) putbit1();
      else putbit0();
    }
  };

  const buffer = new Uint8Array(N * 2);
  let pos = 0; /* next byte of input to read */

  let i;
  for (i = 0; i < N - F; i++) buffer[i] = 0x20; /* ' ' */
  for (i = N - F; i < N * 2 && pos < input.length; i++) {
    buffer[i] = input[pos++];
  }

  let bufferend = i;
  let r = N - F;
  let s = 0;

  while (r < bufferend) {
    const f1 = F <= bufferend - r ? F : bufferend - r;
    let x = 0;
    let y = 1;
    const c = buffer[r];
    for (i = r - 1; i >= s; i--) {
      if (buffer[i] === c) {
        let j;
        for (j = 1; j < f1; j++) {
          if (buffer[i + j] !== buffer[r + j]) break;
        }
        if (j > y) {
          x = i;
          y = j;
        }
      }
    }
    if (y <= P) {
      output1(c);
    } else {
      output2(x & (N - 1), y - 2);
    }
    r += y;
    s += y;
    if (r >= N * 2 - F) {
      buffer.copyWithin(0, N, N * 2);
      bufferend -= N;
      r -= N;
      s -= N;
      while (bufferend < N * 2 && pos < input.length) {
        buffer[bufferend++] = input[pos++];
      }
    }
  }

  /* flush_bit_buffer */
  if (bitMask !== 128) out.push(bitBuffer);

  return Buffer.from(out);
}

function lzssDecode(input) {
  const out = [];
  let inPos = 0;
  let buf = 0;
  let mask = 0;

  /* returns -1 on EOF, mirroring the C getbit() */
  const getbit = (n) => {
    let x = 0;
    for (let i = 0; i < n; i++) {
      if (mask === 0) {
        if (inPos >= input.length) return -1;
        buf = input[inPos++];
        mask = 128;
      }
      x <<= 1;
      if (buf & mask) x++;
      mask >>= 1;
    }
    return x;
  };

  const buffer = new Uint8Array(N);
  for (let i = 0; i < N - F; i++) buffer[i] = 0x20;
  let r = N - F;

  let c;
  while ((c = getbit(1)) !== -1) {
    if (c) {
      if ((c = getbit(8)) === -1) break;
      out.push(c);
      buffer[r++] = c;
      r &= N - 1;
    } else {
      const i = getbit(EI);
      if (i === -1) break;
      const j = getbit(EJ);
      if (j === -1) break;
      for (let k = 0; k <= j + 1; k++) {
        c = buffer[(i + k) & (N - 1)];
        out.push(c);
        buffer[r++] = c;
        r &= N - 1;
      }
    }
  }

  return Buffer.from(out);
}

/* ------------------------------- CRC32 ---------------------------------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/* ------------------------------- header --------------------------------- */

function bin2ota(binBuf, magic = MAGIC_UNOR4WIFI) {
  const payload = lzssEncode(binBuf);

  const magicBuf = Buffer.alloc(4);
  magicBuf.writeUInt32LE(magic >>> 0, 0);

  /* version field: all zero except the compression flag (byte 7 = 0x40) */
  const version = Buffer.from([0, 0, 0, 0, 0, 0, 0, 0x40]);

  const complete = Buffer.concat([magicBuf, version, payload]);

  const header = Buffer.alloc(8);
  header.writeUInt32LE(complete.length, 0);
  header.writeUInt32LE(crc32(complete), 4);

  return Buffer.concat([header, complete]);
}

module.exports = { lzssEncode, lzssDecode, crc32, bin2ota, MAGIC_UNOR4WIFI };

/* --------------------------------- CLI ----------------------------------- */

if (require.main === module) {
  const [inFile, outFile] = process.argv.slice(2);
  if (!inFile || !outFile) {
    console.error('Usage: node bin2ota.js <sketch.bin> <sketch.ota>');
    process.exit(1);
  }
  const bin = fs.readFileSync(inFile);
  const ota = bin2ota(bin);
  fs.writeFileSync(outFile, ota);
  console.log(
    `${inFile} (${bin.length} B) -> ${outFile} (${ota.length} B, ` +
      `${((ota.length / bin.length) * 100).toFixed(1)}% of original)`
  );
}
