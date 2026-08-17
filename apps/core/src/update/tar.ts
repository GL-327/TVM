import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

const BLOCK = 512;
const ALLOWED_PREFIXES = ['ui/', 'core/'] as const;

export function isSafeTarName(name: string): boolean {
  if (name === '' || name.startsWith('/') || name.includes('\\') || name.includes('\0')) return false;
  if (name.split('/').includes('..')) return false;
  return ALLOWED_PREFIXES.some((prefix) => name === prefix.slice(0, -1) || name.startsWith(prefix));
}

function readCString(buffer: Buffer, start: number, length: number): string {
  const end = buffer.indexOf(0, start);
  const slice = buffer.subarray(start, end === -1 || end > start + length ? start + length : end);
  return slice.toString('utf8').trim();
}

function parseOctal(buffer: Buffer, start: number, length: number): number {
  const raw = readCString(buffer, start, length).replace(/\s+/g, '');
  if (raw === '') return 0;
  return Number.parseInt(raw, 8);
}

/**
 * Extracts a gzip-compressed ustar archive. Only `ui/` and `core/` entries are
 * accepted; anything else, including `..`, is a hard failure so a bad release
 * cannot write outside the version directory.
 */
export function extractTarGz(archive: Buffer, dest: string): void {
  const tar = gunzipSync(archive);
  let offset = 0;

  while (offset + BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK);
    if (header.every((byte) => byte === 0)) break;

    const name = readCString(header, 0, 100);
    const prefix = readCString(header, 345, 155);
    const fullName = prefix === '' ? name : `${prefix}/${name}`;
    const size = parseOctal(header, 124, 12);
    const type = header[156] ?? 0;

    offset += BLOCK;
    const data = tar.subarray(offset, offset + size);
    offset += Math.ceil(size / BLOCK) * BLOCK;

    if (!isSafeTarName(fullName)) {
      throw new Error(`refusing archive path: ${fullName}`);
    }

    const target = join(dest, fullName);
    if (type === 53 || fullName.endsWith('/')) {
      mkdirSync(target, { recursive: true });
      continue;
    }

    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, data);
  }
}

export function parseSha256File(text: string): string {
  const line = text.trim().split(/\r?\n/, 1)[0] ?? '';
  const match = line.match(/\b([a-fA-F0-9]{64})\b/);
  if (match === null || match[1] === undefined) {
    throw new Error('checksum file did not contain a SHA-256 hex digest');
  }
  return match[1].toLowerCase();
}

/** Minimal ustar writer for tests. */
export function packTarGz(entries: ReadonlyArray<{ name: string; data: Buffer }>): Buffer {
  const chunks: Buffer[] = [];
  for (const entry of entries) {
    const header = Buffer.alloc(BLOCK);
    const name = entry.name.slice(0, 100);
    header.write(name);
    header.write('0000644\0', 100, 'utf8');
    header.write('0000000\0', 108, 'utf8');
    header.write('0000000\0', 116, 'utf8');
    header.write(`${entry.data.length.toString(8).padStart(11, '0')}\0`, 124, 'utf8');
    header.write('00000000000\0', 136, 'utf8');
    header[156] = 48; // '0' regular file
    header.write('ustar\0', 257, 'utf8');
    header.write('00', 263, 'utf8');
    header.fill(32, 148, 156);
    let sum = 0;
    for (const byte of header) sum += byte;
    header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'utf8');
    chunks.push(header);
    chunks.push(entry.data);
    const pad = BLOCK - (entry.data.length % BLOCK);
    if (pad !== BLOCK) chunks.push(Buffer.alloc(pad));
  }
  chunks.push(Buffer.alloc(BLOCK * 2));
  return gzipSync(Buffer.concat(chunks));
}
