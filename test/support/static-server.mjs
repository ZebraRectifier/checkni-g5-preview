import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT ?? 4173);
const ROOT = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));

const CONTENT_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"]
]);

function resolveRequestPath(requestUrl) {
  const pathname = decodeURIComponent(
    new URL(requestUrl ?? "/", "http://" + HOST + ":" + PORT).pathname
  );
  const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
  const candidate = path.resolve(ROOT, relativePath);

  if (candidate !== ROOT && !candidate.startsWith(ROOT + path.sep)) {
    return null;
  }

  return candidate;
}

const server = createServer(async (request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { "content-type": "text/plain; charset=utf-8" });
    response.end("Method Not Allowed");
    return;
  }

  const filePath = resolveRequestPath(request.url);
  if (!filePath) {
    response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error("not a file");

    response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": CONTENT_TYPES.get(path.extname(filePath).toLowerCase()) ?? "application/octet-stream"
    });

    if (request.method === "HEAD") {
      response.end();
      return;
    }

    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not Found");
  }
});

server.listen(PORT, HOST, () => {
  process.stdout.write("CHECKNI test server: http://" + HOST + ":" + PORT + "\n");
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
