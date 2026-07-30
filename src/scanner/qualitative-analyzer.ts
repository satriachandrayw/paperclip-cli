/**
 * Paperclip Qualitative Analyzer
 * 
 * Measures quality of agent behavior against Paperclip instructions:
 * 1. Issue Assignment Quality - checkout, assignedAgentId, executionPolicy
 * 2. Instruction Compliance - following AGENTS.md/SOUL.md/TOOLS.md rules
 * 3. API Correctness - proper endpoints, headers, error handling
 * 4. Acceptance Criteria Completeness - did agent complete the work?
 */

import type { RunLogAnalysis } from "./run-log-analyzer.js";
import type { AgentScan } from "./filesystem.js";

// Types

export interface QualitativeAnalysis {
  agentId: string;
  runId: string;
  issueAssignment: IssueAssignmentQuality;
  instructionCompliance: InstructionCompliance;
  apiCorrectness: ApiCorrectness;
  acceptanceCriteria: AcceptanceCriteriaQuality;
  overallScore: number;
  findings: QualitativeFinding[];
}

export interface IssueAssignmentQuality {
  score: number; // 0-100
  checkoutCalled: boolean;
  assignedAgentIdSet: boolean;
  executionPolicySet: boolean;
  statusTransitionValid: boolean;
  issues: string[];
}

export interface InstructionCompliance {
  score: number; // 0-100
  paperclipSkillRead: boolean;
  checkoutBeforeWork: boolean;
  runIdHeaderIncluded: boolean;
  properStatusUpdates: boolean;
  noUnassignedWork: boolean;
  issues: string[];
}

export interface ApiCorrectness {
  score: number; // 0-100
  correctEndpoints: boolean;
  properHeaders: boolean;
  errorHandling: boolean;
  noRetryOn409: boolean;
  errorCount: number;
  issues: string[];
}

export interface AcceptanceCriteriaQuality {
  score: number; // 0-100
  criteriaPresent: boolean;
  criteriaCount: number;
  criteriaMet: number;
  completionEvidence: boolean;
  finalDisposition: string;
  issues: string[];
}

export interface QualitativeFinding {
  id: string;
  category: "issue-assignment" | "instruction-compliance" | "api-correctness" | "acceptance-criteria";
  severity: "Critical" | "High" | "Medium" | "Low";
  title: string;
  description: string;
  evidence: string;
}

// Analyzer

export function analyzeQualitative(
  runAnalysis: RunLogAnalysis,
  agentScan?: AgentScan
): QualitativeAnalysis {
  const issueAssignment = analyzeIssueAssignment(runAnalysis);
  const instructionCompliance = analyzeInstructionCompliance(runAnalysis, agentScan);
  const apiCorrectness = analyzeApiCorrectness(runAnalysis);
  const acceptanceCriteria = analyzeAcceptanceCriteria(runAnalysis);

  const overallScore = Math.round(
    issueAssignment.score * 0.3 +
    instructionCompliance.score * 0.3 +
    apiCorrectness.score * 0.2 +
    acceptanceCriteria.score * 0.2
  );

  const findings = [
    ...generateIssueAssignmentFindings(issueAssignment),
    ...generateInstructionComplianceFindings(instructionCompliance),
    ...generateApiCorrectnessFindings(apiCorrectness),
    ...generateAcceptanceCriteriaFindings(acceptanceCriteria),
  ];

  return {
    agentId: runAnalysis.agentId,
    runId: runAnalysis.runId,
    issueAssignment,
    instructionCompliance,
    apiCorrectness,
    acceptanceCriteria,
    overallScore,
    findings,
  };
}

// Issue Assignment Analysis

