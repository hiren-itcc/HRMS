# ADR-001 — Form 24Q is generated as FVU input, not as a filed return

**Date:** 2026-08-12
**Status:** accepted
**Supersedes:** the "deliberately not here" note in `statutory-files.ts`

## Context

`statutory-files.ts` refused to produce Form 24Q, for two stated reasons:
a versioned NSDL format validated by a Java desktop tool that cannot run in
CI, and the asymmetry that a wrong return is *filed* and then needs a
correction statement rather than simply being rejected.

Both are true. What changed is the obligation: this system now runs real
payroll for a real employer, so the quarterly return is a legal duty under
s.234E and s.271H rather than a feature to be weighed.

## Decision

Generate the **input to the FVU**, not a filed return.

The real workflow is: text file -> Protean/NSDL File Validation Utility ->
`.fvu` -> upload. The Java tool is the operator's gate. We produce its input,
the screen states that the FVU must be run before filing, and no claim is made
that the output has been validated.

This answers both objections. The tool that cannot run in CI does not need to:
it runs on the operator's machine, as it does for every other payroll product.
And the correction-statement asymmetry is met by the FVU catching format
errors before anything is filed, plus a reconciliation gate that refuses to
generate at all when challans and payslips disagree.

## Consequences

- The record layout is transcribed from the published File Format
  specification into a table in `tds-files.ts`, with the spec version recorded
  beside it. It is not written from memory.
- Golden-file tests pin the output. They prove the builder is stable, not that
  a portal accepts it, and the screen says exactly that.
- Form 16 stays out of scope. Part A is issued by TRACES and is not ours to
  produce; Part B needs the annual tax engine deferred at `docs/11:89`.
