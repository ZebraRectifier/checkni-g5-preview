import { formatRubMinor, buildObservedResultModel } from './ComparisonResult.mjs';
import { retailSelectionUrl } from '../intelligence/retailProductSelection.mjs';
import {validWeeklyCardSource,OKEY_WEEKLY_SCOPE,PYAT_WEEKLY_SCOPE} from '../ports/weeklyRetailCatalogPort.mjs';
const EMOJI = { mince: '🥩', chicken: '🍗', buckwheat: '🌾', pasta: '🍝', milk: '🥛', eggs: '🥚', tomatoes: '🍅',
  apples: '🍎', bananas: '🍌', curd: '🥣', cheese: '🧀', potatoes: '🥔', carrots: '🥕', onions: '🧅', cabbage: '🥬', oats: '🥣', flakes: '🥣', oil: '🌻',rice:'🍚',pork:'🥩' };
const STORE_LABELS = { magnit: 'Магнит', okey: 'О’КЕЙ', pyaterochka: 'Пятёрочка', perekrestok: 'Перекрёсток' };
// A display label only: store identities, source scopes and amounts stay in the model.
function storeLabel(store) {
  if (STORE_LABELS[store.retailerId]) return STORE_LABELS[store.retailerId];
  const name = String(store.storeName ?? 'Магазин');
  return store.address && name.endsWith(` · ${store.address}`) ? name.slice(0, -store.address.length - 3) : name;
}

