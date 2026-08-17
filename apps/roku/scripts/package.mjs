/**
 * Build apps/roku/tvm-roku.zip with POSIX paths so a Roku can sideload it.
 * Windows Compress-Archive writes backslashes; this writer does not.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { deflateRawSync } from "node:zlib";

const rokuRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(rokuRoot, "tvm-roku.zip");

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc ^= buf[i];
    for (let b = 0; b < 8; b += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(n) {
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(n);
  return buf;
}

function u32(n) {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(n);
  return buf;
}

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path, acc);
    else acc.push(path);
  }
  return acc;
}

function channelFiles() {
  const files = [];
  const manifest = join(rokuRoot, "manifest");
  if (existsSync(manifest)) files.push(manifest);
  for (const name of ["source", "components", "images", "fonts"]) {
    const dir = join(rokuRoot, name);
    if (existsSync(dir)) walk(dir, files);
  }
  const config = join(rokuRoot, "config.json");
  if (existsSync(config)) files.push(config);
  return files;
}

function dosDateTime(date = new Date()) {
  return {
    time: (date.getSeconds() >> 1) | (date.getMinutes() << 5) | (date.getHours() << 11),
    date: date.getDate() | ((date.getMonth() + 1) << 5) | ((date.getFullYear() - 1980) << 9),
  };
}

export function buildZip(files) {
  const { time, date } = dosDateTime();
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(file.name, "utf8");
    const crc = crc32(file.data);
    const compressed = deflateRawSync(file.data);
    const store = compressed.length >= file.data.length;
    const payload = store ? file.data : compressed;
    const method = store ? 0 : 8;

    const local = Buffer.concat([
      Buffer.from("PK\u0003\u0004"),
      u16(20),
      u16(0),
      u16(method),
      u16(time),
      u16(date),
      u32(crc),
      u32(payload.length),
      u32(file.data.length),
      u16(nameBuf.length),
      u16(0),
      nameBuf,
      payload,
    ]);
    locals.push(local);

    const central = Buffer.concat([
      Buffer.from("PK\u0001\u0002"),
      u16(20),
      u16(20),
      u16(0),
      u16(method),
      u16(time),
      u16(date),
      u32(crc),
      u32(payload.length),
      u32(file.data.length),
      u16(nameBuf.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      nameBuf,
    ]);
    centrals.push(central);
    offset += local.length;
  }

  const centralDir = Buffer.concat(centrals);
  const eocd = Buffer.concat([
    Buffer.from("PK\u0005\u0006"),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(centralDir.length),
    u32(offset),
    u16(0),
  ]);

  return Buffer.concat([...locals, centralDir, eocd]);
}

export function listZipNames(buf) {
  const names = [];
  const eocdSig = Buffer.from("PK\u0005\u0006");
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i -= 1) {
    if (buf[i] === eocdSig[0] && buf.subarray(i, i + 4).equals(eocdSig)) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return names;
  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i += 1) {
    if (!buf.subarray(offset, offset + 4).equals(Buffer.from("PK\u0001\u0002"))) break;
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    names.push(buf.subarray(offset + 46, offset + 46 + nameLen).toString("utf8"));
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

export function packageChannel() {
  const files = channelFiles()
    .map((path) => ({
      name: relative(rokuRoot, path).replaceAll("\\", "/"),
      data: readFileSync(path),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (files.length === 0) {
    throw new Error("No Roku channel files found to package");
  }

  writeFileSync(out, buildZip(files));
  console.log(`Wrote ${out} (${files.length} files)`);
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  packageChannel();
}
