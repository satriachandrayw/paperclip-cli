/**
 * The Paperclip API is unversioned and upstream publishes no deprecation policy, so the
 * CLI records the server releases it was verified against and warns when a connected
 * server falls outside that window. Warning only: never blocks a command.
 */
export const TESTED_SERVER_VERSIONS = ["2026.1005.0"] as const;

/**
 * Some deployments report a build commit instead of a version, and a self-hosted server on a
 * release tag reports no `version` field at all. Map the commits this CLI was verified against
 * so those deployments are still recognized.
 */
export const TESTED_SERVER_COMMITS: Record<string, string> = {
  "467125fafb47a8520856504fecc48d6e32055db1": "2026.1005.0",
};

export const MIN_SUPPORTED_SERVER_VERSION = "2026.831.0";

export type ServerVersionStatus = "supported" | "untested-newer" | "older-than-supported" | "unknown";

export interface ServerVersionAssessment {
  status: ServerVersionStatus;
  reported: string | null;
  message?: string;
}

/** An abbreviated SHA still identifies the build, so match on a prefix of at least 7 characters. */
export function matchTestedCommit(commit: unknown): string | null {
  const value = typeof commit === "string" ? commit.trim().toLowerCase() : "";
  if (value.length < 7) return null;
  for (const [sha, version] of Object.entries(TESTED_SERVER_COMMITS)) {
    if (sha.startsWith(value) || value.startsWith(sha)) return version;
  }
  return null;
}

/** Calendar versions are `YYYY.MMDD.P`; compare component-wise. */
function parseVersion(value: string): number[] | null {
  const match = /^v?(\d{4})\.(\d{1,4})\.(\d+)/.exec(value.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compare(left: number[], right: number[]): number {
  for (let index = 0; index < 3; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    if (a !== b) return a < b ? -1 : 1;
  }
  return 0;
}

export function assessServerVersion(reported: unknown, commit?: unknown): ServerVersionAssessment {
  const value = typeof reported === "string" ? reported.trim() : "";
  const testedCommit = matchTestedCommit(commit);
  const buildLabel = typeof commit === "string" && commit.trim() ? commit.trim().slice(0, 12) : null;
  if (!value) {
    if (testedCommit) return { status: "supported", reported: testedCommit };
    return {
      status: "unknown",
      reported: null,
      message: buildLabel
        ? `Server did not report a version and commit ${buildLabel} is not a tested build. Compatibility is unverified.`
        : "Server did not report a version. Compatibility is unverified.",
    };
  }
  const parsed = parseVersion(value);
  const minimum = parseVersion(MIN_SUPPORTED_SERVER_VERSION)!;
  const tested = TESTED_SERVER_VERSIONS.map((version) => parseVersion(version)!).filter(Boolean);
  const newest = tested.reduce((best, next) => (compare(next, best) > 0 ? next : best), tested[0]!);
  if (!parsed) {
    return { status: "unknown", reported: value, message: `Unrecognized server version "${value}".` };
  }
  if (compare(parsed, minimum) < 0) {
    return {
      status: "older-than-supported",
      reported: value,
      message: `Server ${value} is older than the minimum supported ${MIN_SUPPORTED_SERVER_VERSION}. Upgrade the server before relying on mutations.`,
    };
  }
  if (compare(parsed, newest) > 0) {
    return {
      status: "untested-newer",
      reported: value,
      message: `Server ${value} is newer than the tested versions (${TESTED_SERVER_VERSIONS.join(", ")}). Run the read-only canary before relying on mutations.`,
    };
  }
  return { status: "supported", reported: value };
}
