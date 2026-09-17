import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { bumpMarkEgg, profileEaster, searchEaster } from './easterEggs';

describe('easter eggs', () => {
  it('answers a few harmless search phrases', () => {
    expect(searchEaster('why not')).toBe('Because the remote said so.');
    expect(searchEaster('Be Happy!')).toContain('smiling');
    expect(searchEaster('hello tvm')).toContain('friendly');
    expect(searchEaster('konami')).toContain('Up, up');
    expect(searchEaster('tvm')).toContain('That’s us');
    expect(searchEaster('stream')).toContain('showcase');
    expect(searchEaster('inception')).toBeNull();
  });

  it('fires the mark egg on the seventh tap', () => {
    expect(bumpMarkEgg(6)).toBe(0);
    expect(bumpMarkEgg(3)).toBe(4);
    const src = readFileSync(new URL('./easterEggs.ts', import.meta.url), 'utf8');
    expect(src).toContain('tvm:secret-door');
    const nav = readFileSync(new URL('../nav/ViewStackProvider.tsx', import.meta.url), 'utf8');
    expect(nav).toContain('tvm:secret-door');
    expect(nav).toContain("navigate.push('developer-unlock')");
  });

  it('recognises a few profile names', () => {
    expect(profileEaster('Happy')).toContain('sunshine');
    expect(profileEaster('TVM')).toContain('house');
    expect(profileEaster('Arthur')).toBeNull();
  });
});
