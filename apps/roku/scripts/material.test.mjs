import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const root = new URL('../images/glass/', import.meta.url);
function png(name) {
  const bytes = readFileSync(new URL(name, root));
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  const compressed = [];
  for (let offset = 8; offset < bytes.length;) {
    const size = bytes.readUInt32BE(offset);
    if (bytes.toString('ascii', offset + 4, offset + 8) === 'IDAT') compressed.push(bytes.subarray(offset + 8, offset + 8 + size));
    offset += size + 12;
  }
  const data = inflateSync(Buffer.concat(compressed));
  const pixel = (x, y) => [...data.subarray(y * (width * 4 + 1) + 1 + x * 4, y * (width * 4 + 1) + 5 + x * 4)];
  return { width, height, pixel };
}
const black = pixel => pixel.join(',') === '0,0,0,255';
function guide(pixels) {
  const marked = pixels.map(black);
  assert.ok(marked.includes(true), 'guide has a stretch span');
  const first = marked.indexOf(true);
  const last = marked.lastIndexOf(true);
  assert.ok(marked.slice(first, last + 1).every(Boolean), 'stretch span is contiguous');
  for (const p of pixels) assert.ok(p[3] === 0 || black(p), 'border contains only transparent or opaque black pixels');
}
for (const name of readdirSync(root).filter(name => name.endsWith('.9.png'))) {
  test(`${name} has valid contiguous Roku stretch and content guides`, () => {
    const { width, height, pixel } = png(name);
    const xs = Array.from({ length: width }, (_, i) => i);
    const ys = Array.from({ length: height }, (_, i) => i);
    guide(xs.map(x => pixel(x, 0)));
    guide(xs.map(x => pixel(x, height - 1)));
    guide(ys.map(y => pixel(0, y)));
    guide(ys.map(y => pixel(width - 1, y)));
    for (const [x, y] of [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]]) assert.equal(pixel(x, y)[3], 0);
  });
}
test('glass rim is brighter toward the top-left light source', () => {
  const { width, height, pixel } = png('panel.9.png');
  assert.ok(pixel(width / 2, 2)[3] > pixel(width / 2, height - 3)[3] * 1.5);
  assert.equal(pixel(width / 2, height / 2)[3], 0);
});
test('rounded fill has supersampled edge coverage and an opaque tintable centre', () => {
  const { width, height, pixel } = png('pill-fill.9.png');
  assert.deepEqual(pixel(width / 2, height / 2), [255, 255, 255, 255]);
  assert.equal(pixel(1, 1)[3], 0);
  const edge = Array.from({ length: 72 }, (_, x) => pixel(x + 1, 3)[3]);
  assert.ok(edge.some(alpha => alpha > 0 && alpha < 255));
});
test('progress track caps fit a four-pixel FHD line', () => {
  assert.equal(png('progress.9.png').height - 2, 8);
});
