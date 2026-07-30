#!/usr/bin/env node
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

const program = new Command();

program
  .name("paperclip-cli")
  .description("Standalone remote operator for Paperclip control planes")
  .version("0.1.0");

registerContextCommands(program);
registerAuthCommands(program);
registerCompanyCommands(program);
registerAgentCommands(program);
registerIssueCommands(program);
registerProjectGoalRoutinePluginCommands(program);
registerSkillCommands(program);
registerApprovalCommands(program);
registerActivityAndDashboardCommands(program);
registerHealthCommand(program);
registerHarnessCommands(program);

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
