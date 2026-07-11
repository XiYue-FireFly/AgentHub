# AgentHub 测试与复核记录（ChatGPT 审计轮）

> 分支：`chatgpt`
> 基线 HEAD：`40a7c1222d631c58bb1f4b51ebafed2a0f3a550d`
> 规则：只记录实际执行及完整返回的结果；每批修复后追加 RED/GREEN、邻接测试、独立复核和阶段回归。

## 1. 环境与工作树基线

| 项 | 结果 |
|---|---|
| OS / Shell | Windows / PowerShell |
| Node | `v24.15.0` |
| npm | `11.12.1` |
| 初始分支 | `main...origin/main`，clean |
| 工作分支 | 新建并切换 `chatgpt` |
| 基线 HEAD | `40a7c1222d631c58bb1f4b51ebafed2a0f3a550d` |
| 依赖安装 | `npm ci --no-audit --no-fund`，exit 0，649 packages |

## 2. 修复前完整基线

| 命令 | Exit | 结果 |
|---|---:|---|
| `npm run typecheck` | 0 | TypeScript project references 通过 |
| `npm run lint` | 1 | 3 errors、40 warnings；见 AH-051 |
| `npm test -- --reporter=dot` | 0 | 242 files / 1536 tests 全部通过，39.85s |
| `npm run build` | 0 | main/preload/renderer 生产构建通过；Vite 报动态/静态 import 和 bundle warning |
| `npm run test:e2e` | 0 | 1 Electron smoke 通过，13.2s |
| `npm run build:win` | 0 | NSIS `AgentHub-Setup-2.0.0.exe`、blockmap、win-unpacked 生成，54.3s |
| `npm audit --omit=dev --json` | 0 | npm 分类的 prod dependencies 0 vulnerabilities |
| `npm audit --json` | 1 | 15 vulnerable nodes：1 critical、12 high、2 moderate；见 AH-049/AH-050 |
| `node scripts/check-large-files.js` | 0 | 报 `ipc-contract.ts` 7362 行；按用户要求不拆文件 |
| `node scripts/check-css-variables.js` | 0 | 30 个硬编码色 warning；不作为现行 Bug |
| `node scripts/check-bundle-size.js` | 1 | JS 1749.9 KB / CSS 377.0 KB / total 2126.9 KB，超过既有 1200 KB 预算 |

## 3. CLI 基线

使用本轮专用系统临时目录 `C:\Users\pyh20\AppData\Local\Temp\agenthub-chatgpt-audit-cli`：

| 命令 | Exit | 结果 |
|---|---:|---|
| `npm run cli -- version` | 0 | JSON version `2.0.0` |
| `npm run cli -- run ... --dry-run --runs-dir <temp>` | 0 | `status=dry-run` |
| `npm run cli -- run ... --mock --runs-dir <temp>` | 0 | `status=completed`，mock echo 正确 |

两条 run 均向 stderr 输出 `MODULE_TYPELESS_PACKAGE_JSON`，登记为 AH-053。一次未带 `--run-id` 的 `status` 返回“required”属于预期参数校验，不计失败。

## 4. 安全/静态复现证据

- Windows cmd 注入：按生产 quoting 生成 `echo -z "hello\\\" & echo AGENTHUB_INJECTION_PROOF ..."`，stdout 独立出现 marker，exit 0（AH-002）。
- ACP 工具分类：`delete_file`、`move_file`、`rename_file` 对现有 `\b...\b` 正则均为 false（AH-004）。
- Workspace、MCP、审批和竞态问题均由当前可达调用链与相邻实现交叉核对；撤回了“Provider/Models 重复注册导致启动失败”误报，因为两个注册模块均有幂等守卫且 Electron E2E 通过。

## 5. 测试副产物

全量单测在仓库根生成：

```text
test-tmp-backup-security/backups/agenthub-backup-2026-07-10T00-40-11-163Z.json
```

来源已定位到 `backup-security.test.ts` 缺少 afterEach（AH-052）。在该 Bug 的 RED/GREEN 与最终工作树检查完成前保留现场；之后只删除已解析并确认位于仓库根内的该测试目录。

