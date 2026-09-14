import { describe, expect, it } from 'vitest';
import { checkoutPack, checkoutQuote, FALLBACK_PLAN, themeUnlocked } from './plan';
describe('paid theme checkout', () => {
  it('routes each SKU independently and never substitutes Retro', () => {
    expect(checkoutPack('anime')).toBe('anime'); expect(checkoutPack('theme-bundle')).toBe('theme-bundle'); expect(checkoutPack('synthwave')).toBe('synthwave'); expect(checkoutPack('other')).toBeUndefined();
    const plan = {...FALLBACK_PLAN, catalog: [{id:'free' as const,name:'Free',price:'Free',pricePence:0,basePricePence:0,mocks:false,liveTv:false,extras:[]}]};
    expect(checkoutQuote(plan,'free',false,false,true,'anime').oneTimePence).toBe(499);
    expect(checkoutQuote(plan,'free',false,false,true,'theme-bundle').oneTimePence).toBe(999);
    expect(checkoutQuote({...plan,bundleOwned:true},'free',false,false,true,'anime').oneTimePence).toBe(0);
  });
  it('keeps free packs available and requires the matching entitlement or bundle', () => {
    expect(themeUnlocked(FALLBACK_PLAN,'light')).toBe(true);
    expect(themeUnlocked({...FALLBACK_PLAN,synthwave:true},'anime')).toBe(false);
    expect(themeUnlocked({...FALLBACK_PLAN,anime:true},'synthwave')).toBe(false);
    for(const id of ['anime','synthwave']) { expect(themeUnlocked({...FALLBACK_PLAN,bundle:true},id)).toBe(true); expect(themeUnlocked({...FALLBACK_PLAN,developer:true},id)).toBe(true); }
  });
});
