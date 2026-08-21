import { describe, expect, it } from 'vitest';
import { bumpMarkEgg, profileEaster, searchEaster } from './easterEggs';

describe('easter eggs', () => {
  it('answers a few harmless search phrases', () => {
    expect(searchEaster('why not')).toBe('Because the remote said so.');
    expect(searchEaster('Be Happy!')).toContain('smiling');
    expect(searchEaster('hello tvm')).toContain('friendly');
    expect(searchEaster('konami')).toContain('Up, up');
    expect(searchEaster('tvm')).toContain('little screen');
    expect(searchEaster('stream')).toContain('showcase');
    expect(searchEaster('inception')).toBeNull();
  });

  it('fires the mark egg on the seventh tap', () => {
    expect(bumpMarkEgg(6)).toBe(0);
    expect(bumpMarkEgg(3)).toBe(4);
  });

  it('recognises a few profile names', () => {
    expect(profileEaster('Happy')).toContain('sunshine');
    expect(profileEaster('TVM')).toContain('house');
    expect(profileEaster('Arthur')).toBeNull();
  });
});
