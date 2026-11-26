/**
 * "One highlighted card": while the pointer is over a card, the keyboard-focused
 * card yields its highlight. This used to be `main:has(.poster:hover) ...` in CSS,
 * which made Chrome re-match :has() over the whole page (thousands of elements)
 * on every hover and focus change. One attribute on <html>, flipped only when the
 * pointer enters or leaves the card area, does the same with no per-move work.
 */
const CARD = '.poster, .channel-card';
const LEAVE_DELAY_MS = 90;

let installed = false;

export function installHoverYield(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  const root = document.documentElement;
  let timer = 0;
  const set = (on: boolean): void => {
    if (on) {
      if (root.dataset['cardHover'] !== 'true') root.dataset['cardHover'] = 'true';
    } else if (root.dataset['cardHover'] !== undefined) {
      delete root.dataset['cardHover'];
    }
  };
  document.addEventListener(
    'pointerover',
    (event) => {
      if (event.pointerType === 'touch') return;
      const target = event.target;
      if (!(target instanceof Element) || target.closest(CARD) === null) return;
      window.clearTimeout(timer);
      set(true);
    },
    { passive: true },
  );
  document.addEventListener(
    'pointerout',
    (event) => {
      const target = event.target;
      if (!(target instanceof Element) || target.closest(CARD) === null) return;
      const next = event.relatedTarget;
      if (next instanceof Element && next.closest(CARD) !== null) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => set(false), LEAVE_DELAY_MS);
    },
    { passive: true },
  );
}
