# CursorPlaybook

A Cursor-native playbook for AI-assisted development. Includes rules, command templates, and MCP configurations to supercharge your Cursor workflow.

## What's Inside

```
CursorPlaybook/
├── .cursor/
│   ├── rules/              # Cursor project rules (.mdc format)
│   │   ├── 00-core.mdc         # Always-on core principles
│   │   ├── coding-style.mdc    # Code quality standards
│   │   ├── security.mdc        # Security checklist
│   │   ├── testing.mdc         # TDD and testing requirements
│   │   ├── git-workflow.mdc    # Git conventions
│   │   └── performance-context.mdc  # Context management
│   │
│   ├── commands/           # Reusable prompt templates
│   │   ├── plan.md             # Implementation planning
│   │   ├── code-review.md      # Code review checklist
│   │   ├── build-fix.md        # Build error resolution
│   │   ├── tdd.md              # Test-driven development
│   │   ├── refactor-clean.md   # Dead code cleanup
│   │   └── e2e.md              # E2E test generation
│   │
│   └── mcp.json            # MCP server configurations
│
├── docs/
│   └── mcp-setup.md        # MCP setup instructions
│
├── AGENTS.md               # How to use this playbook
└── README.md               # This file
```

## Quick Start

### 1. Clone or Copy

```bash
# Clone this repo
git clone https://github.com/mattduff36/CursorPlaybook.git

# Or copy .cursor/ folder to your project
cp -r CursorPlaybook/.cursor your-project/.cursor
```

### 2. Configure MCP (Optional)

Edit `.cursor/mcp.json` and replace placeholder values:
- `YOUR_GITHUB_PAT_HERE` - Your GitHub Personal Access Token
- See [docs/mcp-setup.md](docs/mcp-setup.md) for full setup instructions

### 3. Open in Cursor

Open your project in Cursor. Rules will automatically apply based on their configuration.

## Using the Playbook

### Rules (Automatic)

Rules in `.cursor/rules/` are applied automatically:

- **`00-core.mdc`** - Always active (core principles)
- **`coding-style.mdc`** - Applies to code files (ts, tsx, js, jsx, py, go, rs)
- **`security.mdc`** - Applies to code files
- **`testing.mdc`** - Applies to test files
- **`git-workflow.mdc`** - Available for reference
- **`performance-context.mdc`** - Available for reference

### Commands (Manual)

Reference command templates in your chat:

```
@.cursor/commands/plan.md

I need to implement user authentication
```

Available commands:
- `plan.md` - Create implementation plans before coding
- `code-review.md` - Review code for quality and security
- `build-fix.md` - Fix build/TypeScript errors incrementally
- `tdd.md` - Implement features with test-driven development
- `refactor-clean.md` - Find and remove dead code
- `e2e.md` - Generate Playwright E2E tests

### MCP Servers

MCP servers extend Cursor with external tools. Enable/disable in `.cursor/mcp.json`:

- **github** - GitHub operations (PRs, issues, repos)
- **context7** - Live documentation lookup
- **memory** - Persistent memory across sessions
- **filesystem** - Extended file operations
- **vercel** - Vercel deployments
- **supabase** - Database operations

## Customization

### Adding Your Own Rules

Create new `.mdc` files in `.cursor/rules/`:

```markdown
---
description: My custom rule
globs: "**/*.ts"  # or alwaysApply: true
---

# My Rule

Your instructions here...
```

### Adding Command Templates

Create new `.md` files in `.cursor/commands/`:

```markdown
# My Command

## How to Use
...

## Expected Output
...
```

## Credits

Ported from [everything-claude-code](https://github.com/affaan-m/everything-claude-code) by [@affaanmustafa](https://x.com/affaanmustafa), adapted for Cursor.

## License

MIT - Use freely, modify as needed.
