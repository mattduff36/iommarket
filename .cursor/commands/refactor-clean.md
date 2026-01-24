# Refactor & Clean Command

Use this template to safely identify and remove dead code.

## How to Use

Copy this prompt for code cleanup:

---

**Please analyze this codebase for dead code and cleanup opportunities.**

1. **Run Detection** - Find unused code, exports, dependencies
2. **Categorize by Risk**:
   - SAFE: Unused utilities, old components
   - CAUTION: API routes, shared components
   - DANGER: Config files, entry points
3. **Propose Safe Deletions** - Only items with zero references
4. **Verify Before Delete** - Run tests after each removal
5. **Document Changes** - Track what was removed and why

**Start with SAFE items only. Get my approval before removing anything marked CAUTION.**

---

## Detection Commands

```bash
# Find unused exports/files/dependencies (if knip installed)
npx knip

# Check unused dependencies
npx depcheck

# Find unused TypeScript exports
npx ts-prune

# ESLint unused detection
npx eslint . --report-unused-disable-directives
```

## Common Cleanup Patterns

### Unused Imports
```typescript
// REMOVE: unused imports
import { useState, useEffect, useMemo } from 'react' // Only useState used

// KEEP: only what's used
import { useState } from 'react'
```

### Dead Code Branches
```typescript
// REMOVE: unreachable code
if (false) {
  doSomething()
}

// REMOVE: unused functions
export function unusedHelper() {
  // No references in codebase
}
```

### Duplicate Components
```typescript
// CONSOLIDATE: multiple similar components
// components/Button.tsx
// components/PrimaryButton.tsx
// components/NewButton.tsx

// INTO: one component with variants
// components/Button.tsx (with variant prop)
```

## Safety Checklist

Before removing ANYTHING:
- [ ] Run detection tools
- [ ] Search for all references (grep/search)
- [ ] Check for dynamic imports
- [ ] Check if part of public API
- [ ] Run all tests
- [ ] Create backup branch

After each removal:
- [ ] Build succeeds
- [ ] Tests pass
- [ ] No console errors
- [ ] Commit changes

## Deletion Log Format

Track all deletions:

```markdown
## [Date] Cleanup Session

### Removed
- src/old-component.tsx - Replaced by: src/new-component.tsx
- lib/deprecated-util.ts - Functionality moved to: lib/utils.ts

### Impact
- Files deleted: X
- Lines removed: Y
- Bundle size reduction: ~Z KB

### Testing
- All tests passing: ✓
```

## When NOT to Use

- During active feature development
- Right before a production deployment
- When codebase is unstable
- Without proper test coverage
- On code you don't understand

## Error Recovery

If something breaks after removal:

```bash
# Immediate rollback
git revert HEAD
npm install
npm run build
npm test
```
