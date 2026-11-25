import { useEffect, useMemo, useRef, useState } from 'react';
import { BackButton } from '../components/BackButton';
import { FocusButton } from '../components/FocusButton';
import { fieldValue, FocusField } from '../components/FocusField';
import { GlassSegmented } from '../components/GlassSegmented';
import { PinPadModal } from '../components/PinPadModal';
import { ProfileOrb } from '../components/ProfileOrb';
import { getAvatarsContent, type AvatarSet } from '../data/content';
import { primaryActiveEvent } from '../data/events';
import { ageLimitLabel, getKidsDefaultAge, getParentalLevels } from '../data/parental';
import { recordPinAttempt, remainingLockoutSeconds, type PinLockoutState } from '../data/pin';
import { fetchPlan } from '../data/plan';
import {
  createProfile,
  effectiveProfileMaxAge,
  fetchProfiles,
  isKidsProfile,
  PinChallengeError,
  removeProfile,
  switchProfile,
  updateProfile,
  verifyProfilePin,
  type Profile,
  type ProfileKind,
  type ProfileRegistry,
} from '../data/profiles';
import type { AgeLimitValue } from '../data/content';
import { profileEaster } from '../brand/easterEggs';
import { bindKeyboardFields } from '../nav/pointerInput';
import { useNavigate } from '../nav/ViewStackContext';
import type { ScreenProps } from '../nav/registry';

const EMPTY: ProfileRegistry = { activeId: '', profiles: [] };

type EditorMode =
  | { kind: 'chooser' }
  | { kind: 'create' }
  | { kind: 'edit'; profile: Profile; verifiedPin?: string };

type PinPromptState = {
  title: string;
  subtitle?: string;
  targetProfileId: string;
  error: string | null;
  shakeKey: number;
  onVerified: (pin: string) => Promise<void> | void;
};

export function orderedAvatarSets(): Array<AvatarSet & { featured?: boolean }> {
  const sets = getAvatarsContent().sets;
  const activeSetId = primaryActiveEvent()?.avatarSet ?? null;
  if (activeSetId === null) return sets;
  const featuredSet = sets.find((set) => set.id === activeSetId);
  if (featuredSet === undefined) return sets;
  return [
    { ...featuredSet, title: 'Featured', featured: true },
    ...sets.filter((set) => set.id !== activeSetId),
  ];
}

