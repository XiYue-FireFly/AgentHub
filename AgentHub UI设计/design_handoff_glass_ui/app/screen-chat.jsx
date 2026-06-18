/* ============================================================
   AgentHub — 会话 / 派发页
   流式模拟 · auto / broadcast / chain · 思考折叠
   ============================================================ */

function ChatScreen({ agents, setAgentStatus, bindings, providers, activeAgent, setActiveAgent, messages, setMessages, addTask, patchTask }) {
  const { useState, useRef, useEffect } = React;
  const [mode, setMode] = useState("auto");
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const timers = useRef([]);
  const scrollRef = useRef(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => () => timers.current.forEach(clearInterval), []);

  const routeAuto = (text) => {
    const kw = {
      codex: ["代码", "重构", "调试", "bug", "api", "函数", "patch"],
      hermes: ["系统", "配置", "环境", "命令", "path"],
      openclaw: ["部署", "流水线", "ci", "脚本", "发布"],
    };
    const low = text.toLowerCase();
    for (const [id, words] of Object.entries(kw)) if (words.some(w => low.includes(w))) return id;
    return "claude";
  };

  const streamAgent = (agentId, msgId, taskId, onDone) => {
    const reply = MOCK_REPLIES[agentId];
    const b = bindings.find(x => x.agentId === agentId);
    const useThinking = b.thinking.mode !== "off" && agentId !== "hermes";
    setAgentStatus(agentId, "busy");
    let pos = 0, tPos = 0;
    const thinkText = useThinking ? THINKING_PREVIEW : "";
    const timer = setInterval(() => {
      if (tPos < thinkText.length) {
        tPos = Math.min(tPos + 6, thinkText.length);
      } else {
        pos = Math.min(pos + 4, reply.length);
      }
      setMessages(ms => ms.map(m => m.id === msgId
        ? { ...m, replies: m.replies.map(r => r.agentId === agentId ? { ...r, thinking: thinkText.slice(0, tPos), text: reply.slice(0, pos), done: pos >= reply.length } : r) }
        : m));
      if (pos >= reply.length) {
        clearInterval(timer);
        setAgentStatus(agentId, "idle");
        patchTask(taskId, t => ({ ...t, results: { ...(t.results || {}), [agentId]: reply } }));
        onDone && onDone();
      }
    }, 30);
    timers.current.push(timer);
    return timer;
  };

  const send = () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    const targets = activeAgent ? [activeAgent]
      : mode === "broadcast" ? Object.keys(AGENT_META)
      : mode === "chain" ? ["codex", "claude"]
      : [routeAuto(text)];

    const msgId = "m" + Date.now();
    const taskId = "task-" + Math.floor(Math.random() * 900 + 100);
    addTask({ id: taskId, text, mode: activeAgent ? "auto" : mode, status: "running", agents: targets, durationMs: 0, createdAt: new Date().toTimeString().slice(0, 5), results: {} });

    setMessages(ms => [...ms, {
      id: msgId, role: "user", text,
      replies: targets.map(a => ({ agentId: a, thinking: "", text: "", done: false })),
      mode: activeAgent ? "auto" : mode, taskId,
    }]);
    setStreaming(true);
    const start = Date.now();
    const finishAll = () => {
      setStreaming(false);
      patchTask(taskId, t => ({ ...t, status: "completed", durationMs: Date.now() - start }));
    };

    if (!activeAgent && mode === "chain") {
      streamAgent(targets[0], msgId, taskId, () => {
        setTimeout(() => streamAgent(targets[1], msgId, taskId, finishAll), 350);
      });
    } else {
      let remain = targets.length;
      targets.forEach((a, i) => setTimeout(() => streamAgent(a, msgId, taskId, () => { if (--remain === 0) finishAll(); }), i * 220));
    }
  };

  const cancel = () => {
    timers.current.forEach(clearInterval);
    timers.current = [];
    Object.keys(AGENT_META).forEach(id => setAgentStatus(id, "idle"));
    setStreaming(false);
    setMessages(ms => ms.map(m => ({ ...m, replies: m.replies.map(r => r.done ? r : { ...r, done: true, cancelled: true }) })));
  };

  return (
    <div data-screen-label="会话" style={{ display: "flex", flexDirection: "column", height: "100%", gap: 12 }}>
      {/* 顶部控制条 */}
      <div className="glass" style={{ flex: "none", display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", flexWrap: "wrap" }}>
        <Seg value={activeAgent ? "single" : mode} onChange={v => { setActiveAgent(null); setMode(v); }}
          options={[{ value: "auto", label: "智能路由" }, { value: "broadcast", label: "广播全部" }, { value: "chain", label: "链式接力" }]} />
        <div style={{ width: 1, height: 20, background: "var(--glass-border)" }}></div>
        <span className="ah-label">指定：</span>
        <div style={{ display: "flex", gap: 6 }}>
          {Object.keys(AGENT_META).map(id => (
            <button key={id} onClick={() => setActiveAgent(activeAgent === id ? null : id)}
              className="ah-chip" style={{
                cursor: "pointer", font: "inherit", fontSize: 11.5, border: "1px solid",
                borderColor: activeAgent === id ? AGENT_META[id].colorRaw : "rgba(255,255,255,0.08)",
                color: activeAgent === id ? AGENT_META[id].colorRaw : "var(--tx-2)",
                background: activeAgent === id ? `color-mix(in srgb, ${AGENT_META[id].colorRaw} 14%, transparent)` : "rgba(255,255,255,0.05)",
              }}>{AGENT_META[id].name}</button>
          ))}
        </div>
        <div style={{ flex: 1 }}></div>
        {activeAgent && <span className="ah-hint">→ 仅派发给 {AGENT_META[activeAgent].name}</span>}
        {mode === "chain" && !activeAgent && <span className="ah-hint">Codex → Claude，前者输出作为后者输入</span>}
      </div>

      {/* 消息区 */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 18, padding: "4px 2px" }}>
        {messages.length === 0 && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, color: "var(--tx-3)" }}>
            <Icon d={IC.broadcast} size={36} sw={1.2} />
            <div style={{ fontSize: 14 }}>输入任务开始派发 — 试试「重构 dispatcher 的轮询逻辑」</div>
            <div className="ah-hint">智能路由会按关键词选择 Agent；广播会同时询问全部 4 个</div>
          </div>
        )}
        {messages.map(m => (
          <Enter key={m.id} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ alignSelf: "flex-end", maxWidth: "70%", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5 }}>
              <div className="glass-strong" style={{ padding: "10px 16px", borderRadius: "18px 18px 5px 18px", fontSize: 13.5 }}>{m.text}</div>
              <span className="ah-hint">{MODE_ZH[m.mode]}{m.mode === "chain" ? "" : m.replies.length > 1 ? ` · ${m.replies.length} 个 Agent` : ""}</span>
            </div>
            <div style={{ display: "grid", gap: 10, gridTemplateColumns: m.replies.length > 1 ? "repeat(auto-fit, minmax(300px, 1fr))" : "1fr" }}>
              {m.replies.map((r, idx) => <ReplyBubble key={r.agentId} r={r} chainIdx={m.mode === "chain" ? idx : null} delay={idx * 90} />)}
            </div>
          </Enter>
        ))}
      </div>

      {/* 输入区 */}
      <div className="glass-strong" style={{ flex: "none", display: "flex", alignItems: "flex-end", gap: 10, padding: 10, borderRadius: 18 }}>
        <textarea value={input} rows={1}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder={streaming ? "正在生成…" : "描述任务，Enter 发送，Shift+Enter 换行"}
          style={{
            flex: 1, resize: "none", background: "none", border: "none", outline: "none",
            color: "var(--tx-1)", font: "inherit", fontSize: 14, padding: "8px 8px", maxHeight: 120,
          }} />
        {streaming
          ? <button className="ah-btn danger" onClick={cancel}><Icon d={IC.stop} size={14} /> 停止</button>
          : <button className="ah-btn primary" onClick={send} disabled={!input.trim()}><Icon d={IC.send} size={14} /> 发送</button>}
      </div>
    </div>
  );
}

