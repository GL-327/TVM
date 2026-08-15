import { useEffect, useState } from 'react';

export type CoreStatus = 'connecting' | 'online' | 'offline';

export interface CoreHealth {
  status: CoreStatus;
  version: string | null;
}

interface HealthResponse {
  status: string;
  version: string;
  uptimeSeconds: number;
}

const POLL_INTERVAL_MS = 5000;
const REQUEST_TIMEOUT_MS = 3000;

/**
 * Polls the local core. An appliance has to say plainly whether its own
 * services are up, so this never silently retries forever behind a spinner.
 */
export function useCoreHealth(): CoreHealth {
  const [health, setHealth] = useState<CoreHealth>({ status: 'connecting', version: null });

  useEffect(() => {
    let cancelled = false;

    const poll = async (): Promise<void> => {
      try {
        const response = await fetch('/api/health', {
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (!response.ok) throw new Error(`core replied ${response.status}`);

        const body = (await response.json()) as HealthResponse;
        if (!cancelled) setHealth({ status: 'online', version: body.version });
      } catch {
        if (!cancelled) setHealth({ status: 'offline', version: null });
      }
    };

    void poll();
    const timer = setInterval(() => void poll(), POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return health;
}
