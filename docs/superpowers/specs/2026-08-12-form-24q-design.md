# Form 24Q and the TDS challan register

**Date:** 2026-08-12
**Status:** design approved, not yet planned
**Module:** `payroll` (additive — new tables, new controller, no ADR required)

---

## Why

This HRMS is going into real use at a small company, running real payroll and
deducting real TDS. That makes Form 24Q a legal obligation rather than a
feature: the quarterly return is due 31 July, 31 October, 31 January and 31 May,
and not filing costs ₹200 a day under s.234E plus a penalty under s.271H. The
next deadline after this design is **Q2 FY 2026-27, on 31 October 2026**. Those
dates should be confirmed with the company's own CA rather than taken from here.

`docs/15-feature-audit.md` already names statutory filing "the sharpest
commercial gap" and lists Form 24Q as absent. ECR and the ESIC contribution
return ship; the TDS side does not.

### Why this and not the tax engine

The audit's sharper observation is that **"monthly TDS is typed in per
employee"** — `EmployeeSalary.monthlyTds` (`schema.prisma:1035`), read at
`payroll-runs.service.ts:262`, pushed as a deduction at `payroll.calc.ts:256`.
Somebody is hand-calculating income tax.

Fixing *that* means a tax engine: investment declarations, annual projection,
old-versus-new regime. It is the larger prize and the right second step. It is
not the right first step, for three reasons:

1. **A return reports actuals.** Form 24Q states what was deducted and
   deposited, not what should have been. It does not depend on the engine.
2. **The engine reverses a recorded decision.** `packages/shared/src/schemas/settings.ts:60`
   says "TDS is deliberately absent: real TDS needs annual projection, a regime
   choice and investment proofs. It is entered per employee instead." Reversing
   that requires an ADR under `docs/11-roadmap.md:70`. This work does not.
3. **The engine has an unsolved seam.** It cannot write `EmployeeSalary.monthlyTds`
   — that table is effective-dated and gated by `payroll.salary.manage`, and
   Performance already refused the equivalent move on the grounds it would be
   "this module writing salary". Nor can it use the `PayrollAdjustment` seam
   Expenses uses, because TDS is *already* a component fed from `monthlyTds`, so
   an adjustment would double-count. That needs designing; this does not.

This work also **partially compensates** for the missing engine. See
Reconciliation below.

---

## Scope

### In

- A register of TDS challans deposited.
- A Form 24Q return file for a quarter, reporting deductee-wise TDS taken from
  payslips and mapped to those challans.
- A readiness gate that refuses before a quarter can be chosen, and reconciles
  challans against payslips.

### Out, deliberately

| Not built | Why |
|---|---|
| A tax engine | above |
| Form 16 | step C; Part A comes from TRACES, so only Part B could ever be produced here |
| Annexure II | the annual salary annexure filed with Q4 — it is Form 16 Part B's data. **Q4 is therefore only partially supported until step C lands.** Q4 stays selectable and the gate does not refuse it; the screen states plainly that the file omits Annexure II, so the limit is met before the download rather than at the portal |
| Correction / revised returns | a first return only |
| Portal upload | nothing here has ever been accepted by a portal |
| A stored "filed" state | no portal tells the system a return was accepted, so claiming it would be a lie the database keeps |
| Multiple challans per month | see the uniqueness constraint below |

---

## Data model

Two new tables and one new enum. Zero `ALTER TABLE` against any pre-existing
table, zero `DROP`, zero `ALTER COLUMN`. `Organization` and `User` gain relation
arrays, which emit no DDL — the same note the Helpdesk migration carries.

### Why not reuse `StatutoryFiling`

It exists, it already freezes generated content, and it is the obvious
candidate. It does not fit:

```prisma
/// `YYYY-MM`, matching PayrollRun.month.
period         String
runId          String          // required
```

Form 24Q is **quarterly and spans three payroll runs**. Fitting it here means
making `runId` nullable for ECR and ESIC too, dissolving an invariant those two
currently rely on — and that is editing an existing module's internals, which
needs an ADR.

The precedent is recorded in `docs/11-roadmap.md`: *"Settlement needed no ADR —
a separate entity edits no existing module... Had it been built as a kind of
`PayrollRun`, as first recommended, it would have needed one."* A quarterly TDS
return is not a kind of monthly `StatutoryFiling`.

