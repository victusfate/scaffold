## Mode

**Auto-fix** (called from the chain): Apply fixes to `design.md` directly, then continue without pausing.

**Review** (called standalone): Present findings as annotated comments or a proposed diff against `design.md`. Wait for user approval before making any changes.

Detect mode from context: if triggered automatically as part of feature-chain or grill-with-docs, use auto-fix. If the user invoked this skill directly, use review mode.

## Checklist

**Abstractions** — Do proposed modules earn their place? Flag thin wrappers and indirection that adds no clarity.

**Canonical vocabulary** — Is every term defined precisely? Flag overloaded terms, synonyms for the same concept, and concepts without a vocabulary entry.

**Bounded logic** — Is each concern cleanly isolated? Flag a single concern split across multiple unrelated layers.

**Type discipline** — Are proposed interfaces explicit? Flag loose contracts and unnecessary optionality.

**Simplicity** — Is the simplest design that solves the problem on the table? Flag over-engineering and unnecessary structure.

## Blockers

Resolve before proceeding to PRD:
- Modules that exist only to wrap or delegate
- Terms used inconsistently or without a vocabulary definition
- A concern split across layers without justification
- Loose contracts where explicit types would work
- Visible simpler design left on the table
