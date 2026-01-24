# Build Fix Command

Use this template when your build fails or you have TypeScript/compilation errors.

## How to Use

Copy this prompt when build fails:

---

**My build is failing. Please help fix it incrementally.**

Run the build command and analyze errors:
```bash
npm run build
# or
npx tsc --noEmit
```

For each error:
1. Show the error with context (5 lines before/after)
2. Explain what's wrong
3. Propose the minimal fix
4. Apply the fix
5. Re-run build to verify

**Rules:**
- Fix ONE error at a time
- Make MINIMAL changes (no refactoring)
- Verify fix doesn't introduce new errors
- Stop if same error persists after 3 attempts

---

## Common Error Patterns

### Type Inference Failure
```typescript
// ERROR: Parameter 'x' implicitly has an 'any' type
function add(x, y) { return x + y }

// FIX: Add type annotations
function add(x: number, y: number): number { return x + y }
```

### Null/Undefined Errors
```typescript
// ERROR: Object is possibly 'undefined'
const name = user.name.toUpperCase()

// FIX: Optional chaining
const name = user?.name?.toUpperCase()
```

### Missing Properties
```typescript
// ERROR: Property 'age' does not exist on type 'User'
interface User { name: string }
const user: User = { name: 'John', age: 30 }

// FIX: Add property to interface
interface User { name: string; age?: number }
```

### Import Errors
```typescript
// ERROR: Cannot find module '@/lib/utils'

// FIX 1: Check tsconfig paths
// FIX 2: Use relative import
// FIX 3: Install missing package
```

## Minimal Diff Strategy

**DO:**
- Add type annotations where missing
- Add null checks where needed
- Fix imports/exports
- Add missing dependencies

**DON'T:**
- Refactor unrelated code
- Change architecture
- Rename variables (unless causing error)
- Add new features
- Optimize performance

## Diagnostic Commands

```bash
# TypeScript type check
npx tsc --noEmit

# Check specific file
npx tsc --noEmit path/to/file.ts

# ESLint check
npx eslint . --ext .ts,.tsx

# Clear cache and rebuild
rm -rf .next node_modules/.cache && npm run build
```

## When to Use

- `npm run build` fails
- `npx tsc --noEmit` shows errors
- Type errors blocking development
- Import/module resolution errors
