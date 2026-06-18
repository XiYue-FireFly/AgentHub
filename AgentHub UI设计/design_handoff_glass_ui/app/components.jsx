/* ============================================================
   AgentHub — 共享组件
   标题栏 / 侧边栏 / Agent 徽标 / 图标 / 通用控件
   ============================================================ */

const { useState, useEffect, useRef, useCallback } = React;

/* ---------- 线性图标（简单几何） ---------- */
function Icon({ d, size = 17, sw = 1.7, style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" style={style}>{d}</svg>
  );
}
const IC = {
  home: <><path d="M4 11l8-7 8 7"></path><path d="M6 9.5V20h12V9.5"></path></>,
  chat: <><path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4z"></path></>,
  tasks: <><path d="M5 6h14"></path><path d="M5 12h14"></path><path d="M5 18h9"></path></>,
  gear: <><circle cx="12" cy="12" r="3.2"></circle><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7"></path></>,
  search: <><circle cx="11" cy="11" r="6.5"></circle><path d="M16 16l4.5 4.5"></path></>,
  send: <><path d="M21 3L10.5 13.5"></path><path d="M21 3l-7 18-3.5-7.5L3 10z"></path></>,
  bolt: <><path d="M13 2L5 13.5h6L11 22l8-11.5h-6z"></path></>,
  link: <><path d="M9 15l6-6"></path><path d="M10.5 18.5l-2 2a3.5 3.5 0 0 1-5-5l3-3"></path><path d="M13.5 5.5l2-2a3.5 3.5 0 0 1 5 5l-3 3"></path></>,
  terminal: <><path d="M5 7l5 5-5 5"></path><path d="M12 17h7"></path></>,
  pulse: <><path d="M3 12h4l2.5-7 4 14 2.5-7h5"></path></>,
  chev: <><path d="M9 6l6 6-6 6"></path></>,
  chevDown: <><path d="M6 9l6 6 6-6"></path></>,
  stop: <><rect x="6.5" y="6.5" width="11" height="11" rx="2"></rect></>,
  refresh: <><path d="M20 12a8 8 0 1 1-2.34-5.66"></path><path d="M20 3v4h-4"></path></>,
  brain: <><circle cx="12" cy="12" r="8.5"></circle><path d="M12 3.5v17M7 6.5c2 1.5 2 3.5 0 5 2 1.5 2 3.5 0 5M17 6.5c-2 1.5-2 3.5 0 5-2 1.5-2 3.5 0 5"></path></>,
  plus: <><path d="M12 5v14M5 12h14"></path></>,
  x: <><path d="M6 6l12 12M18 6L6 18"></path></>,
  check: <><path d="M5 12.5l5 5L19 7"></path></>,
  copy: <><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15V5a1 1 0 0 1 1-1h10"></path></>,
  broadcast: <><circle cx="12" cy="12" r="2.2"></circle><path d="M7.5 7.5a6.4 6.4 0 0 0 0 9M16.5 7.5a6.4 6.4 0 0 1 0 9M4.6 4.6a10.5 10.5 0 0 0 0 14.8M19.4 4.6a10.5 10.5 0 0 1 0 14.8"></path></>,
};

/* ---------- Agent 徽标（官方图标贴片） ---------- */
function AgentMark({ id, size = 44, radius = 12 }) {
  const m = AGENT_META[id];
  return (
    <div style={{
      width: size, height: size, borderRadius: radius, flex: "none", overflow: "hidden",
      display: "flex", alignItems: "center", justifyContent: "center",
      background: m.tileLight
        ? "linear-gradient(140deg, rgba(235,239,245,0.88), rgba(210,218,229,0.62))"
        : `linear-gradient(140deg, color-mix(in srgb, ${m.colorRaw} 24%, rgba(255,255,255,0.05)), rgba(255,255,255,0.03))`,
      border: "1px solid rgba(255,255,255,0.1)",
      boxShadow: `0 4px 14px -4px ${m.colorRaw}55, inset 0 1px 0 rgba(255,255,255,0.18)`,
    }}>
      <img src={m.icon} alt={m.name} style={{
        width: m.tileLight ? "92%" : "76%", height: m.tileLight ? "92%" : "76%",
        objectFit: "contain", display: "block",
      }} />
    </div>
  );
}

function StatusDot({ status }) {
  return <span className={"ah-dot " + status}></span>;
}
const STATUS_ZH = { idle: "空闲", busy: "运行中", error: "异常", off: "未启用" };

/* ---------- 自绘标题栏 ---------- */
function Titlebar({ onSearch, search }) {
  return (
    <div style={{
      height: 46, flex: "none", display: "flex", alignItems: "center",
      padding: "0 16px", gap: 14, position: "relative", zIndex: 5,
      WebkitAppRegion: "drag",
    }}>
      <div style={{ display: "flex", gap: 8 }}>
        {["#ec6a5e", "#f4bf4f", "#61c554"].map(c => (
          <span key={c} style={{ width: 12, height: 12, borderRadius: "50%", background: c, opacity: 0.92 }}></span>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600 }}>
        <span style={{
          width: 20, height: 20, borderRadius: 6, display: "inline-flex", alignItems: "center", justifyContent: "center",
          background: "var(--mint-soft)", color: "var(--mint)", fontSize: 11, fontWeight: 800,
        }}>AH</span>
        AgentHub
        <span className="ah-hint" style={{ fontWeight: 400 }}>多智能体工作台</span>
      </div>
      <div style={{ flex: 1 }}></div>
      <div className="glass" style={{
        display: "flex", alignItems: "center", gap: 8, padding: "6px 13px",
        borderRadius: 999, width: 280, color: "var(--tx-3)",
      }}>
        <Icon d={IC.search} size={14} />
        <input value={search} onChange={e => onSearch(e.target.value)} placeholder="搜索任务、Agent、设置…"
          style={{ background: "none", border: "none", outline: "none", color: "var(--tx-1)", font: "inherit", fontSize: 12.5, width: "100%" }} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5, color: "var(--mint)" }}>
        <span className="ah-dot idle"></span> Hub 运行中
      </div>
    </div>
  );
}

