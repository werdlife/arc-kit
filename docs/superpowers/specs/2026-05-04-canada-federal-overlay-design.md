# Canada Federal Overlay Design

**Spec ID**: 2026-05-04-canada-federal-overlay
**Status**: DRAFT — pending user review
**Target release**: ArcKit v4.14.0 (community overlay)
**Author**: brainstormed by Claude with Mark Craddock, 2026-05-04

---

## 1. Summary

ArcKit gains a 12-command **Canada Federal Overlay**, shipped as a `[COMMUNITY]` overlay (matching the UAE post-v4.10.1 model, the FR/EU/AT precedents). The overlay is broad enough to be reusable across any federal Canadian project but is explicitly tuned so a FITAA-class application (`/arckit:ca-fitaa` flagship) exercises every command in the set as a coherent compliance run.

Coverage spans:

- **Foreign influence registration** — `ca-fitaa` (Bill C-70 / FITAA, June 2024)
- **Privacy and access** — `ca-pia`, `ca-atip`
- **Automated decision-making** — `ca-aia` (TBS Directive on ADM, Levels I–IV)
- **Security** — `ca-itsg-33` (CSE control profiles, categorisation), `ca-soia` (Security of Information Act handling for Secret/Top Secret)
- **Cloud and residency** — `ca-cloud-residency` (GC Cloud Adoption Strategy, sovereign options)
- **Bilingualism** — `ca-ola` (Official Languages Act Parts IV/V/VI)
- **Service standards** — `ca-gc-digital-standards` (10 GC Digital Standards conformance)
- **Procurement** — `ca-pspc` (Standing Offers, AgileIQ, PSAB 5% Indigenous target, CFTA/CETA)
- **Charter** — `ca-charter` (s.2 / s.7 / s.8 / s.15 design review per Oakes framing)
- **Indigenous data sovereignty** — `ca-ocap` (First Nations OCAP® principles, FNIGC alignment)

Each command produces a standard `ARC-NNN-{TYPE}-vN.N.md` artefact. Templates ship at `.arckit/templates/ca-*-template.md` with the standard `templates-custom/` override slot. No plugin `userConfig` changes are required in v1 — the existing `governance_framework` field gains a new recommended value `Canada Federal` documented in description text only (no JSON-schema change).

English-only Document Control headers in v1; bilingual EN/FR companion artefacts and provincial overlays (`qc-*`, `on-*`, `bc-*`) are explicit deferrals.

Total command count moves from **70 official + 34 community = 104** to **70 official + 46 community = 116** (12 new community commands across the Canada overlay). No test repo in v1.

---

## 2. Locked constraints

| Constraint | Decision | Set in |
|---|---|---|
| Scope tier | Approach 3: full Canada Federal overlay (12 commands) | Q1 |
| Classified handling | Included — `ca-soia` covers Secret / Top Secret | Q2 |
| `ca-ocap` in v1 | Yes, included | Q3 |
| Test repo in v1 | No | Q3 |
| Maintainership | `[COMMUNITY]` overlay, recruiting domain co-maintainer | Approaches |
| Bilingual artefacts | English-only v1; `-FR` artefact deferred | Approaches |
| Provincial overlays | Out of scope (Quebec Loi 25, BC PIPA, Ontario FIPPA deferred to sibling overlays) | Approaches |
| Statutory currency disclaimer | Mandatory in every command body — FITAA regulations still emerging, Commissioner office only spinning up | Approaches |

---

## 3. The 12 commands

Each command's frontmatter follows the existing community-overlay pattern: `description:` prefixed `[COMMUNITY]`, `argument-hint:`, `effort: high` (FITAA, PIA, AIA, ITSG-33, SOIA, Charter all benefit from deeper reasoning), `keep-coding-instructions: true` on long-synthesis commands (FITAA, PIA, ITSG-33, Charter), inline warning banner about statutory currency.

### Compliance and rights (5)

