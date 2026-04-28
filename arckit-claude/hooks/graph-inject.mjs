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
 *   - /arckit:traceability ✅ handled here (replaces traceability-scan.mjs)
 *   - /arckit:health       ⏳ still served by health-scan.mjs
 *   - /arckit:analyze      ⏳ still served by governance-scan.mjs
 *
 * Hook Type: UserPromptSubmit (sync)
 * Input  (stdin):  JSON with prompt, cwd, etc.
 * Output (stdout): JSON with hookSpecificOutput.additionalContext
 *
 * Recipe shape:
 *   command:    short name (for logging/clarity)
 *   rawRe:      pattern that matches a raw "/arckit:cmd ..." prompt
 *   expandedRe: pattern that matches the Skill-tool expanded body
 *   opts:       static graph opts OR (prompt) => opts
 *   format:     (graph, prompt) => string | null  (null = exit silently)
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDir, readText, findRepoRoot, parseHookInput } from './hook-utils.mjs';
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
  {
    command: 'traceability',
    rawRe: /^\s*\/arckit[.:]+traceability\b/i,
    expandedRe: /description:\s*Generate requirements traceability/i,
    opts: prompt => {
      const arg = parseProjectArg(prompt, 'traceability');
      return {
        excludeGlobal: true,
        withRequirements: true,
        withVendors: true,
        ...(arg ? { projectFilter: arg } : {}),
      };
    },
    format: formatTraceability,
  },
];

function matchRecipe(prompt) {
  for (const r of RECIPES) {
    if (r.rawRe.test(prompt) || r.expandedRe.test(prompt)) return r;
  }
  return null;
}

// ── Shared helpers ─────────────────────────────────────────────────────────

function parseProjectArg(prompt, command) {
  const text = prompt.replace(new RegExp(`^/arckit[.:]+${command}\\s*`, 'i'), '');
  const projectMatch = text.match(/\bPROJECT\s*=\s*(\S+)/i);
  if (projectMatch) return projectMatch[1];
  const numMatch = text.match(/\b(\d{3})\b/);
  if (numMatch) return numMatch[1];
  return null;
}

function readArckitVersion() {
  const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
  return readText(join(pluginRoot, 'VERSION'))?.trim() || 'unknown';
}

