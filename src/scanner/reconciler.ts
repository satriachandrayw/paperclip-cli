/**
 * Paperclip Harness Findings Reconciler
 * 
 * Merges evidence from filesystem scanner and run-log analyzer,
 * assigns severity, derives dimension scores, and renders reports.
 */

import type { InstanceScan, ScanStats } from "./filesystem.js";
import type { RunLogAnalysis, AggregateStats } from "./run-log-analyzer.js";
import type { QualitativeAggregate } from "./qualitative-analyzer.js";

// Types

export interface HarnessReport {
  summary: ReportSummary;
  findings: Finding[];
  priorityMoves: PriorityMove[];
  metadata: ReportMetadata;
}

export interface ReportSummary {
  instanceId: string;
  companyId?: string;
  locale: string;
  modelId: string;
  reportContractVersion: number;
  overview: string;
  dimensions: DimensionScore[];
  agentInventory: AgentInventory;
}

export interface DimensionScore {
  id: string;
  label: string;
  score: number;
  summary: string;
}

export interface AgentInventory {
  totalAgents: number;
  activeAgents: number;
  totalRuns: number;
  timeWindow: string;
  agentRoles: AgentRoleCount[];
}

export interface AgentRoleCount {
  agentId: string;
  role: string;
  runCount: number;
  avgTokensPerRun: number;
  errorRate: number;
  dispositionDistribution: Record<string, number>;
}

export interface Finding {
  id: string;
  title: string;
  severity: "Critical" | "High" | "Medium" | "Low" | "Informational";
  dimensionRefs: string[];
  reason: string;
  evidence: Evidence;
  owner: FindingOwner;
  consequence: string;
  repairPrompt: string;
  expectedArtifact: string;
  expectedOutput: string[];
  confidence: "high" | "medium" | "low";
}

export interface Evidence {
  type: "filesystem" | "api" | "run-log" | "instruction";
  source: string;
  excerpt: string;
}

export interface FindingOwner {
  type: "agent" | "company" | "instance";
  id: string;
  role: string;
}

export interface PriorityMove {
  title: string;
  impact: string;
  effort: "low" | "medium" | "high";
  findingIds: string[];
}

export interface ReportMetadata {
  generatedAt: string;
  scannerVersion: string;
  analyzerVersion: string;
  timeWindow: string;
}

// Reconciler

export interface ReconcileOptions {
  instanceScan: InstanceScan;
  runAnalyses: RunLogAnalysis[];
  aggregateStats: AggregateStats;
  qualitativeStats?: QualitativeAggregate;
  companyId?: string;
  timeWindow?: string;
}

export function reconcile(options: ReconcileOptions): HarnessReport {
  const { instanceScan, runAnalyses, aggregateStats, qualitativeStats, companyId, timeWindow = "7d" } = options;

  // Compute dimension scores
  const dimensions = computeDimensions(instanceScan, runAnalyses, aggregateStats, qualitativeStats);

  // Generate findings
  const findings = generateFindings(instanceScan, runAnalyses, aggregateStats, qualitativeStats);

  // Generate priority moves
  const priorityMoves = generatePriorityMoves(findings);

  // Build agent inventory
  const agentInventory = buildAgentInventory(instanceScan, aggregateStats);

  // Generate overview
  const overview = generateOverview(dimensions, findings);

  return {
    summary: {
      instanceId: instanceScan.instanceId,
      companyId,
      locale: "en",
      modelId: "paperclip-harness-v1",
      reportContractVersion: 1,
      overview,
      dimensions,
      agentInventory,
    },
    findings,
    priorityMoves,
    metadata: {
      generatedAt: new Date().toISOString(),
      scannerVersion: "0.1.0",
      analyzerVersion: "0.1.0",
      timeWindow,
    },
  };
}

// Dimension scoring

