import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { qrBuildCodewords, qrDarkRuns, qrEncode, qrFormatBits, qrSelectVersion, qrVersionBits } from './qr.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (rel) => readFileSync(join(root, rel), 'utf8');

function gfTables() {
  const exp = new Array(512).fill(0);
  const log = new Array(256).fill(0);
  let x = 1;
  for (let i = 0; i < 255; i++) {
    exp[i] = x;
    log[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) exp[i] = exp[i - 255];
  return { exp, log };
}

function gfEval(poly, x, gf) {
  let y = poly[0];
  for (let i = 1; i < poly.length; i++) {
    y = y === 0 ? poly[i] : gf.exp[gf.log[y] + gf.log[x]] ^ poly[i];
  }
  return y;
}

function maskBit(maskId, r, c) {
  switch (maskId) {
    case 0: return (r + c) % 2 === 0;
    case 1: return r % 2 === 0;
    case 2: return c % 3 === 0;
    case 3: return (r + c) % 3 === 0;
    case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
    case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
    default: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
  }
}

function decodeBytePayload(qr) {
  const n = qr.size;
  const isFunc = Array.from({ length: n }, () => new Array(n).fill(false));
  const markFinder = (top, left) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const r = top + dr;
        const c = left + dc;
        if (r >= 0 && r < n && c >= 0 && c < n) isFunc[r][c] = true;
      }
    }
  };
  markFinder(0, 0);
  markFinder(0, n - 7);
  markFinder(n - 7, 0);
  for (let i = 8; i < n - 8; i++) {
    isFunc[6][i] = true;
    isFunc[i][6] = true;
  }
  const spec = qrSelectVersion(qr.version === 9 && qr.ecLevel === 'L' ? 200 : 1);
  const align = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
    7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46],
  }[qr.version];
  for (const r of align) {
    for (const c of align) {
      if ((r <= 8 && c <= 8) || (r <= 8 && c >= n - 8) || (r >= n - 8 && c <= 8)) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) isFunc[r + dr][c + dc] = true;
      }
    }
  }
  for (let i = 0; i <= 8; i++) {
    isFunc[8][i] = true;
    isFunc[i][8] = true;
  }
  for (let i = n - 8; i < n; i++) isFunc[8][i] = true;
  for (let i = n - 7; i < n; i++) isFunc[i][8] = true;
  isFunc[4 * qr.version + 9][8] = true;
  if (qr.version >= 7) {
    for (let i = 0; i < 18; i++) {
      const a = Math.floor(i / 3);
      const b = n - 11 + (i % 3);
      isFunc[a][b] = true;
      isFunc[b][a] = true;
    }
  }
  void spec;

  // Read and verify both format info copies
  const topLeftCoords = [
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
    [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
  ];
  let fmt1 = 0;
  let fmt2 = 0;
  for (let idx = 0; idx < 15; idx++) {
    const [r1, c1] = topLeftCoords[idx];
    fmt1 = (fmt1 << 1) | qr.modules[r1][c1];
    const bit2 = idx < 7 ? qr.modules[n - 1 - idx][8] : qr.modules[8][n - 15 + idx];
    fmt2 = (fmt2 << 1) | bit2;
  }
  const unmaskedFmt = fmt1 ^ 0x5412;
  assert.equal(fmt1, fmt2, 'both format info copies match');
  assert.equal((unmaskedFmt >> 10) & 7, qr.mask);

  const bits = [];
  let upward = true;
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < n; step++) {
      const r = upward ? n - 1 - step : step;
      for (let dx = 0; dx < 2; dx++) {
        const c = right - dx;
        if (isFunc[r][c]) continue;
        let bit = qr.modules[r][c];
        if (maskBit(qr.mask, r, c)) bit ^= 1;
        bits.push(bit);
      }
    }
    upward = !upward;
  }

  const codewords = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let val = 0;
    for (let j = 0; j < 8; j++) val = (val << 1) | bits[i + j];
    codewords.push(val);
  }
  return { codewords, formatBits: fmt1 };
}

test('QR format and version BCH codes match ISO 18004 constants', () => {
  // EC Level M (00), mask 0..7 format bits
  assert.equal(qrFormatBits(0, 0).toString(2).padStart(15, '0'), '101010000010010');
  assert.equal(qrFormatBits(1, 0).toString(2).padStart(15, '0'), '111011111000100');
  assert.equal(qrVersionBits(7).toString(16), '7c94');
});