function pct(covered, total) {
  if (total === 0) return '0%';
  return `${Math.round((covered / total) * 100)}%`;
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

function formatTraceability(graph, prompt) {
  const arg = parseProjectArg(prompt, 'traceability');

  if (graph.projects.length === 0) return null;
  if (graph.projects.length > 1 && !arg) return null;

  const projectName = graph.projects[0];
  const requirements = (graph.requirements || {})[projectName] || [];
  if (requirements.length === 0) return null;

  // Build refMap: reqId → [{ file, type, vendor }]
  // Source: every non-REQ node in this project whose reqIds list cites the ID.
  const DESIGN_TYPES = new Set(['ADR', 'HLD', 'DLD', 'HLDR', 'DLDR']);
  const refMap = {};
  const projectNodes = Object.values(graph.nodes).filter(n => n.project === projectName);

  for (const n of projectNodes) {
    if (n.type === 'REQ') continue;
    if (!Array.isArray(n.reqIds) || n.reqIds.length === 0) continue;

    let label = n.type;
    if (DESIGN_TYPES.has(n.type) && n.vendor && (n.type === 'HLD' || n.type === 'DLD')) {
      label = `Vendor ${n.type}`;
    } else if (!DESIGN_TYPES.has(n.type) && n.vendor) {
      label = 'Vendor Doc';
    }

    const filename = n.path.split('/').pop();
    const rel = n.subdir ? `${n.subdir}/${filename}` : filename;

    for (const id of n.reqIds) {
      if (!refMap[id]) refMap[id] = [];
      refMap[id].push({ file: rel, type: label, vendor: n.vendor });
    }
  }

  // Coverage
  const reqIdSet = new Set(requirements.map(r => r.id));
  const coverage = {
    total: requirements.length,
    covered: 0,
    orphan: [],
    designOnly: [],
    byCategory: {},
    byPriority: {},
  };
  const prefixMap = { Business: 'BR', Functional: 'FR', 'Non-Functional': 'NFR', Integration: 'INT', Data: 'DR' };

  for (const req of requirements) {
    const isCovered = !!(refMap[req.id] && refMap[req.id].length > 0);
    if (isCovered) coverage.covered++;
    else coverage.orphan.push(req);

    if (!coverage.byCategory[req.category]) {
      coverage.byCategory[req.category] = { total: 0, covered: 0, prefix: prefixMap[req.category] || req.category };
    }
    coverage.byCategory[req.category].total++;
    if (isCovered) coverage.byCategory[req.category].covered++;

    if (!coverage.byPriority[req.priority]) {
      coverage.byPriority[req.priority] = { total: 0, covered: 0 };
    }
    coverage.byPriority[req.priority].total++;
    if (isCovered) coverage.byPriority[req.priority].covered++;
  }

  for (const id of Object.keys(refMap)) {
    if (!reqIdSet.has(id)) coverage.designOnly.push({ id, refs: refMap[id] });
  }

  // Doc stats — derived from project nodes
  const adrs = projectNodes
    .filter(n => n.type === 'ADR')
    .map(n => `decisions/${n.path.split('/').pop()}`);

  const vendorEntries = (graph.vendors || {})[projectName] || [];
  const vendorDocsMap = {};
  let totalVendorDocs = 0;
  for (const v of vendorEntries) {
    if (v.docs.length > 0) {
      vendorDocsMap[v.name] = v.docs;
      totalVendorDocs += v.docs.length;
    }
  }

  const reviews = projectNodes
    .filter(n => n.type === 'HLDR' || n.type === 'DLDR')
    .map(n => {
      const filename = n.path.split('/').pop();
      return n.subdir ? `${n.subdir}/${filename}` : filename;
    });

  // Existing TRAC version
  const tracVersions = projectNodes
    .filter(n => n.type === 'TRAC' && n.path.endsWith('.md'))
    .map(n => {
      const m = n.path.match(/-v([\d.]+)\.md$/);
      return m ? m[1] : null;
    })
    .filter(Boolean)
    .sort((a, b) => parseFloat(b) - parseFloat(a));
  const existingVersion = tracVersions[0] || null;
  const suggestedVersion = (() => {
    if (!existingVersion) return '1.0';
    const [maj, min = '0'] = existingVersion.split('.');
    return `${parseInt(maj, 10)}.${parseInt(min, 10) + 1}`;
  })();

  const reqFiles = [...new Set(requirements.map(r => r.sourceFile))];

  // Output
  const lines = [];
  lines.push('## Traceability Pre-processor Complete (hook)');
  lines.push('');
  lines.push('**All requirement IDs extracted and cross-referenced.**');
  lines.push('');
  lines.push('### Project');
  lines.push(`- **Project**: ${projectName}`);
  lines.push(`- **ArcKit Version**: ${readArckitVersion()}`);
  lines.push(`- **REQ files scanned**: ${reqFiles.join(', ')}`);
  lines.push(`- **Existing TRAC version**: ${existingVersion || 'none'}`);
  lines.push(`- **Suggested next version**: v${suggestedVersion}`);
  lines.push('');

  lines.push('### REQUIREMENTS — use these directly to build the matrix');
  lines.push('');
  lines.push('| Req ID | Category | Priority | Description | Covered | Referenced By |');
  lines.push('|--------|----------|----------|-------------|---------|---------------|');
  for (const req of requirements) {
    const refs = refMap[req.id];
    const isCovered = refs && refs.length > 0;
    const refList = isCovered ? refs.map(r => r.file).join(', ') : '—';
    const desc = req.description.length > 80 ? req.description.substring(0, 77) + '...' : req.description;
    lines.push(`| ${req.id} | ${req.category} | ${req.priority} | ${desc} | ${isCovered ? 'Yes' : 'No'} | ${refList} |`);
  }
  lines.push('');

  lines.push('### COVERAGE SUMMARY');
  lines.push('');
  lines.push('| Metric | Covered | Total | Pct |');
  lines.push('|--------|---------|-------|-----|');
  lines.push(`| Overall | ${coverage.covered} | ${coverage.total} | ${pct(coverage.covered, coverage.total)} |`);

  for (const cat of ['Business', 'Functional', 'Non-Functional', 'Integration', 'Data']) {
    const c = coverage.byCategory[cat];
    if (!c) continue;
    lines.push(`| ${cat} (${c.prefix}) | ${c.covered} | ${c.total} | ${pct(c.covered, c.total)} |`);
  }
  for (const pri of ['MUST', 'SHOULD', 'MAY']) {
    const p = coverage.byPriority[pri];
    if (!p) continue;
    lines.push(`| ${pri} priority | ${p.covered} | ${p.total} | ${pct(p.covered, p.total)} |`);
  }
  lines.push('');

  if (coverage.orphan.length > 0) {
    lines.push('### Orphan Requirements (no design coverage)');
    lines.push('');
    for (const req of coverage.orphan) lines.push(`- ${req.id}: ${req.description}`);
    lines.push('');
  }

  if (coverage.designOnly.length > 0) {
    lines.push('### Design-Only References (not in REQ — scope creep?)');
    lines.push('');
    for (const e of coverage.designOnly) {
      const files = e.refs.map(r => r.file).join(', ');
      lines.push(`- ${e.id} referenced in ${files}`);
    }
    lines.push('');
  }

  lines.push('### Design Documents Scanned');
  lines.push('');
  lines.push(`- ADRs: ${adrs.length}${adrs.length > 0 ? ` (${adrs.join(', ')})` : ''}`);
  const vendorListEntries = Object.entries(vendorDocsMap);
  if (vendorListEntries.length > 0) {
    const vendorList = vendorListEntries.map(([v, files]) => `${v}: ${files.join(', ')}`).join('; ');
    lines.push(`- Vendor docs: ${totalVendorDocs} (${vendorList})`);
  } else {
    lines.push('- Vendor docs: 0');
  }
  lines.push(`- Reviews: ${reviews.length}${reviews.length > 0 ? ` (${reviews.join(', ')})` : ''}`);
  lines.push('');

  lines.push('### What to do');
  lines.push('- **Use the requirements table and coverage data** to build the traceability matrix');
  lines.push('- **Still read vendor HLD/DLD** if you need component names for design mapping columns');
  lines.push('- **Still read the template** for formatting');
  lines.push('- **Write outputs** per the command instructions');

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

const opts = typeof recipe.opts === 'function' ? recipe.opts(prompt) : recipe.opts;
const graph = scanAllArtifacts(projectsDir, opts);
const additionalContext = recipe.format(graph, prompt);

if (additionalContext == null) process.exit(0);

console.log(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'UserPromptSubmit',
    additionalContext,
  },
}));
