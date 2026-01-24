# TDD Command

Use this template to implement features using Test-Driven Development.

## How to Use

Copy this prompt when implementing new features:

---

**I need to implement: [describe feature]**

Use Test-Driven Development (TDD):

1. **Define Interfaces** - Create types/interfaces first
2. **Write Failing Test (RED)** - Write test that will fail
3. **Verify Failure** - Run test, confirm it fails for the right reason
4. **Implement Minimal Code (GREEN)** - Write just enough to pass
5. **Verify Pass** - Run test, confirm it passes
6. **Refactor (IMPROVE)** - Clean up while keeping tests green
7. **Check Coverage** - Ensure 80%+ coverage

Show me the output at each step.

---

## TDD Cycle

```
RED → GREEN → REFACTOR → REPEAT

RED:      Write a failing test
GREEN:    Write minimal code to pass
REFACTOR: Improve code, keep tests passing
REPEAT:   Next feature/scenario
```

## Example TDD Session

### Step 1: Define Interface
```typescript
export interface MarketData {
  totalVolume: number
  bidAskSpread: number
  activeTraders: number
}

export function calculateScore(market: MarketData): number {
  throw new Error('Not implemented')
}
```

### Step 2: Write Failing Test (RED)
```typescript
describe('calculateScore', () => {
  it('returns high score for liquid market', () => {
    const market = {
      totalVolume: 100000,
      bidAskSpread: 0.01,
      activeTraders: 500
    }
    const score = calculateScore(market)
    expect(score).toBeGreaterThan(80)
  })
})
```

### Step 3: Verify Failure
```bash
npm test
# FAIL: Error: Not implemented
```

### Step 4: Implement (GREEN)
```typescript
export function calculateScore(market: MarketData): number {
  const volumeScore = Math.min(market.totalVolume / 1000, 100)
  const spreadScore = Math.max(100 - (market.bidAskSpread * 1000), 0)
  const traderScore = Math.min(market.activeTraders / 10, 100)
  return (volumeScore + spreadScore + traderScore) / 3
}
```

### Step 5: Verify Pass
```bash
npm test
# PASS: 1 test passed
```

### Step 6: Refactor
Extract constants, improve naming, add edge case handling.

## Edge Cases to Test

1. **Null/Undefined**: What if input is null?
2. **Empty**: What if array/string is empty?
3. **Boundaries**: Min/max values
4. **Errors**: What should throw?
5. **Special Characters**: Unicode, emojis

## Coverage Requirements

- **80% minimum** for all code
- **100% required** for:
  - Financial calculations
  - Authentication logic
  - Security-critical code

## Commands

```bash
# Run tests
npm test

# Run with coverage
npm test -- --coverage

# Watch mode
npm test -- --watch
```

## When to Use

- Implementing new features
- Adding new functions/components
- Fixing bugs (reproduce with test first)
- Building critical business logic
