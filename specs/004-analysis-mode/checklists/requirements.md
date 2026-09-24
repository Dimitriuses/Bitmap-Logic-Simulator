# Specification Quality Checklist: Analysis Mode

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-09-24
**Feature**: [spec.md](../spec.md)

## Content Quality

- [X] No implementation details (languages, frameworks, APIs)
- [X] Focused on user value and business needs
- [X] Written for non-technical stakeholders
- [X] All mandatory sections completed

## Requirement Completeness

- [X] No [NEEDS CLARIFICATION] markers remain
- [X] Requirements are testable and unambiguous
- [X] Success criteria are measurable
- [X] Success criteria are technology-agnostic (no implementation details)
- [X] All acceptance scenarios are defined
- [X] Edge cases are identified
- [X] Scope is clearly bounded
- [X] Dependencies and assumptions identified

## Feature Readiness

- [X] All functional requirements have clear acceptance criteria
- [X] User scenarios cover primary flows
- [X] Feature meets measurable outcomes defined in Success Criteria
- [X] No implementation details leak into specification

## Notes

Two rounds of revision were applied. Remaining items, stated rather than hidden:

1. **FR-010 was not testable and has been rewritten.** It previously read "MUST be able to host
   further tools without each one changing how the mode itself works" — a design intention, not
   a checkable behaviour. It now names the three things that must not change (mode switching,
   key handling, selection behaviour), which the feature itself demonstrates by adding several
   tools to the mode. This checklist item is consequently now passing.

2. **SC-004 needs a human, not a harness.** "A user can find a specific named signal in a
   200-gate schematic within 15 seconds" is a genuine usability target and is deliberately kept,
   but it cannot be automated alongside the rest. It should be measured once, by hand, rather
   than quietly dropped.

3. **Five decisions are settled**, two from the initial spec and three from the clarification
   session, all recorded under `## Clarifications` with their reasoning:
   - the schematic occupies the **main stage**, switched against the pixel view (FR-017);
   - labels live in a **sidecar `*.labels.json`** with a browser working copy (FR-024–024c) —
     this **supersedes** the earlier browser-only decision, after testing showed PNG text
     metadata is silently dropped by an ordinary re-save, which is how circuits in this project
     are routinely edited;
   - clock candidates are found by **both** a behavioural and a structural signal, ranked with
     reasons, and the leading candidate is visually distinguished (FR-033–033e);
   - the schematic offers a **recognised** gate view over a **faithful** one, with every
     recognised symbol verified before it is drawn (FR-011–011d);
   - power-on state is decided by **20 cold starts**, reported as sampling rather than proof
     (FR-029a–029b).

4. **Two items were defaulted without asking**, because a defensible answer existed and a
   question would have bought nothing: what counts as a storage element (FR-027a — a feedback
   group with more than one rest state, so that a loop which always settles is not called
   memory), and the cold-start count (20, with the reasoning written into Assumptions).

5. **US4's power-on requirements (FR-028 to FR-031) are the sharpest part of this spec** and the
   most likely to be under-built, because they contradict a comfortable result: the existing
   oracle reports these circuits as healthy. The acceptance scenario naming the 4-bit CPU's
   six-inverter loop (SC-007) exists specifically so that "it passes" cannot be claimed without
   reproducing the known failure.