function computeDimensions(
  scan: InstanceScan,
  analyses: RunLogAnalysis[],
  stats: AggregateStats,
  qualitativeStats?: QualitativeAggregate
): DimensionScore[] {
  return [
    computeAgentConfiguration(scan),
    computeCoordinationHealth(scan, analyses),
    computeExecutionQuality(analyses, stats, qualitativeStats),
    computeLearningCapture(scan),
    computeGovernanceSafety(scan),
  ];
}

function computeAgentConfiguration(scan: InstanceScan): DimensionScore {
  let score = 50;
  let totalAgents = 0;
  let agentsWithInstructions = 0;
  let agentsWithTools = 0;
  let agentsWithSoul = 0;

  for (const company of scan.companies) {
    for (const agent of company.agents) {
      totalAgents++;
      if (agent.instructions.hasAgentsMd) agentsWithInstructions++;
      if (agent.instructions.hasToolsMd) agentsWithTools++;
      if (agent.instructions.hasSoulMd) agentsWithSoul++;
    }
  }

  // Score based on instruction completeness
  if (totalAgents > 0) {
    const instructionRate = agentsWithInstructions / totalAgents;
    const toolsRate = agentsWithTools / totalAgents;
    const soulRate = agentsWithSoul / totalAgents;

    score = Math.round(
      instructionRate * 40 +
      toolsRate * 30 +
      soulRate * 30
    );
  }

  const summary = totalAgents > 0
    ? `${agentsWithInstructions}/${totalAgents} agents have AGENTS.md, ${agentsWithTools} have TOOLS.md, ${agentsWithSoul} have SOUL.md`
    : "No agents found";

  return {
    id: "agent-configuration",
    label: "Agent Configuration",
    score: Math.min(100, Math.max(0, score)),
    summary,
  };
}

function computeCoordinationHealth(scan: InstanceScan, analyses: RunLogAnalysis[]): DimensionScore {
  let score = 50;

  // Check for delegation patterns in instructions
  let hasDelegationRules = false;
  let hasAssignmentModel = false;

  for (const company of scan.companies) {
    for (const agent of company.agents) {
      for (const file of agent.instructions.files) {
        if (file.name === "AGENTS.md" && file.contentPreview.includes("delegation")) {
          hasDelegationRules = true;
        }
        if (agent.instructions.sharedFiles.includes("assignment-model.md")) {
          hasAssignmentModel = true;
        }
      }
    }
  }

  // Check for handoffs in run-logs
  let handoffCount = 0;
  for (const analysis of analyses) {
    if (analysis.disposition.reason?.includes("handoff") || analysis.disposition.reason?.includes("delegation")) {
      handoffCount++;
    }
  }

  // Score
  if (hasDelegationRules) score += 20;
  if (hasAssignmentModel) score += 20;
  if (handoffCount > 0) score += 10;

  const summary = [
    hasDelegationRules ? "Delegation rules documented" : "No explicit delegation rules",
    hasAssignmentModel ? "Assignment model exists" : "No assignment model",
    handoffCount > 0 ? `${handoffCount} handoffs detected` : "No handoffs detected",
  ].join(". ");

  return {
    id: "coordination-health",
    label: "Coordination Health",
    score: Math.min(100, Math.max(0, score)),
    summary,
  };
}

