const fs = require('fs');
const path = require('path');

const BACKUP   = 'C:/matrixblock-r4/resources/app.asar.bak';
const OUT      = 'C:/matrixblock-r4/resources/app.asar';
const SRC_DIR  = 'C:/matrixblock-r4/resources/app_src';

// Files to patch: [asarPath, srcRelPath]
const PATCHES = [
  ['app.compressed.js',                'app.compressed.js'],
  ['blockly-core/msg/scratch_msgs.js', 'blockly-core/msg/scratch_msgs.js'],
  ['blockly-core/blocks/_mini.js',     'blockly-core/blocks/_mini.js'],
  ['views/main.html',                  'views/main.html'],
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

function getEntry(filePath) {
  const parts = filePath.split('/');
  let node = header.files;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const child = node[p];
    if (!child) throw new Error('Cannot find ' + filePath + ' in header at: ' + p);
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
  const entry = getEntry(asarPath);
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
