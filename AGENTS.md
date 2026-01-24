# CursorPlaybook Guide

This document explains how to use the CursorPlaybook effectively in your day-to-day development workflow.

## Overview

CursorPlaybook provides:
1. **Rules** - Automatic guidelines that apply to your code
2. **Commands** - Reusable prompt templates for common tasks
3. **MCP Servers** - External tool integrations

## Rules

Rules are stored in `.cursor/rules/` and use the `.mdc` format (Markdown with YAML frontmatter).

### How Rules Work

- **`alwaysApply: true`** - Rule is always active
- **`globs: "**/*.ts"`** - Rule applies when matching files are referenced
- **Manual** - Reference with `@.cursor/rules/rulename.mdc` in chat

### Available Rules

| Rule | Activation | Purpose |
|------|------------|---------|
| `00-core.mdc` | Always | Non-negotiables: no secrets, small files, validate inputs |
| `coding-style.mdc` | Code files | Immutability, file organization, error handling |
| `security.mdc` | Code files | Security checklist, input validation, XSS/SQL prevention |
| `testing.mdc` | Test files | TDD workflow, coverage requirements |
| `git-workflow.mdc` | Manual | Commit conventions, PR workflow |
| `performance-context.mdc` | Manual | Model selection, context management tips |

## Commands

Commands are prompt templates in `.cursor/commands/`. Reference them in chat to invoke structured workflows.

### How to Use Commands

1. Start a chat in Cursor
2. Type `@` and navigate to `.cursor/commands/`
3. Select the command template
4. Add your specific request

Example:
```
@.cursor/commands/plan.md

I need to implement a user dashboard with analytics
```

### Available Commands

| Command | When to Use |
|---------|-------------|
| `plan.md` | Starting new features, complex changes, unclear requirements |
| `code-review.md` | After writing code, before commits, reviewing PRs |
| `build-fix.md` | Build failures, TypeScript errors, compilation issues |
| `tdd.md` | New features, bug fixes, critical business logic |
| `refactor-clean.md` | Removing dead code, consolidating duplicates |
| `e2e.md` | Testing user journeys, UI flows, integration testing |

### Command Workflow

**For a new feature:**
1. Start with `plan.md` to create implementation plan
2. Use `tdd.md` to implement with tests
3. Run `code-review.md` before committing
4. Use `build-fix.md` if build fails

**For debugging:**
1. Use `build-fix.md` to fix compilation errors
2. Run `code-review.md` to catch issues
3. Use `e2e.md` to add regression tests

## MCP Servers

MCP (Model Context Protocol) servers extend Cursor with external capabilities.

### Configuration

MCP settings are in `.cursor/mcp.json`. Each server can be enabled/disabled.

### Enabled by Default

- **github** - Create PRs, manage issues, view repos
- **context7** - Look up library documentation

### Available (Disabled by Default)

- **memory** - Persist context across sessions
- **filesystem** - Extended file operations
- **vercel** - Deploy and manage Vercel projects
- **supabase** - Database operations

### Setup

See [docs/mcp-setup.md](docs/mcp-setup.md) for detailed configuration instructions.

## Best Practices

### 1. Let Rules Work Automatically

The core rules (`00-core.mdc`, `coding-style.mdc`, `security.mdc`) apply automatically. You don't need to reference them - Cursor applies them based on file context.

### 2. Use Commands for Structure

When you need a structured approach (planning, reviewing, debugging), reference the appropriate command template. This ensures consistent, thorough results.

### 3. Keep MCP Lean

Only enable MCP servers you actually use. Too many servers can slow down responses and consume context window.

### 4. Customize for Your Stack

Add your own rules for project-specific conventions:
- Framework patterns (React, Next.js, etc.)
- Database conventions
- API design standards
- Team coding style

### 5. Iterate and Improve

As you discover new patterns or requirements:
- Add new rules for recurring guidelines
- Create command templates for repeated workflows
- Document learnings in rule files

## Quick Reference

### Reference a Rule
```
@.cursor/rules/security.mdc
```

### Reference a Command
```
@.cursor/commands/plan.md
```

### Check Rule Status
Open Cursor settings > Rules to see active rules

### Reload Rules
If rules aren't applying, try reopening the file or restarting Cursor
