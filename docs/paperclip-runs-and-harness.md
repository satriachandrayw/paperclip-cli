# Paperclip Agent Runs: How They Work & How Harness Validates Them

## Overview

Paperclip agents run in **heartbeats** — short execution windows triggered by wake events. The harness scanner validates that these runs follow the documented procedures and produce correct outcomes.

---

## 1. Run Lifecycle

### How Runs Work

```
Trigger → Wakeup → Claim → Execute → Complete → Report
   │         │        │        │          │         │
   │         │        │        │          │         └─ Comment required
   │         │        │        │          └─ Status update required
   │         │        │        └─ Checkout required first
   │         │        └─ One run per agent at a time
   │         └─ Coalescing prevents duplicate wakes
   └─ Four sources: timer, assignment, on_demand, automation
```

### Harness Checks for Run Lifecycle

| Check | What Harness Validates | Severity |
|-------|----------------------|----------|
| **Checkout called** | `POST /api/issues/{id}/checkout` appears before work | High |
| **Single run per agent** | No concurrent runs for same agent | Medium |
| **Run ID header** | `X-Paperclip-Run-Id` included in all mutations | Medium |
| **Completion status** | Run ends with `succeeded`, not `failed` | High |
| **Comment posted** | At least one comment on issue during run | High |

---

## 2. Issue Checkout Process

### How Checkout Works

```bash
POST /api/issues/{issueId}/checkout
Headers: Authorization: Bearer $PAPERCLIP_API_KEY
         X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
Body: {
  "agentId": "{agent-id}",
  "expectedStatuses": ["todo", "backlog", "blocked", "in_review"]
}
```

**Rules:**
- Must checkout before any work
- Idempotent if already checked out by same agent
- Returns `409 Conflict` if owned by another agent
- **Never retry a 409**

### Harness Validation

```typescript
// From qualitative-analyzer.ts
const checkoutCalled = checkForPattern(run, /\/api\/issues\/[^/]+\/checkout/);
if (!checkoutCalled) {
  findings.push({
    id: "missing-checkout",
    severity: "High",
    title: "Checkout not called before work",
    description: "Agent started work without checking out the issue first."
  });
}
```

---

## 3. Status Transitions

### Valid Transitions

```
backlog ──────► todo ──────► in_progress ──────► done
                           │        │
                           │        ▼
                           │    in_review ──────► done
                           │        │
                           │        ▼
                           │    blocked
                           │
                           ▼
                      cancelled
```

### Key Rules

| From | To | Valid? | How |
|------|----|--------|-----|
| `todo` | `in_progress` | ✓ | Via checkout only |
| `in_progress` | `done` | ✓ | Via PATCH with comment |
| `in_progress` | `in_review` | ✓ | Via execution policy or manual |
| `in_progress` | `blocked` | ✓ | Via PATCH with blocker info |
| `in_review` | `in_progress` | ✓ | Reviewer requests changes |
| `blocked` | `todo` | ✓ | Blockers resolved |
| `done` | `in_progress` | ✓ | Reopen with comment |

### Harness Validation

```typescript
// From qualitative-analyzer.ts
const validStatuses = ["backlog", "todo", "in_progress", "in_review", "done", "blocked", "cancelled"];
const status = run.disposition.issueStatus;
if (status && !validStatuses.includes(status)) {
  findings.push({
    id: "invalid-status-transition",
    severity: "Medium",
    title: "Invalid status transition"
  });
}
```

---

## 4. Execution Policies

### How Policies Work

Execution policies enforce review/approval stages automatically:

```json
{
  "mode": "normal",
  "commentRequired": true,
  "stages": [
    { "type": "review", "participants": [{ "type": "agent", "agentId": "qa-agent" }] },
    { "type": "approval", "participants": [{ "type": "user", "userId": "cto-user" }] }
  ]
}
```

### Flow

```
Executor completes work
    ↓
Runtime intercepts → status to `in_review` → assign to reviewer
    ↓
Reviewer approves → advances to next stage
    ↓
All stages approved → issue reaches `done`
```

### Changes Requested Flow

```
Reviewer: "Changes needed"
    ↓
Status → `in_progress` → auto-reassign to executor
    ↓
Executor reworks → re-submits
    ↓
Routes back to same reviewer (not beginning)
```

### Harness Validation

```typescript
// Check if execution policy was set for delegated work
const executionPolicySet = checkForPattern(run, /executionPolicy|execution_policy/);
if (!executionPolicySet && hasDelegation) {
  findings.push({
    id: "missing-execution-policy",
    severity: "Medium",
    title: "Execution policy not set for delegated work"
  });
}
```

---

## 5. Comment Requirement

### Runtime Enforcement

Paperclip runtime **requires** a comment on every run:

1. Run completes → runtime checks for comment
2. No comment → `issueCommentStatus = retry_queued` → agent woken once more
3. Still no comment → `retry_exhausted` → no further retries
4. Comment posted → `satisfied`

### Harness Validation

```typescript
// Check if comment was posted
const commentPosted = checkForPattern(run, /POST.*comments|comment.*posted/i);
if (!commentPosted) {
  findings.push({
    id: "missing-comment",
    severity: "High",
    title: "No comment posted during run",
    description: "Runtime requires a comment on every run."
  });
}
```

---

## 6. Error Handling

### Error Types