### `TdsChallan`

The deposit register — the one genuinely missing input. Nothing in the codebase
records a BSR code, challan serial or deposit date today.

| Field | Type | Note |
|---|---|---|
| `organizationId` | String | scoped like everything else |
| `period` | String | `YYYY-MM`, the payroll month deposited — same contract as `StatutoryFiling.period` |
| `bsrCode` | String(7) | |
| `challanSerial` | String(5) | |
| `depositDate` | DateTime | |
| `sectionCode` | String | `92B`, non-government salary |
| `minorHead` | String | `200`, regular payment |
| `tds` `surcharge` `educationCess` `interest` `fee` `penalty` `others` | Decimal(14,2) | `fee` is the s.234E line |
| `createdAt` `createdById` | | |

`@@unique([organizationId, period])` — **one challan per month.**

That constraint is load-bearing, not laziness. Form 24Q requires every deductee
row to name its challan. With one challan per month the mapping is derivable and
unambiguous; with several it becomes an allocation screen. One deposit per month
is how a small company actually operates. A month deposited in two tranches is a
stated v1 limit.

### `TdsReturn`

Mirrors `StatutoryFiling`'s frozen-content design, which is already proven.

| Field | Note |
|---|---|
| `organizationId` | |
| `financialYear` | `2026-27` |
| `quarter` | `TdsQuarter { Q1 Q2 Q3 Q4 }` |
| `content` | the file exactly as generated — never rebuilt |
| `rowCount` `excludedCount` | |
| `detail` | Json — the exclusions themselves and the totals the portal will check |
| `generatedAt` `generatedById` | |

`@@unique([organizationId, financialYear, quarter])`

`excludedCount` is carried over deliberately. Its comment on `StatutoryFiling`
reads *"a short file nobody noticed is the failure this whole design is arranged
to prevent."* For a 24Q the equivalent is an employee with no PAN — which is not
merely a short file, it is what forces deduction at 20% and what the portal
rejects on.

---

## Permissions

**No new permission code.** `payroll.filing` already exists and already covers
"generating a statutory return"; challan management folds into it. Its own
comment states the intent: *"HR and Finance both hold it — whichever of them
files is a question this product should not answer."* Verified: it appears in
`HR_PERMS` (`permissions.ts:456`) and `FINANCE_PERMS` (`permissions.ts:478`).

A consequence worth stating plainly: **both HR and Finance can now write the
challan register.** That is consistent with the existing grant, not an
expansion of who can file.

Because no permission is added, the migration seeds no permission rows — so
this cannot repeat the Expenses omission that left its sidebar entry invisible.

---

## The file

Form 24Q is filed as a delimited text file validated by Protean/NSDL's FVU,
built from File Header, Batch Header, Challan Detail and Deductee Detail
records.

**The exact field ordering and count per record type must be taken from the
current published File Format specification, not written from memory.** That
layout is version-specific and changes between FVU releases. `build24Q` is
written against the spec and pinned with golden-file tests, exactly as
`buildEcr` and `buildEsicReturn` are pinned in `statutory-files.spec.ts`.

The screen carries the same admission the filings screen already makes: no file
this repo emits has been accepted by a portal, and a golden-file test is not the
same thing as a successful upload.

---

## Reconciliation — the part that earns the feature

The readiness gate refuses **before a quarter can be chosen**, never at download
time, following the existing `StatutoryFilingsService.readiness()` pattern.

**Three hard refusals:**

| Check | Refuses because |
|---|---|
| TAN, deductor PAN, signatory missing | already modelled in `statutorySchema` (`settings.ts:393`); a return without them is unusable, not short |
| A month in the quarter has TDS deducted but no challan recorded | you cannot file a return for money you have no record of depositing |
| **Challan total ≠ payslip TDS total for that month** | see below |

The third is why this ships before the tax engine. It cannot compute the correct
TDS, but every quarter it will state that the figure someone typed into
`monthlyTds` and the figure actually deposited disagree, and by how much — which
today nothing in the system would notice. It is a partial, cheap answer to the
hand-entry problem.

On any of these the screen **refuses and shows the difference**. It does not
generate a return with a warning attached.

