import { currentOfficialProducts,validOfficialSnapshot } from '../observations/okeyOfficialPromotions.mjs';
import { currentPublishedProducts,validPublishedSnapshot } from '../observations/okeyPublishedPromotions.mjs';
import { readBoundedJsonResponse } from '../ports/retailCatalogPort.mjs';
const node=(tag,text)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;return el;};
const rub=value=>new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB'}).format(value/100);
export function createOkeyOfficialCatalog({fetchImpl=globalThis.fetch}={}) {
  const details=node('details');details.className='okey-delivery';details.id='okey-official-promotions';details.dataset.okeyOfficial='true';
  details.append(node('summary','О’КЕЙ · свежие акции Москвы'));
  const status=node('p','Откройте, чтобы посмотреть цены из опубликованных каталогов.');status.setAttribute('aria-live','polite');
  const note=node('p','Москва · городской каталог. Цены конкретного магазина, наличие и условия О’КАРТЫ / без карты не подтверждены. Неполный срез, без добавления в корзину.');
  const search=node('input');search.type='search';search.placeholder='Найти среди свежих акций';search.setAttribute('aria-label','Поиск в акциях О’КЕЙ');
  const grid=node('div');grid.className='okey-delivery-grid';
  const retry=node('button','Обновить каталог');retry.type='button';retry.className='okey-catalog-refresh';retry.hidden=true;
  details.append(status,note,search,retry,grid);
  let snapshot=null,published=null,started=false,refreshState='unavailable',publishedState='unavailable',loading=false;
  let lastLoadFailed=false,lastLoadUnavailable=false;
  function render() {
    grid.replaceChildren();
    const official=currentOfficialProducts(snapshot),other=currentPublishedProducts(published),q=search.value.trim().toLocaleLowerCase('ru-RU');
    const rows=[...official.map(p=>({p,publisher:'Официальный сайт О’КЕЙ'})),...other.map(p=>({p,publisher:'Прошопер · сторонний каталог'}))];
    status.textContent=rows.length?`Свежих действующих наблюдений: ${rows.length}. Ежедневная проверка.`
      :lastLoadUnavailable?'Каталоги сейчас недоступны. Нажмите «Обновить каталог».':'Свежие действующие цены пока не получены.';
    if(other.length)status.textContent+=` Прошопер: проверено ${new Date(published.observedAt).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'})}.`;
    if(refreshState==='blocked')status.textContent+=' Прямой сбор с официального сайта приостановлен источником.';
    if(publishedState==='blocked')status.textContent+=' Проверка Прошопера приостановлена источником.';
    else if(other.length&&publishedState!=='collected')status.textContent+=' Последняя попытка обновления Прошопера не подтверждена.';
    if(lastLoadFailed&&!lastLoadUnavailable)status.textContent+=' Часть каталогов сейчас не обновилась. Можно повторить.';
    else if(lastLoadUnavailable&&rows.length)status.textContent+=' Файлы сейчас не обновились. Показаны ранее полученные действующие наблюдения с исходной датой.';
    for(const {p,publisher} of rows.filter(({p})=>!q||p.name.toLocaleLowerCase('ru-RU').includes(q))) {
      const card=node('article');card.className='okey-delivery-card';
      card.append(node('h3',p.name),node('strong',rub(p.priceMinor)),node('p',`Акция до ${p.validUntil.split('-').reverse().join('.')}. Условия цены уточняйте у О’КЕЙ.`));
      const source=node('a',publisher);source.href=p.productUrl;source.target='_blank';source.rel='noopener noreferrer';card.append(source);
      grid.append(card);
    }
    if(rows.length&&!grid.children.length)grid.append(node('p','Такого товара в проверенном срезе нет.'));
  }
  async function fetchJson(file) {
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),5000);
    try {
      const response=await fetchImpl(new URL('../data/'+file,import.meta.url),{cache:'no-store',signal:controller.signal});
      if(!response.ok)throw Error('unavailable');
      const value=await readBoundedJsonResponse(response,262_144);
      if(value===null)throw Error('unavailable');
      return value;
    } finally {clearTimeout(timer);}
  }
  async function load() {
    if(loading)return;loading=true;retry.hidden=false;retry.disabled=true;
    details.setAttribute('aria-busy','true');status.textContent='Загружаем каталоги…';
    try {
      const results=await Promise.allSettled(['okeyOfficialPromotions.json','okeyOfficialRefresh.json','okeyPublishedPromotions.json','okeyPublishedRefresh.json'].map(fetchJson));
      const value=i=>results[i].status==='fulfilled'?results[i].value:null;
      if(validOfficialSnapshot(value(0)))snapshot=value(0);
      if(validPublishedSnapshot(value(2)))published=value(2);
      if(typeof value(1)?.status==='string')refreshState=value(1).status;
      if(typeof value(3)?.status==='string')publishedState=value(3).status;
      lastLoadFailed=results.some(r=>r.status==='rejected');
      lastLoadUnavailable=results.every(r=>r.status==='rejected');
      if(lastLoadUnavailable)started=false;
    } catch {lastLoadFailed=true;lastLoadUnavailable=true;started=false;}
    finally {loading=false;retry.disabled=false;details.setAttribute('aria-busy','false');render();}
  }
  details.addEventListener('toggle',()=>{if(details.open&&!started){started=true;load();}});
  retry.addEventListener('click',()=>{started=true;load();});
  search.addEventListener('input',render);
  // Expired promotions disappear at the Moscow date boundary, including focus/recovery.
  setInterval(()=>{if(details.isConnected&&details.open)render();},60_000);
  setInterval(()=>{if(details.isConnected&&details.open&&document.visibilityState!=='hidden')load();},15*60_000);
  for(const type of ['focus','pageshow'])globalThis.addEventListener(type,()=>{if(details.isConnected&&details.open)render();});
  return details;
}
