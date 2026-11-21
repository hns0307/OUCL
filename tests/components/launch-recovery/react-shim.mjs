let slots=[]; let cursor=0; let effects=[];
export function reset(){slots=[];cursor=0;effects=[];}
export function begin(){cursor=0;effects=[];}
export function flush(){for(const fn of effects) fn(); effects=[];}
export function useState(initial){const i=cursor++; if(!(i in slots)) slots[i]=typeof initial==='function'?initial():initial; return [slots[i], value=>{slots[i]=typeof value==='function'?value(slots[i]):value;}];}
export function useRef(initial){const i=cursor++; if(!(i in slots))slots[i]={current:initial};return slots[i];}
export function useEffect(effect){effects.push(effect);}