| # | Command | Type code | Category | Anchor | Handoffs |
|---|---|---|---|---|---|
| 1 | `ca-fitaa` | `FITAA` | Compliance | Foreign Influence Transparency and Accountability Act (Bill C-70, 2024); Commissioner of Foreign Influence Transparency | `ca-charter`, `ca-pia`, `ca-atip`, `ca-aia` |
| 2 | `ca-pia` | `PIA` | Compliance | Privacy Act; TBS Directive on Privacy Impact Assessment | `risk`, `ca-atip`, `ca-aia` |
| 3 | `ca-atip` | `ATIP` | Compliance | Access to Information Act; Privacy Act §4–§8 use/disclosure; severance under §13–§21 | `data-model`, `ca-pia` |
| 4 | `ca-aia` | `AIA` | Compliance | TBS Directive on Automated Decision-Making (Levels I–IV); Algorithmic Impact Assessment | `risk`, `adr`, `ca-pia` |
| 5 | `ca-charter` | `CHRT` | Governance | Canadian Charter of Rights and Freedoms (s.2 / s.7 / s.8 / s.15); Oakes test | `ca-fitaa`, `ca-pia`, `risk` |

### Security (2)

| # | Command | Type code | Category | Anchor | Handoffs |
|---|---|---|---|---|---|
| 6 | `ca-itsg-33` | `ITSG` | Architecture | CSE/Cyber Centre ITSG-33; TBS Standard on Security Categorization (Protected A/B/C, Secret, Top Secret) | `ca-cloud-residency`, `risk`, `adr` |
| 7 | `ca-soia` | `SOIA` | Compliance | Security of Information Act; Special Operational Information; CSIS Act §16/§19 coordination | `ca-itsg-33`, `risk`, `adr` |

### Architecture and operations (2)

| # | Command | Type code | Category | Anchor | Handoffs |
|---|---|---|---|---|---|
| 8 | `ca-cloud-residency` | `CRES` | Architecture | GC Cloud Adoption Strategy; Direction on the Secure Use of Commercial Cloud Services; sovereign options (AWS Canada, Azure Canada Central/East, GCP Canada) | `adr`, `ca-itsg-33` |
| 9 | `ca-gc-digital-standards` | `DIGSTD` | Governance | Government of Canada Digital Standards (10) | `service-assessment`, `roadmap` |

### Service obligations (1)

| # | Command | Type code | Category | Anchor | Handoffs |
|---|---|---|---|---|---|
| 10 | `ca-ola` | `OLA` | Compliance | Official Languages Act Parts IV (services), V (work environment), VI (federal language obligations); TBS Policy on Official Languages | `ca-gc-digital-standards`, `service-assessment` |

### Procurement (1)

| # | Command | Type code | Category | Anchor | Handoffs |
|---|---|---|---|---|---|
| 11 | `ca-pspc` | `PROC` | Procurement | PSPC Supply Manual; Standing Offers / AgileIQ; Procurement Strategy for Indigenous Business (PSAB 5%); CFTA/CETA thresholds | `evaluate`, `sobc` |

### Indigenous data sovereignty (1)

| # | Command | Type code | Category | Anchor | Handoffs |
|---|---|---|---|---|---|
| 12 | `ca-ocap` | `OCAP` | Governance | First Nations Principles of OCAP® (FNIGC); USAI/ITK considerations | `data-model`, `ca-pia`, `ca-atip` |

### Type code uniqueness

The 12 new type codes — `FITAA`, `PIA`, `ATIP`, `AIA`, `CHRT`, `ITSG`, `SOIA`, `CRES`, `DIGSTD`, `OLA`, `PROC`, `OCAP` — must be checked against existing codes before generation.

Known collisions to resolve at implementation time:

- **`PIA`** — generic, but no current overlay uses it. Safe.
- **`AIA`** — UAE overlay does not use it. Safe.
- **`ATIP`** — Canada-specific. Safe.
- **`PROC`** — generic. Verify against any existing baseline procurement type codes (`SOW` exists; `PROC` not currently used). Safe.
- **`CRES`** — UAE overlay uses `CRES` for `uae-cloud-residency`. **Collision.** Rename Canada to **`CACR`** (Canada Cloud Residency) or scope-prefix as **`CACRES`**. Decision in Phase A.
- **`DIGSTD`** — long but unambiguous. Acceptable.
- **`CHRT`** — Charter-specific. Safe.
- **`OCAP`** — FNIGC trademark; using as type code is descriptive, not branding. Safe but flag in command body.

