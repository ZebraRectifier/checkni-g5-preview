// User needs are independent of catalogue identities. No SKU or offer is inferred here.
export const NEED_LIMIT = 80;
export const normalizeNeedText = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase('ru').replaceAll('ё', 'е').replace(/\s+/gu, ' ').trim();
const words = { один:1, одна:1, одну:1, одно:1, два:2, две:2, три:3, четыре:4, пять:5, шесть:6, семь:7, восемь:8, девять:9, десять:10, одиннадцать:11, двенадцать:12, тринадцать:13, четырнадцать:14, пятнадцать:15, шестнадцать:16, семнадцать:17, восемнадцать:18, девятнадцать:19, двадцать:20, тридцать:30, сорок:40, пятьдесят:50, сто:100, полтора:'1.5', полторы:'1.5', полкило:'0.5', поллитра:'0.5', половину:'0.5', половина:'0.5' };
const numberPattern = `(?:\\d+(?:[.,]\\d+)?|${Object.keys(words).join('|')})`;
const unitPattern = '(?:бутыл[а-я]*|пач[а-я]*|упаков[а-я]*|пакет[а-я]*|короб[а-я]*|бан[а-я]*|пуч[а-я]*|голов[а-я]*|штук[а-я]*|шт\\.?|килограмм[а-я]*|кг|грамм[а-я]*|гр?\\.?|миллилитр[а-я]*|мл|литр[а-я]*|л)';
const quantityRe = new RegExp(`^(${numberPattern})(?:\\s*(${unitPattern}))?(?:\\s+|$)`, 'iu');
const packageRe = new RegExp(`\\s+по\\s+(${numberPattern})\\s*(${unitPattern})(?=\\s|$)`, 'iu');
export function decimal(value) {
  const raw = String(words[normalizeNeedText(value)] ?? value).replace(',', '.');
  if (!/^\d+(?:\.\d{1,3})?$/u.test(raw) || Number(raw) <= 0 || Number(raw) > 1000000) return null;
  const [whole, fraction] = raw.split('.');
  return `${Number(whole)}${fraction?.replace(/0+$/u, '') ? `.${fraction.replace(/0+$/u, '')}` : ''}`;
}
export function addDecimal(a, b) {
  const scaled = v => { const [w, f = ''] = v.split('.'); return BigInt(w) * 1000n + BigInt(f.padEnd(3, '0')); };
  const total = scaled(a) + scaled(b);
  return decimal(`${total / 1000n}.${String(total % 1000n).padStart(3, '0')}`);
}
function unitOf(raw = '') {
  const unit = normalizeNeedText(raw).replace('.', '');
  if (/^(кг|килограмм)/u.test(unit)) return ['kg', 'mass'];
  if (/^(г|гр|грамм)$/u.test(unit) || /^грамм/u.test(unit)) return ['g', 'mass'];
  if (/^(мл|миллилитр)/u.test(unit)) return ['ml', 'volume'];
  if (/^(л|литр)/u.test(unit)) return ['l', 'volume'];
  for (const [pattern, label] of [[/^бутыл/u,'bottle'],[/^пач|^упаков/u,'pack'],[/^короб/u,'box'],[/^бан/u,'can'],[/^пакет/u,'bag'],[/^пуч/u,'bunch'],[/^голов/u,'head']]) {
    if (pattern.test(unit)) return [label, 'container_count'];
  }
  return ['piece', 'count'];
}
const labels = { bottle:'бут.', pack:'уп.', box:'кор.', can:'бан.', bag:'пак.', bunch:'пуч.', head:'гол.', piece:'шт.', kg:'кг', g:'г', l:'л', ml:'мл' };
export const needLabel = line => line.resolution.status === 'needs_clarification' ? `${line.rawText} — количество нужно уточнить` : `${line.requestedName} — ${line.quantity.value} ${labels[line.quantity.unit] ?? line.quantity.unit}${line.packageSize ? ` по ${line.packageSize.value} ${labels[line.packageSize.unit] ?? line.packageSize.unit}` : ''}`;
export function needKey(line) { return JSON.stringify([normalizeNeedText(line.requestedName), line.quantity.unit, line.packageSize, line.attributes]); }
export function parseNeedLine(input) {
  const rawText = input.trim();
  let text = rawText.replace(/^(?:(?:мне\s+)?(?:нужно|нужны|нужен|нужна|надо)|хочу|добавь(?:те)?|запиши|купи(?:ть)?|возьми)\s+/iu, '').trim();
  text=text.replace(new RegExp(`^(?:мне|нам)\\s+(?=${numberPattern}(?:\\s|$))`,'iu'),'');
  if (!text || text.length > 300) return null;
  let packageSize = null;
  const eggPack=text.match(new RegExp(`\\s+по\\s+(${numberPattern})\\s+яиц(?=\\s|$)`,'iu'));
  if(eggPack){packageSize={value:decimal(eggPack[1]),unit:'piece'};text=text.replace(eggPack[0],' яиц');}
  text = text.replace(packageRe, (_, number, unit) => {
    packageSize = { value: decimal(number), unit: unitOf(unit)[0] }; return '';
  });
  const twoWords = text.match(/^(двадцать|тридцать|сорок|пятьдесят)\s+(один|одна|одну|два|две|три|четыре|пять|шесть|семь|восемь|девять)(?=\s|$)/iu);
  if (twoWords) text = `${Number(words[normalizeNeedText(twoWords[1])]) + Number(words[normalizeNeedText(twoWords[2])])}${text.slice(twoWords[0].length)}`;
  let matched = text.match(quantityRe);
  let value = '1', rawUnit = '', explicit = false;
  if (matched) {
    value = decimal(matched[1]); rawUnit = matched[2] ?? (/полкило/iu.test(matched[1]) ? 'кг' : /поллитра/iu.test(matched[1]) ? 'л' : '');
    text = text.slice(matched[0].length).trim(); explicit = true;
  } else {
    const suffix = text.match(new RegExp(`\\s+(${numberPattern})(?:\\s*(${unitPattern}))?$`, 'iu'));
    if (suffix) { value = decimal(suffix[1]); rawUnit = suffix[2] ?? ''; text = text.slice(0, suffix.index).trim(); explicit = true; }
  }
  text = text.replace(/[.!—–-]+$/u, '').trim();
  if (!value || packageSize?.value === null || !text || !/\p{L}/u.test(text)) return null;
  // Numeric modifiers that were not parsed stay in the original wording, never become a pack count.
  const uncertainQuantity = /(?:^|\s)(?:около|примерно|от|до)(?=\s)|\d\s*[-–]\s*\d|^[-−]\d|^(?:ноль|0)(?:\s|$)/iu.test(rawText);
  const [unit, basis] = unitOf(rawUnit);
  const attributes = {};
  for (const phrase of ['без лактозы', 'без сахара', 'без добавленного сахара', 'без газа', 'без орехов', 'без молочного белка']) {
    if (normalizeNeedText(text).includes(phrase)) attributes[phrase] = true;
  }
  return { rawText, requestedName: text, quantity: { value, unit, basis, explicit }, packageSize,
    attributes, constraints: Object.keys(attributes), resolution: { status: uncertainQuantity ? 'needs_clarification' : 'unresolved', productId: null } };
}
// A number-only reply may repeat a unit, but may not silently change its dimension.
export function parseNeedAmount(text) {
  const bare = decimal(text);
  if (bare) return { value: bare, unit: null };
  const row = parseNeedLine(`${String(text).replace(/[.!]+$/u, '')} quantitytarget`);
  return row?.requestedName === 'quantitytarget' && row.quantity.explicit
    ? { value: row.quantity.value, unit: row.quantity.unit } : null;
}
export function splitNeedClauses(text) {
  // Decimal commas are not list delimiters.
  return text.split(/(?<!\d),(?!\d)|(?<=\d),(?!\d)|(?<!\d),(?=\d)|[;\n]|\s+и\s+/iu).map(x => x.trim()).filter(Boolean);
}
export function matchNeedLines(lines, text) {
  const key = normalizeNeedText(text).replace(/[.!?]+$/u, '');
  const exact = lines.filter(row => normalizeNeedText(row.requestedName) === key);
  if (exact.length) return exact;
  const stems = value => normalizeNeedText(value).split(/[^\p{L}\p{N}]+/u).filter(Boolean).map(w => w.length > 4 ? w.replace(/(?:ами|ями|ого|его|ой|ый|ий|ая|ую|ом|ем|ов|ев|ы|и|а|я|у|ю|е|о)$/u, '') : w);
  const query = stems(key);
  return query.length ? lines.filter(row => query.every(token => stems(row.requestedName).includes(token))) : [];
}

