import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shouldShowPatchNotesPopup } from '../data/changelog';

describe('patch notes pop-up', () => {
  it('shows once, only when the service switch is on and the version is new', () => {
    expect(shouldShowPatchNotesPopup(true, null, '1.4.0')).toBe(true);
    expect(shouldShowPatchNotesPopup(true, '1.3.1', '1.4.0')).toBe(true);
    expect(shouldShowPatchNotesPopup(true, '1.4.0', '1.4.0')).toBe(false);
    expect(shouldShowPatchNotesPopup(false, null, '1.4.0')).toBe(false);
    expect(shouldShowPatchNotesPopup(undefined, null, '1.4.0')).toBe(false);
  });

  it('has the version chip, known issues, Got it and Esc, and falls back to the corner card', () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'PatchNotesPopup.tsx'), 'utf8');
    expect(src).toContain('TVM {release.version}');
    expect(src).toContain('Known issues');
    expect(src).toContain('Got it');
    expect(src).toContain("'Escape'");
    expect(src).toContain('<ChangelogCornerCard />');
  });
});
