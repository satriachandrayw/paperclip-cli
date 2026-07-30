---
name: paperclip-harness-review
description: Human-invoked, agent-agnostic contract for a read-only local review of a bounded Paperclip run.
disable-model-invocation: true
---

# Paperclip Harness Review

Use this human-invoked, agent-agnostic skill when a user asks to review a Paperclip run stored in an explicit local instance. This skill is separate from `paperclip-cli`: it neither operates a remote control plane nor instructs a Paperclip agent to act.

## Scope gate

Before collecting any evidence, require all of the following:

- An explicit local instance path.
- Exactly one review target: one run identifier, or one agent/company identifier and a valid time window with both start and end, no longer than 31 days.

Do not infer a path, run, agent, company, or time window. If any part is missing, broad, or ambiguous, stop and ask the user to narrow the request before collection.

## Read-only boundary

The Review Entrypoint exposes no Paperclip mutation operation. Its collector is a read-only integration boundary: do not start, stop, retry, modify, or delete Paperclip runs; do not edit configuration, assets, logs, databases, or source files; and do not invoke Paperclip write APIs or commands that can change Paperclip state.

Pass the validated scope to the Review Entrypoint with `access: "read-only"`. Its collector may only read bounded local evidence, and its semantic judge may only assess that evidence.

## Current entrypoint contract

This entrypoint establishes the portable contract used by later collection and semantic-review components:

1. Validate the explicit local instance and bounded review scope.
2. Collect only the evidence needed for that scope.
3. Send the collected evidence to an injected semantic judge.
4. Return a read-only review result.

Do not claim that a semantic review was completed unless the configured collector and judge both ran successfully. The Pi-first hybrid review, redaction, findings, reports, and AI Fixing Prompts are added by later slices.