export function renderGuidedShoppingTable(parent, model, send, onOpenBasket) {
  if (!model?.quote || !Array.isArray(model.quote.lines)) return;
  const document = parent.ownerDocument;
  const root = document.createElement('section'); root.className = 'guided-shopping'; root.setAttribute('aria-label', 'Подобранные товары и цены');
  const information = document.createElement('details'); information.className = 'guided-shopping-information';
  const informationTitle = document.createElement('summary'); informationTitle.textContent = 'Как сравниваем и что учтено'; information.append(informationTitle);
  const addInformation = text => { const note = document.createElement('p'); note.textContent = text; information.append(note); };
  if (model.location?.landmark) {
    const area = document.createElement('p'); area.className = 'guided-shopping-area';
    area.textContent = `${model.location.landmark.name} · до ${model.location.radiusKm} км по прямой · ${model.days} дн. · ${model.people} чел.`;
    root.append(area);
    addInformation('Проверены подключённые адресные каталоги ниже. Это частичный охват: остальные сети и все магазины района пока не сравнены. Расстояние по дороге может быть больше.');
    const landmark = document.createElement('a'); landmark.href = model.location.landmark.sourceUrl;
    landmark.textContent = 'Координаты ориентира'; landmark.target = '_blank'; landmark.rel = 'noopener noreferrer'; information.append(landmark);
  }
  if (model.alternatives?.length) {
    const coverage = document.createElement('section'); coverage.className = 'guided-shopping-stores'; coverage.setAttribute('aria-label', model.location?.landmark?'Проверенные магазины в радиусе':'Проверенные каталоги');
    const title = document.createElement('strong'); title.textContent = 'Варианты по твоему списку'; coverage.append(title);
    const cards = document.createElement('div'); cards.className = 'guided-store-options'; coverage.append(cards);
    for (const store of model.alternatives) {
      const card = document.createElement('article'); card.className = 'guided-store-option'; card.dataset.selected = String(Boolean(store.selected));
      const name = document.createElement('strong'); name.className = 'guided-store-name'; name.textContent = storeLabel(store); card.append(name);
      if (store.address) {
        const address = document.createElement('p'); address.className = 'guided-store-address'; address.textContent = store.address; card.append(address);
      }
      const count = document.createElement('p'); count.className = 'guided-store-coverage';
      count.textContent = `${store.found}/${store.requested} позиций${Number.isFinite(store.distanceKm) ? ` · ≈${store.distanceKm.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} км` : ''}`; card.append(count);
      const amount = document.createElement('strong'); amount.className = 'guided-store-amount';
      amount.textContent = store.knownSubtotalMinor == null ? 'Сумма неизвестна' : formatRubMinor(store.knownSubtotalMinor); card.append(amount);
      const conditions = [];
      if (!store.complete) conditions.push('Только найденная часть');
      if (!store.allRecent) conditions.push('Есть старые или неизвестные цены');
      if (store.priceScope === 'city-promotion') conditions.push('Акции города · условия карты неизвестны');
      if (store.priceScope === 'delivery-catalog') conditions.push('Каталог доставки');
      if (conditions.length) {
        const note = document.createElement('p'); note.className = 'guided-store-condition'; note.textContent = conditions.join(' · '); card.append(note);
      }
      if(!model.confirmed&&['magnit','okey','pyaterochka','perekrestok'].includes(store.retailerId)){
        const choose=document.createElement('button');choose.type='button';choose.className='guided-store-choose';choose.textContent=`Показать ${{magnit:'Магнит',okey:'О’КЕЙ',pyaterochka:'Пятёрочку',perekrestok:'Перекрёсток'}[store.retailerId]}`;
        choose.setAttribute('aria-pressed', String(Boolean(store.selected)));
        choose.addEventListener('click',()=>send('Показать вариант '+store.retailerId));card.append(choose);
      }
      cards.append(card);
    }
    const summary = document.createElement('p'); summary.className = 'guided-shopping-conditions';
    summary.textContent = 'Марки и фасовки различаются. ' + (model.quote.hasEstimates ? 'Количества примерные. ' : '') + 'Наличие не подтверждено.';
    coverage.append(summary);
    if(model.alternatives.some(store=>store.priceScope==='delivery-catalog')){
      summary.textContent += ' Доставка не подтверждена. Доставка и сборы не включены.';
      addInformation('Перекрёсток: подключённый каталог доставки в Москве. Доставка по твоему адресу не подтверждена. Цены в физическом магазине могут отличаться.');
      if(!model.alternatives.every(store=>store.complete&&store.allRecent)){
        const missing=document.createElement('p');missing.className='guided-shopping-warning';missing.setAttribute('role','status');missing.textContent='Сравнение свежих сумм пока недоступно: есть пропуски или цены старше часа.';coverage.append(missing);
        addInformation('Старую цену не считаем сегодняшней. Недостающая карточка не доказывает отсутствие товара в магазине.');
      }
      if(model.draftComparison?.kind==='fresh'){
        const comparison=document.createElement('p');comparison.className='guided-shopping-difference';comparison.setAttribute('role','status');
        const lowerStore = model.alternatives.find(store => store.storeName === model.draftComparison.lowerStoreName);
        comparison.textContent=model.draftComparison.differenceMinor===0?'Суммы товаров в этих вариантах совпали.':
          `${model.draftComparison.estimated?'Ориентир: ':''}${lowerStore ? storeLabel(lowerStore) : model.draftComparison.lowerStoreName} — меньшая сумма, разница ${formatRubMinor(model.draftComparison.differenceMinor)}.`;
        coverage.append(comparison);
      }
    }
    addInformation('В магазинах могут быть разные марки и упаковки. Приоритет полному списку и свежим наблюдениям, затем меньшей сумме среди полученных карточек. Это не сравнение одинаковых SKU и не доказательство самого дешёвого магазина района.');
    coverage.append(information); root.append(coverage);
  } else if (information.childElementCount > 1) {
    root.append(information);
  }
  const scroll = document.createElement('div'); scroll.className = 'guided-shopping-scroll'; scroll.tabIndex = 0;
  const table = document.createElement('table'); table.className = 'guided-shopping-table';
  const selectedStore = model.alternatives?.find(store => store.storeName === model.storeName);
  const caption = document.createElement('caption'); caption.textContent = `${model.confirmed ? 'Добавлено в корзину' : 'Список на проверку'} · ${selectedStore ? storeLabel(selectedStore) : model.storeName}`; table.append(caption);
  const head = document.createElement('thead'), header = document.createElement('tr');
  for (const label of ['Продукт и количество', 'Цена']) {
    const cell = document.createElement('th'); cell.scope = 'col'; cell.textContent = label; header.append(cell);
  }
  head.append(header); table.append(head);
  const body = document.createElement('tbody');
  const missing=[];
  for (const [index, row] of model.quote.lines.entries()) {
    if(!row.card){missing.push(row.group.label);continue;}
    const tr = document.createElement('tr');
    const product = document.createElement('td');
    const photoUrl = retailSelectionUrl(row.card?.imageUrl, row.card?.retailerId, 'imageUrlRules');
    if (photoUrl) {
      const photo = document.createElement('img'); photo.className = 'guided-product-photo';
      photo.src = photoUrl; photo.alt = ''; photo.width = 72; photo.height = 72;
      photo.loading = 'lazy'; photo.decoding = 'async'; photo.referrerPolicy = 'no-referrer';
      photo.addEventListener('error', () => photo.remove(), { once: true });
      product.append(photo);
    }
    const title = document.createElement('strong'); title.textContent = `${EMOJI[row.group.key] ?? '🛒'} ${row.card?.name ?? `${row.group.label} — требуется подбор`}`; product.append(title);
    const unit = document.createElement('p'); unit.textContent = row.unit ? `${row.quantity} × ${row.unit.label.replace(/^цена за\s+/iu, '')}` : 'Количество и упаковку уточним'; product.append(unit);
    const controls = document.createElement('details'); const edit = document.createElement('summary'); edit.textContent = `Изменить: ${row.group.label}`; controls.append(edit);
    if (!model.confirmed && row.cards.length > 1) {
      const select = document.createElement('select'); select.setAttribute('aria-label', `Вариант: ${row.group.label}`);
      row.cards.forEach((card, choice) => { const option = document.createElement('option'); option.value = String(choice + 1);
        option.textContent = `${card.name} · ${card.unit ?? 'упаковка неизвестна'} · ${formatRubMinor(card.priceMinor)}`;
        option.selected = card.id === row.card?.id; select.append(option); });
      select.addEventListener('change', () => send(`Для позиции ${index + 1} вариант ${select.value}`)); controls.append(select);
    }
    const count = document.createElement('div');
    if (row.card && !model.confirmed) {
      const input = document.createElement('input'); input.type = 'number'; input.min = '1'; input.max = '99'; input.step = '1'; input.value = String(row.quantity);
      input.setAttribute('aria-label', `Количество: ${row.group.label}`);
      const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Изменить'; button.setAttribute('aria-label', `Изменить количество: ${row.group.label}`);
      button.addEventListener('click', () => { if (input.checkValidity()) send(`Количество ${index + 1}: ${input.value}`); else input.reportValidity(); });
      count.append(input, button);
    } else count.textContent = String(row.quantity);
    if (!model.confirmed && row.card) { controls.append(count); product.append(controls); }
    tr.append(product);
    const price = document.createElement('td');
    const sum = document.createElement('strong'); sum.textContent = (row.unit?.approximate?'≈':'')+(formatRubMinor(row.lineTotalMinor) ?? 'Не рассчитана'); price.append(sum);
    const basis = document.createElement('small'); basis.textContent = row.unitPriceMinor == null ? 'Цена не подтверждена' : `${formatRubMinor(row.unitPriceMinor)} / ${row.unit?.label.replace(/^цена за\s+/iu, '') ?? 'единица не уточнена'}`; price.append(basis);
    const condition = document.createElement('small'); condition.textContent = row.card?.priceConditionLabel ?? 'Условие цены неизвестно'; price.append(condition); tr.append(price);
    const source = document.createElement('div');
    const url = validWeeklyCardSource(row.card,row.card?.retailerId==='pyaterochka'?PYAT_WEEKLY_SCOPE:OKEY_WEEKLY_SCOPE)?row.card.sourceUrl:retailSelectionUrl(row.card?.sourceUrl, row.card?.retailerId);
    if (url) { const link = document.createElement('a'); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'Источник цены'; link.setAttribute('aria-label', 'Источник цены: '+(row.card.storeName ?? model.storeName)); source.append(link); }
    const date = document.createElement('small'); date.textContent = row.card
      ? `${new Date(row.card.observedAt).toLocaleDateString('ru-RU', { timeZone: 'UTC' })} · ${row.freshness === 'dated' ? 'старое наблюдение' : 'наличие неизвестно'}` : 'Карточка не получена'; source.append(date); price.append(source);
    body.append(tr);
  }
  table.append(body); scroll.append(table); root.append(scroll);
  if(missing.length){
    const details=document.createElement('details'),summary=document.createElement('summary'),names=document.createElement('p');
    summary.textContent=`Ещё нужно подобрать: ${missing.length} поз.`;names.textContent=missing.join(', ')+'. Цены неизвестны; это не отсутствие товара в магазине.';
    details.append(summary,names);root.append(details);
  }
  const total = document.createElement('p'); total.className = 'guided-shopping-total';
  total.textContent = model.quote.knownSubtotalMinor == null ? 'Сумма пока неизвестна.'
    : `${model.quote.hasEstimates?'Ориентировочная сумма'+(model.quote.complete?'':' найденной части'):model.quote.complete ? 'Сумма по показанным наблюдениям' : 'Сумма только найденной части'}: ${formatRubMinor(model.quote.knownSubtotalMinor)}.`;
  root.append(total);
  if (model.confirmed && typeof onOpenBasket === 'function') { const basket = document.createElement('button'); basket.type = 'button'; basket.textContent = 'Открыть корзину'; basket.addEventListener('click', onOpenBasket); root.append(basket); }
  if (!model.quote.allRecent) { const warning = document.createElement('p'); warning.textContent = 'В списке есть старые или неподтверждённые цены. Сумма не подтверждает сегодняшнюю стоимость покупки.'; root.append(warning); }
  if (model.comparison) {
    const result = document.createElement('section'); result.className = 'guided-shopping-comparison'; result.setAttribute('aria-label', 'Результат сравнения списка');
    const explanation = buildObservedResultModel(model.comparison);
    const heading = document.createElement('strong'); heading.textContent = explanation?.title ?? 'Сравнение сейчас недоступно'; result.append(heading);
    const details = document.createElement('p'); details.textContent = explanation
      ? [explanation.totalLabel, explanation.coverageLabel, explanation.note, explanation.savingsLabel && `Экономия ${explanation.savingsLabel}`,
        explanation.priceConditionLabel, explanation.salesChannelLabel, explanation.observedAtLabel, explanation.availabilityLabel].filter(Boolean).join(' · ')
      : 'Не удалось получить подтверждённое сравнение. Таблица и выбранные товары сохранились; можно повторить позже или открыть корзину.';
    result.append(details);
    if (explanation?.tiedNames?.length) { const ties = document.createElement('p'); ties.textContent = explanation.tiedNames.join('; '); result.append(ties); }
    root.append(result);
  }
  parent.append(root);
}
