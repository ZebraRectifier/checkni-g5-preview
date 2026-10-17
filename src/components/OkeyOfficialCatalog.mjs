import { currentOfficialProducts,validOfficialSnapshot } from '../observations/okeyOfficialPromotions.mjs';
import { readBoundedJsonResponse } from '../ports/retailCatalogPort.mjs';
const node=(tag,text)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;return el;};
const rub=value=>new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB'}).format(value/100);
export function createOkeyOfficialCatalog({fetchImpl=globalThis.fetch}={}) {
  const details=node('details');details.className='okey-delivery';details.dataset.okeyOfficial='true';
  details.append(node('summary','О’КЕЙ · акции официального сайта'));
  const status=node('p','Откройте, чтобы посмотреть проверенные акции.');status.setAttribute('aria-live','polite');
  const note=node('p','Москва · городской каталог. Цены конкретного магазина, наличие и условия О’КАРТЫ / без карты не подтверждены. Неполный срез, без добавления в корзину.');
  const search=node('input');search.type='search';search.placeholder='Найти среди проверенных акций';search.setAttribute('aria-label','Поиск в официальных акциях О’КЕЙ');
  const grid=node('div');grid.className='okey-delivery-grid';
  details.append(status,note,search,grid);
  let snapshot=null,started=false,refreshState='unavailable',loading=false;
  function render() {
    grid.replaceChildren();
    const products=currentOfficialProducts(snapshot),q=search.value.trim().toLocaleLowerCase('ru-RU');
    const measured=snapshot?.observedAt?new Date(snapshot.observedAt).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'}):null;
    status.textContent=products.length?`Проверено ${measured} · действующих наблюдений: ${products.length}.`
      :measured?`Свежих действующих акций пока нет. Последняя проверка: ${measured}.`:'Свежие официальные цены пока не получены.';
    if(refreshState==='blocked')status.textContent+=' Автоматическое обновление приостановлено источником.';
    else if(refreshState!=='collected')status.textContent+=' Последняя автоматическая проверка не подтверждена.';
    for(const p of products.filter(p=>!q||p.name.toLocaleLowerCase('ru-RU').includes(q))) {
      const card=node('article');card.className='okey-delivery-card';
      card.append(node('h3',p.name),node('strong',rub(p.priceMinor)),node('p',`Акция до ${p.validUntil.split('-').reverse().join('.')}. Условия цены уточняйте у О’КЕЙ.`));
      const source=node('a','Цена на официальном сайте');source.href=p.productUrl;source.target='_blank';source.rel='noopener noreferrer';card.append(source);
      grid.append(card);
    }
    if(products.length&&!grid.children.length)grid.append(node('p','Такого товара в проверенном срезе нет.'));
  }
  async function load() {
    if(loading)return;loading=true;
    try {
      const [data,state]=await Promise.all(['okeyOfficialPromotions.json','okeyOfficialRefresh.json'].map(async file=>{
        const response=await fetchImpl(new URL('../data/'+file,import.meta.url),{cache:'no-store'});
        if(!response.ok)throw Error('unavailable');return readBoundedJsonResponse(response,262_144);
      }));
      if(validOfficialSnapshot(data))snapshot=data;
      refreshState=state.status;render();
    } catch {status.textContent='Официальные цены сейчас недоступны. Откройте раздел ещё раз.';started=false;}
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
