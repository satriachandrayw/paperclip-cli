/**
 * Paperclip Instruction Quality Analyzer
 * 
 * Deep analysis of agent instruction files:
 * - AGENTS.md: Role definition, routing, delegation rules
 * - SOUL.md: Personality, voice, decision-making
 * - HEARTBEAT.md: Execution checklist, procedure
 * - TOOLS.md: Tool documentation, environment setup
 * - VISION.md: Strategic direction, goals
 * 
 * Quality axes (from better-harness):
 * - Presence: configured, resolved-active, absent
 * - Content: relevant, current, actionable, maintainable
 * - Use: routed and applied in runs
 * - Outcome: effective after comparable outcome
 */

import type { AgentScan, InstructionFile } from "./filesystem.js";
import type { RunLogAnalysis } from "./run-log-analyzer.js";

// Types

export interface InstructionQualityReport {
  agentId: string;
  files: InstructionFileQuality[];
  overallScore: number;
  findings: InstructionFinding[];
}

export interface InstructionFileQuality {
  name: string;
  presence: PresenceStatus;
  content: ContentQuality;
  use: UseEvidence;
  outcome: OutcomeQuality;
  score: number;
  issues: string[];
}

export type PresenceStatus = "configured" | "empty" | "missing";

export interface ContentQuality {
  score: number; // 0-100
  clarity: number;
  completeness: number;
  actionability: number;
  maintainability: number;
  issues: string[];
}

export interface UseEvidence {
  score: number; // 0-100
  referenced: boolean;
  followed: boolean;
  issues: string[];
}

export interface OutcomeQuality {
  score: number; // 0-100
  effective: boolean;
  evidence: string;
}

export interface InstructionFinding {
  id: string;
  file: string;
  severity: "Critical" | "High" | "Medium" | "Low";
  title: string;
  description: string;
  evidence: string;
}

// Main analyzer

export function analyzeInstructionQuality(
  agentScan: AgentScan,
  runAnalyses?: RunLogAnalysis[]
): InstructionQualityReport {
  const files: InstructionFileQuality[] = [];
  const findings: InstructionFinding[] = [];

  // Analyze each instruction file
  for (const file of agentScan.instructions.files) {
    const quality = analyzeFile(file.name, file.contentPreview, agentScan, runAnalyses);
    files.push(quality);
    findings.push(...generateFindings(file.name, quality));
  }

  // Check for missing files
  const missingFiles = getMissingFiles(agentScan);
  for (const name of missingFiles) {
    files.push({
      name,
      presence: "missing",
      content: { score: 0, clarity: 0, completeness: 0, actionability: 0, maintainability: 0, issues: ["File missing"] },
      use: { score: 0, referenced: false, followed: false, issues: ["File missing"] },
      outcome: { score: 0, effective: false, evidence: "File missing" },
      score: 0,
      issues: ["File missing"],
    });
    findings.push({
      id: `missing-${name.toLowerCase().replace(".", "-")}`,
      file: name,
      severity: name === "AGENTS.md" ? "High" : "Medium",
      title: `${name} missing`,
      description: `Agent is missing ${name} instruction file.`,
      evidence: "File not found in instructions directory",
    });
  }

  // Calculate overall score
  const overallScore = files.length > 0
    ? Math.round(files.reduce((sum, f) => sum + f.score, 0) / files.length)
    : 0;

  return {
    agentId: agentScan.agentId,
    files,
    overallScore,
    findings,
  };
}

// File-specific analysis

function analyzeFile(
  name: string,
  content: string,
  agentScan: AgentScan,
  runAnalyses?: RunLogAnalysis[]
): InstructionFileQuality {
  switch (name) {
    case "AGENTS.md":
      return analyzeAgentsMd(content, agentScan, runAnalyses);
    case "SOUL.md":
      return analyzeSoulMd(content, runAnalyses);
    case "HEARTBEAT.md":
      return analyzeHeartbeatMd(content, runAnalyses);
    case "TOOLS.md":
      return analyzeToolsMd(content, runAnalyses);
    case "VISION.md":
      return analyzeVisionMd(content, runAnalyses);
    default:
      return analyzeGenericFile(name, content);
  }
}

// AGENTS.md Analysis

