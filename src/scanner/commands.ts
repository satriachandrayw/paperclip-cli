/**
 * Paperclip Harness Scanner CLI Commands
 */

import { Command } from "commander";
import { scanInstance, computeStats, type ScanOptions } from "./filesystem.js";
import { analyzeRunLog, analyzeBatch, type BatchAnalysisOptions, type RunLogAnalysis } from "./run-log-analyzer.js";
import { reconcile, renderMarkdown, renderJson, type ReconcileOptions } from "./reconciler.js";
import { analyzeQualitative, analyzeBatchQualitative } from "./qualitative-analyzer.js";
import { forensicAnalyze, patternSearch, reconstructTimeline } from "./forensic.js";
import { analyzeInstructionQuality, analyzeBatchInstructionQuality } from "./instruction-quality.js";
import { join } from "node:path";
import { readdir, writeFile, mkdir } from "node:fs/promises";

export function registerHarnessCommands(program: Command): void {
  const harness = program.command("harness").description("Harness analysis commands");

  harness
    .command("scan")
    .description("Scan Paperclip instance filesystem")
    .requiredOption("--instance-root <path>", "Path to Paperclip instance root")
    .option("--company-id <id>", "Scan specific company only")
    .option("--agent-id <id>", "Scan specific agent only")
    .option("--no-memory", "Skip memory scanning")
    .option("--no-run-logs", "Skip run-log scanning")
    .option("--max-run-log-sample <n>", "Max run-log files to sample per agent", "10")
    .option("--json", "Output as JSON")
    .action(async (options: Record<string, unknown>) => {
      const scanOptions: ScanOptions = {
        instanceRoot: String(options.instanceRoot),
        companyId: options.companyId ? String(options.companyId) : undefined,
        agentId: options.agentId ? String(options.agentId) : undefined,
        includeMemory: options.memory !== false,
        includeRunLogs: options.runLogs !== false,
        maxRunLogSample: Number(options.maxRunLogSample) || 10,
      };

      try {
        const result = await scanInstance(scanOptions);
        const stats = computeStats(result);

        if (options.json) {
          console.log(JSON.stringify({ ...result, stats }, null, 2));
        } else {
          printScanSummary(result, stats);
        }
      } catch (error) {
        console.error("Scan failed:", error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  harness
    .command("report")
    .description("Generate harness analysis report")
    .requiredOption("--instance-root <path>", "Path to Paperclip instance root")
    .option("--company-id <id>", "Analyze specific company only")
    .option("--max-runs <n>", "Max runs to analyze", "20")
    .option("--format <type>", "Output format: json, markdown, both", "both")
    .option("--out <dir>", "Output directory for durable reports")
    .action(async (options: Record<string, unknown>) => {
      try {
        const instanceRoot = String(options.instanceRoot);

        // Step 1: Scan filesystem
        console.error("Scanning filesystem...");
        const scanOptions: ScanOptions = {
          instanceRoot,
          companyId: options.companyId ? String(options.companyId) : undefined,
          includeMemory: true,
          includeRunLogs: true,
          maxRunLogSample: Number(options.maxRuns) || 20,
        };
        const instanceScan = await scanInstance(scanOptions);
        const scanStats = computeStats(instanceScan);

        // Step 2: Analyze run-logs
        console.error("Analyzing run-logs...");
        const runLogsBase = join(instanceRoot, "data", "run-logs");
        const runLogPaths: Array<{ path: string; agentId: string; companyId: string }> = [];

        const companyDirs = await readdir(runLogsBase);
        for (const companyId of companyDirs) {
          if (options.companyId && companyId !== options.companyId) continue;
          const companyPath = join(runLogsBase, companyId);
          const agentDirs = await readdir(companyPath);

          for (const agentId of agentDirs) {
            const agentPath = join(companyPath, agentId);
            const files = await readdir(agentPath);
            const ndjsonFiles = files.filter(f => f.endsWith(".ndjson"));

            for (const file of ndjsonFiles.slice(-Number(options.maxRuns))) {
              runLogPaths.push({
                path: join(agentPath, file),
                agentId,
                companyId,
              });
            }
          }
        }

        const batchResult = await analyzeBatch({ runLogPaths, maxConcurrency: 5 });

        // Step 2.5: Qualitative analysis
        console.error("Running qualitative analysis...");
        const qualitativeResult = analyzeBatchQualitative(batchResult.runs);

        // Step 3: Reconcile
        console.error("Reconciling findings...");
        const reconcileOptions: ReconcileOptions = {
          instanceScan,
          runAnalyses: batchResult.runs,
          aggregateStats: batchResult.aggregate,
          qualitativeStats: qualitativeResult.aggregate,
          companyId: options.companyId ? String(options.companyId) : undefined,
          timeWindow: "7d",
        };
        const report = reconcile(reconcileOptions);

        // Step 4: Render
        const format = String(options.format) || "both";
        const outDir = options.out ? String(options.out) : undefined;

        if (outDir) {
          await mkdir(outDir, { recursive: true });

          if (format === "json" || format === "both") {
            const jsonPath = join(outDir, "findings.json");
            await writeFile(jsonPath, renderJson(report));
            console.error(`JSON report: ${jsonPath}`);
          }

          if (format === "markdown" || format === "both") {
            const mdPath = join(outDir, "report.md");
            await writeFile(mdPath, renderMarkdown(report));
            console.error(`Markdown report: ${mdPath}`);
          }
        } else {
          if (format === "json") {
            console.log(renderJson(report));
          } else {
            console.log(renderMarkdown(report));
          }
        }

        // Print summary
        console.error("\n=== Report Summary ===");
        console.error(`Findings: ${report.findings.length}`);
        console.error(`Priority moves: ${report.priorityMoves.length}`);
        console.error(`Dimensions:`);
        for (const dim of report.summary.dimensions) {
          console.error(`  ${dim.label}: ${dim.score}/100`);
        }
      } catch (error) {
        console.error("Report generation failed:", error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  harness
    .command("qualitative")
    .description("Qualitative analysis of agent behavior")
    .requiredOption("--run-log <path>", "Path to NDJSON run-log file")
    .requiredOption("--agent-id <id>", "Agent ID")
    .requiredOption("--company-id <id>", "Company ID")
    .option("--json", "Output as JSON")
    .action(async (options: Record<string, unknown>) => {
      try {
        // First analyze the run-log
        const runAnalysis = await analyzeRunLog(
          String(options.runLog),
          String(options.agentId),
          String(options.companyId)
        );

        // Then run qualitative analysis
        const result = analyzeQualitative(runAnalysis);

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          printQualitativeAnalysis(result);
        }
      } catch (error) {
        console.error("Qualitative analysis failed:", error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  harness
    .command("qualitative-batch")
    .description("Batch qualitative analysis")
    .requiredOption("--instance-root <path>", "Path to Paperclip instance root")
    .option("--company-id <id>", "Analyze specific company only")
    .option("--agent-id <id>", "Analyze specific agent only")
    .option("--max-runs <n>", "Max runs to analyze", "20")
    .option("--json", "Output as JSON")
    .action(async (options: Record<string, unknown>) => {
      try {
        const instanceRoot = String(options.instanceRoot);
        const runLogsBase = join(instanceRoot, "data", "run-logs");
        const runAnalyses: Awaited<ReturnType<typeof analyzeRunLog>>[] = [];

        const companyDirs = await readdir(runLogsBase);
        for (const companyId of companyDirs) {
          if (options.companyId && companyId !== options.companyId) continue;
          const companyPath = join(runLogsBase, companyId);
          const agentDirs = await readdir(companyPath);

          for (const agentId of agentDirs) {
            if (options.agentId && agentId !== options.agentId) continue;
            const agentPath = join(companyPath, agentId);
            const files = await readdir(agentPath);
            const ndjsonFiles = files.filter(f => f.endsWith(".ndjson"));

            for (const file of ndjsonFiles.slice(-Number(options.maxRuns))) {
              const runAnalysis = await analyzeRunLog(
                join(agentPath, file),
                agentId,
                companyId
              );
              runAnalyses.push(runAnalysis);
            }
          }
        }

        const result = analyzeBatchQualitative(runAnalyses);

        if (options.json) {
          console.log(JSON.stringify(result.aggregate, null, 2));
        } else {
          printQualitativeBatch(result);
        }
      } catch (error) {
        console.error("Batch qualitative analysis failed:", error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  // Forensic commands
  const forensic = harness.command("forensic").description("Forensic analysis of large run-logs");

  // Instruction quality command
  harness
    .command("instruction-quality")
    .description("Analyze instruction file quality")
    .requiredOption("--instance-root <path>", "Path to Paperclip instance root")
    .option("--company-id <id>", "Analyze specific company only")
    .option("--agent-id <id>", "Analyze specific agent only")
    .option("--json", "Output as JSON")
    .action(async (options: Record<string, unknown>) => {
      try {
        const instanceRoot = String(options.instanceRoot);
        const scanOptions: ScanOptions = {
          instanceRoot,
          companyId: options.companyId ? String(options.companyId) : undefined,
          agentId: options.agentId ? String(options.agentId) : undefined,
          includeMemory: false,
          includeRunLogs: true,
          maxRunLogSample: 5,
        };

        const instanceScan = await scanInstance(scanOptions);
        const agentScans = instanceScan.companies.flatMap(c => c.agents);

        // Get run analyses for each agent
        const runAnalysesMap = new Map<string, RunLogAnalysis[]>();
        for (const agent of agentScans) {
          const runs: RunLogAnalysis[] = [];
          for (const runLog of agent.runLogs.slice(-5)) {
            const analysis = await analyzeRunLog(runLog.path, agent.agentId, "");
            runs.push(analysis);
          }
          if (runs.length > 0) {
            runAnalysesMap.set(agent.agentId, runs);
          }
        }

        const result = analyzeBatchInstructionQuality(agentScans, runAnalysesMap);

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          printInstructionQuality(result);
        }
      } catch (error) {
        console.error("Instruction quality analysis failed:", error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  forensic
    .command("analyze")
    .description("Forensic analysis of a run-log file")
    .requiredOption("--run-log <path>", "Path to NDJSON run-log file")
    .option("--issue-id <id>", "Filter by issue ID")
    .option("--extract-errors", "Extract error events", true)
    .option("--extract-api-calls", "Extract API calls", true)
    .option("--extract-status-changes", "Extract status changes", true)
    .option("--extract-thinking", "Extract thinking content")
    .option("--max-events <n>", "Max events to extract", "100")
    .option("--json", "Output as JSON")
    .action(async (options: Record<string, unknown>) => {
      try {
        const result = await forensicAnalyze({
          filePath: String(options.runLog),
          issueId: options.issueId ? String(options.issueId) : undefined,
          extractErrors: options.extractErrors !== false,
          extractApiCalls: options.extractApiCalls !== false,
          extractStatusChanges: options.extractStatusChanges !== false,
          extractThinking: options.extractThinking === true,
          maxEvents: Number(options.maxEvents) || 100,
        });

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          printForensicResult(result);
        }
      } catch (error) {
        console.error("Forensic analysis failed:", error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  forensic
    .command("search")
    .description("Search for patterns in run-log")
    .requiredOption("--run-log <path>", "Path to NDJSON run-log file")
    .requiredOption("--pattern <string>", "Search pattern (regex supported)")
    .option("--max-matches <n>", "Max matches", "50")
    .option("--context-lines <n>", "Context lines before/after", "2")
    .option("--json", "Output as JSON")
    .action(async (options: Record<string, unknown>) => {
      try {
        const result = await patternSearch({
          filePath: String(options.runLog),
          pattern: String(options.pattern),
          maxMatches: Number(options.maxMatches) || 50,
          contextLines: Number(options.contextLines) || 2,
        });

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          printSearchResult(result);
        }
      } catch (error) {
        console.error("Search failed:", error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  forensic
    .command("timeline")
    .description("Reconstruct timeline from run-log")
    .requiredOption("--run-log <path>", "Path to NDJSON run-log file")
    .option("--event-types <csv>", "Filter by event types (comma-separated)")
    .option("--max-events <n>", "Max events", "200")
    .option("--json", "Output as JSON")
    .action(async (options: Record<string, unknown>) => {
      try {
        const eventTypes = options.eventTypes 
          ? String(options.eventTypes).split(",") 
          : undefined;

        const result = await reconstructTimeline({
          filePath: String(options.runLog),
          eventTypes,
          maxEvents: Number(options.maxEvents) || 200,
        });

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          printTimeline(result);
        }
      } catch (error) {
        console.error("Timeline failed:", error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  forensic
    .command("errors")
    .description("Extract all errors from run-log")
    .requiredOption("--run-log <path>", "Path to NDJSON run-log file")
    .option("--max-errors <n>", "Max errors", "50")
    .option("--json", "Output as JSON")
    .action(async (options: Record<string, unknown>) => {
      try {
        const result = await forensicAnalyze({
          filePath: String(options.runLog),
          extractErrors: true,
          extractApiCalls: false,
          extractStatusChanges: false,
          extractToolCalls: false,
          maxEvents: Number(options.maxErrors) || 50,
        });

        if (options.json) {
          console.log(JSON.stringify(result.errors, null, 2));
        } else {
          console.log(`\n=== Errors (${result.errors.length}) ===\n`);
          for (const err of result.errors) {
            console.log(`[${err.timestamp}] ${err.data.toolName}: ${err.data.result}`);
          }
        }
      } catch (error) {
        console.error("Error extraction failed:", error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  forensic
    .command("api-calls")
    .description("Extract API calls from run-log")
    .requiredOption("--run-log <path>", "Path to NDJSON run-log file")
    .option("--max-calls <n>", "Max calls", "100")
    .option("--json", "Output as JSON")
    .action(async (options: Record<string, unknown>) => {
      try {
        const result = await forensicAnalyze({
          filePath: String(options.runLog),
          extractErrors: false,
          extractApiCalls: true,
          extractStatusChanges: false,
          extractToolCalls: false,
          maxEvents: Number(options.maxCalls) || 100,
        });

        if (options.json) {
          console.log(JSON.stringify(result.apiCalls, null, 2));
        } else {
          console.log(`\n=== API Calls (${result.apiCalls.length}) ===\n`);
          for (const call of result.apiCalls) {
            console.log(`[${call.timestamp}] ${call.data.toolName}: ${call.data.resultPreview}`);
          }
        }
      } catch (error) {
        console.error("API call extraction failed:", error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  forensic
    .command("status-changes")
    .description("Extract status changes from run-log")
    .requiredOption("--run-log <path>", "Path to NDJSON run-log file")
    .option("--max-changes <n>", "Max changes", "50")
    .option("--json", "Output as JSON")
    .action(async (options: Record<string, unknown>) => {
      try {
        const result = await forensicAnalyze({
          filePath: String(options.runLog),
          extractErrors: false,
          extractApiCalls: false,
          extractStatusChanges: true,
          extractToolCalls: false,
          maxEvents: Number(options.maxChanges) || 50,
        });

        if (options.json) {
          console.log(JSON.stringify(result.statusChanges, null, 2));
        } else {
          console.log(`\n=== Status Changes (${result.statusChanges.length}) ===\n`);
          for (const change of result.statusChanges) {
            console.log(`[${change.timestamp}] ${change.data.resultPreview}`);
          }
        }
      } catch (error) {
        console.error("Status change extraction failed:", error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  harness
    .command("analyze-run")
    .description("Analyze a single run-log file")
    .requiredOption("--run-log <path>", "Path to NDJSON run-log file")
    .requiredOption("--agent-id <id>", "Agent ID")
    .requiredOption("--company-id <id>", "Company ID")
    .option("--json", "Output as JSON")
    .action(async (options: Record<string, unknown>) => {
      try {
        const result = await analyzeRunLog(
          String(options.runLog),
          String(options.agentId),
          String(options.companyId)
        );

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          printRunAnalysis(result);
        }
      } catch (error) {
        console.error("Analysis failed:", error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  harness
    .command("analyze-batch")
    .description("Analyze multiple run-log files")
    .requiredOption("--instance-root <path>", "Path to Paperclip instance root")
    .option("--company-id <id>", "Analyze specific company only")
    .option("--agent-id <id>", "Analyze specific agent only")
    .option("--max-runs <n>", "Max runs to analyze", "20")
    .option("--json", "Output as JSON")
    .action(async (options: Record<string, unknown>) => {
      try {
        const instanceRoot = String(options.instanceRoot);
        const runLogsBase = join(instanceRoot, "data", "run-logs");
        const runLogPaths: Array<{ path: string; agentId: string; companyId: string }> = [];

        const companyDirs = await readdir(runLogsBase);
        for (const companyId of companyDirs) {
          if (options.companyId && companyId !== options.companyId) continue;
          const companyPath = join(runLogsBase, companyId);
          const agentDirs = await readdir(companyPath);

          for (const agentId of agentDirs) {
            if (options.agentId && agentId !== options.agentId) continue;
            const agentPath = join(companyPath, agentId);
            const files = await readdir(agentPath);
            const ndjsonFiles = files.filter(f => f.endsWith(".ndjson"));

            for (const file of ndjsonFiles.slice(-Number(options.maxRuns))) {
              runLogPaths.push({
                path: join(agentPath, file),
                agentId,
                companyId,
              });
            }
          }
        }

        const result = await analyzeBatch({ runLogPaths, maxConcurrency: 5 });

        if (options.json) {
          console.log(JSON.stringify(result.aggregate, null, 2));
        } else {
          printBatchAnalysis(result);
        }
      } catch (error) {
        console.error("Batch analysis failed:", error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  harness
    .command("stats")
    .description("Show instance statistics")
    .requiredOption("--instance-root <path>", "Path to Paperclip instance root")
    .option("--company-id <id>", "Scan specific company only")
    .option("--json", "Output as JSON")
    .action(async (options: Record<string, unknown>) => {
      const scanOptions: ScanOptions = {
        instanceRoot: String(options.instanceRoot),
        companyId: options.companyId ? String(options.companyId) : undefined,
        includeMemory: false,
        includeRunLogs: true,
        maxRunLogSample: 1,
      };

      try {
        const result = await scanInstance(scanOptions);
        const stats = computeStats(result);

        if (options.json) {
          console.log(JSON.stringify(stats, null, 2));
        } else {
          printStats(stats);
        }
      } catch (error) {
        console.error("Stats failed:", error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });
}

function printScanSummary(scan: Awaited<ReturnType<typeof scanInstance>>, stats: ReturnType<typeof computeStats>): void {
  console.log("\n=== Paperclip Instance Scan ===\n");
  console.log(`Instance: ${scan.instanceId}`);
  console.log(`Scanned at: ${scan.scannedAt}`);
  console.log(`\nCompanies: ${stats.totalCompanies}`);
  console.log(`Agents: ${stats.totalAgents}`);
  console.log(`Run logs: ${stats.totalRunLogs} (${formatBytes(stats.totalRunLogSize)})`);

  console.log("\n--- Agent Inventory ---\n");
  for (const agent of stats.agentStats) {
    console.log(`Agent: ${agent.agentId}`);
    console.log(`  Company: ${agent.companyId}`);
    console.log(`  Instructions: ${agent.hasInstructions ? "✓" : "✗"} (${agent.instructionFileCount} files)`);
    console.log(`  Memory: ${agent.memoryFileCount} files`);
    console.log(`  Run logs: ${agent.runLogCount} (${formatBytes(agent.runLogTotalSize)})`);
    console.log();
  }

  console.log("--- Instruction Files ---\n");
  for (const company of scan.companies) {
    for (const agent of company.agents) {
      if (agent.instructions.files.length === 0) continue;
      console.log(`Agent ${agent.agentId}:`);
      for (const file of agent.instructions.files) {
        console.log(`  ${file.name} (${formatBytes(file.size)})`);
      }
      if (agent.instructions.sharedFiles.length > 0) {
        console.log(`  shared/: ${agent.instructions.sharedFiles.join(", ")}`);
      }
      console.log();
    }
  }
}

function printStats(stats: ReturnType<typeof computeStats>): void {
  console.log("\n=== Paperclip Instance Statistics ===\n");
  console.log(`Companies: ${stats.totalCompanies}`);
  console.log(`Agents: ${stats.totalAgents}`);
  console.log(`Run logs: ${stats.totalRunLogs}`);
  console.log(`Total run-log size: ${formatBytes(stats.totalRunLogSize)}`);

  console.log("\n--- Per-Agent Stats ---\n");
  for (const agent of stats.agentStats) {
    console.log(`${agent.agentId.substring(0, 8)}... | ${agent.companyId.substring(0, 8)}... | instructions: ${agent.hasInstructions ? "✓" : "✗"} | memory: ${agent.memoryFileCount} | runs: ${agent.runLogCount} (${formatBytes(agent.runLogTotalSize)})`);
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function printRunAnalysis(analysis: Awaited<ReturnType<typeof analyzeRunLog>>): void {
  console.log("\n=== Run-Log Analysis ===\n");
  console.log(`Run ID: ${analysis.runId}`);
  console.log(`Agent: ${analysis.agentId}`);
  console.log(`Company: ${analysis.companyId}`);
  if (analysis.sessionId) console.log(`Session: ${analysis.sessionId}`);
  if (analysis.cwd) console.log(`CWD: ${analysis.cwd}`);

  console.log("\n--- Events ---\n");
  console.log(`Turns: ${analysis.timeline.turnCount}`);
  console.log(`Messages: ${analysis.messages.totalMessages} (user: ${analysis.messages.userMessages}, assistant: ${analysis.messages.assistantMessages})`);
  console.log(`Tool calls: ${analysis.tools.totalCalls} (errors: ${analysis.tools.errorCount})`);
  console.log(`Duration: ${analysis.timeline.durationMs ? Math.round(analysis.timeline.durationMs / 1000) + "s" : "N/A"}`);

  console.log("\n--- Usage ---\n");
  console.log(`Total tokens: ${analysis.usage.totalTokens.toLocaleString()}`);
  console.log(`Input: ${analysis.usage.totalInputTokens.toLocaleString()}, Output: ${analysis.usage.totalOutputTokens.toLocaleString()}`);
  console.log(`Cache hit rate: ${(analysis.usage.cacheHitRate * 100).toFixed(1)}%`);
  if (analysis.usage.totalCost > 0) console.log(`Cost: $${analysis.usage.totalCost.toFixed(4)}`);

  console.log("\n--- Tools ---\n");
  for (const [tool, count] of Object.entries(analysis.tools.toolDistribution).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${tool}: ${count}`);
  }

  console.log("\n--- Disposition ---\n");
  if (analysis.disposition.issueTitle) console.log(`Issue: ${analysis.disposition.issueTitle}`);
  if (analysis.disposition.issueStatus) console.log(`Status: ${analysis.disposition.issueStatus}`);
  if (analysis.disposition.reason) console.log(`Reason: ${analysis.disposition.reason}`);

  console.log("\n--- Friction ---\n");
  console.log(`Friction score: ${(analysis.friction.frictionScore * 100).toFixed(0)}%`);
  if (analysis.friction.errorEvents > 0) console.log(`  Error events: ${analysis.friction.errorEvents}`);
  if (analysis.friction.highMessageChurn) console.log(`  High message churn detected`);
  if (analysis.friction.longRun) console.log(`  Long run detected`);
}

function printBatchAnalysis(result: Awaited<ReturnType<typeof analyzeBatch>>): void {
  console.log("\n=== Batch Run-Log Analysis ===\n");
  console.log(`Runs analyzed: ${result.aggregate.totalRuns}`);
  console.log(`Total tokens: ${result.aggregate.totalTokens.toLocaleString()}`);
  console.log(`Avg tokens/run: ${Math.round(result.aggregate.avgTokensPerRun).toLocaleString()}`);
  console.log(`Error rate: ${(result.aggregate.errorRate * 100).toFixed(1)}%`);
  console.log(`Avg friction score: ${(result.aggregate.avgFrictionScore * 100).toFixed(0)}%`);

  console.log("\n--- Tool Distribution ---\n");
  for (const [tool, count] of Object.entries(result.aggregate.toolDistribution).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${tool}: ${count}`);
  }

  console.log("\n--- Disposition Distribution ---\n");
  for (const [status, count] of Object.entries(result.aggregate.dispositionDistribution).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${status}: ${count}`);
  }
}

function printQualitativeAnalysis(analysis: ReturnType<typeof analyzeQualitative>): void {
  console.log("\n=== Qualitative Analysis ===\n");
  console.log(`Agent: ${analysis.agentId}`);
  console.log(`Run: ${analysis.runId}`);
  console.log(`Overall Score: ${analysis.overallScore}/100`);

  console.log("\n--- Dimension Scores ---\n");
  console.log(`Issue Assignment: ${analysis.issueAssignment.score}/100`);
  console.log(`Instruction Compliance: ${analysis.instructionCompliance.score}/100`);
  console.log(`API Correctness: ${analysis.apiCorrectness.score}/100`);
  console.log(`Acceptance Criteria: ${analysis.acceptanceCriteria.score}/100`);

  console.log("\n--- Issue Assignment ---\n");
  console.log(`Checkout called: ${analysis.issueAssignment.checkoutCalled ? "✓" : "✗"}`);
  console.log(`AssignedAgentId set: ${analysis.issueAssignment.assignedAgentIdSet ? "✓" : "✗"}`);
  console.log(`ExecutionPolicy set: ${analysis.issueAssignment.executionPolicySet ? "✓" : "✗"}`);
  console.log(`Valid status transition: ${analysis.issueAssignment.statusTransitionValid ? "✓" : "✗"}`);

  console.log("\n--- Instruction Compliance ---\n");
  console.log(`Paperclip skill read: ${analysis.instructionCompliance.paperclipSkillRead ? "✓" : "✗"}`);
  console.log(`Checkout before work: ${analysis.instructionCompliance.checkoutBeforeWork ? "✓" : "✗"}`);
  console.log(`Run-ID header included: ${analysis.instructionCompliance.runIdHeaderIncluded ? "✓" : "✗"}`);
  console.log(`Proper status updates: ${analysis.instructionCompliance.properStatusUpdates ? "✓" : "✗"}`);

  console.log("\n--- API Correctness ---\n");
  console.log(`Correct endpoints: ${analysis.apiCorrectness.correctEndpoints ? "✓" : "✗"}`);
  console.log(`Proper headers: ${analysis.apiCorrectness.properHeaders ? "✓" : "✗"}`);
  console.log(`Error handling: ${analysis.apiCorrectness.errorHandling ? "✓" : "✗"}`);
  console.log(`No retry on 409: ${analysis.apiCorrectness.noRetryOn409 ? "✓" : "✗"}`);
  console.log(`Error count: ${analysis.apiCorrectness.errorCount}`);

  console.log("\n--- Acceptance Criteria ---\n");
  console.log(`Criteria present: ${analysis.acceptanceCriteria.criteriaPresent ? "✓" : "✗"}`);
  console.log(`Criteria count: ${analysis.acceptanceCriteria.criteriaCount}`);
  console.log(`Criteria met: ${analysis.acceptanceCriteria.criteriaMet}`);
  console.log(`Completion evidence: ${analysis.acceptanceCriteria.completionEvidence ? "✓" : "✗"}`);
  console.log(`Final disposition: ${analysis.acceptanceCriteria.finalDisposition}`);

  if (analysis.findings.length > 0) {
    console.log("\n--- Findings ---\n");
    for (const finding of analysis.findings) {
      console.log(`[${finding.severity}] ${finding.title}`);
      console.log(`  ${finding.description}`);
      console.log();
    }
  }
}

function printQualitativeBatch(result: ReturnType<typeof analyzeBatchQualitative>): void {
  console.log("\n=== Batch Qualitative Analysis ===\n");
  console.log(`Runs analyzed: ${result.aggregate.totalRuns}`);
  console.log(`Avg overall score: ${result.aggregate.avgOverallScore}/100`);

  console.log("\n--- Average Scores ---\n");
  console.log(`Issue Assignment: ${result.aggregate.avgIssueAssignment}/100`);
  console.log(`Instruction Compliance: ${result.aggregate.avgInstructionCompliance}/100`);
  console.log(`API Correctness: ${result.aggregate.avgApiCorrectness}/100`);
  console.log(`Acceptance Criteria: ${result.aggregate.avgAcceptanceCriteria}/100`);

  console.log("\n--- Finding Categories ---\n");
  for (const [category, count] of Object.entries(result.aggregate.findingCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${category}: ${count}`);
  }

  console.log("\n--- Top Issues ---\n");
  for (const { issue, count } of result.aggregate.topIssues) {
    console.log(`  ${issue}: ${count} occurrences`);
  }
}

function printForensicResult(result: Awaited<ReturnType<typeof forensicAnalyze>>): void {
  console.log("\n=== Forensic Analysis ===\n");
  console.log(`File: ${result.filePath}`);
  console.log(`Size: ${formatBytes(result.fileSize)}`);
  console.log(`Total lines: ${result.totalLines.toLocaleString()}`);
  console.log(`Parsed lines: ${result.parsedLines.toLocaleString()}`);

  console.log("\n--- Summary ---\n");
  console.log(`Errors: ${result.summary.errorCount}`);
  console.log(`API calls: ${result.summary.apiCallCount}`);
  console.log(`Status changes: ${result.summary.statusChangeCount}`);
  console.log(`Tool calls: ${result.summary.toolCallCount}`);
  console.log(`Thinking: ${result.summary.thinkingCount}`);
  if (result.summary.timeRange.start) {
    console.log(`Time range: ${result.summary.timeRange.start} to ${result.summary.timeRange.end}`);
  }

  if (result.summary.issues.length > 0) {
    console.log("\n--- Issues ---\n");
    for (const issue of result.summary.issues) {
      console.log(`  • ${issue}`);
    }
  }

  if (result.errors.length > 0) {
    console.log("\n--- Errors (first 10) ---\n");
    for (const err of result.errors.slice(0, 10)) {
      console.log(`[${err.timestamp}] ${err.data.toolName}: ${err.data.result}`);
    }
  }

  if (result.statusChanges.length > 0) {
    console.log("\n--- Status Changes (first 10) ---\n");
    for (const change of result.statusChanges.slice(0, 10)) {
      console.log(`[${change.timestamp}] ${change.data.resultPreview}`);
    }
  }
}

function printSearchResult(result: Awaited<ReturnType<typeof patternSearch>>): void {
  console.log("\n=== Pattern Search Results ===\n");
  console.log(`File: ${result.filePath}`);
  console.log(`Matches: ${result.totalMatches}`);

  for (const match of result.matches.slice(0, 20)) {
    console.log(`\n--- Line ${match.lineNumber} ---`);
    for (const ctx of match.contextBefore) {
      console.log(`  ${ctx}`);
    }
    console.log(`> ${match.line}`);
    for (const ctx of match.contextAfter) {
      console.log(`  ${ctx}`);
    }
  }
}

function printTimeline(result: Awaited<ReturnType<typeof reconstructTimeline>>): void {
  console.log("\n=== Timeline ===\n");
  console.log(`Events: ${result.events.length}`);
  if (result.duration) {
    console.log(`Duration: ${Math.round(result.duration / 1000)}s`);
  }

  for (const event of result.events.slice(0, 50)) {
    console.log(`[${event.timestamp}] ${event.type}: ${event.summary}`);
  }
}

function printInstructionQuality(result: ReturnType<typeof analyzeBatchInstructionQuality>): void {
  console.log("\n=== Instruction Quality Analysis ===\n");
  console.log(`Agents analyzed: ${result.aggregate.totalAgents}`);
  console.log(`Average score: ${result.aggregate.avgScore}/100`);

  console.log("\n--- File Scores ---\n");
  for (const [name, score] of Object.entries(result.aggregate.fileScores).sort((a, b) => b[1] - a[1])) {
    const bar = "█".repeat(Math.round(score / 10)) + "░".repeat(10 - Math.round(score / 10));
    console.log(`  ${name.padEnd(15)} ${bar} ${score}/100`);
  }

  console.log("\n--- Per-Agent Scores ---\n");
  for (const agent of result.agents) {
    console.log(`Agent: ${agent.agentId.substring(0, 8)}...`);
    console.log(`  Overall: ${agent.overallScore}/100`);
    for (const file of agent.files) {
      console.log(`  ${file.name.padEnd(15)} ${file.score}/100 (${file.presence})`);
    }
    if (agent.findings.length > 0) {
      console.log(`  Findings: ${agent.findings.length}`);
    }
    console.log();
  }

  if (result.aggregate.topIssues.length > 0) {
    console.log("--- Top Issues ---\n");
    for (const { issue, count } of result.aggregate.topIssues) {
      console.log(`  ${issue}: ${count} agents`);
    }
  }
}
