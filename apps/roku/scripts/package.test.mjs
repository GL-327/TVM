import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inflateRawSync } from 'node:zlib';
import { buildZip, listZipNames, validatePkgConfig } from './package.mjs';

test('Roku zip has root manifest, POSIX paths and intact compressed payloads', () => {
  const files = [
    { name: 'manifest', data: Buffer.from('title=TVM\nmajor_version=0\n') },
    { name: 'source/main.brs', data: Buffer.from('sub main()\n' + "' payload\n".repeat(90) + 'end sub\n') },
  ];
  const zip = buildZip(files);
  assert.deepEqual(listZipNames(zip), files.map((file) => file.name));
  let offset = 0;
  for (const file of files) {
    assert.equal(zip.readUInt32LE(offset), 0x04034b50);
    const method = zip.readUInt16LE(offset + 8);
    const size = zip.readUInt32LE(offset + 18);
    const start = offset + 30 + zip.readUInt16LE(offset + 26) + zip.readUInt16LE(offset + 28);
    const bytes = zip.subarray(start, start + size);
    assert.deepEqual(method === 8 ? inflateRawSync(bytes) : bytes, file.data);
    offset = start + size;
  }
});

test('package config accepts only a credential-free HTTP(S) Core origin', () => {
  for (const url of ['http://192.168.1.20:7345', 'https://core.example.test']) {
    assert.doesNotThrow(() => validatePkgConfig({ coreBaseUrl: url }));
  }
  for (const value of [null, {}, { coreBaseUrl: 'http://core:7345', coreToken: 'secret' },
    ...['http://user:secret@core:7345', 'https://core/?token=secret', 'https://core/#secret',
      'https://core/api', 'file:///private'].map((coreBaseUrl) => ({ coreBaseUrl }))]) {
    assert.throws(() => validatePkgConfig(value));
  }
});