## 6. 文档与规划复核

| 产物 | Reviewer 轮次 | 结果 |
|---|---:|---|
| `agenthub.md` + `CHATGPT_BUGFIX_PLAN.md` | 1 | BLOCK：lint 门禁矛盾、CLI 污染、历史恢复措辞、目录覆盖、消息顺序 |
| 同上修订 | 2 | BLOCK：两处目录职责、固定临时目录清理风险 |
| 同上二次修订 | 3 | PASS |

## 7. 逐批修复记录

用户随后要求恢复“有风控的部分”。本轮仅记录本地防御代码、依赖审计和测试证据，不展开攻击性细节；B03、B04、B07、B17 及 AH-055 导航子项已恢复执行并补充验证。

| 批次 | Bug | RED | GREEN/邻接 | 独立复核 | 阶段回归 | 状态 |
|---|---|---|---|---|---|---|
| B01 | AH-001 | 旧实现对 HTTPS 不调用 preventDefault；补测后 blob 同源绕过再次 RED | 目标 4/4、邻接 9/9、typecheck 通过 | 首审 BLOCK（blob 同源）；修正后 PASS | 242 files / 1537 tests；build 通过；lint 保持基线 3 errors/40 warnings | 已复核 |
| B02 | AH-002 | 真实 `.cmd` 防御 fixture 在旧实现下会把特殊字符拆出原始 argv；PATH 中无扩展 shim 优先时会导致裸命令 resolution 失败 | 目标 1 file / 2 tests；邻接 3 files / 24 tests；typecheck 通过；lint 回到基线 3 errors / 40 warnings | 首审 BLOCK（裸命令先命中无扩展 shim）；补 PATH fixture 后复审 PASS；最终只读复核 PASS | 243 files / 1539 tests；build 通过 | 已复核 |
| B03 | AH-003～005 | 现有回归覆盖 ACP 无有效 session/handler fail-closed、snake_case 写入类工具分类、nested rawInput 风险路径 | ACP client/dispatcher approval 目标测试通过；`policyForWithRisk` 使用 canonical risk | B03 子代理因 429 未返回；主线程按当前源码与测试复核 | `acp-client` + `dispatcher-acp-approval` 目标测试通过；全量门禁见 2.0.1 发布验证 | 已复核 |
| B04 | AH-006～007 | B04/B07 只读审查指出 ACP request timeout 后 server/pending/session 状态需 fail-closed 清理 | ACP JSON-RPC request timeout 现在 stop client 并清 pending/session；cancel grace 后 stop adapter | 生命周期审查子代理指出缺口，主线程补丁后目标测试 GREEN | `acp-client` + `acp-adapter-lifecycle` 2 files / 22 tests 通过 | 已复核 |
| B05 | AH-008～010 | 首轮新增测试在旧实现下 6 failed / 18 passed：命中计划数量/重复 ID、执行峰值并发、local busy 与 verifier error 重跑；质量审查返工再补 4 个 RED，覆盖取消队列/预处理/stdio start 竞态和长 ID 截断碰撞 | 目标 2 files / 28 tests；Hub 邻接复核 128/128；typecheck 与 diff check 通过 | 规格复核 PASS；质量首审 BLOCK（取消后排队请求晚启动、长 ID 碰撞丢项），返工复审 PASS | 243 files / 1549 tests；build 通过；lint 保持基线 3 errors / 40 warnings | 已复核 |
| B06 | AH-011～013、019 | 首轮 hardening 10 tests 中 8 failed；三轮质量返工分别新增 6、6、3 个 RED，覆盖字段白名单、JSON/SSE 状态机顺序、stdio 终态、输出边界与 timer 早退 | hardening 32/32；MCP 4 files / 56 tests；runtime 邻接 18/18；typecheck 与 diff check 通过 | 规格复核 PASS；质量连续三轮 BLOCK 后逐项返工，第四轮复审 PASS | 累计 P2/P3 未到阶段回归阈值 | 已复核 |
| B07 | AH-014～016 | B04/B07 只读审查指出 POSIX process group/terminal cancel 需要明确断言 | terminal 新增 POSIX cancel kill PGID 断言；既有 agentic exec abort、stdio/headless POSIX detached 逻辑保留 | 生命周期审查子代理指出缺口，主线程补测试后目标测试 GREEN | terminal/agentic/approval 5 files / 23 tests 通过 | 已复核 |
| B08 | AH-017～018 | 首轮 RED 复现三类 150 次前置失败各累积 150、缺少 finished/removed 接线及 running-delete 错序；质量返工继续新增 in-flight 清理、pending delete、observer 异常、取消终态、stable ID 与快照污染 RED | 最终目标/扩展邻接 8 files / 105 tests；typecheck、diff check 通过 | 规格复核 PASS；质量三轮 BLOCK 后逐项返工，第四轮复审 PASS | 246 files / 1615 tests；build 通过；lint 串行复跑保持基线 3 errors / 40 warnings | 已复核 |
| B09 | AH-020、043～044 | 首轮 9 tests 中 8 failed；质量返工扩展为 18 tests 后新增 9 个 RED，覆盖嵌套模态、并发确认、焦点恢复、连续审批、busy close 与 Palette 单焦点模型 | 目标 5 files / 18 tests；全 renderer 78 files / 406 tests；typecheck、限定 ESLint、diff check 通过 | 规格复核 PASS；质量首审 BLOCK，模态栈/Palette/连续审批返工后复审 PASS | 251 files / 1633 tests；build 通过；lint 保持基线 3 errors / 40 warnings | 已复核 |
| B10 | AH-021～023 | 首轮覆盖 resolve true/false/reject、历史 pending、五类策略映射；质量返工新增 task finish 清理、active-ID 重启求交、legacy 单/多 pending、跨视图 notice、preset 并发锁；终审再以 1 个 RED 复现 finish 后晚到审批重新挂起 | 最终目标 10 files / 107 tests；Hub/agentic 邻接 6 files / 107 tests；Renderer workbench/screens 52 files / 276 tests；typecheck、限定 lint、diff check 通过 | 规格复核 PASS；质量先后 BLOCK 四个生命周期/展示边界与一个 late-approval 竞态，逐项 TDD 返工后最终 PASS | 254 files / 1700 tests；typecheck/build 通过；lint 保持基线 3 errors，warnings 由 40 降至 39 | 已复核 |
| B11 | AH-024、033～034 | 初始 20 条行为测试中 12 RED，覆盖提前清空、附件丢失、FIFO 残留、失败继续、浅快照、slash 入队、失效目标改派与刷新误判；多轮复核继续补 Stop/owner、Auto/Broadcast、graph/steps、route+owner 组合及跨 head stale 标记 RED | 最终 B11 4 files / 68 tests；全 Renderer 81 files / 479 tests；typecheck、限定 ESLint、diff check 通过 | 规格/质量多轮 BLOCK，逐项 TDD 关闭 schedule 改派、真实 Stop、跨视图队列、owner 恢复、placeholder/canonical schedule 与 keyed submission 状态；最终双复核 PASS | 255 files / 1734 tests；typecheck/build 通过；lint 保持基线 3 errors / 39 warnings | 已复核 |
| B12 | AH-025、031、037～039 | 覆盖 autosave 反序、仅 designContext 修改、A 慢/B 快及 same-key load/history/parse/delete ABA；质量返工新增 delete/load 两种完成顺序与跨 workspace 同 ID trace RED；模型切换 actual M1/expected M2；后台证据归属 3 条 Windows/unknown 与 2 条 POSIX case RED | action 64/64；closed-loop + Assistant 33/33；runtime event 21/21；B12 组合 22 files / 244 tests；各目标 typecheck、限定 ESLint、diff check 通过 | AH-025/037、AH-039、AH-038、AH-031 均按规格→质量复核；先后 BLOCK stale parse/Todo fallback、delete/load ghost、无效 provider fixture、POSIX root 碰撞，逐项 TDD 返工后最终双 PASS | B12 组合 22 files / 244 tests；受限 worker 全量 265 files / 1871 tests、typecheck、build、diff check 通过；lint 保持基线 3 errors / 39 warnings | 已复核 |
| B13 | AH-026～029 | AH-026 覆盖普通/围栏未知 JSON 保留；AH-027 覆盖连续 reject、空配置、stale timer 与卸载；AH-028 覆盖异步外观/语言恢复、system 重订阅与非法 detail；AH-029 首轮 7/7 RED，后续复核继续以 RED 关闭跨资源失败、迟到权威 reload、迟到 configChanged 与卸载后 reload | B13 目标 5 files / 27 tests；AH-029 目标与邻接 5 files / 26 tests；目标限定 ESLint、tracked/untracked diff check 通过 | AH-026～029 均完成规格→质量复核；AH-029 先后 BLOCK 跨资源失败伪乐观值、迟到事件快照与卸载后重试，逐项 TDD 返工后双 PASS | B13 行为回归 5 files / 27 tests、全仓 typecheck、B13 diff checks 通过；限定 ESLint 0 errors，`ThreadView` 保持 1 个既有 warning | 已复核 |
| B14 | AH-030、032、035、040～042 | AH-030 覆盖空 workspace 有限重试、恢复、personal sentinel 与 stale load；AH-032 覆盖 A Todo 迟到 resolve/reject；AH-035 覆盖 route 可见/run-only 隐藏；AH-040 首轮 8/10 RED，复核继续以 1/13 和 4/17 RED 关闭旧 selectThread、非法 event 与 refresh-failure invalidation；AH-041 返工 4/11 RED；AH-042 首轮 5/5 RED | AH-040 2 files / 17 tests；AH-041 11 tests；AH-042 8 tests；B14 目标组合 7 files / 45 tests；各目标限定 ESLint、diff checks 通过 | 六项均完成规格→质量复核；AH-040 BLOCK 旧 selectThread、非法 detail、成功 mutation 后 refresh 失败，AH-041 BLOCK CRUD/unmount owner，AH-042 BLOCK 假 facets/pricing/selection 覆盖，逐项 TDD 返工后最终双 PASS | B14 目标组合 7 files / 45 tests、全仓 typecheck、tracked diff check 通过 | 已复核 |
| B15 | AH-036、045～047 | AH-036/AH-045 覆盖统一 sidebar width 与 320 CSS px 导航重排；AH-046 覆盖中英文显示、搜索、fallback 与即时切换；AH-047 三个真实组件中文用例分别 RED、英文原本通过 | AH-036/AH-045 5 files / 36 tests；AH-046 目标 8/8；AH-047 目标 3 files / 6 tests、AH-042 race 8/8、完整保护组合 8 files / 62 tests；各目标限定 ESLint、diff checks 通过 | AH-036、AH-045、AH-046、AH-047 均完成规格→质量双复核并最终 PASS；AH-047 仅为既有 Usage 竞态测试补显式英文前置，未改断言或竞态时序 | 各单项 typecheck/目标依赖闭包检查通过；B15 最新保护组合 8 files / 62 tests，当前全仓 typecheck 另受 main 侧外部 Promise API 漂移影响，留待最终门禁复核 | 已复核 |
| B16 | AH-048 | 初始只读回归 1 RED / 1 PASS，确认四项伪配置仍可编辑而 Route Test 原本可用；质量返工再以 1 RED 复现四个 `output` 均无可访问名称 | 目标与 Agent Loop 邻接 3 files / 13 tests；typecheck、限定 ESLint、tracked/untracked diff check 通过 | 规格 PASS；质量首审 BLOCK 无名称 output、值样式与测试选择器缺口，补唯一 label 关联、既有 strong 样式及全面不可编辑断言后复审 PASS | B16 组合 3 files / 13 tests、全仓 typecheck 通过；限定 ESLint 0 errors，保留 1 个既有 `alive` warning | 已复核 |
| B17 | AH-049～050 | 依赖版本兼容审查确认 root Vite 7 需配套 electron-vite 5；旧 audit 漏洞需重新验证 | 已升级并锁定 Electron 43.1.0、electron-builder 26.15.3、electron-vite 5.0.0、Vite 7.3.6、happy-dom 20.10.6；prod/full `npm audit` 均 0 vulnerabilities | 依赖只读审查给出兼容约束；主线程按 lock/tree/audit 验证 | `npm ls` 目标依赖通过；`npm audit --omit=dev --json` 与 `npm audit --json` exit 0 | 已复核 |
| B18 | AH-051～055 | AH-051 复现 lint 3 errors；AH-052 复现仓库根测试残留；AH-053 真实捕获 CLI MODULE_TYPELESS stderr；AH-054 复现错误 branch baseline；AH-055 复现 evaluate click、弱焦点及覆盖缺口 | AH-051 lint 0 errors / 37 warnings；AH-052 连续两轮 2/2 无新增残留；AH-053 CLI 5/5 且默认 runs 快照不变；AH-054 1/1；AH-055 Electron E2E 4 passed，含本地 `file:` top-level navigation block | AH-051～054 规格/质量双复核 PASS；AH-055 导航审查确认当前用例已 active 且无 HTTP(S)/localhost/外部网络兜底 | sandbox 内 E2E 启动 crash 后按权限规则沙箱外原命令复跑 4 passed；fresh typecheck/lint/test/build/build:win 见 2.0.1 发布验证 | 已复核 |
| B19 | AH-056～058 | AH-056 复现 `Promise<T>` 赋给 `Promise<void>` 与 token flush unhandled rejection；AH-057 复现第二次 quit 未拦截及 exit 抛错后不重试；AH-058 复现 shutdown 提前于真实 stdio stop/延迟终态返回、双 deadline 后无界等待及 dispose 首次失败不可重试 | `store-local-token` 23/23；will-quit 2/2；质量返工组合 3 files / 71 tests；精确 B19 9 files / 134 tests；真实 Dispatcher/stdio、tracking、producer、dispose barrier 与 late stream 均通过 | 规格复审 PASS；质量首审 BLOCK exit retry、dispose retry、token rejection 三项，逐项 RED→GREEN 后复审 PASS | fresh typecheck、限定 ESLint 0 errors、tracked/untracked diff checks 通过；最终全量 build/test 门禁见下节 | 已复核 |
| B20 | AH-059～062 | AH-059 依次复现旧 A 选择覆盖 B、stale error、通过首个检查后的迟到数据及 rename refresh 反序；AH-060 复现 interrupted 后恢复旧审批；AH-061 根级语言切换复现 Workbench 重挂与本地状态丢失；AH-062 plan/chat ABA 均 RED | AH-059 目标 17/17、邻接 4 files / 27 tests；AH-060 33/33；AH-061 根级 1/1 且实现期组合 11 files / 73 tests；AH-062 26/26；各范围限定 ESLint 与 diff checks 通过 | AH-060/AH-062 规格与质量均一次 PASS；AH-059 规格首轮因证据缺口 BLOCK、质量首轮因 refresh 反序 BLOCK，逐项返工后均 PASS；AH-061 规格/质量 PASS | B19 外部并发写入前 fresh typecheck exit 0；后续 main 中间态不归因于 B20，最终统一门禁待 B19 收敛后重跑 | 已复核 |
| B21 | AH-063～064 | 默认全量在外部迁移中间态出现 5 个失败；最终规格审查再以 3 个 RED 复现 exact-step 被较新 partial 抢占、已知 step/role 冲突仍任意结算及多 partial 歧义回退 | Store 55/55；B19+B21 组合 11 files / 187 tests；typecheck、限定 ESLint 0 diagnostics；13 文件 hash/mtime 稳定 | 规格首审 BLOCK `exactTask[0]` 与缺 step 非唯一回退；改为 task exact-first、step/role 唯一匹配及歧义 fail-closed 后复审 PASS；独立质量复审 PASS（窄测 2 files / 68 tests） | 最终完整 4-worker 套件在 B21 稳定快照上待重跑 | 已复核 |
| B22 | AH-065～066 | Workbench 受控移除 owner/generation 门禁时 4 个关键竞态 RED；SDD 首轮 2 RED / 64 PASS，规格返工再以 2 RED / 66 PASS 关闭 edit→switch 与 initially-inactive interleaving | Workbench runtime events 28/28；SDD actions 68/68；两域限定 ESLint、typecheck 与 diff check 通过 | 两项均经历规格 BLOCK→返工→SPEC PASS；独立质量复审均 PASS，文件前后 hash 稳定 | 最新全量 286 files / 2169 tests、coverage 与 build 见下节 | 已复核 |
| B23 | AH-067～069 | 初始 typecheck 因缺 `decision-service` 模块失败；质量审查新增 shutdown cleanup、timeout 热循环、Abort/terminal 丢重试 4 RED，终审再新增 terminal reject + pending effect 组合 RED | DecisionService 36/36；Store 59/59；typecheck、限定 ESLint 通过；startup/shutdown wiring 测试通过 | 多轮 DRIFT 快照全部废弃；稳定快照先 SPEC PASS，质量两轮 BLOCK 后逐项返工，最终 SPEC/QUALITY PASS 且三文件 hash 一致 | 最新全量 286 files / 2169 tests、coverage、build、E2E、Windows package、GUI 与 CLI 见下节 | 已复核 |

