import { afterEach,describe,expect,it,vi } from 'vitest';
import { buildProfileCatalogMetric,parseProfileCatalogMetrics } from '@/packages/domain/profile-catalog-metrics';
import { buildWebProfileMetricMaps } from '@/lib/profile-catalog-metrics';
import { fetchProfileCatalogMetrics } from '@/lib/profile-catalog-query';
import { profileCatalogFixture } from '../fixtures/profile-catalog';

describe('complete profile metrics',()=>{
  afterEach(()=>vi.useRealTimers());
  it('keeps neutral draws, tracking sample and award facts in shared math',()=>{
    const report=parseProfileCatalogMetrics(profileCatalogFixture());
    expect(buildProfileCatalogMetric(report.decks[0])).toMatchObject({ winRate:50,losses:1,decisiveGames:2,
      trackingCoverage:67,averageDamageDealt:16,comebackWins:1,comboWins:1,firstEliminations:1,masteryPoints:5 });
    const maps=buildWebProfileMetricMaps(report,[{ id:'deck-1',name:'Snapshot',commander:'Commander',commander_image:null,bracket:'3' }]);
    expect(maps.performance.get('deck-1')).toMatchObject({ name:'Snapshot',totalDamageDealt:31,groupDamageDealt:7 });
    expect(()=>buildWebProfileMetricMaps(report,[{ id:'changed',name:'x',commander:'x',commander_image:null,bracket:null }])).toThrow('ANALYTICS_CATALOG_CHANGED');
  });
  it.each(['version','scope','user','negative','fraction','missing','first elimination','comeback','conditions','mastery'])('rejects invalid %s',type=>{
    const input=profileCatalogFixture();const row=input.decks[0];
    if(type==='version') input.metricFieldsVersion=2;
    if(type==='scope') input.scope='group';
    if(type==='user') input.userId='';
    if(type==='negative') row.group_damage_dealt=-1;
    if(type==='fraction') row.group_damage_events=1.5;
    if(type==='missing') Reflect.deleteProperty(row,'combo_wins');
    if(type==='first elimination') row.first_eliminations=4;
    if(type==='comeback') row.comeback_wins=2;
    if(type==='conditions') row.alternate_wins=1;
    if(type==='mastery') row.mastery_points=0;
    expect(()=>parseProfileCatalogMetrics(input)).toThrow('ANALYTICS_CONTRACT_INVALID');
  });
  it('handles explicit empty and entirely untracked samples',()=>{
    const input=profileCatalogFixture();Object.assign(input.decks[0],{ games_played:0,wins:0,draws:0,mastery_points:0,tracked_games:0,second_places:0,
      first_eliminations:0,comeback_wins:0,combo_wins:0,alternate_wins:0 });
    expect(buildProfileCatalogMetric(parseProfileCatalogMetrics(input).decks[0])).toMatchObject({ winRate:0,trackingCoverage:0,averageDamageDealt:0 });
    expect(parseProfileCatalogMetrics({ ...input,decks:[],total:0 }).decks).toEqual([]);
  });
  it('checks scope and account on transport, with no old endpoint fallback',async()=>{
    const rpc=vi.fn(()=>({ abortSignal:async()=>({ data:profileCatalogFixture(),error:null }) }));
    expect((await fetchProfileCatalogMetrics({rpc},'self')).total).toBe(1);
    await expect(fetchProfileCatalogMetrics({rpc},'other')).rejects.toThrow('ANALYTICS_CONTRACT_INVALID');
    await expect(fetchProfileCatalogMetrics({rpc},null)).rejects.toThrow('ANALYTICS_CONTRACT_INVALID');
    await expect(fetchProfileCatalogMetrics({rpc},'')).rejects.toThrow('ANALYTICS_USER_REQUIRED');
    expect(rpc).toHaveBeenNthCalledWith(1,'get_profile_deck_performance_v2',{p_user_id:'self'});
  });
  it('supports global service reports and sanitizes database failures',async()=>{
    const rpc=vi.fn(()=>({ abortSignal:async()=>({data:{...profileCatalogFixture(),scope:'global',userId:null},error:null}) }));
    expect((await fetchProfileCatalogMetrics({rpc},null)).scope).toBe('global');
    const broken={rpc:vi.fn(()=>({abortSignal:async()=>({data:null,error:{message:'secret'}})}))};
    await expect(fetchProfileCatalogMetrics(broken,'self')).rejects.toThrow('ANALYTICS_UNAVAILABLE');expect(broken.rpc).toHaveBeenCalledOnce();
  });
  it('bounds stalled profile requests and propagates cancellation',async()=>{
    vi.useFakeTimers();let signal:AbortSignal|undefined;
    const rpc=vi.fn(()=>({abortSignal:(value:AbortSignal)=>{signal=value;return new Promise<never>(()=>{});}}));
    const result=expect(fetchProfileCatalogMetrics({rpc},'self')).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(15000);await result;expect(signal?.aborted).toBe(true);
    const controller=new AbortController();controller.abort();
    await expect(fetchProfileCatalogMetrics({rpc},'self',controller.signal)).rejects.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  });
});