function analyzeAgentsMd(
  content: string,
  agentScan: AgentScan,
  runAnalyses?: RunLogAnalysis[]
): InstructionFileQuality {
  const issues: string[] = [];
  let clarity = 50;
  let completeness = 50;
  let actionability = 50;
  let maintainability = 50;

  // --- Content Quality ---

  // Check for role definition
  const hasRoleDefinition = /You are the|Role:|## Role/i.test(content);
  if (hasRoleDefinition) {
    clarity += 15;
  } else {
    issues.push("No clear role definition");
    clarity -= 20;
  }

  // Check for agent directory / routing table
  const hasRoutingTable = /Agent.*ID|Agent Directory|Routing/i.test(content);
  if (hasRoutingTable) {
    completeness += 15;
    actionability += 10;
  } else {
    issues.push("No routing table for delegation");
    completeness -= 15;
  }

  // Check for delegation rules
  const hasDelegationRules = /delegat|assign|handoff|escalat/i.test(content);
  if (hasDelegationRules) {
    actionability += 15;
  } else {
    issues.push("No delegation rules defined");
    actionability -= 15;
  }

  // Check for boundaries
  const hasBoundaries = /## Boundar|## Do not|## Never|## Critical Rules/i.test(content);
  if (hasBoundaries) {
    clarity += 10;
    actionability += 10;
  } else {
    issues.push("No explicit boundaries defined");
  }

  // Check for status workflow
  const hasStatusWorkflow = /status.*transition|## Status|lifecycle/i.test(content);
  if (hasStatusWorkflow) {
    completeness += 10;
    actionability += 10;
  }

  // Check for execution policy
  const hasExecutionPolicy = /execution.*polic|review.*stage|approval/i.test(content);
  if (hasExecutionPolicy) {
    completeness += 10;
  }

  // Check for issue treatment rules
  const hasIssueTreatment = /issue.*treatment|label|branch.*prefix/i.test(content);
  if (hasIssueTreatment) {
    completeness += 10;
    actionability += 10;
  }

  // Check for coordination rules
  const hasCoordinationRules = /coordination|cross.*team|dispatch/i.test(content);
  if (hasCoordinationRules) {
    completeness += 10;
  }

  // Check length (too short = incomplete, too long = unmaintainable)
  const wordCount = content.split(/\s+/).length;
  if (wordCount < 100) {
    issues.push("File too short - likely incomplete");
    completeness -= 20;
  } else if (wordCount > 2000) {
    issues.push("File very long - may be unmaintainable");
    maintainability -= 15;
  } else {
    maintainability += 10;
  }

  // Check for references to other files
  const hasReferences = /SOUL\.md|TOOLS\.md|HEARTBEAT\.md|shared\//i.test(content);
  if (hasReferences) {
    maintainability += 10;
  }

  // --- Use Evidence ---
  let useScore = 50;
  let referenced = false;
  let followed = false;

  if (runAnalyses && runAnalyses.length > 0) {
    // Check if AGENTS.md rules are followed in runs
    const delegationPattern = /delegat|assign|handoff/i;
    const hasDelegationInRuns = runAnalyses.some(r => 
      delegationPattern.test(r.disposition.reason || "")
    );

    if (hasDelegationRules && hasDelegationInRuns) {
      useScore += 30;
      followed = true;
    } else if (hasDelegationRules && !hasDelegationInRuns) {
      useScore -= 20;
      issues.push("Delegation rules defined but not followed in runs");
    }

    referenced = true;
  }

  // --- Outcome ---
  let outcomeScore = 50;
  let effective = false;

  if (runAnalyses && runAnalyses.length > 0) {
    // Check if runs complete successfully
    const successRate = runAnalyses.filter(r => r.disposition.issueStatus === "done").length / runAnalyses.length;
    if (successRate > 0.8) {
      outcomeScore += 30;
      effective = true;
    } else if (successRate < 0.5) {
      outcomeScore -= 20;
    }
  }

  // Clamp scores
  clarity = clamp(clarity, 0, 100);
  completeness = clamp(completeness, 0, 100);
  actionability = clamp(actionability, 0, 100);
  maintainability = clamp(maintainability, 0, 100);
  useScore = clamp(useScore, 0, 100);
  outcomeScore = clamp(outcomeScore, 0, 100);

  const contentScore = Math.round((clarity + completeness + actionability + maintainability) / 4);
  const score = Math.round((contentScore + useScore + outcomeScore) / 3);

  return {
    name: "AGENTS.md",
    presence: "configured",
    content: { score: contentScore, clarity, completeness, actionability, maintainability, issues },
    use: { score: useScore, referenced, followed, issues },
    outcome: { score: outcomeScore, effective, evidence: effective ? "Runs complete successfully" : "Insufficient evidence" },
    score,
    issues,
  };
}