**One warning that must not refuse:**

An employee with TDS in the quarter and no PAN (`Employee.pan` is nullable,
`schema.prisma:310`) is surfaced prominently and must be acknowledged before
generating — but it does **not** block. A 24Q can legitimately be filed for a
deductee whose PAN is unavailable, and refusing would stop the company meeting a
statutory deadline over a data-quality problem. Blocking here would be this
design causing the exact harm it exists to prevent.

How such a deductee is represented in the file — a `PANNOTAVBL`-style marker
rather than an omission — comes from the File Format specification along with
the rest of the layout, and is not written from memory. Whichever it is, the
count and the names appear on screen and in `detail`.

---

## Surface

### API — a new `TdsController`

`payroll.controller.ts` is already 384 lines. A second `@Controller('payroll')`
avoids growing it; paths do not collide, and `payroll.module.ts` gains one line
in its `controllers` array — the same additive shape `app.module.ts` took for
`HelpdeskModule`.

```
GET|POST         payroll/challans           ?period=
PATCH|DELETE     payroll/challans/:id
GET              payroll/returns            ?fy=
GET              payroll/returns/readiness  ?fy=&quarter=
GET              payroll/returns/preview    ?fy=&quarter=
POST             payroll/returns
GET              payroll/returns/:id/file
DELETE           payroll/returns/:id
```

Literal segments declared before `:id`, per the discipline recorded at
`payroll.controller.ts:267` — *"Declared before `reports/:kind` so 'filings' is
never read as a report."*

### Web — inside the existing Returns tab

`/payroll/filings` is already labelled **Returns** in the payroll tab bar
(`(dashboard)/payroll/layout.tsx:37`), which already carries seven tabs. No new
top-level entry. Three panes:

- `/payroll/filings` — monthly ECR/ESIC, unchanged
- `/payroll/filings/challans` — the register
- `/payroll/filings/24q` — readiness → preview → generate → download

---

## Testing

- **`tds-files.spec.ts`** — golden files for `build24Q`, mirroring
  `statutory-files.spec.ts`.
- **`tds-reconcile.spec.ts`** — pure function, no Prisma and no clock: challan
  totals against payslip TDS totals per month, including the sign of the
  difference. Plus a grep asserting the file contains no `new Date()`, as
  `helpdesk.rules.spec.ts` does.
- **readiness spec** — one case per refusal, each asserting the *message*. The
  whole design is that nobody discovers a problem at download time, so the
  wording is the feature.
- **service spec** — org scoping, 404-not-403 on an unreadable row, and that a
  generated return is served from stored `content` and never rebuilt.
- **`rbac.e2e-spec.ts`** — a `describe('tds')` asserting on **rows, not status
  codes**. A `where` that silently became `{}` passes a status check and leaks
  the company; that is the trap the helpdesk block was written to catch.

---

## Sequencing

This is step A of three. B and C are separate specs.

| | Scope | Depends on | ADR |
|---|---|---|---|
| **A. Form 24Q + challan register** | this spec | nothing | no |
| **B. TDS engine** — 12BB, projection, regime | new module, 3–4 tables | nothing, but makes A's numbers right | **yes** |
| **C. Form 16 Part B** | builder + issue | A and B | no |

---

## Found while designing, not fixed here

Two live defects surfaced during exploration. Both matter more now that real
payroll runs through this, and neither belongs in this spec.

1. **PF/ESI/PT rates have no UI.** `settings.ts:95–120` defines them and
   `PATCH /settings` accepts them, but the preferences page never calls
   `set('payroll', …)` — grepping `employeeRate|wageCeiling|professionalTax`
   across `apps/web/src` returns zero hits. Every organization runs on the
   hardcoded defaults, and **the default PT slabs are Karnataka-shaped**. For a
   company in another state, professional tax is being deducted at the wrong
   rate right now. `payroll.statutory.ts`'s own header claims "a rate change
   should be an edit rather than a release." It is not.
2. **Pay components have no UI.** `payroll.controller.ts` exposes only
   `@Get('components')`. A custom allowance requires a script or a direct
   database write.

Neither corrupts a 24Q — professional tax is a state tax, not TDS — but both
are payroll correctness issues for a real employer.
