# Upstream compatibility analysis — paperclip-cli vs Paperclip v2026.1005.0

Researched 2026-10-07. Scope: HTTP API contract + on-disk state shared with upstream tooling.

## Verdict

**The HTTP API surface is compatible. The on-disk shared state is not.**

Every endpoint paperclip-cli calls still exists at the latest release, with matching request and
response shapes. But paperclip-cli and upstream's own CLI write to the **same files**
(`~/.paperclip/context.json`, `~/.paperclip/auth.json`) using **incompatible shapes**, and both
collisions are silent.

- 36/36 CLI endpoints present at `v2026.1005.0` — no route removals, no schema breaks.
- 2/2 shared state files are shape-incompatible with upstream.

## Versions

| Thing | Version | Date |
|---|---|---|
| paperclip-cli (this repo) | 0.1.0, last commit `1aea794` | 2026-07-30 |
| Paperclip latest stable release | `v2026.1005.0` (`467125f`) | released 2026-10-05 |
| Paperclip npm `paperclipai` | `2026.1005.0` | published 2026-10-06 |
| Paperclip prerelease channel | `beta=2026.1006.0-beta.0`, `nightly=2026.1007.0-nightly.0` | 2026-10-06/07 |
| Prior stable releases | `v2026.1001.0` (10-01), `v2026.916.1` (09-21), `v2026.916.0` (09-16), `v2026.831.1` (09-02), `v2026.831.0` (08-31) | |

Prior stable releases before 2026-07-30: `v2026.722.0`, `v2026.720.0`, `v2026.707.0`.

Sources: <https://github.com/paperclipai/paperclip/releases>,
<https://registry.npmjs.org/paperclipai>, local clone of `paperclipai/paperclip` (tag `v2026.1005.0`,
SHA verified against `https://api.github.com/repos/paperclipai/paperclip/tags`).

## Method

1. Extracted every API base used by paperclip-cli (`src/commands.ts`, `src/api.ts`).
2. Diffed against the server's OpenAPI registry (`server/src/routes/openapi.ts`, 662 documented
   routes) at tag `v2026.1005.0`.
3. Re-read each request/response validator at that tag (`packages/shared/src/validators/*`).
4. Compared shared-state files against upstream's CLI implementation (`cli/src/client/*` at the
   same tag) and reproduced both collisions with real commands.

## 1. HTTP API contract — compatible

All 36 CLI calls resolve to a documented route at `v2026.1005.0`:

| CLI family | Endpoints | Result |
|---|---|---|
| auth | `POST /api/cli-auth/challenges`, `GET /api/cli-auth/challenges/:id`, `GET /api/cli-auth/me`, `POST /api/cli-auth/revoke-current` | OK |
| health | `GET /api/health` | OK |
| company | `GET /api/companies`, `GET /api/companies/:companyId` | OK |
| agent / project / goal / routine | `GET /api/{agents,projects,goals,routines}/:id`, `GET /api/companies/:companyId/{agents,projects,goals,routines}` | OK |
| issue | `GET/POST /api/companies/:companyId/issues`, `GET/PATCH /api/issues/:id`, `POST /api/issues/:id/{comments,checkout,release}`, `GET /api/issues/:id/runs` | OK |
| approval | `GET /api/companies/:companyId/approvals`, `GET /api/approvals/:id`, `POST /api/approvals/:id/{approve,reject,request-revision,comments}` | OK |
| skill | `GET /api/companies/:companyId/skills[/:skillId[/files]]` | OK |
| activity / dashboard / plugin | `GET /api/companies/:companyId/{activity,dashboard}`, `GET /api/plugins[/:pluginId]` | OK |

Payload-level checks at `v2026.1005.0`:

- `POST /api/cli-auth/challenges` — the response contract paperclip-cli parses (`id`, `token`,
  `boardApiToken`, `approvalPath`, `approvalUrl`, `pollPath`, `expiresAt`,
  `suggestedPollIntervalMs`) is exactly what `server/src/routes/access.ts` returns.
  `requestedAccess: "board" | "instance_admin_required"` and
  `createCliAuthChallengeSchema.requestedCompanyId` (GUID or null) both still match.
- `POST /api/issues/:id/checkout` — `checkoutIssueSchema` unchanged since 2026-07-30:
  `agentId: guid`, `expectedStatuses: nonempty(ISSUE_STATUSES)`. CLI defaults
  `["todo","backlog","blocked"]` are still valid enum members.
