# Paperclip Harness Analysis Report

**Instance:** default
**Company:** c66ef9df-30ff-412c-8504-b7610c305a3d
**Generated:** 2026-07-30T14:34:58.414Z
**Time window:** 7d

## Overview

Paperclip harness analysis complete. Overall score: 83/100. 0 critical and 3 high severity findings require attention. Strongest area: Coordination Health (100/100). Weakest area: Execution Quality (50/100).

## Dimension Scores

| Dimension | Score | Summary |
|-----------|-------|---------|
| Agent Configuration | █████████░ 85/100 | 14/14 agents have AGENTS.md, 11 have TOOLS.md, 10 have SOUL.md |
| Coordination Health | ██████████ 100/100 | Delegation rules documented. Assignment model exists. 5 handoffs detected |
| Execution Quality | █████░░░░░ 50/100 | Error rate: 9.3%. Qualitative: 62/100. Completion: 0/94 |
| Learning Capture | ██████████ 100/100 | 8/14 agents have memory files. 9 agents have retros. Memory retrieval-to-outcome chain not demonstrated |
| Governance & Safety | ████████░░ 80/100 | No worktree policy. Approval gates exist |

## Findings

### 6 agents have no memory files

**Severity:** Low | **Confidence:** low
**Dimensions:** learning-capture

Agents without memory cannot learn from past experiences.

**Consequence:** Agents may repeat mistakes and miss institutional knowledge.

**Repair:** Add memory files for key decisions, patterns, and learnings.

---

### 4 agents missing SOUL.md

**Severity:** Low | **Confidence:** low
**Dimensions:** agent-configuration

SOUL.md defines agent personality, voice, and decision-making style.

**Consequence:** Agents may have inconsistent voice and decision-making.

**Repair:** Create SOUL.md with personality traits, voice, and decision framework.

---

### Acceptance criteria completion is low (40/100)

**Severity:** Medium | **Confidence:** medium
**Dimensions:** execution-quality

Agents are not completing acceptance criteria before marking issues done.

**Consequence:** Issues may be marked done without actual completion.

**Repair:** Add explicit acceptance criteria checking before status updates.

---

### Checkout not called before work

**Severity:** High | **Confidence:** medium
**Dimensions:** execution-quality

This issue occurred 94 times across runs.

**Consequence:** Repeated issues indicate systemic problems.

**Repair:** Investigate root cause and fix instructions or environment.

---

### Execution policy not set

**Severity:** High | **Confidence:** medium
**Dimensions:** execution-quality

This issue occurred 94 times across runs.

**Consequence:** Repeated issues indicate systemic problems.

**Repair:** Investigate root cause and fix instructions or environment.

---

### Paperclip skill not read

**Severity:** High | **Confidence:** medium
**Dimensions:** execution-quality

This issue occurred 94 times across runs.

**Consequence:** Repeated issues indicate systemic problems.

**Repair:** Investigate root cause and fix instructions or environment.

---

## Priority Moves

### Address critical/high severity findings

**Impact:** Resolves major issues affecting agent performance
**Effort:** high
**Findings:** qualitative-checkout-not-called-before-wor, qualitative-execution-policy-not-set, qualitative-paperclip-skill-not-read

### Fix medium severity issues

**Impact:** Improves agent configuration and execution quality
**Effort:** medium
**Findings:** poor-acceptance-criteria

### Address low severity improvements

**Impact:** Polishes agent setup and learning capture
**Effort:** low
**Findings:** missing-memory, missing-soul-md

## Agent Inventory

**Total agents:** 14
**Active agents:** 7
**Total runs:** 94
