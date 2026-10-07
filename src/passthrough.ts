import fs from "node:fs";
import { Command } from "commander";
import { addCommonOptions, printMutation, resolveClient, withErrors, type AnyOptions } from "./commands.js";
import { printOutput } from "./output.js";

const API_PATH_PATTERN = /^\/api(?:\/[A-Za-z0-9._~%:@{}+-]+)*$/;

/**
 * Accepts `/api/...`, `api/...`, or `companies/...` and rejects absolute URLs and
 * traversal so the passthrough can only ever hit the configured Paperclip API base.
 */
export function normalizeApiPath(input: string): string {
  const raw = input.trim();
  if (!raw) throw new Error("An API path is required, for example /api/companies.");
  if (raw.includes("://") || raw.startsWith("//")) throw new Error("Pass an API path, not an absolute URL.");
  const [pathname = ""] = raw.split("?");
  if (pathname.split("/").includes("..")) throw new Error("API paths must not contain '..'.");
  const withLeadingSlash = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const full = withLeadingSlash === "/api" || withLeadingSlash.startsWith("/api/")
    ? withLeadingSlash
    : `/api${withLeadingSlash}`;
  if (!API_PATH_PATTERN.test(full)) throw new Error(`Unsupported API path: ${input}`);
  return full;
}

export function buildQuery(entries: string | string[] | undefined): string {
  const list = entries === undefined ? [] : Array.isArray(entries) ? entries : [entries];
  const search = new URLSearchParams();
  for (const entry of list) {
    const separator = entry.indexOf("=");
    if (separator <= 0) throw new Error(`Invalid --query "${entry}". Use --query key=value.`);
    search.append(entry.slice(0, separator).trim(), entry.slice(separator + 1));
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}

export function parseRequestBody(data: unknown, dataFile: unknown, readFile: (path: string) => string): unknown {
  const inline = typeof data === "string" ? data.trim() : "";
  const file = typeof dataFile === "string" ? dataFile.trim() : "";
  if (!inline && !file) return undefined;
  if (inline && file) throw new Error("Pass either --data or --data-file, not both.");
  const text = file ? readFile(file) : inline;
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Request body is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export interface OpenApiOperation {
  method: string;
  path: string;
  summary?: string;
  parameters: string[];
  requestBody: string;
}

/** Matches a user pattern like `/api/issues/:id/documents` against documented paths. */
export function selectOpenApiOperations(document: unknown, pattern: string): OpenApiOperation[] {
  const paths = (document as { paths?: Record<string, Record<string, unknown>> } | null)?.paths;
  if (!paths || typeof paths !== "object") throw new Error("The server did not return an OpenAPI document at /api/openapi.json.");
  const matcher = new RegExp(`^${toTemplateRegex(normalizeApiPath(pattern))}$`);
  const operations: OpenApiOperation[] = [];
  for (const [path, methods] of Object.entries(paths)) {
    if (!matcher.test(toTemplateRegex(path))) continue;
    for (const [method, operation] of Object.entries(methods ?? {})) {
      if (!["get", "post", "patch", "put", "delete"].includes(method)) continue;
      const detail = (operation ?? {}) as { summary?: string; parameters?: unknown; requestBody?: unknown };
      operations.push({
        method: method.toUpperCase(),
        path,
        summary: typeof detail.summary === "string" ? detail.summary : undefined,
        parameters: describeParameters(detail.parameters),
        requestBody: describeRequestBody(detail.requestBody),
      });
    }
  }
  return operations.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

function toTemplateRegex(path: string): string {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return escaped.replace(/(?::[A-Za-z0-9_]+|\{[A-Za-z0-9_]+\})/g, "[^/]+");
}

function describeParameters(parameters: unknown): string[] {
  if (!Array.isArray(parameters)) return [];
  return parameters
    .map((parameter) => {
      const record = (parameter ?? {}) as { name?: unknown; in?: unknown; required?: unknown };
      if (typeof record.name !== "string") return "";
      const required = record.required === true ? "required" : "optional";
      return `${record.name} (${required}${typeof record.in === "string" ? `, ${record.in}` : ""})`;
    })
    .filter(Boolean);
}

function describeRequestBody(requestBody: unknown): string {
  const content = (requestBody as { content?: Record<string, { schema?: { $ref?: string; type?: string } }> } | null)?.content;
  if (!content) return "";
  for (const [contentType, media] of Object.entries(content)) {
    const ref = media?.schema?.$ref;
    if (typeof ref === "string") return `${contentType}: ${ref.split("/").pop()}`;
    if (typeof media?.schema?.type === "string") return `${contentType}: ${media.schema.type}`;
    return contentType;
  }
  return "";
}

export function registerApiPassthroughCommands(program: Command): void {
  const api = program
    .command("api")
    .description("Call any documented Paperclip API route directly (escape hatch for uncovered endpoints)");

  const read = api
    .command("get <path>")
    .description("GET an API path")
    .option("--query <key=value>", "Query parameter; repeatable", collect, [] as string[]);
  addCommonOptions(read).action((path: string, options: AnyOptions) =>
    withErrors(async () => {
      const { api: client, json } = resolveClient(options);
      printOutput(await client.get(`${normalizeApiPath(path)}${buildQuery(options.query as string[])}`), json);
    }),
  );

  for (const method of ["post", "patch", "put", "delete"] as const) {
    const mutation = api
      .command(`${method} <path>`)
      .description(`${method.toUpperCase()} an API path`)
      .option("--data <json>", "Request body as JSON")
      .option("--data-file <path>", "Request body from a JSON file")
      .option("--yes", "Confirm the mutation")
      .option("--verify", "Re-read the path with GET after the mutation");
    addCommonOptions(mutation).action((path: string, options: AnyOptions) =>
      withErrors(async () => {
        if (!options.yes) throw new Error(`Refusing to ${method.toUpperCase()} ${path} without --yes.`);
        const { api: client, json } = resolveClient(options);
        const target = normalizeApiPath(path);
        const body = parseRequestBody(options.data, options.dataFile, (file) => fs.readFileSync(file, "utf8"));
        const result = await client.request(method.toUpperCase(), target, body);
        await printMutation(client, result, json, Boolean(options.verify), target);
      }),
    );
  }

  addCommonOptions(
    api
      .command("describe <pattern>")
      .description("List documented operations matching a path pattern"),
  ).action((pattern: string, options: AnyOptions) =>
      withErrors(async () => {
        const { api: client, json } = resolveClient(options);
        const document = await client.get("/api/openapi.json");
        const operations = selectOpenApiOperations(document, pattern);
        if (!operations.length) throw new Error(`No documented operations match ${pattern}.`);
        if (json) {
          printOutput(operations, true);
          return;
        }
        for (const operation of operations) {
          const body = operation.requestBody ? ` body=${operation.requestBody}` : "";
          const params = operation.parameters.length ? ` [${operation.parameters.join("; ")}]` : "";
          console.log(`${operation.method.padEnd(6)} ${operation.path}${params}${body}`);
        }
      }),
  );
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}
