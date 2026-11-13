import { getExternalCheckSources } from "../data/commerceSources.mjs";

export function buildAggregatorChecksModel(sources = getExternalCheckSources()) {
  return Object.freeze({
    title: "Проверить в сервисах",
    note: "Откроем сервис отдельно. Корзина не переносится, а цены и наличие CHECKNI оттуда пока не импортирует.",
    sources: Object.freeze(sources.map((source) => Object.freeze({
      id: source.id,
      name: source.name,
      url: source.url
    })))
  });
}

export function createAggregatorChecks(sources) {
  const model = buildAggregatorChecksModel(sources);

  const section = document.createElement("section");
  section.className = "future-step aggregator-checks";
  section.setAttribute("aria-labelledby", "aggregator-checks-title");

  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = "Внешняя проверка";

  const heading = document.createElement("h2");
  heading.id = "aggregator-checks-title";
  heading.textContent = model.title;

  const note = document.createElement("p");
  note.className = "aggregator-note";
  note.textContent = model.note;

  const links = document.createElement("div");
  links.className = "aggregator-links";

  model.sources.forEach((source) => {
    const link = document.createElement("a");
    link.className = "aggregator-link";
    link.href = source.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.setAttribute("aria-label", `Открыть ${source.name} в новой вкладке`);

    const label = document.createElement("span");
    label.textContent = source.name;

    const arrow = document.createElement("span");
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = "↗";

    link.append(label, arrow);
    links.append(link);
  });

  section.append(eyebrow, heading, note, links);
  return section;
}
