#!/usr/bin/env node
/**
 * agentvet-action linter.
 *
 * Walks every JSON file matched by AGENTVET_TOOLS_GLOB, extracts tool
 * definitions, and lints each one with @mukundakatta/agentvet's validate()
 * + adapters.shape() to enforce: non-empty name, snake_case name, present
 * description, present input schema. Writes a JSON report and emits GitHub
 * Action outputs.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { validate, adapters } from '@mukundakatta/agentvet';

const cwd = process.env.GITHUB_WORKSPACE || process.cwd();
const globsRaw = process.env.AGENTVET_TOOLS_GLOB || '**/tools/*.json,**/mcp.json,**/.mcp.json';
const failOn = (process.env.AGENTVET_FAIL_ON || 'error').toLowerCase();
const reportPath = process.env.AGENTVET_REPORT_PATH || 'agentvet-report.json';

// Split on commas + newlines, trim, drop empties.
const globs = globsRaw
  .split(/[,\n]/)
  .map((s) => s.trim())
  .filter(Boolean);

// Snake-case-ish: lowercase letters/digits/underscores, must start with a letter.
const snakeCase = adapters.fn(
  (a) => typeof a?.name === 'string' && /^[a-z][a-z0-9_]*$/.test(a.name),
  (a) =>
    `name '${a?.name}' must be snake_case (lowercase letters, digits, underscores; start with a letter)`,
);

// The shape every tool definition should expose. inputSchema OR parameters
// (Anthropic uses input_schema, OpenAI uses parameters, MCP uses inputSchema).
const baseShape = adapters.shape({
  name: 'string',
  description: 'string',
});

function hasInputSchema(tool) {
  return (
    (tool.inputSchema && typeof tool.inputSchema === 'object') ||
    (tool.input_schema && typeof tool.input_schema === 'object') ||
    (tool.parameters && typeof tool.parameters === 'object')
  );
}

function lintTool(tool, fileRel, idx) {
  const issues = [];
  const baseRes = validate('tool-shape', baseShape, tool);
  if (!baseRes.valid) {
    issues.push({
      severity: 'error',
      code: 'E001',
      message: baseRes.error.validationError,
    });
  }
  if (typeof tool?.name === 'string' && tool.name.length > 0) {
    const snakeRes = validate('tool-name', snakeCase, tool);
    if (!snakeRes.valid) {
      issues.push({
        severity: 'error',
        code: 'E002',
        message: snakeRes.error.validationError,
      });
    }
  }
  if (typeof tool?.description === 'string' && tool.description.length < 10) {
    issues.push({
      severity: 'warning',
      code: 'W001',
      message: `description is shorter than 10 chars (got ${tool.description.length}); LLMs need detail to call the tool correctly`,
    });
  }
  if (!hasInputSchema(tool)) {
    issues.push({
      severity: 'warning',
      code: 'W002',
      message:
        'no inputSchema / input_schema / parameters; LLM has no guidance on what arguments to pass',
    });
  }
  return {
    file: fileRel,
    index: idx,
    name: tool?.name ?? null,
    issues,
  };
}

// Extract tool definitions from a parsed JSON document. Handles:
//   - bare array of tools
//   - { tools: [...] }
//   - MCP-style { mcpServers: {...} } (servers each have a "tools" entry)
//   - single tool object with name + description
function extractTools(doc) {
  if (Array.isArray(doc)) return doc;
  if (doc && typeof doc === 'object') {
    if (Array.isArray(doc.tools)) return doc.tools;
    if (doc.mcpServers && typeof doc.mcpServers === 'object') {
      const out = [];
      for (const server of Object.values(doc.mcpServers)) {
        if (Array.isArray(server?.tools)) out.push(...server.tools);
      }
      return out;
    }
    if (typeof doc.name === 'string' && (doc.description || doc.parameters || doc.inputSchema)) {
      return [doc];
    }
  }
  return [];
}

