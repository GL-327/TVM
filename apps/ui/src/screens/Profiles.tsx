import { useEffect, useState } from 'react';
import { FocusButton } from '../components/FocusButton';
import { FocusField } from '../components/FocusField';
import { fieldValue } from '../components/FocusField';
import { ProfileOrb } from '../components/ProfileOrb';
import {
  createProfile,
  fetchProfiles,
  removeProfile,
  switchProfile,
  type Profile,
  type ProfileRegistry,
} from '../data/profiles';
import { useNavigate } from '../nav/ViewStackContext';
import type { ScreenProps } from '../nav/registry';

const EMPTY: ProfileRegistry = { activeId: '', profiles: [] };

export function Profiles({ params }: ScreenProps): React.JSX.Element {
  const navigate = useNavigate();
  const next = typeof params['next'] === 'string' ? params['next'] : '';
  const [registry, setRegistry] = useState<ProfileRegistry>(EMPTY);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void fetchProfiles().then(setRegistry);
  }, []);

  const finish = (): void => {
    if (next === 'library') {
      navigate.home();
      navigate.push('library');
      return;
    }
    if (next !== '') {
      navigate.replace(next);
      return;
    }
    navigate.pop();
  };

  const open = async (profile: Profile): Promise<void> => {
    await switchProfile(profile.id);
    finish();
  };

  const add = async (raw?: string): Promise<void> => {
    try {
      const created = await createProfile(raw ?? name);
      setRegistry(created);
      setCreating(false);
      setName('');
      finish();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The profile was not created.');
    }
  };

  const remove = async (profile: Profile): Promise<void> => {
    try {
      setRegistry(await removeProfile(profile.id));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The profile was not removed.');
    }
  };

  return (
    <main className="page page--profiles">
      <p className="stage__kicker">TVM Stream</p>
      <h1 className="page__heading">Who's watching?</h1>
      <p className="page__lede">Profiles are only for TVM Stream. Continue watching stays on the person you pick.</p>
      {message !== null && <p className="page__message">{message}</p>}
      <div className="profile-grid">
        {registry.profiles.map((profile, index) => (
          <div key={profile.id} className="profile-tile">
            <FocusButton
              id={index === 0 ? 'profile-pick' : `profile-${profile.id}`}
              className="profile-tile__pick"
              onSelect={() => void open(profile)}
            >
              <ProfileOrb name={profile.name} hue={profile.hue} size="lg" />
              <span className="profile-tile__name">{profile.name}</span>
            </FocusButton>
            {registry.profiles.length > 1 && (
              <FocusButton id={`remove-${profile.id}`} className="tvm-button--quiet" onSelect={() => void remove(profile)}>
                Remove
              </FocusButton>
            )}
          </div>
        ))}
        {registry.profiles.length < 5 && !creating && (
          <FocusButton id="profile-add" className="profile-tile__pick" onSelect={() => setCreating(true)}>
            <span className="profile-orb profile-orb--lg profile-orb--add">+</span>
            <span className="profile-tile__name">Add profile</span>
          </FocusButton>
        )}
      </div>
      {creating && (
        <label className="token-field">
          <span>Profile name</span>
          <FocusField
            id="profile-name"
            value={name}
            onChange={setName}
            onConfirm={(value) => void add(value)}
            afterPasteFocusId="profile-save"
            placeholder="Name, then press OK"
          />
          <div className="hero__actions">
            <FocusButton id="profile-save" variant="primary" onSelect={() => void add(fieldValue('profile-name'))}>
              Save profile
            </FocusButton>
            <FocusButton id="profile-cancel" onSelect={() => setCreating(false)}>
              Cancel
            </FocusButton>
          </div>
        </label>
      )}
      <div className="hero__actions">
        <FocusButton id="profiles-back" onSelect={() => navigate.pop()}>
          Back
        </FocusButton>
      </div>
    </main>
  );
}
