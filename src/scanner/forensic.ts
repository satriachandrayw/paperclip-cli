/**
 * Paperclip Forensic Analyzer
 * 
 * Efficient analysis of large run-log files (400MB+) using:
 * - Streaming line-by-line parsing
 * - Offset indexing for targeted extraction
 * - Pattern matching without full parsing
 * - Selective event extraction
 */

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { stat } from "node:fs/promises";

// Types

export interface ForensicOptions {
  filePath: string;
  // What to extract
  extractErrors?: boolean;
  extractApiCalls?: boolean;
  extractStatusChanges?: boolean;
  extractThinking?: boolean;
  extractToolCalls?: boolean;
  // Filtering
  issueId?: string;
  agentId?: string;
  timeRange?: { start?: string; end?: string };
  // Limits
  maxEvents?: number;
  maxThinkingLength?: number;
}

export interface ForensicResult {
  filePath: string;
  fileSize: number;
  totalLines: number;
  parsedLines: number;
  errors: ForensicEvent[];
  apiCalls: ForensicEvent[];
  statusChanges: ForensicEvent[];
  thinking: ForensicThinking[];
  toolCalls: ForensicToolCall[];
  timeline: ForensicEvent[];
  summary: ForensicSummary;
}

export interface ForensicEvent {
  timestamp: string;
  type: string;
  data: Record<string, unknown>;
  lineOffset: number;
}

export interface ForensicThinking {
  timestamp: string;
  content: string;
  truncated: boolean;
}

export interface ForensicToolCall {
  timestamp: string;
  toolName: string;
  toolCallId: string;
  command?: string;
  isError: boolean;
  resultPreview?: string;
}

export interface ForensicSummary {
  errorCount: number;
  apiCallCount: number;
  statusChangeCount: number;
  thinkingCount: number;
  toolCallCount: number;
  timeRange: { start?: string; end?: string };
  issues: string[];
}

// Main forensic function

