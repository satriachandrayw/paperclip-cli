import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

/**
 * Publishing is one-way: an environment-specific value that reaches the registry stays in the
 * tarball forever. Keep the gate next to the package definition so a late edit cannot smuggle
 * an author path, credential, or internal name into a release.
 */
const FORBIDDEN: Array<[string, RegExp]> = [
  // Excludes a drive letter followed by an escape sequence (for example "access:\n"), which is
  // otherwise indistinguishable from a Windows path.
  ["author filesystem path", /\/home\/|\/srv\/|\/Users\/|[A-Za-z]:\\(?![ntrbfv0xu])/],
  ["internal project or agent name", /paspoto|hermes|integralaw|corp\.satriachandrayw/i],
  ["hardcoded UUID", /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i],
  ["paperclip credential", /pcp_(?:board|agent)_[A-Za-z0-9_-]{8,}|pcgw_[A-Za-z0-9]{8,}/],
  ["private key or registry token", /-----BEGIN|ghp_[A-Za-z0-9]{30,}|npm_[A-Za-z0-9]{30,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\./],
  ["credentialed connection string", /(?:postgres|postgresql|mysql|mongodb|redis)(?:\+[a-z]+)?:\/\/[^\s:/@]+:[^\s@/]+@/],
  ["email address", /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/],
];

function collectShippedFiles(): string[] {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")) as { files?: string[] };
  const files: string[] = [path.join(repoRoot, "package.json")];
  for (const entry of pkg.files ?? []) {
    const full = path.join(repoRoot, entry);
    if (!fs.existsSync(full)) continue; // `dist` does not exist before a build
    if (fs.statSync(full).isDirectory()) {
      for (const name of fs.readdirSync(full, { recursive: true })) {
        const nested = path.join(full, String(name));
        if (fs.statSync(nested).isFile()) files.push(nested);
      }
    } else {
      files.push(full);
    }
  }
  return files;
}

describe("publish safety", () => {
  it("ships no environment-specific values", () => {
    const files = collectShippedFiles();
    expect(files.length).toBeGreaterThan(3);

    const violations: string[] = [];
    for (const file of files) {
      const text = fs.readFileSync(file, "utf8");
      for (const [label, pattern] of FORBIDDEN) {
        const match = pattern.exec(text);
        if (match) {
          const line = text.slice(0, match.index).split("\n").length;
          violations.push(`${label} in ${path.relative(repoRoot, file)}:${line} (${match[0].slice(0, 60)})`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("reports the package version", () => {
    const entry = path.join(repoRoot, "dist", "index.js");
    if (!fs.existsSync(entry)) return; // CI builds before testing; a bare checkout may not
    const reported = execFileSync(process.execPath, [entry, "--version"], { encoding: "utf8" }).trim();
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")) as { version: string };
    // `--version` said 0.1.0 on the 0.1.1 release because the string was hardcoded.
    expect(reported).toBe(pkg.version);
  });

  it("declares the same owner for the package scope and the repository", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
      name?: string;
      repository?: { url?: string };
    };
    const scope = /^@([^/]+)\//.exec(pkg.name ?? "")?.[1];
    const owner = /github\.com\/([^/]+)\//.exec(pkg.repository?.url ?? "")?.[1];
    expect(scope).toBeDefined();
    expect(owner).toBeDefined();
    // A user scope on npm requires an exact username match; a typo here fails only at publish time.
    expect(scope).toBe(owner);
  });

  it("publishes only the intended top-level entries", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")) as { files?: string[] };
    expect(pkg.files).toEqual(["dist", "README.md", "CHANGELOG.md", "LICENSE", "integrations"]);
    for (const required of ["LICENSE", "README.md", "dist"]) expect(pkg.files).toContain(required);
  });
});
