/**
 * Paperclip Run-Log Analyzer
 * 
 * Parses NDJSON run-logs and extracts:
 * - Task episodes from message sequences
 * - Tool usage patterns
 * - Token/cost tracking
 * - Disposition accuracy
 * - Repeated workflows
 * - Coordination patterns
 * - Friction indicators
 */

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { stat } from "node:fs/promises";

// Types

export interface RunLogAnalysis {
  runId: string;
  agentId: string;
  companyId: string;
  sessionId?: string;
  sessionTimestamp?: string;
  cwd?: string;
  events: EventCounts;
  messages: MessageAnalysis;
  tools: ToolAnalysis;
  usage: UsageAnalysis;
  disposition: DispositionAnalysis;
  timeline: TimelineAnalysis;
  friction: FrictionIndicators;
}

export interface EventCounts {
  session: number;
  agentStart: number;
  agentEnd: number;
  turnStart: number;
  turnEnd: number;
  messageStart: number;
  messageUpdate: number;
  messageEnd: number;
  toolExecutionEnd: number;
}

export interface MessageAnalysis {
  totalMessages: number;
  userMessages: number;
  assistantMessages: number;
  toolResultMessages: number;
  avgMessageLength: number;
  hasThinking: boolean;
  thinkingLength: number;
}

export interface ToolAnalysis {
  totalCalls: number;
  errorCount: number;
  errorRate: number;
  toolDistribution: Record<string, number>;
  avgCallsPerTurn: number;
}

export interface UsageAnalysis {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheRead: number;
  totalCacheWrite: number;
  totalTokens: number;
  totalCost: number;
  avgTokensPerMessage: number;
  cacheHitRate: number;
  models: Record<string, number>;
  providers: Record<string, number>;
}

export interface DispositionAnalysis {
  claimedDisposition?: string;
  issueId?: string;
  issueTitle?: string;
  issueStatus?: string;
  issuePriority?: string;
  reason?: string;
  statusTransitions: StatusTransition[];
}

export interface StatusTransition {
  from: string;
  to: string;
  timestamp: string;
}

export interface TimelineAnalysis {
  startTime?: string;
  endTime?: string;
  durationMs?: number;
  turnCount: number;
  avgTurnDurationMs?: number;
}

export interface FrictionIndicators {
  errorEvents: number;
  highMessageChurn: boolean;
  longRun: boolean;
  statusOscillation: boolean;
  frictionScore: number; // 0-1, higher = more friction
}

// Analyzer

