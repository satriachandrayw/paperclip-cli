# Server compatibility

This CLI uses the Paperclip HTTP API only. It does not import Paperclip server packages, access its database, or depend on a local checkout.

## Tested server versions

| Server version | Status | Evidence |
|---|---|---|
| `v2026.1005.0` | Contract-verified | Every endpoint below resolves to a documented route at that tag (`server/src/routes/openapi.ts`, tuple-form registrations included), with matching request validators and response shapes. Read-only canary still pending. |
| `>= 2026.831.0`, `< 2026.1005.0` | Supported, untested | Route families are unchanged across those releases; no canary recorded. |
| `< 2026.831.0` | Unsupported | `paperclip-cli health` prints a warning to stderr. |
| `> 2026.1005.0` | Untested | `paperclip-cli health` prints a warning to stderr. The API is unversioned and upstream publishes no deprecation policy, so pin and re-verify. |

`paperclip-cli health` compares the server's reported `version` against this window and warns; it never blocks a command.

## Shared state with the upstream `paperclipai` CLI

Both CLIs read and write the same directory. These rules keep the files interoperable:

| File | Rule |
|---|---|
| `~/.paperclip/context.json` | Unknown profile keys (`persona`, `agentId`, `tokenName`, `tokenId`, `tokenCreatedAt`, …) are preserved verbatim on read and write, and the stored `version` is never downgraded. |
| `~/.paperclip/auth.json` | Credential entries always carry `createdAt` and `updatedAt`; upstream's reader silently ignores entries without both. |
| Context discovery | `--context`, then `PAPERCLIP_CONTEXT`, then the nearest `.paperclip/context.json` walking up from the working directory, then `~/.paperclip/context.json`. Matches upstream, so both tools resolve the same API base and company. |

`PAPERCLIP_AUTH_STORE` overrides the credential path.

## Contract coverage

Board-authenticated endpoints used by this CLI. All verified present at `v2026.1005.0`.

| CLI family | API surface | Notes |
|---|---|---|
| `context` | none | Local profile file only. |
| `auth` | `POST /api/cli-auth/challenges`, `GET /api/cli-auth/challenges/:id`, `GET /api/cli-auth/me`, `POST /api/cli-auth/revoke-current` | Interactive board login. A board API key or `PAPERCLIP_API_KEY` avoids the flow entirely. |
| `health` | `GET /api/health` | Also reports server compatibility. |
| `company` | `GET /api/companies`, `GET /api/companies/:companyId` | |
| `label` | `GET /api/companies/:companyId/labels` | |
| `agent` | `GET /api/companies/:companyId/agents`, `GET /api/agents/:id`, `POST /api/agents/:id/{pause,resume,clear-error,terminate,wakeup}`, `GET|POST /api/agents/:id/keys`, `DELETE /api/agents/:id/keys/:keyId` | `keys create` prints the token once and skips redaction for that response. |
| `project` | `GET|POST /api/companies/:companyId/projects`, `GET|PATCH /api/projects/:id` | |
| `goal` | `GET|POST /api/companies/:companyId/goals`, `GET|PATCH /api/goals/:id` | |
| `routine` | `GET|POST /api/companies/:companyId/routines`, `GET|PATCH /api/routines/:id`, `POST /api/routines/:id/run`, `GET /api/routines/:id/runs` | |
| `issue` | `GET|POST /api/companies/:companyId/issues`, `GET|PATCH /api/issues/:id`, `POST /api/issues/:id/{comments,checkout,release,inbox-archive}`, `DELETE /api/issues/:id/inbox-archive`, `GET /api/issues/:id/{runs,documents,documents/:key,attachments}` | Issue labels are set through `issue create/update --label-id`; children through `--parent-id` or `issue list --parent-id`. |
| `skill` | `GET /api/companies/:companyId/skills`, `GET /api/companies/:companyId/skills/:skillId`, `GET|PATCH /api/companies/:companyId/skills/:skillId/files`, `POST /api/companies/:companyId/skills/{import,install-catalog}` | |
| `approval` | `GET /api/companies/:companyId/approvals`, `POST /api/companies/:companyId/approvals`, `GET /api/approvals/:id`, `POST /api/approvals/:id/{approve,reject,request-revision,resubmit,comments}` | |
| `activity`, `dashboard` | `GET /api/companies/:companyId/{activity,dashboard}` | |
| `plugin` | `GET /api/plugins`, `GET /api/plugins/:pluginId`, `POST /api/plugins/:pluginId/{enable,disable,config}`, `GET /api/plugins/:pluginId/{config,logs}` | Plugin config is company-scoped. |
| `run` | `GET /api/issues/:id/runs`, `GET /api/routines/:id/runs` | |
| `api` | any path under `/api` | Generic passthrough; `api describe <pattern>` reads `GET /api/openapi.json`. |

