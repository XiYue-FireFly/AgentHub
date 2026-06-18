/* ============================================================
   AgentHub — 设置页：提供商 / 路由
   ============================================================ */

function SettingsScreen({ providers, setProviders, bindings, setBindings, motion, setMotion }) {
  const { useState } = React;
  const [tab, setTab] = useState("providers");
  return (
    <div className="ah-fadeup" data-screen-label="设置" style={{ padding: "6px 4px 30px" }}>
      <SectionTitle right={
        <Seg value={tab} onChange={setTab} options={[
          { value: "providers", label: "提供商" }, { value: "routing", label: "路由" }, { value: "appearance", label: "外观" },
        ]} />
      }>设置</SectionTitle>
      {tab === "providers" && <ProvidersTab providers={providers} setProviders={setProviders} />}
      {tab === "routing" && <RoutingTab providers={providers} bindings={bindings} setBindings={setBindings} />}
      {tab === "appearance" && <AppearanceTab motion={motion} setMotion={setMotion} />}
    </div>
  );
}

/* ---------- 外观 / 动效 ---------- */
const MOTION_LEVELS = [
  { value: "off",    label: "关闭",  desc: "无任何动画与过渡。适合低性能设备或偏好静态界面。" },
  { value: "subtle", label: "简洁",  desc: "仅保留短促淡入与状态脉冲，无交错延迟、无装饰性动画。" },
  { value: "rich",   label: "丰富",  desc: "卡片交错入场、背景光斑漂移、悬浮辉光、弹性微交互、折叠过渡。" },
];

function AppearanceTab({ motion, setMotion }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 720 }}>
      <Enter className="glass" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700 }}>动效与动画</div>
            <div className="ah-hint">控制全局过渡、入场动画与装饰性动效的强度，即时生效</div>
          </div>
          <Seg value={motion} onChange={setMotion}
            options={MOTION_LEVELS.map(l => ({ value: l.value, label: l.label }))} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
          {MOTION_LEVELS.map(l => (
            <div key={l.value} onClick={() => setMotion(l.value)} style={{
              padding: "11px 13px", borderRadius: 12, cursor: "pointer",
              background: motion === l.value ? "var(--mint-soft)" : "rgba(0,0,0,0.18)",
              border: "1px solid " + (motion === l.value ? "var(--mint-line)" : "var(--glass-border)"),
              transition: "background 0.2s, border-color 0.2s",
            }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: motion === l.value ? "var(--mint)" : "var(--tx-1)", marginBottom: 3 }}>{l.label}</div>
              <div className="ah-hint" style={{ lineHeight: 1.5 }}>{l.desc}</div>
            </div>
          ))}
        </div>
        {/* 实时预览：切档重播入场 */}
        <div>
          <div className="ah-label" style={{ marginBottom: 8 }}>预览（切换档位会重播入场动画）</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
            {Object.keys(AGENT_META).map((id, i) => (
              <Enter key={motion + id} delay={i * 70} className="glass hover-glow" style={{ padding: 12, display: "flex", alignItems: "center", gap: 9 }}>
                <AgentMark id={id} size={26} radius={7} />
                <span style={{ fontSize: 11.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{AGENT_META[id].name}</span>
                <span className="ah-dot busy" style={{ marginLeft: "auto" }}></span>
              </Enter>
            ))}
          </div>
        </div>
      </Enter>
    </div>
  );
}

/* ---------- 提供商 ---------- */
function ProvidersTab({ providers, setProviders }) {
  const { useState } = React;
  const [checking, setChecking] = useState({});

  const patch = (id, fn) => setProviders(ps => ps.map(p => p.id === id ? fn(p) : p));

  const checkHealth = (id) => {
    setChecking(c => ({ ...c, [id]: true }));
    setTimeout(() => {
      const p = providers.find(x => x.id === id);
      const ok = !!p.apiKey;
      patch(id, x => ({ ...x, health: ok
        ? { reachable: true, latencyMs: Math.floor(150 + Math.random() * 400) }
        : { reachable: false, error: "未配置 API Key" } }));
      setChecking(c => ({ ...c, [id]: false }));
    }, 900);
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(330px, 1fr))", gap: 14 }}>
      {providers.map((p, i) => (
        <Enter key={p.id} delay={i * 60} className="glass hover-glow" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 13, opacity: p.enabled ? 1 : 0.65 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
            <div style={{
              width: 38, height: 38, borderRadius: 10, flex: "none", display: "flex", alignItems: "center", justifyContent: "center",
              background: "rgba(255,255,255,0.08)", fontWeight: 700, fontSize: 14,
            }}>{p.name.slice(0, 1)}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name} {p.builtIn && <span className="ah-hint">内置</span>}</div>
              <div className="ah-hint" style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={p.baseUrl}>{p.baseUrl}</div>
            </div>
            <Switch on={p.enabled} onChange={v => patch(p.id, x => ({ ...x, enabled: v }))} />
          </div>

          <div>
            <div className="ah-label" style={{ marginBottom: 5 }}>API Key</div>
            <input className="ah-input mono" type="text" value={p.apiKey}
              placeholder="sk-…"
              onChange={e => patch(p.id, x => ({ ...x, apiKey: e.target.value }))} />
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {p.models.map(m => <span key={m.id} className="ah-chip">{m.label}</span>)}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button className="ah-btn sm" onClick={() => checkHealth(p.id)} disabled={checking[p.id]}>
              <Icon d={IC.pulse} size={13} /> {checking[p.id] ? "检测中…" : "健康检查"}
            </button>
            {p.health && (p.health.reachable
              ? <span style={{ fontSize: 12, color: "var(--mint)", display: "flex", alignItems: "center", gap: 6 }}><span className="ah-dot idle"></span>可达 · {p.health.latencyMs}ms</span>
              : <span style={{ fontSize: 12, color: "var(--st-error)", display: "flex", alignItems: "center", gap: 6 }}><span className="ah-dot error"></span>{p.health.error || "不可达"}</span>)}
          </div>
        </Enter>
      ))}
    </div>
  );
}

