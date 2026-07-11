import { execFileSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import { gitCommit, gitCreateBranch, gitCurrentBranch, runGit } from "../git"
import { getWorkspaceManager } from "../../hub/workspace"

function createRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "agenthub-git-"))
  execFileSync("git", ["init"], { cwd: root })
  execFileSync("git", ["config", "user.email", "agenthub@example.test"], { cwd: root })
  execFileSync("git", ["config", "user.name", "AgentHub Test"], { cwd: root })
  execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: root })
  writeFileSync(join(root, "README.md"), "hello\n")
  execFileSync("git", ["add", "README.md"], { cwd: root })
  execFileSync("git", ["commit", "-m", "init"], { cwd: root })
  return root
}

describe("git runtime public helpers", () => {
  it("reads the current branch from a real repository", async () => {
    const root = createRepo()
    const expected = execFileSync("git", ["branch", "--show-current"], { cwd: root }).toString().trim()

    expect(await gitCurrentBranch(root)).toBe(expected)
  }, 15000)

  it("handles Chinese filenames through git command arguments", async () => {
    const root = createRepo()
    const fileName = "中文 文件.md"
    writeFileSync(join(root, fileName), "第一行\n第二行\n")

    await runGit(root, ["add", "--", fileName])
    const { stdout } = await runGit(root, ["status", "--porcelain=v1", "-z"])

    expect(stdout).toContain(fileName)
  }, 15000)

  it.each(["\u0000", "\u001f"])("rejects branch names containing ASCII control character %#", async controlCharacter => {
    const root = createRepo()
    const manager = getWorkspaceManager()
    const getById = vi.spyOn(manager, "getById").mockReturnValue({
      id: "git-control-test",
      name: "git-control-test",
      rootPath: root,
      createdAt: Date.now(),
      updatedAt: Date.now()
    })
    try {
      await expect(gitCreateBranch("git-control-test", `invalid${controlCharacter}branch`, false)).rejects.toThrow()
    } finally {
      getById.mockRestore()
    }
  }, 15000)

  it("does not commit unselected staged files", async () => {
    const root = createRepo()
    writeFileSync(join(root, "selected.txt"), "selected\n")
    writeFileSync(join(root, "staged.txt"), "staged\n")
    await runGit(root, ["add", "--", "staged.txt"])

    const manager = getWorkspaceManager()
    const getById = vi.spyOn(manager, "getById").mockReturnValue({
      id: "git-test",
      name: "git-test",
      rootPath: root,
      createdAt: Date.now(),
      updatedAt: Date.now()
    })
    try {
      await gitCommit("git-test", "selected only", ["unstaged:selected.txt"])
    } finally {
      getById.mockRestore()
    }

    const committed = await runGit(root, ["show", "--name-only", "--format=", "HEAD"])
    const status = await runGit(root, ["status", "--porcelain=v1"])
    expect(committed.stdout).toContain("selected.txt")
    expect(committed.stdout).not.toContain("staged.txt")
    expect(status.stdout).toContain("A  staged.txt")
  }, 30000)
})
