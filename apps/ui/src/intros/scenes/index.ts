import type { IntroPick } from '../introLogic';
import type { IntroScene } from './common';
import { createDoomScene } from './doom';
import { createMockingjayScene } from './mockingjay';

export function createIntroScene(pick: IntroPick): IntroScene {
  const opts = { accent: pick.intro.accent, glow: pick.intro.glow, title: pick.title, durationMs: pick.intro.durationMs };
  return pick.intro.style === 'doom' ? createDoomScene(opts) : createMockingjayScene(opts);
}
