'use client';
import {Button} from '@/components/ui/button';
import {useLanguage} from '@/components/language-provider';

type Props={loading:boolean;error:string|null;total:number|null;from:number;to:number;canGoNext:boolean;canGoPrevious:boolean;
  onNext:()=>unknown;onPrevious:()=>unknown;onRetry:()=>unknown};
export function ArenaHistoryPagination({loading,error,total,from,to,canGoNext,canGoPrevious,onNext,onPrevious,onRetry}:Props) {
  const {copy:t}=useLanguage();
  return <div className="mb-4 space-y-3" aria-busy={loading}>
    {error?<div role="alert" className="rounded-xl border border-amber-400/30 bg-amber-500/5 p-3 text-sm">
      <p>{error==='ARENA_HISTORY_CHANGED'?t({it:'Lo storico è cambiato. Ricarica per continuare.',en:'History changed. Reload to continue.'})
        :error==='ARENA_HISTORY_FORBIDDEN'?t({it:'Non hai più accesso a questo storico.',en:'You no longer have access to this history.'})
        :t({it:'Storico non disponibile. I dati precedenti, se presenti, non sono aggiornati.',en:'History unavailable. Any previous results are not current.'})}</p>
      <Button variant="outline" size="sm" onClick={()=>void onRetry()} disabled={loading} className="mt-2">{t({it:'Riprova',en:'Retry'})}</Button>
    </div>:null}
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
      <p role="status" aria-live="polite">{loading?t({it:'Caricamento storico…',en:'Loading history…'}):total!==null
        ?t({it:`Partite ${from}–${to} di ${total}`,en:`Matches ${from}–${to} of ${total}`}):'—'}</p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={loading||!canGoPrevious||error==='ARENA_HISTORY_CHANGED'} onClick={()=>void onPrevious()}>{t({it:'Precedenti',en:'Previous'})}</Button>
        <Button variant="outline" size="sm" disabled={loading||!canGoNext||error==='ARENA_HISTORY_CHANGED'} onClick={()=>void onNext()}>{t({it:'Successive',en:'Next'})}</Button>
      </div>
    </div>
  </div>;
}
