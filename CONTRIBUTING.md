# Contributing

Thanks for contributing to Paperclip CLI.

## Scope

This repository is the remote-only operator client. Do not add local Paperclip server startup, database administration, embedded Postgres, adapter runtime, heartbeat execution, or worktree management here.

## Development

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

## Pull requests

Please include:

- the user/operator workflow being changed
- API routes and compatibility assumptions
- security and authorization implications
- tests for success and failure paths
- documentation updates, including the generic operator skill when its behavior changes

Never include real API keys, private deployment URLs, company IDs, or personal paths in commits, tests, fixtures, examples, or screenshots.
