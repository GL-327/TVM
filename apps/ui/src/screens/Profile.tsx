import { useEffect, useState } from 'react';
import { FocusButton } from '../components/FocusButton';
import { PageScene } from '../components/PageScene';
import { ProfileOrb } from '../components/ProfileOrb';
import { Ribbon } from '../components/Ribbon';
import { fetchRdStatus, type RdStatus } from '../data/media';
import {
  fetchProfiles,
  switchProfile,
  type Profile as ProfileRecord,
  type ProfileRegistry,
} from '../data/profiles';
import { useNavigate } from '../nav/ViewStackContext';
import type { ScreenProps } from '../nav/registry';

const EMPTY_RD: RdStatus = { configured: false, username: null, premium: false, error: null };
const EMPTY_PROFILES: ProfileRegistry = { activeId: '', profiles: [] };

export function Profile(_props: ScreenProps): React.JSX.Element {
  const navigate = useNavigate();
  const [rd, setRd] = useState<RdStatus>(EMPTY_RD);
  const [registry, setRegistry] = useState<ProfileRegistry>(EMPTY_PROFILES);

  useEffect(() => {
    void fetchRdStatus().then((status) => {
      if (status !== null) setRd(status);
    });
    void fetchProfiles().then(setRegistry);
  }, []);

  const active = registry.profiles.find((entry) => entry.id === registry.activeId) ?? registry.profiles[0];

  const pick = async (profile: ProfileRecord): Promise<void> => {
    try {
      setRegistry(await switchProfile(profile.id));
    } catch {
      /* keep the current profile */
    }
  };

  return (
    <main className="page page--settings page--docked page--profile">
      <PageScene />
      <Ribbon active="profile" />
      <header className="page__toolbar">
        <div>
          <p className="stage__kicker">This device</p>
          <h1 className="page__heading">{active?.name ?? 'Profile'}</h1>
        </div>
      </header>
      <p className="page__lede">
        Watch progress and settings stay on this machine. Stream profiles are only used inside TVM Stream.
      </p>
      {registry.profiles.length > 0 && (
        <div className="profile-grid profile-grid--hub" data-wrap="grid" aria-label="Profiles on this device">
          {registry.profiles.map((profile, index) => (
            <FocusButton
              key={profile.id}
              id={index === 0 ? 'profile-pick' : `profile-${profile.id}`}
              className={`profile-tile__pick${profile.id === registry.activeId ? ' profile-tile__pick--on' : ''}`}
              onSelect={() => void pick(profile)}
            >
              <ProfileOrb name={profile.name} hue={profile.hue} size="lg" />
              <span className="profile-tile__name">{profile.name}</span>
            </FocusButton>
          ))}
        </div>
      )}
      <div className="settings-list" data-wrap="y">
        <FocusButton
          id="profiles"
          className="settings-row"
          detail="TVM Stream only"
          onSelect={() => navigate.push('profiles')}
        >
          Stream profiles
        </FocusButton>
        <FocusButton
          id="realdebrid"
          className="settings-row"
          detail={rd.username ?? (rd.configured ? 'Connected' : 'Not connected')}
          onSelect={() => navigate.push('realdebrid')}
        >
          Real-Debrid
        </FocusButton>
      </div>
    </main>
  );
}
