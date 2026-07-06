import { describe, expect, it } from "vitest"
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

// --- Conversation Import ---

describe("conversation-import", () => {
  it("imports valid JSON conversation", async () => {
    const { importConversationFromJson } = await import("../conversation-import")
    const json = JSON.stringify({
      version: 1,
      title: "Test",
      messages: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi!", agentId: "codex" }
      ]
    })
    const result = importConversationFromJson(json)
    expect(result.ok).toBe(true)
    expect(result.messageCount).toBe(2)
    expect(result.conversation!.title).toBe("Test")
  })

  it("rejects invalid JSON", async () => {
    const { importConversationFromJson } = await import("../conversation-import")
    expect(importConversationFromJson("not json").ok).toBe(false)
  })

  it("migrates legacy format without version", async () => {
    const { importConversationFromJson } = await import("../conversation-import")
    const result = importConversationFromJson(JSON.stringify({
      title: "Legacy",
      messages: [{ role: "user", content: "test" }]
    }))
    expect(result.ok).toBe(true)
    expect(result.warnings).toBeDefined()
    expect(result.warnings![0]).toContain("Legacy")
  })

  it("drops invalid metadata values during import", async () => {
    const { importConversationFromJson } = await import("../conversation-import")
    const stringMetadata = importConversationFromJson(JSON.stringify({
      version: 1,
      title: "Invalid metadata",
      metadata: "not-object",
      messages: [{ role: "user", content: "Hello" }]
    }))
    const arrayMetadata = importConversationFromJson(JSON.stringify({
      version: 1,
      title: "Array metadata",
      metadata: [],
      messages: [{ role: "user", content: "Hello" }]
    }))
    const objectMetadata = importConversationFromJson(JSON.stringify({
      version: 1,
      title: "Object metadata",
      metadata: { workspaceId: "w1" },
      messages: [{ role: "user", content: "Hello" }]
    }))

    expect(stringMetadata.conversation?.metadata).toBeUndefined()
    expect(arrayMetadata.conversation?.metadata).toBeUndefined()
    expect(objectMetadata.conversation?.metadata).toEqual({ workspaceId: "w1" })
  })

  it("branches from checkpoint", async () => {
    const { importConversationFromJson, branchFromCheckpoint } = await import("../conversation-import")
    const result = importConversationFromJson(JSON.stringify({
      version: 1, title: "Test",
      messages: [
        { role: "user", content: "Q1" },
        { role: "assistant", content: "A1" },
        { role: "user", content: "Q2" },
        { role: "assistant", content: "A2" }
      ]
    }))
    const branch = branchFromCheckpoint(result.conversation!, 1)
    expect(branch.ok).toBe(true)
    expect(branch.messages).toHaveLength(2)
    expect(branch.messages![1].content).toBe("A1")
  })

  it("summarizes conversation", async () => {
    const { importConversationFromJson, summarizeConversation } = await import("../conversation-import")
    const result = importConversationFromJson(JSON.stringify({
      version: 1, title: "Summary Test",
      messages: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi!", agentId: "codex" },
        { role: "user", content: "Bye" }
      ]
    }))
    const summary = summarizeConversation(result.conversation!)
    expect(summary.messageCount).toBe(3)
    expect(summary.userMessages).toBe(2)
    expect(summary.agentIds).toEqual(["codex"])
  })
})

// --- Memory Graph ---

describe("memory-graph", () => {
  it("builds graph from entries", async () => {
    const { buildMemoryGraph } = await import("../memory-graph")
    const entries = [
      { id: "a", title: "Pref A", category: "preference" as const, tags: ["tag1", "tag2"], status: "approved" as const, useCount: 5 },
      { id: "b", title: "Pref B", category: "preference" as const, tags: ["tag1"], status: "approved" as const, useCount: 0 },
      { id: "c", title: "Proj C", category: "project" as const, tags: ["tag3"], status: "approved" as const, useCount: 0 }
    ]
    const graph = buildMemoryGraph(entries as any)
    expect(graph.nodes).toHaveLength(3)
    expect(graph.edges.length).toBeGreaterThan(0)
    expect(graph.stats.totalNodes).toBe(3)
    expect(graph.stats.categories.preference).toBe(2)
  })

  it("suggests cleanup for low-importance isolated nodes", async () => {
    const { buildMemoryGraph, suggestCleanup } = await import("../memory-graph")
    const entries = [
      { id: "pinned", title: "Important", category: "preference" as const, tags: [], status: "approved" as const, metadata: { pinned: true }, useCount: 10 },
      { id: "low", title: "Low value", category: "task" as const, tags: [], status: "approved" as const, useCount: 0 }
    ]
    const graph = buildMemoryGraph(entries as any)
    const cleanup = suggestCleanup(graph)
    expect(cleanup.some(n => n.id === "low")).toBe(true)
    expect(cleanup.some(n => n.id === "pinned")).toBe(false)
  })
})

