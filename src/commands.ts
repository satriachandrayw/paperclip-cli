import { Command } from "commander";
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
import { printOutput, printRows } from "./output.js";

type CommonOptions = {
  apiBase?: string;
  apiKey?: string;
  companyId?: string;
  context?: string;
  profile?: string;
  json?: boolean;
};

type AnyOptions = CommonOptions & Record<string, unknown>;

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

function resolveClient(options: CommonOptions, requireCompany = false): ClientContext {
  const apiBase = resolveApiBase(options);
  return {
    api: new PaperclipApiClient({ apiBase, apiKey: resolveApiKey(options, apiBase) }),
    companyId: resolveCompanyId(options, requireCompany),
    json: Boolean(options.json),
  };
}

async function withErrors(action: () => Promise<void>): Promise<void> {
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

function idPath(value: string): string {
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

function resourceId(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ["id", "issueId", "approvalId", "resourceId"]) {
    if (typeof record[key] === "string" && record[key].trim()) return record[key];
  }
  return undefined;
}

async function printMutation(
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
    requestedCompanyId: options.companyId ?? process.env.PAPERCLIP_COMPANY_ID ?? null,
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

function registerSimpleResource(program: Command, resource: string, listPath: (companyId: string) => string, getPath: (id: string) => string): void {
  const command = program.command(resource).description(`${resource} operations`);
  addCommonOptions(command.command("list").description(`List ${resource}s`), true).action((options: AnyOptions) => withErrors(async () => {
    const { api, companyId, json } = resolveClient(options, true);
    printRows((await api.get<unknown[]>(listPath(companyId!))) ?? [], json);
  }));
  addCommonOptions(command.command("get <id>").description(`Get one ${resource}`)).action((id: string, options: AnyOptions) => withErrors(async () => {
    const { api, json } = resolveClient(options);
    printOutput(await api.get(getPath(idPath(id))), json);
  }));
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
}

export function registerAgentCommands(program: Command): void {
  registerSimpleResource(program, "agent", (companyId) => `/api/companies/${idPath(companyId)}/agents`, (id) => `/api/agents/${id}`);
}

export function registerProjectGoalRoutinePluginCommands(program: Command): void {
  registerSimpleResource(program, "project", (companyId) => `/api/companies/${idPath(companyId)}/projects`, (id) => `/api/projects/${id}`);
  registerSimpleResource(program, "goal", (companyId) => `/api/companies/${idPath(companyId)}/goals`, (id) => `/api/goals/${id}`);
  registerSimpleResource(program, "routine", (companyId) => `/api/companies/${idPath(companyId)}/routines`, (id) => `/api/routines/${id}`);

  const plugin = program.command("plugin").description("Remote plugin operations");
  addCommonOptions(plugin.command("list").description("List installed plugins")).action((options: AnyOptions) => withErrors(async () => {
    const { api, json } = resolveClient(options);
    printRows((await api.get<unknown[]>("/api/plugins")) ?? [], json);
  }));
  addCommonOptions(plugin.command("inspect <id>").description("Inspect an installed plugin")).action((id: string, options: AnyOptions) => withErrors(async () => {
    const { api, json } = resolveClient(options);
    printOutput(await api.get(`/api/plugins/${idPath(id)}`), json);
  }));

  const run = program.command("run").description("Remote run operations");
  addCommonOptions(run.command("list").description("List runs for an issue").requiredOption("--issue-id <id>")).action((options: AnyOptions) => withErrors(async () => {
    const { api, json } = resolveClient(options);
    printRows((await api.get<unknown[]>(`/api/issues/${idPath(String(options.issueId))}/runs`)) ?? [], json);
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
}

export function registerIssueCommands(program: Command): void {
  const issue = program.command("issue").description("Issue operations");
  addCommonOptions(issue.command("list").description("List company issues").option("--status <csv>").option("--project-id <id>").option("--assignee-agent-id <id>").option("--match <text>"), true).action((options: AnyOptions) => withErrors(async () => {
    const { api, companyId, json } = resolveClient(options, true);
    const query = new URLSearchParams();
    for (const key of ["status", "projectId", "assigneeAgentId"] as const) {
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
  addCommonOptions(issue.command("create").description("Create an issue").requiredOption("--title <title>").option("--description <text>").option("--status <status>").option("--priority <priority>").option("--assignee-agent-id <id>").option("--project-id <id>").option("--goal-id <id>").option("--parent-id <id>").option("--verify", "Re-read the created issue"), true).action((options: AnyOptions) => withErrors(async () => {
    const { api, companyId, json } = resolveClient(options, true);
    const created = await api.post(`/api/companies/${idPath(companyId!)}/issues`, omitUndefined({ title: options.title, description: options.description, status: options.status, priority: options.priority, assigneeAgentId: options.assigneeAgentId, projectId: options.projectId, goalId: options.goalId, parentId: options.parentId }));
    await printMutation(api, created, json, Boolean(options.verify), "/api/issues/:id");
  }));
  addCommonOptions(issue.command("update <id>").description("Update an issue").option("--title <title>").option("--description <text>").option("--status <status>").option("--priority <priority>").option("--assignee-agent-id <id>").option("--project-id <id>").option("--goal-id <id>").option("--parent-id <id>").option("--comment <text>").option("--verify", "Re-read the updated issue"), false).action((id: string, options: AnyOptions) => withErrors(async () => {
    const { api, json } = resolveClient(options);
    const updated = await api.patch(`/api/issues/${idPath(id)}`, omitUndefined({ title: options.title, description: options.description, status: options.status, priority: options.priority, assigneeAgentId: options.assigneeAgentId, projectId: options.projectId, goalId: options.goalId, parentId: options.parentId, comment: options.comment }));
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
        agentId: String(options.agentId),
        expectedStatuses: expectedStatuses ?? ["todo", "backlog", "blocked"],
      });
    await printMutation(api, result, json, Boolean(options.verify), `/api/issues/${idPath(id)}`);
  }));
  addCommonOptions(issue.command("release <id>").description("Release an issue back to todo").option("--verify", "Re-read the issue")).action((id: string, options: AnyOptions) => withErrors(async () => {
    const { api, json } = resolveClient(options);
    const result = await api.post(`/api/issues/${idPath(id)}/release`, {});
    await printMutation(api, result, json, Boolean(options.verify), `/api/issues/${idPath(id)}`);
  }));
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
    printOutput(await api.get("/api/health"), json);
  }));
}
