export type CapabilityDecision = { ok: true } | {
  ok: false; status: 403 | 503; error: 'live_tv_not_entitled' | 'live_tv_unavailable'; message: string;
};

/** Read-only: visibility, orderability and outages never mutate a grant. */
export function requireCapability(capability: 'liveTv', input: { liveTv: boolean; liveTvHealthy: boolean; dev?: boolean }): CapabilityDecision {
  if (capability === 'liveTv' && !input.liveTv && !input.dev) {
    return { ok: false, status: 403, error: 'live_tv_not_entitled', message: 'Live TV access requires activation by the app owner.' };
  }
  if (!input.liveTvHealthy) {
    return { ok: false, status: 503, error: 'live_tv_unavailable', message: 'Live TV is temporarily unavailable. Your access is unchanged. Please try again later.' };
  }
  return { ok: true };
}
