/**
 * Paperclip Filesystem Scanner
 * 
 * Scans a local Paperclip instance filesystem to extract:
 * - Company and agent inventory
 * - Agent instructions (AGENTS.md, SOUL.md, TOOLS.md, HEARTBEAT.md)
 * - Memory and life directory structure
 * - Run-log metadata (file sizes, timestamps, agent IDs)
 * - Instance configuration
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join, basename } from "node:path";

// Types

export interface ScanOptions {
  instanceRoot: string;
  companyId?: string;
  agentId?: string;
  includeMemory?: boolean;
  includeRunLogs?: boolean;
  maxRunLogSample?: number;
}

export interface InstanceScan {
  instanceId: string;
  config: InstanceConfig;
  companies: CompanyScan[];
  scannedAt: string;
}

export interface InstanceConfig {
  path: string;
  env: Record<string, string>;
  configJson: Record<string, unknown>;
}

export interface CompanyScan {
  companyId: string;
  agents: AgentScan[];
  skills: SkillScan[];
}

export interface AgentScan {
  agentId: string;
  instructions: InstructionScan;
  memory: MemoryScan;
  life: LifeScan;
  runLogs: RunLogScan[];
}

export interface InstructionScan {
  path: string;
  files: InstructionFile[];
  hasAgentsMd: boolean;
  hasSoulMd: boolean;
  hasToolsMd: boolean;
  hasHeartbeatMd: boolean;
  agentCount: number;
  sharedFiles: string[];
}

export interface InstructionFile {
  name: string;
  path: string;
  size: number;
  modifiedAt: string;
  contentPreview: string;
}

export interface MemoryScan {
  path: string;
  fileCount: number;
  totalSize: number;
  files: MemoryFile[];
  retrosCount: number;
}

export interface MemoryFile {
  name: string;
  path: string;
  size: number;
  modifiedAt: string;
}

export interface LifeScan {
  path: string;
  hasProjects: boolean;
  hasAreas: boolean;
  hasResources: boolean;
  hasArchive: boolean;
  indexContent?: string;
}

export interface RunLogScan {
  runId: string;
  path: string;
  size: number;
  modifiedAt: string;
  createdAt: string;
}

export interface SkillScan {
  skillId: string;
  path: string;
  files: string[];
}

// Scanner functions

export async function scanInstance(options: ScanOptions): Promise<InstanceScan> {
  const { instanceRoot, companyId, agentId, includeMemory = true, includeRunLogs = true, maxRunLogSample = 10 } = options;

  // Scan config
  const config = await scanConfig(instanceRoot);

  // Scan companies
  const companiesDir = join(instanceRoot, "companies");
  const companies: CompanyScan[] = [];

  try {
    const companyDirs = await readdir(companiesDir);
    for (const dir of companyDirs) {
      if (companyId && dir !== companyId) continue;
      const companyPath = join(companiesDir, dir);
      const companyStat = await stat(companyPath);
      if (!companyStat.isDirectory()) continue;

      const company = await scanCompany(companyPath, dir, { agentId, includeMemory, includeRunLogs, maxRunLogSample });
      companies.push(company);
    }
  } catch (err) {
    // companies dir may not exist
  }

  return {
    instanceId: basename(instanceRoot),
    config,
    companies,
    scannedAt: new Date().toISOString(),
  };
}

async function scanConfig(instanceRoot: string): Promise<InstanceConfig> {
  const configPath = join(instanceRoot, "config.json");
  const envPath = join(instanceRoot, ".env");

  let configJson: Record<string, unknown> = {};
  let env: Record<string, string> = {};

  try {
    const configContent = await readFile(configPath, "utf-8");
    configJson = JSON.parse(configContent);
  } catch {
    // config.json may not exist
  }

  try {
    const envContent = await readFile(envPath, "utf-8");
    env = parseEnv(envContent);
  } catch {
    // .env may not exist
  }

  // Redact sensitive values
  const redactedEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (isSensitiveKey(key)) {
      redactedEnv[key] = "***REDACTED***";
    } else {
      redactedEnv[key] = value;
    }
  }

  return {
    path: instanceRoot,
    env: redactedEnv,
    configJson,
  };
}

async function scanCompany(
  companyPath: string,
  companyId: string,
  options: { agentId?: string; includeMemory: boolean; includeRunLogs: boolean; maxRunLogSample: number }
): Promise<CompanyScan> {
  const agentsDir = join(companyPath, "agents");
  const agents: AgentScan[] = [];

  try {
    const agentDirs = await readdir(agentsDir);
    for (const dir of agentDirs) {
      if (options.agentId && dir !== options.agentId) continue;
      const agentPath = join(agentsDir, dir);
      const agentStat = await stat(agentPath);
      if (!agentStat.isDirectory()) continue;

      const agent = await scanAgent(agentPath, dir, options);
      agents.push(agent);
    }
  } catch {
    // agents dir may not exist
  }

  // Scan skills
  const skillsDir = join(companyPath, "skills");
  const skills: SkillScan[] = [];
  try {
    const skillDirs = await readdir(skillsDir);
    for (const dir of skillDirs) {
      const skillPath = join(skillsDir, dir);
      const skillStat = await stat(skillPath);
      if (!skillStat.isDirectory()) continue;
      skills.push({
        skillId: dir,
        path: skillPath,
        files: await listFiles(skillPath),
      });
    }
  } catch {
    // skills dir may not exist
  }

  return {
    companyId,
    agents,
    skills,
  };
}

async function scanAgent(
  agentPath: string,
  agentId: string,
  options: { includeMemory: boolean; includeRunLogs: boolean; maxRunLogSample: number }
): Promise<AgentScan> {
  // Scan instructions
  const instructionsPath = join(agentPath, "instructions");
  const instructions = await scanInstructions(instructionsPath);

  // Scan memory
  const memoryPath = join(agentPath, "memory");
  const memory = options.includeMemory ? await scanMemory(memoryPath) : emptyMemoryScan(memoryPath);

  // Scan life
  const lifePath = join(agentPath, "life");
  const life = await scanLife(lifePath);

  // Scan run-logs (metadata only)
  const runLogs = options.includeRunLogs ? await scanRunLogMetadata(agentId, options.maxRunLogSample) : [];

  return {
    agentId,
    instructions,
    memory,
    life,
    runLogs,
  };
}

async function scanInstructions(instructionsPath: string): Promise<InstructionScan> {
  const files: InstructionFile[] = [];
  let hasAgentsMd = false;
  let hasSoulMd = false;
  let hasToolsMd = false;
  let hasHeartbeatMd = false;
  let agentCount = 0;
  const sharedFiles: string[] = [];

  try {
    const entries = await readdir(instructionsPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".md")) {
        const filePath = join(instructionsPath, entry.name);
        const fileStat = await stat(filePath);
        const content = await readFile(filePath, "utf-8");

        files.push({
          name: entry.name,
          path: filePath,
          size: fileStat.size,
          modifiedAt: fileStat.mtime.toISOString(),
          contentPreview: content.slice(0, 500),
        });

        // Check for specific files
        if (entry.name === "AGENTS.md") {
          hasAgentsMd = true;
          agentCount = (content.match(/\| .+ \| `[0-9a-f-]+` \|/g) || []).length;
        }
        if (entry.name === "SOUL.md") hasSoulMd = true;
        if (entry.name === "TOOLS.md") hasToolsMd = true;
        if (entry.name === "HEARTBEAT.md") hasHeartbeatMd = true;
      }

      if (entry.name === "shared" && entry.isDirectory()) {
        const sharedPath = join(instructionsPath, "shared");
        const sharedEntries = await readdir(sharedPath);
        sharedFiles.push(...sharedEntries);
      }
    }
  } catch {
    // instructions dir may not exist
  }

  return {
    path: instructionsPath,
    files,
    hasAgentsMd,
    hasSoulMd,
    hasToolsMd,
    hasHeartbeatMd,
    agentCount,
    sharedFiles,
  };
}

async function scanMemory(memoryPath: string): Promise<MemoryScan> {
  const files: MemoryFile[] = [];
  let retrosCount = 0;

  try {
    const entries = await readdir(memoryPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile()) {
        const filePath = join(memoryPath, entry.name);
        const fileStat = await stat(filePath);
        files.push({
          name: entry.name,
          path: filePath,
          size: fileStat.size,
          modifiedAt: fileStat.mtime.toISOString(),
        });
      }
      if (entry.name === "retros" && entry.isDirectory()) {
        const retrosPath = join(memoryPath, "retros");
        const retroFiles = await readdir(retrosPath);
        retrosCount = retroFiles.length;
      }
    }
  } catch {
    // memory dir may not exist
  }

  const totalSize = files.reduce((sum, f) => sum + f.size, 0);

  return {
    path: memoryPath,
    fileCount: files.length,
    totalSize,
    files,
    retrosCount,
  };
}

function emptyMemoryScan(path: string): MemoryScan {
  return {
    path,
    fileCount: 0,
    totalSize: 0,
    files: [],
    retrosCount: 0,
  };
}

async function scanLife(lifePath: string): Promise<LifeScan> {
  let hasProjects = false;
  let hasAreas = false;
  let hasResources = false;
  let hasArchive = false;
  let indexContent: string | undefined;

  try {
    const entries = await readdir(lifePath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "projects" && entry.isDirectory()) hasProjects = true;
      if (entry.name === "areas" && entry.isDirectory()) hasAreas = true;
      if (entry.name === "resources" && entry.isDirectory()) hasResources = true;
      if (entry.name === "archive" && entry.isDirectory()) hasArchive = true;
      if (entry.name === "index.md" && entry.isFile()) {
        indexContent = await readFile(join(lifePath, entry.name), "utf-8");
      }
    }
  } catch {
    // life dir may not exist
  }

  return {
    path: lifePath,
    hasProjects,
    hasAreas,
    hasResources,
    hasArchive,
    indexContent,
  };
}

async function scanRunLogMetadata(agentId: string, maxSample: number): Promise<RunLogScan[]> {
  // Run-logs are stored at: /srv/paperclip/home/instances/default/data/run-logs/{companyId}/{agentId}/
  // We need to find the company ID from the agent ID
  // For now, we'll scan all companies
  const runLogsBase = "/srv/paperclip/home/instances/default/data/run-logs";
  const runLogs: RunLogScan[] = [];

  try {
    const companyDirs = await readdir(runLogsBase);
    for (const companyId of companyDirs) {
      const agentDir = join(runLogsBase, companyId, agentId);
      try {
        const agentStat = await stat(agentDir);
        if (!agentStat.isDirectory()) continue;

        const files = await readdir(agentDir);
        const ndjsonFiles = files.filter(f => f.endsWith(".ndjson"));

        // Sample files (most recent first)
        const sampled = ndjsonFiles.slice(-maxSample);

        for (const file of sampled) {
          const filePath = join(agentDir, file);
          const fileStat = await stat(filePath);
          runLogs.push({
            runId: file.replace(".ndjson", ""),
            path: filePath,
            size: fileStat.size,
            modifiedAt: fileStat.mtime.toISOString(),
            createdAt: fileStat.birthtime.toISOString(),
          });
        }
      } catch {
        // agent dir may not exist in this company
      }
    }
  } catch {
    // run-logs dir may not exist
  }

  return runLogs;
}

async function listFiles(dirPath: string): Promise<string[]> {
  const files: string[] = [];
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile()) {
        files.push(entry.name);
      }
    }
  } catch {
    // dir may not exist
  }
  return files;
}

function parseEnv(content: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    env[key] = value;
  }
  return env;
}

function isSensitiveKey(key: string): boolean {
  const sensitivePatterns = ["TOKEN", "SECRET", "PASSWORD", "KEY", "CREDENTIAL"];
  const upperKey = key.toUpperCase();
  return sensitivePatterns.some(p => upperKey.includes(p));
}

// Statistics

export function computeStats(scan: InstanceScan): ScanStats {
  const stats: ScanStats = {
    totalCompanies: scan.companies.length,
    totalAgents: 0,
    totalRunLogs: 0,
    totalRunLogSize: 0,
    agentStats: [],
  };

  for (const company of scan.companies) {
    for (const agent of company.agents) {
      stats.totalAgents++;
      stats.totalRunLogs += agent.runLogs.length;
      stats.totalRunLogSize += agent.runLogs.reduce((sum, r) => sum + r.size, 0);

      stats.agentStats.push({
        agentId: agent.agentId,
        companyId: company.companyId,
        hasInstructions: agent.instructions.hasAgentsMd,
        instructionFileCount: agent.instructions.files.length,
        memoryFileCount: agent.memory.fileCount,
        runLogCount: agent.runLogs.length,
        runLogTotalSize: agent.runLogs.reduce((sum, r) => sum + r.size, 0),
      });
    }
  }

  return stats;
}

export interface ScanStats {
  totalCompanies: number;
  totalAgents: number;
  totalRunLogs: number;
  totalRunLogSize: number;
  agentStats: AgentStats[];
}

export interface AgentStats {
  agentId: string;
  companyId: string;
  hasInstructions: boolean;
  instructionFileCount: number;
  memoryFileCount: number;
  runLogCount: number;
  runLogTotalSize: number;
}
