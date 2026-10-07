#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { Command } from "commander";
import {
  registerActivityAndDashboardCommands,
  registerAgentCommands,
  registerApprovalCommands,
  registerAuthCommands,
  registerCompanyCommands,
  registerContextCommands,
  registerHealthCommand,
  registerIssueCommands,
  registerProjectGoalRoutinePluginCommands,
  registerSkillCommands,
} from "./commands.js";
import { registerHarnessCommands } from "./scanner/index.js";
import { registerApiPassthroughCommands } from "./passthrough.js";

const program = new Command();

/**
 * Read the version from package.json instead of hardcoding it: a literal here silently reports the
 * previous release after every version bump (0.1.1 shipped announcing itself as 0.1.0).
 */
function packageVersion(): string {
  try {
    const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: string };
    return manifest.version?.trim() || "unknown";
  } catch {
    return "unknown";
  }
}

program
  .name("paperclip-cli")
  .description("Standalone remote operator for Paperclip control planes")
  .version(packageVersion());

registerContextCommands(program);
registerAuthCommands(program);
registerCompanyCommands(program);
registerAgentCommands(program);
registerIssueCommands(program);
registerProjectGoalRoutinePluginCommands(program);
registerSkillCommands(program);
registerApprovalCommands(program);
registerActivityAndDashboardCommands(program);
registerApiPassthroughCommands(program);
registerHealthCommand(program);
registerHarnessCommands(program);

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
