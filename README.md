# Paperclip CLI

A standalone, remote-first command-line operator for [Paperclip](https://github.com/paperclipai/paperclip).

Paperclip CLI connects to a Paperclip control plane over HTTPS so humans and AI agents can manage companies, agents, projects, issues, skills, routines, approvals, and activity without running inside the Paperclip server's machine.

> **Status:** This repository is the standalone extraction project. The remote-only command surface and package are under active development.

## What this CLI is

- A remote operator for Paperclip control planes
- A scriptable interface for humans and AI agents
- An API client with JSON output and explicit mutation workflows
- Independent from the Paperclip server's source tree, database, and local runtime

## What this CLI is not

- A Paperclip server installer or process manager
- A database administration tool
- An embedded Postgres distribution
- An agent heartbeat runner
- A local adapter runtime
- A worktree or workspace manager

Those responsibilities remain with Paperclip server/runtime tooling or the agent runtime that owns them.

## Installation

The planned npm package is scoped to avoid colliding with the upstream `paperclipai` package:

```sh
npm install --global @satriachandaryw/paperclip-cli
```

The primary executable is:

```sh
paperclip-cli --help
```

During development, run from a checkout:

```sh
git clone https://github.com/satriachandaryw/paperclip-cli.git
cd paperclip-cli
pnpm install
pnpm build
node dist/index.js --help
```

The package name and installation command may change before the first public release. The command examples below define the intended remote-operator interface.

## Quick start

### 1. Set the Paperclip API URL

`PAPERCLIP_API_URL` is the **base URL of the Paperclip server you want to operate**. Use the public or private URL reachable from the machine running this CLI.

```sh
export PAPERCLIP_API_URL="https://paperclip.example.com"
```

Use the server origin only:

```text
Correct:   https://paperclip.example.com
Correct:   http://localhost:3100
Accepted but normalized: https://paperclip.example.com/api
Incorrect: https://paperclip.example.com/docs
```

The CLI adds `/api` to API requests and normalizes a trailing `/api` if one is supplied. Prefer the server origin in shared scripts, and never commit or hardcode an environment-specific URL.

### 2. Authenticate as a board operator

For an interactive human login, use the CLI approval flow:

```sh
paperclip-cli auth login --api-base "$PAPERCLIP_API_URL"
```

The flow is:

1. The CLI creates a short-lived authentication challenge on the server.
2. It prints an approval URL and attempts to open it in your browser.
3. Sign in to the Paperclip board in that browser.
4. Approve the CLI access request.
5. The CLI receives a board API token and stores it locally for that API base.

The default local auth file is:

```text
~/.paperclip/auth.json
```

It is written with owner-only permissions. Treat this file as a credential store. To remove and revoke the current credential:

```sh
paperclip-cli auth logout --api-base "$PAPERCLIP_API_URL"
```

Verify the authenticated identity:

```sh
paperclip-cli auth whoami --api-base "$PAPERCLIP_API_URL" --json
```

### 3. Find the company ID

After authentication, list the companies available to the board user:

```sh
paperclip-cli company list --api-base "$PAPERCLIP_API_URL" --json
```

Select the `id` of the company you want to operate:

```json
[
  {
    "id": "<company-id>",
    "name": "Example Company"
  }
]
```

Then set it for the current context:

```sh
export PAPERCLIP_COMPANY_ID="<company-id>"
```

A company ID is an identifier, not a credential. It is still better to resolve it from the target server instead of copying one from an unrelated environment.

### 4. Verify remote access

```sh
paperclip-cli company list --json
paperclip-cli agent list --company-id "$PAPERCLIP_COMPANY_ID" --json
paperclip-cli issue list --company-id "$PAPERCLIP_COMPANY_ID" --json
```

For a low-level health check:

```sh
curl --fail-with-body --silent --show-error \
  "$PAPERCLIP_API_URL/api/health"
```

A health response proves that the URL is reachable. `auth whoami` and `company list` prove that the credential is valid and authorized.

## Environment variables

| Variable | Required | Purpose | Secret? |
|---|---:|---|---:|
| `PAPERCLIP_API_URL` | Yes | Remote Paperclip server base URL | No |
| `PAPERCLIP_API_KEY` | For non-interactive auth | Bearer token used for API requests | **Yes** |
| `PAPERCLIP_COMPANY_ID` | For company-scoped defaults | Default company identifier | No |
| `PAPERCLIP_AUTH_STORE` | No | Override the local board credential store path | Potentially sensitive |

Never place a real API key in:

- this README
- shell history when avoidable
- command-line arguments
- issue descriptions
- CI logs
- committed `.env` files
- screenshots or chat messages

Use a secret manager or an environment-injected CI secret for automation.

### Explicit API-key authentication

For headless automation, provide a board API key through the environment:

```sh
export PAPERCLIP_API_URL="https://paperclip.example.com"
export PAPERCLIP_API_KEY="<board-api-key>"
export PAPERCLIP_COMPANY_ID="<company-id>"

paperclip-cli auth whoami --json
paperclip-cli issue list --json
```

Do not use `--api-key <token>` in shared scripts. Command-line arguments can be visible to process listings, shell history, CI diagnostics, and other local users.

### How to obtain an API key

There are two different Paperclip credential types:

#### Board operator credential — recommended for this CLI

Use the interactive flow whenever possible:

```sh
paperclip-cli auth login --api-base "$PAPERCLIP_API_URL"
```

A signed-in board user approves the challenge in the Paperclip UI. The CLI then receives a board token and stores it in `~/.paperclip/auth.json`.

For a headless environment, ask a Paperclip instance administrator to provision a board API key using the deployment's supported board-access workflow. Store the resulting value in a secret manager and expose it as `PAPERCLIP_API_KEY` only at runtime.

Board credentials may access multiple companies according to the board user's Paperclip permissions. The CLI does not grant access; the server remains the authorization source of truth.

#### Agent API key — restricted alternative

Paperclip can create long-lived keys for a specific agent from that agent's configuration/details view. The key is shown only once and is company-scoped.

An agent key is appropriate when the CLI must act strictly as that agent. It is **not** a replacement for a board operator credential and should not be used for multi-company administration.

If an agent key is intentionally used:

```sh
export PAPERCLIP_API_URL="https://paperclip.example.com"
export PAPERCLIP_API_KEY="<agent-api-key>"
export PAPERCLIP_COMPANY_ID="<agent-company-id>"
```

## Context profiles

Profiles keep API URLs and company defaults out of repeated command invocations. Store the key through an environment-variable name rather than plaintext configuration:

```sh
paperclip-cli context set --profile production \
  --api-base "$PAPERCLIP_API_URL" \
  --company-id "$PAPERCLIP_COMPANY_ID" \
  --api-key-env-var-name PAPERCLIP_API_KEY

paperclip-cli context use production
paperclip-cli context show
```

Use separate profiles for separate Paperclip deployments:

```sh
paperclip-cli context set --profile staging \
  --api-base "https://staging.paperclip.example.com" \
  --company-id "<staging-company-id>" \
  --api-key-env-var-name PAPERCLIP_STAGING_API_KEY
```

Recommended precedence for commands is:

1. Explicit command-line flags
2. Selected context profile
3. Environment variables
4. No implicit server or company defaults

The CLI must never contain a built-in company ID, private hostname, or personal deployment configuration.

## Remote operator examples

All company-scoped commands accept `--company-id`. Prefer `--json` when another agent or script will consume the output.

```sh
# Companies available to the authenticated board user
paperclip-cli company list --json

# Agents
paperclip-cli agent list --company-id "$PAPERCLIP_COMPANY_ID" --json
paperclip-cli agent get <agent-id> --json

# Projects, goals, and routines
paperclip-cli project list --company-id "$PAPERCLIP_COMPANY_ID" --json
paperclip-cli goal list --company-id "$PAPERCLIP_COMPANY_ID" --json
paperclip-cli routine list --company-id "$PAPERCLIP_COMPANY_ID" --json

# Issues
paperclip-cli issue list --company-id "$PAPERCLIP_COMPANY_ID" --status todo,in_progress --json
paperclip-cli issue get <issue-id> --json
paperclip-cli issue create \
  --company-id "$PAPERCLIP_COMPANY_ID" \
  --title "Investigate checkout conflict" \
  --priority high
paperclip-cli issue update <issue-id> --status in_progress
paperclip-cli issue comment <issue-id> --body "Started investigation."

# Skills
paperclip-cli skill list --company-id "$PAPERCLIP_COMPANY_ID" --json
paperclip-cli skill get <skill-id> --json

# Approvals
paperclip-cli approval list --company-id "$PAPERCLIP_COMPANY_ID" --status pending --json
paperclip-cli approval get <approval-id> --json

# Activity and dashboard
paperclip-cli activity list --company-id "$PAPERCLIP_COMPANY_ID" --json
paperclip-cli dashboard get --company-id "$PAPERCLIP_COMPANY_ID" --json

# Plugins and issue runs
paperclip-cli plugin list --json
paperclip-cli run list --issue-id <issue-id> --json
```

Approval decisions require explicit `--yes` confirmation. Before creating or changing a resource, agents should read current state, perform the smallest mutation, and use `--verify` where supported to re-read the resource and verify the observed result.

## CI usage

Inject credentials through the CI secret store:

```yaml
- name: Check Paperclip access
  env:
    PAPERCLIP_API_URL: ${{ secrets.PAPERCLIP_API_URL }}
    PAPERCLIP_API_KEY: ${{ secrets.PAPERCLIP_API_KEY }}
    PAPERCLIP_COMPANY_ID: ${{ vars.PAPERCLIP_COMPANY_ID }}
  run: |
    paperclip-cli auth whoami --json
    paperclip-cli issue list --json
```

Do not print the environment, use shell tracing, or include API responses containing credential fields in CI logs.

## Server compatibility

The CLI is independent from the Paperclip server source code, but it still depends on the server's public API contract.

Each release will document:

- minimum supported Paperclip server version
- tested server versions
- command-specific version requirements
- API capabilities that are optional or unavailable

If the server reports an incompatible version or a command returns an unsupported-route response, upgrade the CLI/server pair or consult the compatibility matrix. Do not work around a contract mismatch by importing server internals.

## Troubleshooting

### `401 Unauthorized`

- Confirm `PAPERCLIP_API_KEY` is set when using environment authentication.
- Re-run `paperclip-cli auth login` for interactive board access.
- Check that the key was not copied with surrounding quotes or whitespace.
- Rotate the key if it may have been exposed.

### `403 Forbidden`

The credential is valid but does not have permission for the requested company or operation. Use `auth whoami --json` and verify the company membership on the Paperclip server.

### `404 Not Found`

- Check that `PAPERCLIP_API_URL` is the server origin, not a UI/docs URL.
- Remove a trailing `/api` if present; the CLI adds `/api` itself.
- Confirm that the resource belongs to the selected company.

### `409 Conflict`

The server rejected the operation because the resource state changed or another actor owns the operation. Re-read the resource and decide whether the requested action is still valid. Do not blindly retry.

### `5xx`, timeout, or connection failure

- Verify connectivity to the deployment from the machine running the CLI.
- Run the `/api/health` check.
- Check the Paperclip server logs or deployment status.
- Treat the result of a timed-out mutation as unknown until the resource is re-read.

## Security

- Treat board credentials as high-impact secrets.
- Never commit `.env` files or auth stores.
- Never include credentials in issue descriptions, skill files, logs, or support requests.
- Use the smallest credential scope that meets the task.
- Prefer read-before-write and post-write verification.
- The server, not the CLI, enforces authorization and company boundaries.

Report suspected credential exposure or security vulnerabilities privately through the repository's security policy rather than opening a public issue.

## AI-agent integration

The repository provides a portable operator skill at:

```text
integrations/skills/paperclip-cli-operator/SKILL.md
```

The skill is generic and contains no deployment-specific IDs, URLs, secrets, personal paths, or PasPoto/Hermes policy. Deployment-specific board authority rules belong in the consuming agent environment.

## Development

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

Before release, also run the clean-clone smoke test, fake-server integration suite, live canary checks, package leak scan, and sanitized-skill validation.

The read-only live canary is opt-in and requires deployment credentials:

```sh
PAPERCLIP_CANARY=1 \
PAPERCLIP_API_URL="https://paperclip.example.com" \
PAPERCLIP_API_KEY="<injected-secret>" \
pnpm run canary:live
```

See [`docs/compatibility.md`](docs/compatibility.md) for the current contract matrix and release gate.

## License

This project is intended to remain open source under the MIT License. See `LICENSE` for the complete terms.
