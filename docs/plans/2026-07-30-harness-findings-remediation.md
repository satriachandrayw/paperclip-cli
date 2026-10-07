# Harness Findings Remediation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 5 findings from the harness report for company `<company-id>`.

**Architecture:** All 3 high-severity findings share one root cause — a production vs source version discrepancy in `adapter-utils`. The production build of `resolvePaperclipDesiredSkillNames()` returns `[]` when `paperclipSkillSync` is not explicitly configured in the agent's `adapterConfig`, ignoring `required: true` bundled skills. Source code returns `requiredSkills` (which includes the `paperclip` skill). Fix: (1) PATCH each agent's `adapterConfig` to explicitly set `paperclipSkillSync.desiredSkills` (DONE manually by user), (2) harden AGENTS.md with explicit skill loading instructions, (3) add acceptance criteria verification (DONE), (4) create missing memory dirs (DONE).

**Tech Stack:** Paperclip API (PATCH /api/agents/:agentId), agent instruction files (Markdown), shell

## Root Cause Analysis

### Skill Injection Chain

```
Heartbeat trigger
  → heartbeat.ts calls companySkills.listRuntimeSkillEntries(companyId)
  → result stored in config.paperclipRuntimeSkills
  → passed to pi-local adapter execute()
  → adapter resolves desired skills via resolvePaperclipDesiredSkillNames()
  → ensurePiSkillsInjected() creates symlinks in ~/.pi/agent/skills/
  → pi launched with --skill <pi-agent-skills-dir>
```

### The Bug

**Source** (`packages/adapter-utils/src/server-utils.ts`):
```typescript
if (!preference.explicit) {
  return Array.from(new Set(requiredSkills)); // ← auto-injects required skills
}
```

**Production** (`packages/adapter-utils/dist/server-utils.js`):
```javascript
if (!preference.explicit)
  return []; // ← returns EMPTY, ignores required skills
```

The `paperclip` skill is `paperclip_bundled` → `required: true` in DB. But production code returns `[]` when `paperclipSkillSync` is not explicitly configured. Result: no symlinks created, `--skill` dir empty, agents can't read the skill.

### Key Files

| File | Role |
|------|------|
| `<paperclip-checkout>/server/src/services/heartbeat.ts:4987` | Calls `listRuntimeSkillEntries`, sets `paperclipRuntimeSkills` |
| `<paperclip-checkout>/server/src/services/company-skills.ts` | Manages company skills DB, marks bundled as `required` |
| `<paperclip-checkout>/packages/adapters/pi-local/src/server/execute.ts` | Pi adapter: builds args, calls `ensurePiSkillsInjected` |
| `<paperclip-checkout>/packages/adapter-utils/src/server-utils.ts` | Source: `resolvePaperclipDesiredSkillNames` with `requiredSkills` |
| `/var/cache/paperclip/npm/.../adapter-utils/dist/server-utils.js` | Production: `resolvePaperclipDesiredSkillNames` returns `[]` |

## Findings Mapped to Root Cause

| # | Finding | Severity | Root Cause |
|---|---------|----------|------------|
| 1 | Checkout not called before work (97x) | High | Paperclip skill Step 5 (checkout) not injected → agent never reads it |
| 2 | Execution policy not set (97x) | High | Paperclip skill Step 6 (execution policy) not injected → agent never reads it |
| 3 | Paperclip skill not read (97x) | High | `resolvePaperclipDesiredSkillNames` returns `[]` in production → no symlinks → empty `--skill` dir |
| 4 | Acceptance criteria completion low (40/100) | Medium | No verification step in HEARTBEAT.md before marking done |
| 5 | 4 agents missing memory files | Low | 9558ab05, 9adf3d5c have no memory dir |

## Global Constraints

