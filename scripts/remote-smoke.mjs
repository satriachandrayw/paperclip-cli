import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";

const requests = [];
const server = http.createServer((request, response) => {
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", () => {
    const body = Buffer.concat(chunks).toString("utf8");
    requests.push({ method: request.method, url: request.url, auth: request.headers.authorization, body });
    response.setHeader("content-type", "application/json");
    if (request.method === "GET" && request.url === "/api/companies") {
      response.end(JSON.stringify([{ id: "company-1", name: "Example Company" }]));
      return;
    }
    if (request.method === "POST" && request.url === "/api/companies/company-1/issues") {
      response.statusCode = 201;
      response.end(JSON.stringify({ id: "issue-1", identifier: "PC-1", title: JSON.parse(body).title }));
      return;
    }
    if (request.method === "GET" && request.url === "/api/issues/issue-1") {
      response.end(JSON.stringify({ id: "issue-1", identifier: "PC-1", title: "Test issue", status: "todo" }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not found" }));
  });
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert.ok(address && typeof address === "object");
const apiBase = `http://127.0.0.1:${address.port}`;

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["dist/index.js", ...args], { cwd: process.cwd(), env: process.env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

const list = await run(["company", "list", "--api-base", apiBase, "--api-key", "test-token", "--json"]);
assert.equal(list.code, 0, list.stderr);
assert.deepEqual(JSON.parse(list.stdout), [{ id: "company-1", name: "Example Company" }]);

const created = await run([
  "issue", "create", "--api-base", apiBase, "--api-key", "test-token",
  "--company-id", "company-1", "--title", "Test issue", "--verify", "--json",
]);
assert.equal(created.code, 0, created.stderr);
assert.deepEqual(JSON.parse(created.stdout), { id: "issue-1", identifier: "PC-1", title: "Test issue", status: "todo" });

assert.equal(requests[0].auth, "Bearer test-token");
assert.equal(requests[1].auth, "Bearer test-token");
assert.deepEqual(JSON.parse(requests[1].body), { title: "Test issue" });
assert.equal(requests[2].url, "/api/issues/issue-1");

await new Promise((resolve) => server.close(resolve));
console.log("remote CLI smoke passed");
