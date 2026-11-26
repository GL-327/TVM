import { qualityBadges, type QualityInfo } from '../data/playbackVersions';
import { uiExtraEnabled, useExtraPrefs } from '../data/uiExtras';
import './quality-badges.css';

export function QualityBadges({ info, poster = false }: { info?: QualityInfo | null; poster?: boolean }): React.JSX.Element | null {
  const prefs = useExtraPrefs();
  const badges = uiExtraEnabled('qualityBadges', prefs) ? qualityBadges(info) : [];
  if (!badges.length) return null;
  return <span className={`quality-badges${poster ? ' quality-badges--poster' : ''}`} aria-label={badges.join(', ')}>
    {badges.map((badge) => <span key={badge}>{badge}</span>)}
  </span>;
}
