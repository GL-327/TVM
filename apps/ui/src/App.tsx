import { AnimeStage } from './theme/anime/AnimeStage';
import { SceneField } from './theme/SceneField';
import { SynthwaveCrt } from './theme/SynthwaveCrt';
import { ViewStackProvider } from './nav/ViewStackProvider';

export function App(): React.JSX.Element {
  return (
    <>
      {/* Both stages sit behind the screen stack: `.tvm-scene` and `.rt-set`
          are z-index 0, `.app__screen` is z-index 1. Retro hides the scene and
          paints its own television set instead. */}
      <SceneField />
      <SynthwaveCrt />
      <AnimeStage />
      <ViewStackProvider />
    </>
  );
}
