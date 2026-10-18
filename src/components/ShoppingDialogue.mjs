import { shoppingReferenceSources } from "../intelligence/shoppingProductReference.mjs";
import { retailSelectionUrl } from "../intelligence/retailProductSelection.mjs";
import { formatRubMinor } from "./ComparisonResult.mjs";
import { renderGuidedShoppingTable } from "./GuidedShoppingTable.mjs";
import { createHoriWorkspace } from "./HoriWorkspace.mjs";

const MAX_PREVIOUS_TURNS = 8;
const MAX_REPLY_CHARACTERS = 6000;

// Presentation only. These archived views never contain live basket actions
// or enter browser storage. The conversation flow separately retains a small
// set of validated advice exchanges for contextual provider questions.
export function createShoppingDialogue({ form, input, output, fallback, onClear, onOpenBasket }) {
  const document = form.ownerDocument;
  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = new URL("./shopping-dialogue.css", import.meta.url).href;
  document.head.append(stylesheet);

  const root = document.createElement("section");
  root.id = "shopping-dialogue";
  root.className = "shopping-dialogue";
  root.setAttribute("aria-label", "Переписка с помощником CHECKNI о покупках");
  root.hidden = true;

  const header = document.createElement("div");
  header.className = "shopping-dialogue-header";
  const heading = document.createElement("strong");
  heading.textContent = "Хори";
  const clear = document.createElement("button");
  clear.type = "button";
  clear.id = "shopping-dialogue-clear";
  clear.className = "text-button";
  clear.textContent = "Очистить переписку";
  header.append(heading, clear);

  const welcome = document.createElement('section'); welcome.className = 'shopping-welcome';
  welcome.setAttribute('aria-label', 'С чего начнём покупки');
  const entry = document.createElement('div'); entry.className = 'shopping-conversation-choices';
  for (const [label, text] of [['Собрать корзину', 'Собери недорогую корзину'],
    ['У меня есть список', null]]) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
    button.addEventListener('click', () => { if (!text) { const greeting = welcome.querySelector('.hori-greeting'); if (greeting) greeting.textContent = 'Напиши продукты одним сообщением — помогу собрать список.'; input.focus({ preventScroll: true }); return; } input.value = text; input.dispatchEvent(new Event('input', { bubbles: true })); form.requestSubmit(); });
    entry.append(button);
  }
  welcome.append(entry);

  const history = document.createElement("ol");
  history.id = "shopping-dialogue-history";
  history.className = "shopping-dialogue-history";
  history.setAttribute("aria-label", "Предыдущие сообщения, только для чтения");
  history.setAttribute("aria-live", "off");
  history.tabIndex = 0;
  history.hidden = true;

  const previousNote = document.createElement("p");
  previousNote.className = "shopping-dialogue-note";
  previousNote.textContent = "Это прошлые ответы. Цены и изменения корзины проверяй новым запросом.";
  previousNote.hidden = true;

  const user = document.createElement("p");
  user.id = "shopping-dialogue-user";
  user.className = "shopping-dialogue-user";
  user.hidden = true;
  const speaker = document.createElement("span");
  speaker.className = "shopping-dialogue-speaker";
  speaker.textContent = "Помощник CHECKNI";
  speaker.hidden = true;

  const note = document.createElement("p");
  note.className = "shopping-dialogue-note";
  note.textContent = "Переписка — до перезагрузки. Очистка не меняет корзину и предпочтения.";
  output.setAttribute("aria-atomic", "true");
  root.append(header, history, previousNote, user, speaker, output, fallback, note);
  form.prepend(root);
  form.querySelector('.proposal-box').after(welcome);

  const label = form.querySelector('label[for="basket-proposal-input"] .sr-only');
  if (label) label.textContent = "Сообщение помощнику CHECKNI о покупках";
  input.placeholder = 'Например: недорогая корзина на неделю для троих';
  const help = document.getElementById("basket-proposal-help");
  if (help) help.textContent = "Напиши список покупок, свои условия или вопрос о товарах. Можешь уточнять ответ следующим сообщением.";
  const title = document.getElementById("phrase-entry-title");
  if (title) title.textContent = 'Привет! 👋 Соберём покупки?';
  const workspace = createHoriWorkspace({ form, input, output, welcome, dialogue: root });

  let active = null;
  let previous = [];

  function appendSources(parent, key) {
    const sources = shoppingReferenceSources(key);
    if (!sources.length) return;
    const paragraph = document.createElement("p");
    paragraph.className = "shopping-dialogue-sources";
    paragraph.append("Общий справочник: ");
    for (const [index, source] of sources.entries()) {
      if (index) paragraph.append(" · ");
      const link = document.createElement("a");
      link.textContent = source.title;
      link.href = source.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      paragraph.append(link);
    }
    parent.append(paragraph);
  }

  function renderHistory() {
    history.replaceChildren();
    for (const turn of previous) {
      const entry = document.createElement("li");
      const question = document.createElement("p");
      question.className = "shopping-dialogue-user";
      question.textContent = `Ты: ${turn.user}`;
      const answer = document.createElement("div");
      answer.className = "shopping-dialogue-answer";
      const label = document.createElement("span");
      label.className = "shopping-dialogue-speaker";
      label.textContent = "Помощник CHECKNI · прежний ответ";
      answer.append(label);
      for (const text of turn.reply) {
        const paragraph = document.createElement("p");
        paragraph.textContent = text;
        answer.append(paragraph);
      }
      appendSources(answer, turn.referenceKey);
      entry.append(question, answer);
      history.append(entry);
    }
    history.hidden = !previous.length;
    previousNote.hidden = !previous.length;
    history.scrollTop = history.scrollHeight;
    root.hidden = !active && !previous.length;
  }

  function archiveActive() {
    if (!active) return;
    previous.push({ user: active.user, reply: active.reply.length ? active.reply : ["Запрос отменён. Отправь новое сообщение, чтобы продолжить."], referenceKey: active.referenceKey });
    previous = previous.slice(-MAX_PREVIOUS_TURNS);
    active = null;
    user.hidden = true;
    speaker.hidden = true;
    renderHistory();
  }

  function begin(text) {
    const normalized = typeof text === "string" ? text.trim() : "";
    if (!normalized || normalized.length > 300) { archiveActive(); return; }
    if (active?.pending && active.user === normalized) return;
    archiveActive();
    welcome.hidden = true;
    active = { user: normalized, reply: [], pending: true };
    user.textContent = `Ты: ${normalized}`;
    user.hidden = false;
    speaker.hidden = false;
    root.hidden = false;
  }

  function sync(state) {
    root.dataset.guided = String(state.result?.guidedShopping === true);
    output.querySelectorAll('.guided-shopping').forEach(node => node.remove());
    renderGuidedShoppingTable(output, state.presentation?.guidedShopping, text => {
      input.value = text; input.dispatchEvent(new Event('input', { bubbles: true })); form.requestSubmit();
    }, onOpenBasket);
    output.querySelectorAll(".shopping-conversation-choices").forEach(node => node.remove());
    if (Array.isArray(state.presentation?.conversationChoices)) {
      const choices = document.createElement("div"); choices.className = "shopping-conversation-choices";
      choices.setAttribute("aria-label", "Ответить помощнику");
      for (const suggestion of state.presentation.conversationChoices.slice(0, 3)) {
        if (typeof suggestion?.label !== "string" || typeof suggestion.text !== "string" || !suggestion.text.trim() || suggestion.text.length > 300) continue;
        const button = document.createElement("button"); button.type = "button"; button.textContent = suggestion.label;
        button.addEventListener("click", () => { input.value = suggestion.text; input.dispatchEvent(new Event("input", { bubbles: true })); form.requestSubmit(); });
        choices.append(button);
      }
      if (choices.childElementCount) output.append(choices);
    }
    output.querySelectorAll(".shopping-selection-cards").forEach(node => node.remove());
    if (Array.isArray(state.presentation?.selectionCards) && state.presentation.selectionCards.length) {
      const list = document.createElement("div");
      list.className = "shopping-selection-cards";
      list.setAttribute("aria-label", "Варианты из выбранного каталога");
      for (const [index, card] of state.presentation.selectionCards.slice(0, 5).entries()) {
        const article = document.createElement("article"); article.className = "shopping-selection-card";
        const imageUrl = retailSelectionUrl(card.imageUrl, card.retailerId, "imageUrlRules");
        if (imageUrl) { const image = document.createElement("img"); image.src = imageUrl; image.alt = card.name; image.loading = "lazy"; image.decoding = "async"; image.referrerPolicy = "no-referrer"; image.addEventListener("error", () => image.remove(), { once: true }); article.append(image); }
        const title = document.createElement("strong"); title.textContent = `${index + 1}. ${card.name}`; article.append(title);
        const details = document.createElement("p"); details.textContent = `${card.unit ?? "Упаковка не уточнена"} · ${formatRubMinor(card.priceMinor)} · ${card.priceConditionLabel ?? "Условие цены неизвестно"}`; article.append(details);
        const provenance = document.createElement("p"); provenance.textContent = `${card.storeName ?? card.retailerDisplayName} · наблюдение ${new Date(card.observedAt).toLocaleDateString("ru-RU", { timeZone: "UTC" })} · наличие неизвестно`; article.append(provenance);
        const sourceUrl = retailSelectionUrl(card.sourceUrl, card.retailerId);
        if (sourceUrl) { const source = document.createElement("a"); source.href = sourceUrl; source.textContent = "Источник"; source.target = "_blank"; source.rel = "noopener noreferrer"; article.append(source); }
        const choice = document.createElement("button"); choice.type = "button"; choice.textContent = `Выбрать вариант ${index + 1}`;
        choice.addEventListener("click", () => { input.value = `Выбираю вариант ${index + 1}`; input.dispatchEvent(new Event("input", { bubbles: true })); form.requestSubmit(); });
        article.append(choice); list.append(article);
      }
      output.append(list);
    }
    output.querySelectorAll(".shopping-dialogue-sources").forEach(node => node.remove());
    appendSources(output, state.presentation?.referenceKey);
    root.hidden = !active && !previous.length && !output.childElementCount;
    welcome.hidden = Boolean(active || previous.length || state.status !== 'idle');
    clear.hidden = !active && !previous.length;
    speaker.hidden = !output.childElementCount;
    if (state.result?.guidedShopping) {
      fallback.hidden = true;
      for (const button of output.querySelectorAll('button')) if (button.textContent === 'Написать уточнение') button.hidden = true;
    }
    workspace.present();
    if (!active) return;
    if (state.status === "idle") { archiveActive(); return; }
    active.pending = state.status === "loading";
    if (active.pending) return;
    active.referenceKey = state.presentation?.referenceKey;
    let remaining = MAX_REPLY_CHARACTERS;
    active.reply = [...output.querySelectorAll(".proposal-message, .proposal-detail, .proposal-preview-list li, .proposal-problems li, .shopping-selection-card, .guided-shopping-total, .guided-shopping-comparison")]
      .map(node => {
        const text = (node.textContent ?? "").trim().slice(0, remaining);
        remaining -= text.length;
        return text;
      }).filter(Boolean);
  }

  clear.addEventListener("click", () => {
    active = null;
    previous = [];
    const greeting = welcome.querySelector('.hori-greeting');
    if (greeting) greeting.textContent = 'Привет! Я Хори. Что покупаем?';
    user.hidden = true;
    speaker.hidden = true;
    renderHistory();
    onClear();
    input.focus({ preventScroll: true });
  });

  return Object.freeze({ begin, sync });
}
