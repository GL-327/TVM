/**
 * The animated stage behind every screen.
 *
 * Six gradient layers drifting against each other. Deliberately CSS rather than
 * the WebGL field in sceneEngine.ts: these layers animate `transform` and
 * `opacity` only, so they live on the compositor and cost close to nothing on
 * the phone clients and the Electron shell alike. A fullscreen fragment shader
 * repainting every frame is the wrong trade for a background, and the earlier
 * attempt at one is what put a canvas over Home's chrome.
 *
 * Mounted once in App.tsx as a sibling of the screen stack, so it never sits
 * inside a screen's stacking context. `.tvm-scene` is z-index 0 and
 * `.app__screen` is z-index 1 — the scene cannot cover chrome.
 *
 * Motion is switched off by `data-motion='reduced'` and the whole layer by
 * `data-perf='on'`; see scene.css and motion.css.
 */
export function SceneField(): React.JSX.Element {
  return (
    <div className="tvm-scene" data-engine="css" aria-hidden="true">
      <div className="tvm-scene__css">
        <div className="tvm-scene__layer tvm-scene__sky" />
        <div className="tvm-scene__layer tvm-scene__veil" />
        <div className="tvm-scene__layer tvm-scene__caustic" />
        <div className="tvm-scene__layer tvm-scene__caustic tvm-scene__caustic--2" />
        <div className="tvm-scene__layer tvm-scene__sun" />
        <div className="tvm-scene__layer tvm-scene__spec" />
      </div>
      <div className="tvm-scene__grain" />
    </div>
  );
}
