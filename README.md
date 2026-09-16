# release-gate-mcp

Release intelligence for AI agents. Analyzes the changes in a repository, detects breaking updates, generates release notes, and recommends the next semantic version. Releases stop being guesses.

Built as an MCP server, so it works in any platform that speaks Model Context Protocol.

## Why

Version bumps and changelogs are hand rolled. An agent cannot tell whether a change is breaking or patch, so either nothing ships or the wrong version does. Release Gate reads the commits and the diff and answers with evidence.

## Tools

* `release.analyze` classify commits, detect breaking changes from messages and removed exports, recommend the next bump
* `release.notes` generate release notes grouped by type from the commits since the last tag
* `release.bump` compute the next semantic version from the current version and the recommended bump

Breaking changes are detected two ways: conventional commit markers such as `refactor!:` and `BREAKING CHANGE`, and removed exported symbols in the diff.

## Usage

```bash
npm install -g release-gate-mcp
```

```json
{
  "mcpServers": {
    "release": {
      "command": "release-gate-mcp",
      "args": []
    }
  }
}
```

## License

MIT. Part of the Tawakkul Labs MCP family.