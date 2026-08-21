import { SynthwaveCrt } from './theme/SynthwaveCrt';
import { ViewStackProvider } from './nav/ViewStackProvider';

export function App(): React.JSX.Element {
  return (
    <>
      <SynthwaveCrt />
      <ViewStackProvider />
    </>
  );
}
