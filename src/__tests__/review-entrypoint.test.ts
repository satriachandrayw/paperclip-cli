import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ReviewEntrypointError, invokeReviewEntrypoint } from "../review-entrypoint.js";

const skillPath = path.resolve(process.cwd(), "integrations/skills/paperclip-harness-review/SKILL.md");

describe("Review Entrypoint", () => {
  it("rejects an invocation without an explicit review scope before collection", async () => {
    const collect = vi.fn();

    await expect(
      invokeReviewEntrypoint(
        { instancePath: "/tmp/paperclip-instance" },
        { collect, judge: vi.fn() },
      ),
    ).rejects.toMatchObject({
      name: "ReviewEntrypointError",
      code: "missing-review-scope",
    } satisfies Partial<ReviewEntrypointError>);

    expect(collect).not.toHaveBeenCalled();
  });

  it("passes a bounded run scope to a read-only collector before semantic judgment", async () => {
    const instancePath = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-review-fixture-"));
    const runDirectory = path.join(instancePath, "runs");
    const runPath = path.join(runDirectory, "run-123.json");
    fs.mkdirSync(runDirectory);
    fs.writeFileSync(runPath, '{"status":"completed"}');
    const initialRun = fs.readFileSync(runPath, "utf8");
    const collect = vi.fn(async (request) => ({
      instancePath: request.instancePath,
      run: fs.readFileSync(path.join(request.instancePath, "runs", "run-123.json"), "utf8"),
    }));
    const judge = vi.fn(async (evidence) => ({ verdict: "reviewed", evidence }));

    const result = await invokeReviewEntrypoint(
      { instancePath, scope: { kind: "run", runId: "run-123" } },
      { collect, judge },
    );

    expect(collect).toHaveBeenCalledWith({
      instancePath,
      scope: { kind: "run", runId: "run-123" },
      access: "read-only",
    });
    expect(judge).toHaveBeenCalledWith({ instancePath, run: initialRun });
    expect(result).toEqual({
      access: "read-only",
      result: { verdict: "reviewed", evidence: { instancePath, run: initialRun } },
    });
    expect(fs.readFileSync(runPath, "utf8")).toBe(initialRun);
  });

  it("rejects a time window that does not identify an agent or company", async () => {
    const collect = vi.fn();

    await expect(
      invokeReviewEntrypoint(
        {
          instancePath: "/tmp/paperclip-instance",
          scope: { kind: "window", since: "2026-07-01T00:00:00Z", until: "2026-07-02T00:00:00Z" },
        },
        { collect, judge: vi.fn() },
      ),
    ).rejects.toMatchObject({
      name: "ReviewEntrypointError",
      code: "invalid-review-scope",
    } satisfies Partial<ReviewEntrypointError>);

    expect(collect).not.toHaveBeenCalled();
  });

  it.each([
    { instancePath: "relative-instance", scope: { kind: "run" as const, runId: "run-123" } },
    { instancePath: "https://paperclip.example.com", scope: { kind: "run" as const, runId: "run-123" } },
  ])("rejects a non-local instance path before collection", async ({ instancePath, scope }) => {
    const collect = vi.fn();

    await expect(invokeReviewEntrypoint({ instancePath, scope }, { collect, judge: vi.fn() })).rejects.toMatchObject({
      name: "ReviewEntrypointError",
      code: "invalid-instance-path",
    } satisfies Partial<ReviewEntrypointError>);

    expect(collect).not.toHaveBeenCalled();
  });

  it.each([
    { since: "not-a-date", until: "2026-07-02T00:00:00Z", agentId: "agent-123" },
    { since: "2026-07-02T00:00:00Z", until: "2026-07-01T00:00:00Z", agentId: "agent-123" },
    { since: "2026-07-01T00:00:00Z", until: "2026-07-02T00:00:00Z", agentId: "agent-123", companyId: "company-123" },
    { since: "2026-01-01T00:00:00Z", until: "2026-02-02T00:00:00Z", companyId: "company-123" },
  ])("rejects an ambiguous or invalid time window before collection", async (scope) => {
    const collect = vi.fn();

    await expect(
      invokeReviewEntrypoint({ instancePath: "/tmp/paperclip-instance", scope: { kind: "window", ...scope } }, { collect, judge: vi.fn() }),
    ).rejects.toMatchObject({
      name: "ReviewEntrypointError",
      code: "invalid-review-scope",
    } satisfies Partial<ReviewEntrypointError>);

    expect(collect).not.toHaveBeenCalled();
  });

  it("ships one human-invoked, agent-agnostic skill entrypoint", () => {
    const skill = fs.readFileSync(skillPath, "utf8");

    expect(skill).toContain("name: paperclip-harness-review");
    expect(skill).toContain("human-invoked");
    expect(skill).toContain("agent-agnostic");
    expect(skill).toContain("explicit local instance");
    expect(skill).toContain("read-only");
    expect(skill).toContain("one run");
    expect(skill).toContain("time window");
    expect(skill).toContain("Deterministic evidence collection");
    expect(skill).toContain("semantic judge");
    expect(skill).toContain("AI Fixing Prompt");
    expect(skill).toContain("Every repairable finding must include");
    expect(skill).toContain("Validation required");
    expect(skill).not.toContain("paperclip-cli harness");
  });
});
