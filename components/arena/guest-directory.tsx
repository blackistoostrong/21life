'use client';
import {useId, useState} from 'react';
import {useLanguage} from '@/components/language-provider';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {DeckImage} from '@/components/deck-image';
import type {ArenaGuest, ArenaGuestDeck} from '@/lib/arena-participants';
import {searchGuestDirectory} from '@/packages/domain/guest-directory';

type Props={guests:ArenaGuest[];deletingIds:string[];onAdd:()=>void;
  onAddDeck:(guest:ArenaGuest)=>void;onDelete:(guest:ArenaGuest)=>void};
/** Presentation owns search and disclosure only; authorized commands belong to its caller. */
export function GuestDirectory({guests,deletingIds,onAdd,onAddDeck,onDelete}:Props) {
  const {copy:t}=useLanguage();
  const searchId=useId();
  const [query,setQuery]=useState('');
  const [expanded,setExpanded]=useState<string[]>([]);
  const rows=searchGuestDirectory<ArenaGuestDeck,ArenaGuest>(guests,query);
  return <div className="space-y-4">
    <Button type="button" variant="outline" className="min-h-11" onClick={onAdd}>{t({it:'Aggiungi guest',en:'Add guest'})}</Button>
    {guests.length ? <div className="space-y-2">
      <label htmlFor={searchId} className="text-sm font-medium">{t({it:'Cerca guest, mazzo o comandante',en:'Search guest, deck or commander'})}</label>
      <div className="flex flex-wrap gap-2"><Input id={searchId} value={query} onChange={event=>setQuery(event.target.value)} className="min-h-11 min-w-0 flex-1" />
        {query ? <Button type="button" variant="ghost" className="min-h-11" onClick={()=>setQuery('')}>{t({it:'Azzera ricerca',en:'Clear search'})}</Button>:null}</div>
      <p role="status" className="text-sm text-muted-foreground">{rows.length} / {guests.length} guest</p>
    </div>:<p className="text-sm text-muted-foreground">{t({it:'Nessun guest registrato in questo playgroup.',en:'No guests registered in this playgroup.'})}</p>}
    {guests.length>0 && !rows.length ? <p className="text-sm text-muted-foreground">{t({it:'Nessun risultato. Prova un altro nome.',en:'No results. Try another name.'})}</p>:null}
    {rows.map(({guest,decks,searching})=>{
      const open=searching || expanded.includes(guest.id);
      const count=guest.arena_guest_decks?.length??0;
      const detailsId=`${searchId}-${guest.id}`;
      return <section key={guest.id} className="space-y-3 rounded-xl border border-border bg-secondary/20 p-4" aria-label={guest.display_name}>
        <div><h4 className="break-words font-semibold text-foreground">{guest.display_name}</h4>
          <p className="text-sm text-muted-foreground">{count} {t({it:'mazzi',en:'decks'})}</p></div>
        <Button type="button" variant="ghost" className="min-h-11 whitespace-normal text-left" aria-expanded={open} aria-controls={detailsId}
          disabled={searching} onClick={()=>setExpanded(ids=>ids.includes(guest.id)?ids.filter(id=>id!==guest.id):[...ids,guest.id])}>
          {t({it:open?'Nascondi mazzi':'Mostra mazzi',en:open?'Hide decks':'Show decks'})}: {guest.display_name}
        </Button>
        {open ? <div id={detailsId} className="space-y-3">
          {!decks.length ? <p className="text-sm text-muted-foreground">{t({it:'Nessun mazzo registrato.',en:'No decks yet.'})}</p>:null}
          {decks.map(deck=><div key={deck.id} className="flex items-center gap-3">
            <DeckImage src={deck.commander_image} alt={deck.commander} className="h-12 w-12 shrink-0 rounded-lg object-cover" />
            <div className="min-w-0"><p className="break-words text-sm font-medium">{deck.name}</p><p className="break-words text-sm text-muted-foreground">{deck.commander}</p></div>
          </div>)}
        </div>:null}
        <div className="flex flex-wrap gap-2 border-t border-border pt-3">
          <Button type="button" variant="outline" className="min-h-11 h-auto whitespace-normal" disabled={deletingIds.includes(guest.id)} onClick={()=>onAddDeck(guest)} aria-label={`${t({it:'Aggiungi mazzo',en:'Add deck'})}: ${guest.display_name}`}>{t({it:'Aggiungi mazzo',en:'Add deck'})}</Button>
          <Button type="button" variant="ghost" className="min-h-11 h-auto whitespace-normal text-destructive" disabled={deletingIds.includes(guest.id)} onClick={()=>onDelete(guest)} aria-label={`${t({it:'Elimina guest',en:'Delete guest'})}: ${guest.display_name}`}>{deletingIds.includes(guest.id)?t({it:'Eliminazione…',en:'Deleting…'}):t({it:'Elimina guest',en:'Delete guest'})}</Button>
        </div>
      </section>;
    })}
  </div>;
}