export async function forensicAnalyze(options: ForensicOptions): Promise<ForensicResult> {
  const {
    filePath,
    extractErrors = true,
    extractApiCalls = true,
    extractStatusChanges = true,
    extractThinking = false,
    extractToolCalls = true,
    issueId,
    timeRange,
    maxEvents = 1000,
    maxThinkingLength = 500,
  } = options;

  const fileStat = await stat(filePath);
  const errors: ForensicEvent[] = [];
  const apiCalls: ForensicEvent[] = [];
  const statusChanges: ForensicEvent[] = [];
  const thinking: ForensicThinking[] = [];
  const toolCalls: ForensicToolCall[] = [];
  const timeline: ForensicEvent[] = [];

  let totalLines = 0;
  let parsedLines = 0;
  let firstTimestamp: string | undefined;
  let lastTimestamp: string | undefined;

  // Stream file line by line
  const fileStream = createReadStream(filePath, { encoding: "utf-8" });
  const rl = createInterface({ input: fileStream, crlfDelay: Infinity });

  for await (const line of rl) {
    totalLines++;
    if (!line.trim()) continue;

    let outer: { ts: string; chunk: string };
    try {
      outer = JSON.parse(line);
    } catch {
      continue;
    }

    const timestamp = outer.ts;
    if (!firstTimestamp) firstTimestamp = timestamp;
    lastTimestamp = timestamp;

    // Time range filter
    if (timeRange) {
      if (timeRange.start && timestamp < timeRange.start) continue;
      if (timeRange.end && timestamp > timeRange.end) continue;
    }

    let event: Record<string, unknown>;
    try {
      event = JSON.parse(outer.chunk);
    } catch {
      continue;
    }

    parsedLines++;
    const type = event.type as string;

    // Extract errors
    if (extractErrors && type === "tool_execution_end" && event.isError) {
      errors.push({
        timestamp,
        type: "error",
        data: {
          toolName: event.toolName,
          toolCallId: event.toolCallId,
          result: truncate(JSON.stringify(event.result), 500),
        },
        lineOffset: totalLines,
      });
      if (errors.length >= maxEvents) break;
    }

    // Extract API calls
    if (extractApiCalls && type === "tool_execution_end") {
      const result = event.result as Record<string, unknown>;
      const content = result?.content as Array<Record<string, unknown>>;
      const text = content?.[0]?.text as string;

      if (text && (text.includes("/api/") || text.includes("PAPERCLIP_API"))) {
        apiCalls.push({
          timestamp,
          type: "api_call",
          data: {
            toolName: event.toolName,
            toolCallId: event.toolCallId,
            resultPreview: truncate(text, 200),
          },
          lineOffset: totalLines,
        });
        if (apiCalls.length >= maxEvents) break;
      }
    }

    // Extract status changes
    if (extractStatusChanges && type === "tool_execution_end") {
      const result = event.result as Record<string, unknown>;
      const content = result?.content as Array<Record<string, unknown>>;
      const text = content?.[0]?.text as string;

      if (text && (text.includes('"status"') || text.includes("status:"))) {
        // Check if it's a status update
        if (text.includes('"done"') || text.includes('"in_review"') || 
            text.includes('"blocked"') || text.includes('"in_progress"')) {
          statusChanges.push({
            timestamp,
            type: "status_change",
            data: {
              toolName: event.toolName,
              resultPreview: truncate(text, 300),
            },
            lineOffset: totalLines,
          });
          if (statusChanges.length >= maxEvents) break;
        }
      }
    }

    // Extract thinking
    if (extractThinking && type === "message_update") {
      const assistantEvent = event.assistantMessageEvent as Record<string, unknown>;
      const partial = assistantEvent?.partial as Record<string, unknown>;
      const content = partial?.content as Array<Record<string, unknown>>;

      if (Array.isArray(content)) {
        for (const item of content) {
          if (item.type === "thinking" && item.thinking) {
            const thinkingText = item.thinking as string;
            thinking.push({
              timestamp,
              content: truncate(thinkingText, maxThinkingLength),
              truncated: thinkingText.length > maxThinkingLength,
            });
            if (thinking.length >= maxEvents) break;
          }
        }
      }
    }

    // Extract tool calls
    if (extractToolCalls && type === "tool_execution_end") {
      const result = event.result as Record<string, unknown>;
      const content = result?.content as Array<Record<string, unknown>>;
      const text = content?.[0]?.text as string;

      toolCalls.push({
        timestamp,
        toolName: event.toolName as string,
        toolCallId: event.toolCallId as string,
        command: extractCommand(text),
        isError: event.isError as boolean,
        resultPreview: truncate(text, 100),
      });
      if (toolCalls.length >= maxEvents) break;
    }

    // Issue filter
    if (issueId) {
      const result = event.result as Record<string, unknown>;
      const content = result?.content as Array<Record<string, unknown>>;
      const text = content?.[0]?.text as string;

      if (text && text.includes(issueId)) {
        timeline.push({
          timestamp,
          type,
          data: {
            toolName: event.toolName,
            resultPreview: truncate(text, 200),
          },
          lineOffset: totalLines,
        });
        if (timeline.length >= maxEvents) break;
      }
    }
  }

  // Build summary
  const summary: ForensicSummary = {
    errorCount: errors.length,
    apiCallCount: apiCalls.length,
    statusChangeCount: statusChanges.length,
    thinkingCount: thinking.length,
    toolCallCount: toolCalls.length,
    timeRange: { start: firstTimestamp, end: lastTimestamp },
    issues: [],
  };

  // Identify issues
  if (errors.length > 10) summary.issues.push("High error count");
  if (statusChanges.length === 0) summary.issues.push("No status changes detected");

  return {
    filePath,
    fileSize: fileStat.size,
    totalLines,
    parsedLines,
    errors,
    apiCalls,
    statusChanges,
    thinking,
    toolCalls,
    timeline,
    summary,
  };
}

// Pattern search (grep-like, no JSON parsing)

export interface PatternSearchOptions {
  filePath: string;
  pattern: string | RegExp;
  maxMatches?: number;
  contextLines?: number;
}

export interface PatternSearchResult {
  filePath: string;
  matches: PatternMatch[];
  totalMatches: number;
}

export interface PatternMatch {
  lineNumber: number;
  line: string;
  contextBefore: string[];
  contextAfter: string[];
}

