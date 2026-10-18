import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SECRET_SHAPES = [
  ["GitHub classic token", /gh[pousr]_[A-Za-z0-9]{20,}/g],
  ["GitHub fine-grained token", /github_pat_[A-Za-z0-9_]{20,}/g],
  ["OpenRouter key", /sk-or-v1-[A-Za-z0-9_-]{20,}/g],
  ["Supabase secret key", /sb_secret_[A-Za-z0-9_-]{20,}/g]
];
const JWT_SHAPE = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const SERVER_KEY_REFERENCE =
  /OPENROUTER_API_KEY|SUPABASE_(?:SERVICE_ROLE_KEY|SECRET_KEY)|service[_-]?role(?:[^a-z]|$)/g;
const BINARY_ASSET = /\.(?:png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf)$/i;

function redactedPath(file) {
  let redacted = file;
  for (const [, pattern] of SECRET_SHAPES) {
    redacted = redacted.replace(pattern, "[redacted-key]");
  }
  return redacted.replace(JWT_SHAPE, "[redacted-jwt]");
}

// These are leak detectors, not JWT authentication or a signature validator.
// Findings deliberately omit the value and surrounding source text.
export function credentialFindings(text, { publicArtifact = false } = {}) {
  const findings = [];
  const add = (kind, index) => {
    findings.push({
      kind,
      line: text.slice(0, index).split("\n").length
    });
  };
  for (const [kind, pattern] of SECRET_SHAPES) {
    for (const match of text.matchAll(pattern)) add(kind, match.index);
  }
  for (const match of text.matchAll(JWT_SHAPE)) {
    try {
      const payload = JSON.parse(
        Buffer.from(match[0].split(".")[1], "base64url").toString("utf8")
      );
      if (payload?.role === "service_role") {
        add("Supabase service-role JWT", match.index);
      }
    } catch {
      // A malformed, non-JSON payload is not a usable Supabase JWT.
    }
  }
  if (publicArtifact) {
    for (const match of text.matchAll(SERVER_KEY_REFERENCE)) {
      add("Server-only key reference", match.index);
    }
  }
  return findings;
}

export async function scanCredentialPaths(roots, options = {}) {
  const findings = [];
  async function visit(file) {
    const stat = await lstat(file);
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
      const error = new Error("Only regular artifact files are supported");
      error.code = "UNSUPPORTED_ARTIFACT_FILE";
      throw error;
    }
    if (stat.isDirectory()) {
      for (const name of (await readdir(file)).sort()) {
        await visit(path.join(file, name));
      }
      return;
    }
    if (BINARY_ASSET.test(file)) return;
    const text = await readFile(file, "utf8");
    for (const finding of credentialFindings(text, options)) {
      findings.push({ file: redactedPath(file), ...finding });
    }
  }
  for (const root of roots) await visit(root);
  return findings;
}

async function main(roots) {
  if (roots.length === 0) {
    process.stderr.write(
      "Usage: node tools/security/scan-public-secrets.mjs <artifact-path> [...]\n"
    );
    process.exitCode = 1;
    return;
  }
  try {
    const findings = await scanCredentialPaths(
      roots.map(root => path.resolve(root)),
      { publicArtifact: true }
    );
    for (const finding of findings) {
      process.stderr.write(
        "Secret check failed: " + path.relative(process.cwd(), finding.file)
        + ":" + finding.line + " (" + finding.kind + ")\n"
      );
    }
    if (findings.length > 0) {
      process.exitCode = 1;
      return;
    }
    process.stdout.write("Public artifact secret check passed.\n");
  } catch (error) {
    process.stderr.write(
      "Secret check failed: cannot scan artifact ("
      + (error?.code ?? "scanner_error") + ").\n"
    );
    process.exitCode = 1;
  }
}
if (
  process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  await main(process.argv.slice(2));
}
