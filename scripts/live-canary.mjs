import { spawn } from "node:child_process";

if (process.env.PAPERCLIP_CANARY !== "1") {
  console.log("live canary skipped: set PAPERCLIP_CANARY=1 to opt in");
  process.exit(0);
}

for (const name of ["PAPERCLIP_API_URL", "PAPERCLIP_API_KEY"]) {
  if (!process.env[name]) throw new Error(`${name} is required for the live canary`);
}

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["dist/index.js", ...args], {
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

console.log("live canary passed (read-only checks)");
