export const Fragment=Symbol.for('fixture.fragment');
export function jsx(type,props,key){return {type,props:props??{},key};}
export const jsxs=jsx;
export const jsxDEV=jsx;