const scaledQuantity = value => { const [whole, fraction=''] = String(value).split('.'); return BigInt(whole)*1000n+BigInt(fraction.padEnd(3,'0')); };
const printScaled = value => `${value/1000n}${value%1000n?`.${String(value%1000n).padStart(3,'0').replace(/0+$/u,'')}`:''}`;
const unitMeasure = (value, unit) => ({amount:scaledQuantity(value)*(['kg','l'].includes(unit)?1000n:1n),dimension:['kg','g'].includes(unit)?'mass':['l','ml'].includes(unit)?'volume':'count',unit:['kg','g'].includes(unit)?'г':['l','ml'].includes(unit)?'мл':'шт.'});

// Compare physical quantities from the already selected card. No price, stock,
// ingredient or nutritional claim is derived here. A person still reviews identity.
export function reviewNeedSelection(need, product) {
  const fail=message=>({ok:false,message});
  if(!need||!product||!String(product.id).startsWith('retail:'))return fail('Выбери конкретную карточку магазина в корзине.');
  if(!decimal(need.quantity?.value)||!labels[need.quantity?.unit]||!Number.isSafeInteger(product.quantity)||product.quantity<1||product.quantity>99)return fail('Не удалось проверить количество. Обнови список и выбранную карточку.');
  if(need.resolution.status==='needs_clarification')return fail('Сначала уточни исходное количество.');
  const packText=normalizeNeedText(product.unit),match=packText.match(/^(\d+(?:[.,]\d{1,3})?)\s*(кг|г|гр|л|мл|шт\.?|штук[а-я]*)$/u);
  const packValue=match&&decimal(match[1]),packUnit=match&&unitOf(match[2])[0];
  const packs=BigInt(product.quantity),required=unitMeasure(need.quantity.value,need.quantity.unit);
  let bought,unit;
  if(need.packageSize) {
    if(!decimal(need.packageSize.value)||!labels[need.packageSize.unit])return fail('Нужно уточнить размер упаковки в исходной потребности.');
    if(!packValue)return fail('У выбранной карточки не указан точный размер упаковки.');
    const wanted=unitMeasure(need.packageSize.value,need.packageSize.unit),actual=unitMeasure(packValue,packUnit);
    if(wanted.dimension!==actual.dimension||wanted.amount!==actual.amount)return fail('Размер выбранной упаковки отличается от указанного в запросе. Сначала выбери подходящую упаковку или измени потребность.');
  }
  if(['mass','volume'].includes(need.quantity.basis)) {
    if(!packValue)return fail('Для этой потребности нужен известный вес или объём упаковки.');
    const actual=unitMeasure(packValue,packUnit);
    if(actual.dimension!==required.dimension)return fail('Единицы несовместимы. Вес нельзя считать объёмом без дополнительных данных.');
    bought=actual.amount*packs;unit=actual.unit;
  } else if(need.quantity.unit==='piece'&&packUnit==='piece'&&packValue&&!need.packageSize) {
    bought=scaledQuantity(packValue)*packs;unit='шт.';
  } else if(need.quantity.unit==='piece'&&need.quantity.explicit) {
    return fail('Потребность задана в штуках, а содержимое упаковки в штуках неизвестно. Уточни, нужны ли штуки или упаковки; количество не пересчитываю.');
  } else {
    bought=packs*1000n;unit=need.quantity.explicit?labels[need.quantity.unit]:'уп.';
  }
  if(bought<required.amount)return fail(`В корзине недостаточно: ${printScaled(bought)} ${unit}; нужно ${printScaled(required.amount)} ${unit}. Измени количество в корзине.`);
  return {ok:true,message:`Нужно: ${needLabel(need)}. Выбрано: ${product.name}, ${product.unit} ×${product.quantity}. Количество: ${printScaled(bought)} ${unit}${bought>required.amount?`; больше потребности на ${printScaled(bought-required.amount)} ${unit}`:''}. Проверь название, упаковку и все нужные свойства перед подтверждением.`};
}