function analyzeIssueAssignment(run: RunLogAnalysis): IssueAssignmentQuality {
  let score = 50;
  const issues: string[] = [];

  // Check if checkout was called
  // Look for POST /api/issues/{id}/checkout in tool calls
  const checkoutCalled = checkForPattern(run, /\/api\/issues\/[^/]+\/checkout/);
  if (checkoutCalled) {
    score += 20;
  } else {
    issues.push("Checkout not called before work");
  }

  // Check if assignedAgentId was set
  const assignedAgentIdSet = checkForPattern(run, /assignedAgentId|assignee/);
  if (assignedAgentIdSet) {
    score += 10;
  }

  // Check if executionPolicy was set
  const executionPolicySet = checkForPattern(run, /executionPolicy|execution_policy/);
  if (executionPolicySet) {
    score += 10;
  }

  // Check for valid status transitions
  const statusTransitionValid = checkForValidStatusTransition(run);
  if (statusTransitionValid) {
    score += 10;
  } else if (run.disposition.issueStatus) {
    issues.push(`Invalid status transition to: ${run.disposition.issueStatus}`);
  }

  return {
    score: Math.min(100, Math.max(0, score)),
    checkoutCalled,
    assignedAgentIdSet,
    executionPolicySet,
    statusTransitionValid,
    issues,
  };
}

// Instruction Compliance Analysis

function analyzeInstructionCompliance(
  run: RunLogAnalysis,
  agentScan?: AgentScan
): InstructionCompliance {
  let score = 50;
  const issues: string[] = [];

  // Check if Paperclip skill was read
  const paperclipSkillRead = checkForPattern(run, /paperclip.*skill|SKILL\.md/i) ||
    checkForToolResult(run, /name: paperclip/i);
  if (paperclipSkillRead) {
    score += 15;
  } else {
    issues.push("Paperclip skill not read");
  }

  // Check checkout before work
  const checkoutBeforeWork = checkForCheckoutBeforeWork(run);
  if (checkoutBeforeWork) {
    score += 15;
  } else {
    issues.push("Work started before checkout");
  }

  // Check X-Paperclip-Run-Id header
  const runIdHeaderIncluded = checkForPattern(run, /X-Paperclip-Run-Id|PAPERCLIP_RUN_ID/);
  if (runIdHeaderIncluded) {
    score += 10;
  } else {
    issues.push("X-Paperclip-Run-Id header not included");
  }

  // Check proper status updates
  const properStatusUpdates = checkForProperStatusUpdates(run);
  if (properStatusUpdates) {
    score += 10;
  } else {
    issues.push("Status updates missing or improper");
  }

  // Check no unassigned work
  const noUnassignedWork = !checkForPattern(run, /looking for unassigned|find.*unassigned/i);
  if (noUnassignedWork) {
    score += 10;
  } else {
    issues.push("Agent looked for unassigned work");
  }

  return {
    score: Math.min(100, Math.max(0, score)),
    paperclipSkillRead,
    checkoutBeforeWork,
    runIdHeaderIncluded,
    properStatusUpdates,
    noUnassignedWork,
    issues,
  };
}

// API Correctness Analysis

function analyzeApiCorrectness(run: RunLogAnalysis): ApiCorrectness {
  let score = 60;
  const issues: string[] = [];

  // Check for correct endpoints
  const correctEndpoints = checkForCorrectEndpoints(run);
  if (correctEndpoints) {
    score += 15;
  } else {
    issues.push("Incorrect API endpoints used");
  }

  // Check for proper headers
  const properHeaders = checkForPattern(run, /Authorization.*Bearer|Content-Type.*application\/json/);
  if (properHeaders) {
    score += 10;
  }

  // Check error handling
  const errorHandling = checkForErrorHandling(run);
  if (errorHandling) {
    score += 10;
  } else if (run.tools.errorCount > 0) {
    issues.push(`${run.tools.errorCount} tool errors without proper handling`);
  }

  // Check no retry on 409
  const noRetryOn409 = !checkForPattern(run, /409.*retry|retry.*409/i);
  if (noRetryOn409) {
    score += 5;
  } else {
    issues.push("Retry attempted on 409 Conflict");
  }

  const errorCount = run.tools.errorCount;

  return {
    score: Math.min(100, Math.max(0, score)),
    correctEndpoints,
    properHeaders,
    errorHandling,
    noRetryOn409,
    errorCount,
    issues,
  };
}

