# .agent/config

## secrets.yml

Defines mapping between GitHub Secrets/Variables and Bitwarden items.

**Format:**
```yaml
repo: <owner>/<repo-name>
environment: null  # or environment name
type: secret       # or "variable"

secrets:
  - name: GITHUB_SECRET_NAME    # Name on GitHub
    bitwarden: BITWARDEN_ITEM   # Item name in Bitwarden
```

**Purpose:** Enable automated secret sync from Bitwarden → GitHub using MCP tools.
