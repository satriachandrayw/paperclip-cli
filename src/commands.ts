import { Command } from "commander";
import fs from "node:fs";
import { spawn } from "node:child_process";
import {
  defaultAuthStorePath,
  getContextPath,
  getStoredToken,
  normalizeApiBase,
  readContext,
  removeStoredToken,
  resolveProfile,
  setCurrentProfile,
  setStoredToken,
  upsertProfile,
  type ClientContextProfile,
} from "./config.js";
import { ApiRequestError, PaperclipApiClient } from "./api.js";
import { assessServerVersion } from "./compat.js";
import { printOutput, printRevealedSecret, printRows } from "./output.js";

export type CommonOptions = {
  apiBase?: string;
  apiKey?: string;
  companyId?: string;
  context?: string;
  profile?: string;
  json?: boolean;
};

export type AnyOptions = CommonOptions & Record<string, unknown>;

type ClientContext = {
  api: PaperclipApiClient;
  companyId?: string;
  json: boolean;
};

export function addCommonOptions(command: Command, includeCompany = false): Command {
  command
    .option("--api-base <url>", "Paperclip server base URL")
    .option("--api-key <token>", "Bearer token; prefer PAPERCLIP_API_KEY for automation")
    .option("--context <path>", "Context file path")
    .option("--profile <name>", "Context profile name")
    .option("--json", "Print JSON output");
  if (includeCompany) command.option("-C, --company-id <id>", "Company ID");
  return command;
}

function resolveApiBase(options: CommonOptions): string {
  const context = readContext(options.context);
  const { profile } = resolveProfile(context, options.profile);
  const value = options.apiBase?.trim() || profile.apiBase || process.env.PAPERCLIP_API_URL?.trim();
  if (!value) {
    throw new Error("Paperclip API URL is required. Pass --api-base or set PAPERCLIP_API_URL.");
  }
  return normalizeApiBase(value);
}

function resolveCompanyId(options: CommonOptions, required = true): string | undefined {
  const context = readContext(options.context);
  const { profile } = resolveProfile(context, options.profile);
  const companyId = options.companyId?.trim() || profile.companyId || process.env.PAPERCLIP_COMPANY_ID?.trim();
  if (required && !companyId) {
    throw new Error("Company ID is required. Pass --company-id, set PAPERCLIP_COMPANY_ID, or configure a context profile.");
  }
  return companyId;
}

function resolveApiKey(options: CommonOptions, apiBase: string): string | undefined {
  const context = readContext(options.context);
  const { profile } = resolveProfile(context, options.profile);
  const profileKey = profile.apiKeyEnvVarName ? process.env[profile.apiKeyEnvVarName]?.trim() : undefined;
  return options.apiKey?.trim() || profileKey || process.env.PAPERCLIP_API_KEY?.trim() || getStoredToken(apiBase);
}

export function resolveClient(options: CommonOptions, requireCompany = false): ClientContext {
  const apiBase = resolveApiBase(options);
  return {
    api: new PaperclipApiClient({ apiBase, apiKey: resolveApiKey(options, apiBase) }),
    companyId: resolveCompanyId(options, requireCompany),
    json: Boolean(options.json),
  };
}

export async function withErrors(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (error instanceof ApiRequestError) {
      const status = error.status === 401 ? "Authentication failed" : error.status === 403 ? "Permission denied" : `API error ${error.status}`;
      console.error(`${status}: ${error.message}`);
    } else {
      console.error(error instanceof Error ? error.message : String(error));
    }
    process.exitCode = 1;
  }
}

const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The server validates these fields with `z.string().guid()`, so a URL key or slug
 * fails with an opaque 400. Fail early with the flag name instead.
 */
function requireGuid(value: unknown, flag: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  if (!text) return undefined;
  if (!GUID_PATTERN.test(text)) {
    throw new Error(`${flag} must be a UUID. Pass the record's id field, not its URL key or slug (received "${text}").`);
  }
  return text;
}

function guidFields(record: Record<string, unknown>, flags: Record<string, string>): Record<string, unknown> {
  const output: Record<string, unknown> = { ...record };
  for (const [key, flag] of Object.entries(flags)) {
    const value = requireGuid(output[key], flag);
    if (value === undefined) delete output[key];
    else output[key] = value;
  }
  return output;
}

export function idPath(value: string): string {
  return encodeURIComponent(value.trim());
}

function omitUndefined(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined));
}

