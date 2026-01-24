# MCP Server Setup Guide

This guide explains how to configure MCP (Model Context Protocol) servers for Cursor.

## What is MCP?

MCP servers extend Cursor's capabilities by providing access to external tools and services like GitHub, databases, file systems, and more.

## Configuration Location

The MCP config file is located at:
- **Project-level**: `.cursor/mcp.json` (in this repo)
- **Global**: `~/.cursor/mcp.json` (applies to all projects)

## Included Servers

### GitHub (Enabled by Default)

Provides GitHub operations: PRs, issues, repos, commits.

**Setup:**
1. Create a GitHub Personal Access Token at https://github.com/settings/tokens
2. Grant permissions: `repo`, `read:org`, `read:user`
3. Replace `YOUR_GITHUB_PAT_HERE` in `.cursor/mcp.json`

```json
{
  "github": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-github"],
    "env": {
      "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_xxxxxxxxxxxx"
    },
    "disabled": false
  }
}
```

### Context7 (Enabled by Default)

Provides live documentation lookup for libraries and frameworks.

**Setup:** No configuration needed - works out of the box.

### Memory (Disabled by Default)

Persistent memory across sessions.

**Setup:** Enable by setting `"disabled": false`

### Filesystem (Disabled by Default)

Extended filesystem operations.

**Setup:**
1. Replace `YOUR_PROJECT_PATH_HERE` with your project path
2. Set `"disabled": false`

```json
{
  "filesystem": {
    "command": "npx",
    "args": [
      "-y",
      "@modelcontextprotocol/server-filesystem",
      "/path/to/your/project"
    ],
    "disabled": false
  }
}
```

### Vercel (Disabled by Default)

Vercel deployments and project management.

**Setup:**
1. Get your Vercel token from https://vercel.com/account/tokens
2. Replace `YOUR_VERCEL_TOKEN_HERE`
3. Set `"disabled": false`

### Supabase (Disabled by Default)

Supabase database operations.

**Setup:**
1. Get your project ref from Supabase dashboard
2. Get access token from https://app.supabase.com/account/tokens
3. Replace placeholders
4. Set `"disabled": false`

## Adding More Servers

You can add any MCP server. Common ones include:

```json
{
  "firecrawl": {
    "command": "npx",
    "args": ["-y", "firecrawl-mcp"],
    "env": {
      "FIRECRAWL_API_KEY": "YOUR_KEY"
    }
  },
  "sequential-thinking": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-sequential-thinking"]
  },
  "cloudflare-docs": {
    "command": "npx",
    "args": ["-y", "@cloudflare/mcp-server-cloudflare-docs"]
  }
}
```

## Best Practices

### Keep It Lean

- **Enable only what you need** - Each server adds to context window usage
- **Recommended**: Keep under 10 servers enabled
- **Target**: Under 80 tools active

### Security

- **Never commit secrets** - Use environment variables or a separate `.env` file
- **Add `.cursor/mcp.json` to `.gitignore`** if it contains secrets
- **Or** use placeholder values and document setup in this file

### Per-Project Configuration

Create project-specific configs in `.cursor/mcp.json` rather than using global config. This keeps each project's tools isolated.

## Troubleshooting

### Server Not Working

1. Check if `disabled: false` is set
2. Verify environment variables are correct
3. Try running the command manually: `npx -y @modelcontextprotocol/server-github`
4. Check Cursor's MCP panel for errors

### Too Many Tools

If you see performance issues:
1. Disable unused servers
2. Keep only essential servers enabled
3. Consider using project-specific configs

## Additional Resources

- [Cursor MCP Documentation](https://cursor.com/docs/context/mcp)
- [MCP Protocol Specification](https://modelcontextprotocol.io/)
- [MCP Server Registry](https://github.com/modelcontextprotocol/servers)