// --- Plugin Manager ---

describe("plugin-manager", () => {
  it("lists the built-in EchoBird plugin repository", async () => {
    const { listPluginRepositories } = await import("../plugin-manager")
    const repos = listPluginRepositories()
    expect(repos.some(repo => repo.id === "echobird-superpowers" && repo.url === "https://gitcode.com/edison7009/EchoBird-Superpowers.git")).toBe(true)
  })

  it("validates supported repository URLs", async () => {
    const { validatePluginRepositoryUrl } = await import("../plugin-manager")
    expect(validatePluginRepositoryUrl("https://github.com/openai/codex.git").valid).toBe(true)
    expect(validatePluginRepositoryUrl("https://gitcode.com/edison7009/EchoBird-Superpowers.git").valid).toBe(true)
    expect(validatePluginRepositoryUrl("ssh://github.com/openai/codex.git").valid).toBe(false)
    expect(validatePluginRepositoryUrl("https://example.com/openai/codex.git").valid).toBe(false)
  })

  it("scans plugins from directory", async () => {
    const { validateManifest, getPluginContributions } = await import("../plugin-manager")
    // Test manifest validation and contributions (directory scanning depends on homedir)
    const manifest = {
      name: "My Plugin",
      version: "1.0.0",
      contributes: {
        commands: [{ id: "test", label: "Test" }],
        slashCommands: [{ id: "ask", label: "/ask-plugin", promptTemplate: "Ask {{input}}" }],
        activityParsers: [{ id: "todo", pattern: "TODO: (.+)", fields: { title: "1" } }],
        preDispatchHooks: [{ id: "ctx", appendContext: "Plugin context" }]
      }
    }
    expect(validateManifest(manifest).valid).toBe(true)
    const plugins = [{
      id: "local::my-plugin",
      manifest,
      path: "/test",
      enabled: true,
      source: "local" as const
    }]
    const contribs = getPluginContributions(plugins)
    expect(contribs.commands).toHaveLength(1)
    expect(contribs.commands[0].id).toBe("test")
    expect(contribs.slashCommands[0].label).toBe("/ask-plugin")
    expect(contribs.activityParsers[0].id).toBe("todo")
    expect(contribs.preDispatchHooks[0].id).toBe("ctx")
  })

  it("scans Codex-style skill repositories without manifest.json", async () => {
    const { scanPlugins, getPluginContributions } = await import("../plugin-manager")
    const root = mkdtempSync(join(tmpdir(), "agenthub-plugin-"))
    const skillDir = join(root, ".agenthub", "codex-style", "skill-pack", "1.0.0", "skills", "sample-skill")
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, "SKILL.md"), "---\nname: sample-skill\n---\n# Sample\n", "utf-8")

    const plugins = scanPlugins(root)
    // scanPlugins also scans global ~/.agenthub/plugins, so filter to local only
    const localPlugins = plugins.filter(p => p.source === 'local')
    expect(localPlugins).toHaveLength(1)
    expect(localPlugins[0].manifest.name).toBe("Codex Style")
    expect(localPlugins[0].manifest.contributes?.skills?.[0]?.path).toBe("skill-pack/1.0.0/skills/sample-skill/SKILL.md")
    expect(localPlugins[0].manifest.contributes?.skills?.[0]?.path.startsWith(root)).toBe(false)
    const contribs = getPluginContributions(localPlugins)
    expect(contribs.skills).toHaveLength(1)
    expect(contribs.skills[0].id).toBe("sample-skill")
    expect(contribs.skills[0].path.endsWith("sample-skill/SKILL.md")).toBe(true)
    expect(contribs.skills[0].content).toContain("# Sample")
  })

  it("splits Codex-style plugin packages by .codex-plugin metadata", async () => {
    const { scanPlugins, getPluginContributions } = await import("../plugin-manager")
    const root = mkdtempSync(join(tmpdir(), "agenthub-plugin-"))
    const packageRoot = join(root, ".agenthub", "codex-repo", "writing-plans", "5.1.0")
    mkdirSync(join(packageRoot, ".codex-plugin"), { recursive: true })
    mkdirSync(join(packageRoot, "skills", "writing-plans"), { recursive: true })
    writeFileSync(join(packageRoot, ".codex-plugin", "plugin.json"), JSON.stringify({
      name: "writing-plans",
      version: "5.1.0",
      interface: { displayName: "Writing Plans", shortDescription: "Plan work before coding." }
    }), "utf-8")
    writeFileSync(join(packageRoot, "skills", "writing-plans", "SKILL.md"), "# Writing Plans\n", "utf-8")

    const plugins = scanPlugins(root)
    const localPlugins = plugins.filter(p => p.source === 'local')
    expect(localPlugins).toHaveLength(1)
    expect(localPlugins[0].id).toBe("local::codex-repo/writing-plans")
    expect(localPlugins[0].manifest.name).toBe("Writing Plans")
    expect(localPlugins[0].manifest.version).toBe("5.1.0")
    expect(localPlugins[0].manifest.contributes?.skills?.[0]?.path).toBe("skills/writing-plans/SKILL.md")
    expect(localPlugins[0].manifest.contributes?.skills?.[0]?.path.startsWith(root)).toBe(false)
    const contributions = getPluginContributions(localPlugins)
    expect(contributions.skills[0].id).toBe("writing-plans")
    expect(contributions.skills[0].content).toContain("# Writing Plans")
  })

  it("validates manifest", async () => {
    const { validateManifest } = await import("../plugin-manager")
    expect(validateManifest({ name: "Test", version: "1.0" }).valid).toBe(true)
    expect(validateManifest({ name: "Test" }).valid).toBe(false)
    expect(validateManifest(null).valid).toBe(false)
  })

  it("gets contributions from enabled plugins", async () => {
    const { getPluginContributions } = await import("../plugin-manager")
    const plugins = [{
      id: "test::p1",
      manifest: {
        name: "P1", version: "1.0",
        contributes: {
          commands: [{ id: "c1", label: "Command 1" }],
          prompts: [{ id: "pr1", name: "Prompt 1", body: "hello" }]
        }
      },
      path: "/test",
      enabled: true,
      source: "local" as const
    }]
    const contribs = getPluginContributions(plugins)
    expect(contribs.commands).toHaveLength(1)
    expect(contribs.prompts).toHaveLength(1)
    expect(contribs.commands[0].pluginId).toBe("test::p1")
  })
})