## 8. 最终审计追加项与最新门禁

最终双视角审查先新增 7 个非网络问题（AH-056～AH-062，B19/B20）；最终全量又捕获 2 个外部迁移中间态回归（AH-063～AH-064，B21）。登记时证据（含 AH-056 已应用的最小类型修复）如下：

- AH-056：atomic runtime-store 迁移期间 `AppStore.commit<T>()` 的 `Promise<T>` 曾直接赋给 `Promise<void>` 共享链；改为显式 void 投影后，2026-07-11 fresh `npm run typecheck` exit 0。该文件域当时仍有外部并发写入，待稳定后再跑目标测试与复核。
- AH-057：第二次 `will-quit` 在 cleanup flag 已置位时直接返回，未再次 `preventDefault()`。
- AH-058：shutdown 只在 `registry.stopAll()` 后等待一次 `setImmediate`，没有 Dispatcher quiescence 证明。
- AH-059：`selectWorkspace()` 未递增 `selectThreadGenRef` 或清 pending selection。
- AH-060：approval 自维护终态列表缺少 `interrupted`，与共享 turn-status 不一致。
- AH-061：实时语言切换通过 `key={lang}` 重挂整个 Workbench。
- AH-062：SDD AI 返回前后未比较请求 source snapshot，A→B→A 可形成 ABA。

