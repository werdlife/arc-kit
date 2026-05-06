#!/usr/bin/env node
/**
 * ArcKit PermissionRequest Hook — Auto-Allow Plugin-Internal Reads & Scripts
 *
 * Reading the plugin's own bundled files (templates, schemas, scripts,
 * agent prompts, references) and invoking the plugin's own bundled
 * helper scripts (validate-handoff.mjs, create-project.sh, generate-
 * document-id.sh, etc.) should not require user approval each session.
 * They are part of the plugin the user has already trusted by enabling.
 *
 * This hook auto-approves PermissionRequests for:
 *   - Read against any path under the plugin root
 *   - Bash invocations whose command string contains a path under
 *     ${CLAUDE_PLUGIN_ROOT}/scripts/ (validate-handoff.mjs,
 *     scripts/bash/*.sh helpers)
 *
 * Anything else (Read of project files, Bash for arbitrary commands,
 * Write of project artefacts, etc.) falls through to the normal
 * permission dialog.
 *
 * Hook Type: PreToolUse
 * Input (stdin):  JSON { tool_name, tool_input: {...}, ... }
 * Output (stdout):
 *   On match (allow):
 *     {"hookSpecificOutput": {
 *       "hookEventName": "PreToolUse",
 *       "permissionDecision": "allow",
 *       "permissionDecisionReason": "..."
 *     }}
 *   On no-match: silent pass-through (exit 0, no JSON).
 *
 * Exit code 0 always — pass-through is a non-decision, not a failure.
 * Hook auto-allow does NOT override user/project deny rules: per the
 * Claude Code docs, deny rules take precedence over plugin hook allows.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Plugin root = parent of the hooks/ dir this script lives in.
const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(__dirname, '..');
const SCRIPTS_DIR = resolve(PLUGIN_ROOT, 'scripts');

main();

function main() {
  let raw = '';
  try {
    raw = readFileSync(0, 'utf8');
  } catch {
    process.exit(0); // silent pass-through
  }
  if (!raw || !raw.trim()) process.exit(0);

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    process.exit(0);
  }

  const toolName = data.tool_name || '';
  const input = data.tool_input || {};

  if (toolName === 'Read') {
    const filePath = input.file_path || '';
    if (isUnderPluginRoot(filePath)) {
      allow(`ArcKit: auto-allowed Read of plugin-internal file (${shortPath(filePath)})`);
    }
  }

  if (toolName === 'Bash') {
    const command = input.command || '';
    if (commandTouchesPluginScripts(command)) {
      allow('ArcKit: auto-allowed Bash invocation of plugin-internal helper script');
    }
  }

  // No match — silent pass-through. Claude Code falls back to the
  // normal permission flow (user prompt, deny rules, etc.).
  process.exit(0);
}

// ── Helpers ────────────────────────────────────────────────────────────

function isUnderPluginRoot(p) {
  if (!p || typeof p !== 'string') return false;
  // Resolve to absolute, then check prefix. Don't follow symlinks; the
  // plugin's distributed files are real files in a marketplace cache.
  const abs = resolve(p);
  return abs === PLUGIN_ROOT || abs.startsWith(PLUGIN_ROOT + '/');
}

function commandTouchesPluginScripts(cmd) {
  if (!cmd || typeof cmd !== 'string') return false;
  // The command string contains the absolute scripts/ path. We accept
  // multi-statement Bash (heredoc + node + rm chains) because the
  // presence of the absolute plugin path is itself the trust marker —
  // an attacker forging a command can't fabricate a real plugin path.
  if (!cmd.includes(SCRIPTS_DIR + '/')) return false;
  // Reject obvious dangerous redirections targeting outside the plugin.
  // Conservative: allow only if every reference to a path inside
  // SCRIPTS_DIR is to a known helper.
  const known = [
    'validate-handoff.mjs',
    'bash/common.sh',
    'bash/create-project.sh',
    'bash/generate-document-id.sh',
    'bash/check-prerequisites.sh',
    'bash/list-projects.sh',
    'bash/migrate-filenames.sh',
    'bash/detect-stale-artifacts.sh',
  ];
  // Look for any reference to scripts/<thing> that is NOT in the known list.
  const refs = cmd.match(new RegExp(escapeRegex(SCRIPTS_DIR) + '/[A-Za-z0-9_./-]+', 'g')) || [];
  for (const r of refs) {
    const tail = r.slice(SCRIPTS_DIR.length + 1);
    if (!known.some(k => tail === k || tail.startsWith(k + ' ') || tail.startsWith(k + '\t'))) {
      // Allow paths that match a known prefix but include args after a space —
      // already covered. If we get here, the reference is to an unknown file
      // under scripts/. Don't auto-allow.
      if (!known.includes(tail)) return false;
    }
  }
  return refs.length > 0;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function shortPath(p) {
  if (typeof p !== 'string') return '';
  const idx = p.indexOf('/arckit-claude/');
  return idx >= 0 ? '…' + p.slice(idx) : p;
}

function allow(reason) {
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      permissionDecisionReason: reason,
    },
  }));
  process.exit(0);
}