export function Profiles({ params }: ScreenProps): React.JSX.Element {
  const navigate = useNavigate();
  const next = typeof params['next'] === 'string' ? params['next'] : '';
  const [registry, setRegistry] = useState<ProfileRegistry>(EMPTY);
  const [mode, setMode] = useState<EditorMode>({ kind: 'chooser' });
  const [message, setMessage] = useState<string | null>(null);
  const [profilesMax, setProfilesMax] = useState(10);
  const [busy, setBusy] = useState(false);
  const pageRef = useRef<HTMLElement>(null);

  // Editor form state
  const [draftName, setDraftName] = useState('');
  const [draftAvatar, setDraftAvatar] = useState<string | null>(null);
  const [draftKind, setDraftKind] = useState<ProfileKind>('standard');
  const [draftMaxAge, setDraftMaxAge] = useState<AgeLimitValue>(18);
  const [draftPin, setDraftPin] = useState<string | null | undefined>(undefined);
  const [avatarTab, setAvatarTab] = useState<string>('initial');

  // PIN pad + lockout state
  const [pinPrompt, setPinPrompt] = useState<PinPromptState | null>(null);
  const [lockout, setLockout] = useState<PinLockoutState>({ wrongCount: 0, lockedUntilMs: 0 });
  const [cooldownSec, setCooldownSec] = useState(0);

  const avatarSets = useMemo(() => orderedAvatarSets(), []);
  const parentalLevels = useMemo(() => getParentalLevels(), []);
  const ageOptions = useMemo(
    () => parentalLevels.map((lvl) => ({ id: String(lvl.maxAge), label: lvl.label })),
    [parentalLevels],
  );

  useEffect(() => bindKeyboardFields(pageRef.current), [mode.kind]);

  useEffect(() => {
    void Promise.all([fetchProfiles(), fetchPlan()]).then(([nextReg, plan]) => {
      setRegistry(nextReg);
      setProfilesMax(Math.max(1, plan.profilesMax));
    });
  }, []);

  useEffect(() => {
    if (lockout.lockedUntilMs <= Date.now()) {
      setCooldownSec(0);
      return undefined;
    }
    const update = (): void => {
      const rem = remainingLockoutSeconds(lockout, Date.now());
      setCooldownSec(rem);
    };
    update();
    const timer = window.setInterval(update, 500);
    return () => window.clearInterval(timer);
  }, [lockout]);

  const finish = (): void => {
    if (next === 'library') {
      navigate.home();
      navigate.push('library');
      return;
    }
    if (next !== '') {
      const nextParams = params['nextParams'];
      navigate.replace(
        next,
        typeof nextParams === 'object' && nextParams !== null
          ? { params: nextParams as Record<string, unknown> }
          : undefined,
      );
      return;
    }
    navigate.pop();
  };

  const askPinForProfile = (profile: Profile, title: string, subtitle: string, onVerified: (pin: string) => Promise<void> | void): void => {
    setPinPrompt({
      title,
      subtitle,
      targetProfileId: profile.id,
      error: null,
      shakeKey: 0,
      onVerified,
    });
  };

  const handlePinPadSubmit = async (enteredPin: string): Promise<void> => {
    if (pinPrompt === null) return;
    if (remainingLockoutSeconds(lockout) > 0) return;
    setBusy(true);
    try {
      const check = await verifyProfilePin(pinPrompt.targetProfileId, enteredPin);
      if (!check.ok) {
        if (check.error === 'pin-cooldown' && check.retryAfter !== undefined) {
          setLockout({ wrongCount: 0, lockedUntilMs: Date.now() + check.retryAfter * 1000 });
        } else {
          setLockout((prev) => recordPinAttempt(prev, false));
        }
        setPinPrompt((prev) => (prev === null ? null : { ...prev, error: 'Wrong PIN. Try again.', shakeKey: prev.shakeKey + 1 }));
        return;
      }
      setLockout({ wrongCount: 0, lockedUntilMs: 0 });
      const callback = pinPrompt.onVerified;
      setPinPrompt(null);
      await callback(enteredPin);
    } catch (err) {
      if (err instanceof PinChallengeError) {
        if (err.code === 'pin-cooldown') {
          setLockout({ wrongCount: 0, lockedUntilMs: Date.now() + (err.retryAfter ?? 60) * 1000 });
        } else {
          setLockout((prev) => recordPinAttempt(prev, false));
        }
        setPinPrompt((prev) => (prev === null ? null : { ...prev, error: err.message, shakeKey: prev.shakeKey + 1 }));
      } else {
        setPinPrompt((prev) => (prev === null ? null : { ...prev, error: 'Could not verify PIN.', shakeKey: prev.shakeKey + 1 }));
      }
    } finally {
      setBusy(false);
    }
  };

  const open = async (profile: Profile): Promise<void> => {
    const enter = async (pin?: string): Promise<void> => {
      const egg = profileEaster(profile.name);
      if (egg !== null) setMessage(egg);
      await switchProfile(profile.id, pin);
      finish();
    };
    if (profile.locked === true) {
      askPinForProfile(profile, `Enter PIN for ${profile.name}`, 'Enter the 4-digit profile PIN to continue.', async (pin) => {
        await enter(pin);
      });
      return;
    }
    try {
      await enter();
    } catch (err) {
      if (err instanceof PinChallengeError) {
        askPinForProfile(profile, `Enter PIN for ${profile.name}`, err.message, async (pin) => {
          await enter(pin);
        });
      } else {
        setMessage(err instanceof Error ? err.message : 'The profile could not be switched.');
      }
    }
  };

  const startCreate = (): void => {
    setDraftName('');
    setDraftAvatar(null);
    setDraftKind('standard');
    setDraftMaxAge(18);
    setDraftPin(undefined);
    setAvatarTab(avatarSets[0]?.id ?? 'initial');
    setMessage(null);
    setMode({ kind: 'create' });
  };

  const startEdit = (profile: Profile): void => {
    const enterEdit = (verifiedPin?: string): void => {
      setDraftName(profile.name);
      setDraftAvatar(profile.avatar ?? null);
      setDraftKind(isKidsProfile(profile) ? 'kids' : 'standard');
      setDraftMaxAge(effectiveProfileMaxAge(profile));
      setDraftPin(undefined);
      const selectedSet = typeof profile.avatar === 'string' && profile.avatar.includes('/') ? profile.avatar.split('/')[0]! : (avatarSets[0]?.id ?? 'initial');
      setAvatarTab(selectedSet);
      setMessage(null);
      setMode({ kind: 'edit', profile, verifiedPin });
    };
    if (profile.locked === true) {
      askPinForProfile(profile, `Enter PIN for ${profile.name}`, 'Unlock this profile to edit or remove it.', async (pin) => {
        enterEdit(pin);
      });
      return;
    }
    enterEdit();
  };

  const toggleKidsMode = (): void => {
    if (draftKind === 'standard') {
      setDraftKind('kids');
      setDraftMaxAge(getKidsDefaultAge());
      return;
    }
    const lockedAdult = registry.profiles.find((p) => !isKidsProfile(p) && p.locked === true);
    if (lockedAdult !== undefined && (mode.kind !== 'edit' || mode.verifiedPin === undefined)) {
      askPinForProfile(
        lockedAdult,
        `Enter ${lockedAdult.name}'s PIN`,
        'Switching off Kids profile requires a locked adult profile PIN.',
        async () => {
          setDraftKind('standard');
          setDraftMaxAge(18);
        },
      );
      return;
    }
    setDraftKind('standard');
    setDraftMaxAge(18);
  };

  const saveEditor = async (): Promise<void> => {
    const cleanName = (fieldValue('profile-name') || draftName).trim();
    if (cleanName === '') {
      setMessage('Enter a profile name first.');
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      if (mode.kind === 'create') {
        const created = await createProfile({
          name: cleanName,
          avatar: draftAvatar,
          kind: draftKind,
          maxAge: draftMaxAge,
          ...(typeof draftPin === 'string' ? { pin: draftPin } : {}),
        });
        const egg = profileEaster(cleanName);
        setRegistry(created);
        setMode({ kind: 'chooser' });
        if (egg !== null) setMessage(egg);
      } else if (mode.kind === 'edit') {
        const updated = await updateProfile({
          id: mode.profile.id,
          name: cleanName,
          avatar: draftAvatar,
          kind: draftKind,
          maxAge: draftMaxAge,
          ...(draftPin !== undefined ? { pin: draftPin } : {}),
          ...(mode.verifiedPin !== undefined ? { currentPin: mode.verifiedPin } : {}),
        });
        setRegistry(updated);
        setMode({ kind: 'chooser' });
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The profile could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const deleteFromEditor = async (): Promise<void> => {
    if (mode.kind !== 'edit') return;
    setBusy(true);
    setMessage(null);
    try {
      const nextReg = await removeProfile(mode.profile.id, mode.verifiedPin);
      setRegistry(nextReg);
      setMode({ kind: 'chooser' });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The profile could not be removed.');
    } finally {
      setBusy(false);
    }
  };

  const activeAvatarSet = avatarSets.find((set) => set.id === avatarTab);
  const currentLocked = mode.kind === 'edit' ? (draftPin === undefined ? mode.profile.locked === true : draftPin !== null) : typeof draftPin === 'string';

  return (
    <main ref={pageRef} className="page page--profiles" data-keyboard-fields="">
      <header className="page__toolbar">
        <div className="page__toolbar-lead">
          <BackButton
            id="profiles-back"
            onSelect={() => {
              if (mode.kind !== 'chooser') setMode({ kind: 'chooser' });
              else finish();
            }}
          />
          <div>
            <p className="stage__kicker">TVM Stream</p>
            <h1 className="page__heading">
              {mode.kind === 'chooser' ? "Who's watching?" : mode.kind === 'create' ? 'New profile' : `Edit ${mode.profile.name}`}
            </h1>
          </div>
        </div>
      </header>

      {mode.kind === 'chooser' ? (
        <>
          <p className="page__lede">Profiles keep watch progress, age limits, and streaming services separate.</p>
          {message !== null && <p className="page__message">{message}</p>}
          <div className="profile-grid">
            {registry.profiles.map((profile, index) => (
              <div key={profile.id} className="profile-tile">
                <FocusButton
                  id={index === 0 ? 'profile-pick' : `profile-${profile.id}`}
                  className="profile-tile__pick"
                  onSelect={() => void open(profile)}
                >
                  <ProfileOrb
                    name={profile.name}
                    hue={profile.hue}
                    avatar={profile.avatar}
                    locked={profile.locked === true}
                    size="lg"
                  />
                  <span className="profile-tile__name">{profile.name}</span>
                  <span className="profile-tile__meta">
                    {isKidsProfile(profile) ? `Kids · ${ageLimitLabel(effectiveProfileMaxAge(profile))}` : ageLimitLabel(effectiveProfileMaxAge(profile))}
                  </span>
                </FocusButton>
                <div className="profile-tile__actions" data-wrap="row">
                  <FocusButton id={`edit-${profile.id}`} className="tvm-button--glass" onSelect={() => startEdit(profile)}>
                    Edit
                  </FocusButton>
                </div>
              </div>
            ))}
            {registry.profiles.length < profilesMax && (
              <FocusButton id="profile-add" className="profile-tile__pick" onSelect={startCreate}>
                <span className="profile-orb profile-orb--lg profile-orb--add">+</span>
                <span className="profile-tile__name">Add profile</span>
              </FocusButton>
            )}
          </div>
        </>
      ) : (
        <section className="profile-editor glass glass--sheet glass-appear" aria-label="Profile editor">
          {message !== null && <p className="page__message">{message}</p>}
          <div className="profile-editor__top">
            <ProfileOrb
              name={draftName || 'Profile'}
              hue={mode.kind === 'edit' ? mode.profile.hue : 215}
              avatar={draftAvatar}
              locked={currentLocked}
              size="lg"
            />
            <label className="token-field profile-editor__name">
              <span>Profile name</span>
              <FocusField
                id="profile-name"
                value={draftName}
                onChange={setDraftName}
                onConfirm={() => void saveEditor()}
                placeholder="Name"
              />
            </label>
          </div>

          <div className="profile-editor__block">
            <div className="profile-editor__block-head">
              <strong>Profile picture</strong>
              <span>Character avatar or colour + initial</span>
            </div>
            <div className="avatar-tabs" data-wrap="row" role="tablist" aria-label="Avatar sets">
              <FocusButton
                id="avatar-tab-initial"
                className={`tvm-button--glass avatar-tab${avatarTab === 'initial' ? ' glass--thumb' : ''}`}
                onSelect={() => {
                  setAvatarTab('initial');
                  setDraftAvatar(null);
                }}
              >
                Colour + initial
              </FocusButton>
              {avatarSets.map((set) => (
                <FocusButton
                  key={set.id}
                  id={`avatar-tab-${set.id}`}
                  className={`tvm-button--glass avatar-tab${avatarTab === set.id ? ' glass--thumb' : ''}`}
                  onSelect={() => setAvatarTab(set.id)}
                >
                  {set.title}
                </FocusButton>
              ))}
            </div>
            {activeAvatarSet !== undefined && (
              <div className="avatar-grid" data-wrap="grid">
                {activeAvatarSet.avatars.map((av) => {
                  const key = `${activeAvatarSet.id}/${av.id}`;
                  const selected = draftAvatar === key;
                  return (
                    <FocusButton
                      key={key}
                      id={`avatar-${activeAvatarSet.id}-${av.id}`}
                      className={`avatar-choice glass glass--card${selected ? ' avatar-choice--on' : ''}`}
                      onSelect={() => setDraftAvatar(key)}
                      title={av.actor ? `${av.name} (${av.actor})` : av.name}
                    >
                      <img src={av.image} alt={av.name} className="avatar-choice__img" loading="lazy" referrerPolicy="no-referrer" />
                      <span className="avatar-choice__name">{av.name}</span>
                    </FocusButton>
                  );
                })}
              </div>
            )}
          </div>

          <div className="profile-editor__row">
            <div>
              <strong>Kids profile</strong>
              <p className="page__lede">Defaults age limit to Up to 7 and hides Settings, Account and Downloads.</p>
            </div>
            <FocusButton
              id="profile-kids-toggle"
              className={`tvm-button--glass${draftKind === 'kids' ? ' glass--thumb' : ''}`}
              onSelect={toggleKidsMode}
            >
              {draftKind === 'kids' ? 'Kids: On' : 'Kids: Off'}
            </FocusButton>
          </div>

          <div className="profile-editor__row">
            <div>
              <strong>Age limit</strong>
              <p className="page__lede">Filters by genre</p>
            </div>
            <GlassSegmented
              idPrefix="profile-age"
              ariaLabel="Age limit"
              options={ageOptions}
              value={String(draftMaxAge)}
              onChange={(val) => setDraftMaxAge(Number(val) as AgeLimitValue)}
            />
          </div>

          <div className="profile-editor__row">
            <div>
              <strong>Profile PIN lock</strong>
              <p className="page__lede">Require a 4-digit PIN to open or edit this profile.</p>
            </div>
            <div className="hero__actions" data-wrap="row">
              <FocusButton
                id="profile-pin-set"
                className="tvm-button--glass"
                onSelect={() => {
                  setPinPrompt({
                    title: currentLocked ? 'Set new 4-digit PIN' : 'Set 4-digit PIN',
                    subtitle: 'Choose 4 digits for locking this profile.',
                    targetProfileId: mode.kind === 'edit' ? mode.profile.id : 'new',
                    error: null,
                    shakeKey: 0,
                    onVerified: (newPin) => {
                      setDraftPin(newPin);
                    },
                  });
                }}
              >
                {currentLocked ? 'Change PIN' : 'Set 4-digit PIN'}
              </FocusButton>
              {currentLocked && (
                <FocusButton id="profile-pin-remove" className="tvm-button--glass" onSelect={() => setDraftPin(null)}>
                  Remove PIN
                </FocusButton>
              )}
            </div>
          </div>

          <div className="hero__actions" data-wrap="row">
            <FocusButton id="profile-save" variant="primary" disabled={busy} onSelect={() => void saveEditor()}>
              {busy ? 'Saving…' : 'Save profile'}
            </FocusButton>
            <FocusButton id="profile-cancel" className="tvm-button--glass" onSelect={() => setMode({ kind: 'chooser' })}>
              Cancel
            </FocusButton>
            {mode.kind === 'edit' && registry.profiles.length > 1 && (
              <FocusButton id={`remove-${mode.profile.id}`} className="tvm-button--quiet" disabled={busy} onSelect={() => void deleteFromEditor()}>
                Remove profile
              </FocusButton>
            )}
          </div>
        </section>
      )}

      {pinPrompt !== null && (
        <PinPadModal
          title={pinPrompt.title}
          subtitle={pinPrompt.subtitle}
          busy={busy}
          error={pinPrompt.error}
          cooldownSeconds={cooldownSec}
          shakeKey={pinPrompt.shakeKey}
          onCancel={() => setPinPrompt(null)}
          onSubmit={(entered) => {
            if (pinPrompt.targetProfileId === 'new' || mode.kind !== 'chooser' && pinPrompt.title.includes('Set')) {
              void pinPrompt.onVerified(entered);
              setPinPrompt(null);
            } else {
              void handlePinPadSubmit(entered);
            }
          }}
        />
      )}
    </main>
  );
}
