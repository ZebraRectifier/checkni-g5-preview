import{PYAT_PUBLISHED_URL,PYAT_PUBLISHED_SCOPE}from'../../src/observations/pyaterochkaPublishedPromotions.mjs';
const OKEY_HOST_SOURCE='https://mos.proshoper.ru/actions/okej/moskva/';
export function pyatCollectionGate(previous,host,nowMs=Date.now(),owner=null){
  if(!Number.isFinite(nowMs)||previous?.sourceUrl!==PYAT_PUBLISHED_URL||previous?.scope!==PYAT_PUBLISHED_SCOPE
    ||!['manual-reviewed','reserved','collected','blocked','unavailable'].includes(previous?.status)
    ||!['automated','manual-html-plus-dom-sample'].includes(previous?.collectionMode)
    ||!Number.isFinite(Date.parse(previous?.lastAttemptAt))||Date.parse(previous.lastAttemptAt)>nowMs)return{due:false,reason:'own-state-unconfirmed'};
  if(host?.sourceUrl!==OKEY_HOST_SOURCE||!['collected','blocked','unavailable'].includes(host.status))return{due:false,reason:'host-state-unconfirmed'};
  if(previous.status==='blocked'||host.status==='blocked')return{due:false,reason:'source-blocked'};
  if(previous.status==='reserved')return previous.reservationOwner===owner&&typeof owner==='string'&&/^\d+-\d+$/u.test(owner)
    &&nowMs-Date.parse(previous.lastAttemptAt)<600000?{due:true,reason:'reserved-attempt'}:{due:false,reason:'reservation-unresolved'};
  if(previous.collectionMode==='automated'&&nowMs-Date.parse(previous.lastAttemptAt)<20*3600000)return{due:false,reason:'daily-cooldown'};
  return{due:true,reason:'due'};
}
export function reservePyatAttempt(previous,host,owner,nowMs=Date.now()){
  const gate=pyatCollectionGate(previous,host,nowMs);
  if(!gate.due||typeof owner!=='string'||!/^\d+-\d+$/u.test(owner))return{allowed:false,reason:gate.due?'owner-unconfirmed':gate.reason};
  return{allowed:true,status:{status:'reserved',lastAttemptAt:new Date(nowMs).toISOString(),sourceUrl:PYAT_PUBLISHED_URL,
    scope:PYAT_PUBLISHED_SCOPE,collectionMode:'automated',reservationOwner:owner,sourceRequests:0}};
}