- Instance root: `<instance-root>`
- Company ID: `<company-id>`
- Agent base: `<instance-root>/companies/<company-id>/agents/`
- API base: `$PAPERCLIP_API_URL` = `<PAPERCLIP_API_URL>`
- Paperclip skill key: `paperclipai/paperclip/paperclip`
- Skill source path: `/var/cache/paperclip/npm/_npx/0aa74679bec75e15/node_modules/@paperclipai/server/skills/paperclip/`
- 14 agents total, 7 active (with runs in last 7d)

---

### Task 1: PATCH agent adapterConfig to inject paperclip skill

**Files:** None (API calls)

**Why:** This is the primary fix. Without `paperclipSkillSync.desiredSkills` in `adapterConfig`, the production `resolvePaperclipDesiredSkillNames` returns `[]` and no symlinks are created.

**API Endpoint:** `PATCH /api/agents/{agentId}`
**Body:** Set `adapterConfig.paperclipSkillSync.desiredSkills` to `["paperclipai/paperclip/paperclip"]`

- [ ] **Step 1: Authenticate**

```bash
# Get a valid auth token for the API
# The Paperclip API uses Bearer auth. Check the instance .env or use the admin token.
```

- [x] ~~**Step 2: PATCH each active agent's adapterConfig**~~ (done manually by user)

For each of the 7 active agents, call:

```bash
curl -s -X PATCH "$PAPERCLIP_API_URL/api/agents/<agentId>" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "adapterConfig": {
      "paperclipSkillSync": {
        "desiredSkills": ["paperclipai/paperclip/paperclip"]
      }
    }
  }'
```

Active agents:
- `<id-1>` (CTO)
- `<id-2>` (Quality)
- `<id-3>` (CEO)
- `<id-4>` (Founding Engineer)
- `<id-5>` (Agents Consultant)
- `<id-6>` (CMO)
- `<id-7>` (Chief of Staff)

- [ ] **Step 3: Verify adapterConfig was saved**

```bash
curl -s "$PAPERCLIP_API_URL/api/agents/<agentId>" \
  -H "Authorization: Bearer $TOKEN" | jq '.adapterConfig.paperclipSkillSync'
```

Expected: `{"desiredSkills": ["paperclipai/paperclip/paperclip"]}`

- [ ] **Step 4: Verify skill will be injected on next run**

On next heartbeat, the adapter should:
1. Call `resolvePaperclipDesiredSkillNames(config, entries)` → returns `["paperclipai/paperclip/paperclip"]`
2. Call `ensurePiSkillsInjected` → creates symlink in `~/.pi/agent/skills/`
3. Pass `--skill <pi-agent-skills-dir>` to pi → skill is accessible

- [ ] **Step 5: Commit (if any local config files)**

If adapter configs are stored in local files rather than DB only:
```bash
git add -A
git commit -m "fix: set paperclipSkillSync.desiredSkills on all active agents"
```

---

### Task 2: Update AGENTS.md to explicitly instruct skill loading

**Files:**
- Modify: `agents/<id-1>/instructions/AGENTS.md`
- Modify: `agents/<id-2>/instructions/AGENTS.md`
- Modify: `agents/<id-3>/instructions/AGENTS.md`
- Modify: `agents/<id-4>/instructions/AGENTS.md`
- Modify: `agents/<id-5>/instructions/AGENTS.md`
- Modify: `agents/<id-6>/instructions/AGENTS.md`
- Modify: `agents/<id-7>/instructions/AGENTS.md`

**Why:** Even with the skill properly injected, agents need an explicit instruction to read it. Current AGENTS.md says "Use the `paperclip` skill as the source of truth" but doesn't tell the agent HOW to load it (e.g., `read skills/paperclip/SKILL.md`).

- [ ] **Step 1: Update Paperclip API section in each AGENTS.md**

Replace the existing Paperclip API section (all agents have a variant of this):
```markdown
## Paperclip API

Use the `paperclip` skill as the source of truth for all Paperclip API access,
heartbeat procedure, issue lifecycle, and coordination behavior.
```