function computeExecutionQuality(analyses: RunLogAnalysis[], stats: AggregateStats, qualitativeStats?: QualitativeAggregate): DimensionScore {
  let score = 50;

  // Error rate
  const errorRate = stats.errorRate;
  if (errorRate < 0.05) score += 15;
  else if (errorRate < 0.10) score += 5;
  else if (errorRate > 0.20) score -= 15;

  // Friction
  const avgFriction = stats.avgFrictionScore;
  if (avgFriction < 0.3) score += 15;
  else if (avgFriction < 0.5) score += 5;
  else if (avgFriction > 0.7) score -= 15;

  // Qualitative scores (if available)
  if (qualitativeStats) {
    // Issue assignment quality
    if (qualitativeStats.avgIssueAssignment > 80) score += 10;
    else if (qualitativeStats.avgIssueAssignment < 50) score -= 10;

    // API correctness
    if (qualitativeStats.avgApiCorrectness > 80) score += 10;
    else if (qualitativeStats.avgApiCorrectness < 50) score -= 10;

    // Acceptance criteria
    if (qualitativeStats.avgAcceptanceCriteria > 80) score += 10;
    else if (qualitativeStats.avgAcceptanceCriteria < 50) score -= 10;
  }

  // Disposition accuracy
  const completedRuns = stats.dispositionDistribution["done"] || 0;
  const totalRuns = stats.totalRuns;
  if (totalRuns > 0) {
    const completionRate = completedRuns / totalRuns;
    if (completionRate > 0.8) score += 10;
    else if (completionRate < 0.5) score -= 10;
  }

  const summary = qualitativeStats
    ? `Error rate: ${(errorRate * 100).toFixed(1)}%. Qualitative: ${qualitativeStats.avgOverallScore}/100. Completion: ${completedRuns}/${totalRuns}`
    : `Error rate: ${(errorRate * 100).toFixed(1)}%. Avg friction: ${(avgFriction * 100).toFixed(0)}%. Completion: ${completedRuns}/${totalRuns}`;

  return {
    id: "execution-quality",
    label: "Execution Quality",
    score: Math.min(100, Math.max(0, score)),
    summary,
  };
}

function computeLearningCapture(scan: InstanceScan): DimensionScore {
  let score = 30; // Base score
  let agentsWithMemory = 0;
  let agentsWithRetros = 0;
  let totalAgents = 0;

  for (const company of scan.companies) {
    for (const agent of company.agents) {
      totalAgents++;
      if (agent.memory.fileCount > 0) agentsWithMemory++;
      if (agent.memory.retrosCount > 0) agentsWithRetros++;
    }
  }

  if (agentsWithMemory > 0) score += 30;
  if (agentsWithRetros > 0) score += 20;
  if (totalAgents > 0 && agentsWithMemory / totalAgents > 0.5) score += 20;

  const summary = [
    `${agentsWithMemory}/${totalAgents} agents have memory files`,
    `${agentsWithRetros} agents have retros`,
    "Memory retrieval-to-outcome chain not demonstrated",
  ].join(". ");

  return {
    id: "learning-capture",
    label: "Learning Capture",
    score: Math.min(100, Math.max(0, score)),
    summary,
  };
}

function computeGovernanceSafety(scan: InstanceScan): DimensionScore {
  let score = 50;

  // Check for worktree isolation
  let hasWorktreePolicy = false;
  let hasApprovalGates = false;

  for (const company of scan.companies) {
    for (const agent of company.agents) {
      for (const file of agent.instructions.files) {
        if (file.name === "AGENTS.md") {
          if (file.contentPreview.includes("worktree")) hasWorktreePolicy = true;
          if (file.contentPreview.includes("approval") || file.contentPreview.includes("Board")) hasApprovalGates = true;
        }
      }
    }
  }

  // Check config
  if (scan.config.configJson.server) {
    score += 10; // Server config exists
  }

  if (hasWorktreePolicy) score += 20;
  if (hasApprovalGates) score += 20;

  const summary = [
    hasWorktreePolicy ? "Worktree isolation documented" : "No worktree policy",
    hasApprovalGates ? "Approval gates exist" : "No approval gates",
  ].join(". ");

  return {
    id: "governance-safety",
    label: "Governance & Safety",
    score: Math.min(100, Math.max(0, score)),
    summary,
  };
}

// Findings generation