function parseJsonObject(value: string, label: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("must be a JSON object");
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new Error(`Invalid ${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function parseCsv(value: string | undefined): string[] | undefined {
  if (!value?.trim()) return undefined;
  const values = value.split(",").map((part) => part.trim()).filter(Boolean);
  return values.length ? values : undefined;
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function resourceId(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ["id", "issueId", "approvalId", "resourceId"]) {
    if (typeof record[key] === "string" && record[key].trim()) return record[key];
  }
  return undefined;
}

export async function printMutation(
  api: PaperclipApiClient,
  result: unknown,
  json: boolean,
  verify: boolean,
  verificationPath?: string,
): Promise<void> {
  if (verify) {
    const id = resourceId(result);
    if (!id || !verificationPath) throw new Error("The mutation response did not contain an ID that can be re-read.");
    const verified = await api.get(verificationPath.replace(":id", idPath(id)));
    printOutput(verified, json);
    return;
  }
  printOutput(result, json);
}

function openBrowser(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  // Only hand http(s) to the OS handler. The approval URL comes from the server, so an arbitrary
  // scheme here would let a misconfigured or compromised server launch a local protocol handler.
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  try {
    if (process.platform === "darwin") {
      const child = spawn("open", [url], { detached: true, stdio: "ignore" });
      child.unref();
      return true;
    }
    if (process.platform === "win32") {
      const child = spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" });
      child.unref();
      return true;
    }
    const child = spawn("xdg-open", [url], { detached: true, stdio: "ignore" });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

async function login(options: AnyOptions): Promise<void> {
  const apiBase = resolveApiBase(options);
  const client = new PaperclipApiClient({ apiBase });
  const challenge = await client.post<{
    id: string;
    token: string;
    boardApiToken: string;
    approvalPath: string;
    approvalUrl?: string | null;
    pollPath: string;
    expiresAt: string;
    suggestedPollIntervalMs?: number;
  }>("/api/cli-auth/challenges", {
    command: "paperclip-cli auth login",
    clientName: "paperclip-cli",
    requestedAccess: options.instanceAdmin ? "instance_admin_required" : "board",
    requestedCompanyId: requireGuid(options.companyId, "--company-id") ?? requireGuid(process.env.PAPERCLIP_COMPANY_ID, "PAPERCLIP_COMPANY_ID") ?? null,
  });
  if (!challenge) throw new Error("Paperclip returned an empty authentication challenge.");
  const approvalUrl = challenge.approvalUrl || `${apiBase}${challenge.approvalPath}`;
  console.error(`Open this URL to approve CLI access:\n${approvalUrl}`);
  if (openBrowser(approvalUrl)) console.error("Opened the approval page in your browser.");

  const expiresAt = Date.parse(challenge.expiresAt);
  const pollMs = Math.max(500, challenge.suggestedPollIntervalMs ?? 1000);
  while (!Number.isFinite(expiresAt) || Date.now() < expiresAt) {
    const status = await client.get<{ status: "pending" | "approved" | "cancelled" | "expired" }>(
      `${challenge.pollPath}?token=${encodeURIComponent(challenge.token)}`,
    );
    if (status?.status === "approved") {
      client.setApiKey(challenge.boardApiToken);
      const me = await client.get<{ userId?: string; user?: { id?: string } | null }>("/api/cli-auth/me");
      setStoredToken(apiBase, challenge.boardApiToken, me?.userId ?? me?.user?.id ?? null);
      printOutput({ ok: true, apiBase, userId: me?.userId ?? me?.user?.id ?? null, authStore: defaultAuthStorePath() }, Boolean(options.json));
      return;
    }
    if (status?.status === "cancelled") throw new Error("CLI authentication was cancelled.");
    if (status?.status === "expired") throw new Error("CLI authentication challenge expired.");
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error("CLI authentication challenge expired before approval.");
}

export function registerContextCommands(program: Command): void {
  const context = program.command("context").description("Manage remote CLI context profiles");
  context.command("show").description("Show the active profile").option("--context <path>").option("--profile <name>").option("--json").action((options: AnyOptions) => {
    const store = readContext(options.context);
    const resolved = resolveProfile(store, options.profile);
    printOutput({ contextPath: getContextPath(options.context), currentProfile: store.currentProfile, profileName: resolved.name, profile: resolved.profile, profiles: store.profiles }, Boolean(options.json));
  });
  context.command("list").description("List profiles").option("--context <path>").option("--json").action((options: AnyOptions) => {
    const store = readContext(options.context);
    printRows(Object.entries(store.profiles).map(([name, profile]) => ({ name, current: name === store.currentProfile, ...profile })), Boolean(options.json));
  });
  context.command("use <profile>").description("Select a profile").option("--context <path>").action((profile: string, options: AnyOptions) => {
    setCurrentProfile(profile, options.context);
    console.log(`Active profile: ${profile}`);
  });
  context.command("set").description("Set profile defaults")
    .option("--context <path>").option("--profile <name>").option("--api-base <url>").option("--company-id <id>").option("--api-key-env-var-name <name>").option("--use").option("--json")
    .action((options: AnyOptions) => {
      const store = readContext(options.context);
      const name = String(options.profile ?? store.currentProfile ?? "default");
      upsertProfile(
        name,
        {
          apiBase: typeof options.apiBase === "string" ? options.apiBase : undefined,
          companyId: typeof options.companyId === "string" ? options.companyId : undefined,
          apiKeyEnvVarName: typeof options.apiKeyEnvVarName === "string" ? options.apiKeyEnvVarName : undefined,
        },
        options.context,
      );
      if (options.use) setCurrentProfile(name, options.context);
      printOutput({ contextPath: getContextPath(options.context), profileName: name, profile: resolveProfile(readContext(options.context), name).profile }, Boolean(options.json));
    });
}

export function registerAuthCommands(program: Command): void {
  const auth = program.command("auth").description("Remote authentication");
  addCommonOptions(auth.command("login").description("Authenticate as a board operator").option("--instance-admin", "Request instance-admin access"), true).action((options: AnyOptions) => withErrors(() => login(options)));
  addCommonOptions(auth.command("whoami").description("Show the authenticated board identity")).action((options: AnyOptions) => withErrors(async () => {
    const { api, json } = resolveClient(options);
    printOutput(await api.get("/api/cli-auth/me"), json);
  }));
  addCommonOptions(auth.command("logout").description("Revoke and remove the stored credential")).action((options: AnyOptions) => withErrors(async () => {
    const apiBase = resolveApiBase(options);
    const token = getStoredToken(apiBase);
    let revoked = false;
    if (token) {
      try {
        await new PaperclipApiClient({ apiBase, apiKey: token }).post("/api/cli-auth/revoke-current", {});
        revoked = true;
      } catch {
        // Always remove the local token even if the server is unavailable.
      }
    }
    const removed = removeStoredToken(apiBase);
    printOutput({ ok: true, apiBase, revoked, removedLocalCredential: removed }, Boolean(options.json));
  }));
}

function registerSimpleResource(program: Command, resource: string, listPath: (companyId: string) => string, getPath: (id: string) => string): Command {
  const command = program.command(resource).description(`${resource} operations`);
  addCommonOptions(command.command("list").description(`List ${resource}s`), true).action((options: AnyOptions) => withErrors(async () => {
    const { api, companyId, json } = resolveClient(options, true);
    printRows((await api.get<unknown[]>(listPath(companyId!))) ?? [], json);
  }));
  addCommonOptions(command.command("get <id>").description(`Get one ${resource}`)).action((id: string, options: AnyOptions) => withErrors(async () => {
    const { api, json } = resolveClient(options);
    printOutput(await api.get(getPath(idPath(id))), json);
  }));
  return command;
}

export function registerCompanyCommands(program: Command): void {
  const company = program.command("company").description("Company operations");
  addCommonOptions(company.command("list").description("List accessible companies")).action((options: AnyOptions) => withErrors(async () => {
    const { api, json } = resolveClient(options);
    printRows((await api.get<unknown[]>("/api/companies")) ?? [], json);
  }));
  addCommonOptions(company.command("get <id>").description("Get one company")).action((id: string, options: AnyOptions) => withErrors(async () => {
    const { api, json } = resolveClient(options);
    printOutput(await api.get(`/api/companies/${idPath(id)}`), json);
  }));

  const label = program.command("label").description("Company issue labels");
  addCommonOptions(label.command("list").description("List company issue labels"), true).action((options: AnyOptions) => withErrors(async () => {
    const { api, companyId, json } = resolveClient(options, true);
    printRows((await api.get<unknown[]>(`/api/companies/${idPath(companyId!)}/labels`)) ?? [], json);
  }));
}

export function registerAgentCommands(program: Command): void {
  const agent = registerSimpleResource(program, "agent", (companyId) => `/api/companies/${idPath(companyId)}/agents`, (id) => `/api/agents/${id}`);

  for (const [verb, description] of [
    ["pause", "Pause an agent and cancel its active heartbeats"],
    ["resume", "Resume a paused agent"],
    ["clear-error", "Clear a stuck agent error state"],
    ["terminate", "Terminate an agent (irreversible)"],
  ] as const) {
    const command = agent
      .command(`${verb} <id>`)
      .description(description)
      .option("--verify", "Re-read the agent");
    if (verb === "terminate") command.option("--yes", "Confirm the termination");
    addCommonOptions(command).action((id: string, options: AnyOptions) => withErrors(async () => {
      if (verb === "terminate" && !options.yes) throw new Error("Refusing to terminate an agent without --yes.");
      const { api, json } = resolveClient(options);
      const result = await api.post(`/api/agents/${idPath(id)}/${verb}`, {});
      await printMutation(api, result, json, Boolean(options.verify), "/api/agents/:id");
    }));
  }

  addCommonOptions(
    agent.command("wakeup <id>").description("Wake an agent on demand")
      .option("--reason <text>", "Reason recorded on the wakeup")
      .option("--source <source>", "timer | assignment | on_demand | automation", "on_demand")
      .option("--force-fresh-session", "Start a fresh session instead of resuming")
      .option("--verify", "Re-read the agent"),
  ).action((id: string, options: AnyOptions) => withErrors(async () => {
    const { api, json } = resolveClient(options);
    const result = await api.post(`/api/agents/${idPath(id)}/wakeup`, omitUndefined({
      reason: options.reason,
      source: options.source,
      forceFreshSession: options.forceFreshSession ? true : undefined,
    }));
    await printMutation(api, result, json, Boolean(options.verify), "/api/agents/:id");
  }));

  const keys = agent.command("keys").description("Agent API keys");
  addCommonOptions(keys.command("list <id>").description("List an agent's API keys")).action((id: string, options: AnyOptions) => withErrors(async () => {
    const { api, json } = resolveClient(options);
    printRows((await api.get<unknown[]>(`/api/agents/${idPath(id)}/keys`)) ?? [], json);
  }));
  addCommonOptions(
    keys.command("create <id>").description("Create an agent API key; the token is shown once")
      .option("--name <name>", "Key name", "default")
      .option("--scope-json <json>", "Raw scope object, for example '{\"kind\":\"standard\"}'"),
  ).action((id: string, options: AnyOptions) => withErrors(async () => {
    const { api, json } = resolveClient(options);
    const scope = typeof options.scopeJson === "string" ? parseJsonObject(options.scopeJson, "--scope-json") : undefined;
    const result = await api.post(`/api/agents/${idPath(id)}/keys`, omitUndefined({ name: options.name, scope }));
    printRevealedSecret(result, json, "The agent API key below is shown once. Store it now; it cannot be read again.");
  }));
  addCommonOptions(
    keys.command("revoke <id> <keyId>").description("Revoke an agent API key").option("--yes", "Confirm the revocation"),
  ).action((id: string, keyId: string, options: AnyOptions) => withErrors(async () => {
    if (!options.yes) throw new Error("Refusing to revoke a key without --yes.");
    const { api, json } = resolveClient(options);
    printOutput(await api.delete(`/api/agents/${idPath(id)}/keys/${idPath(keyId)}`), json);
  }));
}

export function registerProjectGoalRoutinePluginCommands(program: Command): void {
  const project = registerSimpleResource(program, "project", (companyId) => `/api/companies/${idPath(companyId)}/projects`, (id) => `/api/projects/${id}`);
  addCommonOptions(
    project.command("create").description("Create a project")
      .requiredOption("--name <name>")
      .option("--description <text>")
      .option("--status <status>", "backlog | planned | in_progress | completed | cancelled")
      .option("--goal-id <id>", "Goal id; repeatable", collect, [] as string[])
      .option("--lead-agent-id <id>")
      .option("--target-date <date>")
      .option("--verify", "Re-read the created project"),
    true,
  ).action((options: AnyOptions) => withErrors(async () => {
    const { api, companyId, json } = resolveClient(options, true);
    const goalIds = (options.goalId as string[]).map((value) => requireGuid(value, "--goal-id"));
    const created = await api.post(`/api/companies/${idPath(companyId!)}/projects`, guidFields(omitUndefined({
      name: options.name,
      description: options.description,
      status: options.status,
      goalIds: goalIds.length ? goalIds : undefined,
      leadAgentId: options.leadAgentId,
      targetDate: options.targetDate,
    }), { leadAgentId: "--lead-agent-id" }));
    await printMutation(api, created, json, Boolean(options.verify), "/api/projects/:id");
  }));
  addCommonOptions(
    project.command("update <id>").description("Update a project")
      .option("--name <name>")
      .option("--description <text>")
      .option("--status <status>")
      .option("--lead-agent-id <id>")
      .option("--target-date <date>")
      .option("--archive")
      .option("--verify", "Re-read the updated project"),
  ).action((id: string, options: AnyOptions) => withErrors(async () => {
    const { api, json } = resolveClient(options);
    const updated = await api.patch(`/api/projects/${idPath(id)}`, guidFields(omitUndefined({
      name: options.name,
      description: options.description,
      status: options.status,
      leadAgentId: options.leadAgentId,
      targetDate: options.targetDate,
      archivedAt: options.archive ? new Date().toISOString() : undefined,
    }), { leadAgentId: "--lead-agent-id" }));
    await printMutation(api, updated, json, Boolean(options.verify), `/api/projects/${idPath(id)}`);
  }));

  const goal = registerSimpleResource(program, "goal", (companyId) => `/api/companies/${idPath(companyId)}/goals`, (id) => `/api/goals/${id}`);
  addCommonOptions(
    goal.command("create").description("Create a goal")
      .requiredOption("--title <title>")
      .option("--description <text>")
      .option("--level <level>", "company | team | agent | task")
      .option("--status <status>", "planned | active | achieved | cancelled")
      .option("--parent-id <id>")
      .option("--owner-agent-id <id>")
      .option("--verify", "Re-read the created goal"),
    true,
  ).action((options: AnyOptions) => withErrors(async () => {
    const { api, companyId, json } = resolveClient(options, true);
    const created = await api.post(`/api/companies/${idPath(companyId!)}/goals`, guidFields(omitUndefined({
      title: options.title,
      description: options.description,
      level: options.level,
      status: options.status,
      parentId: options.parentId,
      ownerAgentId: options.ownerAgentId,
    }), { parentId: "--parent-id", ownerAgentId: "--owner-agent-id" }));
    await printMutation(api, created, json, Boolean(options.verify), "/api/goals/:id");
  }));
  addCommonOptions(
    goal.command("update <id>").description("Update a goal")
      .option("--title <title>")
      .option("--description <text>")
      .option("--level <level>")
      .option("--status <status>")
      .option("--owner-agent-id <id>")
      .option("--verify", "Re-read the updated goal"),
  ).action((id: string, options: AnyOptions) => withErrors(async () => {
    const { api, json } = resolveClient(options);
    const updated = await api.patch(`/api/goals/${idPath(id)}`, guidFields(omitUndefined({
      title: options.title,
      description: options.description,
      level: options.level,
      status: options.status,
      ownerAgentId: options.ownerAgentId,
    }), { ownerAgentId: "--owner-agent-id" }));
    await printMutation(api, updated, json, Boolean(options.verify), `/api/goals/${idPath(id)}`);
  }));

  const routine = registerSimpleResource(program, "routine", (companyId) => `/api/companies/${idPath(companyId)}/routines`, (id) => `/api/routines/${id}`);
  addCommonOptions(
    routine.command("create").description("Create a routine")
      .requiredOption("--title <title>")
      .option("--description <text>")
      .option("--project-id <id>")
      .option("--goal-id <id>")
      .option("--parent-issue-id <id>")
      .option("--assignee-agent-id <id>")
      .option("--priority <priority>", "critical | high | medium | low")
      .option("--status <status>", "active | paused | archived")
      .option("--verify", "Re-read the created routine"),
    true,
  ).action((options: AnyOptions) => withErrors(async () => {
    const { api, companyId, json } = resolveClient(options, true);
    const created = await api.post(`/api/companies/${idPath(companyId!)}/routines`, guidFields(omitUndefined({
      title: options.title,
      description: options.description,
      projectId: options.projectId,
      goalId: options.goalId,
      parentIssueId: options.parentIssueId,
      assigneeAgentId: options.assigneeAgentId,
      priority: options.priority,
      status: options.status,
    }), { projectId: "--project-id", goalId: "--goal-id", parentIssueId: "--parent-issue-id", assigneeAgentId: "--assignee-agent-id" }));
    await printMutation(api, created, json, Boolean(options.verify), "/api/routines/:id");
  }));
  addCommonOptions(
    routine.command("update <id>").description("Update a routine")
      .option("--title <title>")
      .option("--description <text>")
      .option("--assignee-agent-id <id>")
      .option("--priority <priority>")
      .option("--status <status>")
      .option("--verify", "Re-read the updated routine"),
  ).action((id: string, options: AnyOptions) => withErrors(async () => {
    const { api, json } = resolveClient(options);
    const updated = await api.patch(`/api/routines/${idPath(id)}`, guidFields(omitUndefined({
      title: options.title,
      description: options.description,
      assigneeAgentId: options.assigneeAgentId,
      priority: options.priority,
      status: options.status,
    }), { assigneeAgentId: "--assignee-agent-id" }));
    await printMutation(api, updated, json, Boolean(options.verify), `/api/routines/${idPath(id)}`);
  }));
  addCommonOptions(
    routine.command("run <id>").description("Trigger a routine run now")
      .option("--trigger-id <id>", "Trigger id to attribute the run to")
      .option("--payload <json>", "Trigger payload as JSON")
      .option("--idempotency-key <key>")
      .option("--verify", "Re-read the routine"),
  ).action((id: string, options: AnyOptions) => withErrors(async () => {
    const { api, json } = resolveClient(options);
    const payload = typeof options.payload === "string" ? parseJsonObject(options.payload, "--payload") : undefined;
    const result = await api.post(`/api/routines/${idPath(id)}/run`, guidFields(omitUndefined({
      triggerId: options.triggerId,
      payload,
      idempotencyKey: options.idempotencyKey,
      source: "manual",
    }), { triggerId: "--trigger-id" }));
    await printMutation(api, result, json, Boolean(options.verify), `/api/routines/${idPath(id)}`);
  }));

  const plugin = program.command("plugin").description("Remote plugin operations");
  addCommonOptions(plugin.command("list").description("List installed plugins")).action((options: AnyOptions) => withErrors(async () => {
    const { api, json } = resolveClient(options);
    printRows((await api.get<unknown[]>("/api/plugins")) ?? [], json);
  }));
  addCommonOptions(plugin.command("inspect <id>").description("Inspect an installed plugin")).action((id: string, options: AnyOptions) => withErrors(async () => {
    const { api, json } = resolveClient(options);
    printOutput(await api.get(`/api/plugins/${idPath(id)}`), json);
  }));
  for (const action of ["enable", "disable"] as const) {
    const command = plugin.command(`${action} <id>`).description(`${action} an installed plugin`);
    if (action === "disable") command.option("--yes", "Confirm disabling the plugin");
    addCommonOptions(command).action((id: string, options: AnyOptions) => withErrors(async () => {
      if (action === "disable" && !options.yes) throw new Error("Refusing to disable a plugin without --yes.");
      const { api, json } = resolveClient(options);
      printOutput(await api.post(`/api/plugins/${idPath(id)}/${action}`, {}), json);
    }));
  }
  const config = plugin.command("config").description("Plugin instance configuration");
  addCommonOptions(config.command("get <id>").description("Read plugin config for a company"), true).action((id: string, options: AnyOptions) => withErrors(async () => {
    const { api, companyId, json } = resolveClient(options, true);
    printOutput(await api.get(`/api/plugins/${idPath(id)}/config?companyId=${encodeURIComponent(companyId!)}`), json);
  }));
  addCommonOptions(
    config.command("set <id>").description("Replace plugin config for a company")
      .requiredOption("--config-json <json>", "Configuration object as JSON")
      .option("--yes", "Confirm the configuration change"),
    true,
  ).action((id: string, options: AnyOptions) => withErrors(async () => {
    if (!options.yes) throw new Error("Refusing to change plugin config without --yes.");
    const { api, companyId, json } = resolveClient(options, true);
    const configJson = parseJsonObject(String(options.configJson), "--config-json");
    printOutput(await api.post(`/api/plugins/${idPath(id)}/config`, { companyId: companyId!, configJson }), json);
  }));
  addCommonOptions(
    plugin.command("logs <id>").description("Read plugin logs")
      .option("--limit <count>", "Max rows (1-500)", "25")
      .option("--level <level>", "Log level filter")
      .option("--since <timestamp>", "Only rows at or after this timestamp"),
  ).action((id: string, options: AnyOptions) => withErrors(async () => {
    const { api, json } = resolveClient(options);
    const query = new URLSearchParams({ limit: String(options.limit) });
    for (const key of ["level", "since"] as const) {
      const value = options[key];
      if (typeof value === "string" && value.trim()) query.set(key, value);
    }
    printRows((await api.get<unknown[]>(`/api/plugins/${idPath(id)}/logs?${query}`)) ?? [], json);
  }));

  const run = program.command("run").description("Remote run operations");
  addCommonOptions(run.command("list").description("List runs for an issue").requiredOption("--issue-id <id>")).action((options: AnyOptions) => withErrors(async () => {
    const { api, json } = resolveClient(options);
    printRows((await api.get<unknown[]>(`/api/issues/${idPath(String(options.issueId))}/runs`)) ?? [], json);
  }));
  addCommonOptions(run.command("routine <routineId>").description("List runs for a routine")).action((routineId: string, options: AnyOptions) => withErrors(async () => {
    const { api, json } = resolveClient(options);
    printRows((await api.get<unknown[]>(`/api/routines/${idPath(routineId)}/runs`)) ?? [], json);
  }));
}

export function registerSkillCommands(program: Command): void {
  const skill = program.command("skill").description("Company skill operations");
  addCommonOptions(skill.command("list").description("List company skills"), true).action((options: AnyOptions) => withErrors(async () => {
    const { api, companyId, json } = resolveClient(options, true);
    printRows((await api.get<unknown[]>(`/api/companies/${idPath(companyId!)}/skills`)) ?? [], json);
  }));
  addCommonOptions(skill.command("get <id>").description("Get one company skill"), true).action((id: string, options: AnyOptions) => withErrors(async () => {
    const { api, companyId, json } = resolveClient(options, true);
    printOutput(await api.get(`/api/companies/${idPath(companyId!)}/skills/${idPath(id)}`), json);
  }));
  addCommonOptions(skill.command("file <id>").description("Read a skill file").requiredOption("--path <path>", "Relative file path"), true).action((id: string, options: AnyOptions) => withErrors(async () => {
    const { api, companyId, json } = resolveClient(options, true);
    printOutput(await api.get(`/api/companies/${idPath(companyId!)}/skills/${idPath(id)}/files?path=${encodeURIComponent(String(options.path))}`), json);
  }));
  addCommonOptions(
    skill.command("write-file <id>").description("Create or replace a skill file")
      .requiredOption("--path <path>", "Relative file path")
      .option("--content <text>", "File content")
      .option("--content-file <path>", "Read file content from a local file")
      .option("--executable", "Mark the file executable")
      .option("--yes", "Confirm writing production skill content"),
    true,
  ).action((id: string, options: AnyOptions) => withErrors(async () => {
    if (!options.yes) throw new Error("Refusing to write skill content without --yes.");
    const { api, companyId, json } = resolveClient(options, true);
    const content = readContentOption(options.content, options.contentFile);
    printOutput(await api.patch(`/api/companies/${idPath(companyId!)}/skills/${idPath(id)}/files`, {
      path: String(options.path),
      content,
      executable: options.executable ? true : undefined,
    }), json);
  }));
  addCommonOptions(
    skill.command("import").description("Import a skill from a source URL or path").requiredOption("--source <source>"),
    true,
  ).action((options: AnyOptions) => withErrors(async () => {
    const { api, companyId, json } = resolveClient(options, true);
    printOutput(await api.post(`/api/companies/${idPath(companyId!)}/skills/import`, { source: String(options.source) }), json);
  }));
  addCommonOptions(
    skill.command("install-catalog").description("Install a skill from the catalog")
      .requiredOption("--catalog-skill-id <id>")
      .option("--slug <slug>")
      .option("--force", "Reinstall over an existing skill"),
    true,
  ).action((options: AnyOptions) => withErrors(async () => {
    const { api, companyId, json } = resolveClient(options, true);
    printOutput(await api.post(`/api/companies/${idPath(companyId!)}/skills/install-catalog`, omitUndefined({
      catalogSkillId: options.catalogSkillId,
      slug: options.slug,
      force: options.force ? true : undefined,
    })), json);
  }));
}

function readContentOption(content: unknown, contentFile: unknown): string {
  const inline = typeof content === "string" ? content : "";
  const file = typeof contentFile === "string" ? contentFile.trim() : "";
  if (file && inline) throw new Error("Pass either --content or --content-file, not both.");
  if (file) return fs.readFileSync(file, "utf8");
  if (inline) return inline;
  throw new Error("Pass --content or --content-file.");
}

export function registerIssueCommands(program: Command): void {
  const issue = program.command("issue").description("Issue operations");
  addCommonOptions(issue.command("list").description("List company issues").option("--status <csv>").option("--project-id <id>").option("--assignee-agent-id <id>").option("--parent-id <id>").option("--match <text>"), true).action((options: AnyOptions) => withErrors(async () => {
    const { api, companyId, json } = resolveClient(options, true);
    const query = new URLSearchParams();
    for (const key of ["status", "projectId", "assigneeAgentId", "parentId"] as const) {
      const value = options[key];
      if (typeof value === "string" && value.trim()) query.set(key, value);
    }
    const rows = (await api.get<unknown[]>(`/api/companies/${idPath(companyId!)}/issues${query.toString() ? `?${query}` : ""}`)) ?? [];
    const match = typeof options.match === "string" ? options.match.toLowerCase() : "";
    const filtered = match ? rows.filter((row) => JSON.stringify(row).toLowerCase().includes(match)) : rows;
    printRows(filtered, json);
  }));
  addCommonOptions(issue.command("get <id>").description("Get an issue")).action((id: string, options: AnyOptions) => withErrors(async () => {
    const { api, json } = resolveClient(options);
    printOutput(await api.get(`/api/issues/${idPath(id)}`), json);
  }));
  addCommonOptions(issue.command("create").description("Create an issue").requiredOption("--title <title>").option("--description <text>").option("--status <status>").option("--priority <priority>").option("--assignee-agent-id <id>").option("--project-id <id>").option("--goal-id <id>").option("--parent-id <id>").option("--label-id <id>", "Label id; repeatable", collect, [] as string[]).option("--verify", "Re-read the created issue"), true).action((options: AnyOptions) => withErrors(async () => {
    const { api, companyId, json } = resolveClient(options, true);
    const labelIds = (options.labelId as string[]).map((value) => requireGuid(value, "--label-id"));
    const created = await api.post(`/api/companies/${idPath(companyId!)}/issues`, guidFields(omitUndefined({ title: options.title, description: options.description, status: options.status, priority: options.priority, assigneeAgentId: options.assigneeAgentId, projectId: options.projectId, goalId: options.goalId, parentId: options.parentId, labelIds: labelIds.length ? labelIds : undefined }), { assigneeAgentId: "--assignee-agent-id", projectId: "--project-id", goalId: "--goal-id", parentId: "--parent-id" }));
    await printMutation(api, created, json, Boolean(options.verify), "/api/issues/:id");
  }));
  addCommonOptions(issue.command("update <id>").description("Update an issue").option("--title <title>").option("--description <text>").option("--status <status>").option("--priority <priority>").option("--assignee-agent-id <id>").option("--project-id <id>").option("--goal-id <id>").option("--parent-id <id>").option("--label-id <id>", "Label id; repeatable", collect, [] as string[]).option("--comment <text>").option("--verify", "Re-read the updated issue"), false).action((id: string, options: AnyOptions) => withErrors(async () => {
    const { api, json } = resolveClient(options);
    const labelIds = (options.labelId as string[]).map((value) => requireGuid(value, "--label-id"));
    const updated = await api.patch(`/api/issues/${idPath(id)}`, guidFields(omitUndefined({ title: options.title, description: options.description, status: options.status, priority: options.priority, assigneeAgentId: options.assigneeAgentId, projectId: options.projectId, goalId: options.goalId, parentId: options.parentId, comment: options.comment, labelIds: labelIds.length ? labelIds : undefined }), { assigneeAgentId: "--assignee-agent-id", projectId: "--project-id", goalId: "--goal-id", parentId: "--parent-id" }));
    await printMutation(api, updated, json, Boolean(options.verify), `/api/issues/${idPath(id)}`);
  }));
  addCommonOptions(issue.command("comment <id>").description("Add an issue comment").requiredOption("--body <text>").option("--reopen").option("--resume").option("--verify", "Re-read the issue")).action((id: string, options: AnyOptions) => withErrors(async () => {
    const { api, json } = resolveClient(options);
    const result = await api.post(`/api/issues/${idPath(id)}/comments`, { body: options.body, reopen: options.reopen, resume: options.resume });
    await printMutation(api, result, json, Boolean(options.verify), `/api/issues/${idPath(id)}`);
  }));
  addCommonOptions(issue.command("checkout <id>").description("Checkout an issue for an agent").requiredOption("--agent-id <id>").option("--expected-statuses <csv>").option("--verify", "Re-read the issue")).action((id: string, options: AnyOptions) => withErrors(async () => {
    const { api, json } = resolveClient(options);
    const expectedStatuses = typeof options.expectedStatuses === "string"
      ? parseCsv(options.expectedStatuses)
      : undefined;
    const result = await api.post(`/api/issues/${idPath(id)}/checkout`, {
        agentId: requireGuid(options.agentId, "--agent-id")!,
        expectedStatuses: expectedStatuses ?? ["todo", "backlog", "blocked"],
      });
    await printMutation(api, result, json, Boolean(options.verify), `/api/issues/${idPath(id)}`);
  }));
  addCommonOptions(issue.command("release <id>").description("Release an issue back to todo").option("--verify", "Re-read the issue")).action((id: string, options: AnyOptions) => withErrors(async () => {
    const { api, json } = resolveClient(options);
    const result = await api.post(`/api/issues/${idPath(id)}/release`, {});
    await printMutation(api, result, json, Boolean(options.verify), `/api/issues/${idPath(id)}`);
  }));

  addCommonOptions(issue.command("documents <id>").description("List an issue's documents")).action((id: string, options: AnyOptions) => withErrors(async () => {
    const { api, json } = resolveClient(options);
    printRows((await api.get<unknown[]>(`/api/issues/${idPath(id)}/documents`)) ?? [], json);
  }));
  addCommonOptions(issue.command("document <id>").description("Read one issue document").requiredOption("--key <key>", "Document key, for example plan")).action((id: string, options: AnyOptions) => withErrors(async () => {
    const { api, json } = resolveClient(options);
    printOutput(await api.get(`/api/issues/${idPath(id)}/documents/${idPath(String(options.key))}`), json);
  }));
  addCommonOptions(issue.command("attachments <id>").description("List an issue's attachments")).action((id: string, options: AnyOptions) => withErrors(async () => {
    const { api, json } = resolveClient(options);
    printRows((await api.get<unknown[]>(`/api/issues/${idPath(id)}/attachments`)) ?? [], json);
  }));
  for (const action of ["archive", "unarchive"] as const) {
    addCommonOptions(
      issue.command(`${action} <id>`).description(`${action === "archive" ? "Archive" : "Restore"} an issue in the board inbox`).option("--verify", "Re-read the issue"),
    ).action((id: string, options: AnyOptions) => withErrors(async () => {
      const { api, json } = resolveClient(options);
      const path = `/api/issues/${idPath(id)}/inbox-archive`;
      const result = action === "archive" ? await api.post(path, {}) : await api.delete(path);
      await printMutation(api, result, json, Boolean(options.verify), `/api/issues/${idPath(id)}`);
    }));
  }
}

export function registerApprovalCommands(program: Command): void {
  const approval = program.command("approval").description("Approval operations");
  addCommonOptions(approval.command("list").description("List approvals").option("--status <status>"), true).action((options: AnyOptions) => withErrors(async () => {
    const { api, companyId, json } = resolveClient(options, true);
    const query = typeof options.status === "string" ? `?status=${encodeURIComponent(options.status)}` : "";
    printRows((await api.get<unknown[]>(`/api/companies/${idPath(companyId!)}/approvals${query}`)) ?? [], json);
  }));
  addCommonOptions(approval.command("get <id>").description("Get an approval")).action((id: string, options: AnyOptions) => withErrors(async () => {
    const { api, json } = resolveClient(options);
    printOutput(await api.get(`/api/approvals/${idPath(id)}`), json);
  }));
  for (const action of ["approve", "reject", "request-revision"] as const) {
    addCommonOptions(approval.command(`${action} <id>`).description(`${action} an approval`).option("--decision-note <text>").option("--yes", "Confirm the mutation").option("--verify", "Re-read the approval"))
      .action((id: string, options: AnyOptions) => withErrors(async () => {
        if (!options.yes) throw new Error(`Refusing to ${action} an approval without --yes.`);
        const { api, json } = resolveClient(options);
        const result = await api.post(`/api/approvals/${idPath(id)}/${action}`, omitUndefined({ decisionNote: options.decisionNote }));
        await printMutation(api, result, json, Boolean(options.verify), `/api/approvals/${idPath(id)}`);
      }));
  }
  addCommonOptions(approval.command("comment <id>").description("Comment on an approval").requiredOption("--body <text>")).action((id: string, options: AnyOptions) => withErrors(async () => {
    const { api, json } = resolveClient(options);
    printOutput(await api.post(`/api/approvals/${idPath(id)}/comments`, { body: options.body }), json);
  }));
  addCommonOptions(
    approval.command("create").description("Create an approval request")
      .requiredOption("--type <type>", "hire_agent | approve_ceo_strategy | budget_override_required | request_board_approval")
      .requiredOption("--payload <json>", "Approval payload as JSON")
      .option("--requested-by-agent-id <id>")
      .option("--issue-id <id>", "Linked issue id; repeatable", collect, [] as string[]),
    true,
  ).action((options: AnyOptions) => withErrors(async () => {
    const { api, companyId, json } = resolveClient(options, true);
    const issueIds = (options.issueId as string[]).map((value) => requireGuid(value, "--issue-id"));
    printOutput(await api.post(`/api/companies/${idPath(companyId!)}/approvals`, guidFields(omitUndefined({
      type: options.type,
      payload: parseJsonObject(String(options.payload), "--payload"),
      requestedByAgentId: options.requestedByAgentId,
      issueIds: issueIds.length ? issueIds : undefined,
    }), { requestedByAgentId: "--requested-by-agent-id" })), json);
  }));
  addCommonOptions(
    approval.command("resubmit <id>").description("Resubmit an approval with a new payload").option("--payload <json>", "Replacement payload as JSON").option("--verify", "Re-read the approval"),
  ).action((id: string, options: AnyOptions) => withErrors(async () => {
    const { api, json } = resolveClient(options);
    const payload = typeof options.payload === "string" ? parseJsonObject(options.payload, "--payload") : undefined;
    const result = await api.post(`/api/approvals/${idPath(id)}/resubmit`, omitUndefined({ payload }));
    await printMutation(api, result, json, Boolean(options.verify), `/api/approvals/${idPath(id)}`);
  }));
}

export function registerActivityAndDashboardCommands(program: Command): void {
  const activity = program.command("activity").description("Activity log operations");
  addCommonOptions(activity.command("list").description("List company activity").option("--agent-id <id>").option("--entity-type <type>").option("--entity-id <id>"), true).action((options: AnyOptions) => withErrors(async () => {
    const { api, companyId, json } = resolveClient(options, true);
    const query = new URLSearchParams();
    for (const key of ["agentId", "entityType", "entityId"] as const) {
      const value = options[key];
      if (typeof value === "string" && value.trim()) query.set(key, value);
    }
    printRows((await api.get<unknown[]>(`/api/companies/${idPath(companyId!)}/activity${query.toString() ? `?${query}` : ""}`)) ?? [], json);
  }));
  const dashboard = program.command("dashboard").description("Dashboard operations");
  addCommonOptions(dashboard.command("get").description("Get company dashboard"), true).action((options: AnyOptions) => withErrors(async () => {
    const { api, companyId, json } = resolveClient(options, true);
    printOutput(await api.get(`/api/companies/${idPath(companyId!)}/dashboard`), json);
  }));
}

export function registerHealthCommand(program: Command): void {
  addCommonOptions(program.command("health").description("Check API reachability")).action((options: AnyOptions) => withErrors(async () => {
    const { api, json } = resolveClient(options);
    const health = await api.get<{ version?: unknown; commit?: unknown }>("/api/health");
    printOutput(health, json);
    const assessment = assessServerVersion(health?.version, health?.commit);
    if (assessment.message) console.error(`Compatibility: ${assessment.message}`);
  }));
}
