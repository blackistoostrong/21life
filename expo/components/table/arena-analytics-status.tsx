import type {ReactNode} from 'react';
import {ActivityIndicator,Text,View} from 'react-native';
import {Button} from '@/components/ui/button';
import {colors} from '@/constants/theme';
export function ArenaAnalyticsStatus({loading,error,language,onRetry,children}:{loading:boolean;error:boolean;language:'it'|'en';onRetry:()=>unknown;children:ReactNode}){
 if(error)return <View style={{gap:12}}><Text accessibilityRole="alert" style={{color:colors.destructive}}>{language==='it'?'Statistiche non disponibili. Riprova.':'Statistics unavailable. Retry.'}</Text><Button label={language==='it'?'Riprova':'Retry'} onPress={()=>void onRetry()}/></View>;
 if(loading)return <ActivityIndicator accessibilityLabel={language==='it'?'Caricamento statistiche':'Loading statistics'} color={colors.primaryMuted}/>;
 return <>{children}</>;
}