- `POST /api/issues/:id/comments` — `addIssueCommentSchema` accepts `body`, `reopen`, `resume`
  (plus new optional `clientRequestId`, `attachmentIds`, `interrupt`).
- `PATCH /api/issues/:id` — `updateIssueSchema` accepts every CLI field
  (`title`, `description`, `status`, `priority`, `assigneeAgentId`, `projectId`, `goalId`,
  `parentId`, `comment`). `createIssueSchema` still requires only `title`, with `status`
  defaulted server-side by `applyCreateIssueStatusDefault`.
- `POST /api/approvals/:id/{approve,reject,request-revision}` — `resolveApprovalSchema` is still
  `{ decisionNote? }`; responses return the approval row, so `--verify` re-reads via
  `GET /api/approvals/:id` correctly.
- Issue list query keys used by the CLI (`status`, `projectId`, `assigneeAgentId`) are still read
  by `GET /api/companies/:companyId/issues`, and comma-separated `status` is still split in
  `server/src/services/issues.ts`.
- List responses the CLI pipes into `printRows` are still bare arrays: companies, agents,
  projects, goals, routines, issues, approvals, activity, skills, plugins, issue runs.
- Board bearer auth is unchanged: `Authorization: Bearer <token>` resolves board API key →
  agent key → JWT → session (`server/src/middleware/auth.ts`).

### Sharp edges in the API contract (not breaks)

- `agentId`, `projectId`, `goalId`, `parentId`, `assigneeAgentId` are GUID-validated. Passing an
  agent URL key/slug (the UI uses slugs; see `packages/shared/src/agent-url-key.ts`) fails with a
  raw 400, and `GET /api/agents/:id` resolves row IDs only. CLI has no client-side GUID check.
- `PAPERCLIP_COMPANY_ID` is sent as `requestedCompanyId` on login and must be a GUID or the
  challenge request 400s.
- Task-bridge-scoped keys get 403 on company-wide issue lists
  (`isTaskBridgeKeyActor` in `server/src/routes/issues.ts`), so `issue list` fails for that key
  type by design.
- v2026.831.0 changed invalid credentials from anonymous fallback to 401, and v2026.916.0 removed
  plaintext credentials from agent API responses. paperclip-cli already handles both (401 →
  "Authentication failed"; `src/output.ts` redacts secret-like keys).

## 2. Shared on-disk state — incompatible (real defects)

Both tools use `~/.paperclip/` with the same filenames:

| File | paperclip-cli | upstream `paperclipai` CLI |
|---|---|---|
| `~/.paperclip/context.json` | `src/config.ts:51`, `version: 1`, profiles = `{apiBase, companyId, apiKeyEnvVarName}` | `cli/src/config/home.ts:31`, `version: 2`, profiles add `persona`, `agentId`, `agentName`, `tokenName`, `tokenId`, `tokenCreatedAt` |
| `~/.paperclip/auth.json` | `src/config.ts:55`, entry `{apiBase, token, userId}` | `cli/src/config/home.ts:35`, entry **requires** `{apiBase, token, createdAt, updatedAt}` |

### Defect A — paperclip-cli destroys upstream profile metadata (verified)

`src/config.ts:68` `normalizeProfile()` keeps only three keys, and `readContext()`
(`src/config.ts:81`) normalizes **every** profile in the file before any write. So a single
`context use`/`context set` rewrites the shared file as `version: 1` and drops upstream-only keys
from every profile.

Reproduced against a copy of the live `~/.paperclip/context.json` (version 2, a non-default
profile current). Deployment identifiers in the excerpt below are replaced with synthetic values of
the same shape:

```
$ node dist/index.js context use prod --context /tmp/ctx-test.json
--- before/after
-   "version": 2,                          +   "version": 1,
-       "persona": "board",                (dropped)
-       "tokenName": "board-ops-token",     (dropped)
-       "tokenId": "3f1c9a44-5d2b-...",     (dropped)
-       "tokenCreatedAt": "2026-01-05 ...", (dropped)
```

Upstream only reads `apiBase`/`companyId`/`apiKeyEnvVarName` back, so the loss is invisible until
the official CLI loses its token identity/persona for that profile.

**Minimal fix:** preserve unknown profile keys verbatim and stop downgrading the file. Keep the raw
profile object in `ClientContextProfile` (e.g. `Record<string, unknown>` merge) instead of
reconstructing it, and write `version: 2` when the file already says 2.

