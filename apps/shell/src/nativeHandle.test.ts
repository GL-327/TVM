import { describe, expect, it } from 'vitest';
import { nativeWindowIdFromHandle } from './nativeHandle';

describe('native window id', () => {
  it('reads 64-bit handles used on Windows and macOS', () => {
    const handle = Buffer.alloc(8);
    handle.writeBigUInt64LE(0x1a2b3c4d5e6f7081n, 0);
    expect(nativeWindowIdFromHandle(handle)).toBe(handle.readBigUInt64LE(0).toString());
  });

  it('reads 32-bit X11 window ids', () => {
    const handle = Buffer.alloc(4);
    handle.writeUInt32LE(0x04a00b2, 0);
    expect(nativeWindowIdFromHandle(handle)).toBe(String(0x04a00b2));
  });
});
