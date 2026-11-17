'use client';
import type {ReactNode} from 'react';
import {Button} from '@/components/ui/button';
import {useLanguage} from '@/components/language-provider';
export function ArenaDataStatus({loading,error,onRetry,children}:{loading:boolean;error:boolean;onRetry:()=>unknown;children:ReactNode}) {
  const {copy:t}=useLanguage();
  if(error)return <div role="alert" className="my-4 rounded-xl border border-amber-400/30 p-4">
    <p>{t({it:'Statistiche non disponibili. Nessun risultato parziale viene presentato come completo.',en:'Statistics unavailable. Partial results are not presented as complete.'})}</p>
    <Button variant="outline" size="sm" className="mt-2" onClick={()=>void onRetry()}>{t({it:'Riprova',en:'Retry'})}</Button>
  </div>;
  if(loading)return <p role="status" aria-live="polite" className="p-4 text-sm text-muted-foreground">{t({it:'Caricamento dati…',en:'Loading data…'})}</p>;
  return <>{children}</>;
}
