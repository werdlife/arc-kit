#!/usr/bin/env node
/**
 * Validate a JSON payload against a JSON Schema 2020-12 file.
 *
 * Usage: node validate-handoff.mjs <schema.json> <payload.json>
 *
 * Exit 0 on success: prints the validated payload as JSON on stdout.
 * Exit 1 on failure: prints {ok:false, errors:[{path,msg}]} on stdout.
 *
 * Used by arckit-claude/agents/arckit-datascout.md (the orchestrator)
 * to validate output from arckit-datascout-reader before scoring.
 */

import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { readFileSync } from 'node:fs';

const [, , schemaPath, payloadPath] = process.argv;

if (!schemaPath || !payloadPath) {
  console.log(JSON.stringify({
    ok: false,
    errors: [{ path: '/', msg: 'Usage: validate-handoff.mjs <schema.json> <payload.json>' }]
  }));
  process.exit(1);
}

let schema, payload;
try {
  schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
} catch (e) {
  console.log(JSON.stringify({
    ok: false,
    errors: [{ path: '/', msg: `failed to read schema: ${e.message}` }]
  }));
  process.exit(1);
}

try {
  payload = JSON.parse(readFileSync(payloadPath, 'utf8'));
} catch (e) {
  console.log(JSON.stringify({
    ok: false,
    errors: [{ path: '/', msg: `failed to parse payload: ${e.message}` }]
  }));
  process.exit(1);
}

const ajv = new Ajv({ allErrors: true, strict: true });
addFormats(ajv);

let validate;
try {
  validate = ajv.compile(schema);
} catch (e) {
  console.log(JSON.stringify({
    ok: false,
    errors: [{ path: '/', msg: `schema compilation failed: ${e.message}` }]
  }));
  process.exit(1);
}

if (validate(payload)) {
  console.log(JSON.stringify(payload));
  process.exit(0);
}

const errors = validate.errors.map(e => ({
  path: e.instancePath || '/',
  msg: `${e.message}${e.params ? ' ' + JSON.stringify(e.params) : ''}`
}));
console.log(JSON.stringify({ ok: false, errors }, null, 2));
process.exit(1);
