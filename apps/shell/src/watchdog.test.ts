import { describe, expect, it } from 'vitest';
import { createCrashWatch, urlForLoad } from './watchdog';

describe('crash watch', () => {
  it('reloads the first two crashes and recovers on the third', () => {
    let t = 1_000;
    const watch = createCrashWatch(() => t);
    expect(watch.noteCrash()).toBe('reload');
    t += 1_000;
    expect(watch.noteCrash()).toBe('reload');
    t += 1_000;
    expect(watch.noteCrash()).toBe('recovery');
  });

  it('forgets crashes outside the minute', () => {
    let t = 1_000;
    const watch = createCrashWatch(() => t);
    expect(watch.noteCrash()).toBe('reload');
    t += 61_000;
    expect(watch.noteCrash()).toBe('reload');
    t += 1_000;
    expect(watch.noteCrash()).toBe('reload');
  });
});

describe('urlForLoad', () => {
  it('adds and removes the recovery flag', () => {
    expect(urlForLoad('http://127.0.0.1:5173', 'recovery')).toBe('http://127.0.0.1:5173/?recovery=1');
    expect(urlForLoad('http://127.0.0.1:5173/?recovery=1', 'reload')).toBe('http://127.0.0.1:5173/');
  });

  it('keeps the laptop desktop flag across a recovery reload', () => {
    expect(urlForLoad('http://127.0.0.1:5173/?desktop=1', 'recovery')).toBe(
      'http://127.0.0.1:5173/?desktop=1&recovery=1',
    );
    expect(urlForLoad('http://127.0.0.1:5173/?desktop=1&recovery=1', 'reload')).toBe(
      'http://127.0.0.1:5173/?desktop=1',
    );
  });
});
