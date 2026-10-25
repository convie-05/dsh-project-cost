# Contributing

Thanks for taking a look. This plugin is intentionally small — please keep it that way.

## Scope

**In scope**

- Per-project (working directory) token and cost attribution
- Better source discovery (new DSH layout, new ledger location)
- Readability, robustness, and correctness of the numbers
- Accessibility and layout of the settings panel

**Out of scope**

- A general usage dashboard (day / provider / model views) — `dsh-usage` and `dsh-cost-meter` already do this well
- Anything that requires modifying other plugins or global DSH configuration
- Uploading or syncing usage data anywhere

If a change needs another plugin installed *and* modified to work, it is probably out of scope.

## Development

No build step. The package is plain ESM + a browser module.

```bash
# host half
node --check index.js

# client half
node --check client.js
```

To try it in a live DSH:

```bash
dsh plugin --profile <profile> add link:/absolute/path/to/dsh-project-cost
```

The host half reloads via HMR; the client half needs a page refresh.

## Invariants to preserve

These are not stylistic preferences — each one exists because breaking it produced a
real, hard-to-diagnose bug.

1. **The client component returns only a mount point.** Content is drawn with native DOM
   through a `ref` callback. A throw *inside* the React render path silently blanks the
   whole slot (it still reports `active: true`), which is nearly impossible to debug
   from the outside. See `client.js` header.
2. **No class components in the client half.** `React.Component` is not provided by this
   runtime; `class X extends React.Component` throws at module-load time and invalidates
   the entire client bundle.
3. **No `table` / `tr` / `tbody` in the panel.** Use `div` + flex/grid. A mis-nested
   table is silently discarded by the browser, producing an empty-looking panel.
4. **Host routes carry a leading slash.** `/dsh-project-cost/api/overview`, never
   `dsh-project-cost/api/overview` — the relative form resolves to
   `/settings/...` and 404s.
5. **Every data source is optional.** The plugin must run with none of the ledgers present
   and show *something* useful. Never add a hard dependency on another plugin.
6. **Read-only.** The plugin must never write into session logs, ledgers, or another
   plugin's state. Its only writes are its own snapshot file.

## Testing a change

CI runs syntax checks, a `package.json` shape check, a declared-files check, and smoke
tests for both halves on Linux / Windows / macOS. Run the same steps locally before
opening a PR:

```bash
node --check index.js && node --check client.js
```

For behavior changes, please include the output of
`curl http://127.0.0.1:<port>/dsh-project-cost/api/overview`
(or `Invoke-RestMethod` on Windows) in the PR description, with any usage numbers
redacted if you prefer.

## Reporting a number that looks wrong

The three columns come from different places, so say which one is off:

| Column | Source | Typical cause of a wrong value |
| --- | --- | --- |
| cumulative tokens | session projection cache | session archived/deleted, or cache not flushed yet |
| today | cost-meter ledger (per-session) | that plugin did not record the call |
| cost | cost-meter ledger `costCny` | wrong ledger path, or the model is unpriced there |

`/api/overview` reports exactly which files were read under `sources`, so include that
section — it usually identifies the problem immediately.

## Commit messages

`fix:`, `feat:`, `docs:`, `chore:`, `refactor:` followed by a short imperative summary.
Add a body explaining *why* when the change touches one of the invariants above.

## License

By contributing you agree your work is released under the MIT license (see `LICENSE`).