A full collision audit against all 70 official + 34 existing community type codes runs as Phase A task A1.

---

## 4. Canonical execution chains

### Flow 1 — FITAA-class application

```
principles → requirements → ca-charter → ca-fitaa
  → ca-pia → ca-atip → ca-aia (if any ADM) → ca-ocap (if Indigenous data)
  → ca-itsg-33 → ca-soia (if classified leads in scope)
  → ca-cloud-residency → ca-ola
  → ca-gc-digital-standards → ca-pspc
  → adr (per material decision) → sobc → risk → framework
```

### Flow 2 — generic federal Canadian application

```
principles → requirements
  → ca-pia → ca-atip → ca-aia (if ADM) → ca-ocap (if Indigenous data)
  → ca-itsg-33 → ca-cloud-residency → ca-ola
  → ca-gc-digital-standards → ca-pspc
  → adr (per material decision) → sobc → risk → framework
```

`ca-fitaa`, `ca-soia`, `ca-charter`, and `ca-ocap` are conditional commands. `ca-charter` is unconditional for FITAA flows but optional for benign federal applications (e.g. internal scheduling tools).

---

## 5. Templates and Document Control

### Template files (12)

```
.arckit/templates/ca-fitaa-template.md
.arckit/templates/ca-pia-template.md
.arckit/templates/ca-atip-template.md
.arckit/templates/ca-aia-template.md
.arckit/templates/ca-charter-template.md
.arckit/templates/ca-itsg-33-template.md
.arckit/templates/ca-soia-template.md
.arckit/templates/ca-cloud-residency-template.md
.arckit/templates/ca-gc-digital-standards-template.md
.arckit/templates/ca-ola-template.md
.arckit/templates/ca-pspc-template.md
.arckit/templates/ca-ocap-template.md
```

Mirrored at `arckit-claude/templates/` (plugin source of truth).

### Document Control

Every Canada overlay artefact uses the standard ArcKit Document Control header (per `RENDERING.md` and `templates/_partials/`). No conditional federal-specific block in v1 — keeping the overlay as a clean drop-in. If a `Canada Federal` block becomes warranted (e.g. Department, Federal Identity Program ID, Protected categorisation), it can land in v2 as a `_partials/CA-FEDERAL-DC.md` partial without breaking v1 artefacts.

### Classification

The existing classification scheme line:

```
| Classification | PUBLIC / OFFICIAL / OFFICIAL-SENSITIVE / SECRET |
```

is **replaced** in `ca-*` artefacts with the Canadian scheme:

```
| Classification | UNCLASSIFIED / Protected A / Protected B / Protected C / CONFIDENTIAL / SECRET / TOP SECRET |
```

Implementation mirrors UAE overlay precedent: a per-command resolved string in the template, not a plugin-wide `userConfig` change. v1 ships scheme-by-template; if a future `classification_scheme: Canada` userConfig is wanted (matching UAE precedent) it can land in v2.

---

## 6. Statutory currency disclaimer

Every command body opens with a banner of the same shape used by FR and UAE overlays, customised for Canadian volatility:

```markdown
> ⚠️ **Community-contributed command** — not part of the officially-maintained ArcKit baseline.
> Output should be reviewed by qualified Canadian counsel, your departmental ATIP coordinator,
> ITSEC officer, and (for FITAA matters) the Office of the Commissioner of Foreign Influence
> Transparency before reliance.
>
> **Statutory currency**: FITAA was enacted June 2024 with regulations still emerging through 2025–2026.
> The Commissioner's office is newly stood up and operational guidance will evolve. Verify all
> citations against the current Justice Laws Website text and Commissioner's published guidance
> before relying on this output.
```

The banner is mandatory on `ca-fitaa`, `ca-soia`, `ca-aia`, `ca-charter`, and `ca-ocap`. The remaining seven commands carry the standard community banner without the FITAA-specific currency note.

---

## 7. Out of scope (v1)

