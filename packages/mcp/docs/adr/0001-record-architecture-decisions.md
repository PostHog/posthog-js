# ADR-0001: Record architecture decisions

- Status: Accepted
- Date: 2026-08-06

## Context

`@posthog/mcp` accumulates design decisions quickly — session identity has already crossed two MCP protocol revisions (2025-11-25 and 2026-07-28), and the reasoning behind each choice was living in two lossy places: long inline comment essays that drift and duplicate, and PR descriptions that nobody re-reads. `ARCHITECTURE.md` kept absorbing rationale too, growing into a mix of "what is" and "why it became so".

## Decision

We record architecturally significant decisions as Architecture Decision Records in `docs/adr/`, using the lightweight Nygard format: Status, Context, Decision, Consequences (plus References for PRs/issues).

Conventions:

- One decision per record, numbered sequentially (`NNNN-short-title.md`).
- ADRs are immutable once accepted. Reversing or amending a decision gets a **new** ADR; the old one's Status becomes `Superseded by ADR-NNNN`.
- `docs/ARCHITECTURE.md` stays the source of truth for the **current state** of the system. A PR that changes an architectural decision ships the ADR and the (small) ARCHITECTURE.md diff together.
- Inline comments state the constraint and point at the ADR for the full story, instead of retelling it.

## Consequences

- Recall is cheap: "why does `$session_id` come from a hash?" is answered by one file with the trade-offs preserved, including the options we rejected.
- Comments shrink: rationale lives in exactly one place, so the same fact is no longer retold in three files that drift independently.
- Writing an ADR is a forcing function on new decisions — if the Context/Consequences are hard to write, the decision isn't understood yet.
- ADRs 0002–0004 are backfilled from merged work; from here on, records are written as decisions are made.
