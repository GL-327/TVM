/**
 * Bumped when the shipped default theme changes. The old key's value stays
 * behind, so each new default is introduced exactly once per device and a
 * theme the viewer picks afterwards is never overwritten again.
 *
 * Its own module, with no stylesheet imports, so the browser tests can read
 * it. They pin a theme before boot, and each time this key was renamed (isle,
 * then cinematic, then orbit) every spec still setting the old name had its
 * theme silently replaced by the new default.
 */
export const THEME_DEFAULT_BOOT = 'tvm.theme.orbit-boot';
