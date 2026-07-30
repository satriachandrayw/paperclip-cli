import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface ClientContextProfile {
  apiBase?: string;
  companyId?: string;
  apiKeyEnvVarName?: string;
}

export interface ClientContext {
  version: 1;
  currentProfile: string;
  profiles: Record<string, ClientContextProfile>;
}

interface AuthStore {
  version: 1;
  credentials: Record<string, { apiBase: string; token: string; userId?: string | null }>;
}

export function expandHome(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

export function normalizeApiBase(value: string): string {
  const input = value.trim();
  if (!input) throw new Error("Paperclip API URL is empty.");
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error(`Invalid Paperclip API URL: ${value}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Paperclip API URL must use http:// or https://.");
  }
  if (url.username || url.password) {
    throw new Error("Paperclip API URL must not contain credentials.");
  }
  let pathname = url.pathname.replace(/\/+$/, "");
  if (pathname === "/api") pathname = "";
  url.pathname = pathname;
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function defaultContextPath(): string {
  return path.join(os.homedir(), ".paperclip", "context.json");
}

export function defaultAuthStorePath(): string {
  const override = process.env.PAPERCLIP_AUTH_STORE?.trim();
  return path.resolve(expandHome(override || path.join("~", ".paperclip", "auth.json")));
}

function contextPath(override?: string): string {
  return path.resolve(expandHome(override || process.env.PAPERCLIP_CONTEXT || defaultContextPath()));
}

function defaultContext(): ClientContext {
  return { version: 1, currentProfile: "default", profiles: { default: {} } };
}

function normalizeProfile(value: unknown): ClientContextProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  return {
    apiBase: typeof record.apiBase === "string" && record.apiBase.trim() ? record.apiBase.trim() : undefined,
    companyId: typeof record.companyId === "string" && record.companyId.trim() ? record.companyId.trim() : undefined,
    apiKeyEnvVarName:
      typeof record.apiKeyEnvVarName === "string" && record.apiKeyEnvVarName.trim()
        ? record.apiKeyEnvVarName.trim()
        : undefined,
  };
}

export function readContext(override?: string): ClientContext {
  const filePath = contextPath(override);
  if (!fs.existsSync(filePath)) return defaultContext();
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Unable to parse context file ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return defaultContext();
  const record = parsed as Record<string, unknown>;
  const profiles: Record<string, ClientContextProfile> = {};
  if (record.profiles && typeof record.profiles === "object" && !Array.isArray(record.profiles)) {
    for (const [name, profile] of Object.entries(record.profiles as Record<string, unknown>)) {
      if (name.trim()) profiles[name] = normalizeProfile(profile);
    }
  }
  const currentProfile = typeof record.currentProfile === "string" && record.currentProfile.trim()
    ? record.currentProfile.trim()
    : "default";
  profiles[currentProfile] ??= {};
  return { version: 1, currentProfile, profiles };
}

export function writeContext(value: ClientContext, override?: string): void {
  const filePath = contextPath(override);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(filePath, 0o600);
}

export function resolveProfile(context: ClientContext, requested?: string): { name: string; profile: ClientContextProfile } {
  const name = requested?.trim() || context.currentProfile || "default";
  return { name, profile: context.profiles[name] ?? {} };
}

export function upsertProfile(name: string, patch: ClientContextProfile, override?: string): ClientContext {
  const context = readContext(override);
  const existing = context.profiles[name] ?? {};
  const merged = { ...existing, ...patch };
  for (const key of ["apiBase", "companyId", "apiKeyEnvVarName"] as const) {
    if (merged[key] !== undefined && !merged[key]?.trim()) delete merged[key];
  }
  context.profiles[name] = merged;
  writeContext(context, override);
  return context;
}

export function setCurrentProfile(name: string, override?: string): ClientContext {
  const context = readContext(override);
  context.profiles[name] ??= {};
  context.currentProfile = name;
  writeContext(context, override);
  return context;
}

function readAuthStore(): AuthStore {
  const filePath = defaultAuthStorePath();
  if (!fs.existsSync(filePath)) return { version: 1, credentials: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<AuthStore>;
    return {
      version: 1,
      credentials: parsed.credentials && typeof parsed.credentials === "object" ? parsed.credentials : {},
    };
  } catch (error) {
    throw new Error(`Unable to parse auth store ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function writeAuthStore(value: AuthStore): void {
  const filePath = defaultAuthStorePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(filePath, 0o600);
}

export function getStoredToken(apiBase: string): string | undefined {
  const key = normalizeApiBase(apiBase);
  return readAuthStore().credentials[key]?.token;
}

export function setStoredToken(apiBase: string, token: string, userId?: string | null): void {
  const normalized = normalizeApiBase(apiBase);
  const store = readAuthStore();
  store.credentials[normalized] = { apiBase: normalized, token: token.trim(), userId: userId ?? null };
  writeAuthStore(store);
}

export function removeStoredToken(apiBase: string): boolean {
  const normalized = normalizeApiBase(apiBase);
  const store = readAuthStore();
  if (!store.credentials[normalized]) return false;
  delete store.credentials[normalized];
  writeAuthStore(store);
  return true;
}

export function getContextPath(override?: string): string {
  return contextPath(override);
}
