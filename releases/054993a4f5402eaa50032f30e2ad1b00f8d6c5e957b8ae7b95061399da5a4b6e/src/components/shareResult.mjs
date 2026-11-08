// Share the snapshot comparison as an 8-bit PNG card. Uses only canvas and
// inline pixel art; the image itself carries the honesty footer (source,
// date, region not confirmed).

import { PIXEL_ICONS } from "./pixelIcons.mjs";

const INK = "#241f1c";
const BG = "#f2eeda";
const CARD = "#fbf8ec";
const GREEN = "#2f7d32";
const GREEN_SOFT = "#dff0d0";
const YELLOW = "#f4c430";

function svgToImage(svg) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg)));
  });
}

function pxRect(ctx, x, y, w, h, fill, border = INK, bw = 4) {
  ctx.fillStyle = border;
  ctx.fillRect(x - bw, y - bw, w + bw * 2, h + bw * 2);
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
}

export async function renderShareCard(model) {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 630;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;

  // background + frame
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, 1200, 630);
  ctx.fillStyle = BG;
  ctx.fillRect(12, 12, 1176, 606);

  // brand
  ctx.fillStyle = INK;
  ctx.font = "800 44px 'Courier New', monospace";
  ctx.textBaseline = "top";
  ctx.fillText("CHECKNI", 56, 48);
  ctx.fillStyle = GREEN;
  ctx.fillRect(56, 100, 110, 8);
  ctx.fillStyle = YELLOW;
  ctx.fillRect(166, 100, 60, 8);
  ctx.fillStyle = "#e8743b";
  ctx.fillRect(226, 100, 40, 8);

  // headline
  ctx.fillStyle = INK;
  ctx.font = "800 64px 'Courier New', monospace";
  ctx.fillText(model.title, 56, 150);
  ctx.font = "700 34px 'Courier New', monospace";
  ctx.fillStyle = "#4a4436";
  wrapText(ctx, model.facts ?? "", 56, 240, 760, 44);

  // store rows
  let y = 356;
  for (const store of model.stores.slice(0, 3)) {
    pxRect(ctx, 56, y, 700, 54, store.isWinner ? GREEN_SOFT : CARD, INK, 3);
    ctx.fillStyle = INK;
    ctx.font = "800 30px 'Courier New', monospace";
    ctx.fillText(store.name, 76, y + 13);
    const total = store.summary;
    ctx.textAlign = "right";
    ctx.fillText(total, 736, y + 13);
    ctx.textAlign = "left";
    if (store.isWinner) {
      ctx.fillStyle = GREEN;
      ctx.font = "800 26px 'Courier New', monospace";
      ctx.fillText("← выгоднее", 770, y + 15);
    }
    y += 74;
  }

  // ferret
  try {
    const ferret = await svgToImage(PIXEL_ICONS.ferret);
    ctx.drawImage(ferret, 950, 310, 200, 184);
  } catch {
    // decorative only
  }

  // honesty footer
  ctx.fillStyle = INK;
  ctx.fillRect(12, 566, 1176, 4);
  ctx.font = "600 22px 'Courier New', monospace";
  ctx.fillStyle = "#6b6353";
  ctx.fillText(
    `Цены с сайтов магазинов · ${model.eyebrow.split("·").at(-1).trim()} · регион не подтверждён`,
    56,
    584
  );

  return canvas;
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = String(text).split(/\s+/);
  let line = "";
  for (const word of words) {
    const probe = line ? `${line} ${word}` : word;
    if (ctx.measureText(probe).width > maxWidth && line) {
      ctx.fillText(line, x, y);
      y += lineHeight;
      line = word;
    } else {
      line = probe;
    }
  }
  if (line) ctx.fillText(line, x, y);
}

export async function shareSnapshotResult(model) {
  const canvas = await renderShareCard(model);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) return "failed";

  const file = new File([blob], "checkni.png", { type: "image/png" });
  if (
    typeof navigator !== "undefined"
    && typeof navigator.canShare === "function"
    && navigator.canShare({ files: [file] })
  ) {
    try {
      await navigator.share({
        files: [file],
        title: "CHECKNI — где дешевле",
        text: `${model.title}. ${model.facts ?? ""}`.trim()
      });
      return "shared";
    } catch {
      // fall through to download (user may have cancelled)
      return "cancelled";
    }
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "checkni-sravnenie.png";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return "downloaded";
}
