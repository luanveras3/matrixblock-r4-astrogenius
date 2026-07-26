/*
 * Tests for tools/bin2ota.js.
 *
 * Gate from MANUAL_WIFI_TCP_OTA.md Fase 1: byte equality with the official
 * Arduino tooling. The official lzss.so cannot run on Windows, so the
 * canonical fixture is fixtures/UNOR4WIFI_Animation.ota — produced by
 * Arduino's own encoder and hosted at downloads.arduino.cc (referenced by
 * the official OTA.ino example). Test 3 decodes it and re-encodes the
 * result: a faithful encoder port must reproduce the official payload
 * byte-for-byte (the reference encoder is deterministic).
 *
 * Run: node bin2ota.test.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { lzssEncode, lzssDecode, crc32, bin2ota, MAGIC_UNOR4WIFI } = require('./bin2ota.js');

let failures = 0;

function check(name, cond, detail) {
  if (cond) {
    console.log(`ok   ${name}`);
  } else {
    failures++;
    console.error(`FAIL ${name}${detail ? ' — ' + detail : ''}`);
  }
}

function firstDiff(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}

/* deterministic pseudo-random buffer (no seed-dependent flakiness) */
function prng(len, seed) {
  const b = Buffer.alloc(len);
  let x = seed >>> 0;
  for (let i = 0; i < len; i++) {
    x = (x * 1664525 + 1013904223) >>> 0;
    b[i] = x >>> 24;
  }
  return b;
}

/* ---- 1. round-trip on synthetic buffers (edges + compressible + random) --- */

const cases = [
  ['empty', Buffer.alloc(0)],
  ['one byte', Buffer.from([0x42])],
  ['all zeros 4 KB', Buffer.alloc(4096)],
  ['all 0x20 (matches ring init) 5000 B', Buffer.alloc(5000, 0x20)],
  ['ascii repeat', Buffer.from('MATRIXblock R4 AstroGenius '.repeat(500))],
  ['random 1 KB', prng(1024, 1)],
  ['random 100 KB', prng(100 * 1024, 7)],
  ['random spanning ring wrap (2*N+F+3)', prng(2 * 2048 + 17 + 3, 42)],
];

for (const [name, buf] of cases) {
  const rt = lzssDecode(lzssEncode(buf));
  check(`round-trip: ${name}`, firstDiff(rt, buf) === -1,
    `len ${buf.length} -> ${rt.length}, first diff @${firstDiff(rt, buf)}`);
}

/* ---- 2. header format on a real compiled sketch ------------------------- */

const blinkBin = path.join(__dirname, 'fixtures', 'blink.bin');
if (fs.existsSync(blinkBin)) {
  const bin = fs.readFileSync(blinkBin);
  const ota = bin2ota(bin);
  const len = ota.readUInt32LE(0);
  const crc = ota.readUInt32LE(4);
  const magic = ota.readUInt32LE(8);
  check('header: length field', len === ota.length - 8);
  check('header: crc32 over magic+version+payload', crc === crc32(ota.slice(8)));
  check('header: UNOR4WIFI magic', magic === MAGIC_UNOR4WIFI);
  check('header: compression flag 0x40', ota[19] === 0x40);
  check('payload round-trips to original bin',
    firstDiff(lzssDecode(ota.slice(20)), bin) === -1);
} else {
  console.log('skip header tests (fixtures/blink.bin missing — compile any sketch and copy the .bin)');
}

/* ---- 3. byte equality vs the official Arduino encoder ------------------- */

const officialOta = path.join(__dirname, 'fixtures', 'UNOR4WIFI_Animation.ota');
if (fs.existsSync(officialOta)) {
  const ota = fs.readFileSync(officialOta);
  const len = ota.readUInt32LE(0);
  const crc = ota.readUInt32LE(4);
  check('official fixture: length field', len === ota.length - 8);
  check('official fixture: crc32 matches', crc === crc32(ota.slice(8)));
  check('official fixture: UNOR4WIFI magic', ota.readUInt32LE(8) === MAGIC_UNOR4WIFI);

  const payload = ota.slice(20);
  const decoded = lzssDecode(payload);
  /* Cortex-M vector table sanity: initial SP inside RA4M1 SRAM */
  const sp = decoded.readUInt32LE(0);
  check('official fixture: decoded binary has plausible initial SP',
    sp >= 0x20000000 && sp <= 0x20010000, `SP = 0x${sp.toString(16)}`);

  const reencoded = lzssEncode(decoded);
  check('official fixture: re-encoded payload is byte-identical to official encoder output',
    firstDiff(reencoded, payload) === -1,
    `lens ${reencoded.length}/${payload.length}, first diff @${firstDiff(reencoded, payload)}`);
} else {
  failures++;
  console.error('FAIL official fixture missing: tools/fixtures/UNOR4WIFI_Animation.ota');
}

/* ---- 4. cross-check vs independent Python transliteration --------------- */

try {
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'bin2ota-'));
  const input = fs.existsSync(blinkBin) ? fs.readFileSync(blinkBin) : prng(64 * 1024, 99);
  const inFile = path.join(tmp, 'in.bin');
  const outFile = path.join(tmp, 'out.ota');
  fs.writeFileSync(inFile, input);
  execFileSync('python', [path.join(__dirname, 'lzss_ref.py'), 'ota', inFile, outFile]);
  const py = fs.readFileSync(outFile);
  const js = bin2ota(input);
  check('cross-check: JS output == Python transliteration output',
    firstDiff(js, py) === -1,
    `lens ${js.length}/${py.length}, first diff @${firstDiff(js, py)}`);
  fs.rmSync(tmp, { recursive: true, force: true });
} catch (e) {
  console.log(`skip python cross-check (${e.message.split('\n')[0]})`);
}

/* ------------------------------------------------------------------------ */

console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
