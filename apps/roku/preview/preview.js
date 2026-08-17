(() => {
  const frame = document.getElementById('stage');
  if (!(frame instanceof HTMLIFrameElement)) return;

  const vite = 'http://127.0.0.1:5173/?tv=1';
  const built = `${location.origin}/?tv=1`;

  async function viteIsUp() {
    try {
      await fetch('http://127.0.0.1:5173/', { mode: 'no-cors', cache: 'no-store' });
      return true;
    } catch {
      return false;
    }
  }

  function focusUi() {
    frame.focus();
  }

  void viteIsUp().then((live) => {
    frame.src = live ? vite : built;
  });

  frame.addEventListener('load', focusUi);
  window.addEventListener('focus', focusUi);
  document.addEventListener('pointerdown', focusUi);
})();
