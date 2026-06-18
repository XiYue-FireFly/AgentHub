/* ============================================================
   AgentHub — 变体画布
   总览页 3 种布局/密度变体 + 会话回复 2 种样式
   ============================================================ */

const VAR_BG = "linear-gradient(160deg, #151922 0%, #101319 60%, #0c0f15 100%)";

function VFrame({ children, height }) {
  return (
    <div style={{ position: "relative", width: "100%", height: height || "100%", background: VAR_BG, overflow: "hidden", fontFamily: "var(--font-ui)", color: "var(--tx-1)", fontSize: 14 }}>
      <div style={{ position: "absolute", width: 420, height: 420, borderRadius: "50%", filter: "blur(90px)", background: "rgba(64,116,168,0.30)", top: -140, left: -80 }}></div>
      <div style={{ position: "absolute", width: 380, height: 380, borderRadius: "50%", filter: "blur(90px)", background: "rgba(72,168,150,0.20)", bottom: -160, right: -60 }}></div>
      <div style={{ position: "relative", height: "100%", display: "flex", flexDirection: "column" }}>{children}</div>
    </div>
  );
}

function VTitlebar() {
  return (
    <div style={{ height: 36, flex: "none", display: "flex", alignItems: "center", gap: 10, padding: "0 14px" }}>
      <div style={{ display: "flex", gap: 6 }}>
        {["#ec6a5e", "#f4bf4f", "#61c554"].map(c => <span key={c} style={{ width: 10, height: 10, borderRadius: "50%", background: c }}></span>)}
      </div>
      <span style={{ fontSize: 11.5, fontWeight: 600 }}>AgentHub</span>
      <span style={{ flex: 1 }}></span>
      <span style={{ fontSize: 10, color: "var(--mint)" }}>● Hub 运行中</span>
    </div>
  );
}

function VAgentRow({ id, dense }) {
  const m = AGENT_META[id];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: dense ? "5px 8px" : "7px 10px", borderRadius: 9 }}>
      <AgentMark id={id} size={dense ? 20 : 24} radius={6} />
      <span style={{ fontSize: dense ? 11 : 12, flex: 1 }}>{m.name}</span>
      <span className={"ah-dot " + (id === "hermes" ? "off" : "idle")} style={{ width: 6, height: 6 }}></span>
    </div>
  );
}

