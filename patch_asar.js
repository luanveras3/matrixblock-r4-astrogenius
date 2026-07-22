/*
 * Surgical asar patcher for MATRIXblock Mini R4.
 *
 * Rebuilds app.asar from app.asar.bak by:
 *   1. keeping the entire original data section intact (avoids issues with
 *      native modules that live in app.asar.unpacked/ referenced by offsets);
 *   2. appending patched files at the end;
 *   3. updating the offsets/sizes for those files in the header JSON;
 *   4. rewriting the pickle header (Chromium Pickle format, 4-byte aligned).
 *
 * To patch a file, drop the modified copy under app_src/ mirroring its path
 * inside the archive, then add it to the PATCHES array below.
 */

const fs = require('fs');
const path = require('path');

// Paths can be overridden via env vars (used by CI). Defaults target a
// standard Windows install so `node patch_asar.js` still works locally
// with zero config.
const BACKUP   = process.env.ASAR_BACKUP  || 'C:/matrixblock-r4/resources/app.asar.bak';
const OUT      = process.env.ASAR_OUT     || 'C:/matrixblock-r4/resources/app.asar';
const SRC_DIR  = process.env.ASAR_SRC_DIR || 'C:/matrixblock-r4/resources/app_src';

// Files to patch: [pathInsideAsar, pathRelativeToSRC_DIR]
// Files that don't exist in the original asar (e.g. the WiFi uploader) get a
// fresh header entry created for them — see getOrCreateEntry().
const PATCHES = [
  ['app.compressed.js',                       'app.compressed.js'],
  ['blockly-core/msg/scratch_msgs.js',        'blockly-core/msg/scratch_msgs.js'],
  ['blockly-core/blocks/_mini.js',            'blockly-core/blocks/_mini.js'],
  ['blockly-core/arduino_wifi_wrapper.js',    'blockly-core/arduino_wifi_wrapper.js'],
  ['blockly-core/wifi_upload.js',             'blockly-core/wifi_upload.js'],
  ['views/main.html',                         'views/main.html'],
];

console.log('Reading original asar backup...');
const orig = fs.readFileSync(BACKUP);

const origHSize     = orig.readUInt32LE(12);
const origDataStart = 16 + origHSize;
const origDataSize  = orig.length - origDataStart;

console.log('origHSize   :', origHSize);
console.log('origDataStart:', origDataStart);
console.log('origDataSize :', origDataSize);

const headerJson = orig.slice(16, 16 + origHSize).toString('utf8');
const header = JSON.parse(headerJson);

function getOrCreateEntry(filePath) {
  const parts = filePath.split('/');
  let node = header.files;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    let child = node[p];
    if (!child) {
      // New file (or intermediate dir) not present in the pristine asar —
      // create the header node; offset/size are filled by the caller.
      child = i < parts.length - 1 ? { files: {} } : {};
      node[p] = child;
      console.log('Creating new asar entry:', parts.slice(0, i + 1).join('/'));
    }
    if (i < parts.length - 1) {
      node = child.files;
      if (!node) throw new Error('Expected .files on dir node: ' + p);
    } else {
      node = child;
    }
  }
  return node;
}

// Read all patched files and compute new offsets
const patchedFiles = [];
let offsetAccum = origDataSize;

for (const [asarPath, srcPath] of PATCHES) {
  const entry = getOrCreateEntry(asarPath);
  const buf = fs.readFileSync(path.join(SRC_DIR, srcPath));

  if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF)
    throw new Error('BOM detected in ' + srcPath);

  console.log('Original', asarPath, '-> offset:', entry.offset, 'size:', entry.size);
  console.log('Patched ', asarPath, '-> size:', buf.length);

  entry.offset = String(offsetAccum);
  entry.size   = buf.length;
  offsetAccum += buf.length;

  patchedFiles.push(buf);
}

const newHeaderStr = JSON.stringify(header);
const newHBuf      = Buffer.from(newHeaderStr, 'utf8');
const newHSize     = newHBuf.length;

const nPad         = (4 - (newHSize % 4)) % 4;
const innerPayload = 4 + newHSize + nPad;
const innerTotal   = 4 + innerPayload;

console.log('newHSize    :', newHSize);
console.log('nPad        :', nPad);
console.log('new dataStart:', 16 + newHSize + nPad);

const prefix = Buffer.alloc(16);
prefix.writeUInt32LE(4,            0);
prefix.writeUInt32LE(innerTotal,   4);
prefix.writeUInt32LE(innerPayload, 8);
prefix.writeUInt32LE(newHSize,    12);

const padding  = Buffer.alloc(nPad);
const origData = orig.slice(origDataStart);

const out = Buffer.concat([prefix, newHBuf, padding, origData, ...patchedFiles]);

console.log('Writing', out.length, 'bytes to', OUT, '...');
fs.writeFileSync(OUT, out);
console.log('Done.');

const check = fs.readFileSync(OUT);
console.log('Verify byte 0-3 :', check.readUInt32LE(0),  '(expected 4)');
console.log('Verify byte 4-7 :', check.readUInt32LE(4),  '(expected', innerTotal, ')');
console.log('Verify byte 8-11:', check.readUInt32LE(8),  '(expected', innerPayload, ')');
console.log('Verify byte 12-15:', check.readUInt32LE(12), '(expected', newHSize, ')');
