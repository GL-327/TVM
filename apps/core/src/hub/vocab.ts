/** Hub v1 is additive: unrecognised capability strings are retained. */
export const HUB_VERSION = 1 as const;
export const HEARTBEAT_SEC = 30 as const;
export const CAPABILITIES = [
  'playback.pause_resume', 'playback.seek', 'playback.skip', 'nav.dpad', 'nav.select',
  'nav.back', 'play.title', 'play.live_channel', 'handoff.receive', 'handoff.send', 'input.physical',
] as const;
export const STATES = ['idle', 'playing', 'paused', 'offline', 'unknown', 'revoked'] as const;
export const PLATFORMS = ['roku', 'windows', 'web', 'android', 'android-tv', 'ios'] as const;
export const ACTION_CAPABILITY = {
  'playback.pause': 'playback.pause_resume', 'playback.resume': 'playback.pause_resume',
  'playback.seek': 'playback.seek', 'playback.skip': 'playback.skip', 'nav.dpad': 'nav.dpad',
  'nav.select': 'nav.select', 'nav.back': 'nav.back', 'play.title': 'play.title',
  'play.live_channel': 'play.live_channel',
} as const;
export const ACTIONS = Object.keys(ACTION_CAPABILITY) as Action[];
export type Capability = typeof CAPABILITIES[number];
export type State = typeof STATES[number];
export type Platform = typeof PLATFORMS[number];
export type Action = keyof typeof ACTION_CAPABILITY;
export interface NowPlaying {
  mediaId: string; title: string; artworkUrl: string | null; positionSec: number;
  durationSec: number | null; profileId: string;
}
export interface Device {
  id: string; name: string; room: string | null; platform: Platform; model: string | null;
  appVersion: string; build: string | null; slot: number; createdAt: string; lastSeenAt: string | null;
  lastSeenAgeSec: number | null; presence: 'online' | 'offline'; state: State; isCurrent: boolean;
  capabilities: string[]; physicalInput: boolean; nowPlaying: NowPlaying | { restricted: true } | null;
}
export interface Registration {
  clientId: string; platform: Platform; name: string; model: string | null; appVersion: string;
  build: string | null; capabilities: string[];
}
export interface Command {
  id: string; idempotencyKey: string; actor: { accountId: string; installationId: string | null };
  target: string; action: Action; payload: Record<string, unknown>; createdAt: string; expiresAt: string;
  seq: number; status: 'pending' | 'accepted' | 'applied' | 'rejected' | 'timed_out';
  reason: string | null; updatedAt: string; stateVersion?: number;
}
export const ACTIVITY_TYPES = [
  'device.linked', 'device.signed_in', 'device.renamed', 'device.room', 'device.revoked', 'device.signed_out',
  'pair.approved', 'pair.denied', 'command.sent', 'command.applied', 'command.rejected', 'command.timed_out',
] as const;
export interface ActivityParty { installationId: string | null; name: string }
export interface Activity {
  id: string; at: string; type: typeof ACTIVITY_TYPES[number]; actor: ActivityParty;
  target: ActivityParty; detail: string | null;
}
