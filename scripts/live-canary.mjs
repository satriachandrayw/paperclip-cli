import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

if (process.env.PAPERCLIP_CANARY !== "1") {
  console.log("live canary skipped: set PAPERCLIP_CANARY=1 to opt in");
  process.exit(0);
}

if (!process.env.PAPERCLIP_API_URL) throw new Error("PAPERCLIP_API_URL is required for the live canary");

/**
 * Prefer an explicit PAPERCLIP_API_KEY. When it is absent, fall back to the credential the CLI
 * already stores for this API base so a board key never has to be pasted onto a command line
 * (and into shell history and process listings).
 */
function credentialSource() {
  if (process.env.PAPERCLIP_API_KEY?.trim()) return "PAPERCLIP_API_KEY";
  const storePath = path.resolve(
    (process.env.PAPERCLIP_AUTH_STORE || "~/.paperclip/auth.json").replace(/^~(?=\/)/, os.homedir()),
  );
  try {
    const store = JSON.parse(fs.readFileSync(storePath, "utf8"));
    const apiBase = String(process.env.PAPERCLIP_API_URL).replace(/\/+$/, "");
    const key = store?.credentials?.[apiBase];
    if (key?.token) return `${storePath} (${apiBase})`;
  } catch {
    // Fall through to the error below.
  }
  throw new Error(
    `No credential found. Set PAPERCLIP_API_KEY, or run \`paperclip-cli auth login --api-base ${process.env.PAPERCLIP_API_URL}\` first.`,
  );
}

const apiBase = String(process.env.PAPERCLIP_API_URL).replace(/\/+$/, "");
const credential = credentialSource();

function run(args) {
  return new Promise((resolve, reject) => {
    // Pin --api-base on every call: a context profile would otherwise take precedence over
    // PAPERCLIP_API_URL and the canary could silently check a different server than requested.
    const child = spawn(process.execPath, ["dist/index.js", ...args, "--api-base", apiBase], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function check(label, args) {
  const result = await run([...args, "--json"]);
  if (result.code !== 0) throw new Error(`${label} failed: ${result.stderr.trim() || "unknown error"}`);
  try {
    JSON.parse(result.stdout);
  } catch {
    throw new Error(`${label} returned non-JSON output`);
  }
  console.log(`${label}: ok`);
}

await check("health", ["health"]);
await check("authentication", ["auth", "whoami"]);
await check("company list", ["company", "list"]);

if (process.env.PAPERCLIP_COMPANY_ID) {
  await check("agent list", ["agent", "list", "--company-id", process.env.PAPERCLIP_COMPANY_ID]);
  await check("issue list", ["issue", "list", "--company-id", process.env.PAPERCLIP_COMPANY_ID]);
}

await check("openapi describe", ["api", "describe", "/api/health"]);

console.log("live canary passed (read-only checks)");
console.log(`server: ${apiBase}`);
console.log(`credential: ${credential}`);
