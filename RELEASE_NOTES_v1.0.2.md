# v1.0.2

This release summarizes changes since `v1.0.1`.

## New Features

- Added clearer completed-run reporting for Agent execution summaries. Completed runs can now show historical failed attempts without marking the whole report as failed.
- Added local CLI model labeling for Codex, Gemini, and Claude-style local Agent runs in runtime events and usage request details.
- Added compatibility for common local CLI Agent aliases such as `codex-cli`, `gemini-cli`, and `claude-cli` when resolving local model configuration.
- Added smarter five-role execution visibility: router, lead, reviewer, executor, and gatekeeper runs are now grouped by schedule role so users can inspect each role independently.
- Added synthetic final chat release events for gated schedule output so run-only reviewer/executor details stay in the process panel while the final answer remains visible in chat.

## Fixes

- Fixed a usage statistics mismatch where local CLI requests could still appear as stale API provider models such as `openai / gpt-4o`, `anthropic / claude-sonnet-*`, or `local-cli / unknown`.
- Fixed stdio and ACP local Agent stream events so they prefer the current local CLI model from `localModels:readConfig` before falling back to route bindings.
- Fixed request detail records so new local CLI runs are recorded as `local-cli / <configured local model>` when a configured model is available.
- Fixed execution reports showing `failed` after the final turn was already completed because one intermediate tool attempt failed and then recovered.
- Fixed route-only and guard-only metadata cards inheriting a later Agent failure state.
- Fixed empty `0ms` execution reports appearing for cards that had no reportable tool activity, final output, file change, or terminal run state.
- Reworked execution report labels to distinguish final failure from completed runs with failed attempts.
- Fixed Claude stream JSON parsing so assistant message content blocks are extracted from `assistant.message.content[]` instead of being dropped as empty output.
- Fixed Codex stream JSON parsing for `agent_message`, `output_text`, and nested message content forms.
- Fixed local CLI runs that completed work through sub-agents but returned an empty final stdout. AgentHub now preserves completed sub-agent activity output as the step result instead of marking the run empty.
- Fixed non-blocking reviewer/gatekeeper failures in smart five-role mode. If the lead/synthesizer already produced output, guard failures are downgraded to warnings and no longer render as the primary failed answer card.
- Fixed same-agent multi-role runs overwriting each other in the output UI by grouping events with `agentId + scheduleRole + scheduleStepId`.
- Fixed completed tool streams remaining expanded forever when some tool activity did not receive a terminal event. Completed turns now finalize leftover running tool rows and collapse the process list by default.
- Fixed execution reports counting read/search activity as modified files. Only write-like operations are reported as file modifications.
- Fixed approval-required tool rows being counted as failed attempts when they were actually declined or blocked by approval policy.

## Tests

- Added dispatcher regression coverage for local CLI runs with stale API bindings and current local model config.
- Added usage request detail coverage to verify local CLI records use the locally configured model.
- Added ThreadView coverage for completed reports with failed attempts, route-only metadata status, and empty report suppression.
- Added ExecutionReport coverage for the new `outcome` field and completed reports with historical failed attempts.
- Added parser regression coverage for Claude and Codex stream JSON message extraction.
- Added runtime store regression coverage for same-agent repeated schedule roles.
- Added ThreadView regression coverage for schedule-role grouping, non-blocking guard fallback, process-only output, write-only file modification reporting, and completed tool stream folding.
- Added ToolCallStream coverage for completed-run collapse behavior.
- Verified full project test suite: 111 test files, 724 tests passing.

## Performance Improvements

- Reduced UI noise in completed runs by suppressing empty execution report cards.
- Reduced misleading error recovery loops by keeping final run status separate from intermediate failed attempts.
- Reduced usage page confusion by aligning local CLI request labels with the local model configuration already shown in Settings.
- Reduced long completed run cards by collapsing execution details automatically after completion while keeping the summary row available for inspection.
- Reduced unnecessary Markdown re-rendering in process-heavy smart schedule runs by keeping run-only events in the process/details area and releasing only the final answer to chat.

## Windows Installer

- `AgentHub-Setup-1.0.2.exe`
- `AgentHub-Setup-1.0.2.exe.blockmap`