// Translate one or more globs (rooted at cwd) into a flat file list.
// Supports literal paths plus simple "**/dir/file.json" globs.
async function expandGlobs(patterns) {
  const matches = new Set();
  for (const pattern of patterns) {
    // Plain path (no glob characters) → check it directly.
    if (!pattern.includes('*') && !pattern.includes('?')) {
      const abs = join(cwd, pattern);
      if (existsSync(abs)) matches.add(abs);
      continue;
    }
    for await (const file of walk(cwd, makeMatcher(pattern))) {
      matches.add(file);
    }
  }
  return [...matches];
}

function makeMatcher(pattern) {
  // Convert glob to regex. ** = any depth, * = any segment chars, ? = single char.
  const re =
    '^' +
    pattern
      .split('/')
      .map((seg) => {
        if (seg === '**') return '(?:.*)';
        return seg
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '[^/]*')
          .replace(/\?/g, '[^/]');
      })
      .join('/') +
    '$';
  const rx = new RegExp(re);
  return (relPath) => rx.test(relPath.split(sep).join('/'));
}

async function* walk(root, match) {
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        // Skip the usual noise.
        if (
          entry.name === 'node_modules' ||
          entry.name === '.git' ||
          entry.name === 'dist' ||
          entry.name === 'build'
        ) {
          continue;
        }
        stack.push(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith('.json')) continue;
      const rel = relative(root, abs);
      if (match(rel)) yield abs;
    }
  }
}

function setOutput(name, value) {
  const out = process.env.GITHUB_OUTPUT;
  if (!out) return;
  // Write key=value lines. For multi-line values, use a delimiter, but our
  // outputs here are scalars so the simple form is fine.
  return writeFile(out, `${name}=${value}\n`, { flag: 'a' });
}

async function main() {
  const files = await expandGlobs(globs);
  const fileResults = [];
  let totalTools = 0;
  let totalErrors = 0;
  let totalWarnings = 0;

  for (const abs of files.sort()) {
    const rel = relative(cwd, abs);
    let raw;
    try {
      raw = await readFile(abs, 'utf8');
    } catch (err) {
      console.error(`[agentvet] cannot read ${rel}: ${err.message}`);
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      const lint = {
        file: rel,
        index: -1,
        name: null,
        issues: [{ severity: 'error', code: 'E000', message: `invalid JSON: ${err.message}` }],
      };
      fileResults.push(lint);
      totalErrors += 1;
      console.error(`::error file=${rel}::invalid JSON: ${err.message}`);
      continue;
    }
    const tools = extractTools(parsed);
    if (tools.length === 0) continue;
    tools.forEach((tool, i) => {
      const lint = lintTool(tool, rel, i);
      fileResults.push(lint);
      totalTools += 1;
      for (const issue of lint.issues) {
        if (issue.severity === 'error') totalErrors += 1;
        if (issue.severity === 'warning') totalWarnings += 1;
        const annot = issue.severity === 'error' ? '::error' : '::warning';
        const id = lint.name ? lint.name : `tool[${i}]`;
        console.log(`${annot} file=${rel}::[${issue.code}] ${id}: ${issue.message}`);
      }
    });
  }

  const report = {
    summary: {
      total_tools: totalTools,
      errors: totalErrors,
      warnings: totalWarnings,
      files_scanned: files.length,
    },
    results: fileResults,
  };
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');

  await setOutput('total-tools', totalTools);
  await setOutput('errors', totalErrors);
  await setOutput('warnings', totalWarnings);
  await setOutput('report-path', reportPath);

  console.log(
    `[agentvet] ${totalTools} tools | ${totalErrors} error(s) | ${totalWarnings} warning(s) | report: ${reportPath}`,
  );

  if (failOn === 'error' && totalErrors > 0) process.exit(1);
  if (failOn === 'warning' && (totalErrors > 0 || totalWarnings > 0)) process.exit(1);
}

main().catch((err) => {
  console.error(`[agentvet] fatal: ${err.stack || err.message}`);
  process.exit(2);
});