test('QR encoder generates valid RS codewords and decodes roundtrip URLs', () => {
  const gf = gfTables();
  const samples = [
    'https://tvm-accounts.tvm-accounts.workers.dev/link?code=ABCD-EFGH',
    'https://tvm-accounts.tvm-accounts.workers.dev/link?code=WXYZ-2345',
    'https://example.test/link?code=QK7M-9P2R',
    'hello',
    'A'.repeat(190),
  ];

  for (const input of samples) {
    const qr = qrEncode(input);
    const bytes = Array.from(Buffer.from(input, 'utf8'));
    const spec = qrSelectVersion(bytes.length);
    const expectedCodewords = qrBuildCodewords(bytes, spec, gf);
    const decoded = decodeBytePayload(qr);
    assert.deepEqual(decoded.codewords, expectedCodewords);

    // Check dark module & finder centers
    assert.equal(qr.modules[4 * qr.version + 9][8], 1);
    assert.equal(qr.modules[3][3], 1);
    assert.equal(qr.modules[3][qr.size - 4], 1);
    assert.equal(qr.modules[qr.size - 4][3], 1);

    // Check RS syndromes are all 0 for every block
    const blockCount = spec.g1Blocks + spec.g2Blocks;
    const dataBlocks = Array.from({ length: blockCount }, () => []);
    const ecBlocks = Array.from({ length: blockCount }, () => []);
    let ptr = 0;
    const maxD = Math.max(spec.g1Data, spec.g2Data);
    for (let i = 0; i < maxD; i++) {
      for (let b = 0; b < blockCount; b++) {
        const len = b < spec.g1Blocks ? spec.g1Data : spec.g2Data;
        if (i < len) dataBlocks[b].push(decoded.codewords[ptr++]);
      }
    }
    for (let i = 0; i < spec.ecPerBlock; i++) {
      for (let b = 0; b < blockCount; b++) ecBlocks[b].push(decoded.codewords[ptr++]);
    }
    for (let b = 0; b < blockCount; b++) {
      const fullBlock = dataBlocks[b].concat(ecBlocks[b]);
      for (let root = 0; root < spec.ecPerBlock; root++) {
        assert.equal(gfEval(fullBlock, gf.exp[root], gf), 0, `syndrome ${root} nonzero for block ${b}`);
      }
    }

    // Reconstruct payload bytes from de-interleaved data blocks
    const rawData = dataBlocks.flat();
    assert.equal(rawData[0] >> 4, 4, 'Byte mode indicator');
    const charLen = ((rawData[0] & 0x0f) << 4) | (rawData[1] >> 4);
    assert.equal(charLen, bytes.length);
    const recovered = [];
    for (let i = 0; i < charLen; i++) {
      recovered.push(((rawData[1 + i] & 0x0f) << 4) | (rawData[2 + i] >> 4));
    }
    assert.equal(Buffer.from(recovered).toString('utf8'), input);

    // Verify dark runs reconstruct exact module matrix
    const runs = qrDarkRuns(qr.modules);
    const rebuilt = Array.from({ length: qr.size }, () => new Array(qr.size).fill(0));
    for (const run of runs) {
      for (let dx = 0; dx < run.w; dx++) rebuilt[run.y][run.x + dx] = 1;
    }
    assert.deepEqual(rebuilt, qr.modules);
  }
});

test('BrightScript qr.brs matches JS reference matrix and runs bit-for-bit', { timeout: 120000 }, () => {
  const dir = mkdtempSync(join(root, 'scripts', '.qr-test-'));
  try {
    const urls = [
      'https://tvm-accounts.tvm-accounts.workers.dev/link?code=ABCD-EFGH',
      'https://tvm-accounts.tvm-accounts.workers.dev/link?code=H7K2-M9P4',
      'http://127.0.0.1:8787/link?code=ABCD-2345',
      'https://example.test/' + 'x'.repeat(170),
    ];
    const brsLines = [
      read('source/qr.brs'),
      'sub Main()',
      ...urls.map((url, idx) => {
        const expected = qrEncode(url);
        const rows = expected.modules.map((row) => row.join('')).join('|');
        const runs = qrDarkRuns(expected.modules);
        return `
          res${idx} = qrEncode("${url}")
          if res${idx} = invalid then print "FAIL: invalid ${idx}" : return
          if res${idx}.size <> ${expected.size} or res${idx}.version <> ${expected.version} or res${idx}.mask <> ${expected.mask} then print "FAIL: meta ${idx}" : return
          flat${idx} = []
          for each r in res${idx}.modules
            s = ""
            for each bit in r
              s = s + StrI(bit).Trim()
            end for
            flat${idx}.Push(s)
          end for
          if flat${idx}.Join("|") <> "${rows}" then print "FAIL: matrix ${idx}" : return
          runs${idx} = qrDarkRuns(res${idx}.modules)
          if runs${idx}.Count() <> ${runs.length} then print "FAIL: runs ${idx}" : return
        `;
      }),
      '  print "QR_RUNTIME_OK"',
      'end sub',
    ].join('\n');

    writeFileSync(join(dir, 'main.brs'), brsLines, 'utf8');
    const command = 'npx --yes brs@0.45.0 main.brs';
    const result = process.platform === 'win32'
      ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], { encoding: 'utf8', timeout: 110000, cwd: dir })
      : spawnSync('npx', ['--yes', 'brs@0.45.0', 'main.brs'], { encoding: 'utf8', timeout: 110000, cwd: dir });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /QR_RUNTIME_OK/, `stdout=${JSON.stringify(result.stdout)} stderr=${JSON.stringify(result.stderr)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