// SOUL.md Analysis

function analyzeSoulMd(
  content: string,
  runAnalyses?: RunLogAnalysis[]
): InstructionFileQuality {
  const issues: string[] = [];
  let clarity = 50;
  let completeness = 50;
  let actionability = 50;
  let maintainability = 50;

  // Check for personality definition
  const hasPersonality = /## Core Traits|personality|character/i.test(content);
  if (hasPersonality) {
    clarity += 20;
  } else {
    issues.push("No personality traits defined");
  }

  // Check for voice/tone
  const hasVoice = /## Voice|tone|communication/i.test(content);
  if (hasVoice) {
    clarity += 15;
    actionability += 10;
  } else {
    issues.push("No voice/tone guidelines");
  }

  // Check for decision-making framework
  const hasDecisionFramework = /## Decision|tradeoff|criteria/i.test(content);
  if (hasDecisionFramework) {
    completeness += 15;
    actionability += 15;
  } else {
    issues.push("No decision-making framework");
  }

  // Check for strategic posture
  const hasStrategicPosture = /## Strategic|strategy|posture/i.test(content);
  if (hasStrategicPosture) {
    completeness += 10;
  }

  // Check length
  const wordCount = content.split(/\s+/).length;
  if (wordCount < 50) {
    issues.push("File too short");
    completeness -= 20;
  } else if (wordCount > 500) {
    maintainability -= 10;
  }

  // Use evidence (harder to measure for SOUL.md)
  let useScore = 50;
  let outcomeScore = 50;

  // Clamp
  clarity = clamp(clarity, 0, 100);
  completeness = clamp(completeness, 0, 100);
  actionability = clamp(actionability, 0, 100);
  maintainability = clamp(maintainability, 0, 100);

  const contentScore = Math.round((clarity + completeness + actionability + maintainability) / 4);
  const score = Math.round((contentScore + useScore + outcomeScore) / 3);

  return {
    name: "SOUL.md",
    presence: "configured",
    content: { score: contentScore, clarity, completeness, actionability, maintainability, issues },
    use: { score: useScore, referenced: false, followed: false, issues },
    outcome: { score: outcomeScore, effective: false, evidence: "Not measurable" },
    score,
    issues,
  };
}

// HEARTBEAT.md Analysis

function analyzeHeartbeatMd(
  content: string,
  runAnalyses?: RunLogAnalysis[]
): InstructionFileQuality {
  const issues: string[] = [];
  let clarity = 50;
  let completeness = 50;
  let actionability = 50;
  let maintainability = 50;

  // Check for checklist
  const hasChecklist = /## Checklist|## Steps|## Procedure|- \[[ x]\]/i.test(content);
  if (hasChecklist) {
    clarity += 20;
    actionability += 20;
  } else {
    issues.push("No checklist or procedure defined");
  }

  // Check for status update rules
  const hasStatusRules = /status.*update|update.*status|PATCH.*issues/i.test(content);
  if (hasStatusRules) {
    actionability += 15;
  }

  // Check for comment requirements
  const hasCommentRules = /comment|## Communication/i.test(content);
  if (hasCommentRules) {
    completeness += 10;
    actionability += 10;
  }

  // Check for error handling
  const hasErrorHandling = /error|fail|retry|block/i.test(content);
  if (hasErrorHandling) {
    completeness += 10;
  }

  // Use evidence
  let useScore = 50;
  let followed = false;

  if (runAnalyses && runAnalyses.length > 0) {
    // Check if heartbeat procedure is followed
    const hasCheckout = runAnalyses.some(r => 
      /checkout/i.test(r.disposition.reason || "")
    );
    if (hasChecklist && hasCheckout) {
      useScore += 20;
      followed = true;
    }
  }

  // Clamp
  clarity = clamp(clarity, 0, 100);
  completeness = clamp(completeness, 0, 100);
  actionability = clamp(actionability, 0, 100);
  maintainability = clamp(maintainability, 0, 100);

  const contentScore = Math.round((clarity + completeness + actionability + maintainability) / 4);
  const score = Math.round((contentScore + useScore + 50) / 3);

  return {
    name: "HEARTBEAT.md",
    presence: "configured",
    content: { score: contentScore, clarity, completeness, actionability, maintainability, issues },
    use: { score: useScore, referenced: false, followed, issues },
    outcome: { score: 50, effective: false, evidence: "Not measured" },
    score,
    issues,
  };
}