With:
```markdown
## Paperclip API

The `paperclip` skill is your source of truth for API access, heartbeat procedure, issue lifecycle, and coordination behavior. It is injected at runtime via `--skill`. Load it at the start of every heartbeat:

1. Read `skills/paperclip/SKILL.md` — contains the full heartbeat procedure (Steps 1-9), checkout flow, execution policy, all API routes, and comment style.
2. Read `skills/paperclip/references/api-reference.md` when you need full endpoint tables.

`$AGENT_HOME/shared/assignment-model.md` contains company-specific policy layered on top: issue lifecycle, labels, branches, merge authority, execution policy handoff contract, and coordination rules.

If a direct API call is explicitly required, `$PAPERCLIP_API_URL` is the base URL. Never hardcode the URL.
```

- [ ] **Step 2: Update HEARTBEAT.md section 1 in each agent**

Replace the current section 1 pattern (all agents have this):
```markdown
- Start every heartbeat by following the `paperclip` skill's canonical heartbeat procedure.
```

With:
```markdown
- Read `skills/paperclip/SKILL.md` and follow its heartbeat procedure (Steps 1-9). This is mandatory — the skill contains checkout, execution policy, and API routes you need.
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "fix: explicit paperclip skill loading instructions in AGENTS.md and HEARTBEAT.md"
```

---

### Task 3: Inline checkout and execution policy gate in HEARTBEAT.md (belt-and-suspenders)

**Files:**
- Modify: `agents/<active-uuid>/instructions/HEARTBEAT.md` (7 files)

**Why:** Even with the skill injected, the checkout and execution policy steps are buried deep in a 500+ line skill file. Inlining them as a prominent gate in HEARTBEAT.md ensures they're never skipped.

- [ ] **Step 1: Add Checkout & Execution Policy Gate to each HEARTBEAT.md**

Insert after the Inbox section (section 2 or equivalent), before any "do work" section:

```markdown
## Checkout & Execution Policy Gate

Before doing ANY work on an issue:

### 1. Checkout (mandatory — ONLY way to enter `in_progress`)
POST /api/issues/{issueId}/checkout with body:
```json
{"agentId": "$PAPERCLIP_AGENT_ID", "expectedStatuses": ["todo", "backlog", "blocked", "in_review"]}
```
Include headers: `Authorization: Bearer $PAPERCLIP_API_KEY`, `X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID`
- 409 → stop, task belongs to someone else, never retry
- Already checked out by you → returns normally
- `checkedOutByHarness: true` in wake payload → already checked out, skip this call

### 2. Execution policy (required for executable leaf work)
After checkout, fetch the issue and check for `executionPolicy`:
- Missing + not exempt (routine/container, coordination, audit/triage, approval-request) → do NOT start work, comment "Missing execution policy", assign back to creator
- Present → verify: `mode: "normal"`, `commentRequired: true`, you are NOT a reviewer/approval participant
- Only proceed after policy is validated

**Never skip checkout. Never begin work on a `todo` issue without checking it out.**
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "fix: inline checkout and execution policy gate in all HEARTBEAT.md"
```

---

### Task 4: Add acceptance criteria verification to AGENTS.md

**Files:**
- Modify: `agents/<active-uuid>/instructions/AGENTS.md` (7 files)

**Why:** Finding #4 — "Acceptance criteria completion is low (40/100)".

- [x] **Step 1: Add Definition of Done section** ✅

Added to all 7 active agents' AGENTS.md (verified with grep).

```markdown
## Definition of Done

Before transitioning ANY issue to `done`:

1. Re-read the issue description and all acceptance criteria
2. For each criterion, verify it is met with evidence:
   - Code changes: run tests, check CI status
   - UI changes: verify with QE screenshots (if applicable per feature lifecycle)
   - Non-code deliverables: confirm artifact exists and matches spec
3. Leave a Tier 2 comment listing which criteria were verified
4. Only then transition to `done`

If any criterion is not met, leave the issue in `in_progress` or `in_review`.
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "fix: add acceptance criteria verification before done transition"
```

---

### Task 5: Create memory files for agents missing them

**Files:**
- Create: `agents/<id-8>/instructions/memory/README.md`
- Create: `agents/<id-9>/instructions/memory/README.md`

