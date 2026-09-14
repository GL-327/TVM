import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createPlanService } from './plans.ts';
import { finishedTitles, isFinished, ratio, writeProgress, readProgress } from './progress.ts';
import { adaptedForYou } from './recommend.ts';
import type { MediaItem } from './types.ts';
describe('Anime entitlements and completion', () => {
  it('persists standalone and bundle ownership across restarts and cancellation', () => {
    const dir = mkdtempSync(join(tmpdir(),'tvm-anime-'));
    try {
      let service = createPlanService({dataDir:dir});
      const buy = (pack: 'anime'|'synthwave'|'theme-bundle', quote: number) => service.checkout({planId:'free',pack,packOnly:true,consent:true,requestId:crypto.randomUUID(),quotedOneTimePence:quote});
      expect(buy('synthwave',499).synthwaveOwned).toBe(true);
      expect(buy('anime',499).animeOwned).toBe(true);
      service = createPlanService({dataDir:dir});
      expect(service.status()).toMatchObject({anime:true,synthwave:true,bundle:false});
      expect(buy('theme-bundle',999)).toMatchObject({bundle:true,bundleOwned:true,animeOwned:true,synthwaveOwned:true});
      service.cancel({consent:true,requestId:crypto.randomUUID()});
      service = createPlanService({dataDir:dir});
      expect(service.status()).toMatchObject({id:'free',bundle:true,anime:true,synthwave:true});
      expect(buy('anime',0).animeOwned).toBe(true);
    } finally { rmSync(dir,{recursive:true,force:true}); }
  });
  it('rejects stale totals and keeps declines from granting packs', () => {
    const dir = mkdtempSync(join(tmpdir(),'tvm-anime-'));
    try {
      const service = createPlanService({dataDir:dir});
      expect(()=>service.checkout({planId:'free',pack:'anime',consent:true,requestId:crypto.randomUUID(),quotedOneTimePence:0})).toThrow();
      expect(()=>service.checkout({planId:'free',pack:'theme-bundle',consent:true,requestId:crypto.randomUUID(),simulate:'decline'})).toThrow();
      expect(service.status()).toMatchObject({anime:false,bundle:false,synthwave:false});
    } finally { rmSync(dir,{recursive:true,force:true}); }
  });
  it('distinguishes glance, continue, boundary and finish; deduplicates completion ticks', () => {
    expect(isFinished(undefined)).toBe(false);
    expect(isFinished({position:10,duration:3600})).toBe(false);
    expect(isFinished({position:96,duration:100})).toBe(false);
    expect(isFinished({position:97,duration:100})).toBe(true);
    expect(isFinished({position:Infinity,duration:100})).toBe(false);
    expect(ratio({position:97,duration:100,updated:''})).toBeUndefined();
    expect(ratio({position:50,duration:100,updated:''})).toBe(.5);
    const dir = mkdtempSync(join(tmpdir(),'tvm-finish-'));
    try {
      writeProgress(dir,'a',97,100); writeProgress(dir,'a',99,100);
      expect(readProgress(dir).a?.completions).toBe(1);
      writeProgress(dir,'a',1,100); expect(readProgress(dir).a?.completedAt).toBeTruthy();
      writeProgress(dir,'a',98,100); expect(readProgress(dir).a?.completions).toBe(2);
      writeProgress(dir,'glance',10,100);
      expect(finishedTitles(dir,[{id:'a',title:'Completed film',year:2025},{id:'glance',title:'Never finished',year:2020}],readProgress(dir))).toEqual([{id:'a',title:'Completed film',year:2025}]);
      expect(finishedTitles(dir,[],readProgress(dir))).toEqual([{id:'a',title:'Completed film',year:2025}]);
      writeProgress(dir,'show:1:2',98,100);
      expect(finishedTitles(dir,[{id:'show',title:'A series',year:2024}],readProgress(dir))).toContainEqual({id:'show:1:2',title:'A series · episode 1:2',year:2024});
    } finally { rmSync(dir,{recursive:true,force:true}); }
  });
  it('reranks the recommended window after two finishes', () => {
    const pool = Array.from({length:20},(_,i)=>({id:String(i),title:`Film ${i}`,genres:[i%2?'Drama':'Action'],year:2020,rating:'7'} as MediaItem));
    const first = adaptedForYou(pool,[pool[0]!],1);
    const second = adaptedForYou(pool,[pool[0]!,pool[1]!],2);
    expect(first.map(i=>i.id)).not.toEqual(second.map(i=>i.id));
    expect(first.map(i=>i.id)).not.toEqual(adaptedForYou(pool,[pool[0]!],2).map(i=>i.id));
    expect(second.some(i=>i.id==='0'||i.id==='1')).toBe(false);
  });
});