// TOOLS.md Analysis

function analyzeToolsMd(
  content: string,
  runAnalyses?: RunLogAnalysis[]
): InstructionFileQuality {
  const issues: string[] = [];
  let clarity = 50;
  let completeness = 50;
  let actionability = 50;
  let maintainability = 50;

  // Check for API documentation
  const hasApiDocs = /## API|## Endpoints|curl|fetch/i.test(content);
  if (hasApiDocs) {
    completeness += 20;
    actionability += 15;
  } else {
    issues.push("No API documentation");
  }

  // Check for environment setup
  const hasEnvSetup = /## Environment|env var|setup|install/i.test(content);
  if (hasEnvSetup) {
    completeness += 15;
    actionability += 10;
  } else {
    issues.push("No environment setup instructions");
  }

  // Check for auth instructions
  const hasAuth = /auth|token|credential|secret/i.test(content);
  if (hasAuth) {
    completeness += 10;
  }

  // Check for examples
  const hasExamples = /## Example|```|curl.*example/i.test(content);
  if (hasExamples) {
    clarity += 15;
    actionability += 15;
  }

  // Check for error handling
  const hasErrorHandling = /error|## Troubleshoot|## Common Issues/i.test(content);
  if (hasErrorHandling) {
    completeness += 10;
    actionability += 10;
  }

  // Use evidence
  let useScore = 50;
  let followed = false;

  if (runAnalyses && runAnalyses.length > 0) {
    // Check if documented tools are used
    const toolNames = content.match(/## (\w+)/g)?.map(m => m.replace("## ", "").toLowerCase()) || [];
    const toolsUsed = runAnalyses.some(r => 
      Object.keys(r.tools.toolDistribution).some(t => 
        toolNames.includes(t.toLowerCase())
      )
    );
    if (toolsUsed) {
      useScore += 20;
      followed = true;
    }
  }

  // Clamp
  clarity = clamp(clarity, 0, 100);
  completeness = clamp(completeness, 0, 100);
  actionability = clamp(actionability, 0, 100);
  maintainability = clamp(maintainability, 0, 100);

  const contentScore = Math.round((clarity + completeness + actionability + maintainability) / 4);
  const score = Math.round((contentScore + useScore + 50) / 3);

  return {
    name: "TOOLS.md",
    presence: "configured",
    content: { score: contentScore, clarity, completeness, actionability, maintainability, issues },
    use: { score: useScore, referenced: false, followed, issues },
    outcome: { score: 50, effective: false, evidence: "Not measured" },
    score,
    issues,
  };
}

// VISION.md Analysis

function analyzeVisionMd(
  content: string,
  runAnalyses?: RunLogAnalysis[]
): InstructionFileQuality {
  const issues: string[] = [];
  let clarity = 50;
  let completeness = 50;
  let actionability = 50;
  let maintainability = 50;

  // Check for mission statement
  const hasMission = /## Mission|## Vision|## Goal/i.test(content);
  if (hasMission) {
    clarity += 20;
    completeness += 15;
  } else {
    issues.push("No mission/vision statement");
  }

  // Check for strategic goals
  const hasGoals = /## Goals|## Objectives|## Targets/i.test(content);
  if (hasGoals) {
    completeness += 15;
    actionability += 10;
  }

  // Check for success metrics
  const hasMetrics = /## Metrics|## KPI|## Measure/i.test(content);
  if (hasMetrics) {
    completeness += 10;
    actionability += 15;
  }

  // Check for constraints
  const hasConstraints = /## Constraints|## Boundaries|## Limits/i.test(content);
  if (hasConstraints) {
    clarity += 10;
  }

  // Clamp
  clarity = clamp(clarity, 0, 100);
  completeness = clamp(completeness, 0, 100);
  actionability = clamp(actionability, 0, 100);
  maintainability = clamp(maintainability, 0, 100);

  const contentScore = Math.round((clarity + completeness + actionability + maintainability) / 4);
  const score = Math.round((contentScore + 50 + 50) / 3);

  return {
    name: "VISION.md",
    presence: "configured",
    content: { score: contentScore, clarity, completeness, actionability, maintainability, issues },
    use: { score: 50, referenced: false, followed: false, issues },
    outcome: { score: 50, effective: false, evidence: "Not measured" },
    score,
    issues,
  };
}

// Generic file analysis

function analyzeGenericFile(name: string, content: string): InstructionFileQuality {
  const wordCount = content.split(/\s+/).length;
  const hasSections = /^##/m.test(content);
  const hasCodeBlocks = /```/.test(content);

  let score = 50;
  if (wordCount > 100) score += 10;
  if (hasSections) score += 10;
  if (hasCodeBlocks) score += 10;

  return {
    name,
    presence: "configured",
    content: { score, clarity: 50, completeness: 50, actionability: 50, maintainability: 50, issues: [] },
    use: { score: 50, referenced: false, followed: false, issues: [] },
    outcome: { score: 50, effective: false, evidence: "Not measured" },
    score,
    issues: [],
  };
}

// Helper functions

function getMissingFiles(agentScan: AgentScan): string[] {
  const expected = ["AGENTS.md", "SOUL.md", "HEARTBEAT.md", "TOOLS.md", "VISION.md"];
  const existing = agentScan.instructions.files.map(f => f.name);
  return expected.filter(name => !existing.includes(name));
}

function generateFindings(name: string, quality: InstructionFileQuality): InstructionFinding[] {
  const findings: InstructionFinding[] = [];

  if (quality.score < 50) {
    findings.push({
      id: `low-quality-${name.toLowerCase().replace(".", "-")}`,
      file: name,
      severity: "Medium",
      title: `${name} quality is low (${quality.score}/100)`,
      description: `${name} has quality issues that may affect agent performance.`,
      evidence: quality.issues.join("; "),
    });
  }

  if (!quality.use.followed && quality.use.score < 50) {
    findings.push({
      id: `unused-${name.toLowerCase().replace(".", "-")}`,
      file: name,
      severity: "Low",
      title: `${name} rules not followed in runs`,
      description: `Defined rules in ${name} are not being followed by the agent.`,
      evidence: quality.use.issues.join("; "),
    });
  }

  return findings;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// Batch analysis

export interface InstructionBatchResult {
  agents: InstructionQualityReport[];
  aggregate: InstructionAggregate;
}

export interface InstructionAggregate {
  totalAgents: number;
  avgScore: number;
  fileScores: Record<string, number>;
  topIssues: Array<{ issue: string; count: number }>;
}

export function analyzeBatchInstructionQuality(
  agentScans: AgentScan[],
  runAnalysesMap?: Map<string, RunLogAnalysis[]>
): InstructionBatchResult {
  const agents: InstructionQualityReport[] = [];

  for (const agentScan of agentScans) {
    const runAnalyses = runAnalysesMap?.get(agentScan.agentId);
    agents.push(analyzeInstructionQuality(agentScan, runAnalyses));
  }

  // Compute aggregates
  const totalAgents = agents.length;
  const avgScore = totalAgents > 0
    ? Math.round(agents.reduce((sum, a) => sum + a.overallScore, 0) / totalAgents)
    : 0;

  // File scores
  const fileScores: Record<string, { total: number; count: number }> = {};
  for (const agent of agents) {
    for (const file of agent.files) {
      if (!fileScores[file.name]) {
        fileScores[file.name] = { total: 0, count: 0 };
      }
      const entry = fileScores[file.name];
      if (entry) {
        entry.total += file.score;
        entry.count++;
      }
    }
  }

  const avgFileScores: Record<string, number> = {};
  for (const [name, data] of Object.entries(fileScores)) {
    avgFileScores[name] = Math.round(data.total / data.count);
  }

  // Top issues
  const issueCounts: Record<string, number> = {};
  for (const agent of agents) {
    for (const finding of agent.findings) {
      issueCounts[finding.title] = (issueCounts[finding.title] || 0) + 1;
    }
  }

  const topIssues = Object.entries(issueCounts)
    .map(([issue, count]) => ({ issue, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    agents,
    aggregate: {
      totalAgents,
      avgScore,
      fileScores: avgFileScores,
      topIssues,
    },
  };
}
