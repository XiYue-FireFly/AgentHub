import { describe, expect, it } from "vitest"
import { parseEccQuickRef } from "../ecc-commands"
import { listEccCommands } from "../ecc-commands"
import { parseCommandText } from "../commands"

describe("ECC command registry", () => {
  it("parses slash commands from quick reference markdown", () => {
    const commands = parseEccQuickRef([
      "# Commands",
      "- `/plan` Create an implementation plan",
      "- `/tdd` Run a TDD workflow",
      "- `/plan` duplicate"
    ].join("\n"))

    expect(commands.map(command => command.label)).toEqual(["/plan", "/tdd"])
    expect(commands[0]).toMatchObject({ category: "ecc", source: "ecc", action: "insert" })
  })

  it("ships readable bundled Chinese command copy", () => {
    const combined = listEccCommands().map(command => command.description).join("\n")

    expect(combined).toContain("制定执行计划")
    expect(combined).not.toMatch(/鍒|璁|鏂|鈥|銆|�/)
  })

  it("parses slash command boundaries without broad prefix matching", () => {
    expect(parseCommandText("/browser https://agenthub.dev")).toEqual({ label: "/browser", args: "https://agenthub.dev" })
    expect(parseCommandText("/skill:code-review 当前改动")).toEqual({ label: "/skill:code-review", args: "当前改动" })
    expect(parseCommandText("/browser-automation 普通消息")).toEqual({ label: "/browser-automation", args: "普通消息" })
    expect(parseCommandText("请打开 /browser")).toBeNull()
  })
})
