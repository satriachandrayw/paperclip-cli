---
name: paperclip-harness-review
description: Human-invoked, agent-agnostic, read-only local Paperclip review. Use to collect bounded deterministic evidence and have a semantic judge review run quality, instructions, coordination, delivery, and learning.
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

## Deterministic evidence collection

1. Validate the scope gate and read-only boundary.
2. Perform deterministic evidence collection for only that scope:
   - Run metadata, lifecycle events, tool calls, errors, retries, timestamps, disposition, and claimed completion.
   - Relevant instruction and configuration artifacts for the selected run, agent, or company.
   - Evidence of task understanding, controlled execution, change validation, reliable delivery, and learning capture.
3. Normalize and redact evidence before it leaves the local instance. Preserve source paths, excerpts, timestamps, and confidence so claims remain auditable.
4. Give the bounded evidence to a semantic judge. Use it to assess meaning and context; do not treat deterministic signals, keyword matches, or fixed score thresholds as final judgment.
5. Return findings with evidence, uncertainty, and—when repairable—a user-copyable AI Fixing Prompt. Never apply the prompt or alter the reviewed instance.

## Evidence and judgment roles

- Treat deterministic collection as an evidence layer, not a second review product. It may identify candidate anomalies such as missing instructions, failed tools, incomplete lifecycle events, weak handoffs, or absent validation evidence.
- Treat the semantic judge as the final evaluator for relevance, severity, quality, and dimension scoring. It must distinguish observed facts from inferences and say when the available evidence is insufficient.
- Do not claim that a semantic review was completed unless the collector and semantic judge both ran successfully. If the configured collector is unavailable, report that limitation rather than falling back to a broad instance scan.

## AI Fixing Prompt

Every repairable finding must include an `aiFixingPrompt` field in the report. Make it self-contained and user-copyable; never execute it as part of the review.

```text
You are fixing a Paperclip review finding.

Finding: <title and severity>
Review scope: <local instance and run, or agent/company and time window>
Observed evidence: <redacted, source-attributed excerpts only>
Why it matters: <review consequence>
Desired outcome: <observable repaired behavior or artifact>
Constraints: preserve existing intended behavior; make the smallest safe change; do not expose secrets or widen scope.
Validation required: <specific tests, checks, or observable evidence that proves the repair>

First inspect the relevant local context. Then propose the smallest repair plan, make changes only after the user directs you to do so, and report the validation results and any remaining uncertainty.
```

Omit `aiFixingPrompt` only for informational findings or when the evidence cannot support a safe repair. State why it was omitted.
