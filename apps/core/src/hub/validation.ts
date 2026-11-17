import { bad } from './errors.ts';
import { PLATFORMS, type Registration } from './vocab.ts';

export function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function bodyObject(value: unknown): Record<string, unknown> {
  if (!object(value)) bad();
  return value;
}
export function text(value: unknown, max: number, code = 'invalid_request'): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.trim().length > max || /[\x00-\x1f\x7f]/.test(value)) bad(code);
  return value.trim();
}
export function optionalText(value: unknown, max: number): string | null {
  return value === null || value === undefined ? null : text(value, max);
}
/** Identities and idempotency keys are opaque; validation must not normalise them. */
export function identifier(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length > max) bad();
  text(value, max);
  return value;
}
export function capabilities(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 128) bad();
  return [...new Set(value.map((entry: unknown) => text(entry, 100)))];
}
export function nonnegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
export function registration(value: unknown, pairing = false): Registration {
  const input = bodyObject(value);
  if (!PLATFORMS.includes(input['platform'] as Registration['platform'])) bad();
  return {
    clientId: identifier(input['clientId'], 512), platform: input['platform'] as Registration['platform'],
    name: text(input['name'], 40, 'invalid_name'), model: optionalText(input['model'], 200),
    appVersion: text(input['appVersion'], 100), build: optionalText(input['build'], 100),
    capabilities: input['capabilities'] === undefined && pairing ? [] : capabilities(input['capabilities']),
  };
}