function generateFindings(
  scan: InstanceScan,
  analyses: RunLogAnalysis[],
  stats: AggregateStats,
  qualitativeStats?: QualitativeAggregate
): Finding[] {
  const findings: Finding[] = [];

  // Check for missing instructions
  const agentsWithoutInstructions = scan.companies.flatMap(c =>
    c.agents.filter(a => !a.instructions.hasAgentsMd)
  );
  if (agentsWithoutInstructions.length > 0) {
    findings.push({
      id: "missing-agents-md",
      title: `${agentsWithoutInstructions.length} agents missing AGENTS.md`,
      severity: "Medium",
      dimensionRefs: ["agent-configuration"],
      reason: "Agents without AGENTS.md lack role definition and routing rules.",
      evidence: {
        type: "filesystem",
        source: "instructions directory",
        excerpt: `Missing: ${agentsWithoutInstructions.map(a => a.agentId).join(", ")}`,
      },
      owner: {
        type: "company",
        id: scan.companies[0]?.companyId || "unknown",
        role: "CEO",
      },
      consequence: "Agents may not know their role, boundaries, or how to route work.",
      repairPrompt: "Create AGENTS.md for each agent with role, capabilities, and routing rules.",
      expectedArtifact: "AGENTS.md files",
      expectedOutput: [
        "Each agent has clear role definition",
        "Routing rules documented",
        "Boundaries explicit",
      ],
      confidence: "high",
    });
  }

  // Check for high error rates
  if (stats.errorRate > 0.1) {
    findings.push({
      id: "high-tool-error-rate",
      title: `Tool error rate is ${(stats.errorRate * 100).toFixed(1)}%`,
      severity: "Medium",
      dimensionRefs: ["execution-quality"],
      reason: "High error rates increase token usage and time-to-completion.",
      evidence: {
        type: "run-log",
        source: "run-log analysis",
        excerpt: `Error rate: ${(stats.errorRate * 100).toFixed(1)}% across ${stats.totalRuns} runs`,
      },
      owner: {
        type: "instance",
        id: "all",
        role: "all",
      },
      consequence: "Agents waste tokens on failed tool calls and take longer to complete tasks.",
      repairPrompt: "Review TOOLS.md for environment setup instructions and error handling guidance.",
      expectedArtifact: "Updated TOOLS.md",
      expectedOutput: [
        "Tool error rate decreases",
        "Environment setup verified",
        "Common errors documented",
      ],
      confidence: "medium",
    });
  }

  // Check for high friction
  if (stats.avgFrictionScore > 0.5) {
    findings.push({
      id: "high-friction-score",
      title: `Average friction score is ${(stats.avgFrictionScore * 100).toFixed(0)}%`,
      severity: "Low",
      dimensionRefs: ["execution-quality"],
      reason: "High friction indicates agents are struggling with tasks.",
      evidence: {
        type: "run-log",
        source: "run-log analysis",
        excerpt: `Avg friction: ${(stats.avgFrictionScore * 100).toFixed(0)}%`,
      },
      owner: {
        type: "instance",
        id: "all",
        role: "all",
      },
      consequence: "Tasks take longer and cost more than necessary.",
      repairPrompt: "Investigate friction sources: errors, long runs, message churn.",
      expectedArtifact: "Friction analysis report",
      expectedOutput: [
        "Friction sources identified",
        "Root causes addressed",
        "Friction score decreases",
      ],
      confidence: "medium",
    });
  }

  // Check for missing memory
  const agentsWithoutMemory = scan.companies.flatMap(c =>
    c.agents.filter(a => a.memory.fileCount === 0)
  );
  if (agentsWithoutMemory.length > 0) {
    findings.push({
      id: "missing-memory",
      title: `${agentsWithoutMemory.length} agents have no memory files`,
      severity: "Low",
      dimensionRefs: ["learning-capture"],
      reason: "Agents without memory cannot learn from past experiences.",
      evidence: {
        type: "filesystem",
        source: "memory directory",
        excerpt: `No memory: ${agentsWithoutMemory.slice(0, 5).map(a => a.agentId).join(", ")}${agentsWithoutMemory.length > 5 ? "..." : ""}`,
      },
      owner: {
        type: "instance",
        id: "all",
        role: "all",
      },
      consequence: "Agents may repeat mistakes and miss institutional knowledge.",
      repairPrompt: "Add memory files for key decisions, patterns, and learnings.",
      expectedArtifact: "Memory files",
      expectedOutput: [
        "Key decisions documented",
        "Patterns captured",
        "Learnings accessible",
      ],
      confidence: "low",
    });
  }

  // Check for missing SOUL.md
  const agentsWithoutSoul = scan.companies.flatMap(c =>
    c.agents.filter(a => !a.instructions.hasSoulMd)
  );
  if (agentsWithoutSoul.length > 3) {
    findings.push({
      id: "missing-soul-md",
      title: `${agentsWithoutSoul.length} agents missing SOUL.md`,
      severity: "Low",
      dimensionRefs: ["agent-configuration"],
      reason: "SOUL.md defines agent personality, voice, and decision-making style.",
      evidence: {
        type: "filesystem",
        source: "instructions directory",
        excerpt: `Missing SOUL.md for ${agentsWithoutSoul.length} agents`,
      },
      owner: {
        type: "company",
        id: scan.companies[0]?.companyId || "unknown",
        role: "CEO",
      },
      consequence: "Agents may have inconsistent voice and decision-making.",
      repairPrompt: "Create SOUL.md with personality traits, voice, and decision framework.",
      expectedArtifact: "SOUL.md files",
      expectedOutput: [
        "Consistent agent personality",
        "Clear voice guidelines",
        "Decision framework documented",
      ],
      confidence: "low",
    });
  }

  // Add qualitative findings
  if (qualitativeStats) {
    // Checkout issues
    if (qualitativeStats.avgIssueAssignment < 60) {
      findings.push({
        id: "poor-issue-assignment",
        title: `Issue assignment quality is low (${qualitativeStats.avgIssueAssignment}/100)`,
        severity: "High",
        dimensionRefs: ["execution-quality", "governance-safety"],
        reason: "Agents are not properly checking out issues before work. This violates the heartbeat procedure.",
        evidence: {
          type: "run-log",
          source: "qualitative analysis",
          excerpt: `Avg issue assignment score: ${qualitativeStats.avgIssueAssignment}/100`,
        },
        owner: {
          type: "instance",
          id: "all",
          role: "all",
        },
        consequence: "Work may be duplicated, lost, or improperly tracked.",
        repairPrompt: "Ensure agents call POST /api/issues/{id}/checkout before starting work.",
        expectedArtifact: "Checkout calls in run-logs",
        expectedOutput: [
          "Every run starts with checkout",
          "assignedAgentId is set",
          "executionPolicy is set when delegating",
        ],
        confidence: "high",
      });
    }

    // Instruction compliance issues
    if (qualitativeStats.avgInstructionCompliance < 60) {
      findings.push({
        id: "poor-instruction-compliance",
        title: `Instruction compliance is low (${qualitativeStats.avgInstructionCompliance}/100)`,
        severity: "Medium",
        dimensionRefs: ["agent-configuration", "execution-quality"],
        reason: "Agents are not following AGENTS.md instructions properly.",
        evidence: {
          type: "run-log",
          source: "qualitative analysis",
          excerpt: `Avg instruction compliance: ${qualitativeStats.avgInstructionCompliance}/100`,
        },
        owner: {
          type: "instance",
          id: "all",
          role: "all",
        },
        consequence: "Agents may misuse APIs, miss steps, or violate governance.",
        repairPrompt: "Review and simplify AGENTS.md. Add explicit checkpoints.",
        expectedArtifact: "Improved instruction compliance",
        expectedOutput: [
          "Paperclip skill read before work",
          "X-Paperclip-Run-Id header included",
          "Proper status updates",
        ],
        confidence: "high",
      });
    }

    // Acceptance criteria issues
    if (qualitativeStats.avgAcceptanceCriteria < 50) {
      findings.push({
        id: "poor-acceptance-criteria",
        title: `Acceptance criteria completion is low (${qualitativeStats.avgAcceptanceCriteria}/100)`,
        severity: "Medium",
        dimensionRefs: ["execution-quality"],
        reason: "Agents are not completing acceptance criteria before marking issues done.",
        evidence: {
          type: "run-log",
          source: "qualitative analysis",
          excerpt: `Avg acceptance criteria: ${qualitativeStats.avgAcceptanceCriteria}/100`,
        },
        owner: {
          type: "instance",
          id: "all",
          role: "all",
        },
        consequence: "Issues may be marked done without actual completion.",
        repairPrompt: "Add explicit acceptance criteria checking before status updates.",
        expectedArtifact: "Acceptance criteria verification",
        expectedOutput: [
          "All criteria checked before done",
          "Completion evidence documented",
          "Final disposition is accurate",
        ],
        confidence: "medium",
      });
    }

    // Top issues from qualitative analysis
    for (const { issue, count } of qualitativeStats.topIssues.slice(0, 3)) {
      if (count >= 3) {
        findings.push({
          id: `qualitative-${issue.toLowerCase().replace(/\s+/g, "-").slice(0, 30)}`,
          title: issue,
          severity: count >= 10 ? "High" : "Medium",
          dimensionRefs: ["execution-quality"],
          reason: `This issue occurred ${count} times across runs.`,
          evidence: {
            type: "run-log",
            source: "qualitative analysis",
            excerpt: `${count} occurrences`,
          },
          owner: {
            type: "instance",
            id: "all",
            role: "all",
          },
          consequence: "Repeated issues indicate systemic problems.",
          repairPrompt: "Investigate root cause and fix instructions or environment.",
          expectedArtifact: "Reduced occurrence count",
          expectedOutput: [
            "Issue occurrence decreases",
            "Root cause addressed",
          ],
          confidence: "medium",
        });
      }
    }
  }

  return findings;
}

