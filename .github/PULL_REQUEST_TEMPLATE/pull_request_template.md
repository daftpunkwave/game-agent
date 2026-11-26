<!--
Pull Request template. Adapt sections dynamically to match the actual scope of your changes:
- Omit "Related Issues" if there are no linked issues, PRs, or discussions.
- Omit optional sections ("Implementation Approach", "Notes for Reviewer", "Additional Context") for small, self-evident changes.
- Focus on Changed What & Why from a code/diff perspective so external reviewers can evaluate this PR independently.

Title format (Conventional Commits):
`<type>(<scope>): <imperative summary>`
Examples: `feat(bt): add shared plan board slot allocator`, `fix(gateway): preserve idempotency key across retries`
Common types: feat | fix | docs | refactor | perf | test | style | build | ci | chore | revert.
-->

## Related Issues

<!-- Optional. Use GitHub linking keywords (e.g. Fixes #123, Closes #45, Relates to #10). Omit this heading if none apply. -->

## Summary (What)

<!-- Briefly describe the scenario and concrete changes delivered in this PR. -->

## Motivation (Why)

<!-- Explain the technical motivation: defect fixed, missing capability, boundary gap, or architecture improvement. -->

## Implementation Approach (How)

<!-- Optional. Describe key architectural choices, modified contracts, and trade-offs from a code perspective. -->

## Testing & Verification

<!-- Record exact local commands executed, test counts, and gate results (e.g. `pnpm check`, `git diff --check`). -->

## Compatibility & Impact

<!-- Mandatory. State any breaking changes, public API/contract updates, or runtime/migration impacts. If none, explicitly state "No breaking changes" and explain why. -->

## Notes for Reviewer

<!-- Optional. Highlight non-obvious logic, boundary constraints, or areas needing extra scrutiny. -->

## PR Self-Review Checklist

- [ ] **Clean Diff**: Self-reviewed every changed line; removed debug logs, dead code, and leftover `TODO` markers.
- [ ] **Verified Locally**: Ran all applicable local checks and tests with zero failures.
- [ ] **Self-Contained**: Title and description explain the code changes clearly without relying on external private context or internal stage numbers.
- [ ] **Boundary Integrity**: Preserved single-direction dependencies and kept security/validation guards at core trust boundaries.

## Additional Context

<!-- Optional. External references, protocol specs, or follow-up constraints. Omit if none. -->
