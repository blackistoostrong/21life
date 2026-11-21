import {describe,expect,it} from 'vitest';
import {searchGuestDirectory} from '@/packages/domain/guest-directory';
const guests=[{id:'a',display_name:'José Rossi',arena_guest_decks:[{id:'1',name:'Blue control',commander:'Talrand'},{id:'2',name:'Green ramp',commander:'Selvala'}]},
  {id:'b',display_name:'Anna',arena_guest_decks:[]}];
describe('guest directory search',()=>{
  it('retains all owners and decks for an empty search without changing the catalog',()=>{
    const before=structuredClone(guests);
    expect(searchGuestDirectory(guests,'  ').map(row=>row.guest.id)).toEqual(['a','b']);
    expect(guests).toEqual(before);
  });
  it('matches names across accents, case and multiple terms',()=>{
    const [row]=searchGuestDirectory(guests,'JOSE rossi');
    expect(row.guest.id).toBe('a');expect(row.decks).toHaveLength(2);expect(row.searching).toBe(true);
  });
  it('finds a deck or commander while keeping its owner and hiding unrelated decks',()=>{
    const [row]=searchGuestDirectory(guests,'rossi TALRAND');
    expect(row.guest.id).toBe('a');expect(row.decks.map(deck=>deck.name)).toEqual(['Blue control']);
    expect(searchGuestDirectory(guests,'green')[0].decks.map(deck=>deck.name)).toEqual(['Green ramp']);
    expect(searchGuestDirectory(guests,'anna selvala')).toEqual([]);
  });
  it('retains a matching guest without decks and reports no matches honestly',()=>{
    expect(searchGuestDirectory(guests,'anna')[0].decks).toEqual([]);
    expect(searchGuestDirectory([{display_name:'No catalog'}],'catalog')[0].decks).toEqual([]);
    expect(searchGuestDirectory(guests,'missing')).toEqual([]);
  });
});