export async function patternSearch(options: PatternSearchOptions): Promise<PatternSearchResult> {
  const { filePath, pattern, maxMatches = 100, contextLines = 2 } = options;
  const matches: PatternMatch[] = [];
  const lines: string[] = [];
  let lineNumber = 0;

  const fileStream = createReadStream(filePath, { encoding: "utf-8" });
  const rl = createInterface({ input: fileStream, crlfDelay: Infinity });

  for await (const line of rl) {
    lineNumber++;
    lines.push(line);

    // Keep only last N lines for context
    if (lines.length > contextLines * 2 + 1) {
      lines.shift();
    }

    const regex = typeof pattern === "string" ? new RegExp(pattern, "i") : pattern;
    if (regex.test(line)) {
      const matchIndex = lines.length - 1;
      matches.push({
        lineNumber,
        line: truncate(line, 500),
        contextBefore: lines.slice(Math.max(0, matchIndex - contextLines), matchIndex),
        contextAfter: [], // Will be filled by subsequent lines
      });

      // Fill context after for previous matches
      for (let i = Math.max(0, matches.length - contextLines); i < matches.length; i++) {
        if (matches[i].contextAfter.length < contextLines) {
          matches[i].contextAfter.push(truncate(line, 200));
        }
      }

      if (matches.length >= maxMatches) break;
    }
  }

  return {
    filePath,
    matches,
    totalMatches: matches.length,
  };
}

// Timeline reconstruction

export interface TimelineOptions {
  filePath: string;
  eventTypes?: string[];
  timeRange?: { start?: string; end?: string };
  maxEvents?: number;
}

export interface TimelineResult {
  events: TimelineEvent[];
  duration?: number;
}

export interface TimelineEvent {
  timestamp: string;
  type: string;
  summary: string;
  data: Record<string, unknown>;
}

export async function reconstructTimeline(options: TimelineOptions): Promise<TimelineResult> {
  const { filePath, eventTypes, timeRange, maxEvents = 500 } = options;
  const events: TimelineEvent[] = [];

  const fileStream = createReadStream(filePath, { encoding: "utf-8" });
  const rl = createInterface({ input: fileStream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;

    let outer: { ts: string; chunk: string };
    try {
      outer = JSON.parse(line);
    } catch {
      continue;
    }

    const timestamp = outer.ts;

    // Time range filter
    if (timeRange) {
      if (timeRange.start && timestamp < timeRange.start) continue;
      if (timeRange.end && timestamp > timeRange.end) continue;
    }

    let event: Record<string, unknown>;
    try {
      event = JSON.parse(outer.chunk);
    } catch {
      continue;
    }

    const type = event.type as string;

    // Event type filter
    if (eventTypes && !eventTypes.includes(type)) continue;

    // Build summary
    const summary = buildEventSummary(event);

    events.push({
      timestamp,
      type,
      summary,
      data: {
        toolName: event.toolName,
        isError: event.isError,
      },
    });

    if (events.length >= maxEvents) break;
  }

  // Calculate duration
  let duration: number | undefined;
  if (events.length >= 2) {
    const start = new Date(events[0].timestamp).getTime();
    const end = new Date(events[events.length - 1].timestamp).getTime();
    duration = end - start;
  }

  return { events, duration };
}

// Helper functions

function truncate(str: string | undefined, maxLen: number): string {
  if (!str) return "";
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + "...";
}

function extractCommand(text: string | undefined): string | undefined {
  if (!text) return undefined;
  // Try to extract command from bash output
  const lines = text.split("\n");
  return lines[0]?.slice(0, 100);
}

function buildEventSummary(event: Record<string, unknown>): string {
  const type = event.type as string;

  switch (type) {
    case "session":
      return `Session started: ${event.id}`;
    case "agent_start":
      return "Agent started";
    case "agent_end":
      return "Agent ended";
    case "turn_start":
      return "Turn started";
    case "turn_end":
      return "Turn ended";
    case "message_start": {
      const msg = event.message as Record<string, unknown>;
      return `Message started: ${msg?.role || "unknown"}`;
    }
    case "message_end": {
      const msg = event.message as Record<string, unknown>;
      const usage = msg?.usage as Record<string, number>;
      return `Message ended: ${msg?.role || "unknown"} (${usage?.totalTokens || 0} tokens)`;
    }
    case "tool_execution_end":
      return `Tool executed: ${event.toolName} (${event.isError ? "ERROR" : "OK"})`;
    default:
      return type;
  }
}

// Export for CLI
export const forensicCommands = {
  async analyze(options: ForensicOptions) {
    return forensicAnalyze(options);
  },
  async search(options: PatternSearchOptions) {
    return patternSearch(options);
  },
  async timeline(options: TimelineOptions) {
    return reconstructTimeline(options);
  },
};