/* ---------- 侧边栏 ---------- */
function Sidebar({ page, setPage, agents, activeAgent, setActiveAgent }) {
  const NAV = [
    { id: "home", label: "总览", icon: IC.home },
    { id: "chat", label: "会话", icon: IC.chat },
    { id: "tasks", label: "任务", icon: IC.tasks },
    { id: "settings", label: "设置", icon: IC.gear },
  ];
  return (
    <div className="glass" style={{
      width: 218, flex: "none", display: "flex", flexDirection: "column",
      margin: "0 0 14px 14px", padding: 11, gap: 2, overflow: "hidden auto", minHeight: 0,
    }}>
      <div style={{ padding: "3px 10px 8px" }}>
        <div style={{ fontSize: 17, fontWeight: 700 }}>工作台</div>
        <div className="ah-hint">4 个 Agent · 4 个提供商</div>
      </div>
      {NAV.map(n => (
        <button key={n.id} onClick={() => setPage(n.id)} style={{
          display: "flex", alignItems: "center", gap: 11, font: "inherit", fontSize: 13.5,
          color: page === n.id ? "var(--tx-1)" : "var(--tx-2)",
          background: page === n.id ? "rgba(255,255,255,0.1)" : "transparent",
          border: "none", borderRadius: 11, padding: "8px 12px", cursor: "pointer",
          transition: "background 0.15s, color 0.15s", textAlign: "left",
          fontWeight: page === n.id ? 600 : 400, flex: "none",
        }}>
          <Icon d={n.icon} size={16} style={{ opacity: page === n.id ? 1 : 0.7 }} />
          {n.label}
        </button>
      ))}

      <div style={{ borderTop: "1px solid var(--glass-border)", margin: "9px 4px", flex: "none" }}></div>
      <div className="ah-label" style={{ padding: "0 10px 6px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        Agents <Icon d={IC.chevDown} size={13} />
      </div>
      {Object.keys(AGENT_META).map(id => {
        const a = agents[id];
        const sel = activeAgent === id;
        return (
          <button key={id} onClick={() => { setActiveAgent(sel ? null : id); setPage("chat"); }} style={{
            display: "flex", alignItems: "center", gap: 10, font: "inherit",
            background: sel ? "rgba(255,255,255,0.1)" : "transparent",
            border: "none", borderRadius: 11, padding: "5px 10px", cursor: "pointer",
            color: "var(--tx-1)", textAlign: "left", transition: "background 0.15s", flex: "none",
          }}>
            <AgentMark id={id} size={28} radius={8} />
            <span style={{ flex: 1, fontSize: 13, fontWeight: sel ? 600 : 400 }}>{AGENT_META[id].name}</span>
            <StatusDot status={a.status} />
          </button>
        );
      })}
      <div style={{ flex: 1, minHeight: 6 }}></div>
      <div className="ah-hint" style={{ padding: "8px 10px 2px", fontFamily: "var(--font-mono)", fontSize: 10.5, flex: "none" }}>
        proxy · 127.0.0.1:8787
      </div>
    </div>
  );
}

/* ---------- 动效组件 ---------- */
/* 入场：挂载后下一帧加 .mo-in，CSS transition 负责动画；off 档由 CSS 覆盖直接显示 */
function Enter({ delay = 0, className = "", style, children, ...rest }) {
  const [on, setOn] = useState(false);
  useEffect(() => { const t = setTimeout(() => setOn(true), 20); return () => clearTimeout(t); }, []);
  return (
    <div className={"mo-enter" + (on ? " mo-in" : "") + (className ? " " + className : "")}
      style={{ ...style, transitionDelay: delay ? delay + "ms" : undefined }} {...rest}>{children}</div>
  );
}

/* 折叠展开：grid-rows 0fr→1fr 过渡 */
function Collapse({ open, children }) {
  return (
    <div className={"mo-collapse" + (open ? " open" : "")}>
      <div className="mo-collapse-inner">{children}</div>
    </div>
  );
}

/* ---------- 通用 ---------- */
function Switch({ on, onChange, disabled }) {
  return <div className={"ah-switch" + (on ? " on" : "")} style={disabled ? { opacity: 0.35, pointerEvents: "none" } : null}
    onClick={() => onChange(!on)}></div>;
}

function Seg({ options, value, onChange, disabledKeys = [] }) {
  return (
    <div className="ah-seg">
      {options.map(o => (
        <button key={o.value} className={value === o.value ? "active" : ""}
          disabled={disabledKeys.includes(o.value)}
          onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

function SectionTitle({ children, right }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14 }}>
      <h2 style={{ fontSize: 19, fontWeight: 700 }}>{children}</h2>
      {right}
    </div>
  );
}

Object.assign(window, { Icon, IC, AgentMark, StatusDot, STATUS_ZH, Titlebar, Sidebar, Switch, Seg, SectionTitle, Enter, Collapse });
