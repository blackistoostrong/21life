/** One owner for transport deadlines and parent-context cancellation. */
export async function withRequestDeadline<T>(
  request:{abortSignal:(signal:AbortSignal)=>PromiseLike<T>},
  timeoutMs=15000,externalSignal?:AbortSignal,timeoutMessage='Operation timed out',
):Promise<T> {
  const aborted=()=>{const error=new Error('Operation aborted');error.name='AbortError';return error;};
  if(externalSignal?.aborted)throw aborted();
  const controller=new AbortController();
  let timer:ReturnType<typeof setTimeout>|undefined;
  let onAbort:(()=>void)|undefined;
  const externalAbort=externalSignal?new Promise<never>((_resolve,reject)=>{
    onAbort=()=>{controller.abort();reject(aborted());};
    externalSignal.addEventListener('abort',onAbort,{once:true});
  }):null;
  try {
    return await Promise.race([
      Promise.resolve(request.abortSignal(controller.signal)),
      new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>{reject(new Error(timeoutMessage));controller.abort();},timeoutMs);}),
      ...(externalAbort?[externalAbort]:[]),
    ]);
  } finally {
    if(timer)clearTimeout(timer);
    if(onAbort)externalSignal?.removeEventListener('abort',onAbort);
  }
}
