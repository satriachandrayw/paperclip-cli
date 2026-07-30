# Changelog

All notable changes to Paperclip CLI will be documented here.

## [0.1.0] - Unreleased

### Added

- Standalone remote-only Paperclip operator CLI.
- HTTPS API client with bearer authentication, timeouts, safe read retries, structured errors, and API-base normalization.
- Context profiles with separate owner-only credential storage.
- Interactive board authentication challenge flow.
- Company, agent, project, goal, issue, skill, routine, approval, activity, dashboard, plugin, and issue-run commands.
- JSON/table output with credential-like field redaction.
- Optional post-mutation verification for issue and approval operations.
- Sanitized generic `paperclip-cli-operator` integration skill.
- Unit tests, fake-server smoke test, clean-checkout validation, CI, and read-only live-canary script.

### Release status

This version is not published yet. A real Paperclip deployment canary and package publication are release-gate items.