| Item | Why deferred |
|---|---|
| Bilingual EN/FR companion artefacts | OLA review tells you *whether* you need bilingualism; we don't ship the FR templates yet. Plausible v2 add. |
| Quebec Loi 25 / OQLF (`qc-*`) | Federal entities are under Privacy Act, not Loi 25. Provincial sibling overlay if there's demand. |
| Ontario FIPPA / BC PIPA / Alberta PIPA (`on-*`, `bc-*`, `ab-*`) | Provincial sibling overlays. |
| Health-sector overlays (PHIPA, HIA) | Sectoral; out of scope for the federal overlay. |
| Departmental operational standards | Departmental — too specific for a federal overlay. Could become per-department sub-overlays if maintainers emerge. |
| CCSPA / Bill C-26 (Critical Cyber Systems Protection Act) | Targets telcos / banks / energy / transport — different scope from the federal overlay. Worth a `ca-ccspa` add later if demand emerges. |
| AIDA (Bill C-27) | Stalled with the Trudeau government dissolution; revisit when status clarifies. `ca-aia` covers the federal public-sector ADM angle today. |
| Test repo (e.g. a v49 Canada-federal exemplar) | Adds credibility but pads scope. Ship overlay first; test repo as follow-up if community traction warrants. |
| Plugin `userConfig` changes | Not required in v1. If a future `governance_framework: Canada Federal` + `classification_scheme: Canada` pair is wanted, mirror the UAE userConfig pattern in v2. |

---

## 8. Implementation phases (high-level)

Detailed plan to be produced by `writing-plans` after spec approval.

- **Phase A — design lock**: collision audit on type codes, finalise `CRES` rename, lock template skeletons.
- **Phase B — templates**: 12 templates with Document Control headers, classification block, statutory currency banner.
- **Phase C — commands**: 12 plugin command files at `arckit-claude/commands/ca-*.md` with `[COMMUNITY]` description tag, frontmatter, prompt body, handoffs.
- **Phase D — converter**: regenerate Codex / OpenCode / Gemini / Copilot extension formats via `python scripts/converter.py`.
- **Phase E — guides**: `docs/guides/ca-*.md` for each command, mirrored at `arckit-claude/guides/`.
- **Phase F — docs**: README command count update (104 → 116), Canada section, MEMORY.md versions topic, CHANGELOG, `docs/index.html` registry, `DEPENDENCY-MATRIX.md`.
- **Phase G — release**: bump version, regenerate, push, push-extensions, GitHub Release, `Help wanted: Canada domain co-maintainer` issue.

Manual verification (no automated test repo in v1):

- Run each `/arckit:ca-*` command against an existing test repo manually — Canada-specific test repo is the v2 follow-up.
- Validate Document Control rendering, handoff metadata, statutory banner presence, type code uniqueness on the produced artefacts.

---

## 9. Open questions for review

1. **`CRES` rename** — Canada uses `CACR` or `CACRES`? UAE has `CRES`. (Default proposal: `CACR`.)
2. **`ca-ocap` framing** — should the command explicitly require the architect to confirm an OCAP pre-engagement with FNIGC has been booked, rather than producing a self-declared OCAP register? My lean: yes, gate the artefact behind a confirmation question; OCAP is a relationship, not a checkbox.
3. **`ca-charter` for non-FITAA flows** — make it a recommended-but-conditional handoff (today's design), or always-required for any federal application that materially engages Charter rights? Default: recommended-but-conditional.
4. **Test repo follow-up** — registered as a tracked v2 deliverable, or open backlog? Default: tracked.

---

## 10. Acceptance criteria

- 12 `ca-*` commands present in `arckit-claude/commands/` with `[COMMUNITY]` description prefix.
- 12 templates present in `.arckit/templates/` and `arckit-claude/templates/`.
- 12 guides present in `docs/guides/` and `arckit-claude/guides/`.
- Converter runs cleanly and produces Codex / OpenCode / Gemini / Copilot equivalents with `[COMMUNITY]` preserved.
- README command count reads `70 official + 46 community = 116 total`.
- `Help wanted: Canada domain co-maintainer` issue opened.
- FITAA flow chain (Section 4, Flow 1) executes end-to-end against a smoke-test project without errors and produces all expected artefacts.

---

**Generated by**: brainstorming skill, 2026-05-04
**Spec author**: Claude with Mark Craddock
**Branch**: TBD (suggested: `feat/ca-overlay`)
