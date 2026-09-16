/**
 * Electron's getNativeWindowHandle() is a Buffer whose layout depends on the OS.
 * mpv --wid wants that integer as a decimal string on every platform.
 */
export function nativeWindowIdFromHandle(handle: Buffer): string {
  if (handle.byteLength >= 8) return handle.readBigUInt64LE(0).toString();
  if (handle.byteLength >= 4) return handle.readUInt32LE(0).toString();
  return '0';
}
