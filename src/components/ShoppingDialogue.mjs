const MAX_PREVIOUS_TURNS = 8;
const MAX_REPLY_CHARACTERS = 6000;

// Presentation only. Historical messages contain text, never live basket
// actions, and are not submitted to the AI or saved in browser storage.
export function createShoppingDialogue({ form, input, output, fallback, onClear }) {
  const document = form.ownerDocument;
  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = new URL("./shopping-dialogue.css", import.meta.url).href;
  document.head.append(stylesheet);

  const root = document.createElement("section");
  root.id = "shopping-dialogue";
  root.className = "shopping-dialogue";
  root.setAttribute("aria-label", "Переписка с Мойрой о покупках");
  root.hidden = true;

  const header = document.createElement("div");
  header.className = "shopping-dialogue-header";
  const heading = document.createElement("strong");
  heading.textContent = "Мойра · о покупках";
  const clear = document.createElement("button");
  clear.type = "button";
  clear.id = "shopping-dialogue-clear";
  clear.className = "text-button";
  clear.textContent = "Очистить переписку";
  header.append(heading, clear);

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
  speaker.textContent = "Мойра";
  speaker.hidden = true;

  const note = document.createElement("p");
  note.className = "shopping-dialogue-note";
  note.textContent = "Переписка — до перезагрузки. Очистка не меняет корзину и предпочтения.";
  output.setAttribute("aria-atomic", "true");
  root.append(header, history, previousNote, user, speaker, output, fallback, note);
  form.prepend(root);

  const label = form.querySelector('label[for="basket-proposal-input"] .sr-only');
  if (label) label.textContent = "Сообщение Мойре о покупках";
  input.placeholder = "Покупки или вопрос — например: как выбрать сыр?";
  const help = document.getElementById("basket-proposal-help");
  if (help) help.textContent = "Напиши список покупок, свои условия или вопрос о товарах. Можешь уточнять ответ следующим сообщением.";
  const title = document.getElementById("phrase-entry-title");
  if (title) title.textContent = "Поговорим о покупках";

  let active = null;
  let previous = [];

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
      label.textContent = "Мойра · прежний ответ";
      answer.append(label);
      for (const text of turn.reply) {
        const paragraph = document.createElement("p");
        paragraph.textContent = text;
        answer.append(paragraph);
      }
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
    previous.push({ user: active.user, reply: active.reply.length ? active.reply : ["Запрос отменён. Отправь новое сообщение, чтобы продолжить."] });
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
    active = { user: normalized, reply: [], pending: true };
    user.textContent = `Ты: ${normalized}`;
    user.hidden = false;
    speaker.hidden = false;
    root.hidden = false;
  }

  function sync(state) {
    root.hidden = !active && !previous.length && !output.childElementCount;
    speaker.hidden = !output.childElementCount;
    if (!active) return;
    if (state.status === "idle") { archiveActive(); return; }
    active.pending = state.status === "loading";
    if (active.pending) return;
    let remaining = MAX_REPLY_CHARACTERS;
    active.reply = [...output.querySelectorAll(".proposal-message, .proposal-detail, .proposal-preview-list li, .proposal-problems li")]
      .map(node => {
        const text = (node.textContent ?? "").trim().slice(0, remaining);
        remaining -= text.length;
        return text;
      }).filter(Boolean);
  }

  clear.addEventListener("click", () => {
    active = null;
    previous = [];
    user.hidden = true;
    speaker.hidden = true;
    renderHistory();
    onClear();
    input.focus({ preventScroll: true });
  });

  return Object.freeze({ begin, sync });
}