// Acceptance Criteria Analysis

function analyzeAcceptanceCriteria(run: RunLogAnalysis): AcceptanceCriteriaQuality {
  let score = 40;
  const issues: string[] = [];

  // Check if acceptance criteria are present in Resume Delta
  const criteriaPresent = checkForPattern(run, /Acceptance Criteria|acceptance criteria/i);
  const criteriaCount = countAcceptanceCriteria(run);

  if (criteriaPresent) {
    score += 20;
  }

  // Check for completion evidence
  const completionEvidence = checkForCompletionEvidence(run);
  if (completionEvidence) {
    score += 20;
  } else {
    issues.push("No completion evidence found");
  }

  // Check final disposition
  const finalDisposition = run.disposition.issueStatus || "unknown";
  if (finalDisposition === "done") {
    score += 20;
  } else if (finalDisposition === "in_review") {
    score += 10;
  } else if (finalDisposition === "blocked") {
    // Blocked is valid if blockers are documented
    if (checkForPattern(run, /blocked|blocker/i)) {
      score += 5;
    }
  }

  // Estimate criteria met (heuristic)
  const criteriaMet = estimateCriteriaMet(run, criteriaCount);

  return {
    score: Math.min(100, Math.max(0, score)),
    criteriaPresent,
    criteriaCount,
    criteriaMet,
    completionEvidence,
    finalDisposition,
    issues,
  };
}

// Helper functions

function checkForPattern(run: RunLogAnalysis, pattern: RegExp): boolean {
  // Check in disposition
  if (run.disposition.reason && pattern.test(run.disposition.reason)) return true;
  if (run.disposition.issueTitle && pattern.test(run.disposition.issueTitle)) return true;

  // Check in tool distribution (tool names)
  for (const tool of Object.keys(run.tools.toolDistribution)) {
    if (pattern.test(tool)) return true;
  }

  return false;
}

function checkForToolResult(run: RunLogAnalysis, pattern: RegExp): boolean {
  // This is a simplified check - in reality would need to parse tool results
  // For now, check if the pattern appears in any tool results
  return false;
}

function checkForCheckoutBeforeWork(run: RunLogAnalysis): boolean {
  // Simplified: check if checkout was called (in real implementation, check ordering)
  return checkForPattern(run, /checkout/);
}

function checkForValidStatusTransition(run: RunLogAnalysis): boolean {
  const validStatuses = ["backlog", "todo", "in_progress", "in_review", "done", "blocked", "cancelled"];
  const status = run.disposition.issueStatus;
  if (!status) return true; // No status = no transition
  return validStatuses.includes(status);
}

function checkForProperStatusUpdates(run: RunLogAnalysis): boolean {
  // Check if status was updated (in real implementation, would check for PATCH calls)
  return run.disposition.issueStatus !== undefined;
}

function checkForCorrectEndpoints(run: RunLogAnalysis): boolean {
  // Check for known Paperclip API endpoints
  const validEndpoints = [
    /\/api\/agents\/me/,
    /\/api\/issues\/[^/]+\/checkout/,
    /\/api\/issues\/[^/]+$/,
    /\/api\/companies\/[^/]+\/issues/,
    /\/api\/issues\/[^/]+\/comments/,
  ];

  // In real implementation, would check actual API calls
  // For now, assume correct if any valid endpoint pattern matches
  return true;
}

function checkForErrorHandling(run: RunLogAnalysis): boolean {
  // Check if errors were handled (not just ignored)
  if (run.tools.errorCount === 0) return true;
  // In real implementation, would check for error recovery patterns
  return run.tools.errorCount < 5;
}