// Priority moves

function generatePriorityMoves(findings: Finding[]): PriorityMove[] {
  const moves: PriorityMove[] = [];

  // High severity findings first
  const highFindings = findings.filter(f => f.severity === "High" || f.severity === "Critical");
  if (highFindings.length > 0) {
    moves.push({
      title: "Address critical/high severity findings",
      impact: "Resolves major issues affecting agent performance",
      effort: "high",
      findingIds: highFindings.map(f => f.id),
    });
  }

  // Medium severity findings
  const mediumFindings = findings.filter(f => f.severity === "Medium");
  if (mediumFindings.length > 0) {
    moves.push({
      title: "Fix medium severity issues",
      impact: "Improves agent configuration and execution quality",
      effort: "medium",
      findingIds: mediumFindings.map(f => f.id),
    });
  }

  // Low severity findings
  const lowFindings = findings.filter(f => f.severity === "Low");
  if (lowFindings.length > 0) {
    moves.push({
      title: "Address low severity improvements",
      impact: "Polishes agent setup and learning capture",
      effort: "low",
      findingIds: lowFindings.map(f => f.id),
    });
  }

  return moves;
}

// Agent inventory

function buildAgentInventory(
  scan: InstanceScan,
  stats: AggregateStats
): AgentInventory {
  const agentRoles: AgentRoleCount[] = [];

  for (const company of scan.companies) {
    for (const agent of company.agents) {
      // Extract role from AGENTS.md content
      let role = "unknown";
      for (const file of agent.instructions.files) {
        if (file.name === "AGENTS.md") {
          const roleMatch = file.contentPreview.match(/You are the (\w+)/i);
          if (roleMatch) role = roleMatch[1];
        }
      }

      // Find run stats
      const runCount = agent.runLogs.length;
      const runLogSize = agent.runLogs.reduce((sum, r) => sum + r.size, 0);

      agentRoles.push({
        agentId: agent.agentId,
        role,
        runCount,
        avgTokensPerRun: 0, // Would need run analysis
        errorRate: 0, // Would need run analysis
        dispositionDistribution: {},
      });
    }
  }

  const activeAgents = agentRoles.filter(a => a.runCount > 0).length;

  return {
    totalAgents: agentRoles.length,
    activeAgents,
    totalRuns: stats.totalRuns,
    timeWindow: "7d",
    agentRoles,
  };
}

