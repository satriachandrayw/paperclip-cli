# Server compatibility

This CLI uses the Paperclip HTTP API only. It does not import Paperclip server packages, access its database, or depend on a local checkout.

## Current contract coverage

The initial standalone implementation has route coverage for the following read/write families, based on the Paperclip server route modules used during extraction:

| CLI family | API surface | Live status |
|---|---|---|
| `company` | companies list/detail | Fake-server verified; live canary pending |
| `agent` | company agent list/detail | Route shape verified from source; live canary pending |
| `project` | company project list/detail | Route shape verified from source; live canary pending |
| `goal` | company goal list/detail | Route shape verified from source; live canary pending |
| `issue` | list/detail/create/update/comments/checkout/release | Fake-server verified for create + post-read; live canary pending |
| `skill` | company skill list/detail/file | Route shape verified from source; live canary pending |
| `routine` | company routine list/detail | Route shape verified from source; live canary pending |
| `approval` | list/detail/decision/comments | Route shape verified from source; live canary pending |
| `activity` | company activity list | Route shape verified from source; live canary pending |
| `dashboard` | company dashboard | Route shape verified from source; live canary pending |
| `plugin` | installed plugin list/detail | Route shape verified from source; live canary pending |
| `run` | issue run list | Route shape verified from source; live canary pending |

## Release gate

Before publishing a release, run the read-only canary against each supported server version from a protected environment:

```sh
PAPERCLIP_CANARY=1 \
PAPERCLIP_API_URL="https://paperclip.example.com" \
PAPERCLIP_API_KEY="<injected-secret>" \
PAPERCLIP_COMPANY_ID="<company-id>" \
pnpm run canary:live
```

The canary never creates, updates, approves, rejects, comments, or installs anything. It checks health, authentication, company visibility, and—when a company ID is supplied—agent and issue reads.

A release is not considered live-compatible until the canary output is recorded in the release checklist without copying credentials or private identifiers into the repository.