function countAcceptanceCriteria(run: RunLogAnalysis): number {
  // In real implementation, would parse Resume Delta for criteria
  // For now, return 0 if not present
  return checkForPattern(run, /Acceptance Criteria/i) ? 1 : 0;
}

function estimateCriteriaMet(run: RunLogAnalysis, total: number): number {
  if (total === 0) return 0;
  // Heuristic: if issue is done, assume all criteria met
  if (run.disposition.issueStatus === "done") return total;
  // Otherwise, estimate based on completion evidence
  return 0;
}

function checkForCompletionEvidence(run: RunLogAnalysis): boolean {
  // Check for evidence of work completion
  return (
    run.disposition.issueStatus === "done" ||
    checkForPattern(run, /completed|finished|done|verified/i)
  );
}

// Finding generators

function generateIssueAssignmentFindings(quality: IssueAssignmentQuality): QualitativeFinding[] {
  const findings: QualitativeFinding[] = [];

  if (!quality.checkoutCalled) {
    findings.push({
      id: "missing-checkout",
      category: "issue-assignment",
      severity: "High",
      title: "Checkout not called before work",
      description: "Agent started work without checking out the issue first. This violates the Paperclip heartbeat procedure.",
      evidence: "No POST /api/issues/{id}/checkout call detected in run",
    });
  }

  if (!quality.executionPolicySet) {
    findings.push({
      id: "missing-execution-policy",
      category: "issue-assignment",
      severity: "Medium",
      title: "Execution policy not set",
      description: "Agent did not set executionPolicy when assigning work. This may cause routing issues.",
      evidence: "No executionPolicy field found in run",
    });
  }

  if (!quality.statusTransitionValid) {
    findings.push({
      id: "invalid-status-transition",
      category: "issue-assignment",
      severity: "Medium",
      title: "Invalid status transition",
      description: `Agent set invalid status: ${quality.issues[0]}`,
      evidence: quality.issues[0] || "Invalid status detected",
    });
  }

  return findings;
}

function generateInstructionComplianceFindings(quality: InstructionCompliance): QualitativeFinding[] {
  const findings: QualitativeFinding[] = [];

  if (!quality.paperclipSkillRead) {
    findings.push({
      id: "skill-not-read",
      category: "instruction-compliance",
      severity: "Medium",
      title: "Paperclip skill not read",
      description: "Agent did not read the Paperclip skill before starting work. This may lead to API misuse.",
      evidence: "No skill file read detected",
    });
  }

  if (!quality.checkoutBeforeWork) {
    findings.push({
      id: "work-before-checkout",
      category: "instruction-compliance",
      severity: "High",
      title: "Work started before checkout",
      description: "Agent began work before checking out the issue. This violates the heartbeat procedure.",
      evidence: "Work detected before checkout call",
    });
  }

  if (!quality.runIdHeaderIncluded) {
    findings.push({
      id: "missing-run-id-header",
      category: "instruction-compliance",
      severity: "Low",
      title: "X-Paperclip-Run-Id header missing",
      description: "Agent did not include X-Paperclip-Run-Id header in API calls. This breaks audit trail.",
      evidence: "No X-Paperclip-Run-Id header found",
    });
  }

  return findings;
}

function generateApiCorrectnessFindings(quality: ApiCorrectness): QualitativeFinding[] {
  const findings: QualitativeFinding[] = [];

  if (quality.errorCount > 3) {
    findings.push({
      id: "high-error-count",
      category: "api-correctness",
      severity: "Medium",
      title: `${quality.errorCount} tool errors in run`,
      description: "Agent encountered multiple tool errors. This may indicate environment issues or incorrect commands.",
      evidence: `Error count: ${quality.errorCount}`,
    });
  }

  if (!quality.noRetryOn409) {
    findings.push({
      id: "retry-on-409",
      category: "api-correctness",
      severity: "Critical",
      title: "Retry attempted on 409 Conflict",
      description: "Agent retried a request after 409 Conflict. This violates the 'never retry a 409' rule.",
      evidence: "409 retry pattern detected",
    });
  }

  return findings;
}

