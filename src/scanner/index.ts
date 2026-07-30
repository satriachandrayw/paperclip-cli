/**
 * Paperclip Harness Scanner Module
 */

export { scanInstance, computeStats } from "./filesystem.js";
export type {
  ScanOptions,
  InstanceScan,
  InstanceConfig,
  CompanyScan,
  AgentScan,
  InstructionScan,
  InstructionFile,
  MemoryScan,
  MemoryFile,
  LifeScan,
  RunLogScan,
  SkillScan,
  ScanStats,
  AgentStats,
} from "./filesystem.js";
export { registerHarnessCommands } from "./commands.js";
export { analyzeRunLog, analyzeBatch } from "./run-log-analyzer.js";
export type { RunLogAnalysis, BatchAnalysisResult, AggregateStats } from "./run-log-analyzer.js";
export { reconcile, renderMarkdown, renderJson } from "./reconciler.js";
export type { HarnessReport, Finding, DimensionScore, PriorityMove } from "./reconciler.js";
export { analyzeQualitative, analyzeBatchQualitative } from "./qualitative-analyzer.js";
export type { QualitativeAnalysis, QualitativeBatchResult, QualitativeAggregate } from "./qualitative-analyzer.js";
export { forensicAnalyze, patternSearch, reconstructTimeline } from "./forensic.js";
export type { ForensicResult, PatternSearchResult, TimelineResult } from "./forensic.js";
export { analyzeInstructionQuality, analyzeBatchInstructionQuality } from "./instruction-quality.js";
export type { InstructionQualityReport, InstructionBatchResult, InstructionAggregate } from "./instruction-quality.js";
