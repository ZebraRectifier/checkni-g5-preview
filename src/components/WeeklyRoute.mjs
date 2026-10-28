import { WEEKLY_ROUTE_STORE_IDS } from '../catalog/weeklyRouteProducts.mjs';
import { WEEKLY_BASKET_RECIPE } from '../catalog/weeklyBasketRecipe.mjs';
import { createRetailCatalogClient } from '../ports/retailCatalogPort.mjs';
import { quoteWeeklyRoute } from '../core/weeklyRoute.mjs';
const money=n=>Number.isSafeInteger(n)?new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',maximumFractionDigits:2}).format(n/100):'Нет цены';
const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
const PRICE_READ_TIMEOUT_MS=15000;
const SELECTION_KEY='checkni.weekly-route.selection.v1';

export function createWeeklyRoute({onChoosePeer,onApply,getBasket,createClient=createRetailCatalogClient,now=Date.now}={}){
 const root=el('section');root.id='weekly-route';root.hidden=true;
 root.setAttribute('aria-label','Корзина на неделю');
 Object.assign(root.style,{marginBlock:'16px',padding:'16px',border:'2px solid var(--accent,#8b45ef)',display:'none',gap:'12px',minWidth:'0'});
 const open=el('button','🥘 Корзина на неделю для троих');open.type='button';open.className='primary-button';open.setAttribute('aria-expanded','false');
 const panel=el('div');panel.hidden=true;panel.style.minWidth='0';
 const count=WEEKLY_BASKET_RECIPE.length;
 const heading=el('h3',`${count} продуктов · 3 человека · 7 дней`);
 const addressDetails=el('details'),addressSummary=el('summary'),addresses=el('p');addresses.id='weekly-route-addresses';
 addressSummary.style.minHeight='44px';addressDetails.append(addressSummary,addresses);
 const intro=el('p','Фарш, гарниры, овощи и молочное. Количество можно менять, ненужные продукты — исключить.');
 const peerAction=el('button');peerAction.type='button';peerAction.className='text-button';peerAction.style.minHeight='44px';
 const status=el('p');status.setAttribute('role','status');status.id='weekly-route-status';
 const list=el('div');Object.assign(list.style,{display:'grid',gap:'8px',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,320px),1fr))'});
 const details=el('details'),summary=el('summary',`Состав и количество · ${count} продуктов`);details.id='weekly-route-products';summary.style.minHeight='44px';
 details.open=globalThis.matchMedia?.('(min-width:760px)').matches??true;details.append(summary,list);
 const total=el('p');total.id='weekly-route-total';
 const apply=el('button','Добавить и сравнить');apply.type='button';apply.className='primary-button';apply.disabled=true;
 const replaceLabel=el('label');const replace=el('input');replace.type='checkbox';replaceLabel.append(replace,document.createTextNode(' Заменить текущий список этой корзиной'));
 const refresh=el('button','Проверить цены ещё раз');refresh.type='button';refresh.className='text-button';refresh.style.minHeight='44px';
 panel.append(heading,addressDetails,intro,peerAction,status,total,replaceLabel,apply,details,refresh);root.append(open,panel);
 let store=null,peer=null,key='',version=0,opened=false,loading=false,cards=[],peerCards=[],loaded=false,expected=[],applyRejected=false;
 const quantities={},rowNodes=[];let storage;try{storage=globalThis.localStorage;const raw=JSON.parse(storage?.getItem('checkni.weekly-route.quantities.v1')??'{}');for(const p of WEEKLY_BASKET_RECIPE){const q=raw[p.id];if(Number.isInteger(q)&&q>=1&&q<=99)quantities[p.id]=q;}}catch{/* Optional draft storage. */}
 const save=()=>{try{storage?.setItem('checkni.weekly-route.quantities.v1',JSON.stringify(quantities));}catch{/* Basket persistence remains independent. */}};
 const allIds=WEEKLY_BASKET_RECIPE.map(p=>p.id),selected=new Set(allIds);
 try{
  const saved=storage?.getItem(SELECTION_KEY);
  if(saved!==null&&saved!==undefined){
   const value=typeof saved==='string'&&saved.length<=4096?JSON.parse(saved):null;
   if(value?.version===1&&Array.isArray(value.productIds)&&value.productIds.length<=count
     &&new Set(value.productIds).size===value.productIds.length&&value.productIds.every(id=>allIds.includes(id))){
    selected.clear();
    for(const id of value.productIds)selected.add(id);
   }
  }
 }catch{/* An invalid draft retains the visible full preset, not an implicit empty choice. */}
 const selectedIds=()=>allIds.filter(id=>selected.has(id));
 const saveSelection=()=>{try{storage?.setItem(SELECTION_KEY,JSON.stringify({version:1,productIds:selectedIds()}));}catch{/* Optional draft storage. */}};
 function render(){
  if(!opened)return;
  addresses.textContent=`Собираем: ${store?.name??''} · ${store?.address??''}`+(peer?` Сравним: ${peer.name} · ${peer.address}`:'');
  addressSummary.textContent=`${store?.name??''}`+(peer?` ↔ ${peer.name}`:' · адрес магазина');
  peerAction.hidden=Boolean(peer);peerAction.textContent='Сравнить с '+(store?.officialStoreId==='5011'?'Глобус Медведково':'Глобус Красногорск');
  refresh.hidden=!peer;refresh.disabled=loading;
  replaceLabel.hidden=!(getBasket?.().length);apply.textContent=replace.checked?'Заменить и сравнить':'Добавить и сравнить';
  const selection=selectedIds(),selectedCount=selection.length;
  heading.textContent=selectedCount===count?`${count} продуктов · 3 человека · 7 дней`:`Выбрано ${selectedCount} из ${count} продуктов`;
  summary.textContent=`Состав и количество · выбрано ${selectedCount} из ${count}`;
  const a=quoteWeeklyRoute(cards,quantities,now(),selection),b=quoteWeeklyRoute(peerCards,quantities,now(),selection);
  const ready=Boolean(peer)&&a.ready&&b.ready&&!loading;
  apply.disabled=!ready||applyRejected;
  const missingProductCount=new Set([...a.missingProductIds,...b.missingProductIds]).size;
  const missing=[];
  if(peer&&loaded&&!ready){
   for(const [quote,address] of [[a,store],[b,peer]]){
    for(const id of quote.missingProductIds){
     const product=WEEKLY_BASKET_RECIPE.find(p=>p.id===id);
     if(product)missing.push(`${product.name} — ${address.name}`);
    }
   }
  }
  const missingSummary=missing.length?` Например: ${missing.slice(0,2).join('; ')}${missing.length>2?'; и ещё…':'.'}`:'';
  const selectionText=selectedCount<count?`Выбрано ${selectedCount} из ${count} продуктов. `:'';
  status.textContent=applyRejected?'Не удалось применить список. Закрой и открой шаблон, проверь текущую корзину и подтверди замену заново.'
   :!selectedCount?'Выбери хотя бы один продукт.':selectionText+(!peer?'Выбери второй магазин — сравним одинаковые упаковки.':loading?'Проверяем цены двух выбранных магазинов…':ready
   ?(selectedCount<count?`${selectedCount} из ${selectedCount} выбранных позиций шаблона имеют цены свежее часа в обоих магазинах. Наличие не подтверждено.`:`${count} из ${count} цен свежее часа в обоих магазинах. Наличие не подтверждено.`)
   :!loaded?'Нажми «Проверить цены ещё раз».':'Для выбранных позиций пока не хватает свежих цен: '+missingProductCount+` из ${selectedCount}.${missingSummary} Старые цены не участвуют в сравнении.`);
  total.textContent=ready?`${store.name}: ${money(a.knownSubtotalMinor)} · ${peer.name}: ${money(b.knownSubtotalMinor)}`:'';
  const linesById=new Map(a.lines.map(line=>[line.product.id,line]));
  for(const [i,p] of WEEKLY_BASKET_RECIPE.entries()){
   const included=selected.has(p.id),line=linesById.get(p.id);
   const priceText=included?`${p.unit} · ${line?.freshness==='recent'?money(line.unitPriceMinor):'Цена требует обновления'}`:`${p.unit} · Не входит в список`;
   if(rowNodes[i]){
    rowNodes[i].price.textContent=priceText;rowNodes[i].include.checked=included;rowNodes[i].input.disabled=!included;
    if(document.activeElement!==rowNodes[i].input)rowNodes[i].input.value=String(quantities[p.id]??p.quantity);
    continue;
   }
   const row=el('div');row.dataset.weeklyProduct=p.id;
   Object.assign(row.style,{display:'grid',gridTemplateColumns:'minmax(0,1fr) 72px',gap:'8px',alignItems:'center',paddingBlock:'8px',borderBottom:'1px solid var(--border,#786b8e)'});
   const label=el('label'),include=el('input');include.type='checkbox';include.checked=included;
   include.id='weekly-route-include-'+p.id;include.setAttribute('aria-label','Включить в список: '+p.name);
   Object.assign(label.style,{display:'grid',gridTemplateColumns:'24px minmax(0,1fr)',gap:'8px',alignItems:'center',minHeight:'44px'});
   const info=el('div'),price=el('div',priceText);info.append(el('strong',`${p.emoji} ${p.name}`),price);label.append(include,info);
   include.addEventListener('change',()=>{if(include.checked)selected.add(p.id);else selected.delete(p.id);saveSelection();render();});
   const input=el('input');input.type='number';input.min='1';input.max='99';input.step='1';input.value=String(quantities[p.id]??p.quantity);
   input.setAttribute('aria-label','Количество: '+p.name);Object.assign(input.style,{width:'72px',minHeight:'44px',boxSizing:'border-box',background:'var(--surface-soft)',color:'var(--ink)',border:'1px solid var(--line)',borderRadius:'2px'});
   input.disabled=!included;
   input.addEventListener('change',()=>{const q=Number(input.value);if(!Number.isInteger(q)||q<1||q>99){input.value=String(quantities[p.id]??p.quantity);return;}quantities[p.id]=q;save();render();});
   row.append(label,input);list.append(row);rowNodes[i]={price,input,include};
  }
 }
 async function load(){
  if(!store||!peer||loading)return;const request=++version,context=key,primary=store,secondary=peer;
  loading=true;render();
  const ids=WEEKLY_BASKET_RECIPE.map(p=>p.sourceProductId);
  const results=await Promise.allSettled([primary,secondary].map(s=>Promise.resolve().then(()=>createClient({retailerId:'globus',store:s,timeoutMs:PRICE_READ_TIMEOUT_MS}).bySourceProductIds(ids))));
  if(request!==version||context!==key)return;
  [cards,peerCards]=results.map(r=>r.status==='fulfilled'&&r.value?.kind==='catalog'?r.value.products:[]);
  loading=false;loaded=true;render();
 }
 open.addEventListener('click',()=>{opened=!opened;panel.hidden=!opened;open.setAttribute('aria-expanded',String(opened));if(opened){expected=getBasket?.()??[];applyRejected=false;render();if(peer&&!loaded)void load();}});
 peerAction.addEventListener('click',()=>onChoosePeer?.(store?.officialStoreId==='5011'?'5020':'5011'));
 refresh.addEventListener('click',()=>void load());replace.addEventListener('change',render);
 apply.addEventListener('click',()=>{
  const selection=selectedIds(),a=quoteWeeklyRoute(cards,quantities,now(),selection),b=quoteWeeklyRoute(peerCards,quantities,now(),selection);
  if(applyRejected||!peer||loading||!a.ready||!b.ready){render();return;}
  const result=onApply?.({rows:a.basket,replace:replace.checked,expected});
  if(result===false){applyRejected=true;replace.checked=false;render();return;}
  status.textContent='Список добавлен. Переходим к сравнению.';
 });
 // Expiry is checked independently of UI actions, including after suspension.
 const onResume=()=>{if(opened)render();};
 globalThis.addEventListener?.('pageshow',onResume);document.addEventListener('visibilitychange',onResume);
 const timer=setInterval(()=>{if(opened)render();},30000);
 return {element:root,update({visible,store:next,peer:nextPeer=null}){
  const valid=visible&&WEEKLY_ROUTE_STORE_IDS.includes(next?.officialStoreId);
  root.hidden=!valid;root.style.display=valid?'grid':'none';
  const nextKey=JSON.stringify([next?.officialStoreId,nextPeer?.officialStoreId]);
  store=next;peer=nextPeer;
  if(nextKey!==key){key=nextKey;version++;loading=false;loaded=false;cards=[];peerCards=[];if(opened&&peer)void load();}
  render();
 },destroy(){clearInterval(timer);globalThis.removeEventListener?.('pageshow',onResume);document.removeEventListener('visibilitychange',onResume);}};
}
