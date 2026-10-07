import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  registerAgentCommands,
  registerApprovalCommands,
  registerAuthCommands,
  registerCompanyCommands,
  registerHealthCommand,
  registerIssueCommands,
  registerProjectGoalRoutinePluginCommands,
  registerSkillCommands,
} from "../commands.js";
import { registerApiPassthroughCommands } from "../passthrough.js";

interface RecordedRequest {
  method: string;
  url: string;
  body: unknown;
}

const tempDirs: string[] = [];
let server: http.Server | undefined;
let requests: RecordedRequest[] = [];
let responder: (request: RecordedRequest) => { status?: number; body: unknown } = () => ({ body: { ok: true } });
let stdout: string[] = [];
let stderr: string[] = [];

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const ISSUE_ID = "22222222-2222-4222-8222-222222222222";
const AGENT_ID = "33333333-3333-4333-8333-333333333333";

async function startServer(): Promise<string> {
  requests = [];
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      let body: unknown;
      if (raw.trim()) {
        try {
          body = JSON.parse(raw);
        } catch {
          body = raw;
        }
      }
      const recorded: RecordedRequest = { method: req.method ?? "GET", url: req.url ?? "/", body };
      requests.push(recorded);
      const result = responder(recorded);
      res.statusCode = result.status ?? 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(result.body));
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fake server did not bind");
  return `http://127.0.0.1:${address.port}`;
}

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerCompanyCommands(program);
  registerAgentCommands(program);
  registerIssueCommands(program);
  registerProjectGoalRoutinePluginCommands(program);
  registerSkillCommands(program);
  registerApprovalCommands(program);
  registerApiPassthroughCommands(program);
  registerHealthCommand(program);
  return program;
}

async function runCli(args: string[]): Promise<void> {
  const program = buildProgram();
  await program.parseAsync(["node", "paperclip-cli", ...args]);
}

beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-cli-cmd-"));
  tempDirs.push(dir);
  vi.stubEnv("PAPERCLIP_CONTEXT", path.join(dir, "context.json"));
  vi.stubEnv("PAPERCLIP_AUTH_STORE", path.join(dir, "auth.json"));
  vi.stubEnv("PAPERCLIP_API_KEY", "test-key");
  vi.stubEnv("PAPERCLIP_COMPANY_ID", COMPANY_ID);
  delete process.env.PAPERCLIP_API_URL;
  process.exitCode = undefined;
  stdout = [];
  stderr = [];
  vi.spyOn(console, "log").mockImplementation((value?: unknown) => {
    stdout.push(String(value));
  });
  vi.spyOn(console, "error").mockImplementation((value?: unknown) => {
    stderr.push(String(value));
  });
  responder = () => ({ body: { ok: true } });
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  process.exitCode = undefined;
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  }
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("typed operator commands", () => {
  it("pauses an agent and can verify the result", async () => {
    const apiBase = await startServer();
    responder = (request) => (request.method === "GET" ? { body: { id: AGENT_ID, status: "paused" } } : { body: { id: AGENT_ID, status: "paused" } });

    await runCli(["agent", "pause", AGENT_ID, "--api-base", apiBase, "--verify", "--json"]);

    expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual([
      `POST /api/agents/${AGENT_ID}/pause`,
      `GET /api/agents/${AGENT_ID}`,
    ]);
    expect(process.exitCode).toBeUndefined();
  });

  it("refuses to terminate an agent without --yes and sends nothing", async () => {
    const apiBase = await startServer();

    await runCli(["agent", "terminate", AGENT_ID, "--api-base", apiBase]);

    expect(requests).toEqual([]);
    expect(stderr.join("\n")).toContain("without --yes");
    expect(process.exitCode).toBe(1);
  });

  it("prints a freshly created agent key instead of redacting it", async () => {
    const apiBase = await startServer();
    responder = () => ({ status: 201, body: { id: "key-1", name: "ops", token: "pcp_agent_secret_token" } });

    await runCli(["agent", "keys", "create", AGENT_ID, "--name", "ops", "--api-base", apiBase]);

    expect(requests[0]?.url).toBe(`/api/agents/${AGENT_ID}/keys`);
    expect(requests[0]?.body).toEqual({ name: "ops" });
    expect(stdout.join("\n")).toContain("pcp_agent_secret_token");
    expect(stdout.join("\n")).not.toContain("[REDACTED]");
    expect(stderr.join("\n")).toContain("shown once");
  });

  it("archives an issue in the board inbox", async () => {
    const apiBase = await startServer();

    await runCli(["issue", "archive", ISSUE_ID, "--api-base", apiBase]);

    expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual([
      `POST /api/issues/${ISSUE_ID}/inbox-archive`,
    ]);
  });

  it("rejects a slug where the API requires a UUID", async () => {
    const apiBase = await startServer();

    await runCli(["issue", "checkout", ISSUE_ID, "--agent-id", "ceo-agent", "--api-base", apiBase]);

    expect(requests).toEqual([]);
    expect(stderr.join("\n")).toContain("--agent-id must be a UUID");
    expect(process.exitCode).toBe(1);
  });

  it("sets plugin config for the configured company", async () => {
    const apiBase = await startServer();

    await runCli([
      "plugin", "config", "set", "dokploy",
      "--config-json", "{\"region\":\"eu\"}",
      "--yes",
      "--company-id", COMPANY_ID,
      "--api-base", apiBase,
    ]);

    expect(requests[0]?.url).toBe("/api/plugins/dokploy/config");
    expect(requests[0]?.body).toEqual({ companyId: COMPANY_ID, configJson: { region: "eu" } });
  });
});