B19/B20 统一验收前的最近一次全量快照：

| 命令/检查 | Exit | 结果 |
|---|---:|---|
| `npm test -- --reporter=dot` | 0 | 277 files / 2009 tests |
| `npm test -- --coverage` | 0 | 277 files / 2009 tests；statements 63.51%，lines 68.10% |
| `npm run lint` | 0 | 0 errors / 37 warnings |
| `npm run build` | 0 | production build 通过 |
| `node scripts/check-bundle-size.js` | 1 | JS 1823.5 KB，CSS 378.0 KB，总计 2201.5 KB / 1200 KB |
| Windows installer（系统临时输出） | 0 | 原 `dist` 被 Typora 锁定；改用系统临时输出后 installer 生成成功 |
| unpacked GUI smoke | 未确认 | 工具的 Windows Job 终止行为未留下可靠启动证据，不宣称通过 |
| CLI version/dry-run/mock/status/logs | 0 | stderr 干净；默认 `~/.agenthub/cli-runs` 129→129，哈希快照不变 |
| `git diff --check` + 未跟踪文本检查 | 0 | 无 whitespace 诊断 |

B21 收敛、最终 warning 清理与无网络验收后的 fresh 快照：

| 命令/检查 | Exit | 结果 |
|---|---:|---|
| `npm run typecheck` | 0 | fresh 通过 |
| `npm run lint` | 0 | 0 errors / 37 warnings；移除 B19/B21 测试新增的 2 个 unused warning 后回到登记基线 |
| `npm test -- --reporter=dot --maxWorkers=4` | 0 | 284 files / 2114 tests |
| `npm test -- --coverage --maxWorkers=4` | 0 | 284 files / 2114 tests；statements 64.20%，lines 68.82% |
| `npm run build` | 0 | production build 通过 |
| `node scripts/check-bundle-size.js` | 1 | JS 1824.1 KB，CSS 378.0 KB，总计 2202.0 KB / 1200 KB；保持已登记观察项，不扩成无行为证据的 Bug |
| `npm run test:e2e -- --reporter=line` | 0 | 清理首次失败遗留的本轮 Electron PID 后，完整复跑 3 passed / 1 skipped；三个非跳过用例单独运行也均 PASS，导航子项继续按用户指示禁止网络兜底 |
| `npm run build:win -- --config.directories.output=<system-temp>` | 0 | NSIS installer 与 `win-unpacked` 生成成功；未触碰被 Typora 占用的仓库 `dist` |
| unpacked GUI smoke | 0 | 独立临时 userData；真实 `AgentHub.exe` 打开 `file://.../app.asar/out/renderer/index.html`，标题 AgentHub，`.wb-root` 可见并正常关闭 |
| CLI version/dry-run/mock/status/logs | 0 | 全部离线通过；默认 runs 前后均 129 files / 17716 bytes，内容 SHA256 `985C72D3...E559FCC` 不变；隔离临时目录已清理 |
| tracked + 59 个 untracked 文本 diff checks | 0 | 无 whitespace 诊断 |
| `npm ci` / `npm audit` | skipped | 按用户“跳过可能触发网络风控的内容”指示不执行，不据此声称依赖审计通过 |