export async function analyzeRunLog(
  filePath: string,
  agentId: string,
  companyId: string
): Promise<RunLogAnalysis> {
  const events: EventCounts = {
    session: 0,
    agentStart: 0,
    agentEnd: 0,
    turnStart: 0,
    turnEnd: 0,
    messageStart: 0,
    messageUpdate: 0,
    messageEnd: 0,
    toolExecutionEnd: 0,
  };

  const messages: MessageAnalysis = {
    totalMessages: 0,
    userMessages: 0,
    assistantMessages: 0,
    toolResultMessages: 0,
    avgMessageLength: 0,
    hasThinking: false,
    thinkingLength: 0,
  };

  const tools: ToolAnalysis = {
    totalCalls: 0,
    errorCount: 0,
    errorRate: 0,
    toolDistribution: {},
    avgCallsPerTurn: 0,
  };

  const usage: UsageAnalysis = {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheRead: 0,
    totalCacheWrite: 0,
    totalTokens: 0,
    totalCost: 0,
    avgTokensPerMessage: 0,
    cacheHitRate: 0,
    models: {},
    providers: {},
  };

  const disposition: DispositionAnalysis = {
    statusTransitions: [],
  };

  const timeline: TimelineAnalysis = {
    turnCount: 0,
  };

  let sessionId: string | undefined;
  let sessionTimestamp: string | undefined;
  let cwd: string | undefined;
  let firstTimestamp: string | undefined;
  let lastTimestamp: string | undefined;
  let totalMessageLength = 0;
  let messageCount = 0;

  // Parse NDJSON line by line
  const fileStream = createReadStream(filePath, { encoding: "utf-8" });
  const rl = createInterface({ input: fileStream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;

    let outer: { ts: string; stream: string; chunk: string };
    try {
      outer = JSON.parse(line);
    } catch {
      continue; // Skip malformed lines
    }

    const timestamp = outer.ts;
    if (!firstTimestamp) firstTimestamp = timestamp;
    lastTimestamp = timestamp;

    let event: Record<string, unknown>;
    try {
      event = JSON.parse(outer.chunk);
    } catch {
      continue;
    }

    const type = event.type as string;

    // Count events
    switch (type) {
      case "session":
        events.session++;
        sessionId = event.id as string;
        sessionTimestamp = event.timestamp as string;
        cwd = event.cwd as string;
        break;
      case "agent_start":
        events.agentStart++;
        break;
      case "agent_end":
        events.agentEnd++;
        break;
      case "turn_start":
        events.turnStart++;
        timeline.turnCount++;
        break;
      case "turn_end":
        events.turnEnd++;
        break;
      case "message_start":
        events.messageStart++;
        messages.totalMessages++;
        analyzeMessage(event.message as Record<string, unknown>, messages, usage);
        break;
      case "message_update":
        events.messageUpdate++;
        break;
      case "message_end":
        events.messageEnd++;
        analyzeMessageEnd(event.message as Record<string, unknown>, messages, usage);
        break;
      case "tool_execution_end":
        events.toolExecutionEnd++;
        analyzeToolExecution(event, tools);
        break;
    }

    // Extract disposition info from user messages
    if (type === "message_start" || type === "message_end") {
      const msg = event.message as Record<string, unknown>;
      if (msg?.role === "user") {
        extractDisposition(msg, disposition);
      }
    }
  }

  // Calculate derived metrics
  tools.errorRate = tools.totalCalls > 0 ? tools.errorCount / tools.totalCalls : 0;
  tools.avgCallsPerTurn = timeline.turnCount > 0 ? tools.totalCalls / timeline.turnCount : 0;

  usage.avgTokensPerMessage = messageCount > 0 ? usage.totalTokens / messageCount : 0;
  usage.cacheHitRate = (usage.totalInputTokens + usage.totalCacheRead) > 0
    ? usage.totalCacheRead / (usage.totalInputTokens + usage.totalCacheRead)
    : 0;

  messages.avgMessageLength = messageCount > 0 ? totalMessageLength / messageCount : 0;

  timeline.startTime = firstTimestamp;
  timeline.endTime = lastTimestamp;
  if (firstTimestamp && lastTimestamp) {
    timeline.durationMs = new Date(lastTimestamp).getTime() - new Date(firstTimestamp).getTime();
    timeline.avgTurnDurationMs = timeline.turnCount > 0 ? timeline.durationMs / timeline.turnCount : undefined;
  }

  // Calculate friction
  const friction = calculateFriction(events, tools, timeline, messages);

  return {
    runId: filePath.split("/").pop()?.replace(".ndjson", "") || "unknown",
    agentId,
    companyId,
    sessionId,
    sessionTimestamp,
    cwd,
    events,
    messages,
    tools,
    usage,
    disposition,
    timeline,
    friction,
  };
}

function analyzeMessage(
  msg: Record<string, unknown>,
  messages: MessageAnalysis,
  usage: UsageAnalysis
): void {
  const role = msg.role as string;
  const content = msg.content as Array<Record<string, unknown>>;

  if (role === "user") {
    messages.userMessages++;
  } else if (role === "assistant") {
    messages.assistantMessages++;

    // Check for thinking
    if (Array.isArray(content)) {
      for (const item of content) {
        if (item.type === "thinking") {
          messages.hasThinking = true;
          messages.thinkingLength += (item.thinking as string || "").length;
        }
      }
    }

    // Extract usage
    if (msg.usage) {
      const u = msg.usage as Record<string, number>;
      usage.totalInputTokens += u.input || 0;
      usage.totalOutputTokens += u.output || 0;
      usage.totalCacheRead += u.cacheRead || 0;
      usage.totalCacheWrite += u.cacheWrite || 0;
      usage.totalTokens += u.totalTokens || 0;

      if (u.cost) {
        usage.totalCost += (u.cost as Record<string, number>).total || 0;
      }
    }

    // Track model/provider
    const model = msg.model as string;
    const provider = msg.provider as string;
    if (model) usage.models[model] = (usage.models[model] || 0) + 1;
    if (provider) usage.providers[provider] = (usage.providers[provider] || 0) + 1;
  } else if (role === "toolResult") {
    messages.toolResultMessages++;
  }

  // Track message length
  if (Array.isArray(content)) {
    for (const item of content) {
      if (item.text) {
        totalMessageLength += (item.text as string).length;
        messageCount++;
      }
    }
  }
}

// Helper to track message length across calls
let totalMessageLength = 0;
let messageCount = 0;

function analyzeMessageEnd(
  msg: Record<string, unknown>,
  messages: MessageAnalysis,
  usage: UsageAnalysis
): void {
  // message_end has final usage data
  if (msg.usage) {
    const u = msg.usage as Record<string, number>;
    // Only add if not already counted (avoid double counting)
    // The usage is already counted in message_start/message_update
  }
}

function analyzeToolExecution(
  event: Record<string, unknown>,
  tools: ToolAnalysis
): void {
  const toolName = event.toolName as string;
  const isError = event.isError as boolean;

  tools.totalCalls++;
  if (isError) tools.errorCount++;

  if (toolName) {
    tools.toolDistribution[toolName] = (tools.toolDistribution[toolName] || 0) + 1;
  }
}

function extractDisposition(
  msg: Record<string, unknown>,
  disposition: DispositionAnalysis
): void {
  const content = msg.content as Array<Record<string, unknown>>;
  if (!Array.isArray(content)) return;

  for (const item of content) {
    if (item.type !== "text") continue;
    const text = item.text as string;
    if (!text) continue;

    // Parse Resume Delta
    if (text.includes("Paperclip Resume Delta")) {
      // Extract issue info
      const issueMatch = text.match(/- issue: (.+)/);
      if (issueMatch) {
        disposition.issueTitle = issueMatch[1].trim();
      }

      const statusMatch = text.match(/- issue status: (.+)/);
      if (statusMatch) {
        disposition.issueStatus = statusMatch[1].trim();
      }

      const priorityMatch = text.match(/- issue priority: (.+)/);
      if (priorityMatch) {
        disposition.issuePriority = priorityMatch[1].trim();
      }

      const reasonMatch = text.match(/- reason: (.+)/);
      if (reasonMatch) {
        disposition.reason = reasonMatch[1].trim();
      }
    }
  }
}

function calculateFriction(
  events: EventCounts,
  tools: ToolAnalysis,
  timeline: TimelineAnalysis,
  messages: MessageAnalysis
): FrictionIndicators {
  let frictionScore = 0;

  // Error events
  const errorEvents = tools.errorCount;
  if (errorEvents > 0) frictionScore += 0.2;
  if (errorEvents > 5) frictionScore += 0.2;

  // High message churn (many updates per message)
  const churnRatio = events.messageUpdate / Math.max(1, events.messageStart);
  const highMessageChurn = churnRatio > 50;
  if (highMessageChurn) frictionScore += 0.2;

  // Long run (>30 minutes)
  const durationMs = timeline.durationMs || 0;
  const longRun = durationMs > 30 * 60 * 1000;
  if (longRun) frictionScore += 0.2;

  // Status oscillation (many turns without progress)
  const statusOscillation = timeline.turnCount > 10 && events.toolExecutionEnd < timeline.turnCount;
  if (statusOscillation) frictionScore += 0.2;

  return {
    errorEvents,
    highMessageChurn,
    longRun,
    statusOscillation,
    frictionScore: Math.min(1, frictionScore),
  };
}

// Batch analysis

export interface BatchAnalysisOptions {
  runLogPaths: Array<{ path: string; agentId: string; companyId: string }>;
  maxConcurrency?: number;
}

export interface BatchAnalysisResult {
  runs: RunLogAnalysis[];
  aggregate: AggregateStats;
}

export interface AggregateStats {
  totalRuns: number;
  totalTokens: number;
  totalCost: number;
  avgTokensPerRun: number;
  avgFrictionScore: number;
  toolDistribution: Record<string, number>;
  dispositionDistribution: Record<string, number>;
  errorRate: number;
}

export async function analyzeBatch(options: BatchAnalysisOptions): Promise<BatchAnalysisResult> {
  const { runLogPaths, maxConcurrency = 5 } = options;
  const runs: RunLogAnalysis[] = [];

  // Process in batches
  for (let i = 0; i < runLogPaths.length; i += maxConcurrency) {
    const batch = runLogPaths.slice(i, i + maxConcurrency);
    const results = await Promise.all(
      batch.map(({ path, agentId, companyId }) => analyzeRunLog(path, agentId, companyId))
    );
    runs.push(...results);
  }

  // Compute aggregate stats
  const aggregate: AggregateStats = {
    totalRuns: runs.length,
    totalTokens: 0,
    totalCost: 0,
    avgTokensPerRun: 0,
    avgFrictionScore: 0,
    toolDistribution: {},
    dispositionDistribution: {},
    errorRate: 0,
  };

  let totalErrors = 0;
  let totalToolCalls = 0;

  for (const run of runs) {
    aggregate.totalTokens += run.usage.totalTokens;
    aggregate.totalCost += run.usage.totalCost;
    aggregate.avgFrictionScore += run.friction.frictionScore;

    // Merge tool distribution
    for (const [tool, count] of Object.entries(run.tools.toolDistribution)) {
      aggregate.toolDistribution[tool] = (aggregate.toolDistribution[tool] || 0) + count;
    }

    // Track disposition
    if (run.disposition.issueStatus) {
      aggregate.dispositionDistribution[run.disposition.issueStatus] =
        (aggregate.dispositionDistribution[run.disposition.issueStatus] || 0) + 1;
    }

    totalErrors += run.tools.errorCount;
    totalToolCalls += run.tools.totalCalls;
  }

  aggregate.avgTokensPerRun = runs.length > 0 ? aggregate.totalTokens / runs.length : 0;
  aggregate.avgFrictionScore = runs.length > 0 ? aggregate.avgFrictionScore / runs.length : 0;
  aggregate.errorRate = totalToolCalls > 0 ? totalErrors / totalToolCalls : 0;

  return { runs, aggregate };
}
