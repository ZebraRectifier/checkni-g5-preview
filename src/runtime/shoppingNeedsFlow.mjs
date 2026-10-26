import { decimal, addDecimal, needKey, needLabel, normalizeNeedText, parseNeedLine, parseNeedAmount, splitNeedClauses, matchNeedLines, reviewNeedSelection, NEED_LIMIT } from '../intelligence/shoppingNeeds.mjs';
import { resolveLocalAssistantDialogue, stripAssistantGreetingPrefix } from '../intelligence/localAssistantDialogue.mjs';
import { shoppingAdviceTopic } from '../intelligence/shoppingAdvice.mjs';
import { extractShoppingDelta } from '../intelligence/shoppingConversation.mjs';
import { extractShoppingNeedContext } from '../intelligence/shoppingNeedContext.mjs';

const clone = value => JSON.parse(JSON.stringify(value));
const uid = () => globalThis.crypto?.randomUUID?.() ?? `need-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const affirmative = /^(?:да|давай|го|ок|подтверждаю|применить)[.!]*$/iu;
const negative = /^(?:нет|отмена|отмени|не надо)[.!]*$/iu;
const readOnly = /[?]|^(?:а\s+)?(?:как|како[йеяую]|что|почему|зачем|где|сколько|поч[её]м|посоветуй|расскажи|объясни|проверь|есть ли|у меня|дома есть|собери|перестрой|найди|покажи|подбери|сравни)|^(?:я|мы|ты|он|она)\s|(?:цен[аыу]|стоит|дешевле|на неделю|на месяц)/iu;
const unsupportedAction = /^(?:закажи|оформи|оплати|доставь|купи онлайн)(?:\s|$)/iu;
const attributeReply = /^(?:жирность|бренд|марка|объ[её]м|вкус|состав)(?:\s|$)|^\d+(?:[.,]\d+)?\s*%$/iu;
const actionTarget = text => text.replace(/^(?:его|её|ее|это|их)$/iu, '');
const view = (headline, message, lines = []) => ({ status:'clarification', result:{kind:'clarification',triggerReason:'needs_list'},
  presentation:{headline, message, items:[], primaryAction:'Продолжить', mascotState:'curious',
    conversationChoices:lines.filter(x=>x.resolution.status !== 'selected').slice(0,3).map(row=>({label:`Подобрать: ${row.requestedName}`,text:`подбери позицию ${lines.indexOf(row)+1}`}))} });

// The needs record owns user intent; existing conversation is an adapter for
// catalogue selection/advice. Only explicit reviewed selections enter Core.
export function createShoppingNeedsFlow({ delegate, needsStore: store, basket, resolveRetailSelectionScope }) {
  let state = delegate.getState(), ownsView = false, epoch = 0, selectionActive = false;
  const snapshot = () => store.getSnapshot();
  const display = (headline, message, pendingId=null) => { ownsView = true; state = view(headline,message,snapshot().lines);state.result.pendingId=pendingId; return state; };
  const summary = () => snapshot().lines.map(needLabel).join('; ');
  if (snapshot().lines.length) display(snapshot().pending?.kind==='clear'?'Подтверди очистку списка: да или нет.':snapshot().pending?.kind==='edit'?'Уточни название или количество.':'Список восстановлен.', summary(),snapshot().pending?.id);
  async function commit(requestId, reduce) {
    const token=epoch;
    ownsView=true;state={status:'loading'};
    const result = await store.transact({requestId,revision:snapshot().revision}, current=>token===epoch?reduce(current):null);
    if(token!==epoch)return getState();
    if (!result.ok) return display('Изменение не сохранено.', result.reason === 'conflict'
      ? 'Список изменился в другой вкладке. Я загрузила его текущее состояние; повтори нужное изменение.'
      : 'Хранилище недоступно или данные повреждены. Прежний список не перезаписан. Можно пользоваться ручной корзиной; скопируй текущую покупку перед перезагрузкой.');
    return display(result.replay ? 'Этот запрос уже выполнен.' : result.receipt.message,
      `${summary() || 'Список пуст.'}${snapshot().lines.some(x=>x.resolution.status !== 'selected') ? '\nДля сравнения цен нужно выбрать конкретные товары и упаковки. Исходные названия сохранены.' : ''}`,
      /^(?:Убрать все|Уточни)/u.test(result.receipt.message)?snapshot().pending?.id:null);
  }
  function targets(text) {
    const current = snapshot(); const target = actionTarget(text.trim());
    if (target) return matchNeedLines(current.lines,target);
    return current.lines.filter(row=>current.focus.includes(row.lineId));
  }
  function changeQuantity(state, line, amount, increment) {
    const row = state.lines.find(x=>x.lineId===line.lineId);
    // Selected rows are edited through the reviewed basket, never in two unrelated stores.
    if (!row || row.resolution.status === 'selected') return false;
    const value = increment ? addDecimal(row.quantity.value, amount) : amount;
    if (!value) return false;
    row.quantity = {...row.quantity,value,explicit:true};
    state.focus = [row.lineId]; state.pending=null; return true;
  }
  async function recordSelection(before) {
      const after=basket.getSnapshot();
      const changed=after.filter(row=>!before.some(old=>old.id===row.id&&old.quantity===row.quantity));
      if(changed.length) {
        const revision=snapshot().revision;
        await store.transact({requestId:uid(),revision},current=>{
          for(const product of changed) {
            if(current.lines.some(line=>line.resolution.status==='selected'&&line.resolution.productId===product.id))continue;
            const candidates=current.lines.filter(line=>line.resolution.status!=='selected'&&matchNeedLines([{...line,requestedName:product.name}],line.requestedName).length===1);
            if(candidates.length!==1) continue;
            const line=candidates[0];
            // A measured need cannot become a number of packs without a reviewed conversion.
            if(!['count','container_count'].includes(line.quantity.basis)||Number(line.quantity.value)!==product.quantity||line.packageSize||line.resolution.status==='needs_clarification') continue;
            line.resolution={status:'selected',productId:product.id,selectedRow:clone(product)};
          }
          return {state:current,message:'Выбор товара записан.'};
        });
      }
  }
  async function select(text, token) {
    ownsView=false; selectionActive=true;
    const before = basket.getSnapshot();
    await delegate.run(text);
    if(token!==epoch) return getState();
    state=delegate.getState();
    if(state.status==='success') {
      selectionActive=true;
      await recordSelection(before);
    }
    return state;
  }
  async function run(input, metadata={}) {
    const token=++epoch;
    if(typeof input!=='string'||!input.trim()||input.trim().length>300) {ownsView=false;return delegate.run(input);}
    store.refresh();
    const text=stripAssistantGreetingPrefix(input.trim()), key=normalizeNeedText(text), requestId=metadata.requestId??uid();
    const receipt=snapshot().receipts.find(row=>row.requestId===requestId);
    if(receipt) return display('Этот запрос уже выполнен.',summary()||'Список пуст.');
    if(/^(?:мой список|покажи список|что в списке|продолжить)[.!?]*$/iu.test(text)) return display('Текущий список.',summary()||'Напиши, что купить.');
    const clarification=snapshot().pending;
    if(clarification?.kind==='edit'&&ownsView&&state.result.pendingId===clarification.id&&!negative.test(text)) {
      if(affirmative.test(text))return display('Уточни название или количество.',summary(),clarification.id);
      const possible=snapshot().lines.filter(row=>clarification.targetIds.includes(row.lineId));
      const quantity=decimal(text),chosen=quantity&&possible.length===1?possible:matchNeedLines(possible,text);
      const amount=quantity??clarification.amount;
      if(chosen.length===1&&(clarification.action==='remove'||amount))return run(clarification.action==='remove'?`удали ${chosen[0].requestedName}`:clarification.action==='increment'?`ещё ${amount} ${chosen[0].requestedName}`:`${chosen[0].requestedName} оставь ${amount}`,{requestId});
    }
    if(affirmative.test(text)&&(ownsView||(!selectionActive&&snapshot().lines.length))) {
      const pending=snapshot().pending;
      if(pending?.kind==='clear'&&pending.id===state.result.pendingId) return commit(requestId,current=>{
        current.undo={lines:clone(current.lines),focus:clone(current.focus)};current.lines=[];current.focus=[];current.pending=null;
        return {state:current,message:'Список потребностей очищен. Выбранные товары в корзине сохранены.'};
      });
      return display('Список уже сохранён.',`${summary()||'Напиши, что купить.'} Новых товаров по этому ответу не добавляю.`);
    }
    if(negative.test(text)&&ownsView) return commit(requestId,current=>{current.pending=null;return {state:current,message:'Отменено. Исходные покупки сохранены.'};});
    if(/^(?:очисти список|удали всё|удали все)[.!]*$/iu.test(text)) return commit(requestId,current=>{current.pending={kind:'clear',id:requestId,revision:current.revision};return {state:current,message:`Убрать все ${current.lines.length} позиций потребности? Ответь «да» или «нет».`};});
    if(/^(?:отмени последнее|верни как было|откат)[.!]*$/iu.test(text)) {
      if(!snapshot().undo) return display('Нет изменения для отмены.','Текущий список сохранён.');
      return commit(requestId,current=>{current.lines=current.undo.lines;current.focus=current.undo.focus;current.undo=null;current.pending=null;return {state:current,message:'Последнее изменение списка отменено.'};});
    }
    const selection=text.match(/^подбери позицию (\d+)$/iu);
    if(selection) {
      const line=snapshot().lines[Number(selection[1])-1];
      if(!line) return display('Позиция изменилась.','Открой текущий список и выбери нужную строку.');
      if(!resolveRetailSelectionScope?.()) return display('Выбери магазин.',`${needLabel(line)} сохранено. Открой магазин, затем нажми «Подобрать» ещё раз.`);
      if(line.resolution.status==='needs_clarification'||!['count','container_count'].includes(line.quantity.basis)||Number(line.quantity.value)>99||!Number.isInteger(Number(line.quantity.value))||line.packageSize) return display('Нужно выбрать упаковку.',`${needLabel(line)} сохранено. Найди товар в магазине и выбери подходящую упаковку вручную; я не буду округлять количество или переводить вес в упаковки.`);
      return select(`Хочу ${line.quantity.value} ${line.requestedName}`,token);
    }
    if(unsupportedAction.test(text))return display('Покупка не оформлена.','CHECKNI помогает собрать список и сравнить доступные предложения. Оформить заказ здесь нельзя. Текущий список сохранён.');
    if(attributeReply.test(text)&&(!selectionActive||ownsView))return display('Уточни полное название товара.',`«${text}» — характеристика, а не новая покупка. Напиши название вместе с нужным свойством; текущий список сохранён.`);
    // A question is not a list of products even if it contains punctuation.
    if(/^(?:проверь|есть ли)(?:\s|,|$)/iu.test(text)) {ownsView=false;selectionActive=false;await delegate.run(text);return delegate.getState();}
    if(selectionActive&&!ownsView&&delegate.hasActiveGuidedShopping?.()&&!/^(?:хочу|добавь|купи|запиши)\s/iu.test(text))return select(text,token);
    // Household/time qualifiers apply to the complete request, not just the
    // last comma-separated product. Preserve the existing reviewed journey.
    if(extractShoppingNeedContext(text).recognized) {
      ownsView=false;await delegate.run(text);state=delegate.getState();
      selectionActive=delegate.hasActiveShoppingSelection?.()===true;return state;
    }
    const compound=splitNeedClauses(text);
    const compoundOperation=compound.some(part=>/^(?:удали|убери|исключи)\s|\s(?:оставь|сделай|всего|ещ[её])\s|\s(?:убери|удали|не\s+(?:надо|нужно))$/iu.test(part)
      ||readOnly.test(part)||unsupportedAction.test(part)||attributeReply.test(part)
      ||(parseNeedLine(part)&&snapshot().lines.some(row=>needKey(row)===needKey(parseNeedLine(part)))));
    if(compound.length>1&&compoundOperation&&!/^не\s+.+?,?\s+а\s+/iu.test(text)&&!readOnly.test(compound[0])) {
      const trial=clone(snapshot()),before=clone(trial.lines),notices=[];let failed=null;
      for(const part of compound) {
        if(readOnly.test(part)||unsupportedAction.test(part)||attributeReply.test(part)){notices.push(`Отдельно нужно разобрать: «${part}». Отправь этот вопрос или действие следующим сообщением.`);continue;}
        const deletion=part.match(/^(?:удали|убери|исключи)\s+(.+)$/iu)??part.match(/^(.+?)\s+(?:убери|удали|не\s+(?:надо|нужно))$/iu);
        const setting=part.match(/^(.+?)\s+(?:оставь|сделай|всего)\s+(.+)$/iu);
        const more=part.match(/^(.+?)\s+ещ[её]\s+(.+)$/iu);
        if(deletion||setting||more) {
          const found=matchNeedLines(trial.lines,(deletion??setting??more)[1]);
          if(deletion&&!found.length){notices.push(`«${deletion[1]}» в списке нет, не добавляю.`);continue;}
          if(found.length!==1||found[0].resolution.status==='selected'){failed=part;break;}
          if(deletion)trial.lines=trial.lines.filter(row=>row.lineId!==found[0].lineId);
          else {const amount=decimal((setting??more)[2]);if(!amount||!changeQuantity(trial,found[0],amount,Boolean(more))){failed=part;break;}}
        } else {
          const line=parseNeedLine(part);
          if(!line){failed=part;break;}
          if(trial.lines.some(row=>needKey(row)===needKey(line))){notices.push(`«${line.requestedName}» уже есть: прежнее количество сохранено. Для прибавления напиши «ещё» и число.`);continue;}
          trial.lines.push({...line,lineId:uid(),provenance:{messageId:requestId,evidence:part}});
        }
      }
      if(failed)return display('Уточни часть команды.',`«${failed}» не удалось применить однозначно. Вся команда оставлена без изменений; прежний список сохранён.`);
      selectionActive=false;delegate.invalidate();
      return commit(requestId,current=>{current.undo={lines:before,focus:clone(current.focus)};current.lines=trial.lines;current.focus=trial.lines.filter(x=>!before.some(y=>y.lineId===x.lineId)).map(x=>x.lineId);current.pending=null;return {state:current,message:`Список сохранён. ${notices.join(' ')}`.trim()};});
    }
    const correction=text.match(/^не\s+(.+?),?\s+а\s+(.+?)[.!]*$/iu);
    const increment=text.match(/^(?:ещ[её]|добавь ещ[её]|прибавь)\s+(.+?)[.!]*$/iu);
    const remove=text.match(/^(?:удали|убери|исключи)\s+(.+?)[.!]*$/iu)??text.match(/^(.+?)\s+(?:убери|удали|не\s+(?:надо|нужно))[.!]*$/iu);
    const set=text.match(/^(.+?)\s+(?:оставь|сделай|всего)\s+(.+?)[.!]*$/iu);
    if(correction||increment||remove||set) {
      const measuredAmount=parseNeedAmount(correction?.[2]??set?.[2]??increment?.[1]??'');
      let amount=measuredAmount?.value;
      let target=set?.[1]??remove?.[1]??'';
      if(increment&&!amount) { const parsed=parseNeedLine(increment[1]); if(parsed?.quantity.explicit){amount=parsed.quantity.value;target=parsed.requestedName;} }
      const matches=targets(target);
      if(selectionActive&&!ownsView&&(!matches.length||matches.some(line=>line.resolution.status==='selected')))return select(text,token);
      if(matches.length!==1||(!remove&&!amount))return commit(requestId,current=>{
        current.pending={kind:'edit',id:requestId,action:remove?'remove':increment?'increment':'set',amount,
          targetIds:(matches.length?matches:current.lines).map(row=>row.lineId)};
        return {state:current,message:'Уточни одну позицию: напиши её название или нужное число.'};
      });
      const line=matches[0];
      if(measuredAmount?.unit&&measuredAmount.unit!==line.quantity.unit)return display('Уточни единицу количества.',`Сейчас сохранено: ${needLabel(line)}. «${text}» использует другую единицу; количество не изменено.`);
      if(line.resolution.status==='selected') return display('Товар уже выбран в корзине.',`Измени «${line.requestedName}» кнопками корзины, чтобы потребность и выбранная упаковка не разошлись.`);
      return commit(requestId,current=>{
        current.undo={lines:clone(current.lines),focus:clone(current.focus)};
        if(remove) {current.lines=current.lines.filter(x=>x.lineId!==line.lineId);current.focus=[];current.pending=null;}
        else {
          if(!changeQuantity(current,line,amount,Boolean(increment))) return null;
          current.lines.find(row=>row.lineId===line.lineId).provenance.quantity={messageId:requestId,evidence:text};
        }
        return {state:current,message:remove?'Позиция удалена из списка.':'Количество изменено.',lineIds:[line.lineId]};
      });
    }
    if(selectionActive&&!ownsView&&(/^(?:(?:нет|не)(?:\s|,)|давай\s|выбираю\s+(?:вариант\s+)?|вариант\s+)/iu.test(text)
      ||(!parseNeedLine(text)?.quantity.explicit&&!/^(?:хочу|добавь|купи|запиши|мне\s+(?:нужно|надо))\s/iu.test(text)))) return select(text,token);
    if(/^(?:нет|не|отмена)(?:\s|,)/iu.test(text))return display('Уточни, что изменить.',`Исходные покупки сохранены: ${summary()||'пока пусто'}. Напиши, например, «удали молоко» или «молоко оставь 2».`);
    if(/^(?:а\s+)?(?:сколько стоит|поч[её]м|какая цена)/iu.test(text)&&snapshot().focus.length===1) {
      const line=snapshot().lines.find(row=>row.lineId===snapshot().focus[0]);
      if(line&&line.resolution.status!=='selected')return display('Нужна конкретная карточка.',`Для «${line.requestedName}» ещё не выбраны товар и упаковка. Потребность сохранена; выбери магазин и товар, затем CHECKNI проверит доступные цены.`);
    }
    const delta=extractShoppingDelta(text);
    if(resolveLocalAssistantDialogue(text)||shoppingAdviceTopic(text)||readOnly.test(text)||Object.keys(delta.facts??{}).length||delta.reset||delta.undo||delta.reject?.length) {
      ownsView=false;await delegate.run(text);state=delegate.getState();selectionActive=delegate.hasActiveShoppingSelection?.()===true;return state;
    }
    if(affirmative.test(text)||negative.test(text)) return display('Продолжим со списком.',summary()||'Напиши покупки или вопрос о товарах.');
    const clauses=splitNeedClauses(text),lines=clauses.map(parseNeedLine);
    if(!lines.length||lines.some(x=>!x)||snapshot().lines.length+lines.length>NEED_LIMIT) return display('Уточни запись покупки.',`Не удалось безопасно разделить название и количество. Напиши, например: «тофу — 2 пачки». Предыдущие ${snapshot().lines.length} позиций сохранены.`);
    const duplicates=lines.filter(line=>snapshot().lines.some(old=>needKey(old)===needKey(line)));
    if(duplicates.length) return display('Такая покупка уже есть.',`${summary()} Если нужно увеличить количество, напиши «ещё 2» с названием товара; для замены количества — «название оставь 2».`);
    selectionActive=false;delegate.invalidate();
    const result=await commit(requestId,current=>{
      current.undo={lines:clone(current.lines),focus:clone(current.focus)};
      const added=lines.map(line=>({...line,lineId:uid(),provenance:{messageId:requestId,evidence:line.rawText,
        quantity:{messageId:requestId,evidence:line.rawText,origin:line.quantity.explicit?'explicit':'default'},requestedName:{messageId:requestId,evidence:line.rawText,origin:'explicit'}}}));
      current.lines.push(...added);current.focus=added.map(x=>x.lineId);current.pending=null;
      return {state:current,message:`Записано в список: ${added.map(needLabel).join('; ')}.`,lineIds:current.focus};
    });
    if(token!==epoch) return getState();
    // Existing source selection remains available immediately inside a store.
    if(result.presentation.headline.startsWith('Записано')&&resolveRetailSelectionScope?.()
      &&lines.every(line=>line.resolution.status!=='needs_clarification'&&['count','container_count'].includes(line.quantity.basis)&&!line.packageSize&&Number.isInteger(Number(line.quantity.value))&&Number(line.quantity.value)<=99)) return select(text,token);
    return result;
  }
  function getState(){return ownsView?state:delegate.getState();}
  function edit(){epoch++;if(!ownsView)delegate.edit();return getState();}
  function invalidate(){epoch++;selectionActive=false;delegate.invalidate();ownsView=false;state=delegate.getState();return state;}
  function confirm(mode){
    if(ownsView)return state;
    const before=basket.getSnapshot(),next=delegate.confirm(mode);
    if(next.status==='success')void recordSelection(before);
    return next;
  }
  async function removeNeed(lineId) {
    epoch++;selectionActive=false;delegate.invalidate();
    return commit(uid(),current=>{
      if(!current.lines.some(row=>row.lineId===lineId))return null;
      current.undo={lines:clone(current.lines),focus:clone(current.focus)};
      current.lines=current.lines.filter(row=>row.lineId!==lineId);current.focus=current.focus.filter(id=>id!==lineId);current.pending=null;
      return {state:current,message:'Потребность убрана из списка. Выбранная корзина сохранена.'};
    });
  }
  async function linkNeed(lineId, reviewedProduct) {
    epoch++;selectionActive=false;delegate.invalidate();
    const before=snapshot(),line=before.lines.find(row=>row.lineId===lineId);
    const validation=reviewNeedSelection(line,reviewedProduct);
    if(!validation.ok)return validation;
    const result=await store.transact({requestId:uid(),revision:before.revision},current=>{
      const actual=basket.getSnapshot().find(row=>row.id===reviewedProduct.id);
      if(JSON.stringify(actual)!==JSON.stringify(reviewedProduct))return null;
      const target=current.lines.find(row=>row.lineId===lineId);
      if(!reviewNeedSelection(target,actual).ok)return null;
      // One pack cannot silently fulfil two independent needs.
      if(current.lines.some(row=>row.lineId!==lineId&&row.resolution.status==='selected'&&row.resolution.productId===actual.id))return null;
      current.undo={lines:clone(current.lines),focus:clone(current.focus)};
      target.resolution={status:'selected',productId:actual.id,selectedRow:clone(actual),origin:'explicit_manual_review'};
      current.focus=[lineId];current.pending=null;
      return {state:current,message:'Соответствие потребности выбранному товару подтверждено.',lineIds:[lineId]};
    });
    return result.ok?{ok:true,message:result.receipt.message}:{ok:false,message:'Соответствие не сохранено: список или корзина изменились, товар уже связан с другой потребностью либо запись недоступна. Проверь актуальные строки.'};
  }
  return Object.freeze({...delegate,run,getState,edit,invalidate,confirm,
    getShoppingNeeds:()=>snapshot().lines,
    getUnresolvedNeeds:()=>snapshot().lines.filter(line=>line.resolution.status!=='selected'||!basket.getSnapshot().some(row=>JSON.stringify(row)===JSON.stringify(line.resolution.selectedRow))),
    removeNeed, linkNeed, needsStore:store });
}