B22/B23 收敛后的最终稳定快照（2026-07-11）：

| 命令/检查 | Exit | 结果 |
|---|---:|---|
| `npm run typecheck` | 0 | fresh 通过 |
| `npm run lint` | 0 | 0 errors / 37 warnings，warning 数未增加 |
| `npm test -- --reporter=dot --maxWorkers=4` | 0 | 286 files / 2169 tests |
| `npm test -- --coverage --maxWorkers=4` | 0 | 286 files / 2169 tests；statements 64.74%，branches 54.39%，functions 60.44%，lines 69.33% |
| `npm run build` | 0 | main/preload/renderer production build 通过 |
| `node scripts/check-bundle-size.js` | 1 | JS 1825.4 KB，CSS 378.0 KB，总计 2203.4 KB / 1200 KB；保持既有预算观察项 |
| `npm run test:e2e -- --reporter=line` | 0 | sandbox 内 GPU/child-process 权限诊断失败；按权限规则在沙箱外原命令复跑 3 passed / 1 skipped，未使用网络导航兜底 |
| `npm run build:win -- --config.directories.output=<system-temp>` | 0 | NSIS installer 与 `win-unpacked` 生成成功，仓库 `dist` 未触碰；记录后安全清理临时输出 |
| unpacked GUI smoke | 0 | 沙箱外、独立临时 userData；真实 `AgentHub.exe` 标题 `AgentHub`，`file://.../app.asar/out/renderer/index.html` 的 `.wb-root` 可见并正常关闭 |
| CLI version/dry-run/mock/status/logs | 0 | 全部离线通过且 stderr 为 0；默认 runs 前后均 129 files / 17716 bytes，当前快照 SHA256 `143CED8C...1C3500` 不变；隔离目录已清理 |
| tracked + 63 个 untracked 文本 diff checks | 0 | 无 whitespace 诊断；代码文档更新前 157 文件 manifest 为 `A44FCA82...EF0316` |
| `npm ci` / `npm audit` | skipped | 继续按用户网络风控指示跳过，不声明依赖审计通过 |