**Why:** Finding #5 — 2 agents (9558ab05, 9adf3d5c) have no memory directory. The other two (41f23a4e, 97227428) already have memory/ dirs.

- [x] **Step 1: Create memory directories** ✅

```bash
AGENT_BASE="<instance-root>/companies/<company-id>/agents"

for id in <id-8> <id-9>; do
  mkdir -p "$AGENT_BASE/$id/instructions/memory"
  cat > "$AGENT_BASE/$id/instructions/memory/README.md" << 'EOF'
# Memory

Daily notes and learnings for this agent. Files follow `YYYY-MM-DD.md` naming.
Use this space to record key decisions, patterns, and lessons from past work.
EOF
  echo "Created memory dir for $id"
done
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "fix: add memory directories for agents 9558ab05 and 9adf3d5c"
```

---

### Task 6: Long-term fix — switch instance from npx to source checkout

**Files:** None (operational change)

**Why:** The root cause is a source-vs-production discrepancy in `adapter-utils`. The production build (`npx paperclipai`) has `resolvePaperclipDesiredSkillNames` returning `[]` when `paperclipSkillSync` is not explicitly configured, ignoring `required: true` bundled skills. The source code returns `requiredSkills`. Instead of rebuilding and publishing to npm, switch the local dev instance to run directly from the source checkout at `<paperclip-checkout>`.

- [x] **Step 1: Stop the current npx-based server** ✅
- [x] **Step 2: Build from source** ✅ (`pnpm install && pnpm build` at `/opt/paperclip/source`)
- [x] **Step 3: Start from source** ✅ (updated `/opt/paperclip/bin/start-paperclip.sh` to use `pnpm paperclipai run`)
- [x] **Step 4: Verify the fix** ✅ (source has `requiredSkills` auto-injection)
- [x] **Step 5: Disabled auto-update timer** ✅ (`systemctl disable --now paperclip-update.timer`)
- [x] **Step 6: Restarted service** ✅ (healthy after 20s)

---

### Task 7: Verify — re-run harness and compare

**Files:** None (verification only)

- [ ] **Step 1: Trigger new heartbeats for active agents**

Wait for natural heartbeats or trigger manually to generate new runs with the fixes applied.

- [ ] **Step 2: Re-run harness report**

```bash
cd <paperclip-cli-checkout>
npx tsx src/index.ts harness report \
  --instance-root <instance-root> \
  --company-id <company-id> \
  --max-runs 20 \
  --format both \
  --out /tmp/harness-report-v2
```

- [ ] **Step 3: Compare before/after**

| Dimension | Before | Target After |
|-----------|--------|-------------|
| Agent Configuration | 87 | 87+ |
| Coordination Health | 100 | 100 |
| Execution Quality | 50 | 75+ |
| Learning Capture | 100 | 100 |
| Governance & Safety | 80 | 80+ |

| Finding | Before | Target |
|---------|--------|--------|
| Checkout not called before work | 97 occurrences | 0 (new runs) |
| Execution policy not set | 97 occurrences | 0 (new runs) |
| Paperclip skill not read | 97 occurrences | 0 |
| Acceptance criteria low | 40/100 | 60+ |
| Missing memory files | 4 agents | 2 (dormant agents with no runs) |

---

## Execution Order

1. **Task 1** ~~(PATCH adapterConfig)~~ — done manually by user
2. **Task 2** (AGENTS.md + HEARTBEAT.md skill loading instructions) — ensures agents know to read the skill
3. **Task 3** (inline checkout/execution gate) — belt-and-suspenders
4. **Task 4** ~~(acceptance criteria)~~ — ✅ done
5. **Task 5** ~~(memory dirs)~~ — ✅ done
6. **Task 6** ~~(switch from npx to source checkout)~~ — ✅ done
7. **Task 7** (verify) — after new heartbeats

Tasks 1-5 can be done in one session. Task 6 requires a rebuild and restart. Task 7 needs new heartbeat runs.
