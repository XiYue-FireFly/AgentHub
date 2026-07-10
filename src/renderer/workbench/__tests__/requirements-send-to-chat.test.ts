import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

describe("requirements document chat dispatch", () => {
  it("exposes a first-class action to send the full requirement document into chat", () => {
    const editor = readFileSync(join(process.cwd(), "src/renderer/sdd/components/SddDraftEditor.tsx"), "utf8")
    const requirements = readFileSync(join(process.cwd(), "src/renderer/sdd/components/SddRequirementsList.tsx"), "utf8")
    const mainContent = readFileSync(join(process.cwd(), "src/renderer/workbench/WorkbenchMainContent.tsx"), "utf8")

    expect(editor).toContain("onSendToChat?: () => void")
    expect(editor).toContain("onSyncToTodo?: () => void")
    expect(editor).toContain("SddModelSelect")
    expect(editor).toContain("加入对话开发")
    expect(editor).toContain("Send doc to chat")
    expect(editor).toContain("同步 Todo")
    expect(editor).toContain("Sync Todo")
    expect(requirements).toContain("buildRequirementDocumentChatPrompt")
    expect(requirements).toContain("onSendRequirementToChat?: (prompt: string, modelSelection?: ModelSelection | null) => Promise<unknown>")
    expect(requirements).toContain("await onSendRequirementToChat(prompt, modelSelection)")
    expect(requirements).toContain("const handleSyncDocumentTodos = useCallback")
    expect(requirements).toContain("buildRequirementTodoMarkdown")
    expect(requirements).toContain("window.electronAPI.todos.syncFromMarkdown(threadId, todoMarkdown, source)")
    expect(mainContent).toContain("onSendRequirementToChat={(prompt, requirementModelSelection) => sendPrompt(prompt, [], { modelSelection: requirementModelSelection ?? modelSelection })}")
    expect(mainContent).toContain("onRequirementSentToChat={() => setView('chat')}")
    expect(mainContent).toContain('className="wb-scroll-surface wb-requirements-surface"')
  })
})
