#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const server = new McpServer({ name: pkg.name, version: pkg.version });

function git(cwd, args) {
  try {
    return execSync(`git ${args}`, {
      cwd,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return "";
  }
}

function lastTag(cwd) {
  const t = git(cwd, "describe --tags --abbrev=0").trim();
  return t || "";
}

function currentVersion(cwd) {
  const pkg = resolve(cwd, "package.json");
  if (existsSync(pkg)) {
    try {
      return JSON.parse(readFileSync(pkg, "utf8")).version || "0.0.0";
    } catch {
      return "0.0.0";
    }
  }
  return "0.0.0";
}

function parseCommit(short) {
  const m = short.match(/^(\S+)\s+((feat|fix|chore|docs|refactor|perf|test|build|ci|breaking|BREAKING|BREAKING CHANGE)[!]?(\([^)]+\))?:\s*)?(.*)$/s);
  if (!m) return { hash: short.slice(0, 8), type: "other", subject: short };
  return { hash: m[1], type: (m[3] || "other").toLowerCase().split(" ")[0], subject: (m[5] || short).slice(0, 120) };
}

function breakingFromDiff(cwd, from, to) {
  const diff = git(cwd, `diff ${from}..${to} -- '*.js' '*.ts' '*.jsx' '*.tsx' '*.py' '*.rs' '*.go' '*.dart'`);
  const removedExports = (diff.match(/^-(export\s+(function|class|const|let|var|interface|type)\s+\w+|export\s*\{)/gm) || []).length;
  const removedFiles = (diff.match(/^diff --git a\/\S+ b\/dev\/null$/gm) || []).length;
  return { removedExports, removedFiles };
}

function analyze(cwd, from, to) {
  const range = from ? `${from}..${to || "HEAD"}` : to ? `${to}` : "HEAD";
  const log = git(cwd, `log --pretty=format:"%h %s" ${range}`);
  const commits = log.split("\n").filter(Boolean).map(parseCommit);
  const messages = git(cwd, `log --format=%B ${range}`).toLowerCase();
  const msgBreaking = /breaking change|breaking:|^breaking\b|!\s*:/.test(messages);
  const diff = breakingFromDiff(cwd, from || git(cwd, "rev-list --max-parents=0 HEAD").trim() || "HEAD~1", to || "HEAD");
  const hasRemovedExports = diff.removedExports > 0 || diff.removedFiles > 0;
  const typeCounts = commits.reduce((a, c) => ((a[c.type] = (a[c.type] || 0) + 1), a), {});
  const hasFeature = typeCounts.feat > 0;
  const bump = msgBreaking || hasRemovedExports ? "major" : hasFeature ? "minor" : "patch";
  return { range, commits, typeCounts, msgBreaking, diff, hasRemovedExports, bump, hasFeature };
}

server.registerTool(
  "release.analyze",
  {
    description: "Analyze the changes in a repository since a reference. Classifies commits, detects breaking changes from messages and removed exports, and recommends the next semver bump.",
    inputSchema: {
      path: z.string().optional().describe("Repository root. Defaults to the current directory."),
      from: z.string().optional().describe("Start ref, for example a tag or commit. Defaults to the last tag, or the first commit if no tags exist."),
      to: z.string().optional().describe("End ref. Defaults to HEAD."),
    },
  },
  async ({ path, from, to }) => {
    const cwd = resolve(path || ".");
    const ref = from || lastTag(cwd) || undefined;
    const a = analyze(cwd, ref, to);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              range: a.range,
              commits: a.commits.length,
              typeCounts: a.typeCounts,
              breakingSignals: { inMessages: a.msgBreaking, removedExports: a.diff.removedExports, removedFiles: a.diff.removedFiles },
              hasFeatureChanges: a.hasFeature,
              recommendedBump: a.bump,
              currentVersion: currentVersion(cwd),
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

server.registerTool(
  "release.notes",
  {
    description: "Generate release notes from the commits since a reference. Groups commits by type and flags breaking changes.",
    inputSchema: {
      path: z.string().optional().describe("Repository root. Defaults to the current directory."),
      from: z.string().optional().describe("Start ref. Defaults to the last tag, or the first commit if no tags exist."),
      to: z.string().optional().describe("End ref. Defaults to HEAD."),
    },
  },
  async ({ path, from, to }) => {
    const cwd = resolve(path || ".");
    const ref = from || lastTag(cwd) || undefined;
    const a = analyze(cwd, ref, to);
    const groups = {};
    for (const c of a.commits) {
      const key = c.type === "feat" ? "Features" : c.type === "fix" ? "Fixes" : c.type === "breaking" ? "Breaking changes" : c.type === "chore" ? "Chores" : c.type === "docs" ? "Docs" : c.type === "refactor" ? "Refactors" : "Other";
      (groups[key] = groups[key] || []).push(`${c.hash}: ${c.subject}`);
    }
    const lines = [`Release notes for ${a.range}`, ""];
    if (a.bump === "major") lines.push("This release contains breaking changes.", "");
    for (const [k, v] of Object.entries(groups)) {
      lines.push(`## ${k}`, ...v.map((x) => `- ${x}`), "");
    }
    if (a.commits.length === 0) lines.push("No commits in range.");
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

server.registerTool(
  "release.bump",
  {
    description: "Recommend the next semantic version for the repository given its current version and the analyzed changes.",
    inputSchema: {
      path: z.string().optional().describe("Repository root. Defaults to the current directory."),
      from: z.string().optional().describe("Start ref. Defaults to the last tag, or the first commit if no tags exist."),
      to: z.string().optional().describe("End ref. Defaults to HEAD."),
      bump: z.enum(["major", "minor", "patch"]).optional().describe("Override the bump type instead of detecting it"),
    },
  },
  async ({ path, from, to, bump }) => {
    const cwd = resolve(path || ".");
    const ref = from || lastTag(cwd) || undefined;
    const a = analyze(cwd, ref, to);
    const kind = bump || a.bump;
    const [major, minor, patch] = currentVersion(cwd).split(".").map((n) => parseInt(n, 10) || 0);
    const next = kind === "major" ? `${major + 1}.0.0` : kind === "minor" ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`;
    return { content: [{ type: "text", text: JSON.stringify({ current: currentVersion(cwd), recommendedBump: kind, nextVersion: next }) }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);