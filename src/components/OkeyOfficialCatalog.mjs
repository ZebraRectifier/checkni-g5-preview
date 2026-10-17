import { currentOfficialProducts,validOfficialSnapshot } from '../observations/okeyOfficialPromotions.mjs';
import { currentPublishedProducts,validPublishedSnapshot } from '../observations/okeyPublishedPromotions.mjs';
import { readBoundedJsonResponse } from '../ports/retailCatalogPort.mjs';
const node=(tag,text)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;return el;};
const rub=value=>new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB'}).format(value/100);
export function createOkeyOfficialCatalog({fetchImpl=globalThis.fetch}={}) {
  const details=node('details');details.className='okey-delivery';details.dataset.okeyOfficial='true';
  details.append(node('summary','О’КЕЙ · свежие акции Москвы'));
  const status=node('p','Откройте, чтобы посмотреть цены из опубликованных каталогов.');status.setAttribute('aria-live','polite');
  const note=node('p','Москва · городской каталог. Цены конкретного магазина, наличие и условия О’КАРТЫ / без карты не подтверждены. Неполный срез, без добавления в корзину.');
  const search=node('input');search.type='search';search.placeholder='Найти среди свежих акций';search.setAttribute('aria-label','Поиск в акциях О’КЕЙ');
  const grid=node('div');grid.className='okey-delivery-grid';
  details.append(status,note,search,grid);
  let snapshot=null,published=null,started=false,refreshState='unavailable',publishedState='unavailable',loading=false;
  function render() {
    grid.replaceChildren();
    const official=currentOfficialProducts(snapshot),other=currentPublishedProducts(published),q=search.value.trim().toLocaleLowerCase('ru-RU');
    const rows=[...official.map(p=>({p,publisher:'Официальный сайт О’КЕЙ'})),...other.map(p=>({p,publisher:'Прошопер · сторонний каталог'}))];
    status.textContent=rows.length?`Свежих действующих наблюдений: ${rows.length}. Ежедневная проверка.`:'Свежие действующие цены пока не получены.';
    if(other.length)status.textContent+=` Прошопер: проверено ${new Date(published.observedAt).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'})}.`;
    if(refreshState==='blocked')status.textContent+=' Прямой сбор с официального сайта приостановлен источником.';
    if(publishedState==='blocked')status.textContent+=' Проверка Прошопера приостановлена источником.';
    else if(other.length&&publishedState!=='collected')status.textContent+=' Последняя попытка обновления Прошопера не подтверждена.';
    for(const {p,publisher} of rows.filter(({p})=>!q||p.name.toLocaleLowerCase('ru-RU').includes(q))) {
      const card=node('article');card.className='okey-delivery-card';
      card.append(node('h3',p.name),node('strong',rub(p.priceMinor)),node('p',`Акция до ${p.validUntil.split('-').reverse().join('.')}. Условия цены уточняйте у О’КЕЙ.`));
      const source=node('a',publisher);source.href=p.productUrl;source.target='_blank';source.rel='noopener noreferrer';card.append(source);
      grid.append(card);
    }
    if(rows.length&&!grid.children.length)grid.append(node('p','Такого товара в проверенном срезе нет.'));
  }
  async function load() {
    if(loading)return;loading=true;
    try {
      const results=await Promise.allSettled(['okeyOfficialPromotions.json','okeyOfficialRefresh.json','okeyPublishedPromotions.json','okeyPublishedRefresh.json'].map(async file=>{
        const response=await fetchImpl(new URL('../data/'+file,import.meta.url),{cache:'no-store'});
        if(!response.ok)throw Error('unavailable');return readBoundedJsonResponse(response,262_144);
      }));
      const value=i=>results[i].status==='fulfilled'?results[i].value:null;
      if(validOfficialSnapshot(value(0)))snapshot=value(0);
      if(validPublishedSnapshot(value(2)))published=value(2);
      refreshState=value(1)?.status??'unavailable';publishedState=value(3)?.status??'unavailable';render();
      if(results.every(r=>r.status==='rejected')){status.textContent='Каталоги сейчас недоступны. Откройте раздел ещё раз.';started=false;}
    } catch {status.textContent='Каталоги сейчас недоступны. Откройте раздел ещё раз.';started=false;}
    finally {loading=false;}
  }
  details.addEventListener('toggle',()=>{if(details.open&&!started){started=true;load();}});
  search.addEventListener('input',render);
  // Expired promotions disappear at the Moscow date boundary, including focus/recovery.
  setInterval(()=>{if(details.isConnected&&details.open)render();},60_000);
  setInterval(()=>{if(details.isConnected&&details.open&&document.visibilityState!=='hidden')load();},15*60_000);
  for(const type of ['focus','pageshow'])globalThis.addEventListener(type,()=>{if(details.isConnected&&details.open)render();});
  return details;
}
