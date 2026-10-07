# Changelog

All notable changes to Paperclip CLI will be documented here.

## [0.1.1] - 2026-10-07

### Fixed

- `health` reported "server did not report a version" for a self-hosted server running a release tag, which sends `commit` but no `version`. Tested build commits in `TESTED_SERVER_COMMITS` are now recognized, and an unknown commit is named in the warning.
- The live canary now falls back to the credential the CLI stores for the target API base (so no key has to be pasted onto a command line) and pins `--api-base`, which a context profile could otherwise override.

### Changed

- The release workflow skips the publish step when the version already exists on the registry, so a local `npm publish` followed by pushing the tag does not produce a failed release run.

## [0.1.0] - 2026-10-07

### Added

- Standalone remote-only Paperclip operator CLI.
- HTTPS API client with bearer authentication, timeouts, safe read retries, structured errors, and API-base normalization.
- Context profiles with separate owner-only credential storage.
- Interactive board authentication challenge flow.
- Company, agent, project, goal, issue, skill, routine, approval, activity, dashboard, plugin, and issue-run commands.
- Typed mutations for agents (`pause`, `resume`, `clear-error`, `terminate`, `wakeup`, `keys list|create|revoke`), issues (`documents`, `document`, `attachments`, `archive`, `unarchive`, `--label-id`, `--parent-id`), projects, goals, routines (`create`, `update`, `run`, run history), approvals (`create`, `resubmit`), skills (`import`, `install-catalog`, `write-file`), plugins (`enable`, `disable`, `config get|set`, `logs`), and company labels.
- `api` passthrough (`get`, `post`, `patch`, `put`, `delete`) plus `api describe` for endpoints without a typed command.
- Server compatibility reporting in `health`, comparing the reported version against the tested window.
- JSON/table output with credential-like field redaction, with an explicit reveal path for one-time credentials.
- Optional post-mutation verification for issue, approval, agent, project, goal, routine, and passthrough operations.
- Client-side GUID validation for GUID-strict request fields.
- Sanitized generic `paperclip-cli-operator` integration skill.
- Unit tests, fake-server smoke test, clean-checkout validation, CI, and read-only live-canary script.

### Fixed

- `context use`/`context set` rewrote `~/.paperclip/context.json` as `version: 1` and dropped upstream profile keys (`persona`, `agentId`, `tokenName`, `tokenId`, `tokenCreatedAt`). Unknown keys and the stored version are now preserved.
- Credentials written to `~/.paperclip/auth.json` were invisible to the upstream `paperclipai` CLI because `createdAt`/`updatedAt` were missing. Both timestamps are now written and `createdAt` is preserved on rotation.
- Context discovery now searches `.paperclip/context.json` in the working directory's ancestors before the home file, matching upstream so both CLIs resolve the same API base and company.

### Release status

Published to npm as `0.1.0` on 2026-10-07. The read-only canary passed against a self-hosted deployment running `v2026.1005.0` (commit `467125f`) the same day; see `docs/compatibility.md` for the recorded run and the supported window.
