#!/usr/bin/env node
/**
 * End-to-end test for arckit-claude/hooks/graph-inject.mjs
 *
 * Spawns the hook as a subprocess with a fake UserPromptSubmit payload
 * and verifies the additionalContext output for each migrated command.
 *
 * Run with:  node tests/plugin/test_graph_inject.mjs
 */

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, utimesSync } from 'node:fs';
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

test('graph-inject responds to /arckit:traceability', () => {
  const { root, projectsDir } = makeFixture();
  try {
    const { code, stdout, stderr } = runHook('/arckit:traceability 001', projectsDir);
    assert.equal(code, 0, `exit 0, stderr: ${stderr}`);
    assert.ok(stdout.length > 0, 'expected stdout output');
    const out = JSON.parse(stdout);
    const ctx = out.hookSpecificOutput.additionalContext;

    assert.ok(ctx.includes('Traceability Pre-processor Complete'));
    assert.ok(ctx.includes('001-fixture'));
    assert.ok(ctx.includes('REQUIREMENTS — use these directly'));
    assert.ok(ctx.includes('BR-001'));
    assert.ok(ctx.includes('COVERAGE SUMMARY'));
    assert.ok(ctx.includes('Design Documents Scanned'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('graph-inject traceability is silent on ambiguous project', () => {
  // Two projects, no project arg → exit silently.
  const { root, projectsDir } = makeFixture();
  try {
    mkdirSync(join(projectsDir, '002-other'), { recursive: true });
    writeFileSync(
      join(projectsDir, '002-other', 'ARC-002-REQ-v1.0.md'),
      `# REQ — ARC-002-REQ-v1.0\n\n| Field | Value |\n|---|---|\n| **Document ID** | ARC-002-REQ-v1.0 |\n\n### BR-001: Other project\n`
    );
    const { code, stdout } = runHook('/arckit:traceability', projectsDir);
    assert.equal(code, 0);
    assert.equal(stdout, '', 'should exit silently when project is ambiguous');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('graph-inject traceability is silent when no requirements exist', () => {
  // Make a fixture without REQ docs.
  const root = mkdtempSync(join(tmpdir(), 'arckit-no-req-'));
  const projectsDir = join(root, 'projects');
  mkdirSync(join(projectsDir, '001-empty', 'decisions'), { recursive: true });
  try {
    const { code, stdout } = runHook('/arckit:traceability 001', projectsDir);
    assert.equal(code, 0);
    assert.equal(stdout, '', 'should exit silently when no REQs found');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('graph-inject responds to /arckit:health and writes docs/health.json', () => {
  // Build a fixture that triggers FORGOTTEN-ADR (Proposed > 30 days old)
  const root = mkdtempSync(join(tmpdir(), 'arckit-health-'));
  const projectsDir = join(root, 'projects');
  const projectDir = join(projectsDir, '001-fixture');
  mkdirSync(join(projectDir, 'decisions'), { recursive: true });

  writeFileSync(
    join(projectDir, 'ARC-001-REQ-v1.0.md'),
    `# REQ — ARC-001-REQ-v1.0

| Field | Value |
|---|---|
| **Document ID** | ARC-001-REQ-v1.0 |
| **Document Type** | REQ |
| **Status** | DRAFT |
| **Created Date** | 2025-01-01 |
| **Last Modified** | 2025-01-15 |

### BR-001: Test requirement
`
  );

  // ADR with Status=Proposed and an old created date → triggers FORGOTTEN-ADR
  const proposedAdrPath = join(projectDir, 'decisions', 'ARC-001-ADR-001-v1.0.md');
  writeFileSync(
    proposedAdrPath,
    `# ADR — ARC-001-ADR-001-v1.0

| Field | Value |
|---|---|
| **Document ID** | ARC-001-ADR-001-v1.0 |
| **Document Type** | ADR |
| **Status** | Proposed |
| **Created Date** | 2025-01-01 |
| **Last Modified** | 2025-01-01 |

## Status

Proposed

References BR-001.
`
  );

  try {
    const { code, stdout, stderr } = runHook('/arckit:health 001', root);
    assert.equal(code, 0, `exit 0, stderr: ${stderr}`);
    const out = JSON.parse(stdout);
    const ctx = out.hookSpecificOutput.additionalContext;

    assert.ok(ctx.includes('Health Pre-processor Complete'));
    assert.ok(ctx.includes('Per-Project Findings'));
    assert.ok(ctx.includes('FORGOTTEN-ADR'), 'should emit a FORGOTTEN-ADR finding');
    assert.ok(ctx.includes('PROJECT: 001-fixture'));

    // docs/health.json side-effect
    const healthJson = join(root, 'docs', 'health.json');
    assert.ok(existsSync(healthJson), 'docs/health.json should be written');
    const parsed = JSON.parse(readFileSync(healthJson, 'utf8'));
    assert.equal(parsed.scanned.projects, 1);
    assert.ok(parsed.byType['FORGOTTEN-ADR'] >= 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('graph-inject responds to /arckit:analyze', () => {
  // Build a richer fixture that has everything analyze cares about:
  // global PRIN, vendor with reviews, RISK doc, REQ.
  const root = mkdtempSync(join(tmpdir(), 'arckit-analyze-'));
  const projectsDir = join(root, 'projects');
  const projectDir = join(projectsDir, '001-fixture');
  mkdirSync(join(projectDir, 'vendors', 'acme', 'reviews'), { recursive: true });
  mkdirSync(join(projectsDir, '000-global'), { recursive: true });

  const docCtl = (id, type, fields = {}) => `# ${type} — ${id}

| Field | Value |
|---|---|
| **Document ID** | ${id} |
| **Document Type** | ${type} |
| **Status** | ${fields.Status || 'DRAFT'} |
| **Version** | 1.0 |
| **Owner** | ${fields.Owner || 'EA Team'} |
| **Classification** | ${fields.Classification || 'OFFICIAL'} |

## Body
`;

  writeFileSync(
    join(projectDir, 'ARC-001-REQ-v1.0.md'),
    docCtl('ARC-001-REQ-v1.0', 'REQ') +
      `### BR-001: Test requirement\n\n| Priority | MUST |\n`
  );
  writeFileSync(
    join(projectDir, 'ARC-001-RISK-v1.0.md'),
    docCtl('ARC-001-RISK-v1.0', 'RISK') +
      `### Risk R-001: Vendor lock-in\n\n` +
      `**Category**: Strategic\n\n` +
      `**Inherent**: High\n\n` +
      `**Residual**: Medium\n\n` +
      `**Owner**: EA Team\n\n` +
      `**Status**: Open\n\n` +
      `**Response**: Mitigate\n`
  );
  writeFileSync(
    join(projectDir, 'vendors', 'acme', 'ARC-001-HLD-v1.0.md'),
    docCtl('ARC-001-HLD-v1.0', 'HLD')
  );
  writeFileSync(
    join(projectDir, 'vendors', 'acme', 'reviews', 'ARC-001-HLDR-001-v1.0.md'),
    docCtl('ARC-001-HLDR-001-v1.0', 'HLDR') + 'Verdict: APPROVED\n'
  );
  writeFileSync(
    join(projectsDir, '000-global', 'ARC-000-PRIN-v1.0.md'),
    docCtl('ARC-000-PRIN-v1.0', 'PRIN') +
      `## 1. Security Principles\n\n### 1. Least privilege\n\n**Principle Statement**: only grant minimum access.\n`
  );

  try {
    const { code, stdout, stderr } = runHook('/arckit:analyze 001', projectsDir);
    assert.equal(code, 0, `exit 0, stderr: ${stderr}`);
    const out = JSON.parse(stdout);
    const ctx = out.hookSpecificOutput.additionalContext;

    assert.ok(ctx.includes('Governance Scan Pre-processor Complete'));
    assert.ok(ctx.includes('### Scan Parameters'));
    assert.ok(ctx.includes('### Artifact Inventory'));
    assert.ok(ctx.includes('### Compliance Artifact Presence'));
    assert.ok(ctx.includes('### Requirements Inventory'));
    assert.ok(ctx.includes('BR-001'));
    assert.ok(ctx.includes('### Principles'));
    assert.ok(ctx.includes('Least privilege'));
    assert.ok(ctx.includes('### Risks'));
    assert.ok(ctx.includes('### Vendor Inventory'));
    assert.ok(ctx.includes('acme'));
    assert.ok(ctx.includes('Rule 1 — Hook tables are primary data'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('graph-inject analyze is silent on ambiguous project', () => {
  const { root, projectsDir } = makeFixture();
  try {
    mkdirSync(join(projectsDir, '002-second'), { recursive: true });
    writeFileSync(
      join(projectsDir, '002-second', 'ARC-002-REQ-v1.0.md'),
      `# REQ\n\n| Field | Value |\n|---|---|\n| **Document ID** | ARC-002-REQ-v1.0 |\n`
    );
    const { code, stdout } = runHook('/arckit:analyze', projectsDir);
    assert.equal(code, 0);
    assert.equal(stdout, '', 'should exit silently when ambiguous');
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
