## v1.0.0 — first public release

**Per-project token spend for DeepSeek Harness.**

DSH has excellent usage panels, but they aggregate by day / provider / model.
This plugin adds the one missing dimension: **how much did each working
directory cost me?**

### Highlights

- **Settings → Project Cost (Tokens)** — four summary cards plus one row per
  project (name, path, session count, cumulative tokens with a share bar,
  today's tokens, real spend, last-active date).
- **Expandable detail** — token buckets (input / output / cache-read /
  cache-write / reasoning), active range, copy-path, and the **10 most
  expensive sessions** in that project.
- **`project_cost_report` agent tool** — read-only; the model can answer
  "which project is burning the most money?" directly.

### Where the numbers come from

| Column | Source |
| --- | --- |
| cumulative tokens | DSH session projection cache (complete, cross-day) |
| today | `dsh-cost-meter` ledger, per-session accounting |
| cost | `dsh-cost-meter` ledger `costCny` — real billed amount, **not estimated** |

Every source is optional; the plugin degrades instead of failing. Unit-price
estimation only kicks in when no ledger is available.

### Portability

`dshHome` and `costMeterPath` are configurable, with automatic probing of
historical directory layouts — WSL, portable installs and custom profiles work
out of the box.

### Known limitations

- A project is a working directory; one directory cannot be split into two
  projects (rename via `pathAliases`).
- No `Config` schema is exported. Some DSH builds throw
  `Cannot read properties of undefined (reading 'validate')` when activating a
  row that exports one, failing the whole row. Configure through
  `cordis.patch.yml` instead — every field is range-clamped in code.

### Install

```bash
dsh plugin --profile <profile> add link:/absolute/path/to/dsh-project-cost
```

MIT licensed. See [README](README.md) for the full picture.
