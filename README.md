# agentvet-action

[![Marketplace](https://img.shields.io/badge/Marketplace-agentvet--action-blue?logo=github)](https://github.com/marketplace/actions/agentvet-action)
[![CI](https://github.com/MukundaKatta/agentvet-action/actions/workflows/test.yml/badge.svg)](https://github.com/MukundaKatta/agentvet-action/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

Lint LLM tool definitions in your repo. Catches missing descriptions, non-snake_case names, and missing input schemas before the model ever sees a broken tool. Wraps the npm-published [`@mukundakatta/agentvet`](https://www.npmjs.com/package/@mukundakatta/agentvet) library.

Supports Anthropic (`input_schema`), OpenAI (`parameters`), and MCP (`inputSchema`) tool shapes, plus MCP server configs (`mcpServers.<name>.tools[]`).

## Quick start

```yaml
- uses: actions/checkout@v4
- uses: MukundaKatta/agentvet-action@v1
  with:
    tools-glob: "**/tools/*.json,**/mcp.json"
```

## Inputs

| Input | Default | Description |
|---|---|---|
| `tools-glob` | `**/tools/*.json,**/mcp.json,**/.mcp.json` | Comma- or newline-separated globs of JSON files to scan. |
| `fail-on` | `error` | `error` fails on hard errors only; `warning` fails on either; `none` never fails the build. |
| `report-path` | `agentvet-report.json` | Where to write the JSON report. |
| `node-version` | `20` | Node version for the runner. |

## Outputs

| Output | Description |
|---|---|
| `total-tools` | Number of tool definitions scanned. |
| `errors` | Count of tools with hard errors. |
| `warnings` | Count of tools with warnings. |
| `report-path` | Path to the JSON report. |

## Issue codes

| Code | Severity | Meaning |
|---|---|---|
| `E000` | error | file is not valid JSON |
| `E001` | error | tool is missing `name` or `description` |
| `E002` | error | `name` is not snake_case |
| `W001` | warning | `description` shorter than 10 chars |
| `W002` | warning | no `inputSchema` / `input_schema` / `parameters` |

## Example: gate a PR on tool quality

```yaml
name: Lint LLM tools
on: pull_request
jobs:
  agentvet:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: MukundaKatta/agentvet-action@v1
        with:
          tools-glob: "tools/**/*.json,mcp.json"
          fail-on: error
```

## Example: warning-only mode (just report, never fail)

```yaml
- uses: MukundaKatta/agentvet-action@v1
  with:
    fail-on: none
- run: cat agentvet-report.json
```

## Sibling actions

Part of the [@mukundakatta agent stack](https://www.npmjs.com/~mukundakatta):

- [`agentsnap-action`](https://github.com/MukundaKatta/agentsnap-action) — snapshot tests for tool-call traces
- [`mcp-stack-validate-action`](https://github.com/MukundaKatta/mcp-stack-validate-action) — single CI gate that runs the whole stack

## License

MIT
