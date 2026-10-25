---
name: Bug report
about: Something in the panel or the report tool is wrong
title: '[bug] '
labels: ['bug']
---

## What happened

<!-- A clear description of the problem. -->

## What you expected

## Steps to reproduce

1.
2.
3.

## Environment

- DSH version: <!-- shown in Settings → General, or `dsh --version` -->
- OS:
- Plugin version: <!-- package.json version, or the Release you downloaded -->
- Other usage plugins installed: <!-- dsh-cost-meter / dsh-usage / neither -->

## Diagnostics

<!--
Please include the output of the plugin's own route — it tells us exactly which
data sources were found, without exposing any prompts or conversation content:

  curl http://127.0.0.1:<port>/dsh-project-cost/api/overview

(On Windows PowerShell: Invoke-RestMethod http://127.0.0.1:<port>/dsh-project-cost/api/overview)

If the values look wrong, say which column is wrong (tokens / today / cost) and
what you expected instead.
-->

## Screenshots

<!-- If the panel is blank, a screenshot of the panel helps. Also please open the
browser devtools console and paste any `[project-cost]` errors. -->
