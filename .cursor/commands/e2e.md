# E2E Testing Command

Use this template to generate and run end-to-end tests with Playwright.

## How to Use

Copy this prompt for E2E test generation:

---

**I need E2E tests for: [describe user flow]**

Please:
1. **Identify Test Scenarios** - List the user journey steps
2. **Generate Playwright Tests** - Use Page Object Model pattern
3. **Add Resilient Selectors** - Prefer data-testid attributes
4. **Include Assertions** - Verify each critical step
5. **Capture Artifacts** - Screenshots on key steps, video on failure
6. **Handle Edge Cases** - Empty states, errors, timeouts

---

## Test Structure

```typescript
// tests/e2e/[feature]/[flow].spec.ts
import { test, expect } from '@playwright/test'
import { FeaturePage } from '../../pages/FeaturePage'

test.describe('Feature Flow', () => {
  let page: FeaturePage

  test.beforeEach(async ({ page: p }) => {
    page = new FeaturePage(p)
    await page.goto()
  })

  test('user can complete main flow', async ({ page: p }) => {
    // Arrange
    await expect(p).toHaveTitle(/Expected Title/)

    // Act
    await page.performAction()

    // Assert
    await expect(page.resultElement).toBeVisible()

    // Screenshot for verification
    await p.screenshot({ path: 'artifacts/flow-complete.png' })
  })
})
```

## Page Object Model

```typescript
// pages/FeaturePage.ts
import { Page, Locator } from '@playwright/test'

export class FeaturePage {
  readonly page: Page
  readonly searchInput: Locator
  readonly resultCards: Locator

  constructor(page: Page) {
    this.page = page
    this.searchInput = page.locator('[data-testid="search-input"]')
    this.resultCards = page.locator('[data-testid="result-card"]')
  }

  async goto() {
    await this.page.goto('/feature')
    await this.page.waitForLoadState('networkidle')
  }

  async search(query: string) {
    await this.searchInput.fill(query)
    await this.page.waitForResponse(resp => 
      resp.url().includes('/api/search')
    )
  }
}
```

## Playwright Commands

```bash
# Run all E2E tests
npx playwright test

# Run specific test file
npx playwright test tests/e2e/auth/login.spec.ts

# Run in headed mode (see browser)
npx playwright test --headed

# Debug test
npx playwright test --debug

# Generate test code from browser actions
npx playwright codegen http://localhost:3000

# View HTML report
npx playwright show-report
```

## Best Practices

**DO:**
- Use Page Object Model for maintainability
- Use `data-testid` attributes for selectors
- Wait for API responses, not arbitrary timeouts
- Test critical user journeys end-to-end
- Review artifacts when tests fail

**DON'T:**
- Use brittle selectors (CSS classes can change)
- Test implementation details
- Run tests against production (for destructive tests)
- Ignore flaky tests
- Use `waitForTimeout()` instead of proper waits

## Flaky Test Handling

```typescript
// Mark flaky test
test('potentially unstable test', async ({ page }) => {
  test.fixme(true, 'Test is flaky - Issue #123')
  // Test code...
})

// Or skip in CI
test('local only test', async ({ page }) => {
  test.skip(process.env.CI, 'Skip in CI')
  // Test code...
})
```

## When to Use

- Testing critical user journeys
- Verifying multi-step flows
- Testing UI interactions
- Validating frontend-backend integration
- Before production deployments
