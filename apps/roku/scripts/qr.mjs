// ISO/IEC 18004 QR Code encoder reference (Versions 1-9, Byte mode, EC Level M with L fallback).
// Mirrors apps/roku/source/qr.brs so tests can cross-check JS and BrightScript bit-for-bit.

const QR_VERSIONS = [
  { version: 1, size: 21, ecLevel: 'M', ecBits: 0, total: 26, data: 16, ecPerBlock: 10, g1Blocks: 1, g1Data: 16, g2Blocks: 0, g2Data: 0, align: [] },
  { version: 2, size: 25, ecLevel: 'M', ecBits: 0, total: 44, data: 28, ecPerBlock: 16, g1Blocks: 1, g1Data: 28, g2Blocks: 0, g2Data: 0, align: [6, 18] },
  { version: 3, size: 29, ecLevel: 'M', ecBits: 0, total: 70, data: 44, ecPerBlock: 26, g1Blocks: 1, g1Data: 44, g2Blocks: 0, g2Data: 0, align: [6, 22] },
  { version: 4, size: 33, ecLevel: 'M', ecBits: 0, total: 100, data: 64, ecPerBlock: 18, g1Blocks: 2, g1Data: 32, g2Blocks: 0, g2Data: 0, align: [6, 26] },
  { version: 5, size: 37, ecLevel: 'M', ecBits: 0, total: 134, data: 86, ecPerBlock: 24, g1Blocks: 2, g1Data: 43, g2Blocks: 0, g2Data: 0, align: [6, 30] },
  { version: 6, size: 41, ecLevel: 'M', ecBits: 0, total: 172, data: 108, ecPerBlock: 16, g1Blocks: 4, g1Data: 27, g2Blocks: 0, g2Data: 0, align: [6, 34] },
  { version: 7, size: 45, ecLevel: 'M', ecBits: 0, total: 196, data: 124, ecPerBlock: 18, g1Blocks: 4, g1Data: 31, g2Blocks: 0, g2Data: 0, align: [6, 22, 38] },
  { version: 8, size: 49, ecLevel: 'M', ecBits: 0, total: 242, data: 154, ecPerBlock: 22, g1Blocks: 2, g1Data: 38, g2Blocks: 2, g2Data: 39, align: [6, 24, 42] },
  { version: 9, size: 53, ecLevel: 'M', ecBits: 0, total: 292, data: 182, ecPerBlock: 22, g1Blocks: 3, g1Data: 36, g2Blocks: 2, g2Data: 37, align: [6, 26, 46] },
  { version: 9, size: 53, ecLevel: 'L', ecBits: 1, total: 292, data: 232, ecPerBlock: 30, g1Blocks: 2, g1Data: 116, g2Blocks: 0, g2Data: 0, align: [6, 26, 46] },
];

const GF_EXP = new Array(512).fill(0);
const GF_LOG = new Array(256).fill(0);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
}

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGenerator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    const root = GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], root);
    }
    poly = next;
  }
  return poly;
}

function rsRemainder(data, ecCount) {
  const gen = rsGenerator(ecCount);
  const work = data.concat(new Array(ecCount).fill(0));
  for (let i = 0; i < data.length; i++) {
    const factor = work[i];
    if (factor === 0) continue;
    for (let j = 0; j < gen.length; j++) {
      work[i + j] ^= gfMul(gen[j], factor);
    }
  }
  return work.slice(data.length);
}

export function qrSelectVersion(byteCount) {
  for (const spec of QR_VERSIONS) {
    if (byteCount <= spec.data - 2) return spec;
  }
  throw new RangeError(`QR payload too long (${byteCount} bytes; max 230)`);
}

function pushBits(bits, value, width) {
  for (let i = width - 1; i >= 0; i--) {
    bits.push((value >> i) & 1);
  }
}

