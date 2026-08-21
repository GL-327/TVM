/// <reference types="vite/client" />

declare const __TVM_UI_VERSION__: string;
declare const __TVM_CORE_ORIGIN__: string;

type TvmNativePlayerCommand = 'togglePause' | 'pause' | 'play' | 'seekBack' | 'seekForward' | 'stop';

type TvmNativePlayerEvent =
  | { type: 'started'; title: string }
  | { type: 'state'; paused: boolean; buffering: boolean; position: number; duration: number }
  | { type: 'ended' }
  | { type: 'closed' }
  | { type: 'error'; message: string };

type TvmServiceEvent = { type: 'started'; title: string } | { type: 'closed' } | { type: 'error'; message: string };

interface Window {
  tvmNativePlayer?: {
    start(input: { url: string; title: string; startAt?: number }): Promise<{ ok: true }>;
    command(command: TvmNativePlayerCommand): Promise<void>;
    seekTo(seconds: number): Promise<void>;
    stop(): Promise<void>;
    onEvent(listener: (event: TvmNativePlayerEvent) => void): () => void;
  };
  tvmServiceBrowser?: {
    start(input: { id: string; url: string; title: string }): Promise<{ ok: true }>;
    stop(): Promise<void>;
    onEvent(listener: (event: TvmServiceEvent) => void): () => void;
  };
}
