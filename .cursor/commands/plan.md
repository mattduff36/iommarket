# Plan Command

Use this template when starting a new feature, making significant changes, or when requirements are complex.

## How to Use

Copy this prompt and adapt it to your task:

---

**I need to implement: [describe feature/change]**

Before writing any code, please create an implementation plan:

1. **Restate Requirements** - Confirm your understanding of what needs to be built
2. **Architecture Review** - Analyze affected components and existing patterns
3. **Implementation Steps** - Break down into specific, actionable phases
4. **Risk Assessment** - Identify potential issues and dependencies
5. **Testing Strategy** - Outline how this will be tested

**WAIT for my confirmation before writing any code.**

---

## Expected Output

The response should include:

```markdown
# Implementation Plan: [Feature Name]

## Overview
[2-3 sentence summary]

## Requirements
- [Requirement 1]
- [Requirement 2]

## Architecture Changes
- [Change 1: file path and description]
- [Change 2: file path and description]

## Implementation Steps

### Phase 1: [Phase Name]
1. **[Step Name]** (File: path/to/file.ts)
   - Action: Specific action to take
   - Why: Reason for this step
   - Dependencies: None / Requires step X
   - Risk: Low/Medium/High

### Phase 2: [Phase Name]
...

## Testing Strategy
- Unit tests: [files to test]
- Integration tests: [flows to test]

## Risks & Mitigations
- **Risk**: [Description]
  - Mitigation: [How to address]

## Success Criteria
- [ ] Criterion 1
- [ ] Criterion 2
```

## When to Use

- Starting a new feature
- Making significant architectural changes
- Complex refactoring
- Multiple files/components will be affected
- Requirements are unclear or ambiguous

## After Planning

Once the plan is confirmed:
- Use `@.cursor/commands/tdd.md` to implement with tests
- Use `@.cursor/commands/code-review.md` to review completed work
