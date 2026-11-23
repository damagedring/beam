export function trackingExactKey(v){return String(v??'').normalize('NFKC').trim().toUpperCase();}
export function trackingKey(v){return trackingExactKey(v).replace(/^[^A-Z0-9]+|[^A-Z0-9]+$/g,'').replace(/[\s\-‐‑‒–—−]/g,'');}
export function trackingNumericCore(v){
 const s=trackingExactKey(v).replace(/[\s\-‐‑‒–—−]/gu,'');
 if(/^\d{10,13}$/.test(s))return s;
 return s.match(/^([A-Z\u1100-\u11ff\u3130-\u318f\uac00-\ud7a3])(\d{10,13})\1$/u)?.[2]||'';
}
export function looksLikeTracking(v){return /^\d{6,}$/.test(trackingKey(v))||!!trackingNumericCore(v);}

const beamInitials='ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
export function beamInitialKey(value,queryOnly=false){
 let out='';
 for(const ch of String(value??'').normalize('NFKC')){
  if(/\s/u.test(ch))continue;
  const cp=ch.codePointAt(0),i=cp-0x1100;
  if(i>=0&&i<beamInitials.length)out+=beamInitials[i];
  else if(queryOnly)return '';
  else if(cp>=0xac00&&cp<=0xd7a3)out+=beamInitials[Math.floor((cp-0xac00)/588)];
  else out+=ch;
 }
 return out;
}
