/* Phone Assist demo: the agent-facing screen. Preact + htm, no build step. */
(function (global) {
  'use strict';
  const { html, render, useState, useEffect, useRef } = global.htmPreact;
  const D = global.DEMO;
  const AI = global.AI;
  const Voice = global.Voice;
  const TTS = global.TTS;

  /* ------------------------------------------------------------------ */
  /* Settings                                                            */
  /* ------------------------------------------------------------------ */
  const SETTINGS_KEY = 'phoneAssistDemo.settings.v2';
  const DEFAULT_SETTINGS = { apiKey: '', model: 'gpt-5.6-luna', effort: 'low', baseUrl: '', tier: 'quick', audio: true };
  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      return raw ? Object.assign({}, DEFAULT_SETTINGS, JSON.parse(raw)) : Object.assign({}, DEFAULT_SETTINGS);
    } catch (e) { return Object.assign({}, DEFAULT_SETTINGS); }
  }
  function saveSettings(s) { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) { /* storage unavailable */ } }

  /* ------------------------------------------------------------------ */
  /* Store                                                               */
  /* ------------------------------------------------------------------ */
  let uid = 0;
  const nextId = () => ++uid;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const userById = (id) => D.USERS.find((u) => u.id === id) || D.USERS[0];
  const toolById = (id) => AI.tools.find((t) => t.id === id);
  const defaultTools = () => AI.tools.slice(0, 6).map((t) => t.id);
  const MAX_AUTO_TOOLS_PER_TURN = 3;
  const STEP_STATUS = ['pending', 'done', 'missed'];
  const fmtVal = (v) => {
    if (v == null) return '';
    if (Array.isArray(v)) return v.map((x) => (x && typeof x === 'object' ? JSON.stringify(x) : String(x))).join(', ');
    return typeof v === 'object' ? JSON.stringify(v) : String(v);
  };
  const scenarioById = (id) => D.SCENARIOS.find((sc) => sc.id === id) || null;
  const pickRandom = (list, notId) => {
    const pool = list.length > 1 ? list.filter((x) => x.id !== notId) : list;
    return pool[Math.floor(Math.random() * pool.length)];
  };

  function freshCall() {
    return {
      callStatus: 'idle', callStart: null, transcript: [], interim: '',
      groups: [],
      unseenGuidance: 0,
      tags: [], guidance: [], batch: 0, tools: defaultTools(), toolPrefill: {},
      selectedTool: null, toolInputs: {}, toolBusy: false, toolResult: null, toolRuns: [], suggestedTool: null,
      scenarioId: null, scriptIndex: 0, autoplay: false, listening: null, speaking: null, aiBusy: false, aiError: '', bestBusy: false, askBusy: false
    };
  }

  const Store = (() => {
    let state = Object.assign(freshCall(), {
      userId: pickRandom(D.USERS).id, incoming: 'random', mode: 'scripted', tab: 'guidance', settings: loadSettings(), settingsOpen: false,
      aiStatus: AI.status(), notice: '', voiceError: ''
    });
    const subs = new Set();
    return {
      get: () => state,
      set: (patch) => { state = Object.assign({}, state, typeof patch === 'function' ? patch(state) : patch); subs.forEach((fn) => fn(state)); },
      subscribe: (fn) => { subs.add(fn); return () => subs.delete(fn); }
    };
  })();
  function useStore() {
    const [s, setS] = useState(Store.get());
    useEffect(() => {
      const unsub = Store.subscribe(setS);
      setS(Store.get());
      return unsub;
    }, []);
    return s;
  }

  const currentScenario = () => scenarioById(Store.get().scenarioId);
  const elapsed = () => { const s = Store.get(); return s.callStart ? (Date.now() - s.callStart) / 1000 : 0; };
  const fmtClock = (t) => { const s = Math.max(0, Math.round(t || 0)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

  let noticeTimer = null;
  function notify(text) {
    Store.set({ notice: text });
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => Store.set({ notice: '' }), 4500);
  }

  /* ------------------------------------------------------------------ */
  /* State mutations                                                      */
  /* ------------------------------------------------------------------ */
  function addLine(speaker, text) {
    const line = { id: nextId(), speaker, text, t: elapsed() };
    Store.set((s) => ({ transcript: s.transcript.concat([line]) }));
    return line;
  }

  function pushCards(cards) {
    if (!cards || !cards.length) return;
    Store.set((s) => {
      const batch = s.batch + 1;
      const fresh = cards.map((c) => ({ id: nextId(), batch, kind: c.kind, text: c.text, bullets: Array.isArray(c.bullets) ? c.bullets.filter((b) => typeof b === 'string' && b.trim()).slice(0, 3) : [], source: c.source || '' }));
      return { batch, guidance: s.guidance.concat(fresh).slice(-60), unseenGuidance: s.tab === 'guidance' ? 0 : s.unseenGuidance + fresh.length };
    });
  }

  function selectTool(id) {
    const tool = toolById(id);
    if (!tool) return;
    const prefill = Store.get().toolPrefill[id] || {};
    const inputs = {};
    tool.inputs.forEach((f) => { inputs[f.key] = prefill[f.key] || ''; });
    Store.set((st) => ({ selectedTool: id, toolInputs: inputs, toolResult: null, tab: 'guidance', suggestedTool: st.suggestedTool === id ? null : st.suggestedTool }));
  }

  async function runTool(id, inputs) {
    const tool = toolById(id);
    if (!tool) return null;
    Store.set((st) => ({ selectedTool: id, toolInputs: inputs, toolResult: null, toolBusy: true, tab: 'guidance', suggestedTool: st.suggestedTool === id ? null : st.suggestedTool }));
    const s = Store.get();
    const res = await AI.simulateTool(tool, inputs, s, userById(s.userId));
    if (res.fallback) notify(`Could not simulate ${tool.label}; showing its example output.${res.error ? ' ' + res.error : ''}`);
    const output = res.output || { demo_mode: true };
    const summary = Object.entries(output).filter(([k]) => k !== 'demo_mode').slice(0, 2).map(([k, v]) => `${k}: ${fmtVal(v)}`).join(' · ');
    addLine('tool', `${tool.label} → ${summary}`);
    Store.set((st) => ({ toolBusy: false, toolResult: output, toolRuns: st.toolRuns.concat([{ id: nextId(), tool: tool.id, inputs, output, t: elapsed() }]) }));
    return { output };
  }

  /* Workflows are matched by name and steps by position, so a status change can pulse. */
  function mergeWorkflows(prev, incoming) {
    const now = Date.now();
    const groups = prev.slice();
    incoming.forEach((wf) => {
      if (!wf || !wf.name || !Array.isArray(wf.steps) || !wf.steps.length) return;
      const steps = wf.steps.filter((st) => st && st.label).map((st) => ({ label: String(st.label).replace(/\.\s*$/, ''), status: STEP_STATUS.includes(st.status) ? st.status : 'pending' }));
      const i = groups.findIndex((g) => g.title === wf.name);
      if (i < 0) {
        groups.push({ id: `wf${nextId()}`, title: String(wf.name), changed: now, steps: steps.map((st, n) => ({ id: `s${n}`, ...st })) });
        return;
      }
      const old = groups[i];
      groups[i] = { ...old, steps: steps.map((st, n) => {
        const before = old.steps[n];
        return before && before.status === st.status ? { ...before, label: st.label } : { id: `s${n}`, ...st, changed: now };
      }) };
    });
    return groups;
  }

  function applyAnalysis(res) {
    if (!res || typeof res !== 'object') throw new Error('Empty analysis');
    const tools = (res.tools || []).filter((t) => t && toolById(t.name));
    const prefill = {};
    tools.forEach((t) => {
      const values = {};
      (t.inputs || []).forEach((f) => { if (f && f.name && typeof f.value === 'string') values[f.name] = f.value; });
      prefill[t.name] = values;
    });
    const suggested = typeof res.suggestedTool === 'string' && toolById(res.suggestedTool.trim()) ? res.suggestedTool.trim() : null;
    Store.set((s) => ({
      groups: mergeWorkflows(s.groups, res.workflows || []),
      tags: Array.isArray(res.tags) ? res.tags.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim()).slice(0, 8) : s.tags,
      tools: tools.length ? tools.map((t) => t.name) : s.tools,
      toolPrefill: Object.assign({}, s.toolPrefill, prefill),
      suggestedTool: suggested
    }));
    const cards = (res.guidance || []).filter((c) => c && c.text && AI.GUIDANCE_KINDS.includes(c.kind) && c.kind !== 'say').slice(0, 2);
    pushCards(cards);
  }

  /* Scripted playback stands in for the agent: run the tool the phone assist suggested, with its prefilled inputs. */
  async function autoRunSuggestedTools() {
    const ran = new Set();
    for (let n = 0; n < MAX_AUTO_TOOLS_PER_TURN; n++) {
      const s = Store.get();
      const id = s.suggestedTool;
      if (s.mode !== 'scripted' || s.callStatus !== 'active' || !id || ran.has(id)) return;
      ran.add(id);
      const tool = toolById(id);
      const prefill = s.toolPrefill[id] || {};
      const inputs = {};
      tool.inputs.forEach((f) => { inputs[f.key] = prefill[f.key] || ''; });
      await runTool(id, inputs);
      await scheduleAnalysis();
    }
  }

  let inFlight = null;
  let pending = false;
  function scheduleAnalysis() {
    if (!AI.available()) return Promise.resolve();
    if (inFlight) { pending = true; return inFlight; }
    inFlight = (async () => {
      do {
        pending = false;
        Store.set({ aiBusy: true, aiError: '' });
        try {
          const s = Store.get();
          const res = await AI.analyze(s, userById(s.userId));
          applyAnalysis(res);
        } catch (e) {
          Store.set({ aiError: e.message || String(e) });
        }
      } while (pending);
      Store.set({ aiBusy: false });
      inFlight = null;
    })();
    return inFlight;
  }

  /* ------------------------------------------------------------------ */
  /* Call control                                                         */
  /* ------------------------------------------------------------------ */
  let currentPlay = null;
  let lastScenarioId = null;
  let lastUserId = null;

  function startCall(opts) {
    opts = opts || {};
    const autoFirst = opts.autoFirst !== false;
    stopVoice();
    TTS.cancel();
    const s = Store.get();
    let scenarioId = null;
    let userId;
    const chosen = opts.userId || (s.incoming !== 'random' ? s.incoming : null);
    if (s.mode === 'scripted') {
      const sc = (opts.scenarioId && scenarioById(opts.scenarioId)) || (chosen && D.SCENARIOS.find((x) => x.userId === chosen)) || pickRandom(D.SCENARIOS, lastScenarioId);
      scenarioId = sc.id;
      userId = sc.userId;
      lastScenarioId = sc.id;
    } else {
      userId = (chosen && userById(chosen).id === chosen) ? chosen : pickRandom(D.USERS, lastUserId).id;
      lastUserId = userId;
    }
    Store.set(Object.assign(freshCall(), { userId, scenarioId, callStatus: 'active', callStart: Date.now(), tab: 'customer', aiStatus: AI.status() }));
    if (s.mode === 'scripted') {
      if (autoFirst) setTimeout(() => { if (Store.get().callStatus === 'active' && Store.get().scriptIndex === 0) playTurn(0, { interrupt: false }); }, 300);
    } else {
      if (!AI.available()) notify('OpenAI is not connected on this server, so the panels will not update in live mode.');
    }
  }

  function endCall() {
    stopVoice();
    TTS.cancel();
    Store.set({ callStatus: 'ended', autoplay: false, listening: null, interim: '', speaking: null });
  }

  function resetAll() {
    stopVoice();
    TTS.cancel();
    Store.set(Object.assign(freshCall(), { tab: 'guidance', notice: '' }));
  }

  async function speakLine(speaker, text) {
    if (!Store.get().settings.audio || !TTS.supported) return false;
    Store.set({ speaking: speaker });
    try { return await TTS.speak(text, speaker); }
    finally { if (Store.get().speaking === speaker) Store.set({ speaking: null }); }
  }

  async function playTurn(i, opts) {
    const interrupt = !!(opts && opts.interrupt);
    const sc = currentScenario();
    if (!sc) return false;
    const turns = sc.turns;
    if (currentPlay) {
      if (interrupt) TTS.cancel();
      await currentPlay;
    }
    const s = Store.get();
    if (s.callStatus !== 'active' || s.scriptIndex !== i || !turns[i]) return false;
    const turn = turns[i];
    const p = (async () => {
      addLine(turn.speaker, turn.text);
      Store.set({ scriptIndex: i + 1 });
      const speech = speakLine(turn.speaker, turn.text);
      if (AI.available()) {
        await scheduleAnalysis();
        await autoRunSuggestedTools();
      }
      const spoke = await speech;
      if (i + 1 >= turns.length) Store.set({ callStatus: 'ended', autoplay: false });
      return { played: true, spoke: !!spoke };
    })();
    currentPlay = p;
    try { return await p; } finally { if (currentPlay === p) currentPlay = null; }
  }

  function playNext() {
    const s = Store.get();
    if (s.callStatus !== 'active') return Promise.resolve(false);
    return playTurn(s.scriptIndex, { interrupt: true });
  }

  async function autoplayLoop() {
    while (Store.get().autoplay && Store.get().callStatus === 'active') {
      const sc = currentScenario();
      if (!sc) break;
      const i = Store.get().scriptIndex;
      if (i >= sc.turns.length) break;
      const res = await playTurn(i, { interrupt: false });
      if (!Store.get().autoplay) break;
      if (res && res.played) {
        await sleep(res.spoke ? 450 : Math.min(5200, 1100 + sc.turns[i].text.length * 36));
      } else {
        await sleep(200);
      }
    }
    Store.set({ autoplay: false });
  }

  function toggleAutoplay() {
    const s = Store.get();
    if (s.autoplay) { Store.set({ autoplay: false }); return; }
    if (s.callStatus !== 'active') startCall({ autoFirst: false });
    Store.set({ autoplay: true });
    autoplayLoop();
  }

  function setMode(mode) {
    stopVoice();
    TTS.cancel();
    const s = Store.get();
    if (s.mode === mode) return;
    Store.set(Object.assign(freshCall(), { mode }));
  }

  /* ------------------------------------------------------------------ */
  /* Voice input                                                          */
  /* ------------------------------------------------------------------ */
  const recognizer = Voice.createRecognizer({
    onInterim: (t) => Store.set({ interim: t }),
    onFinal: (t) => { const sp = Store.get().listening; if (sp) addLiveLine(sp, t); },
    onState: (st) => { if (st === 'stopped') Store.set({ listening: null, interim: '' }); },
    onError: (msg) => { Store.set({ listening: null, interim: '', voiceError: msg }); notify(msg); }
  });

  function stopVoice() {
    if (recognizer.listening) recognizer.stop();
    Store.set({ listening: null, interim: '' });
  }

  function addLiveLine(speaker, text) {
    if (Store.get().callStatus !== 'active') return;
    addLine(speaker, text);
    scheduleAnalysis();
  }

  function speakAs(speaker) {
    const s = Store.get();
    if (s.callStatus !== 'active') { notify('Start the call first.'); return; }
    if (s.mode === 'scripted') {
      if (s.autoplay) return;
      const sc = currentScenario();
      const next = sc ? sc.turns[s.scriptIndex] : null;
      if (!next) return;
      if (next.speaker !== speaker) { notify(`The next scripted line belongs to the ${next.speaker === 'caller' ? 'caller' : 'support agent'}.`); return; }
      playNext();
      return;
    }
    if (!recognizer.supported) { notify('Voice input needs Chrome or Edge. Type a line instead.'); return; }
    if (s.listening === speaker) { stopVoice(); return; }
    Store.set({ listening: speaker, voiceError: '' });
    if (!recognizer.listening) recognizer.start();
  }

  /* ------------------------------------------------------------------ */
  /* Best reply and ask                                                   */
  /* ------------------------------------------------------------------ */
  async function getBestReply() {
    const s = Store.get();
    if (s.callStatus === 'idle') { notify('Start the call first.'); return; }
    if (!AI.available()) { notify('No AI model is connected, so a best reply cannot be generated.'); return; }
    Store.set({ bestBusy: true, aiError: '' });
    try {
      const res = await AI.bestReply(Store.get(), userById(s.userId));
      pushCards([{ kind: 'say', text: res.reply, source: res.why ? `Best reply · ${res.why}` : 'Best reply' }]);
    } catch (e) {
      Store.set({ aiError: e.message || String(e) });
    } finally {
      Store.set({ bestBusy: false });
    }
  }

  async function askQuestion(q) {
    const question = (q || '').trim();
    if (!question) return;
    const s = Store.get();
    if (!AI.available()) { notify('No AI model is connected, so questions cannot be answered.'); return; }
    Store.set({ askBusy: true, aiError: '' });
    try {
      const res = await AI.ask(Store.get(), userById(s.userId), question);
      pushCards([{ kind: 'answer', text: res.answer, source: res.source || `Q: ${question}` }]);
    } catch (e) {
      Store.set({ aiError: e.message || String(e) });
    } finally {
      Store.set({ askBusy: false });
    }
  }

  function updateSettings(patch) {
    const settings = Object.assign({}, Store.get().settings, patch);
    saveSettings(settings);
    AI.configure(settings);
    if (patch.audio === false) TTS.cancel();
    Store.set({ settings, aiStatus: AI.status() });
  }

  /* ------------------------------------------------------------------ */
  /* Components                                                           */
  /* ------------------------------------------------------------------ */
  const KIND_LABEL = { say: 'Say', ask: 'Ask', tell: 'Tell', info: 'Info', do: 'Do', recommendation: 'Recommendation', caution: 'Caution', answer: 'Answer' };

  function useAutoScroll(ref, key) {
    const seen = useRef(false);
    useEffect(() => {
      const el = ref.current;
      if (!el) return;
      const behavior = seen.current ? 'smooth' : 'auto';
      seen.current = true;
      try { el.scrollTo({ top: el.scrollHeight, behavior }); } catch (e) { el.scrollTop = el.scrollHeight; }
    }, [key]);
  }

  function StatusPill({ s }) {
    const [, tick] = useState(0);
    useEffect(() => { const id = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(id); }, []);
    let text = 'Ready';
    let cls = 'pill';
    if (s.callStatus === 'active') {
      cls = 'pill live';
      if (s.aiBusy) text = 'Analyzing…';
      else if (s.listening) text = `Listening as ${s.listening === 'caller' ? 'Caller' : 'Agent'}`;
      else text = `Call active · ${fmtClock(elapsed())}`;
    } else if (s.callStatus === 'ended') {
      text = `Call ended · ${fmtClock(s.transcript.length ? s.transcript[s.transcript.length - 1].t : 0)}`;
      cls = 'pill ended';
    }
    return html`<span class=${cls}>${text}</span>`;
  }

  function Rail({ s }) {
    const [draft, setDraft] = useState('');
    const scripted = s.mode === 'scripted';
    const active = s.callStatus === 'active';
    const sc = scripted ? scenarioById(s.scenarioId) : null;
    const next = sc ? sc.turns[s.scriptIndex] : null;
    const total = sc ? sc.turns.length : 0;
    const user = userById(s.userId);
    const speakClass = (who) => {
      let c = 'rail-btn';
      if (scripted && active && !s.autoplay && next && next.speaker === who) c += ' next';
      if (!scripted && s.listening === who) c += ' listening';
      return c;
    };
    const send = (who) => { const t = draft.trim(); if (!t) return; if (!active) { notify('Start the call first.'); return; } addLiveLine(who, t); setDraft(''); };
    return html`
      <aside class="rail">
        <div class="rail-top">
          <${StatusPill} s=${s} />
          <button class="icon-btn" title="Settings" aria-label="Settings" onClick=${() => Store.set({ settingsOpen: true })}>⚙</button>
        </div>
        <div class="seg">
          <button class=${scripted ? 'on' : ''} onClick=${() => setMode('scripted')}>Scripted</button>
          <button class=${!scripted ? 'on' : ''} onClick=${() => setMode('live')}>Live voice</button>
        </div>
        <button class=${'rail-btn ' + (s.callStatus === 'idle' ? 'primary' : '')} onClick=${() => startCall()}>${s.callStatus === 'idle' ? 'Start call' : 'New call'}</button>
        <button class=${speakClass('caller')} disabled=${!active || (scripted && s.autoplay)} onClick=${() => speakAs('caller')}>
          ${!scripted && s.listening === 'caller' ? html`<i class="dot"></i>` : ''}Speak as Caller
        </button>
        <button class=${speakClass('agent')} disabled=${!active || (scripted && s.autoplay)} onClick=${() => speakAs('agent')}>
          ${!scripted && s.listening === 'agent' ? html`<i class="dot"></i>` : ''}Speak as Support Agent
        </button>

        ${scripted ? html`
          <div class="rail-row">
            <button class="rail-small" onClick=${toggleAutoplay}>${s.autoplay ? '❚❚ Pause' : '▶ Play all'}</button>
            <button class="rail-small" disabled=${!active || s.autoplay} onClick=${playNext}>Next ▸</button>
          </div>
          <div class="rail-row">
            <button class=${'rail-small ' + (s.settings.audio ? '' : 'off')} title=${TTS.supported ? 'Read the scripted lines aloud' : 'Speech synthesis is not available in this browser'} onClick=${() => updateSettings({ audio: !s.settings.audio })}>${s.settings.audio ? '🔊 Audio on' : '🔇 Audio off'}</button>
            <span class="rail-note center">${sc ? `Turn ${Math.min(s.scriptIndex, total)} of ${total}` : 'Random scenario'}</span>
          </div>
          <div class="rail-note">${sc ? html`<b>${user.phone}</b> · ${sc.title}` : 'Pick an incoming number below, or leave it random.'}</div>
          ${s.settings.audio && !TTS.supported ? html`<div class="rail-warn">No speech synthesis here; lines play silently.</div>` : ''}
        ` : html`
          <div class="rail-note">
            ${recognizer.supported
              ? (s.listening ? html`<span class="rec">● Listening.</span> Speak naturally; each pause becomes a line.` : 'Pick who you are speaking as, then talk. Click again to stop.')
              : 'Voice input needs Chrome or Edge. Type lines below.'}
          </div>
          <div class="rail-note">${active || s.callStatus === 'ended' ? html`Incoming number <b>${user.phone}</b> matched to a record; see Customer 360.` : 'Pick an incoming number below, or leave it random.'}</div>
          <textarea id="live-draft" class="rail-text" rows="2" placeholder="Or type a line here…" value=${draft} onInput=${(e) => setDraft(e.target.value)}
            onKeyDown=${(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(e.altKey ? 'agent' : 'caller'); } }}></textarea>
          <div class="rail-row">
            <button class="rail-small" disabled=${!active} onClick=${() => send('caller')}>Send as Caller</button>
            <button class="rail-small" disabled=${!active} onClick=${() => send('agent')}>Send as Agent</button>
          </div>
          <div class="rail-hint">Enter sends as caller, Alt+Enter as agent.</div>
        `}

        <label class="rail-select" title="Which phone number the simulated call comes from">
          <span>Incoming number</span>
          <select value=${s.incoming} disabled=${active} onChange=${(e) => Store.set({ incoming: e.target.value })}>
            <option value="random">Random</option>
            ${D.USERS.map((u) => html`<option key=${u.id} value=${u.id}>${u.phone}</option>`)}
          </select>
        </label>
        <div class="rail-row">
          <button class="rail-btn ghost" disabled=${!active} onClick=${endCall}>End call</button>
          <button class="rail-btn ghost" disabled=${s.callStatus === 'idle' && !s.transcript.length} onClick=${resetAll}>Reset</button>
        </div>
        <div class=${'ai-status ' + (AI.available() ? 'ok' : '')} title=${s.aiStatus.label}>${s.aiStatus.label}</div>
      </aside>`;
  }

  function StepIcon({ status }) {
    if (status === 'done') return html`<svg class="ico ok" viewBox="0 0 14 14" aria-label="done"><polyline points="2,7 6,11 12,3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    if (status === 'missed') return html`<span class="ico miss" aria-label="missed">!</span>`;
    return html`<span class="ico pend" aria-label="pending"></span>`;
  }

  function Workflow({ s }) {
    const groups = s.groups;
    return html`
      <div class="wf">
        <h2 class="panel-title">Workflow Steps</h2>
        <div class="wf-panel">
          ${groups.length ? '' : html`<div class="wf-empty">${s.callStatus === 'idle' ? 'Steps appear once a call starts and the caller says what they need.' : 'Listening for what the caller needs…'}</div>`}
          ${groups.map((g) => html`
            <div key=${g.id + ':' + (g.changed || 0)} class=${'wf-group' + (g.changed ? ' pop' : '')}>
              <div class="wf-group-title">${g.title}</div>
              ${g.steps.map((st) => html`
                <div key=${st.id + ':' + (st.changed || 0)} class=${'wf-step ' + st.status + (st.changed ? ' pop' : '')}>
                  <${StepIcon} status=${st.status} />
                  <span class="wf-label">${st.label}</span>
                </div>`)}
            </div>`)}
        </div>
      </div>`;
  }

  function ToolStrip({ s }) {
    const ids = (s.suggestedTool && !s.tools.includes(s.suggestedTool) ? [s.suggestedTool].concat(s.tools) : s.tools).filter((id) => toolById(id));
    return html`
      <div class="tools">
        <div class="tools-label">Contextual tools${s.suggestedTool ? html`<span class="tools-hint"> · ${toolById(s.suggestedTool).label} is needed now</span>` : ''}</div>
        <div class="chips">
          ${ids.map((id) => { const t = toolById(id); const flash = s.suggestedTool === id && s.selectedTool !== id; return html`
            <button key=${id} class=${'chip ' + (s.selectedTool === id ? 'on ' : '') + (flash ? 'flash' : '')} title=${flash ? 'Suggested now: ' + t.description : t.description} onClick=${() => selectTool(id)}>${t.label}</button>`; })}
        </div>
      </div>`;
  }

  function Tabs({ s }) {
    const tab = (id, label, badge) => html`<button class=${'tab ' + (s.tab === id ? 'on' : '')} onClick=${() => Store.set({ tab: id, unseenGuidance: id === 'guidance' ? 0 : s.unseenGuidance })}>${label}${badge ? html`<span class="tab-badge">${badge}</span>` : ''}</button>`;
    return html`<div class="tabs">${tab('guidance', 'Live Guidance', s.tab !== 'guidance' && s.unseenGuidance ? s.unseenGuidance : 0)}${tab('customer', 'Customer 360')}${tab('transcript', 'Transcript')}
      ${s.tab === 'guidance' && s.guidance.length ? html`<button class="link tabs-action" onClick=${() => Store.set({ guidance: [] })}>Clear guidance</button>` : ''}</div>`;
  }

  function GuidanceCard({ c }) {
    return html`
      <div class=${'gcard kind-' + c.kind}>
        <div class="gline">
          <span class=${'kw kw-' + c.kind}>${KIND_LABEL[c.kind] || c.kind}:</span>
          <span class="gtext">${c.text}</span>
        </div>
        ${c.bullets && c.bullets.length ? html`<ul class="gbullets">${c.bullets.map((b, i) => html`<li key=${i}>${b}</li>`)}</ul>` : ''}
        ${c.source ? html`<span class="gsrc">${c.source}</span>` : ''}
      </div>`;
  }

  function GuidanceTab({ s }) {
    const boxRef = useRef(null);
    const lastRef = useRef(null);
    const spacerRef = useRef(null);
    const batches = [];
    s.guidance.forEach((c) => {
      const last = batches[batches.length - 1];
      if (last && last.batch === c.batch) last.cards.push(c);
      else batches.push({ batch: c.batch, cards: [c] });
    });
    const latest = batches.length ? batches[batches.length - 1].batch : 0;
    /* Keep only the newest guidance in view: older batches sit above, reachable by scrolling up. */
    useEffect(() => {
      const box = boxRef.current; const last = lastRef.current; const spacer = spacerRef.current;
      if (!box) return;
      if (!last) { if (spacer) spacer.style.height = '0px'; return; }
      const pad = parseFloat(getComputedStyle(box).paddingTop) || 0;
      const lead = 4;                                   /* the newest card sits 4px below the top edge; the previous one is scrolled out */
      const room = box.clientHeight - lead - pad - last.offsetHeight;
      if (spacer) spacer.style.height = `${Math.max(0, room)}px`;
      const top = last.offsetTop - lead;
      try { box.scrollTo({ top, behavior: batches.length > 1 ? 'smooth' : 'auto' }); } catch (e) { box.scrollTop = top; }
    }, [latest, s.guidance.length, s.aiBusy, s.aiError]);
    return html`
      <div class="guidance">
        <div class="tags">
          <span class="tags-label">Tags:</span>
          ${s.tags.length ? s.tags.map((t) => html`<span key=${t} class="tag">${t}</span>`) : html`<span class="tags-empty">none yet</span>`}
        </div>
        <div class="gbox" ref=${boxRef}>
          ${batches.length
            ? batches.map((b, i) => html`
              <div key=${b.batch} class=${'gbatch ' + (b.batch === latest ? 'latest' : 'earlier')} ref=${i === batches.length - 1 ? lastRef : null}>
                ${b.cards.map((c) => html`<${GuidanceCard} key=${c.id} c=${c} />`)}
              </div>`)
            : html`<div class="gempty">${s.callStatus === 'idle' ? 'Start a call. Only things worth your attention show up here: policy risks, facts the caller needs, offers worth making.' : 'Nothing needs your attention yet.'}</div>`}
          ${s.aiBusy ? html`<div class="gbusy">GPT-5.6 Luna is updating the screen…</div>` : ''}
          ${s.aiError ? html`<div class="gerror">${s.aiError}</div>` : ''}
          <div class="gspacer" ref=${spacerRef}></div>
        </div>
        <${ToolIO} s=${s} />
      </div>`;
  }

  function ToolIO({ s }) {
    if (!s.selectedTool) {
      return html`<div class="toolio-hint">Click a tool on the left to run it from this screen. Inputs the assistant found in the call or the customer record are pre-filled; blank ones are yours to fill.</div>`;
    }
    const tool = toolById(s.selectedTool);
    const set = (k, v) => Store.set((st) => ({ toolInputs: Object.assign({}, st.toolInputs, { [k]: v }) }));
    return html`
      <div class="toolio">
        <div class="io-col">
          <div class="io-label">Input: <span class="io-tool">${tool.label}</span></div>
          <div class="io-scroll">
            <table class="io-table">
              ${tool.inputs.map((f) => html`
                <tr key=${f.key}>
                  <th>${f.label}</th>
                  <td>
                    ${f.type === 'select'
                      ? html`<select id=${'in-' + f.key} value=${s.toolInputs[f.key] || ''} onChange=${(e) => set(f.key, e.target.value)}>${f.options.map((o) => html`<option key=${o} value=${o}>${o}</option>`)}</select>`
                      : html`<input id=${'in-' + f.key} type="text" value=${s.toolInputs[f.key] || ''} onInput=${(e) => set(f.key, e.target.value)} />`}
                  </td>
                </tr>`)}
            </table>
          </div>
          <div class="io-actions">
            <button class="btn-dark" disabled=${s.toolBusy || s.callStatus === 'idle'} onClick=${async () => { await runTool(s.selectedTool, Store.get().toolInputs); scheduleAnalysis(); }}>${s.toolBusy ? 'Running…' : 'Execute'}</button>
            <button class="link" onClick=${() => Store.set({ selectedTool: null, toolResult: null })}>Close</button>
            ${s.callStatus === 'idle' ? html`<span class="io-note">Start a call to run tools.</span>` : ''}
          </div>
        </div>
        <div class="io-col">
          <div class="io-label">Output:</div>
          <div class="io-out">
            ${s.toolBusy ? html`<div class="io-wait">${tool.message || `Calling ${tool.label}`}…</div>` : ''}
            ${!s.toolBusy && s.toolResult ? Object.entries(s.toolResult).map(([k, v]) => html`
              <div key=${k} class=${'io-row ' + (k === 'demo_mode' ? 'demo' : '')}><span class="io-k">${k}</span><span class="io-v">${fmtVal(v)}</span></div>`) : ''}
            ${!s.toolBusy && !s.toolResult ? html`<div class="io-wait">Press Execute to call the mock API.</div>` : ''}
          </div>
        </div>
      </div>`;
  }

  function CustomerTab({ s }) {
    const u = userById(s.userId);
    const kv = (rows) => html`<dl class="kv">${rows.map(([k, v]) => html`<div key=${k}><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>`;
    return html`
      <div class="c360">
        ${s.callStatus !== 'idle' ? html`<div class="incoming wide">☏ Incoming call from <b>${u.phone}</b> · matched to <b>${u.name}</b>${s.callStatus === 'ended' ? ' · call ended' : ''}</div>` : ''}
        <section>
          <h3>Profile</h3>
          ${kv([['Name', u.name], ['Date of birth', u.dob], ['Phone', u.phone], ['Email', u.email], ['Preferred contact', u.preferredContact], ['Language', u.language]])}
        </section>
        <section>
          <h3>Preferred store</h3>
          ${kv([['Store', `${u.store.name} ${u.store.id}`], ['Address', u.store.address], ['Phone', u.store.phone], ['Hours', u.store.hours]])}
        </section>
        <section>
          <h3>Insurance</h3>
          ${kv([['Plan', u.insurance.plan], ['Member ID', u.insurance.memberId], ['Group', u.insurance.group], ['Status', u.insurance.status], ['Copay', `${u.insurance.copay30} / 30 days · ${u.insurance.copay90} / 90 days`]])}
        </section>
        <section class="wide">
          <h3>Active prescriptions</h3>
          <table class="rx">
            <thead><tr><th>Rx</th><th>Medication</th><th>Directions</th><th>Supply</th><th>Refills</th><th>Last fill</th><th>Status</th></tr></thead>
            <tbody>${u.prescriptions.map((p) => html`<tr key=${p.rx}><td>${p.rx}</td><td>${p.drug}</td><td>${p.sig}</td><td>${p.qty} / ${p.days} days</td><td>${p.refills}</td><td>${p.lastFill}</td><td>${p.status}</td></tr>`)}</tbody>
          </table>
        </section>
        <section>
          <h3>Allergies and immunizations</h3>
          ${kv([['Allergies', u.allergies.join(', ')], ['Immunizations', u.immunizations.length ? u.immunizations.map((i) => `${i.vaccine} (${i.date})`).join('; ') : 'None on file']])}
        </section>
        <section>
          <h3>Recent interactions</h3>
          <ul class="hist">${u.interactions.map((i) => html`<li key=${i.date + i.channel}><b>${i.date}</b> · ${i.channel}: ${i.summary}</li>`)}</ul>
        </section>
        <section class="wide">
          <h3>Notes</h3>
          <p>${u.notes}</p>
        </section>
      </div>`;
  }

  function TranscriptTab({ s }) {
    const boxRef = useRef(null);
    useAutoScroll(boxRef, `${s.transcript.length}|${s.interim}`);
    return html`
      <div class="transcript" ref=${boxRef}>
        ${s.transcript.length ? '' : html`<div class="gempty">${s.callStatus === 'idle' ? 'The live transcript appears here once the call starts.' : 'Waiting for the first line…'}</div>`}
        ${s.transcript.map((l) => html`
          <div key=${l.id} class=${'tline ' + l.speaker}>
            <span class="tt">${fmtClock(l.t)}</span>
            <span class="tw">${l.speaker === 'caller' ? 'Caller' : l.speaker === 'agent' ? 'Agent' : 'Tool'}</span>
            <span class="tx">${l.text}</span>
          </div>`)}
        ${s.interim ? html`<div class=${'tline interim ' + (s.listening || '')}><span class="tt">…</span><span class="tw">${s.listening === 'agent' ? 'Agent' : 'Caller'}</span><span class="tx">${s.interim}</span></div>` : ''}
      </div>`;
  }

  function BottomBar({ s }) {
    const [q, setQ] = useState('');
    const busy = s.askBusy;
    return html`
      <div class="bottombar">
        <button class="btn-dark big" disabled=${s.bestBusy || s.callStatus === 'idle'} onClick=${getBestReply}>${s.bestBusy ? 'Thinking…' : 'Get Best Reply'}</button>
        <form class="ask" onSubmit=${(e) => { e.preventDefault(); if (!busy) { askQuestion(q); setQ(''); } }}>
          <input id="ask-input" type="text" placeholder="Ask the assistant… e.g. can she stack a coupon with insurance?" value=${q} onInput=${(e) => setQ(e.target.value)} />
          <button type="submit" class="btn-ask" disabled=${busy || !q.trim()}>${busy ? '…' : 'Ask'}</button>
        </form>
      </div>`;
  }

  function SettingsModal({ s }) {
    const [form, setForm] = useState(Object.assign({}, s.settings));
    const [test, setTest] = useState('');
    const inArtifact = !!global.claude;
    const f = (k) => (e) => setForm(Object.assign({}, form, { [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
    const save = () => { updateSettings(form); Store.set({ settingsOpen: false }); };
    const runTest = async () => {
      updateSettings(form);
      setTest('Testing…');
      try { const r = await AI.ping(); setTest(r && r.ok ? 'Connected. GPT-5.6 Luna answered.' : 'Unexpected answer.'); }
      catch (e) { setTest(`Failed: ${e.message || e}`); }
    };
    return html`
      <div class="modal-back" onClick=${(e) => { if (e.target === e.currentTarget) Store.set({ settingsOpen: false }); }}>
        <div class="modal" role="dialog" aria-label="Settings">
          <h3>Settings</h3>
          <p class=${'modal-status ' + (AI.available() ? 'ok' : '')}>${AI.status().label}</p>
          ${AI.mode === 'server' ? html`<p class="modal-help">GPT-5.6 Luna and ElevenLabs run on this local server. The keys stay in .env, not in the browser.</p>` : inArtifact ? html`
            <p class="modal-help">This page is running inside claude.ai, so Claude is reached through the viewer and no API key is needed. Voice input is not available here; type lines in Live mode, or download the folder to run with the microphone.</p>
            <label class="field"><span>Speed</span>
              <select value=${form.tier} onChange=${f('tier')}>
                <option value="quick">Quick (fastest, no deliberation)</option>
                <option value="default">Default (slower, thinks first)</option>
              </select></label>
          ` : html`
            <p class="modal-help">${AI.server ? 'This server has no OpenAI key yet. Add OPENAI_API_KEY and ELEVENLABS_API_KEY to .env and restart. Scripted playback still works.' : 'No local server is running, so only scripted playback is available. From the project folder, run npm start and open http://localhost:8080.'}</p>
          `}
          <label class="field check"><input type="checkbox" checked=${form.audio} onChange=${f('audio')} /><span>Read the scripted call aloud</span></label>
          <p class="modal-help">The panels update automatically after every line. Behavior comes from prompts/system_prompt.md, prompts/phone_assist.md, prompts/phone_assist_best_reply.md, prompts/chat.md, tools.md and kb/. Refresh the page after editing them.</p>
          <div class="modal-actions">
            <button class="btn-dark" onClick=${save}>Save</button>
            <button class="btn-plain" onClick=${runTest}>Test connection</button>
            <button class="link" onClick=${() => Store.set({ settingsOpen: false })}>Cancel</button>
          </div>
          ${test ? html`<div class="modal-test">${test}</div>` : ''}
        </div>
      </div>`;
  }

  function Toast({ s }) {
    return s.notice ? html`<div class="toast">${s.notice}</div>` : '';
  }

  function App() {
    const s = useStore();
    return html`
      <div class="stage">
        <${Rail} s=${s} />
        <main class="card">
          <section class="left">
            <${Workflow} s=${s} />
            <${ToolStrip} s=${s} />
          </section>
          <section class="right">
            <${Tabs} s=${s} />
            <div class="tabbody">
              ${s.tab === 'guidance' ? html`<${GuidanceTab} s=${s} />` : ''}
              ${s.tab === 'customer' ? html`<${CustomerTab} s=${s} />` : ''}
              ${s.tab === 'transcript' ? html`<${TranscriptTab} s=${s} />` : ''}
            </div>
            <${BottomBar} s=${s} />
          </section>
        </main>
      </div>
      ${s.settingsOpen ? html`<${SettingsModal} s=${s} />` : ''}
      <${Toast} s=${s} />`;
  }

  /* ------------------------------------------------------------------ */
  /* Boot                                                                 */
  /* ------------------------------------------------------------------ */
  AI.onChange((st) => {
    TTS.useServer(AI.hasVoice());
    const idle = Store.get().callStatus === 'idle';
    Store.set(idle ? { aiStatus: st, tools: defaultTools(), selectedTool: null } : { aiStatus: st });
  });
  AI.init(Store.get().settings);
  render(html`<${App} />`, document.getElementById('app'));

  global.PhoneAssist = { Store, startCall, playNext, toggleAutoplay, runTool, selectTool, getBestReply, askQuestion, setMode, speakAs, addLiveLine, resetAll, endCall };
})(window);
