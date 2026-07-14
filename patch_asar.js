const fs = require('fs');
const path = require('path');

const BACKUP   = 'C:/matrixblock-r4/resources/app.asar.bak';
const OUT      = 'C:/matrixblock-r4/resources/app.asar';
const SRC_DIR  = 'C:/matrixblock-r4/resources/app_src';
const PATCH1   = 'app.compressed.js';
const PATCH2   = 'blockly-core/msg/scratch_msgs.js';

console.log('Reading original asar backup...');
const orig = fs.readFileSync(BACKUP);

// Parse original pickle header
const origHSize    = orig.readUInt32LE(12);  // 598616
const origDataStart = 16 + origHSize;        // 598632
const origDataSize  = orig.length - origDataStart;

console.log('origHSize   :', origHSize);
console.log('origDataStart:', origDataStart);
console.log('origDataSize :', origDataSize);

// Parse header JSON
const headerJson = orig.slice(16, 16 + origHSize).toString('utf8');
const header = JSON.parse(headerJson);

// Helper to get a file entry from nested header object (dirs have .files children)
function getEntry(filePath) {
  const parts = filePath.split('/');
  let node = header.files;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const child = node[p];
    if (!child) throw new Error('Cannot find ' + filePath + ' in header at part: ' + p);
    if (i < parts.length - 1) {
      // Directory — descend into .files
      node = child.files;
      if (!node) throw new Error('Expected .files on directory node at: ' + p);
    } else {
      node = child;
    }
  }
  return node;
}

// Get original entries for the two files we're patching
const e1 = getEntry(PATCH1);
const e2 = getEntry(PATCH2);

console.log('Original', PATCH1, '-> offset:', e1.offset, 'size:', e1.size);
console.log('Original', PATCH2, '-> offset:', e2.offset, 'size:', e2.size);

// Read patched files (no BOM - app_src files were written with Node.js Buffer)
const patched1 = fs.readFileSync(path.join(SRC_DIR, PATCH1));
const patched2 = fs.readFileSync(path.join(SRC_DIR, PATCH2));

console.log('Patched', PATCH1, 'size:', patched1.length);
console.log('Patched', PATCH2, 'size:', patched2.length);

// Verify no BOM
if (patched1[0] === 0xEF && patched1[1] === 0xBB && patched1[2] === 0xBF)
  throw new Error('BOM detected in ' + PATCH1);
if (patched2[0] === 0xEF && patched2[1] === 0xBB && patched2[2] === 0xBF)
  throw new Error('BOM detected in ' + PATCH2);

// The new offsets: patched files go AFTER the original data section
// offsets are relative to dataStart
const newOffset1 = origDataSize;                          // right after orig data
const newOffset2 = origDataSize + patched1.length;        // after patched1

// Update header entries
e1.offset = String(newOffset1);
e1.size   = patched1.length;
e2.offset = String(newOffset2);
e2.size   = patched2.length;

// Serialize updated header JSON
const newHeaderStr = JSON.stringify(header);
const newHBuf      = Buffer.from(newHeaderStr, 'utf8');
const newHSize     = newHBuf.length;

// 4-byte alignment padding for Chromium pickle
const nPad         = (4 - (newHSize % 4)) % 4;
const innerPayload = 4 + newHSize + nPad;  // = string_length_field + string_data + padding
const innerTotal   = 4 + innerPayload;     // = inner_payload_field + payload_data

console.log('newHSize    :', newHSize);
console.log('nPad        :', nPad);
console.log('innerPayload:', innerPayload);
console.log('innerTotal  :', innerTotal);
console.log('new dataStart:', 16 + newHSize + nPad);

// Build pickle prefix (16 bytes)
const prefix = Buffer.alloc(16);
prefix.writeUInt32LE(4,            0);  // outer pickle always = 4
prefix.writeUInt32LE(innerTotal,   4);
prefix.writeUInt32LE(innerPayload, 8);
prefix.writeUInt32LE(newHSize,    12);  // string length

const padding = Buffer.alloc(nPad);  // zero bytes for alignment

// Original data section (unchanged)
const origData = orig.slice(origDataStart);

// Assemble: prefix + json + padding + original data + patched1 + patched2
const out = Buffer.concat([
  prefix,
  newHBuf,
  padding,
  origData,
  patched1,
  patched2,
]);

console.log('Writing', out.length, 'bytes to', OUT, '...');
fs.writeFileSync(OUT, out);
console.log('Done. New asar written successfully.');

// Sanity check: re-read and verify pickle header
const check = fs.readFileSync(OUT);
const ck0 = check.readUInt32LE(0);
const ck4 = check.readUInt32LE(4);
const ck8 = check.readUInt32LE(8);
const ck12 = check.readUInt32LE(12);
console.log('Verify byte 0-3 :', ck0,  '(expected 4)');
console.log('Verify byte 4-7 :', ck4,  '(expected', innerTotal, ')');
console.log('Verify byte 8-11:', ck8,  '(expected', innerPayload, ')');
console.log('Verify byte 12-15:', ck12, '(expected', newHSize, ')');
