import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const skillPath = path.resolve(process.cwd(), "integrations/skills/paperclip-cli-operator/SKILL.md");

describe("public operator skill sanitization", () => {
  it("contains no environment-specific leakage markers", () => {
    const skill = fs.readFileSync(skillPath, "utf8");
    const forbidden = [
      /\/home\//i,
      /[A-Za-z]:\\/i,
      /paspoto/i,
      /corp\./i,
      /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i,
      /PAPERCLIP_API_KEY\s*=\s*["'](?!<|provided)/i,
    ];
    for (const pattern of forbidden) expect(skill).not.toMatch(pattern);
  });

  it("includes the required safe operating rules", () => {
    const skill = fs.readFileSync(skillPath, "utf8");
    expect(skill).toContain("Read-before-write workflow");
    expect(skill).toContain("Never blindly retry mutations");
    expect(skill).toContain("company list --json");
    expect(skill).toContain("PAPERCLIP_API_URL");
  });
});
