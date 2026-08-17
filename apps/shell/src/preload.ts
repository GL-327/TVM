import { contextBridge, ipcRenderer } from 'electron';
import type { NativePlaybackInput, NativePlayerCommand, NativePlayerEvent } from './nativePlayerHost';
import type { ServiceEvent, ServiceStartInput } from './serviceHost';

contextBridge.exposeInMainWorld('tvmNativePlayer', {
  start: (input: NativePlaybackInput): Promise<{ ok: true }> => ipcRenderer.invoke('tvm:native-player:start', input),
  command: (command: NativePlayerCommand): Promise<void> => ipcRenderer.invoke('tvm:native-player:command', command),
  stop: (): Promise<void> => ipcRenderer.invoke('tvm:native-player:stop'),
  onEvent: (listener: (event: NativePlayerEvent) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: NativePlayerEvent): void => listener(payload);
    ipcRenderer.on('tvm:native-player:event', handler);
    return () => ipcRenderer.removeListener('tvm:native-player:event', handler);
  },
});

contextBridge.exposeInMainWorld('tvmServiceBrowser', {
  start: (input: ServiceStartInput): Promise<{ ok: true }> => ipcRenderer.invoke('tvm:service:start', input),
  stop: (): Promise<void> => ipcRenderer.invoke('tvm:service:stop'),
  onEvent: (listener: (event: ServiceEvent) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: ServiceEvent): void => listener(payload);
    ipcRenderer.on('tvm:service:event', handler);
    return () => ipcRenderer.removeListener('tvm:service:event', handler);
  },
});
