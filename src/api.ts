import { normalizeApiBase } from "./config.js";

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export class ApiConnectionError extends Error {
  constructor(
    readonly url: string,
    readonly method: string,
    cause?: unknown,
  ) {
    const detail = cause instanceof Error && cause.message ? ` Cause: ${cause.message}` : "";
    super(
      `Could not reach the Paperclip API. Verify the configured URL and network access.\n` +
        `${method} ${url}.${detail}`,
    );
    this.name = "ApiConnectionError";
  }
}

export interface ApiClientOptions {
  apiBase: string;
  apiKey?: string;
  timeoutMs?: number;
  userAgent?: string;
  maxReadRetries?: number;
  retryDelayMs?: number;
}

export class PaperclipApiClient {
  readonly apiBase: string;
  private apiKey?: string;
  private readonly timeoutMs: number;
  private readonly userAgent: string;
  private readonly maxReadRetries: number;
  private readonly retryDelayMs: number;

  constructor(options: ApiClientOptions) {
    this.apiBase = normalizeApiBase(options.apiBase);
    this.apiKey = options.apiKey?.trim() || undefined;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.userAgent = options.userAgent ?? "paperclip-cli/0.1.0";
    this.maxReadRetries = Math.max(0, options.maxReadRetries ?? 2);
    this.retryDelayMs = Math.max(0, options.retryDelayMs ?? 250);
  }

  setApiKey(value: string | undefined): void {
    this.apiKey = value?.trim() || undefined;
  }

  get<T>(path: string): Promise<T | null> {
    return this.request<T>("GET", path);
  }

  post<T>(path: string, body?: unknown): Promise<T | null> {
    return this.request<T>("POST", path, body);
  }

  patch<T>(path: string, body?: unknown): Promise<T | null> {
    return this.request<T>("PATCH", path, body);
  }

  delete<T>(path: string): Promise<T | null> {
    return this.request<T>("DELETE", path);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T | null> {
    const url = buildUrl(this.apiBase, path);
    const headers = new Headers({
      accept: "application/json",
      "user-agent": this.userAgent,
    });
    if (this.apiKey) headers.set("authorization", `Bearer ${this.apiKey}`);
    if (body !== undefined) headers.set("content-type", "application/json");

    const attempts = method === "GET" ? this.maxReadRetries + 1 : 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      let response: Response;
      try {
        response = await fetch(url, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (error) {
        if (attempt + 1 < attempts) {
          await sleep(this.retryDelayMs * 2 ** attempt);
          continue;
        }
        throw new ApiConnectionError(url, method, error);
      }

      const text = await response.text();
      const parsed = text.trim() ? parseJson(text) : null;
      if (response.ok) return parsed as T | null;
      if (attempt + 1 < attempts && isRetryableReadStatus(response.status)) {
        await sleep(retryDelay(response, this.retryDelayMs, attempt));
        continue;
      }
      throw new ApiRequestError(response.status, extractMessage(parsed, response.status), safeDetails(parsed));
    }
    throw new Error("Unreachable API retry state.");
  }
}

export function buildUrl(apiBase: string, requestPath: string): string {
  const base = new URL(normalizeApiBase(apiBase));
  const path = requestPath.startsWith("/") ? requestPath : `/${requestPath}`;
  const [pathname, query = ""] = path.split("?");
  base.pathname = `${base.pathname.replace(/\/+$/, "")}${pathname}`;
  base.search = query;
  return base.toString();
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function extractMessage(value: unknown, status: number): string {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    for (const key of ["error", "message", "detail"]) {
      if (typeof record[key] === "string" && record[key].trim()) return record[key].trim();
    }
  }
  return `Paperclip API request failed with status ${status}.`;
}

function safeDetails(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of ["code", "requestId", "status"]) {
    if (record[key] !== undefined) result[key] = record[key];
  }
  return Object.keys(result).length ? result : undefined;
}

function isRetryableReadStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

function retryDelay(response: Response, baseDelayMs: number, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  const seconds = retryAfter ? Number(retryAfter) : Number.NaN;
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(5_000, seconds * 1_000);
  return Math.min(5_000, baseDelayMs * 2 ** attempt);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
