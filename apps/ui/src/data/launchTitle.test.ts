import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Title } from './catalog';
import type { Navigate } from '../nav/ViewStackContext';
import type { RdStatus } from './media';
import type { PlanStatus } from './plan';
import type { ProfileRegistry } from './profiles';

const fetchProfiles = vi.hoisted(() => vi.fn());
const fetchPlan = vi.hoisted(() => vi.fn());
const applyPlanClass = vi.hoisted(() => vi.fn());
const fetchRdStatus = vi.hoisted(() => vi.fn());

vi.mock('./profiles', () => ({ fetchProfiles }));
vi.mock('./plan', () => ({ fetchPlan, applyPlanClass }));
vi.mock('./media', () => ({ fetchRdStatus }));

import { launchTitle, RD_NOTICE, runLaunchChecks } from './launchTitle';

const movie: Title = {
  id: 'tt0816692',
  title: 'Dune',
  year: 2021,
  kind: 'movie',
  synopsis: '',
  poster: '',
  backdrop: '',
  genres: ['Science Fiction'],
  rating: '8.4',
  playable: true,
  hue: 32,
};

const series: Title = { ...movie, id: 'tt0944947', title: 'Game of Thrones', kind: 'series' };

const PLAN = { id: 'premium' } as PlanStatus;
const PROFILE: ProfileRegistry = {
  activeId: 'p1',
  profiles: [{ id: 'p1', name: 'Alex', hue: 200, created: '2024-01-01' }],
};
const RD_OK: RdStatus = { configured: true, username: 'alex', premium: true, error: null };
const RD_MISSING: RdStatus = { configured: false, username: null, premium: false, error: null };

interface NavCall {
  op: string;
  name?: string;
  params?: Record<string, unknown>;
}

function fakeNavigate(): { navigate: Navigate; calls: NavCall[] } {
  const calls: NavCall[] = [];
  const navigate: Navigate = {
    home: () => {
      calls.push({ op: 'home' });
    },
    push: (name, options) => {
      calls.push({ op: 'push', name, params: options?.params });
    },
    pushModal: (name, options) => {
      calls.push({ op: 'pushModal', name, params: options?.params });
    },
    replace: (name, options) => {
      calls.push({ op: 'replace', name, params: options?.params });
    },
    pop: () => {
      calls.push({ op: 'pop' });
    },
    reset: (name, options) => {
      calls.push({ op: 'reset', name, params: options?.params });
    },
  };
  return { navigate, calls };
}

beforeEach(() => {
  fetchProfiles.mockReset();
  fetchPlan.mockReset();
  applyPlanClass.mockReset();
  fetchRdStatus.mockReset();
  fetchProfiles.mockResolvedValue(PROFILE);
  fetchPlan.mockResolvedValue(PLAN);
  fetchRdStatus.mockResolvedValue(RD_OK);
});

describe('runLaunchChecks', () => {
  it('applies the plan when it loads and swallows a plan failure', async () => {
    await expect(runLaunchChecks()).resolves.toEqual({
      profileActive: true,
      plan: PLAN,
      rd: RD_OK,
    });
    expect(applyPlanClass).toHaveBeenCalledWith(PLAN);

    fetchPlan.mockRejectedValueOnce(new Error('plan down'));
    applyPlanClass.mockClear();
    await expect(runLaunchChecks()).resolves.toEqual({
      profileActive: true,
      plan: null,
      rd: RD_OK,
    });
    expect(applyPlanClass).not.toHaveBeenCalled();
  });
});

describe('launchTitle', () => {
  it('sends a viewer without a profile to Who\'s watching, then that title', async () => {
    fetchProfiles.mockResolvedValue({ activeId: '', profiles: [] });
    const { navigate, calls } = fakeNavigate();
    await launchTitle(navigate, movie);
    expect(calls).toEqual([
      { op: 'home' },
      {
        op: 'push',
        name: 'profiles',
        params: {
          next: 'details',
          nextParams: expect.objectContaining({ id: movie.id, kind: 'movie', title: movie.title }),
        },
      },
    ]);
    expect(calls.some((call) => call.name === 'player')).toBe(false);
  });

  it('opens the title on details when profile and Real-Debrid are ready', async () => {
    const { navigate, calls } = fakeNavigate();
    await launchTitle(navigate, movie);
    expect(calls).toEqual([
      { op: 'home' },
      {
        op: 'push',
        name: 'details',
        params: expect.objectContaining({ id: movie.id, kind: 'movie', title: movie.title }),
      },
    ]);
    expect(calls.some((call) => call.name === 'player' || call.op === 'pushModal')).toBe(false);
  });

  it('still lands on details when Real-Debrid is missing, with a notice on top', async () => {
    fetchRdStatus.mockResolvedValue(RD_MISSING);
    const { navigate, calls } = fakeNavigate();
    await launchTitle(navigate, series);
    expect(calls).toEqual([
      { op: 'home' },
      {
        op: 'push',
        name: 'details',
        params: expect.objectContaining({ id: series.id, kind: 'series', title: series.title }),
      },
      { op: 'pushModal', name: 'notice', params: { ...RD_NOTICE } },
    ]);
    expect(calls.some((call) => call.name === 'player')).toBe(false);
  });

  it('still opens the title when the plan fetch fails', async () => {
    fetchPlan.mockRejectedValue(new Error('plan down'));
    const { navigate, calls } = fakeNavigate();
    await launchTitle(navigate, movie);
    expect(applyPlanClass).not.toHaveBeenCalled();
    expect(calls).toEqual([
      { op: 'home' },
      {
        op: 'push',
        name: 'details',
        params: expect.objectContaining({ id: movie.id, kind: 'movie' }),
      },
    ]);
  });
});