Mutation commands that are irreversible or operator-visible require `--yes`: `agent terminate`, `agent keys revoke`, `approval approve|reject|request-revision`, `plugin disable`, `plugin config set`, `skill write-file`, and every `api post|patch|put|delete`.

## Deliberately out of scope

These route families belong to the server runtime, browser UI, or agent runtime rather than a remote board operator. Use `paperclip-cli api` for a one-off call if needed.

- `tools`, `tool-gateway`, `tool-connections`, `tool-profiles`, `tool-applications`
- `chat-endpoints`, `chat-identity-links`, `board-chat`
- `decisions`, `decision-queues`, `decision-training`, `decision-triage`
- adapter login sessions, setup-token login sessions, environment custom-image sessions
- `execution-workspaces` internals, `sidebar-preferences`, `status-cards`, `summary-slots`, `folders`
- `llms` prompt endpoints, `announcements`, `org-chart` rendering
- Process and database management (`install`, `service`, `db:backup`, `worktree`) — owned by upstream's `paperclipai` CLI.

## Defect log

| Defect | Cause | Status |
|---|---|---|
| `context use`/`context set` rewrote `~/.paperclip/context.json` as `version: 1` and dropped `persona`/`agentId`/`tokenName`/`tokenId`/`tokenCreatedAt` from every profile. | `normalizeProfile` rebuilt each profile from three known keys. | Fixed: unknown keys preserved, stored version preserved. Regression test in `src/__tests__/config.test.ts`. |
| Credentials written by this CLI were invisible to the upstream `paperclipai` CLI. | `setStoredToken` wrote no `createdAt`/`updatedAt`, which upstream requires. | Fixed: both timestamps written, `createdAt` reused on rotation. Regression test added. |
| Running inside a repository that has its own `.paperclip/context.json` targeted a different API base and company than upstream. | No ancestor search. | Fixed: ancestor search matches upstream. Regression test added. |
| Slug or URL-key values for GUID-strict fields produced an opaque `400`. | No client-side validation. | Fixed: `--agent-id`, `--project-id`, `--goal-id`, `--parent-id`, `--assignee-agent-id`, `--owner-agent-id`, `--lead-agent-id`, `--label-id`, `--trigger-id`, `--requested-by-agent-id`, `--issue-id`, `--company-id` are validated with a named error before any request. |
| Contract drift was undetectable. | No server-version awareness; upstream has no deprecation policy. | Mitigated: `health` compares the reported version against the tested window and warns. |

## Release gate

Before publishing a release, run the read-only canary against each supported server version from a protected environment:

```sh
PAPERCLIP_CANARY=1 \
PAPERCLIP_API_URL="https://paperclip.example.com" \
PAPERCLIP_API_KEY="<injected-secret>" \
PAPERCLIP_COMPANY_ID="<company-id>" \
pnpm run canary:live
```

The canary never creates, updates, approves, rejects, comments, or installs anything. It checks health, authentication, company visibility, and—when a company ID is supplied—agent and issue reads, plus `api describe` against the server's OpenAPI document.

A release is not considered live-compatible until the canary output is recorded in the release checklist without copying credentials or private identifiers into the repository. Apply the same rule to the new mutation commands: verify each one against a disposable company before advertising it.
