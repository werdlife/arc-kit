#!/usr/bin/env node
/**
 * End-to-end test for arckit-claude/hooks/graph-inject.mjs
 *
 * Spawns the hook as a subprocess with a fake UserPromptSubmit payload
 * and verifies the additionalContext output for each migrated command.
 *
 * Run with:  node tests/plugin/test_graph_inject.mjs
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');
const HOOK = join(repoRoot, 'arckit-claude', 'hooks', 'graph-inject.mjs');

// ── Fixture ────────────────────────────────────────────────────────────────

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'arckit-graph-inject-'));
  const projectsDir = join(root, 'projects');
  mkdirSync(join(projectsDir, '001-fixture'), { recursive: true });
  // findRepoRoot looks for projects/ — that's enough.

  const docCtl = (id, type) => `# ${type} — ${id}

| Field | Value |
|---|---|
| **Document ID** | ${id} |
| **Document Type** | ${type} |
| **Status** | DRAFT |
| **Version** | 1.0 |
| **Owner** | EA Team |
| **Classification** | OFFICIAL |

## Body

Body text for ${id} mentions BR-001.
`;

  writeFileSync(
    join(projectsDir, '001-fixture', 'ARC-001-REQ-v1.0.md'),
    docCtl('ARC-001-REQ-v1.0', 'REQ')
  );

  return { root, projectsDir };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function runHook(prompt, cwd) {
  const result = spawnSync('node', [HOOK], {
    input: JSON.stringify({ prompt, cwd }),
    encoding: 'utf8',
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

// ── Tests ──────────────────────────────────────────────────────────────────

test('graph-inject responds to /arckit:search', () => {
  const { root, projectsDir } = makeFixture();
  try {
    const { code, stdout, stderr } = runHook('/arckit:search BR-001', projectsDir);
    assert.equal(code, 0, `exit 0, stderr: ${stderr}`);
    assert.ok(stdout.length > 0, 'expected stdout output');

    const out = JSON.parse(stdout);
    assert.equal(out.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
    const ctx = out.hookSpecificOutput.additionalContext;
    assert.ok(ctx.includes('Search Pre-processor Complete'));
    assert.ok(ctx.includes('SEARCH INDEX (JSON)'));
    assert.ok(ctx.includes('ARC-001-REQ-v1.0'));
    assert.ok(ctx.includes('BR-001'));
    assert.ok(ctx.includes('User query:** BR-001'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('graph-inject also accepts the expanded body marker', () => {
  const { root, projectsDir } = makeFixture();
  try {
    const expandedBody = 'description: Search across all project artifacts and surface ranked matches';
    const { code, stdout } = runHook(expandedBody, projectsDir);
    assert.equal(code, 0);
    assert.ok(stdout.length > 0);
    const out = JSON.parse(stdout);
    assert.ok(out.hookSpecificOutput.additionalContext.includes('Search Pre-processor Complete'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('graph-inject is silent for non-matching prompts', () => {
  const { root, projectsDir } = makeFixture();
  try {
    const { code, stdout } = runHook('/arckit:requirements something else', projectsDir);
    assert.equal(code, 0);
    assert.equal(stdout, '', 'should produce no output for unmatched commands');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('graph-inject responds to /arckit:impact', () => {
  const { root, projectsDir } = makeFixture();
  try {
    const { code, stdout, stderr } = runHook('/arckit:impact ARC-001-REQ', projectsDir);
    assert.equal(code, 0, `exit 0, stderr: ${stderr}`);
    const out = JSON.parse(stdout);
    const ctx = out.hookSpecificOutput.additionalContext;
    assert.ok(ctx.includes('Impact Pre-processor Complete'));
    assert.ok(ctx.includes('DEPENDENCY GRAPH (JSON)'));
    assert.ok(ctx.includes('Impact Severity Classification'));
    assert.ok(ctx.includes('ARC-001-REQ'));

    // Critical: impact must NOT include v2 enrichments — node payload must
    // contain only v1 keys to keep the injected context lean.
    const jsonMatch = ctx.match(/```json\n([\s\S]+?)\n```/);
    assert.ok(jsonMatch, 'expected fenced JSON block');
    const parsed = JSON.parse(jsonMatch[1]);
    const v1Keys = ['type', 'project', 'path', 'title', 'status', 'severity',
                    'createdDate', 'lastModified'].sort();
    for (const [id, node] of Object.entries(parsed.nodes)) {
      assert.deepEqual(
        Object.keys(node).sort(), v1Keys,
        `node ${id} leaks v2 fields into impact context`
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('graph-inject is silent when projects/ dir does not exist', () => {
  const root = mkdtempSync(join(tmpdir(), 'arckit-empty-'));
  try {
    const { code, stdout } = runHook('/arckit:search foo', root);
    assert.equal(code, 0);
    assert.equal(stdout, '');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
