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
  const DEFAULT_SETTINGS = { apiKey: '', model: 'claude-opus-5-5', effort: 'low', baseUrl: '', tier: 'quick', autoAnalyze: true, engine: 'script', audio: true };
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
  const toolById = (id) => D.TOOLS.find((t) => t.id === id);
  const scenarioById = (id) => D.SCENARIOS.find((sc) => sc.id === id) || null;
  const pickRandom = (list, notId) => {
    const pool = list.length > 1 ? list.filter((x) => x.id !== notId) : list;
    return pool[Math.floor(Math.random() * pool.length)];
  };

  function freshCall() {
    return {
      callStatus: 'idle', callStart: null, transcript: [], interim: '',
      groups: D.SOP.map((g) => ({ id: g.id, title: g.title, active: !!g.always, added: false, steps: g.steps.map((s) => ({ id: s.id, label: s.label, status: 'pending' })) })),
      tags: [], guidance: [], batch: 0, tools: D.DEFAULT_TOOLS.slice(),
      selectedTool: null, toolInputs: {}, toolBusy: false, toolResult: null, toolRuns: [], suggestedTool: null,
      scenarioId: null, scriptIndex: 0, autoplay: false, listening: null, speaking: null, aiBusy: false, aiError: '', bestBusy: false, askBusy: false
    };
  }

  const Store = (() => {
    let state = Object.assign(freshCall(), {
      userId: pickRandom(D.USERS).id, mode: 'scripted', tab: 'guidance', settings: loadSettings(), settingsOpen: false,
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
    useEffect(() => Store.subscribe(setS), []);
    return s;
  }

  const effectiveEngine = (s) => (s.mode === 'live' ? 'ai' : s.settings.engine);
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
      const fresh = cards.map((c) => ({ id: nextId(), batch, kind: c.kind, text: c.text, bullets: Array.isArray(c.bullets) ? c.bullets.filter((b) => typeof b === 'string' && b.trim()) : [], source: c.source || '' }));
      return { batch, guidance: s.guidance.concat(fresh).slice(-60) };
    });
  }

  function setSteps(statusMap) {
    if (!statusMap) return;
    const now = Date.now();
    Store.set((s) => ({ groups: s.groups.map((g) => ({ ...g, steps: g.steps.map((st) => (statusMap[st.id] && statusMap[st.id] !== st.status ? { ...st, status: statusMap[st.id], changed: now } : st)) })) }));
  }

  function suggestTool(id) {
    Store.set({ suggestedTool: id && toolById(id) ? id : null });
  }

  function activateGroups(ids) {
    if (!ids || !ids.length) return;
    Store.set((s) => {
      const midCall = s.transcript.length > 3;
      return { groups: s.groups.map((g) => (ids.includes(g.id) && !g.active ? { ...g, active: true, added: midCall, changed: Date.now() } : g)) };
    });
  }

  function addTags(add, remove) {
    Store.set((s) => {
      let tags = s.tags.filter((t) => !(remove || []).includes(t));
      (add || []).forEach((t) => { if (!tags.includes(t)) tags = tags.concat([t]); });
      return { tags };
    });
  }

  function setTools(ids) {
    const known = (ids || []).filter((id) => toolById(id));
    if (known.length) Store.set({ tools: known });
  }

  function applyDelta(d) {
    if (!d) return;
    activateGroups(d.activate);
    setSteps(d.steps);
    addTags(d.tagsAdd, d.tagsRemove);
    setTools(d.tools);
    if (Object.prototype.hasOwnProperty.call(d, 'suggestTool')) suggestTool(d.suggestTool);
    pushCards(d.guidance);
  }

  function toolContext() {
    const s = Store.get();
    return { user: userById(s.userId), transcript: s.transcript, state: s };
  }

  function selectTool(id) {
    const tool = toolById(id);
    if (!tool) return;
    const ctx = toolContext();
    const inputs = {};
    tool.inputs.forEach((f) => { inputs[f.key] = f.prefill ? (f.prefill(ctx) || '') : ''; });
    Store.set((st) => ({ selectedTool: id, toolInputs: inputs, toolResult: null, tab: 'guidance', suggestedTool: st.suggestedTool === id ? null : st.suggestedTool }));
  }

  async function runTool(id, inputs) {
    const tool = toolById(id);
    if (!tool) return null;
    Store.set((st) => ({ selectedTool: id, toolInputs: inputs, toolResult: null, toolBusy: true, tab: 'guidance', suggestedTool: st.suggestedTool === id ? null : st.suggestedTool }));
    await sleep(700);
    const ctx = toolContext();
    let r;
    try { r = tool.run(inputs, ctx); } catch (e) { r = { output: { Error: String(e.message || e) } }; }
    const output = Object.assign({}, r.output || {}, { demo_mode: 'true' });
    const summary = Object.entries(r.output || {}).slice(0, 2).map(([k, v]) => `${k}: ${v}`).join(' · ');
    addLine('tool', `${tool.label} → ${summary}`);
    Store.set((s) => ({ toolBusy: false, toolResult: output, toolRuns: s.toolRuns.concat([{ id: nextId(), tool: id, inputs, output, t: elapsed() }]) }));
    if (r.stepsDone && r.stepsDone.length) {
      const map = {}; r.stepsDone.forEach((sid) => { map[sid] = 'done'; });
      setSteps(map);
    }
    if (r.tagsAdd) addTags(r.tagsAdd);
    pushCards(r.cards);
    return r;
  }

  function applyAnalysis(res) {
    if (!res || typeof res !== 'object') throw new Error('Empty analysis');
    const always = D.SOP.filter((g) => g.always).map((g) => g.id);
    activateGroups((res.activeGroups || []).concat(always));
    const map = {};
    (res.steps || []).forEach((st) => { if (st && st.id && ['done', 'pending', 'missed'].includes(st.status)) map[st.id] = st.status; });
    setSteps(map);
    if (Array.isArray(res.tags)) {
      const tags = res.tags.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim()).slice(0, 8);
      Store.set({ tags });
    }
    setTools(res.tools);
    suggestTool(typeof res.suggestedTool === 'string' ? res.suggestedTool.trim() : null);
    const cards = (res.guidance || []).filter((c) => c && c.text && D.GUIDANCE_KINDS.includes(c.kind) && c.kind !== 'say').slice(0, 2);
    pushCards(cards);
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
    if (s.mode === 'scripted') {
      const sc = (opts.scenarioId && scenarioById(opts.scenarioId)) || pickRandom(D.SCENARIOS, lastScenarioId);
      scenarioId = sc.id;
      userId = sc.userId;
      lastScenarioId = sc.id;
    } else {
      userId = (opts.userId && userById(opts.userId).id === opts.userId) ? opts.userId : pickRandom(D.USERS, lastUserId).id;
      lastUserId = userId;
    }
    Store.set(Object.assign(freshCall(), { userId, scenarioId, callStatus: 'active', callStart: Date.now(), tab: 'guidance', aiStatus: AI.status() }));
    if (s.mode === 'scripted') {
      if (autoFirst) setTimeout(() => { if (Store.get().callStatus === 'active' && Store.get().scriptIndex === 0) playTurn(0, { interrupt: false }); }, 300);
    } else {
      suggestTool('verify_identity');
      if (!AI.available()) notify('No Claude connection: lines will be transcribed but the panels will not update. Open Settings to connect.');
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
      const d = turn.delta || {};
      const engine = effectiveEngine(Store.get());
      const toolRuns = d.tool ? (Array.isArray(d.tool) ? d.tool : [d.tool]) : [];
      for (const t of toolRuns) await runTool(t.id, t.inputs);     // the agent's actions come first
      if (engine === 'script') applyDelta(d);                       // then what the AI noticed
      if (engine === 'ai') await scheduleAnalysis();
      const spoke = await speech;
      if (d.end || i + 1 >= turns.length) Store.set({ callStatus: 'ended', autoplay: false });
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
    if (Store.get().settings.autoAnalyze) scheduleAnalysis();
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
    if (effectiveEngine(s) === 'script') {
      const sc = currentScenario();
      const played = sc ? sc.turns.slice(0, s.scriptIndex).reverse() : [];
      const turn = played.find((t) => t.delta && t.delta.bestReply);
      if (!turn) { notify('No scripted best reply yet. Play a caller line first.'); return; }
      pushCards([{ kind: 'say', text: turn.delta.bestReply, source: 'Best reply' }]);
      return;
    }
    if (!AI.available()) { notify('Connect Claude in Settings to generate a best reply.'); return; }
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
    if (AI.available() && effectiveEngine(s) === 'ai') {
      Store.set({ askBusy: true, aiError: '' });
      try {
        const res = await AI.ask(Store.get(), userById(s.userId), question);
        pushCards([{ kind: 'answer', text: res.answer, source: res.source || `Q: ${question}` }]);
      } catch (e) {
        Store.set({ aiError: e.message || String(e) });
      } finally {
        Store.set({ askBusy: false });
      }
      return;
    }
    const hit = D.CANNED_ANSWERS.find((c) => c.match.test(question));
    if (hit) pushCards([{ kind: 'answer', text: hit.answer, source: hit.source }]);
    else pushCards([{ kind: 'answer', text: 'In scripted mode I answer from the knowledge base only. Ask about coupons, transfers, early refills, flu shots, identity checks or prior authorization, or connect Claude in Settings for free-form questions.', source: `Q: ${question}` }]);
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
          <div class="rail-note">${sc ? html`<b>${user.name}</b> · ${sc.title}` : 'Start call picks one of three callers and situations at random.'}</div>
          ${s.settings.audio && !TTS.supported ? html`<div class="rail-warn">No speech synthesis here; lines play silently.</div>` : ''}
          ${s.settings.engine === 'ai' ? html`<div class=${'rail-warn ' + (AI.available() ? 'ok' : '')}>Claude drives the panels for this replay${AI.available() ? '' : ', but it is not connected'}.</div>` : ''}
        ` : html`
          <div class="rail-note">
            ${recognizer.supported
              ? (s.listening ? html`<span class="rec">● Listening.</span> Speak naturally; each pause becomes a line.` : 'Pick who you are speaking as, then talk. Click again to stop.')
              : 'Voice input needs Chrome or Edge. Type lines below.'}
          </div>
          <div class="rail-note">${active || s.callStatus === 'ended' ? html`Caller on record: <b>${user.name}</b> (picked at random)` : 'Start call picks a caller record at random.'}</div>
          <textarea id="live-draft" class="rail-text" rows="2" placeholder="Or type a line here…" value=${draft} onInput=${(e) => setDraft(e.target.value)}
            onKeyDown=${(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(e.altKey ? 'agent' : 'caller'); } }}></textarea>
          <div class="rail-row">
            <button class="rail-small" disabled=${!active} onClick=${() => send('caller')}>Send as Caller</button>
            <button class="rail-small" disabled=${!active} onClick=${() => send('agent')}>Send as Agent</button>
          </div>
          <div class="rail-hint">Enter sends as caller, Alt+Enter as agent.</div>
        `}

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
    const groups = s.groups.filter((g) => g.active);
    return html`
      <div class="wf">
        <h2 class="panel-title">Workflow Steps</h2>
        <div class="wf-panel">
          ${groups.map((g) => html`
            <div key=${g.id + ':' + (g.changed || 0)} class=${'wf-group ' + (g.added ? 'added' : '') + (g.changed ? ' pop' : '')}>
              <div class="wf-group-title">${g.title}${g.added ? html`<span class="wf-badge">added mid-call</span>` : ''}</div>
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
    const ids = s.suggestedTool && !s.tools.includes(s.suggestedTool) ? [s.suggestedTool].concat(s.tools) : s.tools;
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
    const tab = (id, label) => html`<button class=${'tab ' + (s.tab === id ? 'on' : '')} onClick=${() => Store.set({ tab: id })}>${label}</button>`;
    return html`<div class="tabs">${tab('guidance', 'Live Guidance')}${tab('customer', 'Customer 360')}${tab('transcript', 'Transcript')}
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
          ${s.aiBusy ? html`<div class="gbusy">Claude is updating the screen…</div>` : ''}
          ${s.aiError ? html`<div class="gerror">${s.aiError}</div>` : ''}
          <div class="gspacer" ref=${spacerRef}></div>
        </div>
        <${ToolIO} s=${s} />
      </div>`;
  }

  function ToolIO({ s }) {
    if (!s.selectedTool) {
      return html`<div class="toolio-hint">Click a tool on the left to run it from this screen. Inputs are pre-filled from the customer record and the transcript.</div>`;
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
            <button class="btn-dark" disabled=${s.toolBusy || s.callStatus === 'idle'} onClick=${async () => { await runTool(s.selectedTool, Store.get().toolInputs); if (effectiveEngine(Store.get()) === 'ai') scheduleAnalysis(); }}>${s.toolBusy ? 'Running…' : 'Execute'}</button>
            <button class="link" onClick=${() => Store.set({ selectedTool: null, toolResult: null })}>Close</button>
            ${s.callStatus === 'idle' ? html`<span class="io-note">Start a call to run tools.</span>` : ''}
          </div>
        </div>
        <div class="io-col">
          <div class="io-label">Output:</div>
          <div class="io-out">
            ${s.toolBusy ? html`<div class="io-wait">Calling ${tool.label}…</div>` : ''}
            ${!s.toolBusy && s.toolResult ? Object.entries(s.toolResult).map(([k, v]) => html`
              <div key=${k} class=${'io-row ' + (k === 'demo_mode' ? 'demo' : '')}><span class="io-k">${k}</span><span class="io-v">${String(v)}</span></div>`) : ''}
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
      try { const r = await AI.ping(); setTest(r && r.ok ? 'Connected. Claude answered.' : 'Unexpected answer.'); }
      catch (e) { setTest(`Failed: ${e.message || e}`); }
    };
    return html`
      <div class="modal-back" onClick=${(e) => { if (e.target === e.currentTarget) Store.set({ settingsOpen: false }); }}>
        <div class="modal" role="dialog" aria-label="Settings">
          <h3>Settings</h3>
          <p class=${'modal-status ' + (AI.available() ? 'ok' : '')}>${AI.status().label}</p>
          ${inArtifact ? html`
            <p class="modal-help">This page is running inside claude.ai, so Claude is reached through the viewer and no API key is needed. Voice input is not available here; type lines in Live mode, or download the folder to run with the microphone.</p>
            <label class="field"><span>Speed</span>
              <select value=${form.tier} onChange=${f('tier')}>
                <option value="quick">Quick (fastest, no deliberation)</option>
                <option value="default">Default (slower, thinks first)</option>
              </select></label>
          ` : html`
            <label class="field"><span>Anthropic API key</span><input type="password" value=${form.apiKey} onInput=${f('apiKey')} placeholder="sk-ant-…" autocomplete="off" /></label>
            <label class="field"><span>Model</span>
              <select value=${form.model} onChange=${f('model')}>
                <option value="claude-opus-5-5">claude-opus-5-5 (default)</option>
                <option value="claude-sonnet-5-5">claude-sonnet-5-5 (faster)</option>
                <option value="claude-haiku-5-5">claude-haiku-5-5 (fastest)</option>
              </select></label>
            <label class="field"><span>Effort</span>
              <select value=${form.effort} onChange=${f('effort')}>
                <option value="low">low (fastest, recommended for live calls)</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
              </select></label>
            <label class="field"><span>API base URL (optional proxy)</span><input type="text" value=${form.baseUrl} onInput=${f('baseUrl')} placeholder="https://api.anthropic.com" /></label>
            <p class="modal-help">The key is kept in this browser's local storage and sent straight to the Claude API from this page. Fine for a laptop demo; use a proxy URL if you would rather not keep the key in the browser.</p>
          `}
          <label class="field check"><input type="checkbox" checked=${form.autoAnalyze} onChange=${f('autoAnalyze')} /><span>Update the panels automatically after every live line</span></label>
          <label class="field check"><input type="checkbox" checked=${form.audio} onChange=${f('audio')} /><span>Read the scripted call aloud (browser speech synthesis)</span></label>
          <label class="field"><span>Scripted replay: what fills the panels</span>
            <select value=${form.engine} onChange=${f('engine')}>
              <option value="script">The script's own deltas (deterministic, no AI)</option>
              <option value="ai">Claude, from the transcript (for testing the prompts)</option>
            </select></label>
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
  AI.onChange((st) => Store.set({ aiStatus: st }));
  AI.init(Store.get().settings);
  render(html`<${App} />`, document.getElementById('app'));

  global.PhoneAssist = { Store, startCall, playNext, toggleAutoplay, runTool, selectTool, getBestReply, askQuestion, setMode, speakAs, addLiveLine, resetAll, endCall };
})(window);
