import { applyTheme } from '../theme/apply';

const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight'];

export const EGG_CLASS = {
  konami: 'tvm-egg--konami',
  mark: 'tvm-egg--mark',
  happy: 'tvm-egg--happy',
} as const;

const EGG_MS = 8_000;

function pulseEgg(name: keyof typeof EGG_CLASS): void {
  if (typeof document === 'undefined') return;
  const cls = EGG_CLASS[name];
  document.documentElement.classList.add(cls);
  window.setTimeout(() => document.documentElement.classList.remove(cls), EGG_MS);
}

function normalizeKey(key: string): string {
  if (key === 'Up') return 'ArrowUp';
  if (key === 'Down') return 'ArrowDown';
  if (key === 'Left') return 'ArrowLeft';
  if (key === 'Right') return 'ArrowRight';
  return key;
}

export function searchEaster(query: string): string | null {
  const q = query.trim().toLowerCase().replace(/[?!]+$/g, '');
  if (q === 'why not') return 'Because the remote said so.';
  if (q === 'why not 2' || q === 'electric boogaloo') return 'The sequel nobody asked for, everybody needed.';
  if (q === 'bee happy' || q === 'be happy') {
    applyTheme('happy');
    pulseEgg('happy');
    return 'Happy mode engaged. The posters are smiling back.';
  }
  if (q === 'hello tvm') return 'Hello. The mark is watching — in a friendly way.';
  if (q === 'konami') {
    pulseEgg('konami');
    return 'Up, up, down, down. You already know the rest.';
  }
  if (q === 'tvm') {
    pulseEgg('mark');
    return 'That’s us. The little screen with a secret.';
  }
  if (q === 'stream' || q === 'tvm stream') {
    pulseEgg('happy');
    return 'Stream is a showcase. The posters already know.';
  }
  return null;
}

export function profileEaster(name: string): string | null {
  const q = name.trim().toLowerCase();
  if (q === 'bee' || q === 'happy') {
    applyTheme('happy');
    pulseEgg('happy');
    return 'That profile brought the sunshine.';
  }
  if (q === 'tvm') {
    pulseEgg('mark');
    return 'A profile named after the house. Bold.';
  }
  if (q === 'why not') {
    pulseEgg('konami');
    return 'Why not, indeed.';
  }
  return null;
}

export function bumpMarkEgg(count: number): number {
  const next = count + 1;
  if (next >= 7) {
    pulseEgg('mark');
    return 0;
  }
  return next;
}

export function installEasterEggs(): () => void {
  if (typeof window === 'undefined') return () => undefined;
  let step = 0;
  let infoTaps = 0;
  let infoReset = 0;

  const onKey = (event: KeyboardEvent): void => {
    const key = normalizeKey(event.key);
    const expected = KONAMI[step];
    if (key === expected) {
      step += 1;
      if (step === KONAMI.length) {
        step = 0;
        pulseEgg('konami');
      }
      return;
    }
    if (step === KONAMI.length - 1 && (key === 'b' || key === 'a' || key === 'Enter' || key === 'Backspace')) {
      step = 0;
      pulseEgg('konami');
      return;
    }
    step = key === KONAMI[0] ? 1 : 0;
  };

  const onInfo = (event: Event): void => {
    const intent = (event as CustomEvent<string>).detail;
    if (intent !== 'info') return;
    window.clearTimeout(infoReset);
    infoTaps += 1;
    if (infoTaps >= 3) {
      infoTaps = 0;
      pulseEgg('happy');
      return;
    }
    infoReset = window.setTimeout(() => {
      infoTaps = 0;
    }, 2_400);
  };

  window.addEventListener('keydown', onKey, true);
  window.addEventListener('tvm:media-intent', onInfo);
  return () => {
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('tvm:media-intent', onInfo);
    window.clearTimeout(infoReset);
  };
}
