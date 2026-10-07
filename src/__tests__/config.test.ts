import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getContextPath,
  getStoredToken,
  readContext,
  setCurrentProfile,
  setStoredToken,
  upsertProfile,
} from "../config.js";

const tempDirs: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("configuration and credential storage", () => {
  it("writes profiles with non-secret defaults", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-cli-config-"));
    tempDirs.push(dir);
    vi.stubEnv("PAPERCLIP_CONTEXT", path.join(dir, "context.json"));

    upsertProfile("production", {
      apiBase: "https://paperclip.example.com",
      companyId: "company-1",
      apiKeyEnvVarName: "PAPERCLIP_API_KEY",
    });
    setCurrentProfile("production");

    const context = readContext();
    expect(getContextPath()).toBe(path.join(dir, "context.json"));
    expect(context.currentProfile).toBe("production");
    expect(context.profiles.production).toEqual({
      apiBase: "https://paperclip.example.com",
      companyId: "company-1",
      apiKeyEnvVarName: "PAPERCLIP_API_KEY",
    });
    expect(fs.statSync(getContextPath()).mode & 0o777).toBe(0o600);
  });

  it("stores and reads credentials separately from context", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-cli-auth-"));
    tempDirs.push(dir);
    vi.stubEnv("PAPERCLIP_AUTH_STORE", path.join(dir, "auth.json"));

    setStoredToken("https://paperclip.example.com/api", "secret-value", "user-1");

    expect(getStoredToken("https://paperclip.example.com")).toBe("secret-value");
    const stored = JSON.parse(fs.readFileSync(path.join(dir, "auth.json"), "utf8"));
    expect(stored.version).toBe(1);
    expect(stored.credentials["https://paperclip.example.com"]).toMatchObject({
      apiBase: "https://paperclip.example.com",
      token: "secret-value",
      userId: "user-1",
    });
    // Upstream's reader ignores credentials without both timestamps.
    expect(typeof stored.credentials["https://paperclip.example.com"].createdAt).toBe("string");
    expect(typeof stored.credentials["https://paperclip.example.com"].updatedAt).toBe("string");
    expect(fs.statSync(path.join(dir, "auth.json")).mode & 0o777).toBe(0o600);
  });

  it("keeps createdAt and unrelated credential keys when the token is replaced", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-cli-auth-update-"));
    tempDirs.push(dir);
    const storePath = path.join(dir, "auth.json");
    vi.stubEnv("PAPERCLIP_AUTH_STORE", storePath);

    setStoredToken("https://paperclip.example.com", "first", "user-1");
    const createdAt = JSON.parse(fs.readFileSync(storePath, "utf8")).credentials["https://paperclip.example.com"].createdAt;
    setStoredToken("https://paperclip.example.com", "second", "user-1");

    const entry = JSON.parse(fs.readFileSync(storePath, "utf8")).credentials["https://paperclip.example.com"];
    expect(entry.token).toBe("second");
    expect(entry.createdAt).toBe(createdAt);
  });

  it("preserves upstream profile keys and file version on write", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-cli-context-shared-"));
    tempDirs.push(dir);
    const contextPath = path.join(dir, "context.json");
    vi.stubEnv("PAPERCLIP_CONTEXT", contextPath);
    fs.writeFileSync(contextPath, JSON.stringify({
      version: 2,
      currentProfile: "intentlab",
      profiles: {
        default: {
          apiBase: "https://paperclip.example.com",
          companyId: "company-1",
          apiKeyEnvVarName: "PAPERCLIP_API_KEY",
          persona: "board",
          tokenName: "ops-token",
          tokenId: "3f1c9a44-5d2b-4e77-9a10-6c8b2d4f7e31",
          tokenCreatedAt: "2026-01-05 00:00:00.000000+00",
          futureKey: { nested: true },
        },
        intentlab: { persona: "board" },
      },
    }));

    setCurrentProfile("intentlab");

    const written = JSON.parse(fs.readFileSync(contextPath, "utf8"));
    expect(written.version).toBe(2);
    expect(written.currentProfile).toBe("intentlab");
    expect(written.profiles.default).toMatchObject({
      apiBase: "https://paperclip.example.com",
      companyId: "company-1",
      apiKeyEnvVarName: "PAPERCLIP_API_KEY",
      persona: "board",
      tokenName: "ops-token",
      tokenId: "3f1c9a44-5d2b-4e77-9a10-6c8b2d4f7e31",
      tokenCreatedAt: "2026-01-05 00:00:00.000000+00",
      futureKey: { nested: true },
    });
    expect(written.profiles.intentlab.persona).toBe("board");
  });

  it("finds a repository-local context before the home file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-cli-context-ancestor-"));
    tempDirs.push(dir);
    const nested = path.join(dir, "packages", "app");
    fs.mkdirSync(nested, { recursive: true });
    fs.mkdirSync(path.join(dir, ".paperclip"), { recursive: true });
    const localContext = path.join(dir, ".paperclip", "context.json");
    fs.writeFileSync(localContext, JSON.stringify({ version: 2, currentProfile: "local", profiles: { local: {} } }));
    vi.stubEnv("PAPERCLIP_CONTEXT", "");
    const previousCwd = process.cwd();
    process.chdir(nested);
    try {
      expect(getContextPath()).toBe(localContext);
      expect(readContext().currentProfile).toBe("local");
    } finally {
      process.chdir(previousCwd);
    }
  });
});