### Defect B — upstream CLI cannot see tokens paperclip-cli minted (verified)

`cli/src/client/board-auth.ts:89` skips any credential entry missing `createdAt` **or**
`updatedAt`. paperclip-cli's `setStoredToken()` (`src/config.ts:163`) writes neither.

```
$ tsx /tmp/auth-probe.mts        # calls upstream readBoardAuthStore()
upstream sees: [ 'https://official-written.example.com' ]
# the paperclip-cli-shaped entry for https://cli-written.example.com is silently dropped
```

Reverse direction works. paperclip-cli only needs `token`, and `readAuthStore()`
(`src/config.ts:137`) round-trips unknown keys, so it keeps upstream's timestamps intact. Verified
end-to-end against a local fake server: `paperclip-cli health` with
`PAPERCLIP_AUTH_STORE=<upstream-shaped store>` sent
`GET /api/health auth=Bearer pcp_board_EXAMPLE_TOKEN` and returned 200.

**Minimal fix:** write `createdAt`/`updatedAt` ISO strings in `setStoredToken()`, reusing
`createdAt` when the entry already exists.

### Defect C — different context resolution (silent wrong-server risk)

`cli/src/client/context.ts:26,44` searches the **current directory's ancestors** for
`.paperclip/context.json` before falling back to `~/.paperclip/context.json`. paperclip-cli
(`src/config.ts:61`) only ever reads `~/.paperclip/context.json` unless `--context` is passed.
Repos that already carry a local `.paperclip/context.json` therefore resolve to a **different API
base and company** depending on which CLI is run.

Reproduced as a read-only defect only; no change made. Fix (optional): mirror the ancestor search,
or document the divergence in `docs/compatibility.md`.

## 3. Strategic note — upstream now ships its own CLI

`paperclipai` (npm, `bin: paperclipai`, source `cli/` in the upstream repo) covers the same
control-plane families paperclip-cli implements: `context`, `auth login`, `company`, `project`,
`goal`, `issue`, `agent`, `approval`, `activity`, `dashboard`, `plugin`, `skills`, plus setup
layers paperclip-cli deliberately does not own (`onboard`, `doctor`, `service`, `run`, `worktree`,
`db:backup`, `install`). It even uses the same `~/.paperclip` layout and the same six-word
vocabulary (`apiBase`, `companyId`, `apiKeyEnvVarName`), so the two share a design lineage.

paperclip-cli's remaining differentiators: JSON-first scripting, `--verify` post-mutation re-read,
`issue list --match` client-side filter, read retries with `Retry-After` handling, and redacted
output. Worth deciding explicitly whether the project stays a thin scriptable operator over the
same API or converges on upstream's CLI.

## 4. Release-gate status (from `docs/compatibility.md`)

- `paperclip-cli` is **not published**: `npm view <package name>` → 404. The initial package name
also used a scope that did not match the npm username (`@satriachandaryw` vs `satriachandrayw`),
which fails at publish time; tracked separately.
- No live canary result is recorded for any server version, including `v2026.1005.0`.
- Unit tests pass locally (4 files / 18 tests, `pnpm test`) but they exercise a fake server only.
- paperclip-cli has no server-version detection (`src/index.ts` sets `.version("0.1.0")` and
  nothing reads the server's reported version), while upstream publishes **no** documented API
  deprecation or versioning policy (`docs.paperclip.ing` has an API reference and
  `GET /api/openapi.json`, but no stability page; `/llms.txt` 404s). Contract drift is therefore
  undetectable from the client side. Pin a tested server version in `docs/compatibility.md` and
  record a canary run per version.

## Verification commands

```sh
# endpoint surface vs the latest release tag
cd "$PAPERCLIP_REPO" && git rev-parse v2026.1005.0   # 467125fafb47a8520856504fecc48d6e32055db1
node /tmp/cmp.mjs                                          # 36/36 OK

# defect A (context.json) — use a copy, never the live file
cp ~/.paperclip/context.json /tmp/ctx-test.json
node dist/index.js context use prod --context /tmp/ctx-test.json && diff ~/.paperclip/context.json /tmp/ctx-test.json

# defect B (auth.json)
cd "$PAPERCLIP_REPO"/cli && ./node_modules/.bin/tsx /tmp/auth-probe.mts

# CLI own test suite
cd "$PAPERCLIP_CLI_REPO" && pnpm test
```