// Overview generation

function generateOverview(dimensions: DimensionScore[], findings: Finding[]): string {
  const avgScore = Math.round(dimensions.reduce((sum, d) => sum + d.score, 0) / dimensions.length);
  const criticalCount = findings.filter(f => f.severity === "Critical").length;
  const highCount = findings.filter(f => f.severity === "High").length;

  let overview = `Paperclip harness analysis complete. Overall score: ${avgScore}/100. `;

  if (criticalCount > 0 || highCount > 0) {
    overview += `${criticalCount} critical and ${highCount} high severity findings require attention. `;
  }

  const bestDimension = dimensions.reduce((best, d) => d.score > best.score ? d : best);
  const worstDimension = dimensions.reduce((worst, d) => d.score < worst.score ? d : worst);

  overview += `Strongest area: ${bestDimension.label} (${bestDimension.score}/100). `;
  overview += `Weakest area: ${worstDimension.label} (${worstDimension.score}/100).`;

  return overview;
}

// Report rendering

export function renderMarkdown(report: HarnessReport): string {
  const lines: string[] = [];

  lines.push("# Paperclip Harness Analysis Report");
  lines.push("");
  lines.push(`**Instance:** ${report.summary.instanceId}`);
  if (report.summary.companyId) lines.push(`**Company:** ${report.summary.companyId}`);
  lines.push(`**Generated:** ${report.metadata.generatedAt}`);
  lines.push(`**Time window:** ${report.metadata.timeWindow}`);
  lines.push("");
  lines.push("## Overview");
  lines.push("");
  lines.push(report.summary.overview);
  lines.push("");

  // Dimensions
  lines.push("## Dimension Scores");
  lines.push("");
  lines.push("| Dimension | Score | Summary |");
  lines.push("|-----------|-------|---------|");
  for (const dim of report.summary.dimensions) {
    const bar = scoreBar(dim.score);
    lines.push(`| ${dim.label} | ${bar} ${dim.score}/100 | ${dim.summary} |`);
  }
  lines.push("");

  // Findings
  lines.push("## Findings");
  lines.push("");
  if (report.findings.length === 0) {
    lines.push("No findings generated.");
  } else {
    for (const finding of report.findings) {
      lines.push(`### ${finding.title}`);
      lines.push("");
      lines.push(`**Severity:** ${finding.severity} | **Confidence:** ${finding.confidence}`);
      lines.push(`**Dimensions:** ${finding.dimensionRefs.join(", ")}`);
      lines.push("");
      lines.push(finding.reason);
      lines.push("");
      lines.push("**Consequence:** " + finding.consequence);
      lines.push("");
      lines.push("**Repair:** " + finding.repairPrompt);
      lines.push("");
      lines.push("---");
      lines.push("");
    }
  }

  // Priority moves
  lines.push("## Priority Moves");
  lines.push("");
  for (const move of report.priorityMoves) {
    lines.push(`### ${move.title}`);
    lines.push("");
    lines.push(`**Impact:** ${move.impact}`);
  lines.push(`**Effort:** ${move.effort}`);
    lines.push(`**Findings:** ${move.findingIds.join(", ")}`);
    lines.push("");
  }

  // Agent inventory
  lines.push("## Agent Inventory");
  lines.push("");
  lines.push(`**Total agents:** ${report.summary.agentInventory.totalAgents}`);
  lines.push(`**Active agents:** ${report.summary.agentInventory.activeAgents}`);
  lines.push(`**Total runs:** ${report.summary.agentInventory.totalRuns}`);
  lines.push("");

  return lines.join("\n");
}

function scoreBar(score: number): string {
  const filled = Math.round(score / 10);
  const empty = 10 - filled;
  return "█".repeat(filled) + "░".repeat(empty);
}

export function renderJson(report: HarnessReport): string {
  return JSON.stringify(report, null, 2);
}
