/* ============================================================
   AgentHub — 总览页
   ============================================================ */

function HomeScreen({ agents, bindings, providers, tasks, goChat }) {
  const onlineCount = Object.values(agents).filter(a => a.status !== "off").length;
  const runningCount = tasks.filter(t => t.status === "running").length;
  const doneToday = tasks.filter(t => t.status === "completed").length;

  return (
    <div className="ah-fadeup" data-screen-label="总览" style={{ padding: "6px 4px 30px" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.01em" }}>下午好</h1>
          <div style={{ color: "var(--tx-2)", marginTop: 3 }}>{onlineCount} 个 Agent 在线 · {runningCount} 个任务运行中 · 今日完成 {doneToday} 个</div>
        </div>
        <button className="ah-btn primary" onClick={() => goChat(null)}>
          <Icon d={IC.bolt} size={15} /> 新建派发
        </button>
      </div>

      {/* Agent 卡片网格 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 16 }}>
        {Object.keys(AGENT_META).map((id, idx) => {
          const meta = AGENT_META[id];
          const a = agents[id];
          const b = bindings.find(x => x.agentId === id);
          const prov = providers.find(p => p.id === b.providerId);
          const model = prov?.models.find(m => m.id === b.modelId);
          const isStdio = b.protocol === "stdio-plain";
          return (
            <Enter key={id} delay={idx * 70} style={{ display: "flex" }}>
            <div className="glass hover-glow" style={{ flex: 1, padding: 18, display: "flex", flexDirection: "column", gap: 13, transition: "border-color 0.2s, transform 0.2s", cursor: "default" }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--glass-border-strong)"; e.currentTarget.style.transform = "translateY(-2px)"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--glass-border)"; e.currentTarget.style.transform = "none"; }}>
              <div style={{ display: "flex", alignItems: "center", gap: 13, height: 48 }}>
                <AgentMark id={id} size={48} radius={13} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{meta.name}</div>
                  <div className="ah-hint" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{meta.desc}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--tx-2)", flex: "none" }}>
                  <StatusDot status={a.status} />{STATUS_ZH[a.status]}
                </div>
              </div>

              <div style={{
                display: "flex", alignItems: "center", gap: 8, fontSize: 12, height: 37, flex: "none",
                background: "rgba(0,0,0,0.2)", borderRadius: 10, padding: "0 12px",
                fontFamily: "var(--font-mono)", color: "var(--tx-2)",
              }}>
                <Icon d={isStdio ? IC.terminal : IC.link} size={13} style={{ color: meta.colorRaw, flex: "none" }} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {isStdio ? "本地 CLI · stdio" : `${prov?.name} · ${model?.label || b.modelId}`}
                </span>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignContent: "flex-start", flex: 1, minHeight: 24 }}>
                {meta.caps.map(c => <span key={c} className="ah-chip">{c}</span>)}
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: "auto" }}>
                <button className="ah-btn sm" style={{ flex: 1 }} onClick={() => goChat(id)}>
                  <Icon d={IC.send} size={13} /> 派发任务
                </button>
              </div>
            </div>
            </Enter>
          );
        })}
      </div>

      {/* 最近任务 */}
      <Enter delay={320} style={{ marginTop: 28 }}>
        <SectionTitle right={<span className="ah-hint">{tasks.length} 条记录</span>}>最近任务</SectionTitle>
        <div className="glass" style={{ padding: "6px 0" }}>
          {tasks.slice(0, 4).map((t, i) => (
            <div key={t.id} style={{
              display: "flex", alignItems: "center", gap: 13, padding: "11px 18px",
              borderTop: i === 0 ? "none" : "1px solid var(--glass-border)",
            }}>
              <TaskStatusBadge status={t.status} />
              <span style={{ flex: 1, fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.text}</span>
              <span className="ah-chip">{MODE_ZH[t.mode]}</span>
              <div style={{ display: "flex", gap: 4 }}>
                {t.agents.map(a => <AgentMark key={a} id={a} size={20} radius={6} />)}
              </div>
              <span className="ah-hint" style={{ width: 42, textAlign: "right" }}>{t.createdAt}</span>
            </div>
          ))}
        </div>
      </Enter>
    </div>
  );
}

const MODE_ZH = { auto: "智能路由", broadcast: "广播", chain: "链式" };
const TASK_ST = {
  running:   { zh: "运行中", color: "var(--st-busy)" },
  completed: { zh: "已完成", color: "var(--st-idle)" },
  failed:    { zh: "失败",   color: "var(--st-error)" },
  cancelled: { zh: "已取消", color: "var(--tx-3)" },
};
function TaskStatusBadge({ status }) {
  const s = TASK_ST[status];
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, color: s.color, flex: "none",
      border: `1px solid color-mix(in srgb, ${s.color} 40%, transparent)`,
      background: `color-mix(in srgb, ${s.color} 12%, transparent)`,
      borderRadius: 999, padding: "2px 9px",
    }}>{s.zh}</span>
  );
}

Object.assign(window, { HomeScreen, TaskStatusBadge, MODE_ZH, TASK_ST });
