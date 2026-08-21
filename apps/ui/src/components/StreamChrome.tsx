import { BrandLockup } from './BrandLockup';
import { FocusButton } from './FocusButton';
import { IconSearch } from './Icons';
import { ProfileOrb } from './ProfileOrb';
import { useNavigate } from '../nav/ViewStackContext';
import type { Profile } from '../data/profiles';

interface StreamChromeProps {
  profile: Profile | null;
  lane: 'all' | 'shows' | 'movies';
  onLane: (lane: 'all' | 'shows' | 'movies') => void;
}

export function StreamChrome({ profile, lane, onLane }: StreamChromeProps): React.JSX.Element {
  const navigate = useNavigate();

  return (
    <nav className="stream-chrome" aria-label="TVM Stream" data-wrap="row">
      <FocusButton
        id="stream-profile"
        className="stream-chrome__avatar"
        onSelect={() => navigate.push('profiles', { params: { next: 'library' } })}
      >
        <ProfileOrb name={profile?.name ?? 'Profile'} hue={profile?.hue ?? 220} />
      </FocusButton>
      <FocusButton id="stream-search" className="stream-chrome__link" onSelect={() => navigate.pushModal('search')}>
        <IconSearch className="stream-chrome__search" />
        Search
      </FocusButton>
      <FocusButton id="stream-home" className="stream-chrome__link" onSelect={() => navigate.home()}>
        Home
      </FocusButton>
      <FocusButton
        id="stream-shows"
        className={`stream-chrome__link${lane === 'shows' ? ' stream-chrome__link--on' : ''}`}
        onSelect={() => onLane(lane === 'shows' ? 'all' : 'shows')}
      >
        Shows
      </FocusButton>
      <FocusButton
        id="stream-movies"
        className={`stream-chrome__link${lane === 'movies' ? ' stream-chrome__link--on' : ''}`}
        onSelect={() => onLane(lane === 'movies' ? 'all' : 'movies')}
      >
        Movies
      </FocusButton>
      <BrandLockup kind="wordmark" focusId="stream-mark" className="stream-chrome__mark-btn" />
    </nav>
  );
}