describe("api passthrough", () => {
  it("calls a documented route with query parameters", async () => {
    const apiBase = await startServer();

    await runCli(["api", "get", "companies", "--query", "scope=accessible", "--api-base", apiBase]);

    expect(requests[0]?.url).toBe("/api/companies?scope=accessible");
  });

  it("requires --yes for mutations", async () => {
    const apiBase = await startServer();

    await runCli(["api", "post", "/api/agents/x/pause", "--api-base", apiBase]);

    expect(requests).toEqual([]);
    expect(stderr.join("\n")).toContain("without --yes");
  });

  it("rejects absolute URLs and traversal", async () => {
    const apiBase = await startServer();

    await runCli(["api", "get", "https://evil.example.com/api/companies", "--api-base", apiBase]);
    await runCli(["api", "get", "/api/../../secrets", "--api-base", apiBase]);

    expect(requests).toEqual([]);
    expect(stderr.join("\n")).toContain("not an absolute URL");
    expect(stderr.join("\n")).toContain("must not contain '..'");
  });

  it("describes operations from the server OpenAPI document", async () => {
    const apiBase = await startServer();
    responder = (request) =>
      request.url === "/api/openapi.json"
        ? {
            body: {
              paths: {
                "/api/issues/{id}/documents": { get: { summary: "List documents" } },
                "/api/companies": { get: { summary: "List companies" } },
              },
            },
          }
        : { body: {} };

    await runCli(["api", "describe", "/api/issues/:id/documents", "--api-base", apiBase, "--json"]);

    expect(requests[0]?.url).toBe("/api/openapi.json");
    const payload = JSON.parse(stdout.join("\n"));
    expect(payload).toHaveLength(1);
    expect(payload[0]).toMatchObject({ method: "GET", path: "/api/issues/{id}/documents" });
  });
});

describe("server compatibility reporting", () => {
  it("warns when the server predates the supported window", async () => {
    const apiBase = await startServer();
    responder = () => ({ body: { status: "ok", version: "2026.707.0", commit: null } });

    await runCli(["health", "--api-base", apiBase]);

    expect(stderr.join("\n")).toContain("2026.707.0 is older than the minimum supported");
  });

  it("stays quiet for a tested server version", async () => {
    const apiBase = await startServer();
    responder = () => ({ body: { status: "ok", version: "2026.1005.0", commit: null } });

    await runCli(["health", "--api-base", apiBase]);

    expect(stderr.join("\n")).not.toContain("Compatibility:");
    expect(process.exitCode).toBeUndefined();
  });
});
