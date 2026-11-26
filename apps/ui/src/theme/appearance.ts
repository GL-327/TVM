export type FontChoice = 'geist' | 'inter' | 'system';
export type AccentChoice = 'default' | 'indigo' | 'coral' | 'amber' | 'emerald';

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

function save(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* Private browsing. */ }
}

export function readAccent(): AccentChoice {
  const value = read('tvm.accent');
  return value === 'indigo' || value === 'coral' || value === 'amber' || value === 'emerald' ? value : 'default';
}

export function applyAccent(value: AccentChoice = readAccent()): AccentChoice {
  if (value === 'default') delete document.documentElement.dataset.accent;
  else document.documentElement.dataset.accent = value;
  save('tvm.accent', value);
  return value;
}

export function readFont(): FontChoice {
  const value = read('tvm.font');
  return value === 'inter' || value === 'system' ? value : 'geist';
}

export function applyFont(value = readFont()): void {
  document.documentElement.dataset.font = value;
  save('tvm.font', value);
}

export function readTransparency(): boolean {
  return read('tvm.reduceTransparency') === 'on';
}

export function applyTransparency(reduced = readTransparency()): void {
  document.documentElement.dataset.transparency = reduced ? 'reduced' : 'clear';
  save('tvm.reduceTransparency', reduced ? 'on' : 'off');
  window.dispatchEvent(new CustomEvent('tvm:appearance'));
}