export function qrBuildCodewords(bytes, spec) {
  const bits = [];
  pushBits(bits, 4, 4); // Byte mode
  pushBits(bits, bytes.length, 8);
  for (const b of bytes) pushBits(bits, b & 0xff, 8);

  const dataBits = spec.data * 8;
  const term = Math.min(4, dataBits - bits.length);
  for (let i = 0; i < term; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    let val = 0;
    for (let j = 0; j < 8; j++) val = (val << 1) | bits[i + j];
    codewords.push(val);
  }
  let padIdx = 0;
  while (codewords.length < spec.data) {
    codewords.push(padIdx % 2 === 0 ? 0xec : 0x11);
    padIdx++;
  }

  const dataBlocks = [];
  const ecBlocks = [];
  let offset = 0;
  for (let b = 0; b < spec.g1Blocks; b++) {
    const slice = codewords.slice(offset, offset + spec.g1Data);
    offset += spec.g1Data;
    dataBlocks.push(slice);
    ecBlocks.push(rsRemainder(slice, spec.ecPerBlock));
  }
  for (let b = 0; b < spec.g2Blocks; b++) {
    const slice = codewords.slice(offset, offset + spec.g2Data);
    offset += spec.g2Data;
    dataBlocks.push(slice);
    ecBlocks.push(rsRemainder(slice, spec.ecPerBlock));
  }

  const out = [];
  const maxDataLen = Math.max(spec.g1Data, spec.g2Data);
  for (let i = 0; i < maxDataLen; i++) {
    for (const block of dataBlocks) {
      if (i < block.length) out.push(block[i]);
    }
  }
  for (let i = 0; i < spec.ecPerBlock; i++) {
    for (const block of ecBlocks) {
      out.push(block[i]);
    }
  }
  return out;
}

function createMatrix(size) {
  return {
    size,
    modules: Array.from({ length: size }, () => new Array(size).fill(0)),
    isFunc: Array.from({ length: size }, () => new Array(size).fill(false)),
  };
}

function setFunc(grid, r, c, dark) {
  grid.modules[r][c] = dark ? 1 : 0;
  grid.isFunc[r][c] = true;
}

function drawFinder(grid, top, left) {
  const size = grid.size;
  for (let dr = -1; dr <= 7; dr++) {
    for (let dc = -1; dc <= 7; dc++) {
      const r = top + dr;
      const c = left + dc;
      if (r < 0 || r >= size || c < 0 || c >= size) continue;
      const onOuter = dr === 0 || dr === 6 || dc === 0 || dc === 6;
      const onInner = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
      const inFinder = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
      setFunc(grid, r, c, inFinder && (onOuter || onInner));
    }
  }
}

function drawAlignment(grid, centerR, centerC) {
  for (let dr = -2; dr <= 2; dr++) {
    for (let dc = -2; dc <= 2; dc++) {
      const dark = Math.abs(dr) === 2 || Math.abs(dc) === 2 || (dr === 0 && dc === 0);
      setFunc(grid, centerR + dr, centerC + dc, dark);
    }
  }
}

function drawFunctionPatterns(grid, spec) {
  const n = grid.size;
  drawFinder(grid, 0, 0);
  drawFinder(grid, 0, n - 7);
  drawFinder(grid, n - 7, 0);

  for (let i = 8; i < n - 8; i++) {
    const dark = i % 2 === 0;
    setFunc(grid, 6, i, dark);
    setFunc(grid, i, 6, dark);
  }

  for (const r of spec.align) {
    for (const c of spec.align) {
      if ((r <= 8 && c <= 8) || (r <= 8 && c >= n - 8) || (r >= n - 8 && c <= 8)) continue;
      drawAlignment(grid, r, c);
    }
  }

  // Reserve format info strips + dark module
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) setFunc(grid, 8, i, false);
    if (i !== 6) setFunc(grid, i, 8, false);
  }
  for (let i = n - 8; i < n; i++) setFunc(grid, 8, i, false);
  for (let i = n - 7; i < n; i++) setFunc(grid, i, 8, false);
  setFunc(grid, 4 * spec.version + 9, 8, true);

  if (spec.version >= 7) {
    const verBits = qrVersionBits(spec.version);
    for (let i = 0; i < 18; i++) {
      const bit = ((verBits >> i) & 1) === 1;
      const a = Math.floor(i / 3);
      const b = n - 11 + (i % 3);
      setFunc(grid, a, b, bit);
      setFunc(grid, b, a, bit);
    }
  }
}

export function qrFormatBits(ecBits, maskId) {
  const data = (ecBits << 3) | maskId;
  let rem = data << 10;
  for (let i = 4; i >= 0; i--) {
    if ((rem >> (i + 10)) & 1) rem ^= 0x537 << i;
  }
  return ((data << 10) | rem) ^ 0x5412;
}

export function qrVersionBits(version) {
  let rem = version << 12;
  for (let i = 5; i >= 0; i--) {
    if ((rem >> (i + 12)) & 1) rem ^= 0x1f25 << i;
  }
  return (version << 12) | rem;
}

