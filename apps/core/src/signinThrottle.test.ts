import { describe, expect, it } from 'vitest';
import { createSignInLimiter } from './security.ts';

describe('sign-in sliding windows', () => {
  it('normalizes email across IPs and expires individual attempts', () => {
    let time = 0;
    const allow = createSignInLimiter({ now: () => time, windowMs: 1000, emailLimit: 2, ipLimit: 5 });
    expect(allow(' Alice@Example.COM ', '1')).toBe(true);
    time = 500;
    expect(allow('alice@example.com', '2')).toBe(true);
    expect(allow('ALICE@example.com', '3')).toBe(false);
    time = 1000;
    expect(allow('alice@example.com', '3')).toBe(true);
    expect(allow('alice@example.com', '4')).toBe(false);
  });
  it('limits IPs across different emails and normalizes IPv4-mapped sockets', () => {
    let time = 0;
    const allow = createSignInLimiter({ now: () => time, windowMs: 1000, emailLimit: 2, ipLimit: 2 });
    expect(allow('a@example.com', '::ffff:192.168.1.2')).toBe(true);
    expect(allow('b@example.com', '192.168.1.2')).toBe(true);
    expect(allow('c@example.com', '192.168.1.2')).toBe(false);
    expect(allow('c@example.com', '192.168.1.3')).toBe(true);
    time = 1000;
    expect(allow('d@example.com', '192.168.1.2')).toBe(true);
  });
});