// --- Release Workspace ---

describe("release-workspace", () => {
  it("runs release checks with all passing", async () => {
    const { runReleaseChecks } = await import("../release-workspace")
    const report = await runReleaseChecks({
      appVersion: "1.0.0",
      typecheckPass: true,
      testPass: true,
      buildPass: true,
      hasChangelog: true,
      hasGitTag: true,
      gitClean: true
    })
    expect(report.ready).toBe(true)
    expect(report.summary.pass).toBe(7)
    expect(report.summary.fail).toBe(0)
  })

  it("reports not ready when typecheck fails", async () => {
    const { runReleaseChecks } = await import("../release-workspace")
    const report = await runReleaseChecks({
      appVersion: "1.0.0",
      typecheckPass: false,
      testPass: true,
      buildPass: true,
      hasChangelog: true,
      hasGitTag: true,
      gitClean: true
    })
    expect(report.ready).toBe(false)
    expect(report.summary.fail).toBe(1)
    expect(report.checks.find(c => c.id === "typecheck")?.status).toBe("fail")
  })

  it("warns on missing changelog and dirty tree", async () => {
    const { runReleaseChecks } = await import("../release-workspace")
    const report = await runReleaseChecks({
      appVersion: "1.0.0",
      typecheckPass: true,
      testPass: true,
      buildPass: true,
      hasChangelog: false,
      hasGitTag: false,
      gitClean: false
    })
    expect(report.ready).toBe(true) // warns don't block
    expect(report.summary.warn).toBe(3)
  })
})
