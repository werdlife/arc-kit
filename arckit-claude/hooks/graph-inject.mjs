#!/usr/bin/env node
/**
 * ArcKit Graph Injection Hook
 *
 * Single UserPromptSubmit hook that builds the artifact graph (via
 * graph-utils.mjs) and injects per-command additionalContext for the
 * scan-driven slash commands.
 *
 * Migration progress (#162):
 *   - /arckit:search       ✅ handled here (replaces search-scan.mjs)
 *   - /arckit:impact       ✅ handled here (replaces impact-scan.mjs)
 *   - /arckit:health       ⏳ still served by health-scan.mjs
 *   - /arckit:traceability ⏳ still served by traceability-scan.mjs
 *   - /arckit:analyze      ⏳ still served by governance-scan.mjs
 *
 * Hook Type: UserPromptSubmit (sync)
 * Input  (stdin):  JSON with prompt, cwd, etc.
 * Output (stdout): JSON with hookSpecificOutput.additionalContext
 */

import { join } from 'node:path';
import { isDir, findRepoRoot, parseHookInput } from './hook-utils.mjs';
import { scanAllArtifacts } from './graph-utils.mjs';

// ── Recipe table ───────────────────────────────────────────────────────────

const RECIPES = [
  {
    command: 'search',
    rawRe: /^\s*\/arckit[.:]+search\b/i,
    expandedRe: /description:\s*Search across all project artifacts/i,
    opts: { withNodeMetadata: true, withPreview: true },
    format: formatSearch,
  },
  {
    command: 'impact',
    rawRe: /^\s*\/arckit[.:]+impact\b/i,
    expandedRe: /description:\s*Analyse the blast radius/i,
    // Keep node payload lean — impact serializes the entire nodes object
    // into the prompt context, so v1 fields only.
    opts: {},
    format: formatImpact,
  },
];

function matchRecipe(prompt) {
  for (const r of RECIPES) {
    if (r.rawRe.test(prompt) || r.expandedRe.test(prompt)) return r;
  }
  return null;
}

// ── Formatters ─────────────────────────────────────────────────────────────

function formatSearch(graph, prompt) {
  const text = prompt.replace(/^\/arckit[.:]+search\s*/i, '').trim();

  // search expected an array; flatten nodes into the same record shape it had.
  const records = Object.entries(graph.nodes).map(([fullId, n]) => ({
    filename: fullId + '.md',
    relPath: n.subdir ? `${n.subdir}/${fullId}.md` : `${fullId}.md`,
    project: n.project,
    docType: n.type,
    version: n.version,
    title: n.title,
    status: n.status,
    owner: n.owner,
    reqIds: n.reqIds,
    preview: n.preview,
    controlFields: Object.entries(n.controlFields)
      .map(([k, v]) => `${k}: ${v}`)
      .join('; '),
  }));

  const lines = [];
  lines.push('## Search Pre-processor Complete (hook)');
  lines.push('');
  lines.push(`**Indexed ${records.length} artifacts across ${graph.projects.length} project(s).**`);
  lines.push('');
  lines.push(`**User query:** ${text || '(no query provided)'}`);
  lines.push('');
  lines.push('### SEARCH INDEX (JSON)');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify(records, null, 2));
  lines.push('```');
  lines.push('');
  lines.push('### Instructions');
  lines.push('- Parse the query for keywords, --type=XXX, --project=NNN, --id=XX-NNN filters');
  lines.push('- Score results: title match=10, control fields=5, preview=3, filename=2');
  lines.push('- Output ranked table with top result preview');
  lines.push('- If no results, suggest broadening the search');

  return lines.join('\n');
}

function formatImpact(graph, prompt) {
  const text = prompt.replace(/^\/arckit[.:]+impact\s*/i, '').trim();
  const { nodes, edges, reqIndex, projects } = graph;
  const nodeCount = Object.keys(nodes).length;
  const edgeCount = edges.length;
  const reqCount = Object.keys(reqIndex).length;

  const lines = [];
  lines.push('## Impact Pre-processor Complete (hook)');
  lines.push('');
  lines.push(`**Dependency graph built: ${nodeCount} documents, ${edgeCount} cross-references, ${reqCount} requirement IDs across ${projects.length} project(s).**`);
  lines.push('');
  lines.push(`**User query:** ${text || '(no query provided)'}`);
  lines.push('');
  lines.push('### DEPENDENCY GRAPH (JSON)');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify({ nodes, edges, reqIndex }, null, 2));
  lines.push('```');
  lines.push('');
  lines.push('### Impact Severity Classification');
  lines.push('| Category | Severity | Document Types |');
  lines.push('|----------|----------|---------------|');
  lines.push('| Compliance/Governance | HIGH | TCOP, SECD, DPIA, SVCASS, RISK, TRAC, CONF |');
  lines.push('| Architecture | MEDIUM | HLDR, DLDR, ADR, DATA, DIAG, PLAT |');
  lines.push('| Planning/Reporting | LOW | PLAN, ROAD, BKLG, SOBC, OPS, STORY, PRES |');
  lines.push('');
  lines.push('### Instructions');
  lines.push('- Parse query: ARC document ID, requirement ID (e.g. BR-003), or type+project');
  lines.push('- Perform reverse traversal through edges (max depth 5)');
  lines.push('- Classify impact severity using node severity field');
  lines.push('- Output impact chain table, summary counts, and recommended actions');
  lines.push('- Suggest specific /arckit commands to re-run for HIGH severity impacts');

  return lines.join('\n');
}

// ── Main ──────────────────────────────────────────────────────────────────

const data = parseHookInput();
const prompt = data.prompt || '';
const recipe = matchRecipe(prompt);
if (!recipe) process.exit(0);

const cwd = data.cwd || process.cwd();
const repoRoot = findRepoRoot(cwd);
if (!repoRoot) process.exit(0);

const projectsDir = join(repoRoot, 'projects');
if (!isDir(projectsDir)) process.exit(0);

const graph = scanAllArtifacts(projectsDir, recipe.opts);
const additionalContext = recipe.format(graph, prompt);

console.log(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'UserPromptSubmit',
    additionalContext,
  },
}));
