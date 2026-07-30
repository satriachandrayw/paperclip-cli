---
name: paperclip-cli-operator
description: Operate remote Paperclip control planes safely through the standalone paperclip-cli command.
disable-model-invocation: false
---

# Paperclip CLI Operator

Use this skill when an agent must inspect or change a remote Paperclip control plane through `paperclip-cli`.

## Operating contract

- The CLI is remote-only. Do not assume a local Paperclip checkout, server process, database, adapter, or workspace.
- Configure the target explicitly with `PAPERCLIP_API_URL` or a context profile.
- Keep credentials in `PAPERCLIP_API_KEY` or the CLI's secure local auth store. Never print, commit, paste, or place credentials in issues, comments, logs, or skill files.
- Resolve the company with `paperclip-cli company list --json`; never invent or reuse an identifier from another deployment.
- Use `--json` when parsing output programmatically.
- The Paperclip server is the source of truth for authentication, authorization, company boundaries, and resource state.

## Configuration

```sh
export PAPERCLIP_API_URL="https://paperclip.example.com"
export PAPERCLIP_API_KEY="<provided-through-a-secret-manager>"
export PAPERCLIP_COMPANY_ID="<company-id>"
```

For interactive board authentication:

```sh
paperclip-cli auth login --api-base "$PAPERCLIP_API_URL"
paperclip-cli auth whoami --api-base "$PAPERCLIP_API_URL" --json
```

For repeated use, prefer a profile that stores only non-secret defaults and the name of the environment variable containing the credential:

```sh
paperclip-cli context set production \
  --api-base "$PAPERCLIP_API_URL" \
  --company-id "$PAPERCLIP_COMPANY_ID" \
  --api-key-env-var-name PAPERCLIP_API_KEY \
  --use
```

## Read-before-write workflow

Before a mutation:

1. Confirm the API base and authenticated identity.
2. Resolve the exact company and resource IDs.
3. Read the current resource state.
4. Search for an existing equivalent resource before creating one.
5. Perform the smallest mutation required.
6. Re-read the resource and report the observed final state.
7. If the request timed out or returned a server error, treat the mutation result as unknown until re-read.

Never blindly retry mutations. In particular, a timeout after issue creation may mean the issue exists.

## Common operations

```sh
paperclip-cli company list --json
paperclip-cli agent list --company-id "$PAPERCLIP_COMPANY_ID" --json
paperclip-cli issue list --company-id "$PAPERCLIP_COMPANY_ID" --json
paperclip-cli skill list --company-id "$PAPERCLIP_COMPANY_ID" --json
paperclip-cli approval list --company-id "$PAPERCLIP_COMPANY_ID" --status pending --json
```

For issue creation, search first and verify afterward:

```sh
paperclip-cli issue list \
  --company-id "$PAPERCLIP_COMPANY_ID" \
  --match "<unique title fragment>" \
  --json

paperclip-cli issue create \
  --company-id "$PAPERCLIP_COMPANY_ID" \
  --title "<title>" \
  --description "<description>" \
  --json

paperclip-cli issue get "<issue-id>" --json
```

## Error handling

- `401`: re-authenticate or rotate the credential; do not expose it while debugging.
- `403`: verify board membership, agent scope, company ID, and requested operation.
- `404`: verify API base, route, resource ID, and company context.
- `409`: re-read state and resolve the conflict; do not blindly retry.
- `429`: respect server throttling and retry only safe reads.
- `5xx` or network timeout: check health and re-read before deciding whether a mutation should be repeated.

## Safety boundaries

- Never use an agent-scoped credential for multi-company board administration.
- Never assume a company identifier is an authorization boundary; the server enforces authorization.
- Never output full API responses if they contain credential-like fields; use the CLI's redacted output.
- Never add private URLs, deployment IDs, user IDs, local paths, or real credentials to this skill.