## 9. 最终验收

- [x] 工作树修改已与冻结清单/追加 B19～B23 对齐；本轮系统临时 build/CLI/userData 均已清理。仓库根 `test-tmp-backup-security/` 是修复前已登记审计现场，按当前保护约束保留，不冒充新副产物。
- [x] typecheck、lint、2169 单测、coverage、build、Electron E2E 全部 fresh exit 0。
- [x] Windows build:win 与 unpacked app smoke 通过。
- [~] npm audit 按用户网络风控指示跳过；不声称依赖漏洞门禁通过。
- [x] CLI version/dry-run/mock/status/logs 通过且默认目录内容哈希不变。
- [x] Main/runtime 与 Renderer/SDD 两个独立终审子代理在稳定 hash 上均无未关闭 BLOCK；B22/B23 逐项规格/质量复审均 PASS。

## 10. 风控恢复与 2.0.1 发布验证（2026-07-11）

用户恢复“有风控的部分”后，本轮补齐 B03/B04/B07/B17 与 AH-055 导航子项，并准备 `v2.0.1` GitHub Release / Windows installer。安全相关说明仅保留本地防御代码与测试证据。

| 命令/检查 | Exit | 结果 |
|---|---:|---|
| `npm run test -- --reporter=dot src/main/hub/adapters/__tests__/acp-client.test.ts src/main/hub/adapters/__tests__/acp-adapter-lifecycle.test.ts` | 0 | 2 files / 22 tests；ACP permission fail-closed、request timeout stop/cleanup、cancel grace lifecycle 通过 |
| `npm run test -- --reporter=dot src/main/runtime/__tests__/terminal.test.ts src/main/agentic/__tests__/tools-abort.test.ts src/main/agentic/__tests__/tools.test.ts src/main/agentic/__tests__/executor.test.ts src/main/hub/__tests__/dispatcher-acp-approval.test.ts` | 0 | 5 files / 23 tests；POSIX process group cancel、agentic abort、ACP risk approval 通过 |
| `npm run typecheck` | 0 | fresh 通过 |
| `npm run lint` | 0 | 0 errors / 37 warnings |
| `npm test -- --reporter=dot --maxWorkers=4` | 0 | 289 files / 2188 tests |
| `npm run build` | 0 | main/preload/renderer production build 通过 |
| `npm run test:e2e -- --reporter=line` | 0 | sandbox 内启动 crash 后，按权限规则沙箱外原命令复跑 4 passed；AH-055 本地 `file:` 导航子项已 active，无 HTTP(S)/localhost/外部网络兜底 |
| `npm ls electron electron-builder electron-vite vite happy-dom @vitejs/plugin-react --depth=0` | 0 | `electron@43.1.0`、`electron-builder@26.15.3`、`electron-vite@5.0.0`、`vite@7.3.6`、`happy-dom@20.10.6`、`@vitejs/plugin-react@4.7.0` |
| `npm audit --omit=dev --json` | 0 | prod dependencies 0 vulnerabilities |
| `npm audit --json` | 0 | full tree 0 vulnerabilities；metadata total dependencies 622 |
| `npm run test -- --reporter=dot src/main/__tests__/version-sync.test.ts` | 0 | `package.json.version`、`build.buildVersion`、`VERSION.md` 同步到 2.0.1 |
| `npm run build:win -- --config.directories.output=C:\Users\pyh20\AppData\Local\Temp\agenthub-release-2.0.1` | 0 | NSIS installer、blockmap、latest.yml、win-unpacked 生成；仓库 `dist` 未触碰 |

发布产物：

| 文件 | 大小 | SHA256 |
|---|---:|---|
| `C:\Users\pyh20\AppData\Local\Temp\agenthub-release-2.0.1\AgentHub-Setup-2.0.1.exe` | 105,892,406 bytes | `BFCAEC1261A1F8FF646C35375E3BD4554DD00EB0D4A6756D9975E8E75376F2D6` |
| `C:\Users\pyh20\AppData\Local\Temp\agenthub-release-2.0.1\AgentHub-Setup-2.0.1.exe.blockmap` | 110,888 bytes | `1CDC041644BE59ECDBC8088189E3BA9221409167C044C39790660F4A273AB8DB` |

`latest.yml` 记录 version `2.0.1`，installer `sha512` 为 `MayYb0CeFldK/MyWbmJ7Vy2tLpQpaCumowlpKclt+OG68RuyntC2z0+JPYBheMp9S6jxr5bvMEyaANIFgRQTIQ==`。
