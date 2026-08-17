import { describe, expect, it } from 'vitest';
import {
  applyPlanClass,
  FALLBACK_PLAN,
  mockAppLocked,
  STYLE_CATALOG,
  styleMinPlanLabel,
  styleUnlocked,
  visibleMockApps,
  type PlanStatus,
} from './plan';

describe('plan helpers', () => {
  it('hides mock playback unless the plan allows them', () => {
    expect(visibleMockApps(false, 'netflix', true)).toBe(false);
    expect(visibleMockApps(true, 'netflix', true)).toBe(true);
    expect(visibleMockApps(false, 'youtube', false)).toBe(true);
  });

  it('locks mock tiles on Free, Basic and Premium', () => {
    expect(mockAppLocked(false, true)).toBe(true);
    expect(mockAppLocked(true, true)).toBe(false);
    expect(mockAppLocked(false, false)).toBe(false);
  });

  it('lists styles with the plan that unlocks them', () => {
    expect(STYLE_CATALOG.find((style) => style.id === 'cinema')?.minPlan).toBe('premium');
    expect(STYLE_CATALOG.find((style) => style.id === 'ember')?.minPlan).toBe('ultra');
    expect(STYLE_CATALOG.find((style) => style.id === 'gold')?.minPlan).toBe('max');
    expect(styleMinPlanLabel('max')).toBe('TVM MAX');
    expect(styleUnlocked(FALLBACK_PLAN, 'cinema')).toBe(false);
    expect(styleUnlocked({ ...FALLBACK_PLAN, styleIds: ['cinema'] }, 'cinema')).toBe(true);
    expect(styleUnlocked({ ...FALLBACK_PLAN, developer: true }, 'gold')).toBe(true);
  });

  it('applies plan and style to the document', () => {
    const plan: PlanStatus = { ...FALLBACK_PLAN, id: 'ultra', styleId: 'ember', styleIds: ['classic', 'ember'] };
    const root = { dataset: {} as Record<string, string> };
    (globalThis as { document?: { documentElement: { dataset: Record<string, string> } } }).document = {
      documentElement: root,
    };
    applyPlanClass(plan);
    expect(root.dataset.plan).toBe('ultra');
    expect(root.dataset.style).toBe('ember');
  });
});
