import { describe, expect, it } from "vitest"
import { listSchedules, previewSchedule, toDispatcherMode } from "../schedules"

describe("runtime schedules", () => {
  it("includes an editable custom schedule preset", () => {
    const custom = previewSchedule("custom")

    expect(listSchedules().some(schedule => schedule.preset === "custom")).toBe(true)
    expect(custom.label).toBe("自定义调度")
    expect(custom.steps[0].agentId).toBe("codex")
  })

  it("maps custom schedules to a safe dispatcher fallback", () => {
    expect(toDispatcherMode("custom")).toBe("chain")
  })
})
