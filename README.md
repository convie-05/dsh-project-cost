# dsh-project-cost

**Token spend, per project, inside DeepSeek Harness.**

[English](README.md) | [中文](README.zh-CN.md)

DSH has no notion of a "project" — but every session carries a working directory (`cwd`) that stays fixed for its lifetime. This plugin treats **each `cwd` as a project**, folds every session's token usage into it, and shows you which directory is actually eating your budget.

> **Why another usage plugin?** DSH already has excellent usage panels (e.g. `dsh-usage`, `dsh-cost-meter`) — but they aggregate by **day / provider / model**. None of them answer "how much did *this repo* cost me?" That is the single dimension this plugin adds.

---

## What you get

A new page under **Settings → Project Cost (Tokens)**:

- **Four summary cards** — total tokens across all projects, today's tokens, real spend, project & session counts.
- **One row per project** — name + full path, session count, cumulative tokens (with a share bar), today's tokens, real cost, last-active date.
- **Click any row** to expand:
  - input / output / cache-read / cache-write / reasoning buckets
  - active date range
  - one-click copy of the working directory
  - **the 10 most expensive sessions** in that project (title, tokens, that session's cost, date)
- **Refresh** button forces a rescan; the panel also auto-refreshes every 60 s while visible.
- **`project_cost_report` agent tool** — ask the model "which project is burning the most money?" and it queries this plugin directly.

---

## Data sources

Everything is read-only. The plugin degrades gracefully — each source is optional.

| Source | Provides | If missing |
| --- | --- | --- |
| `$DSH_HOME/storages/session_projcache/sessions/*.json` — DSH's own session projection cache | **Cumulative tokens** per session (complete, cross-day) | No data at all |
| `$DSH_HOME/storages/cost-meter/ledger.json` — [`dsh-cost-meter`](https://github.com/Han-1413141/dsh-cost-meter) ledger | **Real billed amount** + exact today usage (per-session accounting) | Cost column empty; today falls back |
| `$DSH_HOME/dsh-usage/usage-ledger.json` — [`@linxin666/dsh-usage`](https://www.npmjs.com/package/@linxin666/dsh-usage) ledger | Today / last-N-days token totals (fallback) | Uses cost-meter or shows 0 |
| Live sessions via `ctx.sessions` + `ctx.sessionProjections` | Sessions not yet flushed to the cache | Slightly stale totals |

> **Why not parse the session logs directly?** `sessions/**/session.v4.jsonl.zstd` needs zstd decompression plus event-by-event folding — roughly 3× slower than reading the projection cache, for the same numbers. The projection cache *is* the full history.

Money is **not estimated** when a real ledger is present: `dsh-cost-meter` records `costCny` per session, and that is what you see. Estimation (tokens × your configured unit price) only kicks in when no ledger is available.

---

## Install

### From the DSH Plugin Manager (recommended)

1. Open **Settings → Plugins → Add local bundle**
2. Point it at this directory
3. Restart the Host half (or just reload the page for the client half)

### From the CLI

```bash
dsh plugin --profile <your-profile> add link:/absolute/path/to/dsh-project-cost
```

The package already declares `dsh.bundle.patch`, so it appears in the plugin tree immediately.

---

## Configuration

All settings are optional — the plugin runs with none of them.

> **Note on the absence of `Config` schema.** This plugin deliberately does **not**
> export a `Config` schema object. Some DSH builds throw
> `Cannot read properties of undefined (reading 'validate')` while activating a row
> that exports one, which makes the whole plugin row fail to load. Configuration is
> therefore read straight from the `config:` block the loader passes to
> `apply(ctx, config)`, and every field is range-clamped in code. Unknown or
> malformed values are ignored rather than fatal.

Add a `config:` block to the plugin row in your profile's `cordis.patch.yml`:

```yaml
- insert:
    - id: project-cost
      name: dsh-project-cost
      config:
        pricePerMillion: 2          # only used when no cost ledger exists
        priceUnit: cny              # cny | usd
        recentDays: 30
        includeLiveSessions: true
        pathAliases: |
          C:/Users/me/Downloads/scratch=Plugin sandbox
          D:/lab=Research
```

| Key | Default | Meaning |
| --- | --- | --- |
| `dshHome` | *(auto)* | DSH data root. Leave empty to try `$DSH_HOME`, then `~/.dsh`. Set it for WSL / portable / custom profiles. |
| `costMeterPath` | *(auto)* | Explicit path to a `dsh-cost-meter` ledger. Empty = probe common locations. |
| `pricePerMillion` | `0` | Unit price per 1M tokens for estimation. `0` disables estimation. |
| `priceUnit` | `cny` | Currency of `pricePerMillion`. |
| `recentDays` | `30` | Window for the "last N days" figures. |
| `includeLiveSessions` | `true` | Include sessions that are still running and not yet in the cache. |
| `pathAliases` | *(empty)* | Rename projects, one `path=display name` per line. `~` expands to home. |

---

## Agent tool

The plugin registers one read-only tool:

```
project_cost_report({ limit: 20 })
```

```
6 projects · 1.90B tokens total · today 88.6M · spend ¥321.09 (8,815 calls)

· 新建文件夹  1,444,823,088 tokens · 121 sessions · today 80,926,029 · ¥191.10 · C:\Users\me\Downloads\scratch
· HP            252,238,803 tokens ·   3 sessions · today  2,444,126 · ¥100.98 · C:\Users\me
...
```

---

## Local HTTP routes

Loopback-only (`127.0.0.1` / `localhost` / `[::1]`); other hosts get `403`.

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/dsh-project-cost/api/overview` | Aggregated document. `?fresh=1` forces a rescan. |
| `GET`/`POST` | `/dsh-project-cost/api/refresh` | Force a rescan. |

A snapshot is written to `$DSH_HOME/storages/project-cost/overview.json` after each scan, so the panel can render instantly on a cold start.

---

## How the client half renders

The panel uses a deliberately conservative pattern: **React only provides the mount point, native DOM draws the content.**

```js
function ProjectCostSection() {
  return h('div', { ref: mountHost, className: 'dpc-root' }, 'Loading…')
}

function mountHost(node) {
  if (node.__mounted) return
  node.__mounted = true
  startPainter(node)   // everything below is plain DOM
}
```

Two reasons:

1. **A render-time throw silently blanks the whole slot.** The slot still reports `active: true`, but the user sees nothing and the console stays quiet. Keeping drawing out of the render path means a data-layer bug shows an error message instead of an empty panel.
2. **`React.Component` is not available** in this client runtime. A `class X extends React.Component` throws at module-load time (`extends undefined`), which invalidates the entire client bundle. Function components + `ref` callbacks sidestep that entirely.

Hooks (`useState` / `useEffect` / `useRef`) *are* available — this project initially misdiagnosed that and the mistake is documented in the code comments. The current pattern is chosen for robustness, not because hooks are broken.

---

## Known limitations

- **A project is a directory.** All sessions sharing a `cwd` are one project. There is no way to split one directory into two projects (only rename it via `pathAliases`).
- Cost comes from `dsh-cost-meter`. Without it (or when it missed a call), that row's cost is `0`.
- The projection cache's `tokenUsage` is cumulative across days; the day dimension depends on a daily ledger.
- Archiving or deleting sessions changes the projection cache, and therefore the numbers.
- The plugin reads files directly from disk; it does not go through DSH services for usage data. Paths are configurable for this reason.
- No `Config` schema is exported (see Configuration above), so the plugin row does not render an auto-generated settings form. Configure it through `cordis.patch.yml`.

---

## Related projects

| Project | Relation |
| --- | --- |
| [`dsh-cost-meter`](https://github.com/Han-1413141/dsh-cost-meter) | Source of the real billed amounts used here |
| [`@linxin666/dsh-usage`](https://www.npmjs.com/package/@linxin666/dsh-usage) | Day/provider/model usage ledger (fallback source) |
| [`ccusage`](https://github.com/ccusage/ccusage) | Excellent usage CLI for Claude Code — aggregated by day/session, not per project |
| [`TokenTracker`](https://github.com/xiufengsun/TokenTracker) | Local-first tracker with DeepSeek Harness support, but organized per session file, not per `cwd` |
| [`claudit`](https://github.com/Nitjsefnie/claudit) | Per-project attribution, Claude Code only |
| [`tokenmeter`](https://github.com/aidevksh/tokenmeter) | Per-directory, Claude Code only |

---

## License

MIT
