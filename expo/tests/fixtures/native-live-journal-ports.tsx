import {createContext,useContext} from 'react';

export function navigation(focused=false){
  const listeners={focus:new Set<()=>void>(),blur:new Set<()=>void>()};
  return {isFocused:()=>focused,
    addListener:(event:'focus'|'blur',callback:()=>void)=>{listeners[event].add(callback);return()=>{listeners[event].delete(callback);};},
    focus(value:boolean){focused=value;Array.from(listeners[value?'focus':'blur']).forEach(callback=>callback());},
    count:()=>listeners.focus.size+listeners.blur.size,
  };
}
export const NavigationContext=createContext<ReturnType<typeof navigation>|null>(null);
export function useNavigation(){const value=useContext(NavigationContext);if(!value)throw Error('Missing navigation fixture');return value;}
export const useOptionalNavigation=useNavigation;

const values=new Map<string,string>();
export const storage={getItem:async(key:string)=>values.get(key)??null,
  setItem:async(key:string,value:string)=>{values.set(key,value);},removeItem:async(key:string)=>{values.delete(key);},
  multiSet:async(entries:[string,string][])=>{entries.forEach(([key,value])=>values.set(key,value));},
};
