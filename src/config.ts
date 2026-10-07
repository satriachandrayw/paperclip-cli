import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Profiles are shared with the upstream `paperclipai` CLI, which stores additional
 * keys (`persona`, `agentId`, `tokenName`, `tokenId`, `tokenCreatedAt`, ...). Unknown
 * keys are preserved verbatim on read/write so neither tool erases the other's state.
 */
export interface ClientContextProfile {
  apiBase?: string;
  companyId?: string;
  apiKeyEnvVarName?: string;
  [key: string]: unknown;
}

export interface ClientContext {
  /** Upstream writes 2; legacy CLI-written files may say 1. Preserved as-is. */
  version: number;
  currentProfile: string;
  profiles: Record<string, ClientContextProfile>;
}

export interface StoredCredential {
  apiBase: string;
  token: string;
  userId?: string | null;
  /** Upstream's reader requires both timestamps or it silently ignores the credential. */
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

interface AuthStore {
  version: number;
  credentials: Record<string, StoredCredential>;
}

/** Version this CLI writes for new context files; matches upstream's current shape. */
export const CONTEXT_VERSION = 2;

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

/**
 * Upstream resolves context profiles from the nearest `.paperclip/context.json`
 * walking up from the working directory, then falls back to the home file.
 * Matching that order keeps both CLIs pointed at the same server and company.
 */
export function findContextFileFromAncestors(startDir = process.cwd()): string | null {
  let current = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(current, ".paperclip", "context.json");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function defaultAuthStorePath(): string {
  const override = process.env.PAPERCLIP_AUTH_STORE?.trim();
  return path.resolve(expandHome(override || path.join("~", ".paperclip", "auth.json")));
}

function contextPath(override?: string): string {
  const explicit = override || process.env.PAPERCLIP_CONTEXT;
  if (explicit) return path.resolve(expandHome(explicit));
  return path.resolve(findContextFileFromAncestors() ?? defaultContextPath());
}

function defaultContext(): ClientContext {
  return { version: CONTEXT_VERSION, currentProfile: "default", profiles: { default: {} } };
}

function normalizeProfile(value: unknown): ClientContextProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  // Start from every stored key so upstream-only fields survive a round trip.
  const profile: ClientContextProfile = { ...record };
  for (const key of ["apiBase", "companyId", "apiKeyEnvVarName"] as const) {
    const raw = record[key];
    if (typeof raw === "string" && raw.trim()) profile[key] = raw.trim();
    else delete profile[key];
  }
  return profile;
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
  const version = typeof record.version === "number" && Number.isFinite(record.version)
    ? record.version
    : CONTEXT_VERSION;
  return { version, currentProfile, profiles };
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
  const merged: ClientContextProfile = { ...existing, ...patch };
  for (const key of ["apiBase", "companyId", "apiKeyEnvVarName"] as const) {
    const value = merged[key];
    if (typeof value === "string" && !value.trim()) delete merged[key];
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
      version: typeof parsed.version === "number" ? parsed.version : 1,
      credentials:
        parsed.credentials && typeof parsed.credentials === "object" ? (parsed.credentials as AuthStore["credentials"]) : {},
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
  const existing = store.credentials[normalized];
  const now = new Date().toISOString();
  store.credentials[normalized] = {
    ...existing,
    apiBase: normalized,
    token: token.trim(),
    userId: userId ?? existing?.userId ?? null,
    // Upstream's reader drops credentials without both timestamps.
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
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
