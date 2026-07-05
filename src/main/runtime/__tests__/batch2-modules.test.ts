import { describe, expect, it, vi, beforeEach } from "vitest"
import { join } from "node:path"
import { tmpdir } from "node:os"

const memory: Record<string, any> = {}
vi.mock("../../store", () => ({
  store: {
    get: (key: string) => memory[key],
    set: (key: string, value: any) => { memory[key] = value }
  }
}))

describe("workflows", () => {
  beforeEach(() => {
    for (const key of Object.keys(memory)) delete memory[key]
    vi.resetModules()
  })

  it("creates and retrieves a workflow", async () => {
    const { upsertWorkflow, getWorkflow } = await import("../workflows")
    const wf = upsertWorkflow({
      name: "Test Workflow",
      steps: [{ id: "s1", type: "prompt", label: "Step 1" }],
      category: "custom"
    })
    expect(wf.name).toBe("Test Workflow")
    expect(wf.steps).toHaveLength(1)
    expect(getWorkflow(wf.id)).not.toBeNull()
  })

  it("lists workflows by category", async () => {
    const { upsertWorkflow, listWorkflows } = await import("../workflows")
    upsertWorkflow({ name: "A", steps: [{ id: "a", type: "prompt", label: "A" }], category: "development" })
    upsertWorkflow({ name: "B", steps: [{ id: "b", type: "prompt", label: "B" }], category: "review" })
    expect(listWorkflows("development")).toHaveLength(1)
    expect(listWorkflows()).toHaveLength(2)
  })

  it("searches workflows", async () => {
    const { upsertWorkflow, searchWorkflows } = await import("../workflows")
    upsertWorkflow({ name: "Code Review", steps: [{ id: "a", type: "review", label: "A" }], tags: ["review"] })
    upsertWorkflow({ name: "Deploy", steps: [{ id: "b", type: "prompt", label: "B" }], tags: ["deploy"] })
    expect(searchWorkflows("review")).toHaveLength(1)
    expect(searchWorkflows("deploy")).toHaveLength(1)
  })

  it("seeds defaults on first run", async () => {
    const { seedDefaultWorkflows, listWorkflows } = await import("../workflows")
    seedDefaultWorkflows()
    expect(listWorkflows().length).toBeGreaterThanOrEqual(2)
    seedDefaultWorkflows() // no-op
    expect(listWorkflows()).toHaveLength(2)
  })

  it("increments use count", async () => {
    const { upsertWorkflow, incrementWorkflowUse, getWorkflow } = await import("../workflows")
    const wf = upsertWorkflow({ name: "Counter", steps: [{ id: "a", type: "prompt", label: "A" }] })
    incrementWorkflowUse(wf.id)
    expect(getWorkflow(wf.id)!.useCount).toBe(1)
  })
})

describe("team builder", () => {
  beforeEach(() => {
    for (const key of Object.keys(memory)) delete memory[key]
    vi.resetModules()
  })

  it("returns true when deleting an existing team preset", async () => {
    const { saveTeamPreset, deleteTeamPreset, listTeamPresets } = await import("../team-builder")

    const preset = saveTeamPreset({
      name: "Review Team",
      members: [{ role: "reviewer", agentId: "codex" }]
    })

    expect(deleteTeamPreset(preset.id)).toBe(true)
    expect(listTeamPresets()).toHaveLength(0)
  })
})

describe("diagnostics", () => {
  it("runs all checks and returns structured results", async () => {
    const { runDiagnostics } = await import("../diagnostics")
    const suite = await runDiagnostics({
      storeGet: () => undefined,
      hasProviders: () => true,
      hasAgents: () => false,
      hasMcpServers: () => false,
      hasMemoryEntries: () => true,
      hasWorkspace: () => true,
      appVersion: "1.0.0"
    })
    expect(suite.results.length).toBeGreaterThanOrEqual(7)
    expect(suite.summary.pass).toBeGreaterThan(0)
    expect(suite.summary.total).toBe(suite.results.length)
    expect(suite.results.some(r => r.id === 'store')).toBe(true)
    expect(suite.results.some(r => r.id === 'platform')).toBe(true)
  })

  it("reports warn for missing providers", async () => {
    const { runDiagnostics } = await import("../diagnostics")
    const suite = await runDiagnostics({
      storeGet: () => undefined,
      hasProviders: () => false,
      hasAgents: () => true,
      hasMcpServers: () => false,
      hasMemoryEntries: () => false,
      hasWorkspace: () => false,
      appVersion: "1.0.0"
    })
    const providerCheck = suite.results.find(r => r.id === 'providers')
    expect(providerCheck?.status).toBe('warn')
  })
})

describe("backup", () => {
  it("lists backups from empty directory", async () => {
    const { listBackups } = await import("../backup")
    const tmpDir = join(tmpdir(), `agenthub-backup-test-${Date.now()}`)
    expect(listBackups(tmpDir)).toEqual([])
  })

  it("handles backup creation failure gracefully", async () => {
    const { createBackup } = await import("../backup")
    // Passing an invalid directory like empty string or invalid path structure to cause an error
    const result = createBackup(() => ({}), "/invalid-dir/that/does/not/exist/and/cannot/be/created/???", "1.0.0")
    expect(result).toHaveProperty("error")
  })
})
