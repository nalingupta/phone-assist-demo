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
  const userById = (id) => D.USERS.find((u) => u.id === id) || D.USERS[0];
  const toolById = (id) => AI.tools.find((t) => t.id === id);
  const MAX_SIM_TURNS = 40;            // simulated call: hard stop if neither side ends it
  const fmtVal = (v) => {
    if (v == null) return '';
    if (Array.isArray(v)) return v.map((x) => (x && typeof x === 'object' ? JSON.stringify(x) : String(x))).join(', ');
    return typeof v === 'object' ? JSON.stringify(v) : String(v);
  };
  const scenarioById = (id) => AI.scenarios.find((sc) => sc.id === id) || null;
  const pickRandom = (list, notId) => {
    const pool = list.length > 1 ? list.filter((x) => x.id !== notId) : list;
    return pool[Math.floor(Math.random() * pool.length)];
  };

  function freshCall() {
    return {
      callStatus: 'idle', callStart: null, transcript: [], interim: '',
      groups: [],
      unseenGuidance: 0,
      tags: [], guidance: [], batch: 0, toolPrefill: {},
      feed: [], toolRuns: [], suggestedTool: null, agentRequest: null, waitingStep: false, activeStep: null, stepSummary: null,
      scenarioId: null, turnCount: 0, nextSpeaker: 'agent', callerDone: false, agentFollowUp: false, autoplay: false, listening: null, speaking: null, callerThinking: false, aiBusy: false, aiError: '', bestBusy: false, askBusy: false
    };
  }

  const Store = (() => {
    let state = Object.assign(freshCall(), {
      userId: pickRandom(D.USERS).id, scenarioPick: 'random', mode: 'simulated', tab: 'guidance', settings: loadSettings(), settingsOpen: false,
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
  /* A line about to be read aloud is `speaking` until its voice ends; the prompts skip it until then. */
  function addLine(speaker, text, spoken) {
    const line = { id: nextId(), speaker, text, t: elapsed() };
    if (spoken && willSpeak()) line.speaking = true;
    Store.set((s) => ({ transcript: s.transcript.concat([line]) }));
    return line;
  }
  function lineHeard(id) {
    Store.set((s) => ({ transcript: s.transcript.map((l) => (l.id === id && l.speaking ? Object.assign({}, l, { speaking: false }) : l)) }));
  }

  /* A guidance update: its card. */
  function pushCards(cards) {
    if (!cards || !cards.length) return;
    Store.set((s) => {
      const batch = s.batch + 1;
      const t = elapsed();
      const fresh = cards.map((c) => ({ id: nextId(), batch, t, kind: c.kind, text: c.text, bullets: Array.isArray(c.bullets) ? c.bullets.filter((b) => typeof b === 'string' && b.trim()).slice(0, 3) : [], source: c.source || '', subject: c.subject || '' }));
      return { batch, guidance: s.guidance.concat(fresh).slice(-60), unseenGuidance: s.tab === 'guidance' ? 0 : s.unseenGuidance + fresh.length };
    });
  }

  /* ---------------- action feed: one row per tool, opened by a workflow step or the agent AI ---------------- */
  const prefilledInputs = (tool, values) => {
    const inputs = {};
    tool.inputs.forEach((f) => { inputs[f.key] = (values && values[f.key]) || ''; });
    return inputs;
  };
  const feedRow = (id) => Store.get().feed.find((r) => r.id === id);
  function updateRow(id, patch) {
    Store.set((s) => ({ feed: s.feed.map((r) => (r.id === id ? Object.assign({}, r, typeof patch === 'function' ? patch(r) : patch) : r)) }));
  }
  /* Simulates one call and records it in the transcript and the call's tool history. */
  /* A run belongs to the step whose row it came from, or else to the step the agent started last.
     The step's results summary at the top of Live Guidance is rebuilt from it. */
  async function simulate(tool, inputs, step) {
    const s = Store.get();
    const started = Date.now();
    const res = await AI.simulateTool(tool, inputs, s, userById(s.userId), step);
    if (res.fallback) notify(`Could not simulate ${tool.label}; showing its example output.${res.error ? ' ' + res.error : ''}`);
    const output = res.output || { demo_mode: true };
    const entries = Object.entries(output).filter(([k]) => k !== 'demo_mode');
    addLine('tool', `${tool.label} → ${entries.slice(0, 2).map(([k, v]) => `${k}: ${fmtVal(v)}`).join(' · ')}`);
    let bullets = res.summary && res.summary.length ? res.summary : null;
    if (!bullets) {
      const prev = s.stepSummary && step && s.stepSummary.stepId === step.stepId ? s.stepSummary.bullets : [];
      bullets = prev.concat(entries.slice(0, 6).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${fmtVal(v)}`));
    }
    const stepSummary = { stepId: step ? step.stepId : null, title: step ? step.label : tool.label, bullets, t: elapsed() };
    Store.set((st) => ({ toolRuns: st.toolRuns.concat([{ id: nextId(), tool: tool.id, inputs, output, step, t: elapsed() }]), stepSummary }));
    return { output, ms: Date.now() - started };
  }

  /* Opens a tool's input row, prefilled with what is known, for the agent to execute or skip.
     `auto` is 'step' (the agent started a workflow step; `step` says which) or 'agent' (the agent AI
     asked for it). An open row of the same tool is reused rather than duplicated. */
  function openDraft(id, auto, values, step) {
    const tool = toolById(id);
    if (!tool) return;
    Store.set((s) => {
      const draft = s.feed.find((r) => r.type === 'manual' && r.tool === id && r.status === 'draft');
      const filled = prefilledInputs(tool, Object.assign({}, s.toolPrefill[id], values));
      if (draft) {
        const inputs = Object.assign({}, draft.inputs);
        if (!draft.touched) Object.entries(filled).forEach(([k, v]) => { if (v) inputs[k] = v; });
        return { feed: s.feed.map((r) => (r.id === draft.id ? Object.assign({}, r, { inputs, auto: auto === 'agent' ? 'agent' : r.auto, step: step || r.step }) : r)) };
      }
      return { feed: s.feed.concat([{ id: nextId(), type: 'manual', tool: id, by: 'agent', auto, step: step || null, touched: false, status: 'draft', inputs: filled }]) };
    });
  }

  /* A new guidance update fills blank inputs in open rows. Open rows stay until the agent executes or skips them. */
  function fillDraftBlanks() {
    Store.set((s) => ({
      feed: s.feed.map((r) => {
        if (r.type !== 'manual' || r.status !== 'draft') return r;
        const tool = toolById(r.tool);
        const pre = s.toolPrefill[r.tool] || {};
        const inputs = Object.assign({}, r.inputs);
        tool.inputs.forEach((f) => { if (!String(inputs[f.key] || '').trim() && pre[f.key]) inputs[f.key] = pre[f.key]; });
        return Object.assign({}, r, { inputs });
      })
    }));
  }

  /* Simulated call: the agent AI asked for a human-only tool and waits until the human runs it or skips it. */
  let toolWait = null;   // { tool, resolve }
  function finishToolWait(toolId, ran) {
    if (!toolWait || (toolId && toolWait.tool !== toolId)) return;
    const w = toolWait;
    toolWait = null;
    Store.set({ agentRequest: null });
    w.resolve(ran);
  }

  function requestAgentTool(tool, inputs) {
    finishToolWait(null, false);
    const values = {};
    (inputs || []).forEach((f) => { if (f && f.name && String(f.value || '').trim()) values[f.name] = String(f.value); });
    Store.set({ agentRequest: { tool: tool.id, inputs: values }, tab: 'guidance' });
    const running = Store.get().feed.some((r) => r.type === 'manual' && r.tool === tool.id && r.status === 'running');
    if (!running) openDraft(tool.id, 'agent', values);
    return new Promise((resolve) => { toolWait = { tool: tool.id, resolve }; });
  }

  /* Skip: the row goes away and nothing ran. */
  function removeRow(r) {
    Store.set((st) => ({ feed: st.feed.filter((x) => x.id !== r.id) }));
    if (r.type === 'manual') finishToolWait(r.tool, false);
    noteToolDone();
  }

  /* Execute: the tool runs and its output shows in the row. */
  async function runManualRow(rowId) {
    const row = feedRow(rowId);
    const tool = row && toolById(row.tool);
    if (!tool || row.status !== 'draft') return;
    updateRow(rowId, { status: 'running' });
    Store.set((s) => ({ suggestedTool: s.suggestedTool === tool.id ? null : s.suggestedTool }));
    const { output, ms } = await simulate(tool, row.inputs, row.step || Store.get().activeStep);
    updateRow(rowId, { status: 'done', output, ms });
    finishToolWait(tool.id, true);
    noteToolDone();
  }

  function releaseWaits() {
    finishToolWait(null, false);
    finishStepWait();
  }

  /* Workflows are matched by name and steps by position. The AI only decides which workflows
     are shown; a step's status comes from the agent starting it. */
  function mergeWorkflows(prev, incoming) {
    const now = Date.now();
    const groups = prev.slice();
    incoming.forEach((wf) => {
      if (!wf || !wf.name || !Array.isArray(wf.steps) || !wf.steps.length) return;
      const labels = wf.steps.filter((st) => st && st.label).map((st) => String(st.label).replace(/\s*\b(Tools?|Policy):[\s\S]*$/, '').replace(/\.\s*$/, ''));
      const i = groups.findIndex((g) => g.title === wf.name);
      if (i < 0) {
        groups.push({ id: `wf${nextId()}`, title: String(wf.name), changed: now, steps: labels.map((label, n) => ({ id: `s${n}`, label, status: 'pending' })) });
        return;
      }
      const old = groups[i];
      groups[i] = { ...old, steps: labels.map((label, n) => (old.steps[n] ? { ...old.steps[n], label } : { id: `s${n}`, label, status: 'pending' })) };
    });
    return groups;
  }

  function updateWorkflowStep(groupId, stepId, patch) {
    Store.set((s) => ({ groups: s.groups.map((g) => (g.id !== groupId ? g : { ...g, steps: g.steps.map((st) => (st.id === stepId ? { ...st, ...patch } : st)) })) }));
  }

  function applyWorkflow(res) {
    if (!res || typeof res !== 'object') throw new Error('Empty workflow update');
    Store.set((s) => ({ groups: mergeWorkflows(s.groups, res.workflows || []) }));
  }

  /* A card repeats a recent one when their subjects share most of their words. Only the last few
     cards count, so a point can come back once the call has moved on to other things. */
  const RECENT_SUBJECTS = 3;
  function subjectWords(s) {
    return new Set(String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 2));
  }
  function repeatsRecent(card) {
    const a = subjectWords(card.subject || card.text);
    if (!a.size) return false;
    return (Store.get().guidance || []).slice(-RECENT_SUBJECTS).some((c) => {
      const b = subjectWords(c.subject || c.text);
      const shared = [...a].filter((w) => b.has(w)).length;
      return shared / Math.min(a.size, b.size || 1) >= 0.6;
    });
  }

  /* At most one flashcard per update, dropped when it repeats a recent one. */
  function applyGuidance(res) {
    if (!res || typeof res !== 'object') throw new Error('Empty guidance update');
    const tools = (res.tools || []).filter((t) => t && toolById(t.name));
    const prefill = {};
    tools.forEach((t) => {
      const values = {};
      (t.inputs || []).forEach((f) => { if (f && f.name && typeof f.value === 'string') values[f.name] = f.value; });
      prefill[t.name] = values;
    });
    Store.set((s) => ({
      tags: Array.isArray(res.tags) ? res.tags.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim()).slice(0, 8) : s.tags,
      toolPrefill: Object.assign({}, s.toolPrefill, prefill)
    }));
    if (Store.get().callStatus === 'active') fillDraftBlanks();
    if (res.newest_card_still_applies === false) {
      Store.set((s) => {
        const last = s.guidance[s.guidance.length - 1];
        return last && !last.retired ? { guidance: s.guidance.map((c) => (c.batch === last.batch ? Object.assign({}, c, { retired: true }) : c)) } : {};
      });
    }
    const cards = (res.guidance || []).filter((c) => c && c.text && c.kind).slice(0, 1)
      .filter((c) => !repeatsRecent(c));
    pushCards(cards);
  }

  /* One queue per prompt: a request made while one is in flight reruns it once with the latest state. */
  let busyQueues = 0;
  function makeQueue(call, apply) {
    let inFlight = null;
    let pending = false;
    return () => {
      if (inFlight) { pending = true; return inFlight; }
      inFlight = (async () => {
        busyQueues++;
        Store.set({ aiBusy: true, aiError: '' });
        do {
          pending = false;
          try {
            const s = Store.get();
            apply(await call(s, userById(s.userId)));
          } catch (e) {
            Store.set({ aiError: e.message || String(e) });
          }
        } while (pending);
        busyQueues--;
        if (!busyQueues) Store.set({ aiBusy: false });
        inFlight = null;
      })();
      return inFlight;
    };
  }
  const workflowQueue = makeQueue((s, u) => AI.workflow(s, u), applyWorkflow);
  const guidanceQueue = makeQueue((s, u) => AI.guidance(s, u), applyGuidance);

  /* The workflow and guidance prompts run at the same time; each updates its own panel when it answers. */
  function scheduleAnalysis() {
    if (!AI.available()) return Promise.resolve();
    return Promise.all([workflowQueue(), guidanceQueue()]);
  }

  /* After a line or a tool result: the workflow panel and Cautions update. Nothing runs on its own. */
  let settling = null;
  let settleAgain = false;
  function settle() {
    if (!AI.available()) return Promise.resolve();
    if (settling) { settleAgain = true; return settling; }
    settling = (async () => {
      do { settleAgain = false; await scheduleAnalysis(); } while (settleAgain);
      settling = null;
    })();
    return settling;
  }

  /* The agent starts a workflow step: it turns green and the first tool the step names in
     system_prompt.md ("Tool: `id`") opens in the feed for the agent to fill in and execute or skip.
     Nothing runs until the agent executes; a flashcard may follow the result. */
  function runStep(groupId, stepId) {
    const s = Store.get();
    if (s.callStatus !== 'active') { notify('Start the call first.'); return; }
    const g = s.groups.find((x) => x.id === groupId);
    const idx = g ? g.steps.findIndex((st) => st.id === stepId) : -1;
    if (idx < 0) return;
    const ref = { groupId, stepId, workflow: g.title, label: g.steps[idx].label };
    const tool = AI.stepTools(g.title, idx).map(toolById).find(Boolean);
    updateWorkflowStep(groupId, stepId, { status: 'done', changed: Date.now() });
    Store.set({ activeStep: ref });
    if (tool) {
      Store.set({ suggestedTool: tool.id, tab: 'guidance' });
      openDraft(tool.id, 'step', null, ref);
    } else {
      noteToolDone();   // a step without a tool has nothing to wait for
    }
  }

  /* Simulated call: after a line where the agent said it is checking something, the call waits
     until the human executes or skips a tool (or chooses to continue). */
  let stepWait = null;
  function waitForStep() {
    finishStepWait();
    Store.set({ waitingStep: true });
    return new Promise((resolve) => { stepWait = resolve; });
  }
  function noteToolDone() { finishStepWait(); }
  function finishStepWait() {
    if (!stepWait) return;
    const resolve = stepWait;
    stepWait = null;
    Store.set({ waitingStep: false });
    resolve();
  }

  /* ------------------------------------------------------------------ */
  /* Call control                                                         */
  /* ------------------------------------------------------------------ */
  let currentPlay = null;
  let lastScenarioId = null;

  function startCall(opts) {
    opts = opts || {};
    const autoFirst = opts.autoFirst !== false;
    stopVoice();
    TTS.cancel();
    releaseWaits();
    const s = Store.get();
    if (!AI.available()) { notify('This call needs an AI model: the caller is played by it.'); return false; }
    if (!AI.scenarios.length) { notify('No scenarios found in scenarios/.'); return false; }
    const pick = opts.scenarioId || (s.scenarioPick !== 'random' ? s.scenarioPick : null);
    const sc = (pick && scenarioById(pick)) || pickRandom(AI.scenarios, lastScenarioId);
    lastScenarioId = sc.id;
    Store.set(Object.assign(freshCall(), { userId: userById(sc.customer).id, scenarioId: sc.id, callStatus: 'active', callStart: Date.now(), tab: 'customer', aiStatus: AI.status() }));
    if (s.mode === 'simulated') {
      if (autoFirst) setTimeout(() => { if (Store.get().callStatus === 'active' && Store.get().turnCount === 0) playNext(); }, 0);
    } else if (recognizer.supported) {
      toggleMic();   // the agent greets the caller first
    } else {
      notify('Voice input needs Chrome or Edge. Type your lines in the box instead.');
    }
  }

  function endCall() {
    stopVoice();
    TTS.cancel();
    Store.set({ callStatus: 'ended', autoplay: false, listening: null, interim: '', speaking: null });
    releaseWaits();
  }

  function resetAll() {
    stopVoice();
    TTS.cancel();
    releaseWaits();
    Store.set(Object.assign(freshCall(), { tab: 'guidance', notice: '' }));
  }

  function willSpeak() { return !!(Store.get().settings.audio && TTS.supported); }
  async function speakLine(speaker, line) {
    if (!willSpeak()) { lineHeard(line.id); return false; }
    Store.set({ speaking: speaker });
    try { return await TTS.speak(line.text, speaker); }
    finally {
      if (Store.get().speaking === speaker) Store.set({ speaking: null });
      lineHeard(line.id);
    }
  }

  /* The caller's next line is drafted in the background while the screen updates after the agent spoke. */
  let callerDraft = null;   // { callStart, turn, promise }

  /* One simulated turn, strictly in order with no added waits: the line is generated and spoken,
     a human-only tool the agent asked for waits for the human to run or skip it, then the screen
     updates before the other side speaks. After a mid-action agent line, new results or a new card
     keep the floor with the agent once; after a hand-over line only a Caution does. */
  async function simTurn() {
    const s = Store.get();
    const sc = currentScenario();
    if (s.callStatus !== 'active' || !sc) return { played: false };
    const callStart = s.callStart;
    const live = () => Store.get().callStatus === 'active' && Store.get().callStart === callStart;
    const speaker = s.nextSpeaker;
    let res;
    try {
      if (speaker === 'agent') {
        res = await AI.agentTurn(s, userById(s.userId), sc);
      } else {
        const draft = callerDraft && callerDraft.callStart === callStart && callerDraft.turn === s.turnCount ? callerDraft.promise : null;
        callerDraft = null;
        res = (draft && await draft) || await AI.callerTurn(s, sc);
      }
    } catch (e) {
      Store.set({ aiError: e.message || String(e), autoplay: false });
      return { played: false, error: true };
    }
    if (!live()) return { played: false };
    const say = String((res && res.say) || '').trim();
    const line = say ? addLine(speaker, say, true) : null;
    if (line && speaker === 'agent') line.handOver = !!res.hand_over;
    const callerDone = s.callerDone || (speaker === 'caller' && !!res.end_call);
    /* The call ends on the agent's closing line after the caller has said goodbye. */
    const ending = (speaker === 'agent' && s.callerDone) || s.turnCount + 1 >= MAX_SIM_TURNS;
    const followUp = speaker === 'agent' && s.agentFollowUp;
    Store.set({ turnCount: s.turnCount + 1, nextSpeaker: speaker === 'agent' ? 'caller' : 'agent', callerDone, agentFollowUp: false });
    if (line) await speakLine(speaker, line);
    if (!live()) return { played: true };
    const asked = speaker === 'agent' && res.tool ? toolById(String(res.tool).trim()) : null;
    /* The human may already have run it from the copilot's suggestion while the agent was speaking;
       one still running is waited on by requestAgentTool. */
    const alreadyRan = asked && Store.get().toolRuns.slice(s.toolRuns.length).some((t) => t.tool === asked.id);
    if (asked && !asked.autoApproved && !alreadyRan) {
      const ran = await requestAgentTool(asked, res.inputs);
      if (!live()) return { played: true };
      if (!ran) addLine('tool', `${asked.label} → not run (skipped by the human agent)`);
    }
    if (!live()) return { played: true };
    if (ending) { Store.set({ callStatus: 'ended', autoplay: false }); return { played: true, ended: true }; }
    if (!say && !(speaker === 'agent' && res.tool)) return { played: true };
    if (speaker === 'agent' && say) {
      const after = Store.get();
      callerDraft = { callStart, turn: after.turnCount, promise: AI.callerTurn(after, sc).catch(() => null) };
    }
    const handOver = speaker === 'agent' && !!say && !!res.hand_over;
    await settle();
    if (!live()) return { played: true };
    if (speaker === 'agent' && say && !followUp) {
      /* Anything new since this turn began: a tool result or a flashcard. */
      const fresh = () => Store.get().batch !== s.batch || Store.get().toolRuns.length > s.toolRuns.length;
      const ran = Store.get().toolRuns.length > s.toolRuns.length;
      if (!handOver && !ran) {
        await waitForStep();
        if (!live()) return { played: true };
        await settle();   // the flashcard (if any) for the tool the human just ran
        if (!live()) return { played: true };
      }
      const after = Store.get();
      const card = after.guidance[after.guidance.length - 1];
      const newCaution = after.batch !== s.batch && card && /^(caution|exception)$/i.test(String(card.kind).trim());
      if (handOver ? newCaution : fresh()) {
        callerDraft = null;
        Store.set({ nextSpeaker: 'agent', agentFollowUp: true });
      }
    }
    return { played: true };
  }

  async function playNext() {
    if (Store.get().callStatus !== 'active') return false;
    if (currentPlay) return currentPlay;
    const p = simTurn();
    currentPlay = p;
    try { return await p; } finally { if (currentPlay === p) currentPlay = null; }
  }

  async function autoplayLoop() {
    if (currentPlay) await currentPlay;
    while (Store.get().autoplay && Store.get().callStatus === 'active') {
      const res = await playNext();
      if (!res || !res.played) break;
    }
    Store.set({ autoplay: false });
  }

  function toggleAutoplay() {
    const s = Store.get();
    if (s.autoplay) { Store.set({ autoplay: false }); return; }
    if (s.callStatus !== 'active' && startCall({ autoFirst: false }) === false) return;
    Store.set({ autoplay: true });
    autoplayLoop();
  }

  function setMode(mode) {
    stopVoice();
    TTS.cancel();
    const s = Store.get();
    if (s.mode === mode) return;
    releaseWaits();
    Store.set(Object.assign(freshCall(), { mode }));
  }

  /* ------------------------------------------------------------------ */
  /* Voice input                                                          */
  /* ------------------------------------------------------------------ */
  /* Live call: the human is the support agent on the mic and the caller AI answers each turn.
     The agent's turn ends after TURN_END_MS of silence (or "Done speaking"); the mic pauses while
     the caller's voice plays so it does not transcribe the caller. */
  const TURN_END_MS = 1500;
  let agentBuffer = [];      // finished pieces of the line the agent is speaking
  let pendingInterim = '';   // words heard but not final yet
  let turnTimer = null;
  let callerReply = null;    // token of the caller reply being written; cleared to drop it
  let micPaused = false;     // stopped only while the caller speaks

  const recognizer = Voice.createRecognizer({
    onInterim: (t) => {
      if (micPaused) return;
      pendingInterim = t;
      if (t) agentSpeaking();
      Store.set({ interim: agentBuffer.concat(t ? [t] : []).join(' ') });
    },
    onFinal: (t) => {
      if (micPaused) return;
      agentBuffer.push(t);
      pendingInterim = '';
      agentSpeaking();
      Store.set({ interim: agentBuffer.join(' ') });
    },
    onState: (st) => { if (st === 'stopped' && !micPaused) Store.set({ listening: null }); },
    onError: (msg) => { micPaused = false; Store.set({ listening: null, interim: '', voiceError: msg }); notify(msg); }
  });

  /* The agent is talking: drop a caller reply still being written and restart the turn-end timer. */
  function agentSpeaking() {
    if (callerReply) { callerReply = null; Store.set({ callerThinking: false }); }
    clearTimeout(turnTimer);
    turnTimer = setTimeout(() => { if (pendingInterim) agentSpeaking(); else commitAgentTurn(); }, TURN_END_MS);
  }

  function commitAgentTurn() {
    clearTimeout(turnTimer);
    const text = agentBuffer.concat(pendingInterim ? [pendingInterim] : []).join(' ').trim();
    agentBuffer = [];
    pendingInterim = '';
    Store.set({ interim: '' });
    if (text) agentSays(text);
  }

  function stopVoice() {
    clearTimeout(turnTimer);
    agentBuffer = [];
    pendingInterim = '';
    callerReply = null;
    micPaused = false;
    if (recognizer.listening) recognizer.stop();
    Store.set({ listening: null, interim: '', callerThinking: false });
  }

  function pauseMic() {
    if (!recognizer.listening) return;
    micPaused = true;
    recognizer.stop();
  }
  function resumeMic() {
    if (!micPaused) return;
    micPaused = false;
    const s = Store.get();
    if (s.callStatus === 'active' && s.listening === 'agent') recognizer.start();
  }

  /* A line from the human agent (spoken or typed): the copilot updates and the caller AI replies.
     After the caller's goodbye, the agent's line closes the call. */
  function agentSays(text) {
    const s = Store.get();
    if (s.callStatus !== 'active') return;
    addLine('agent', text);
    settle();
    if (s.callerDone) { endCall(); return; }
    callerReplies();
  }

  async function callerReplies() {
    const s = Store.get();
    const sc = currentScenario();
    if (!sc || !AI.available()) return;
    const token = {};
    callerReply = token;
    Store.set({ callerThinking: true });
    let res;
    try { res = await AI.callerTurn(s, sc); }
    catch (e) {
      if (callerReply === token) { callerReply = null; Store.set({ callerThinking: false, aiError: e.message || String(e) }); }
      return;
    }
    if (callerReply !== token) return;
    callerReply = null;
    Store.set({ callerThinking: false });
    const now = Store.get();
    if (now.callStatus !== 'active' || now.callStart !== s.callStart) return;
    const say = String((res && res.say) || '').trim();
    if (!say) return;
    const line = addLine('caller', say, true);
    if (res.end_call) Store.set({ callerDone: true });
    pauseMic();
    try { await speakLine('caller', line); } finally { resumeMic(); }
    if (Store.get().callStatus === 'active' && Store.get().callStart === s.callStart) settle();
  }

  /* Live call: mute or unmute the agent's mic; muting sends what was already said. */
  function toggleMic() {
    const s = Store.get();
    if (s.callStatus !== 'active') { notify('Start the call first.'); return; }
    if (!recognizer.supported) { notify('Voice input needs Chrome or Edge. Type a line instead.'); return; }
    if (s.listening === 'agent') {
      commitAgentTurn();
      micPaused = false;
      if (recognizer.listening) recognizer.stop();
      Store.set({ listening: null, interim: '' });
      return;
    }
    Store.set({ listening: 'agent', voiceError: '' });
    if (s.speaking === 'caller') micPaused = true;   // starts when the caller finishes
    else if (!recognizer.listening) recognizer.start();
  }

  function speakAs(speaker) {
    const s = Store.get();
    if (s.callStatus !== 'active') { notify('Start the call first.'); return; }
    if (s.autoplay) return;
    if (s.nextSpeaker !== speaker) { notify(`The next turn belongs to the ${s.nextSpeaker === 'caller' ? 'caller' : 'support agent'}.`); return; }
    playNext();
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
  /* Display names for kinds that are not already in their display form; any other kind shows as written. */
  const KIND_LABEL = { answer: 'Answer' };

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
    const simulated = s.mode === 'simulated';
    const active = s.callStatus === 'active';
    const sc = scenarioById(s.scenarioId);
    const user = userById(s.userId);
    const speakClass = (who) => 'rail-btn' + (active && !s.autoplay && s.nextSpeaker === who ? ' next' : '');
    const micOn = !simulated && s.listening === 'agent';
    const waitingTool = s.agentRequest && toolById(s.agentRequest.tool);
    const waitingOn = waitingTool ? waitingTool.label : '';
    const send = () => { const t = draft.trim(); if (!t) return; if (!active) { notify('Start the call first.'); return; } agentSays(t); setDraft(''); };
    const audioBtn = html`<button class=${'rail-small ' + (s.settings.audio ? '' : 'off')} title=${TTS.supported ? 'Read the lines aloud' : 'Speech synthesis is not available in this browser'} onClick=${() => updateSettings({ audio: !s.settings.audio })}>${s.settings.audio ? '🔊 Audio on' : '🔇 Audio off'}</button>`;
    const callNote = sc && s.callStatus !== 'idle' ? html`<b>${user.phone}</b> · ${sc.title}` : '';
    return html`
      <aside class="rail">
        <div class="rail-top">
          <${StatusPill} s=${s} />
          <button class="icon-btn" title="Settings" aria-label="Settings" onClick=${() => Store.set({ settingsOpen: true })}>⚙</button>
        </div>
        <div class="seg">
          <button class=${simulated ? 'on' : ''} onClick=${() => setMode('simulated')}>Simulated</button>
          <button class=${!simulated ? 'on' : ''} onClick=${() => setMode('live')}>Live voice</button>
        </div>
        <button class=${'rail-btn ' + (s.callStatus === 'idle' ? 'primary' : '')} onClick=${() => startCall()}>${s.callStatus === 'idle' ? 'Start call' : 'New call'}</button>
        ${simulated ? html`
          <button class=${speakClass('caller')} disabled=${!active || s.autoplay} onClick=${() => speakAs('caller')}>Speak as Caller</button>
          <button class=${speakClass('agent')} disabled=${!active || s.autoplay} onClick=${() => speakAs('agent')}>Speak as Support Agent</button>
          <div class="rail-row">
            <button class="rail-small" onClick=${toggleAutoplay}>${s.autoplay ? '❚❚ Pause' : '▶ Play all'}</button>
            <button class="rail-small" disabled=${!active || s.autoplay} onClick=${() => playNext()}>Next ▸</button>
          </div>
          <div class="rail-row">
            ${audioBtn}
            <span class="rail-note center">${sc && s.callStatus !== 'idle' ? `Turn ${s.turnCount}` : ''}</span>
          </div>
          <div class="rail-note">${callNote || 'An AI plays the caller and another plays the agent. Pick a scenario below, or leave it random.'}</div>
          ${s.settings.audio && !TTS.supported ? html`<div class="rail-warn">No speech synthesis here; lines play silently.</div>` : ''}
          ${waitingOn ? html`<div class="rail-warn">Waiting for you to run ${waitingOn}.</div>` : ''}
          ${!waitingOn && s.waitingStep ? html`<div class="rail-warn">The agent is checking: start the workflow step it needs. <button class="rail-link" onClick=${finishStepWait}>Continue without</button></div>` : ''}
        ` : html`
          <button class=${'rail-btn' + (micOn ? ' listening' : '')} disabled=${!active || !recognizer.supported} onClick=${toggleMic}>
            ${micOn ? html`<i class="dot"></i>Mic on · click to mute` : 'Mic muted · click to talk'}
          </button>
          <div class="rail-row">
            <button class="rail-small" disabled=${!active || !s.interim} onClick=${commitAgentTurn}>Done speaking</button>
            ${audioBtn}
          </div>
          <div class="rail-note">
            ${!active ? 'An AI plays the caller; you are the support agent on the mic. Pick a scenario below, or leave it random.'
              : s.speaking === 'caller' ? 'The caller is speaking; your mic resumes when they finish.'
              : s.callerThinking ? 'The caller is replying…'
              : micOn ? html`<span class="rec">● Listening.</span> Speak to the caller; a short pause ends your turn.`
              : recognizer.supported ? 'Your mic is muted.' : 'Voice input needs Chrome or Edge. Type your lines below.'}
          </div>
          ${callNote ? html`<div class="rail-note">${callNote}</div>` : ''}
          ${s.settings.audio && !TTS.supported ? html`<div class="rail-warn">No speech synthesis here; the caller's lines play silently.</div>` : ''}
          <textarea id="live-draft" class="rail-text" rows="2" placeholder="Or type what you say to the caller…" value=${draft} onInput=${(e) => setDraft(e.target.value)}
            onKeyDown=${(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}></textarea>
          <div class="rail-row">
            <button class="rail-small" disabled=${!active} onClick=${send}>Send</button>
          </div>
        `}

        <label class="rail-select" title="Which scenario the AI caller plays">
          <span>Scenario</span>
          <select value=${s.scenarioPick} disabled=${active} onChange=${(e) => Store.set({ scenarioPick: e.target.value })}>
            <option value="random">Random</option>
            ${AI.scenarios.map((x, i) => html`<option key=${x.id} value=${x.id}>${i + 1}. ${x.title}</option>`)}
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
    return html`<span class="ico pend" aria-label="pending"></span>`;
  }

  function StepButton({ g, st, active }) {
    if (st.running) return html`<span class="wf-run busy" title="Working on this step…"><i class="spin"></i></span>`;
    const again = st.status === 'done';
    return html`<button class=${'wf-run' + (again ? ' again' : '')} disabled=${!active} title=${again ? 'Run this step again' : 'Start this step'} aria-label=${again ? 'Run this step again' : 'Start this step'}
      onClick=${() => runStep(g.id, st.id)}>${again ? '↻' : '▶'}</button>`;
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
                <div key=${st.id + ':' + (st.changed || 0)} class=${'wf-step ' + st.status + (st.changed ? ' pop' : '') + (st.running ? ' running' : '')}>
                  <${StepButton} g=${g} st=${st} active=${s.callStatus === 'active'} />
                  <${StepIcon} status=${st.status} />
                  <span class="wf-label">${st.label}</span>
                </div>`)}
            </div>`)}
        </div>
      </div>`;
  }

  function Tabs({ s }) {
    const tab = (id, label, badge) => html`<button class=${'tab ' + (s.tab === id ? 'on' : '')} onClick=${() => Store.set({ tab: id, unseenGuidance: id === 'guidance' ? 0 : s.unseenGuidance })}>${label}${badge ? html`<span class="tab-badge">${badge}</span>` : ''}</button>`;
    return html`<div class="tabs">${tab('guidance', 'Live Guidance', s.tab !== 'guidance' && s.unseenGuidance ? s.unseenGuidance : 0)}${tab('customer', 'Customer 360')}${tab('transcript', 'Transcript')}
      ${s.tab === 'guidance' && s.guidance.length ? html`<button class="link tabs-action" onClick=${() => Store.set({ guidance: [] })}>Clear guidance</button>` : ''}</div>`;
  }

  function GuidanceCard({ c }) {
    const kind = String(c.kind).trim();
    const cls = kind.toLowerCase().replace(/[^a-z]+/g, '-');
    return html`
      <div class=${'gcard kind-' + cls}>
        <div class="gline">
          <span class=${'kw kw-' + cls}>${KIND_LABEL[cls] || kind}:</span>
          <span class="gtext">${c.text}</span>
        </div>
        ${c.bullets && c.bullets.length ? html`<ul class="gbullets">${c.bullets.map((b, i) => html`<li key=${i}>${b}</li>`)}</ul>` : ''}
      </div>`;
  }

  function GuidanceTab({ s }) {
    const boxRef = useRef(null);
    const lastRef = useRef(null);
    const spacerRef = useRef(null);
    const byBatch = new Map();
    s.guidance.forEach((c) => { if (!byBatch.has(c.batch)) byBatch.set(c.batch, { batch: c.batch, cards: [] }); byBatch.get(c.batch).cards.push(c); });
    const batches = [...byBatch.values()].sort((a, b) => a.batch - b.batch);
    const latest = batches.length ? batches[batches.length - 1].batch : 0;
    const cleared = batches.length > 0 && batches[batches.length - 1].cards.every((c) => c.retired);
    const sum = s.callStatus !== 'idle' ? s.stepSummary : null;
    /* Keep only the newest guidance in view: older batches sit above, reachable by scrolling up.
       Once the newest no longer applies, it scrolls up too and the box is left empty. */
    useEffect(() => {
      const box = boxRef.current; const last = lastRef.current; const spacer = spacerRef.current;
      if (!box) return;
      if (!last) { if (spacer) spacer.style.height = '0px'; return; }
      const pad = parseFloat(getComputedStyle(box).paddingTop) || 0;
      const lead = 4;                                   /* the newest card sits 4px below the top edge; the previous one is scrolled out */
      const room = cleared ? box.clientHeight : box.clientHeight - lead - pad - last.offsetHeight;
      if (spacer) spacer.style.height = `${Math.max(0, room)}px`;
      const top = cleared ? last.offsetTop + last.offsetHeight : last.offsetTop - lead;
      try { box.scrollTo({ top, behavior: batches.length > 1 || cleared ? 'smooth' : 'auto' }); } catch (e) { box.scrollTop = top; }
    }, [latest, cleared, s.guidance.length, s.aiBusy, s.aiError, sum]);
    return html`
      <div class="guidance">
        <div class="tags">
          <span class="tags-label">Tags:</span>
          ${s.tags.length ? s.tags.map((t) => html`<span key=${t} class="tag">${t}</span>`) : html`<span class="tags-empty">none yet</span>`}
        </div>
        <div class="gpanel">
        ${sum && sum.bullets.length ? html`
          <div class="gsum" key=${sum.t + ':' + sum.title}>
            <div class="gsum-title">Results · ${sum.title}</div>
            <ul class="gsum-list">${sum.bullets.map((b, i) => html`<li key=${i}>${b}</li>`)}</ul>
          </div>` : ''}
        <div class="gbox" ref=${boxRef}>
          ${batches.length
            ? batches.map((b, i) => html`
              <div key=${b.batch} class=${'gbatch ' + (b.batch === latest && !cleared ? 'latest' : 'earlier')} ref=${i === batches.length - 1 ? lastRef : null}>
                ${b.cards.map((c) => html`<${GuidanceCard} key=${c.id} c=${c} />`)}
              </div>`)
            : html`<div class="gempty">${s.callStatus === 'idle' ? 'Start a call. Only things worth your attention show up here: policy risks, facts the caller needs, offers worth making.' : 'Nothing needs your attention yet.'}</div>`}
          ${s.aiBusy ? html`<div class="gbusy">GPT-5.6 Luna is updating the screen…</div>` : ''}
          ${s.aiError ? html`<div class="gerror">${s.aiError}</div>` : ''}
          <div class="gspacer" ref=${spacerRef}></div>
        </div>
        </div>
        <${ActionFeed} s=${s} />
      </div>`;
  }

  const fmtMs = (ms) => (ms == null ? '' : `${(ms / 1000).toFixed(1)}s`);

  function InputTable({ tool, inputs, editable, missing, onChange }) {
    return html`
      <table class="io-table">
        ${tool.inputs.map((f) => html`
          <tr key=${f.key} class=${(missing || []).includes(f.key) ? 'missing' : ''}>
            <th>${f.label}${f.optional ? html`<span class="io-opt"> (optional)</span>` : ''}</th>
            <td>${editable
              ? html`<input type="text" value=${inputs[f.key] || ''} placeholder=${f.optional ? '' : 'Required'} onInput=${(e) => onChange(Object.assign({}, inputs, { [f.key]: e.target.value }))} />`
              : html`<span class="io-val">${inputs[f.key] || '—'}</span>`}</td>
          </tr>`)}
      </table>`;
  }

  function OutputRows({ output }) {
    return html`${Object.entries(output).map(([k, v]) => html`
      <div key=${k} class=${'io-row ' + (k === 'demo_mode' ? 'demo' : '')}><span class="io-k">${k}</span><span class="io-v">${fmtVal(v)}</span></div>`)}`;
  }

  const emptyRequired = (tool, inputs) => tool.inputs.filter((f) => !f.optional && !String(inputs[f.key] || '').trim()).map((f) => f.key);

  /* A tool waiting for the agent: its inputs in a plain table, a button named after the tool, and Skip. */
  function Approval({ tool, inputs, running, disabled, skipLabel, onChange, onRun, onSkip }) {
    const empty = emptyRequired(tool, inputs);
    return html`
      <div class="approve">
        <table class="io-table approve-table">
          ${tool.inputs.map((f) => html`
            <tr key=${f.key} class=${empty.includes(f.key) ? 'missing' : ''}>
              <th>${f.label}${f.optional ? html`<span class="io-opt"> (optional)</span>` : ''}</th>
              <td><input type="text" value=${inputs[f.key] || ''} placeholder=${f.optional ? '' : 'Required'} disabled=${running} onInput=${(e) => onChange(Object.assign({}, inputs, { [f.key]: e.target.value }))} /></td>
            </tr>`)}
        </table>
        <div class="approve-actions">
          ${running
            ? html`<span class="approve-running">${tool.message || tool.label}<span class="dots"><i></i><i></i><i></i></span></span>`
            : html`
              <button class="btn-dark" disabled=${disabled} onClick=${onRun}>${tool.label}</button>
              <button class="btn-plain" onClick=${onSkip}>${skipLabel || 'Skip'}</button>`}
        </div>
      </div>`;
  }

  function ManualRow({ r, s }) {
    const tool = toolById(r.tool);
    if (!tool) return '';
    if (r.status === 'done') {
      return html`<div class="frow task single"><ul class="tsteps"><${DoneTool} st=${r} /></ul></div>`;
    }
    return html`
      <div class="frow task single">
        <div class="fcell">
          <div class="io-label">${tool.message || tool.label}</div>
          <${Approval} tool=${tool} inputs=${r.inputs} running=${r.status === 'running'} disabled=${s.callStatus === 'idle'}
            onChange=${(inputs) => updateRow(r.id, { inputs, touched: true })}
            onRun=${async () => { const awaited = !!(toolWait && toolWait.tool === r.tool); await runManualRow(r.id); if (!awaited) settle(); }}
            onSkip=${() => removeRow(r)} />
        </div>
      </div>`;
  }

  /* An executed tool: one line, with its inputs and output behind "Show details". */
  function DoneTool({ st }) {
    const [open, setOpen] = useState(false);
    const tool = toolById(st.tool);
    if (!tool) return '';
    return html`
      <li class=${'tstep ' + st.status}>
        <span class="tdot"></span>
        <div class="tbody">
          <div class="tsline">
            <span>You ran ${tool.label}${st.step ? html` <span class="tstep-of">· ${st.step.label}</span>` : ''}</span>
            ${st.status === 'done' ? html`<button class="link tshow" onClick=${() => setOpen(!open)}>${open ? 'Hide details ▴' : 'Show details ▾'}</button>` : ''}
            ${st.ms != null ? html`<span class="dur">◷ ${fmtMs(st.ms)}</span>` : ''}
          </div>
          ${open && st.status === 'done' ? html`
            <div class="tdetail">
              <div><div class="io-label">Input:</div><div class="io-box"><${InputTable} tool=${tool} inputs=${st.inputs} editable=${false} /></div></div>
              <div><div class="io-label">Output:</div><div class="io-out">${st.output ? html`<${OutputRows} output=${st.output} />` : ''}</div></div>
            </div>` : ''}
        </div>
      </li>`;
  }

  function ActionFeed({ s }) {
    const boxRef = useRef(null);
    useAutoScroll(boxRef, `${s.feed.length}`);
    if (!s.feed.length) {
      return html`<div class="toolio-hint">Tools appear here when you start a workflow step with ▶. Fill in or check the inputs as the call goes on (what the call or the customer record already says is filled in for you), then run the tool or skip it. Nothing runs until you do.</div>`;
    }
    return html`
      <div class="feed" ref=${boxRef}>
        ${s.feed.map((r) => html`<${ManualRow} key=${r.id} r=${r} s=${s} />`)}
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
            <p class="modal-help">${AI.server ? 'This server has no OpenAI key yet. Add OPENAI_API_KEY and ELEVENLABS_API_KEY to .env and restart. Simulated calls need it.' : 'No local server is running, so no AI is available for simulated calls. From the project folder, run npm start and open http://localhost:8080.'}</p>
          `}
          <label class="field check"><input type="checkbox" checked=${form.audio} onChange=${f('audio')} /><span>Read the simulated call aloud</span></label>
          <p class="modal-help">The panels update automatically after every line. Behavior comes from prompts/system_prompt.md, prompts/phone_assist_workflow.md, prompts/phone_assist_guidance.md, prompts/phone_assist_best_reply.md, prompts/chat.md, tools.md and kb/. Refresh the page after editing them.</p>
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
    Store.set(idle ? { aiStatus: st, feed: [] } : { aiStatus: st });
  });
  AI.init(Store.get().settings);
  render(html`<${App} />`, document.getElementById('app'));

  global.PhoneAssist = { Store, startCall, playNext, toggleAutoplay, openDraft, runManualRow, runStep, settle, getBestReply, askQuestion, setMode, speakAs, toggleMic, agentSays, resetAll, endCall };
})(window);