| Error | Cause | Recovery |
|-------|-------|----------|
| `adapter_not_installed` | Missing adapter config | Fix config |
| `timeout` | Run exceeded time limit | Increase timeout or optimize |
| `nonzero_exit` | Adapter crashed | Check logs, fix issue |
| `budget_blocked` | Agent at 100% budget | Wait or increase budget |
| `provider_quota` | Rate limited | Retry with backoff |
| `workspace_validation_failed` | Bad workspace config | Fix workspace |

### Retry Policy

Transient failures retry with exponential backoff:
```
[2min, 10min, 30min, 2hr] with 25% jitter, max 4 attempts
```

### Harness Validation

```typescript
// Check error rate
if (stats.errorRate > 0.1) {
  findings.push({
    id: "high-error-rate",
    severity: "Medium",
    title: `Error rate is ${(stats.errorRate * 100).toFixed(1)}%`
  });
}

// Check for 409 retries (forbidden)
const noRetryOn409 = !checkForPattern(run, /409.*retry|retry.*409/i);
if (!noRetryOn409) {
  findings.push({
    id: "retry-on-409",
    severity: "Critical",
    title: "Retry attempted on 409 Conflict"
  });
}
```

---

## 7. Liveness & Continuation

### Valid Final Dispositions

| Disposition | Meaning | Valid? |
|-------------|---------|--------|
| `done` | Work complete, no follow-up | ✓ |
| `in_review` | Real reviewer path exists | ✓ |
| `blocked` | Cannot proceed, blocker named | ✓ |
| `in_progress` | Live continuation path exists | ✓ (only with active path) |
| `in_progress` | No live path | ✗ Invalid |

### Harness Validation

```typescript
// Check final disposition
if (finalDisposition === "in_progress" && !hasLiveContinuationPath) {
  findings.push({
    id: "invalid-in-progress",
    severity: "High",
    title: "Issue in_progress with no live continuation path",
    description: "in_progress requires active run, queued continuation, or monitor."
  });
}
```

---

## 8. Paperclip API Compliance

### Required Headers

All mutation requests must include:
```
X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
```

### Key Endpoints

| Action | Endpoint | Method |
|--------|----------|--------|
| Checkout | `/api/issues/{id}/checkout` | POST |
| Update | `/api/issues/{id}` | PATCH |
| Comment | `/api/issues/{id}/comments` | POST |
| Create subtask | `/api/companies/{id}/issues` | POST |
| Release | `/api/issues/{id}/release` | POST |

### Harness Validation

```typescript
// Check for required headers
const runIdHeaderIncluded = checkForPattern(run, /X-Paperclip-Run-Id|PAPERCLIP_RUN_ID/);
if (!runIdHeaderIncluded) {
  findings.push({
    id: "missing-run-id-header",
    severity: "Medium",
    title: "X-Paperclip-Run-Id header missing"
  });
}

// Check for correct endpoints
const correctEndpoints = checkForCorrectEndpoints(run);
if (!correctEndpoints) {
  findings.push({
    id: "incorrect-endpoints",
    severity: "High",
    title: "Incorrect API endpoints used"
  });
}
```

---

## 9. Acceptance Criteria

### How Criteria Work

- Defined in issue description or comments
- Agent must verify each criterion before marking done
- Evidence should be documented in comments

### Harness Validation

```typescript
// Check acceptance criteria
const criteriaPresent = checkForPattern(run, /Acceptance Criteria/i);
const criteriaMet = estimateCriteriaMet(run, criteriaCount);

if (criteriaPresent && criteriaMet < criteriaCount) {
  findings.push({
    id: "incomplete-criteria",
    severity: "High",
    title: "Acceptance criteria not fully met"
  });
}
```

---

## 10. Coordination Patterns

### Delegation Rules

- Use `parentId` for child issues
- Set `blockedByIssueIds` for dependencies
- Use execution policies for review chains
- Never cancel cross-team tasks

### Harness Validation

```typescript
// Check delegation quality
if (hasDelegation && !executionPolicySet) {
  findings.push({
    id: "delegation-without-policy",
    severity: "Medium",
    title: "Delegation without execution policy"
  });
}

// Check cross-team coordination
if (crossTeamHandoff && !properRouting) {
  findings.push({
    id: "poor-cross-team-coordination",
    severity: "Medium",
    title: "Cross-team handoff missing context"
  });
}
```

---

## Summary: Harness Validation Matrix

| Area | Check | Severity | Source |
|------|-------|----------|--------|
| **Checkout** | Called before work | High | Run-log pattern |
| **Checkout** | Agent ID matches | Medium | Run-log pattern |
| **Status** | Valid transitions | High | Run-log pattern |
| **Status** | Final disposition valid | Medium | Run-log pattern |
| **Comment** | Posted during run | High | Run-log pattern |
| **Comment** | Includes X-Paperclip-Run-Id | Medium | Run-log pattern |
| **API** | Correct endpoints | High | Run-log pattern |
| **API** | No 409 retry | Critical | Run-log pattern |
| **Policy** | Set for delegation | Medium | Run-log pattern |
| **Criteria** | All met before done | High | Run-log pattern |
| **Error** | Rate < 10% | Medium | Run-log stats |
| **Error** | Proper handling | Medium | Run-log pattern |
| **Coordination** | Handoff context | Medium | Run-log pattern |
| **Coordination** | Escalation when stuck | Low | Run-log pattern |

---

## How Harness Helps

1. **Detects violations early** — Before they become production issues
2. **Quantifies compliance** — Scores for each dimension
3. **Identifies patterns** — Systemic issues across runs
4. **Guides improvement** — Priority moves with effort estimates
5. **Tracks progress** — Compare scores over time
