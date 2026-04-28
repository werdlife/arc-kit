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
 *   - /arckit:health       ✅ handled here (replaces health-scan.mjs)
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

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isDir, readText, findRepoRoot, parseHookInput,
  extractRequirementIds,
} from './hook-utils.mjs';
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
    command: 'health',
    rawRe: /^\s*\/arckit[.:]+health\b/i,
    expandedRe: /description:\s*Scan all projects for stale|#\s*Artifact Health Check/i,
    opts: prompt => {
      const arg = parseProjectArg(prompt, 'health');
      return {
        excludeGlobal: true,
        withNodeMetadata: true,
        withContent: true,
        withExternals: true,
        ...(arg ? { projectFilter: arg } : {}),
      };
    },
    format: formatHealth,
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

// ── Health-rule helpers ────────────────────────────────────────────────────

function daysBetween(dateStr, baseline) {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return -1;
  return Math.floor((baseline.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
}

function extractAdrStatus(content, fields) {
  const status = fields['Status'] || '';
  const sectionMatch = content.match(/##\s*Status\s*\n+\s*(\w+)/i);
  const sectionStatus = sectionMatch ? sectionMatch[1] : '';
  if (/proposed/i.test(status) || /proposed/i.test(sectionStatus)) return 'Proposed';
  if (/accepted/i.test(status) || /accepted/i.test(sectionStatus)) return 'Accepted';
  if (/deprecated/i.test(status)) return 'Deprecated';
  if (/superseded/i.test(status)) return 'Superseded';
  return status || sectionStatus || 'Unknown';
}

function extractReviewVerdict(content) {
  if (/APPROVED\s+WITH\s+CONDITIONS/i.test(content)) return 'APPROVED WITH CONDITIONS';
  if (/\bREJECTED\b/i.test(content)) return 'REJECTED';
  if (/\bAPPROVED\b/i.test(content)) return 'APPROVED';
  if (/\bPENDING\b/i.test(content)) return 'PENDING';
  return null;
}

function extractConditions(content) {
  const m = content.match(/###?\s*(?:\d+\.?\d*\s+)?Conditions\s*\n([\s\S]*?)(?=\n###?\s|\n---|\n##\s|$)/i);
  if (!m) return [];
  const out = [];
  for (const line of m[1].split('\n')) {
    const t = line.trim();
    if (/^[-*]\s+/.test(t) || /^\d+\.\s+/.test(t)) {
      const text = t.replace(/^[-*]\s+/, '').replace(/^\d+\.\s+/, '').trim();
      if (text) out.push(text);
    }
  }
  return out;
}

const EXT_RECOMMEND = [
  { patterns: [/api/i, /swagger/i, /openapi/i], commands: '/arckit:requirements, /arckit:data-model, /arckit:diagram' },
  { patterns: [/schema/i, /erd/i, /\.sql$/i], commands: '/arckit:data-model, /arckit:data-mesh-contract' },
  { patterns: [/security/i, /pentest/i, /vuln/i], commands: '/arckit:secure, /arckit:dpia' },
  { patterns: [/compliance/i, /audit/i], commands: '/arckit:tcop, /arckit:conformance' },
  { patterns: [/cost/i, /pricing/i, /budget/i], commands: '/arckit:sobc, /arckit:finops' },
  { patterns: [/pipeline/i, /\bci\b/i, /deploy/i], commands: '/arckit:devops' },
  { patterns: [/rfp/i, /itt/i, /tender/i], commands: '/arckit:sow, /arckit:evaluate' },
  { patterns: [/risk/i, /threat/i], commands: '/arckit:risk, /arckit:secure' },
  { patterns: [/policy/i, /standard/i], commands: '/arckit:principles, /arckit:tcop' },
];

function recommendCommands(filename) {
  for (const { patterns, commands } of EXT_RECOMMEND) {
    if (patterns.some(p => p.test(filename))) return commands;
  }
  return '/arckit:requirements, /arckit:analyze';
}

const SEVERITY_ORDER = { HIGH: 3, MEDIUM: 2, LOW: 1 };

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

function formatHealth(graph, prompt, repoRoot) {
  const text = prompt.replace(/^\/arckit[.:]+health\s*/i, '');
  const severityArg = (text.match(/\bSEVERITY\s*=\s*(HIGH|MEDIUM|LOW)/i)?.[1] || 'LOW').toUpperCase();
  const sinceArg = text.match(/\bSINCE\s*=\s*(\d{4}-\d{2}-\d{2})/i)?.[1] || null;
  const projectArg = parseProjectArg(prompt, 'health');

  if (graph.projects.length === 0) return null;
  if (projectArg && graph.projects.length === 0) return null;

  const baseline = sinceArg ? new Date(sinceArg) : new Date();
  const minLevel = SEVERITY_ORDER[severityArg] || 1;

  const projectResults = [];

  for (const projectName of graph.projects) {
    const projectNodes = Object.values(graph.nodes).filter(n => n.project === projectName);
    const findings = [];

    // Group by docType for rule application
    const byType = {};
    for (const n of projectNodes) {
      if (!byType[n.type]) byType[n.type] = [];
      byType[n.type].push(n);
    }

    // Helper: pretty rel path
    const rel = n => {
      const filename = n.path.split('/').pop();
      return n.subdir ? `${n.subdir}/${filename}` : filename;
    };

    // Rule 1: STALE-RSCH
    for (const n of (byType['RSCH'] || [])) {
      const dateStr = n.lastModified || n.createdDate;
      if (!dateStr) continue;
      const age = daysBetween(dateStr, baseline);
      if (age > 180) {
        findings.push({
          severity: 'HIGH',
          rule: 'STALE-RSCH',
          file: rel(n),
          message: `Last modified: ${dateStr} (${age} days ago)`,
          action: 'Re-run /arckit:research to refresh pricing and vendor data',
        });
      }
    }

    // Rule 2: FORGOTTEN-ADR
    for (const n of (byType['ADR'] || [])) {
      const status = extractAdrStatus(n.content, n.controlFields);
      if (status !== 'Proposed') continue;
      const dateStr = n.createdDate || n.lastModified;
      if (!dateStr) continue;
      const age = daysBetween(dateStr, baseline);
      if (age > 30) {
        findings.push({
          severity: 'HIGH',
          rule: 'FORGOTTEN-ADR',
          file: rel(n),
          message: `Status: Proposed since ${dateStr} (${age} days without review)`,
          action: 'Schedule architecture review or accept/reject the decision',
        });
      }
    }

    // Rule 3: UNRESOLVED-COND
    for (const type of ['HLDR', 'DLDR']) {
      for (const n of (byType[type] || [])) {
        const verdict = extractReviewVerdict(n.content);
        if (verdict !== 'APPROVED WITH CONDITIONS') continue;
        const conditions = extractConditions(n.content);
        const lower = n.content.toLowerCase();
        const unresolved = conditions.filter(c => !lower.includes(c.toLowerCase()));
        if (unresolved.length === 0) continue;
        const condList = unresolved.map(c => `    - ${c}`).join('\n');
        findings.push({
          severity: 'HIGH',
          rule: 'UNRESOLVED-COND',
          file: rel(n),
          message: `Verdict: APPROVED WITH CONDITIONS\n  Unresolved conditions: ${unresolved.length}\n  Conditions:\n${condList}`,
          action: 'Address conditions and update review document, or schedule follow-up review',
        });
      }
    }

    // Rule 4: ORPHAN-REQ
    const reqMetas = byType['REQ'] || [];
    if (reqMetas.length > 0) {
      const adrReferenced = new Set();
      for (const n of (byType['ADR'] || [])) {
        for (const id of n.reqIds) adrReferenced.add(id);
      }
      for (const type of ['HLDR', 'DLDR', 'TRAC']) {
        for (const n of (byType[type] || [])) {
          for (const id of extractRequirementIds(n.content)) adrReferenced.add(id);
        }
      }
      for (const reqNode of reqMetas) {
        if (!reqNode.reqIds || reqNode.reqIds.length === 0) continue;
        const orphaned = reqNode.reqIds.filter(id => !adrReferenced.has(id));
        if (orphaned.length === 0) continue;
        const examples = orphaned.slice(0, 5).join(', ');
        const more = orphaned.length > 5 ? ` (+${orphaned.length - 5} more)` : '';
        findings.push({
          severity: 'MEDIUM',
          rule: 'ORPHAN-REQ',
          file: rel(reqNode),
          message: `Total requirements: ${reqNode.reqIds.length}\n  Requirements not referenced by any ADR: ${orphaned.length}\n  Examples: ${examples}${more}`,
          action: 'Review whether these requirements need architectural decisions documented as ADRs',
        });
      }
    }

    // Rule 5: MISSING-TRACE
    for (const n of (byType['ADR'] || [])) {
      if (n.reqIds && n.reqIds.length > 0) continue;
      if (/ARC-\d{3}-REQ/i.test(n.content)) continue;
      const titleMatch = n.content.match(/^#\s+(.+)/m);
      const title = titleMatch ? titleMatch[1].trim() : n.path.split('/').pop();
      findings.push({
        severity: 'MEDIUM',
        rule: 'MISSING-TRACE',
        file: rel(n),
        message: `ADR title: ${title}\n  Status: ${extractAdrStatus(n.content, n.controlFields) || 'Unknown'}`,
        action: 'Add requirement references to link this decision to specific requirements',
      });
    }

    // Rule 6: VERSION-DRIFT
    for (const [type, group] of Object.entries(byType)) {
      if (group.length < 2) continue;
      const sorted = [...group].sort((a, b) => parseFloat(b.version || '0') - parseFloat(a.version || '0'));
      const latest = sorted[0];
      const dateStr = latest.lastModified || latest.createdDate;
      if (!dateStr) continue;
      const age = daysBetween(dateStr, baseline);
      if (age > 90) {
        const versions = sorted.map(m => `v${m.version}`).join(', ');
        findings.push({
          severity: 'LOW',
          rule: 'VERSION-DRIFT',
          file: rel(latest),
          message: `Versions found: ${versions}\n  Latest version: ${rel(latest)} (last modified: ${dateStr}, ${age} days ago)`,
          action: 'Confirm the latest version is current, or archive superseded versions',
        });
      }
    }

    // Rule 7: STALE-EXT
    const externals = (graph.externalFiles || {})[projectName] || [];
    if (externals.length > 0) {
      let newestArtifactMtime = 0;
      for (const n of projectNodes) {
        if (typeof n.mtimeMs === 'number' && n.mtimeMs > newestArtifactMtime) {
          newestArtifactMtime = n.mtimeMs;
        }
      }
      const stale = [];
      for (const ext of externals) {
        if (ext.mtimeMs > newestArtifactMtime || newestArtifactMtime === 0) {
          stale.push({ filename: ext.filename, commands: recommendCommands(ext.filename) });
        }
      }
      if (stale.length > 0) {
        const fileList = stale.map(sf => `    - ${sf.filename} → Recommended: ${sf.commands}`).join('\n');
        findings.push({
          severity: 'HIGH',
          rule: 'STALE-EXT',
          file: projectName,
          message: `Unincorporated external files: ${stale.length}\n  Files:\n${fileList}`,
          action: 'Re-run recommended commands to incorporate external file content into architecture artifacts',
        });
      }
    }

    const filtered = findings.filter(f => (SEVERITY_ORDER[f.severity] || 0) >= minLevel);
    projectResults.push({
      projectId: projectName,
      artifactCount: projectNodes.length,
      findings: filtered,
    });
  }

  // Build JSON for docs/health.json
  const summary = { HIGH: 0, MEDIUM: 0, LOW: 0, total: 0 };
  const byTypeCounts = {
    'STALE-RSCH': 0, 'FORGOTTEN-ADR': 0, 'UNRESOLVED-COND': 0,
    'STALE-EXT': 0, 'ORPHAN-REQ': 0, 'MISSING-TRACE': 0, 'VERSION-DRIFT': 0,
  };
  let totalArtifacts = 0;
  const projectsJson = [];
  for (const pr of projectResults) {
    totalArtifacts += pr.artifactCount;
    const projEntry = { id: pr.projectId, artifacts: pr.artifactCount, findings: [] };
    for (const f of pr.findings) {
      summary[f.severity] = (summary[f.severity] || 0) + 1;
      summary.total++;
      byTypeCounts[f.rule] = (byTypeCounts[f.rule] || 0) + 1;
      projEntry.findings.push({ ...f });
    }
    projectsJson.push(projEntry);
  }

  const jsonData = {
    generated: baseline.toISOString(),
    scanned: { projects: projectResults.length, artifacts: totalArtifacts },
    summary,
    byType: byTypeCounts,
    projects: projectsJson,
  };

  // Write docs/health.json (preserve dashboard side effect)
  const docsDir = join(repoRoot, 'docs');
  if (!isDir(docsDir)) mkdirSync(docsDir, { recursive: true });
  writeFileSync(join(docsDir, 'health.json'), JSON.stringify(jsonData, null, 2), 'utf8');

  // additionalContext output
  const lines = [];
  lines.push('## Health Pre-processor Complete (hook)');
  lines.push('');
  lines.push('**All metadata extracted and rules applied. The command only needs to format the console output.**');
  lines.push('');
  lines.push('### Scan Parameters');
  lines.push(`- **Baseline date**: ${baseline.toISOString().split('T')[0]}`);
  lines.push(`- **Projects scanned**: ${jsonData.scanned.projects}`);
  lines.push(`- **Artifacts scanned**: ${jsonData.scanned.artifacts}`);
  lines.push(`- **Severity filter**: ${severityArg}`);
  if (projectArg) lines.push(`- **Project filter**: ${projectArg}`);
  lines.push(`- **JSON output**: docs/health.json written`);
  lines.push('');
  lines.push('### Summary');
  lines.push(`- **HIGH**: ${jsonData.summary.HIGH} findings`);
  lines.push(`- **MEDIUM**: ${jsonData.summary.MEDIUM} findings`);
  lines.push(`- **LOW**: ${jsonData.summary.LOW} findings`);
  lines.push(`- **TOTAL**: ${jsonData.summary.total} findings`);
  lines.push('');
  lines.push('### Findings by Type');
  for (const [rule, count] of Object.entries(jsonData.byType)) {
    lines.push(`- **${rule}**: ${count}`);
  }
  lines.push('');
  lines.push('### Per-Project Findings');
  lines.push('');
  for (const pr of projectResults) {
    lines.push(`#### PROJECT: ${pr.projectId}`);
    lines.push(`Artifacts scanned: ${pr.artifactCount}`);
    lines.push('');
    if (pr.findings.length === 0) {
      lines.push('No issues found.');
      lines.push('');
      continue;
    }
    for (const f of pr.findings) {
      lines.push(`[${f.severity}] ${f.rule}: ${f.file}`);
      for (const msgLine of f.message.split('\n')) lines.push(`  ${msgLine}`);
      lines.push(`  Action: ${f.action}`);
      lines.push('');
    }
  }
  lines.push('### What to do');
  lines.push('- **Skip Steps 1-3** — all metadata has been extracted and rules applied');
  lines.push('- **Format the Step 4 console output** using the findings above');
  lines.push('- **Include the Step 4.3 Recommended Actions** section using finding counts');
  lines.push('- **Step 5 JSON already written** — docs/health.json is complete');

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
const additionalContext = recipe.format(graph, prompt, repoRoot);

if (additionalContext == null) process.exit(0);

console.log(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'UserPromptSubmit',
    additionalContext,
  },
}));
