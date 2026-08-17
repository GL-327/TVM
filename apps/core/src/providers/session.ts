import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type SessionMode = 'kiosk' | 'desktop';

export interface SessionStatus {
  appliance: boolean;
  mode: SessionMode | 'unknown';
}

export type SessionRequestResult =
  | { ok: true; mode: SessionMode }
  | { ok: false; reason: 'not_appliance' | 'invalid_mode' };

export interface SessionService {
  status(): SessionStatus;
  request(mode: unknown): SessionRequestResult;
}

interface SessionServiceOptions {
  dataDir: string;
  helperPath?: string;
  platform?: NodeJS.Platform;
}

const DEFAULT_HELPER = '/usr/lib/tvm/switch-session';

function parseMode(raw: string): SessionMode | 'unknown' {
  const line = raw.split(/\r?\n/)[0]?.trim() ?? '';
  if (line === 'kiosk' || line === 'desktop') return line;
  return 'unknown';
}

export function createSessionService(options: SessionServiceOptions): SessionService {
  const helperPath = options.helperPath ?? DEFAULT_HELPER;
  const platform = options.platform ?? process.platform;
  const requestPath = join(options.dataDir, 'session-request');
  const appliance = platform === 'linux' && existsSync(helperPath);

  const readMode = (): SessionMode | 'unknown' => {
    try {
      return parseMode(readFileSync(requestPath, 'utf8'));
    } catch {
      return appliance ? 'kiosk' : 'unknown';
    }
  };

  return {
    status(): SessionStatus {
      return { appliance, mode: readMode() };
    },

    request(mode: unknown): SessionRequestResult {
      if (mode !== 'kiosk' && mode !== 'desktop') return { ok: false, reason: 'invalid_mode' };
      if (!appliance) return { ok: false, reason: 'not_appliance' };
      mkdirSync(options.dataDir, { recursive: true });
      writeFileSync(requestPath, `${mode}\n${Date.now()}\n`, { encoding: 'utf8', mode: 0o644 });
      return { ok: true, mode };
    },
  };
}
