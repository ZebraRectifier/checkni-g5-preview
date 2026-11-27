import { priceSeries } from '../observations/addressPriceHistory.mjs';

const rub = value => new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB'}).format(value/100);
function node(tag,text) { const n=document.createElement(tag); if(text!==undefined)n.textContent=text;return n; }

export function createAddressPriceHistory(bundle,address,product) {
  const details=node('details');
  details.className='address-price-history';
  const summary=node('summary','История цены');
  details.append(summary);
  let loaded=false;
  details.addEventListener('toggle',()=>{
    if(!details.open||loaded)return;
    loaded=true;
    const label=node('label','Период ');
    const select=node('select');
    select.setAttribute('aria-label','Период истории цены');
    for(const [value,text] of [['7','7 дней'],['30','30 дней'],['90','90 дней'],['all','Всё время']]){
      const option=node('option',text);option.value=value;select.append(option);
    }
    select.value='30';
    label.append(select);
    const content=node('div');content.setAttribute('aria-live','polite');
    details.append(label,content);
    function render(){
      content.replaceChildren();
      const points=priceSeries(bundle,address,product.sourceProductId,{days:select.value==='all'?null:Number(select.value)});
      if(!points.length){content.append(node('p','За этот период наблюдений нет.'));return;}
      content.append(node('p',points.length===1
        ?'Пока одно наблюдение. Линия появится после следующего обновления.'
        :'Линия соединяет наблюдения; цены между проверками неизвестны.'));
      const ns='http://www.w3.org/2000/svg';
      const svg=document.createElementNS(ns,'svg');
      svg.setAttribute('viewBox','0 0 360 160');svg.setAttribute('role','img');
      svg.setAttribute('aria-label','График наблюдаемой цены доставки в рублях');
      const min=Math.min(...points.map(p=>p.priceMinor)), max=Math.max(...points.map(p=>p.priceMinor));
      const span=Math.max(max-min,100);
      const start=points[0].ms, end=points.at(-1).ms;
      const xy=points.map(p=>[end===start?180:35+(p.ms-start)/(end-start)*290,115-(p.priceMinor-min)/span*80]);
      const axis=document.createElementNS(ns,'path');
      axis.setAttribute('d','M35 20V125H325');axis.setAttribute('stroke','currentColor');axis.setAttribute('fill','none');svg.append(axis);
      if(points.length>1){
        const line=document.createElementNS(ns,'polyline');line.setAttribute('points',xy.map(p=>p.join(',')).join(' '));
        line.setAttribute('fill','none');line.setAttribute('stroke','currentColor');line.setAttribute('stroke-width','2');svg.append(line);
      }
      points.forEach((p,i)=>{
        const circle=document.createElementNS(ns,'circle');circle.setAttribute('cx',String(xy[i][0]));circle.setAttribute('cy',String(xy[i][1]));
        circle.setAttribute('r','4');circle.setAttribute('fill','currentColor');
        const title=document.createElementNS(ns,'title');title.textContent=p.date+' · '+rub(p.priceMinor);circle.append(title);svg.append(circle);
      });
      for(const [x,y,text] of [[35,15,rub(max)],[35,145,points[0].date],[225,145,points.at(-1).date]]){
        const t=document.createElementNS(ns,'text');t.setAttribute('x',String(x));t.setAttribute('y',String(y));t.setAttribute('font-size','11');t.textContent=text;svg.append(t);
      }
      content.append(svg);
      const table=node('table');const caption=node('caption','Наблюдения · '+address);table.append(caption);
      const head=node('tr');head.append(node('th','Дата'),node('th','Цена'));table.append(head);
      for(const p of points){const row=node('tr');row.append(node('td',p.observedAt?new Date(p.ms).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'}):p.date),node('td',rub(p.priceMinor)));table.append(row);}
      content.append(table);
    }
    select.addEventListener('change',render);render();
  });
  return details;
}