function drawFormatInfo(grid, ecBits, maskId) {
  const n = grid.size;
  const bits = qrFormatBits(ecBits, maskId);
  const topLeft = [
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
    [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
  ];
  for (let idx = 0; idx < 15; idx++) {
    const dark = ((bits >> (14 - idx)) & 1) === 1;
    const [r1, c1] = topLeft[idx];
    setFunc(grid, r1, c1, dark);
    if (idx < 7) {
      setFunc(grid, n - 1 - idx, 8, dark);
    } else {
      setFunc(grid, 8, n - 15 + idx, dark);
    }
  }
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

function placeCodewords(grid, codewords, maskId) {
  const n = grid.size;
  const totalBits = codewords.length * 8;
  let bitIdx = 0;
  let upward = true;
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < n; step++) {
      const r = upward ? n - 1 - step : step;
      for (let dx = 0; dx < 2; dx++) {
        const c = right - dx;
        if (grid.isFunc[r][c]) continue;
        let bit = 0;
        if (bitIdx < totalBits) {
          const byteVal = codewords[bitIdx >> 3];
          bit = (byteVal >> (7 - (bitIdx & 7))) & 1;
          bitIdx++;
        }
        if (maskBit(maskId, r, c)) bit ^= 1;
        grid.modules[r][c] = bit;
      }
    }
    upward = !upward;
  }
}

function penaltyScore(modules) {
  const n = modules.length;
  let score = 0;

  // N1: 5+ consecutive same-color modules in row or col
  for (let r = 0; r < n; r++) {
    let runColor = modules[r][0];
    let runLen = 1;
    for (let c = 1; c < n; c++) {
      if (modules[r][c] === runColor) {
        runLen++;
      } else {
        if (runLen >= 5) score += 3 + (runLen - 5);
        runColor = modules[r][c];
        runLen = 1;
      }
    }
    if (runLen >= 5) score += 3 + (runLen - 5);
  }
  for (let c = 0; c < n; c++) {
    let runColor = modules[0][c];
    let runLen = 1;
    for (let r = 1; r < n; r++) {
      if (modules[r][c] === runColor) {
        runLen++;
      } else {
        if (runLen >= 5) score += 3 + (runLen - 5);
        runColor = modules[r][c];
        runLen = 1;
      }
    }
    if (runLen >= 5) score += 3 + (runLen - 5);
  }

  // N2: 2x2 same-color blocks
  for (let r = 0; r < n - 1; r++) {
    for (let c = 0; c < n - 1; c++) {
      const v = modules[r][c];
      if (v === modules[r][c + 1] && v === modules[r + 1][c] && v === modules[r + 1][c + 1]) {
        score += 3;
      }
    }
  }

  // N3: finder-like 1:1:3:1:1 with 4-light margin
  const p1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const p2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c <= n - 11; c++) {
      let m1 = true;
      let m2 = true;
      for (let k = 0; k < 11; k++) {
        if (modules[r][c + k] !== p1[k]) m1 = false;
        if (modules[r][c + k] !== p2[k]) m2 = false;
      }
      if (m1 || m2) score += 40;
    }
  }
  for (let c = 0; c < n; c++) {
    for (let r = 0; r <= n - 11; r++) {
      let m1 = true;
      let m2 = true;
      for (let k = 0; k < 11; k++) {
        if (modules[r + k][c] !== p1[k]) m1 = false;
        if (modules[r + k][c] !== p2[k]) m2 = false;
      }
      if (m1 || m2) score += 40;
    }
  }

  // N4: dark ratio deviation
  let dark = 0;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) dark += modules[r][c];
  }
  const pct = (dark * 100) / (n * n);
  const k = Math.floor(Math.abs(pct - 50) / 5);
  score += k * 10;
  return score;
}

export function qrEncode(text) {
  const bytes = Array.from(Buffer.from(String(text), 'utf8'));
  const spec = qrSelectVersion(bytes.length);
  const codewords = qrBuildCodewords(bytes, spec);

  let bestMask = 0;
  let bestPenalty = Infinity;
  let bestModules = null;
  for (let mask = 0; mask < 8; mask++) {
    const grid = createMatrix(spec.size);
    drawFunctionPatterns(grid, spec);
    placeCodewords(grid, codewords, mask);
    drawFormatInfo(grid, spec.ecBits, mask);
    const score = penaltyScore(grid.modules);
    if (score < bestPenalty) {
      bestPenalty = score;
      bestMask = mask;
      bestModules = grid.modules;
    }
  }

  return {
    version: spec.version,
    size: spec.size,
    ecLevel: spec.ecLevel,
    mask: bestMask,
    modules: bestModules,
  };
}

export function qrDarkRuns(modules) {
  const runs = [];
  const n = modules.length;
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (modules[r][c] === 1) {
        const start = c;
        while (c < n && modules[r][c] === 1) c++;
        runs.push({ x: start, y: r, w: c - start });
      } else {
        c++;
      }
    }
  }
  return runs;
}
