import { LegacyHub } from './skins/legacy';

export function ServiceHome({ appId }: { appId: string }): React.JSX.Element {
  return <LegacyHub appId={appId} />;
}