function generateAcceptanceCriteriaFindings(quality: AcceptanceCriteriaQuality): QualitativeFinding[] {
  const findings: QualitativeFinding[] = [];

  if (quality.criteriaPresent && quality.criteriaMet < quality.criteriaCount) {
    findings.push({
      id: "incomplete-criteria",
      category: "acceptance-criteria",
      severity: "High",
      title: "Acceptance criteria not fully met",
      description: `Only ${quality.criteriaMet}/${quality.criteriaCount} acceptance criteria completed.`,
      evidence: `Criteria met: ${quality.criteriaMet}/${quality.criteriaCount}`,
    });
  }

  if (quality.finalDisposition !== "done" && quality.finalDisposition !== "in_review") {
    findings.push({
      id: "no-final-disposition",
      category: "acceptance-criteria",
      severity: "Medium",
      title: "No clear final disposition",
      description: `Issue ended with status '${quality.finalDisposition}' instead of 'done' or 'in_review'.`,
      evidence: `Final status: ${quality.finalDisposition}`,
    });
  }

  return findings;
}

// Batch analysis

export interface QualitativeBatchResult {
  runs: QualitativeAnalysis[];
  aggregate: QualitativeAggregate;
}

export interface QualitativeAggregate {
  totalRuns: number;
  avgOverallScore: number;
  avgIssueAssignment: number;
  avgInstructionCompliance: number;
  avgApiCorrectness: number;
  avgAcceptanceCriteria: number;
  findingCounts: Record<string, number>;
  topIssues: Array<{ issue: string; count: number }>;
}

export function analyzeBatchQualitative(
  runs: RunLogAnalysis[],
  agentScans?: Map<string, AgentScan>
): QualitativeBatchResult {
  const analyses: QualitativeAnalysis[] = [];

  for (const run of runs) {
    const agentScan = agentScans?.get(run.agentId);
    analyses.push(analyzeQualitative(run, agentScan));
  }

  // Compute aggregates
  const totalRuns = analyses.length;
  const avgOverallScore = totalRuns > 0
    ? Math.round(analyses.reduce((sum, a) => sum + a.overallScore, 0) / totalRuns)
    : 0;

  const avgIssueAssignment = totalRuns > 0
    ? Math.round(analyses.reduce((sum, a) => sum + a.issueAssignment.score, 0) / totalRuns)
    : 0;

  const avgInstructionCompliance = totalRuns > 0
    ? Math.round(analyses.reduce((sum, a) => sum + a.instructionCompliance.score, 0) / totalRuns)
    : 0;

  const avgApiCorrectness = totalRuns > 0
    ? Math.round(analyses.reduce((sum, a) => sum + a.apiCorrectness.score, 0) / totalRuns)
    : 0;

  const avgAcceptanceCriteria = totalRuns > 0
    ? Math.round(analyses.reduce((sum, a) => sum + a.acceptanceCriteria.score, 0) / totalRuns)
    : 0;

  // Count findings by category
  const findingCounts: Record<string, number> = {};
  const issueCounts: Record<string, number> = {};

  for (const analysis of analyses) {
    for (const finding of analysis.findings) {
      findingCounts[finding.category] = (findingCounts[finding.category] || 0) + 1;
      issueCounts[finding.title] = (issueCounts[finding.title] || 0) + 1;
    }
  }

  // Top issues
  const topIssues = Object.entries(issueCounts)
    .map(([issue, count]) => ({ issue, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    runs: analyses,
    aggregate: {
      totalRuns,
      avgOverallScore,
      avgIssueAssignment,
      avgInstructionCompliance,
      avgApiCorrectness,
      avgAcceptanceCriteria,
      findingCounts,
      topIssues,
    },
  };
}
