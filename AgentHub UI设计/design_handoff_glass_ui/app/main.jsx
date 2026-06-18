/* ============================================================
   AgentHub — 应用壳层 + Tweaks
   ============================================================ */

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "#5fd49a",
  "blur": 24,
  "glassOpacity": 5.5,
  "bgTone": "cool",
  "radius": 20
}/*EDITMODE-END*/;

const BG_TONES = {
  cool: { b1: "rgba(64,116,168,0.32)", b2: "rgba(72,168,150,0.22)", b3: "rgba(96,88,170,0.20)", base: "#101319" },
  warm: { b1: "rgba(168,116,64,0.30)", b2: "rgba(160,100,80,0.20)", b3: "rgba(120,90,70,0.22)", base: "#16120e" },
  neutral: { b1: "rgba(120,120,130,0.25)", b2: "rgba(100,100,110,0.18)", b3: "rgba(90,90,100,0.18)", base: "#121316" },
};

function App() {
  const { useState, useEffect } = React;
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [page, setPage] = useState("home");
  const [search, setSearch] = useState("");
  const [activeAgent, setActiveAgent] = useState(null);
  const [agents, setAgents] = useState(() => {
    const o = {};
    Object.keys(AGENT_META).forEach(id => o[id] = { status: id === "hermes" ? "off" : "idle" });
    return o;
  });
  const [providers, setProviders] = useState(PROVIDERS_INIT);
  const [bindings, setBindings] = useState(BINDINGS_INIT);
  const [tasks, setTasks] = useState(TASKS_INIT);
  const [messages, setMessages] = useState([]);
  const [motion, setMotion] = useState(() => {
    try { return localStorage.getItem("ah-motion") || "rich"; } catch { return "rich"; }
  });

  /* 动效档位 → html[data-motion] */
  useEffect(() => {
    document.documentElement.dataset.motion = motion;
    try { localStorage.setItem("ah-motion", motion); } catch {}
  }, [motion]);

  /* hermes 跟随 gemini 启用状态 */
  useEffect(() => {
    const gemini = providers.find(p => p.id === "gemini");
    setAgents(a => ({ ...a, hermes: { status: gemini.enabled && gemini.apiKey ? (a.hermes.status === "off" ? "idle" : a.hermes.status) : "off" } }));
  }, [providers]);

  /* Tweaks → CSS 变量 */
  useEffect(() => {
    const r = document.documentElement.style;
    r.setProperty("--mint", t.accent);
    r.setProperty("--mint-soft", `color-mix(in srgb, ${t.accent} 16%, transparent)`);
    r.setProperty("--mint-line", `color-mix(in srgb, ${t.accent} 38%, transparent)`);
    r.setProperty("--st-idle", t.accent);
    r.setProperty("--glass-blur", t.blur + "px");
    r.setProperty("--glass-bg", `rgba(255,255,255,${t.glassOpacity / 100})`);
    r.setProperty("--glass-bg-strong", `rgba(255,255,255,${(t.glassOpacity + 3.5) / 100})`);
    r.setProperty("--radius-lg", t.radius + "px");
    const tone = BG_TONES[t.bgTone] || BG_TONES.cool;
    r.setProperty("--bg-blob-1", tone.b1);
    r.setProperty("--bg-blob-2", tone.b2);
    r.setProperty("--bg-blob-3", tone.b3);
    r.setProperty("--bg-0", tone.base);
  }, [t]);

  const setAgentStatus = (id, status) => setAgents(a => a[id].status === "off" && status === "busy" ? a : ({ ...a, [id]: { status } }));
  const addTask = task => setTasks(ts => [task, ...ts]);
  const patchTask = (id, fn) => setTasks(ts => ts.map(x => x.id === id ? fn(x) : x));
  const goChat = agentId => { setActiveAgent(agentId); setPage("chat"); };

  return (
    <div style={{ position: "relative", zIndex: 1, height: "100vh", display: "flex", flexDirection: "column" }}>
      <Titlebar search={search} onSearch={v => { setSearch(v); if (v && page !== "tasks") setPage("tasks"); }} />
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <Sidebar page={page} setPage={setPage} agents={agents} activeAgent={activeAgent} setActiveAgent={setActiveAgent} />
        <div style={{ flex: 1, minWidth: 0, padding: "0 18px 14px 16px", overflowY: page === "chat" ? "hidden" : "auto", display: "flex", flexDirection: "column" }}>
          <Enter key={page} style={page === "chat" ? { flex: 1, minHeight: 0, display: "flex", flexDirection: "column" } : null}>
            {page === "home" && <HomeScreen agents={agents} bindings={bindings} providers={providers} tasks={tasks} goChat={goChat} />}
            {page === "chat" && <ChatScreen agents={agents} setAgentStatus={setAgentStatus} bindings={bindings} providers={providers}
              activeAgent={activeAgent} setActiveAgent={setActiveAgent} messages={messages} setMessages={setMessages}
              addTask={addTask} patchTask={patchTask} />}
            {page === "tasks" && <TasksScreen tasks={tasks} patchTask={patchTask} search={search} />}
            {page === "settings" && <SettingsScreen providers={providers} setProviders={setProviders} bindings={bindings} setBindings={setBindings} motion={motion} setMotion={setMotion} />}
          </Enter>
        </div>
      </div>

      <TweaksPanel>
        <TweakSection label="颜色" />
        <TweakColor label="强调色" value={t.accent} options={["#5fd49a", "#5aa7f0", "#e8b34d", "#a78bfa"]}
          onChange={v => setTweak("accent", v)} />
        <TweakRadio label="背景色温" value={t.bgTone} options={["cool", "neutral", "warm"]}
          onChange={v => setTweak("bgTone", v)} />
        <TweakSection label="玻璃质感" />
        <TweakSlider label="模糊强度" value={t.blur} min={0} max={48} unit="px" onChange={v => setTweak("blur", v)} />
        <TweakSlider label="面板透明度" value={t.glassOpacity} min={2} max={14} step={0.5} unit="%" onChange={v => setTweak("glassOpacity", v)} />
        <TweakSlider label="卡片圆角" value={t.radius} min={8} max={28} unit="px" onChange={v => setTweak("radius", v)} />
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