function ReplyBubble({ r, chainIdx, delay = 0 }) {
  const { useState } = React;
  const meta = AGENT_META[r.agentId];
  const [thinkOpen, setThinkOpen] = useState(false);
  return (
    <Enter delay={delay} className="glass" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 9, borderRadius: 16, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        {chainIdx !== null && <span className="ah-chip mint">{chainIdx + 1}</span>}
        <AgentMark id={r.agentId} size={24} radius={7} />
        <span style={{ fontWeight: 600, fontSize: 13 }}>{meta.name}</span>
        <span style={{ flex: 1 }}></span>
        {!r.done && r.text.length === 0 && r.thinking.length === 0 && <span className="ah-hint">连接中…</span>}
        {!r.done && (r.text.length > 0 || r.thinking.length > 0) && <span className="ah-dot busy"></span>}
        {r.cancelled && <span className="ah-hint">已停止</span>}
        {r.done && !r.cancelled && <Icon d={IC.check} size={14} style={{ color: "var(--mint)" }} />}
      </div>
      {r.thinking && (
        <div style={{ background: "rgba(0,0,0,0.2)", borderRadius: 10, overflow: "hidden" }}>
          <button onClick={() => setThinkOpen(!thinkOpen)} style={{
            display: "flex", alignItems: "center", gap: 7, width: "100%", font: "inherit", fontSize: 11.5,
            color: "var(--tx-2)", background: "none", border: "none", padding: "7px 11px", cursor: "pointer",
          }}>
            <Icon d={IC.brain} size={13} /> 思考过程
            <span style={{ flex: 1 }}></span>
            <Icon d={IC.chevDown} size={12} style={{ transform: thinkOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
          </button>
          <Collapse open={thinkOpen}>
            <div style={{ padding: "0 11px 9px", fontSize: 12, color: "var(--tx-2)", fontStyle: "italic" }}>{r.thinking}</div>
          </Collapse>
        </div>
      )}
      <div style={{ fontSize: 13.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
        {renderRichText(r.text)}
        {!r.done && (r.text.length > 0) && <span style={{ display: "inline-block", width: 7, height: 14, background: "var(--mint)", marginLeft: 2, verticalAlign: "-2px", animation: "ah-pulse 0.8s infinite" }}></span>}
      </div>
    </Enter>
  );
}

/* 极简 markdown：代码块 + 行内代码 + 加粗 */
function renderRichText(text) {
  const parts = text.split(/```(?:\w+)?\n?/);
  return parts.map((seg, i) => i % 2 === 1
    ? <pre key={i} style={{ background: "rgba(0,0,0,0.32)", border: "1px solid var(--glass-border)", borderRadius: 9, padding: "9px 12px", fontFamily: "var(--font-mono)", fontSize: 12, overflowX: "auto", margin: "6px 0" }}>{seg}</pre>
    : <span key={i}>{seg.split(/(`[^`]+`|\*\*[^*]+\*\*)/).map((s, j) => {
        if (s.startsWith("`")) return <code key={j} style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, background: "rgba(255,255,255,0.09)", borderRadius: 4, padding: "1px 5px" }}>{s.slice(1, -1)}</code>;
        if (s.startsWith("**")) return <strong key={j}>{s.slice(2, -2)}</strong>;
        return s;
      })}</span>);
}

Object.assign(window, { ChatScreen });
