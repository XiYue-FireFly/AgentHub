/* ============================================================
   AgentHub — 任务历史页
   ============================================================ */

function TasksScreen({ tasks, patchTask, search }) {
  const { useState } = React;
  const [open, setOpen] = useState(null);
  const [filter, setFilter] = useState("all");

  const visible = tasks.filter(t =>
    (filter === "all" || t.status === filter) &&
    (!search || t.text.toLowerCase().includes(search.toLowerCase()))
  );

  const fmtDur = ms => ms >= 1000 ? (ms / 1000).toFixed(1) + "s" : ms + "ms";

  return (
    <div className="ah-fadeup" data-screen-label="任务" style={{ padding: "6px 4px 30px" }}>
      <SectionTitle right={
        <Seg value={filter} onChange={setFilter} options={[
          { value: "all", label: "全部" }, { value: "running", label: "运行中" },
          { value: "completed", label: "已完成" }, { value: "failed", label: "失败" },
        ]} />
      }>任务历史</SectionTitle>

      {visible.length === 0 && (
        <div className="glass" style={{ padding: 40, textAlign: "center", color: "var(--tx-3)" }}>没有匹配的任务</div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {visible.map((t, i) => {
          const isOpen = open === t.id;
          return (
            <Enter key={t.id} delay={i * 45} className="glass" style={{ overflow: "hidden" }}>
              <div onClick={() => setOpen(isOpen ? null : t.id)} style={{
                display: "flex", alignItems: "center", gap: 13, padding: "13px 18px", cursor: "pointer",
              }}>
                <TaskStatusBadge status={t.status} />
                <span style={{ flex: 1, fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.text}</span>
                <span className="ah-chip">{MODE_ZH[t.mode]}</span>
                <div style={{ display: "flex", gap: 4 }}>
                  {t.agents.map(a => <AgentMark key={a} id={a} size={20} radius={6} />)}
                </div>
                <span className="ah-hint" style={{ width: 50, textAlign: "right", fontFamily: "var(--font-mono)" }}>
                  {t.status === "running" ? "…" : fmtDur(t.durationMs)}
                </span>
                <span className="ah-hint" style={{ width: 40, textAlign: "right" }}>{t.createdAt}</span>
                {t.status === "running"
                  ? <button className="ah-btn sm danger" onClick={e => { e.stopPropagation(); patchTask(t.id, x => ({ ...x, status: "cancelled" })); }}>取消</button>
                  : <Icon d={IC.chevDown} size={14} style={{ color: "var(--tx-3)", transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />}
              </div>
              <Collapse open={isOpen}>
                <div style={{ borderTop: "1px solid var(--glass-border)", padding: "14px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
                  <div className="ah-hint" style={{ fontFamily: "var(--font-mono)" }}>{t.id} · {MODE_ZH[t.mode]} · {t.agents.length} 个 Agent</div>
                  {t.results && Object.entries(t.results).map(([agentId, content]) => (
                    <div key={agentId} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                      <AgentMark id={agentId} size={24} radius={7} />
                      <div style={{ flex: 1, fontSize: 13, color: "var(--tx-2)", background: "rgba(0,0,0,0.18)", borderRadius: 10, padding: "9px 13px" }}>{content}</div>
                    </div>
                  ))}
                  {t.errors && Object.entries(t.errors).map(([agentId, err]) => (
                    <div key={agentId} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                      <AgentMark id={agentId} size={24} radius={7} />
                      <div style={{ flex: 1, fontSize: 12.5, color: "var(--st-error)", background: "rgba(232,112,106,0.08)", border: "1px solid rgba(232,112,106,0.2)", borderRadius: 10, padding: "9px 13px", fontFamily: "var(--font-mono)" }}>{err}</div>
                    </div>
                  ))}
                </div>
              </Collapse>
            </Enter>
          );
        })}
      </div>
    </div>
  );
}

Object.assign(window, { TasksScreen });
