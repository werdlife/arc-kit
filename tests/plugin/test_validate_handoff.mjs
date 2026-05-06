#!/usr/bin/env node
/**
 * Tests for arckit-claude/scripts/validate-handoff.mjs
 *
 * Each fixture in tests/plugin/fixtures/datascout-handoff/ is run through
 * the validator. valid-* fixtures must pass (exit 0, output equals input).
 * invalid-* and injection-* fixtures must fail (exit 1, output is
 * {ok:false, errors:[{path, msg}]}).
 *
 * Run: node tests/plugin/test_validate_handoff.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');
const validator = resolve(repoRoot, 'arckit-claude/scripts/validate-handoff.mjs');
const schema = resolve(repoRoot, 'arckit-claude/schemas/datascout-handoff.schema.json');
const fixturesDir = resolve(__dirname, 'fixtures/datascout-handoff');

function runValidator(payloadPath) {
  return spawnSync('node', [validator, schema, payloadPath], { encoding: 'utf8' });
}

test('valid-uk-gov.json passes validation', () => {
  const payloadPath = resolve(fixturesDir, 'valid-uk-gov.json');
  const result = runValidator(payloadPath);
  assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
  const parsed = JSON.parse(result.stdout);
  const original = JSON.parse(readFileSync(payloadPath, 'utf8'));
  assert.deepEqual(parsed, original, 'validator should echo the validated payload');
});
