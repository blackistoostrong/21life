import {ActivityIndicator,Text,View} from 'react-native';
import {Button} from '@/components/ui/button';
import {colors} from '@/constants/theme';
type Props={loaded:number;total:number|null;loading:boolean;error:string|null;cached:boolean;language:'it'|'en';onRetry:()=>unknown};
export function ArenaHistoryStatus({loaded,total,loading,error,cached,language,onRetry}:Props){
  const it=language==='it';
  return <View style={{gap:10}}>
    {loading?<ActivityIndicator accessibilityLabel={it?'Caricamento storico':'Loading history'} color={colors.primaryMuted}/>:null}
    <Text accessibilityLiveRegion="polite" style={{color:colors.muted}}>{total===null
      ?(it?`${loaded} partite disponibili sul dispositivo · totale non verificato`:`${loaded} matches on device · total unverified`)
      :(it?`${loaded} di ${total} partite caricate · tutto il periodo`:`${loaded} of ${total} matches loaded · all time`)}</Text>
    {cached?<Text style={{color:colors.muted}}>{it?'Copia salvata: aggiornamento da verificare.':'Saved copy: freshness unverified.'}</Text>:null}
    {error?<Text accessibilityRole="alert" style={{color:colors.destructive}}>{error==='ARENA_HISTORY_CHANGED'
      ?(it?'Storico modificato. Ricarica dalla prima pagina.':'History changed. Reload from the first page.')
      :(it?'Storico non disponibile. I dati precedenti non sono aggiornati.':'History unavailable. Previous data is not current.')}</Text>:null}
    {error || cached?<Button label={it?'Riprova':'Retry'} variant="outline" disabled={loading} onPress={()=>void onRetry()}/>:null}
  </View>;
}
