import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { artClassName, artFace, markArtReady, paintArtReady, syncBitmap } from './artFace';

const dir = dirname(fileURLToPath(import.meta.url));

describe('artFace', () => {
  it('paints conveyor clones so the camera is never blank', () => {
    expect(artFace({ src: 'https://img/p.jpg', decorative: true })).toBe('pending');
  });

  it('shows a pending face until the bitmap is ready', () => {
    expect(artFace({ src: 'https://img/p.jpg' })).toBe('pending');
    expect(artFace({ src: 'https://img/p.jpg', loadedSrc: 'https://img/other.jpg' })).toBe('pending');
    expect(artFace({ src: 'https://img/p.jpg', loadedSrc: 'https://img/p.jpg' })).toBe('ready');
  });

  it('falls back when the src is empty or this src failed', () => {
    expect(artFace({ src: '' })).toBe('fallback');
    expect(artFace({ src: 'https://img/p.jpg', failedSrc: 'https://img/p.jpg' })).toBe('fallback');
    expect(artFace({ src: 'https://img/p.jpg', failedSrc: 'https://img/old.jpg' })).toBe('pending');
  });

  it('stamps a single state class for chrome', () => {
    expect(artClassName('pending', 'poster__art')).toBe('poster__art art--pending');
    expect(artClassName('ready')).toBe('art--ready');
    expect(artClassName('clone', 'channel-card__art')).toBe('channel-card__art art--clone');
  });

  it('treats a cached complete bitmap as ready', () => {
    const ready = vi.fn();
    syncBitmap({ complete: true, naturalWidth: 240 } as HTMLImageElement, 'https://img/p.jpg', ready);
    expect(ready).toHaveBeenCalledWith('https://img/p.jpg');
  });

  it('flips pending to ready on the parent without React state', () => {
    const parent = { classList: { remove: vi.fn(), add: vi.fn() } };
    paintArtReady({ complete: true, naturalWidth: 180, parentElement: parent } as unknown as HTMLImageElement);
    expect(parent.classList.remove).toHaveBeenCalledWith('art--pending');
    expect(parent.classList.add).toHaveBeenCalledWith('art--ready');
  });

  it('marks ready from onLoad without waiting for complete', () => {
    const parent = { classList: { remove: vi.fn(), add: vi.fn() } };
    markArtReady({ complete: false, naturalWidth: 0, parentElement: parent } as unknown as HTMLImageElement);
    expect(parent.classList.remove).toHaveBeenCalledWith('art--pending');
    expect(parent.classList.add).toHaveBeenCalledWith('art--ready');
  });

  it('waits when a complete image still has no pixels', () => {
    const ready = vi.fn();
    syncBitmap({ complete: true, naturalWidth: 0 } as HTMLImageElement, 'https://img/p.jpg', ready);
    expect(ready).not.toHaveBeenCalled();
  });

  it('sets a real src and does not wait on referrer for TMDB', () => {
    const art = readFileSync(join(dir, 'Artwork.tsx'), 'utf8');
    expect(art).toContain('src={src}');
    expect(art).toContain('referrerPolicy={ART_REFERRER}');
    expect(art).not.toContain('data-src');
    expect(art).toContain("loading={eager ? 'eager' : 'lazy'}");
    expect(art).not.toContain('eager || !decorative');
    expect(art).toContain('decoding="async"');
    expect(art).toContain('memo(');
    const poster = readFileSync(join(dir, 'PosterCard.tsx'), 'utf8');
    const channel = readFileSync(join(dir, 'ChannelCard.tsx'), 'utf8');
    expect(poster).not.toContain('eager={!decorative}');
    expect(channel).toContain('loading="lazy"');
    expect(channel).toContain('onArrowPress={() => false}');
  });

  it('keeps an img node and uncovers it when ready', () => {
    const art = readFileSync(join(dir, 'Artwork.tsx'), 'utf8');
    const css = readFileSync(join(dir, '../app.css'), 'utf8');
    expect(art).toContain('<img');
    expect(art).toContain('src={src}');
    expect(art).toContain('markArtReady');
    const imgAt = art.indexOf('<img');
    const shimmerAt = art.indexOf('skeleton skeleton--art');
    expect(imgAt).toBeGreaterThan(-1);
    expect(shimmerAt).toBeGreaterThan(-1);
    expect(shimmerAt).toBeLessThan(imgAt);
    expect(css).toMatch(/\.art--ready\s*>\s*\.skeleton--art[\s\S]{0,80}display:\s*none/);
    const marker = '.poster__art img {\n  position: absolute';
    const start = css.indexOf(marker);
    const block = css.slice(start, css.indexOf('}', start) + 1);
    expect(block).toContain('z-index: 1');
    expect(block).toContain('opacity: 1');
  });

  it('waits when the element is still decoding', () => {
    const ready = vi.fn();
    syncBitmap({ complete: false, naturalWidth: 0 } as HTMLImageElement, 'https://img/p.jpg', ready);
    syncBitmap(null, 'https://img/p.jpg', ready);
    expect(ready).not.toHaveBeenCalled();
  });
});