/* ---------- 变体 A：封面卡片网格（当前方案） ---------- */
function VariantA() {
  return (
    <VFrame>
      <VTitlebar />
      <div style={{ flex: 1, display: "flex", gap: 10, padding: "0 12px 12px", minHeight: 0 }}>
        <div className="glass" style={{ width: 150, padding: 10, borderRadius: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, padding: "2px 8px 8px" }}>工作台</div>
          {["总览", "会话", "任务", "设置"].map((n, i) => (
            <div key={n} style={{ fontSize: 11.5, padding: "6px 10px", borderRadius: 8, background: i === 0 ? "rgba(255,255,255,0.1)" : "none", color: i === 0 ? "var(--tx-1)" : "var(--tx-2)", fontWeight: i === 0 ? 600 : 400 }}>{n}</div>
          ))}
          <div style={{ borderTop: "1px solid var(--glass-border)", margin: "8px 4px" }}></div>
          {Object.keys(AGENT_META).map(id => <VAgentRow key={id} id={id} dense />)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 700, margin: "2px 0 1px" }}>下午好</div>
          <div style={{ fontSize: 10.5, color: "var(--tx-2)", marginBottom: 10 }}>3 个 Agent 在线 · 今日完成 2 个</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {Object.keys(AGENT_META).map(id => {
              const m = AGENT_META[id];
              return (
                <div key={id} className="glass" style={{ padding: 12, borderRadius: 14, display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                    <AgentMark id={id} size={34} radius={9} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700 }}>{m.name}</div>
                      <div style={{ fontSize: 9.5, color: "var(--tx-3)" }}>{m.desc}</div>
                    </div>
                    <span className={"ah-dot " + (id === "hermes" ? "off" : "idle")} style={{ width: 6, height: 6 }}></span>
                  </div>
                  <div style={{ fontSize: 9.5, fontFamily: "var(--font-mono)", color: "var(--tx-2)", background: "rgba(0,0,0,0.22)", borderRadius: 7, padding: "5px 8px" }}>
                    {id === "codex" ? "本地 CLI · stdio" : "HTTP · " + id}
                  </div>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {m.caps.slice(0, 3).map(c => <span key={c} className="ah-chip" style={{ fontSize: 8.5, padding: "1px 7px" }}>{c}</span>)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </VFrame>
  );
}

/* ---------- 变体 B：列表 + 详情双栏（紧凑） ---------- */
function VariantB() {
  return (
    <VFrame>
      <VTitlebar />
      <div style={{ flex: 1, display: "flex", gap: 10, padding: "0 12px 12px", minHeight: 0 }}>
        <div className="glass" style={{ width: 215, padding: 8, borderRadius: 14, display: "flex", flexDirection: "column", gap: 2 }}>
          <div style={{ fontSize: 12, fontWeight: 700, padding: "4px 8px 6px" }}>Agents · 4</div>
          {Object.keys(AGENT_META).map((id, i) => {
            const m = AGENT_META[id];
            return (
              <div key={id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 8px", borderRadius: 9, background: i === 0 ? "rgba(255,255,255,0.1)" : "none" }}>
                <AgentMark id={id} size={26} radius={7} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11.5, fontWeight: i === 0 ? 700 : 500 }}>{m.name}</div>
                  <div style={{ fontSize: 9, color: "var(--tx-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.desc}</div>
                </div>
                <span className={"ah-dot " + (id === "hermes" ? "off" : "idle")} style={{ width: 6, height: 6 }}></span>
              </div>
            );
          })}
          <div style={{ borderTop: "1px solid var(--glass-border)", margin: "6px 4px" }}></div>
          <div style={{ fontSize: 10, color: "var(--tx-3)", padding: "2px 8px 4px" }}>最近任务</div>
          {["重构 dispatcher 轮询", "对比错误日志归因", "翻译 DESIGN.md"].map((t, i) => (
            <div key={t} style={{ fontSize: 10, color: "var(--tx-2)", padding: "4px 8px", display: "flex", gap: 6, alignItems: "center" }}>
              <span className={"ah-dot " + (i === 2 ? "error" : "idle")} style={{ width: 5, height: 5 }}></span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t}</span>
            </div>
          ))}
        </div>
        <div className="glass" style={{ flex: 1, borderRadius: 14, padding: 14, display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <AgentMark id="codex" size={40} radius={11} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>Codex CLI</div>
              <div style={{ fontSize: 10, color: "var(--tx-2)" }}>本地 CLI · stdio-plain · 空闲</div>
            </div>
            <span className="ah-btn sm" style={{ fontSize: 10, padding: "4px 11px" }}>派发任务</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
            {[["今日任务", "6"], ["平均耗时", "28s"], ["错误", "0"]].map(([k, v]) => (
              <div key={k} style={{ background: "rgba(0,0,0,0.2)", borderRadius: 10, padding: "8px 10px" }}>
                <div style={{ fontSize: 9.5, color: "var(--tx-3)" }}>{k}</div>
                <div style={{ fontSize: 16, fontWeight: 700, fontFamily: "var(--font-mono)" }}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 10.5, color: "var(--tx-2)" }}>二进制路径</div>
          <div style={{ fontSize: 10, fontFamily: "var(--font-mono)", background: "rgba(0,0,0,0.25)", border: "1px solid var(--glass-border)", borderRadius: 8, padding: "7px 10px", color: "var(--tx-2)" }}>C:\Users\Admin\.cargo\bin\codex.exe</div>
          <div style={{ fontSize: 10.5, color: "var(--tx-2)" }}>能力</div>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            {AGENT_META.codex.caps.map(c => <span key={c} className="ah-chip" style={{ fontSize: 9, padding: "1px 8px" }}>{c}</span>)}
          </div>
        </div>
      </div>
    </VFrame>
  );
}

/* ---------- 变体 C：仪表盘（参考智能家居风） ---------- */
function VariantC() {
  return (
    <VFrame>
      <VTitlebar />
      <div style={{ flex: 1, padding: "0 12px 12px", display: "flex", flexDirection: "column", gap: 10, minHeight: 0 }}>
        <div style={{ display: "flex", gap: 6 }}>
          {["全部", "编码", "写作", "自动化", "部署"].map((t, i) => (
            <span key={t} style={{ fontSize: 10.5, padding: "4px 13px", borderRadius: 999, background: i === 0 ? "var(--mint-soft)" : "rgba(255,255,255,0.06)", color: i === 0 ? "var(--mint)" : "var(--tx-2)", border: "1px solid " + (i === 0 ? "var(--mint-line)" : "transparent") }}>{t}</span>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr", gap: 10, flex: 1, minHeight: 0 }}>
          <div className="glass" style={{ borderRadius: 14, padding: 14, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <div style={{ fontSize: 11, color: "var(--tx-2)", alignSelf: "flex-start" }}>⚡ 今日吞吐</div>
            <div style={{ position: "relative", width: 110, height: 110 }}>
              <svg width="110" height="110" viewBox="0 0 110 110">
                <circle cx="55" cy="55" r="46" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="9"></circle>
                <circle cx="55" cy="55" r="46" fill="none" stroke="var(--mint)" strokeWidth="9" strokeLinecap="round" strokeDasharray="289" strokeDashoffset="95" transform="rotate(-90 55 55)"></circle>
              </svg>
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                <div style={{ fontSize: 21, fontWeight: 700, fontFamily: "var(--font-mono)" }}>67%</div>
                <div style={{ fontSize: 8.5, color: "var(--tx-3)" }}>8 / 12 任务</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 12, fontSize: 9, color: "var(--tx-2)" }}>
              <span>● 完成 8</span><span style={{ color: "var(--st-busy)" }}>● 运行 1</span><span style={{ color: "var(--st-error)" }}>● 失败 1</span>
            </div>
          </div>
          {["codex", "claude"].map(id => {
            const m = AGENT_META[id];
            return (
              <div key={id} className="glass" style={{ borderRadius: 14, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <AgentMark id={id} size={30} radius={8} />
                  <span className="ah-switch on" style={{ transform: "scale(0.8)" }}></span>
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>{m.name}</div>
                  <div style={{ fontSize: 9, color: "var(--tx-3)" }}>{id === "codex" ? "stdio · 本地 CLI" : "HTTP · GPT-4o"}</div>
                </div>
                <svg width="100%" height="26" viewBox="0 0 120 26" preserveAspectRatio="none">
                  <path d={id === "codex" ? "M0 20 L15 16 L30 18 L45 8 L60 12 L75 5 L90 9 L105 4 L120 7" : "M0 18 L15 19 L30 14 L45 16 L60 10 L75 13 L90 8 L105 11 L120 6"} fill="none" stroke={m.colorRaw} strokeWidth="1.6"></path>
                </svg>
                <div style={{ fontSize: 8.5, color: "var(--tx-3)" }}>近 7 日任务量</div>
              </div>
            );
          })}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, flex: 1, minHeight: 0 }}>
          {["hermes", "openclaw"].map(id => {
            const m = AGENT_META[id];
            const off = id === "hermes";
            return (
              <div key={id} className="glass" style={{ borderRadius: 14, padding: 12, display: "flex", alignItems: "center", gap: 10, opacity: off ? 0.6 : 1 }}>
                <AgentMark id={id} size={30} radius={8} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>{m.name}</div>
                  <div style={{ fontSize: 9, color: "var(--tx-3)" }}>{off ? "未配置 API Key" : "DeepSeek Chat · 203ms"}</div>
                </div>
                <span className={"ah-switch" + (off ? "" : " on")} style={{ transform: "scale(0.8)" }}></span>
              </div>
            );
          })}
        </div>
      </div>
    </VFrame>
  );
}

/* ---------- 会话回复样式变体 ---------- */
function ChatVarCard({ layout }) {
  const replies = [
    { id: "codex", text: "栈顶 EFTYPE 指向直接 spawn .js 文件——Windows 下需经 .cmd shim 调用。" },
    { id: "claude", text: "归因：spawn 调用未走 shell。建议 shell:true 或包一层 cmd 调用。" },
  ];
  return (
    <VFrame>
      <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10, height: "100%" }}>
        <div className="glass-strong" style={{ alignSelf: "flex-end", padding: "8px 14px", borderRadius: "15px 15px 4px 15px", fontSize: 11.5 }}>这段错误日志是什么原因？</div>
        {layout === "grid" ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {replies.map(r => (
              <div key={r.id} className="glass" style={{ padding: 11, borderRadius: 13, display: "flex", flexDirection: "column", gap: 7 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <AgentMark id={r.id} size={20} radius={6} />
                  <span style={{ fontSize: 11, fontWeight: 700 }}>{AGENT_META[r.id].name}</span>
                </div>
                <div style={{ fontSize: 10.5, color: "var(--tx-2)" }}>{r.text}</div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 0, position: "relative", paddingLeft: 14 }}>
            <div style={{ position: "absolute", left: 23, top: 8, bottom: 8, width: 1.5, background: "var(--glass-border-strong)" }}></div>
            {replies.map(r => (
              <div key={r.id} style={{ display: "flex", gap: 10, padding: "8px 0", position: "relative" }}>
                <AgentMark id={r.id} size={20} radius={6} />
                <div className="glass" style={{ flex: 1, padding: "9px 12px", borderRadius: 12 }}>
                  <div style={{ fontSize: 10.5, fontWeight: 700, marginBottom: 3 }}>{AGENT_META[r.id].name}</div>
                  <div style={{ fontSize: 10.5, color: "var(--tx-2)" }}>{r.text}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </VFrame>
  );
}

function VariantsApp() {
  return (
    <DesignCanvas title="AgentHub — 布局变体">
      <DCSection id="home-layouts" title="总览页 · 三种布局" subtitle="A 当前方案（封面卡片）· B 列表双栏（紧凑）· C 仪表盘（参考智能家居风）">
        <DCArtboard id="va" label="A · 封面卡片网格" width={560} height={400}><VariantA /></DCArtboard>
        <DCArtboard id="vb" label="B · 列表 + 详情双栏" width={560} height={400}><VariantB /></DCArtboard>
        <DCArtboard id="vc" label="C · 仪表盘控制台" width={560} height={400}><VariantC /></DCArtboard>
      </DCSection>
      <DCSection id="chat-styles" title="会话广播回复 · 两种样式" subtitle="并列卡片 vs 时间线串联">
        <DCArtboard id="cg" label="并列卡片（当前方案）" width={460} height={260}><ChatVarCard layout="grid" /></DCArtboard>
        <DCArtboard id="ct" label="时间线串联" width={460} height={260}><ChatVarCard layout="timeline" /></DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<VariantsApp />);
