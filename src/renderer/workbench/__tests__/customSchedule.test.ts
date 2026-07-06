import { describe, expect, it } from "vitest"
import {
  buildCustomScheduleTemplate,
  compileScheduleGraph,
  customScheduleHasRunnableSteps,
  normalizeScheduleForStorage,
  normalizeStoredScheduleOverrides,
  sanitizeCustomSchedule,
  scheduleGraphFromSteps,
  validateScheduleGraph
} from "../customSchedule"

const baseSchedule: SchedulePreview = {
  preset: "custom",
  label: "Custom schedule",
  description: "test",
  steps: [
    { id: "custom-1", label: "Old Codex", agentId: "codex", role: "worker", mode: "auto" },
    { id: "custom-2", label: "Old Claude", agentId: "claude", role: "reviewer", mode: "auto", dependsOn: ["custom-1"] }
  ]
}

describe("custom schedule helpers", () => {
  it("does not build template steps when no local agents are usable", () => {
    expect(buildCustomScheduleTemplate("five", baseSchedule, [])).toBeNull()
    expect(buildCustomScheduleTemplate("parallel", baseSchedule, [])).toBeNull()
    expect(buildCustomScheduleTemplate("executor", baseSchedule, [])).toBeNull()
  })

  it("builds templates only from the supplied usable agent ids", () => {
    const schedule = buildCustomScheduleTemplate("five", baseSchedule, ["gemini"])!

    expect(schedule.steps).toHaveLength(5)
    expect(schedule.steps.every(step => step.agentId === "gemini")).toBe(true)
  })

  it("sanitizes stale or unavailable custom schedule agents before dispatch", () => {
    const sanitized = sanitizeCustomSchedule(baseSchedule, ["gemini"])

    expect(sanitized.steps.map(step => step.agentId)).toEqual(["gemini", "gemini"])
    expect(customScheduleHasRunnableSteps(sanitized)).toBe(true)
  })

  it("uses auto placeholders when no usable local agent exists", () => {
    const sanitized = sanitizeCustomSchedule(baseSchedule, [])

    expect(sanitized.steps.map(step => step.agentId)).toEqual(["auto", "auto"])
    expect(customScheduleHasRunnableSteps(sanitized)).toBe(false)
  })

  it("loads persisted schedule overrides for every non-legacy preset", () => {
    const overrides = normalizeStoredScheduleOverrides({
      "lead-workers": { ...baseSchedule, preset: "lead-workers" },
      broadcast: { ...baseSchedule, preset: "broadcast" },
      custom: baseSchedule,
      "firefly-custom": { ...baseSchedule, preset: "firefly-custom" },
      unknown: { ...baseSchedule, preset: "unknown" }
    })

    expect(overrides["lead-workers"]?.preset).toBe("lead-workers")
    expect(overrides.broadcast?.preset).toBe("broadcast")
    expect(overrides.custom).toBeUndefined()
    expect(overrides["firefly-custom"]).toBeUndefined()
    expect((overrides as any).unknown).toBeUndefined()
  })

  it("backfills a graph from legacy steps", () => {
    const graph = scheduleGraphFromSteps(baseSchedule)

    expect(graph.version).toBe(1)
    expect(graph.nodes.map(node => node.id)).toEqual(["custom-1", "custom-2"])
    expect(graph.edges).toEqual([{ id: "custom-1->custom-2", from: "custom-1", to: "custom-2", artifactMode: "summary" }])
    expect(graph.layout["custom-1"]).toEqual({ x: 28, y: 32 })
  })

  it("compiles DAG edges back to step dependencies", () => {
    const normalized = normalizeScheduleForStorage({
      ...baseSchedule,
      graph: {
        version: 1,
        nodes: [
          { id: "a", label: "A", agentId: "codex", role: "worker", mode: "auto" },
          { id: "b", label: "B", agentId: "claude", role: "reviewer", mode: "auto" },
          { id: "c", label: "C", agentId: "gemini", role: "gatekeeper", mode: "auto" }
        ],
        edges: [
          { id: "a-b", from: "a", to: "b", artifactMode: "full" },
          { id: "b-c", from: "b", to: "c", artifactMode: "summary" }
        ],
        layout: { a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, c: { x: 200, y: 0 } }
      }
    })

    expect(normalized.steps.map(step => [step.id, step.dependsOn])).toEqual([
      ["a", undefined],
      ["b", ["a"]],
      ["c", ["b"]]
    ])
    expect(normalized.graph?.edges[0].artifactMode).toBe("full")
  })

  it("rejects duplicate nodes, orphan edges, and cycles", () => {
    const duplicate = scheduleGraphFromSteps(baseSchedule)
    duplicate.nodes.push({ ...duplicate.nodes[0] })
    expect(validateScheduleGraph(duplicate).ok).toBe(false)

    const orphan = scheduleGraphFromSteps(baseSchedule)
    orphan.edges.push({ id: "missing", from: "custom-404", to: "custom-1", artifactMode: "summary" })
    expect(validateScheduleGraph(orphan).ok).toBe(false)

    const cyclic = scheduleGraphFromSteps(baseSchedule)
    cyclic.edges.push({ id: "cycle", from: "custom-2", to: "custom-1", artifactMode: "summary" })
    expect(() => compileScheduleGraph({ ...baseSchedule, graph: cyclic })).toThrow(/Invalid schedule graph|cycles/i)
  })
})
