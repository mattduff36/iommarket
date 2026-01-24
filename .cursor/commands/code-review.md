# Code Review Command

Use this template to perform a comprehensive code review of recent changes.

## How to Use

Copy this prompt after making code changes:

---

**Please review the code I've just written/modified.**

Check for:

**Security Issues (CRITICAL):**
- Hardcoded credentials, API keys, tokens
- SQL injection vulnerabilities
- XSS vulnerabilities
- Missing input validation
- Path traversal risks

**Code Quality (HIGH):**
- Functions > 50 lines
- Files > 800 lines
- Nesting depth > 4 levels
- Missing error handling
- console.log statements
- TODO/FIXME comments

**Best Practices (MEDIUM):**
- Mutation patterns (use immutable instead)
- Missing tests for new code
- Accessibility issues
- Poor variable naming

**Format your response as:**
```
[SEVERITY] Issue title
File: path/to/file.ts:line
Issue: Description
Fix: Suggested fix with code example
```

---

## Review Checklist

For each changed file, verify:

- [ ] No hardcoded secrets
- [ ] All inputs validated
- [ ] Proper error handling
- [ ] No console.log statements
- [ ] Functions under 50 lines
- [ ] Files under 800 lines
- [ ] Immutable patterns used
- [ ] Tests added/updated

## Approval Criteria

- **Approve**: No CRITICAL or HIGH issues
- **Warning**: MEDIUM issues only (can proceed with caution)
- **Block**: CRITICAL or HIGH issues found

## Example Review Output

```
[CRITICAL] Hardcoded API key
File: src/api/client.ts:42
Issue: API key exposed in source code
Fix: Move to environment variable

const apiKey = "sk-abc123";  // BAD
const apiKey = process.env.API_KEY;  // GOOD
```

## When to Use

- After writing or modifying code
- Before committing changes
- Before creating a pull request
- When reviewing someone else's code
