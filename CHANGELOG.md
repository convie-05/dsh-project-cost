# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-10-24

First public release.

### Added

- **Settings page** under *Settings → Project Cost (Tokens)*:
  - summary cards for total tokens, today's tokens, real spend, project/session counts
  - one row per project (`cwd`) with session count, cumulative tokens + share bar,
    today's tokens, real cost, last-active date
  - expandable detail: token buckets (input/output/cache-read/cache-write/reasoning),
    active range, copy-path button, and the 10 most expensive sessions in that project
  - manual refresh plus a 60-second auto-refresh while the panel is visible
- **`project_cost_report` agent tool** — read-only, returns per-project token and cost totals.
- **Three-tier data sourcing**, each optional:
  - DSH session projection cache → cumulative tokens
  - `dsh-cost-meter` ledger → real billed amount and exact today usage
  - `@linxin666/dsh-usage` ledger → today / last-N-days fallback
- **Configurable data locations** — `dshHome` and `costMeterPath` overrides, with
  automatic probing of historical directory layouts.
- **Loopback-only HTTP routes** `/dsh-project-cost/api/overview` and `/api/refresh`.
- **Snapshot persistence** to `$DSH_HOME/storages/project-cost/overview.json` for instant cold starts.
- Bilingual UI (Chinese / English) following the host locale, with locale JSON resources.

### Notes

- A "project" is a working directory. All sessions sharing a `cwd` are aggregated together;
  use `pathAliases` to rename a project.
- The client half renders through a `ref` callback and plain DOM. This is intentional:
  a render-time throw inside a slot silently blanks the entry while still reporting
  `active: true`, which is very hard to debug. See the README section
  "How the client half renders".
- `React.Component` is not provided by this client runtime — class components throw at
  module-load time. Function components only.
- **No `Config` schema is exported.** Some DSH builds throw
  `Cannot read properties of undefined (reading 'validate')` when a row exporting
  `Config` is activated, which fails the whole row. Configuration is read from the
  `cordis.patch.yml` `config:` block instead; every field is range-clamped in code.
