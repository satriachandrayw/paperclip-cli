import path from "node:path";

const MAX_REVIEW_WINDOW_MS = 31 * 24 * 60 * 60 * 1000;

export type ReviewScope =
  | {
      kind: "run";
      runId: string;
    }
  | {
      kind: "window";
      since: string;
      until: string;
      agentId?: string;
      companyId?: string;
    };

export interface ReviewEntrypointRequest {
  instancePath: string;
  scope?: ReviewScope;
}

export interface ValidatedReviewEntrypointRequest {
  instancePath: string;
  scope: ReviewScope;
  access: "read-only";
}

export interface ReviewEntrypointDependencies<TEvidence = unknown, TResult = unknown> {
  collect(request: Readonly<ValidatedReviewEntrypointRequest>): Promise<TEvidence> | TEvidence;
  judge(evidence: Readonly<TEvidence>): Promise<TResult> | TResult;
}

export interface ReviewEntrypointResult<TResult> {
  access: "read-only";
  result: TResult;
}

export type ReviewEntrypointErrorCode =
  | "missing-instance-path"
  | "invalid-instance-path"
  | "missing-review-scope"
  | "invalid-review-scope";

export class ReviewEntrypointError extends Error {
  constructor(
    public readonly code: ReviewEntrypointErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ReviewEntrypointError";
  }
}

export async function invokeReviewEntrypoint<TEvidence, TResult>(
  request: ReviewEntrypointRequest,
  dependencies: ReviewEntrypointDependencies<TEvidence, TResult>,
): Promise<ReviewEntrypointResult<TResult>> {
  const validatedRequest = validateReviewEntrypointRequest(request);
  const evidence = await dependencies.collect(validatedRequest);
  const result = await dependencies.judge(evidence);

  return { access: "read-only", result };
}

export function validateReviewEntrypointRequest(
  request: ReviewEntrypointRequest,
): ValidatedReviewEntrypointRequest {
  if (!request.instancePath.trim()) {
    throw new ReviewEntrypointError("missing-instance-path", "A local Paperclip instance path is required.");
  }

  if (!path.isAbsolute(request.instancePath)) {
    throw new ReviewEntrypointError(
      "invalid-instance-path",
      "A local Paperclip instance path must be an absolute filesystem path.",
    );
  }

  if (!request.scope) {
    throw new ReviewEntrypointError(
      "missing-review-scope",
      "A review must target one run or a bounded agent/company time window.",
    );
  }

  validateScope(request.scope);

  return {
    instancePath: request.instancePath,
    scope: request.scope,
    access: "read-only",
  };
}

function validateScope(scope: ReviewScope): void {
  if (scope.kind === "run" && scope.runId.trim()) return;

  const since = Date.parse(scope.kind === "window" ? scope.since : "");
  const until = Date.parse(scope.kind === "window" ? scope.until : "");
  const hasAgent = scope.kind === "window" && Boolean(scope.agentId?.trim());
  const hasCompany = scope.kind === "window" && Boolean(scope.companyId?.trim());

  if (
    scope.kind === "window" &&
    !Number.isNaN(since) &&
    !Number.isNaN(until) &&
    since < until &&
    until - since <= MAX_REVIEW_WINDOW_MS &&
    hasAgent !== hasCompany
  ) {
    return;
  }

  throw new ReviewEntrypointError(
    "invalid-review-scope",
    "A review scope must name one run or exactly one agent/company with a valid time window of 31 days or less.",
  );
}
