import {isValidElement,type ReactElement} from 'react';
import {beforeEach,describe,expect,it,vi} from 'vitest';
const hooks=vi.hoisted(()=>({values:[] as unknown[],cursor:0}));
vi.mock('react',async original=>({...await original<typeof import('react')>(),useState:(initial:unknown)=>{
  const index=hooks.cursor++;if(!(index in hooks.values))hooks.values[index]=initial;
  return [hooks.values[index],(next:unknown)=>{hooks.values[index]=typeof next==='function'?next(hooks.values[index]):next;}];
}}));
vi.mock('react-native',()=>({Pressable:'Pressable',Text:'Text',View:'View',Switch:'Switch',StyleSheet:{create:(value:unknown)=>value}}));
vi.mock('@/components/deck/commander-art',()=>({CommanderArt:'Art'}));
vi.mock('@/components/ui/button',()=>({Button:'Button'}));
vi.mock('@/components/ui/input',()=>({Input:'Input'}));
import {TableGuestsSection} from '@/components/table/table-guests-section';
import {ArenaSeasonSettings} from '@/components/table/arena-season-settings';
type Node=ReactElement<Record<string,any>>;
function nodes(value:unknown):Node[]{
  if(Array.isArray(value))return value.flatMap(nodes);
  if(!isValidElement(value))return [];
  const node=value as Node;return [node,...nodes(node.props.children)];
}
beforeEach(()=>{hooks.values=[];hooks.cursor=0;});
describe('compact season selector',()=>{
  it.each(['en-US','it-IT'])('opens inline and selects every numbered month in %s',locale=>{
    const change=vi.fn();let resetMonth=1;
    const render=()=>{hooks.cursor=0;return nodes(ArenaSeasonSettings({enabled:true,resetMonth,locale,labels:{enabled:'Seasons',enabledHint:'',startMonth:'Month',resetHint:''},onEnabledChange:vi.fn(),onResetMonthChange:change}));};
    expect(render().filter(node=>node.props.accessibilityRole==='radio')).toHaveLength(0);
    for(let month=1;month<=12;month++){
      render().find(node=>node.props.accessibilityState?.expanded===false)!.props.onPress();
      const options=render().filter(node=>node.props.accessibilityRole==='radio');expect(options).toHaveLength(12);
      options[month-1].props.onPress();expect(change).toHaveBeenLastCalledWith(month);resetMonth=month;
      expect(render().filter(node=>node.props.accessibilityRole==='radio')).toHaveLength(0);
    }
    expect(render().some(node=>String(node.type).includes('Modal'))).toBe(false);
  });
});
describe('guest manager',()=>{
  function fixture(canManage=true){
    const guest={id:'guest',group_id:'group',display_name:'José',last_played_at:null,arena_guest_decks:[{id:'deck',guest_id:'guest',group_id:'group',name:'Ramp',commander:'Selvala',commander_image:null,color_identity:null,bracket:null}]};
    const callbacks={onAddGuest:vi.fn(),onAddDeckToGuest:vi.fn(),onDeleteGuest:vi.fn(),onUpgradeGuest:vi.fn()};
    const render=()=>{hooks.cursor=0;return nodes(TableGuestsSection({guests:[guest],language:'en',canManage,labels:{guestManagement:'Guests',addGuest:'Add',noGuestsBody:'Empty',guestBadge:'Guest',upgradeGuest:'Link',addDeckToGuest:'Add deck',deleteGuest:'Delete'},...callbacks}));};
    return {render,...callbacks};
  }
  it('finds a commander, expands its owner and targets each action correctly',()=>{
    const f=fixture();expect(f.render().filter(node=>node.type==='Art')).toHaveLength(0);
    f.render().find(node=>node.type==='Input')!.props.onChangeText('selvala');
    expect(f.render().filter(node=>node.type==='Art')).toHaveLength(1);
    for(const [label,callback] of [['Add deck: José',f.onAddDeckToGuest],['Delete: José',f.onDeleteGuest],['Link: José',f.onUpgradeGuest]] as const){
      f.render().find(node=>node.props.label===label)!.props.onPress();expect(callback).toHaveBeenCalledWith('guest');
    }
    f.render().find(node=>node.type==='Input')!.props.onChangeText('missing');
    expect(f.render().filter(node=>node.type==='Art')).toHaveLength(0);
    f.render().find(node=>node.props.label==='Clear search')!.props.onPress();
    expect(f.render().find(node=>node.type==='Input')!.props.value).toBe('');
  });
  it('keeps mutation commands hidden from readers',()=>{
    const f=fixture(false);expect(f.render().filter(node=>node.type==='Button')).toHaveLength(0);
    f.render().find(node=>node.props.accessibilityState?.expanded===false)!.props.onPress();
    expect(f.render().filter(node=>node.type==='Art')).toHaveLength(1);
  });
});