/* ---------- 路由 ---------- */
const THINK_OPTS = [{ value: "off", label: "关闭" }, { value: "auto", label: "自动" }, { value: "enabled", label: "开启" }];
const LEVEL_OPTS = ["minimal", "low", "medium", "high", "xhigh"];

function RoutingTab({ providers, bindings, setBindings }) {
  const patch = (agentId, fn) => setBindings(bs => bs.map(b => b.agentId === agentId ? fn(b) : b));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="ah-hint" style={{ padding: "0 4px" }}>
        每个 Agent 可绑定到 HTTP 提供商，或切换为 StdIO 直连本地 CLI 子进程（当前仅 Codex 支持 StdIO）。
      </div>
      {bindings.map((b, i) => <Enter key={b.agentId} delay={i * 60}><BindingRow b={b} providers={providers} patch={patch} /></Enter>)}
    </div>
  );
}

function BindingRow({ b, providers, patch }) {
  const meta = AGENT_META[b.agentId];
  const prov = providers.find(p => p.id === b.providerId);
  const stdioSupported = b.agentId === "codex";
  const isStdio = b.protocol === "stdio-plain";

  return (
    <div className="glass" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <AgentMark id={b.agentId} size={36} radius={10} />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700 }}>{meta.name}</div>
          <div className="ah-hint">{meta.desc}</div>
        </div>
        <span className="ah-label">后端</span>
        <Seg value={b.protocol || "http"} disabledKeys={stdioSupported ? [] : ["stdio-plain"]}
          onChange={v => patch(b.agentId, x => ({ ...x, protocol: v }))}
          options={[{ value: "http", label: "HTTP" }, { value: "stdio-plain", label: "StdIO" }]} />
      </div>

      {isStdio ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div className="ah-label">CLI 二进制路径 <span className="ah-hint">留空则取 CODEX_PATH 或 PATH</span></div>
          <div style={{ display: "flex", gap: 8 }}>
            <Icon d={IC.terminal} size={16} style={{ color: meta.colorRaw, alignSelf: "center" }} />
            <input className="ah-input mono" value={b.binary || ""}
              placeholder="C:\\Users\\…\\codex.exe"
              onChange={e => patch(b.agentId, x => ({ ...x, binary: e.target.value }))} />
          </div>
          <div className="ah-hint">派发将 spawn 本地子进程，stdout 实时回流为流式输出；提供商/模型设置在 StdIO 模式下不生效。</div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <div className="ah-label" style={{ marginBottom: 5 }}>提供商</div>
            <select className="ah-select" style={{ width: "100%" }} value={b.providerId}
              onChange={e => {
                const np = providers.find(p => p.id === e.target.value);
                patch(b.agentId, x => ({ ...x, providerId: e.target.value, modelId: np.models[0].id }));
              }}>
              {providers.map(p => <option key={p.id} value={p.id}>{p.name}{!p.enabled ? "（未启用）" : ""}</option>)}
            </select>
          </div>
          <div>
            <div className="ah-label" style={{ marginBottom: 5 }}>模型</div>
            <select className="ah-select" style={{ width: "100%" }} value={b.modelId}
              onChange={e => patch(b.agentId, x => ({ ...x, modelId: e.target.value }))}>
              {(prov?.models || []).map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <span className="ah-label" style={{ display: "flex", alignItems: "center", gap: 6 }}><Icon d={IC.brain} size={14} />思考</span>
        <Seg value={b.thinking.mode} onChange={v => patch(b.agentId, x => ({ ...x, thinking: { ...x.thinking, mode: v } }))} options={THINK_OPTS} />
        {b.thinking.mode !== "off" && (
          <select className="ah-select" value={b.thinking.level}
            onChange={e => patch(b.agentId, x => ({ ...x, thinking: { ...x.thinking, level: e.target.value } }))}>
            {LEVEL_OPTS.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        )}
        <div style={{ flex: 1 }}></div>
        <span className="ah-label">随机性 {b.temperature.toFixed(1)}</span>
        <input type="range" className="ah-range" style={{ width: 110 }} min="0" max="2" step="0.1" value={b.temperature}
          title="采样温度：越低越严谨稳定，越高越发散有创意"
          onChange={e => patch(b.agentId, x => ({ ...x, temperature: parseFloat(e.target.value) }))} />
      </div>
    </div>
  );
}

Object.assign(window, { SettingsScreen });
