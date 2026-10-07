# Paperclip CLI

This context covers the standalone tools and skill assets used to operate and review Paperclip agent work.

## Language

**Paperclip Harness**:
An agent-agnostic, human-invoked skill pack for reviewing Paperclip agent runs. It currently operates locally against a local Paperclip instance and is separate from the remote `paperclip-cli` operator surface.
_Avoid_: CLI Harness, agent-invoked harness

**Local review mode**:
The initial Paperclip Harness operating boundary in which review evidence is read from a local Paperclip instance by the invoking user or reviewer.
_Avoid_: Remote-only review, automatic run review

**Hybrid review model**:
A review model in which deterministic logic extracts, normalizes, and protects evidence while an LLM reviewer makes semantic finding, severity, and scoring judgments from the bounded evidence.
_Avoid_: Raw rule-based judging, unconstrained transcript judging

**Review entrypoint**:
The single user-facing Paperclip Harness skill that coordinates local evidence collection and semantic reconciliation through internal components.
_Avoid_: Multiple user-facing review flows

**Provider rollout**:
The order in which Paperclip Harness gains provider-aware review support: Pi first, then Codex, then Claude.
_Avoid_: Codex-first rollout, implied simultaneous parity

**Review report**:
The durable, redacted output of a Paperclip Harness review, consisting of machine-readable findings and a human-readable Markdown or HTML rendition without raw run evidence.
_Avoid_: Inline-only review, raw-log report

**Review scope**:
The explicit local instance and bounded target selected for one review: a specific run, or an agent/company within a defined time window.
_Avoid_: Whole-instance default scan, implicit evidence scope

**Review dimensions**:
The five evidence-bounded dimensions used to judge a Paperclip Harness review: Task Understanding, Controlled Execution, Change Validation, Reliable Delivery, and Learning Capture.
_Avoid_: Scanner scorecard, count-derived dimensions

**AI Fixing Prompt**:
A user-facing, per-finding template that translates a verified repairable gap into a bounded change request for a coding agent, including evidence summary, scope, constraints, validation, and rollback expectations. It does not authorize or perform the change.
_Avoid_: Automatic repair, unbounded remediation prompt
