import{currentPyatProducts,pyatWeeklyCards}from'../observations/pyaterochkaPublishedPromotions.mjs';
import{readBoundedJsonResponse}from'../ports/retailCatalogPort.mjs';
const rub=n=>new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB'}).format(n/100);
export function createPyaterochkaPublishedCatalog({document=globalThis.document,fetchImpl=globalThis.fetch,now=Date.now,onBuild}={}){
  const el=(tag,text)=>{const e=document.createElement(tag);if(text)e.textContent=text;return e;};
  const root=el('details');root.id='pyaterochka-published';root.className='pyat-published';
  const css=el('link');css.rel='stylesheet';css.href=new URL('./pyaterochka-published.css',import.meta.url).href;document.head.append(css);
  root.append(el('summary','Пятёрочка · акции Москвы'));
  const status=el('p','Открой, чтобы посмотреть продуктовые акции.');status.setAttribute('role','status');root.append(status);
  const content=el('div');root.append(content);let pending=false,bundle=null,expiryTimer=null;
  const retry=()=>{const b=el('button','Обновить каталог');b.type='button';b.addEventListener('click',()=>{bundle=null;void load();});return b;};
  async function render(){
    if(expiryTimer!==null){clearTimeout(expiryTimer);expiryTimer=null;}
    const products=currentPyatProducts(bundle,now());content.replaceChildren();
    if(!products.length){status.textContent='Свежего каталога сейчас нет. Можно продолжить с магазинами, у которых доступны цены.';content.append(retry());return;}
    status.textContent=`${products.length} продуктов · акции ${bundle.cataloguePeriod.from} — ${bundle.cataloguePeriod.until} · наблюдение ${new Date(bundle.observedAt).toLocaleDateString('ru-RU')}.`;
    content.append(el('p','Это акции Москвы из Прошопера. Цена в конкретном магазине, наличие и условия карты не подтверждены.'));
    const label=el('label','Найти продукт в акциях');const search=el('input');search.type='search';search.id='pyat-published-search';label.htmlFor=search.id;
    const grid=el('div');grid.className='pyat-published-grid';grid.setAttribute('aria-label','Продуктовые акции Пятёрочки');
    const more=el('button','Показать ещё 8');more.type='button';
    const build=el('button','Подобрать часть корзины по акциям');build.type='button';build.addEventListener('click',()=>{
      if(!currentPyatProducts(bundle,now()).length){void render();return;}onBuild?.();});
    build.hidden=!pyatWeeklyCards(bundle,now()).length;
    const count=el('p');let limit=8;
    function show(){
      grid.replaceChildren();const current=currentPyatProducts(bundle,now());
      if(!current.length){void render();return;}
      const q=search.value.trim().toLowerCase().replaceAll('ё','е');
      const rows=current.filter(p=>p.name.toLowerCase().replaceAll('ё','е').includes(q));
      count.textContent=`Найдено: ${rows.length}.`;
      for(const p of rows.slice(0,limit)){
        const card=el('article');card.append(el('strong',p.name),el('span',rub(p.priceMinor)));
        const source=el('a','Карточка акции');source.href=p.productUrl;source.target='_blank';source.rel='noopener noreferrer';card.append(source);grid.append(card);
      }
      more.hidden=rows.length<=limit;
    }
    search.addEventListener('input',()=>{limit=8;show();});more.addEventListener('click',()=>{limit+=8;show();});
    content.append(label,search,count,grid,more,build);show();
    const deadline=Math.min(Date.parse(bundle.observedAt)+86400001,Date.parse(bundle.cataloguePeriod.until+'T21:00:00Z'));
    expiryTimer=setTimeout(()=>{expiryTimer=null;void render();},Math.max(1,deadline-now()));
  }
  async function load(){
    if(!root.open||pending)return;
    if(bundle){void render();return;}pending=true;status.textContent='Загружаю акции…';
    try{const r=await fetchImpl(new URL('../data/pyaterochkaPublishedPromotions.json',import.meta.url),{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(5000)});
      if(!r.ok)throw Error('unavailable');bundle=await readBoundedJsonResponse(r,262144);await render();
    }catch{status.textContent='Каталог сейчас не загрузился. Можно обновить его или продолжить с другими магазинами.';content.replaceChildren(retry());}finally{pending=false;}
  }
  root.addEventListener('toggle',()=>{if(root.open)void load();});
  const recheck=()=>{if(bundle&&root.open&&!currentPyatProducts(bundle,now()).length)void render();};
  globalThis.addEventListener?.('focus',recheck);globalThis.addEventListener?.('pageshow',recheck);
  // Reopening, searching and applying all re-check expiry; no retailer requests.
  return root;
}
