import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatcher, extractTools, hasInputSchema, lintTool } from '../lint.mjs';

test('makeMatcher: **/ matches zero leading directories (root-level files)', () => {
  // Regression: the default globs (e.g. **/mcp.json) must match a file that
  // sits at the repo root, not only files nested under a directory.
  assert.equal(makeMatcher('**/mcp.json')('mcp.json'), true);
  assert.equal(makeMatcher('**/.mcp.json')('.mcp.json'), true);
  assert.equal(makeMatcher('**/tools/*.json')('tools/search.json'), true);
});

test('makeMatcher: **/ also matches nested directories', () => {
  assert.equal(makeMatcher('**/mcp.json')('a/b/mcp.json'), true);
  assert.equal(makeMatcher('**/tools/*.json')('pkg/src/tools/search.json'), true);
});

test('makeMatcher: * does not cross path separators', () => {
  assert.equal(makeMatcher('tools/*.json')('tools/a.json'), true);
  assert.equal(makeMatcher('tools/*.json')('tools/sub/a.json'), false);
  assert.equal(makeMatcher('**/tools/*.json')('tools/sub/a.json'), false);
});

test('makeMatcher: middle ** matches zero or more segments', () => {
  const m = makeMatcher('fixtures/good/**/*.json');
  assert.equal(m('fixtures/good/tools/list.json'), true);
  assert.equal(m('fixtures/good/direct.json'), true);
  assert.equal(m('fixtures/bad/x.json'), false);
});

test('makeMatcher: ? matches a single non-separator char', () => {
  const m = makeMatcher('tool?.json');
  assert.equal(m('tool1.json'), true);
  assert.equal(m('tool12.json'), false);
  assert.equal(m('tool/.json'), false);
});

test('extractTools: bare array', () => {
  const tools = extractTools([{ name: 'a' }, { name: 'b' }]);
  assert.equal(tools.length, 2);
});

test('extractTools: { tools: [...] }', () => {
  assert.equal(extractTools({ tools: [{ name: 'a' }] }).length, 1);
});

test('extractTools: MCP-style mcpServers', () => {
  const doc = {
    mcpServers: {
      one: { tools: [{ name: 'a' }, { name: 'b' }] },
      two: { tools: [{ name: 'c' }] },
      three: {},
    },
  };
  assert.equal(extractTools(doc).length, 3);
});

test('extractTools: single tool object', () => {
  assert.equal(extractTools({ name: 'solo', description: 'a tool' }).length, 1);
  assert.equal(extractTools({ name: 'solo', parameters: {} }).length, 1);
});

test('extractTools: unrecognized shapes yield no tools', () => {
  assert.deepEqual(extractTools({ foo: 'bar' }), []);
  assert.deepEqual(extractTools(null), []);
  assert.deepEqual(extractTools(42), []);
});

test('hasInputSchema: accepts all three schema keys', () => {
  assert.equal(hasInputSchema({ inputSchema: {} }), true);
  assert.equal(hasInputSchema({ input_schema: {} }), true);
  assert.equal(hasInputSchema({ parameters: {} }), true);
  assert.equal(!!hasInputSchema({}), false);
});

test('lintTool: clean tool has no issues', () => {
  const res = lintTool(
    {
      name: 'search_documents',
      description: 'Search the document library by full-text query.',
      inputSchema: { type: 'object' },
    },
    'tools/search.json',
    0,
  );
  assert.deepEqual(res.issues, []);
  assert.equal(res.name, 'search_documents');
});

test('lintTool: E001 when name or description missing', () => {
  const noName = lintTool({ description: 'has no name' }, 'f.json', 0);
  assert.ok(noName.issues.some((i) => i.code === 'E001'));

  const noDesc = lintTool({ name: 'missing_desc' }, 'f.json', 1);
  assert.ok(noDesc.issues.some((i) => i.code === 'E001'));
});

test('lintTool: E002 when name is not snake_case', () => {
  const res = lintTool(
    { name: 'BadCamelCase', description: 'camel name here' },
    'f.json',
    0,
  );
  assert.ok(res.issues.some((i) => i.code === 'E002'));
});

test('lintTool: E002 not reported when name absent (avoids double error)', () => {
  const res = lintTool({ description: 'no name field' }, 'f.json', 0);
  assert.ok(!res.issues.some((i) => i.code === 'E002'));
});

test('lintTool: W001 for short description', () => {
  const res = lintTool(
    { name: 'ok_name', description: 'short', inputSchema: {} },
    'f.json',
    0,
  );
  assert.ok(res.issues.some((i) => i.code === 'W001'));
});

test('lintTool: W002 when no schema of any kind present', () => {
  const res = lintTool(
    { name: 'ok_name', description: 'a sufficiently long description' },
    'f.json',
    0,
  );
  assert.ok(res.issues.some((i) => i.code === 'W002'));
});
