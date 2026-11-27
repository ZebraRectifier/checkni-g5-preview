import { needLabel, reviewNeedSelection } from '../intelligence/shoppingNeeds.mjs';

export function renderShoppingNeeds(container, lines, unresolved, { onSelect, onRemove, onLink, products=[] }) {
  if (!lines.length) return;
  const section = document.createElement('section');
  section.id = 'shopping-needs'; section.className = 'future-step';
  const heading = document.createElement('h2'); heading.textContent = 'Что нужно купить';
  const help = document.createElement('p'); help.textContent = 'Названия и количества из твоего списка. Для цен нужны выбранные товары и упаковки.';
  section.append(heading, help);
  const pending = new Set(unresolved.map(row=>row.lineId));
  for (const [index,line] of lines.entries()) {
    const row = document.createElement('article');row.className='basket-row';row.style.gridTemplateColumns='minmax(0, 1fr)';row.style.overflowWrap='anywhere';
    const label = document.createElement('p');label.textContent=`${needLabel(line)} · ${pending.has(line.lineId)?'нужно выбрать товар':'товар выбран'}`;
    const actions=document.createElement('div');actions.className='shopping-need-actions';Object.assign(actions.style,{display:'grid',gap:'8px',minWidth:'0'});
    if(pending.has(line.lineId)) {
      const select=document.createElement('button');select.type='button';select.className='text-button';select.textContent='Подобрать';
      select.addEventListener('click',()=>onSelect(index));actions.append(select);
      if(products.length&&onLink) {
        const chooser=document.createElement('select');chooser.setAttribute('aria-label',`Товар для потребности ${line.requestedName}`);Object.assign(chooser.style,{maxWidth:'100%',width:'100%',minWidth:'0',minHeight:'44px',padding:'8px',background:'var(--surface-soft)',color:'var(--ink)',border:'1px solid var(--line)'});
        const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='Связать с товаром из корзины';chooser.append(placeholder);
        products.forEach(product=>{const option=document.createElement('option');option.value=product.id;option.textContent=`${product.name}, ${product.unit} ×${product.quantity}`;chooser.append(option);});
        const review=document.createElement('p');review.className='shopping-need-review';review.setAttribute('role','status');
        const confirm=document.createElement('button');confirm.type='button';confirm.className='text-button';confirm.textContent='Подтвердить соответствие';confirm.disabled=true;
        let selected=null;
        chooser.addEventListener('change',()=>{selected=products.find(product=>product.id===chooser.value);const result=reviewNeedSelection(line,selected);review.textContent=result.message;confirm.disabled=!result.ok;});
        confirm.addEventListener('click',async()=>{confirm.disabled=true;chooser.disabled=true;const result=await onLink(line.lineId,selected);review.textContent=result.message;if(!result.ok){confirm.disabled=false;chooser.disabled=false;}});
        actions.append(chooser,review,confirm);
      }
    }
    const remove=document.createElement('button');remove.type='button';remove.className='text-button';remove.textContent='Убрать из списка';
    remove.addEventListener('click',()=>onRemove(line.lineId));actions.append(remove);
    row.append(label,actions);section.append(row);
  }
  container.prepend(section);
  if(unresolved.length) {
    const button=container.querySelector('#compare-basket');
    if(button) {button.disabled=true;button.textContent='Сначала выбери оставшиеся товары';}
    const notice=document.createElement('p');notice.id='shopping-needs-coverage';notice.setAttribute('role','status');
    notice.textContent=`Без выбранной карточки: ${unresolved.length} из ${lines.length} позиций списка. Сравнение всей покупки пока недоступно.`;
    section.append(notice);
    const empty=container.querySelector('.basket-empty h2');if(empty)empty.textContent='Товары ещё не выбраны';
  }
}
