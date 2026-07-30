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
    expect(JSON.parse(fs.readFileSync(path.join(dir, "auth.json"), "utf8"))).toEqual({
      version: 1,
      credentials: {
        "https://paperclip.example.com": {
          apiBase: "https://paperclip.example.com",
          token: "secret-value",
          userId: "user-1",
        },
      },
    });
    expect(fs.statSync(path.join(dir, "auth.json")).mode & 0o777).toBe(0o600);
  });
});
