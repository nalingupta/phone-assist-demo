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
  const DEFAULT_SETTINGS = { apiKey: '', model: 'gpt-5.6-luna', effort: 'low', baseUrl: '', tier: 'quick' };
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
      feed: [], lastOpenedAt: 0, bestAnswer: null, askThread: [], toolRuns: [], suggestedTool: null, agentRequest: null, waitingStep: false,
      scenarioId: null, turnCount: 0, nextSpeaker: 'agent', callerDone: false, agentFollowUp: false, autoplay: false, listening: null, speaking: null, callerThinking: false, aiBusy: false, aiError: '', bestBusy: false, askBusy: false
    };
  }

  const Store = (() => {
    let state = Object.assign(freshCall(), {
      userId: pickRandom(D.USERS).id, scenarioPick: 'random', mode: 'live', incoming: null, tab: 'guidance', settings: loadSettings(), settingsOpen: false,
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
    /* A caller line, once heard, moves the question on: the Best Answer card no longer applies. */
    const clears = speaker === 'caller' && !line.speaking;
    Store.set((s) => Object.assign({ transcript: s.transcript.concat([line]) }, clears ? { bestAnswer: null } : {}));
    return line;
  }
  function lineHeard(id) {
    Store.set((s) => {
      const line = s.transcript.find((l) => l.id === id && l.speaking);
      if (!line) return {};
      return Object.assign({ transcript: s.transcript.map((l) => (l === line ? Object.assign({}, l, { speaking: false }) : l)) }, line.speaker === 'caller' ? { bestAnswer: null } : {});
    });
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
  async function simulate(tool, inputs) {
    const s = Store.get();
    const started = Date.now();
    const res = await AI.simulateTool(tool, inputs, s, userById(s.userId));
    if (res.fallback) notify(`Could not simulate ${tool.label}; showing its example output.${res.error ? ' ' + res.error : ''}`);
    const output = res.output || {};
    const brief = output.headline || Object.entries(output).slice(0, 2).map(([k, v]) => `${k}: ${fmtVal(v)}`).join(' · ');
    addLine('tool', `${tool.label} → ${brief}`);
    Store.set((st) => ({ toolRuns: st.toolRuns.concat([{ id: nextId(), tool: tool.id, inputs, output, t: elapsed() }]) }));
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
        return { feed: s.feed.map((r) => (r.id === draft.id ? Object.assign({}, r, { inputs, auto: auto === 'agent' ? 'agent' : r.auto, step: step || r.step, openedAt: Date.now() }) : r)), lastOpenedAt: Date.now() };
      }
      return { feed: s.feed.concat([{ id: nextId(), type: 'manual', tool: id, by: 'agent', auto, step: step || null, touched: false, status: 'draft', inputs: filled, openedAt: Date.now() }]), lastOpenedAt: Date.now() };
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
    Store.set({ agentRequest: { tool: tool.id, inputs: values } });
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
    const { output, ms } = await simulate(tool, row.inputs);
    updateRow(rowId, { status: 'done', output, ms, ranAt: Date.now() });
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
    if (tool) {
      Store.set({ suggestedTool: tool.id });
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
    stopVoice();
    TTS.cancel();
    releaseWaits();
    const s = Store.get();
    if (!AI.available()) { notify('This call needs an AI model: the caller is played by it.'); return false; }
    if (!AI.scenarios.length) { notify('No scenarios found in scenarios/.'); return false; }
    const pick = opts.scenarioId || (s.scenarioPick !== 'random' ? s.scenarioPick : null);
    const sc = (pick && scenarioById(pick)) || pickRandom(AI.scenarios, lastScenarioId);
    lastScenarioId = sc.id;
    Store.set(Object.assign(freshCall(), { userId: userById(sc.customer).id, scenarioId: sc.id, callStatus: 'active', callStart: Date.now(), incoming: null, aiStatus: AI.status() }));
    if (s.mode === 'simulated') {
      Store.set({ autoplay: true });
      setTimeout(() => { if (Store.get().callStatus === 'active') autoplayLoop(); }, 0);
    } else if (recognizer.supported) {
      toggleMic();   // the agent greets the caller first
    } else {
      notify('Live call needs Chrome or Edge for speech recognition.');
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
    Store.set(Object.assign(freshCall(), { tab: 'guidance', notice: '', mode: 'live', incoming: null }));
  }

  function willSpeak() { return !!TTS.supported; }
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
        res = (draft && await draft) || await AI.callerTurn(s, sc, userById(s.userId));
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
      callerDraft = { callStart, turn: after.turnCount, promise: AI.callerTurn(after, sc, userById(after.userId)).catch(() => null) };
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

  /* One loop at a time: a Resume while the paused loop is still finishing its turn lets that loop go on. */
  let looping = false;
  async function autoplayLoop() {
    if (looping) return;
    looping = true;
    try {
      if (currentPlay) await currentPlay;
      while (Store.get().autoplay && Store.get().callStatus === 'active') {
        const res = await playNext();
        if (!res || !res.played) break;
      }
    } finally {
      looping = false;
      Store.set({ autoplay: false });
    }
  }

  /* Simulated call: Pause lets the line being spoken finish; Resume carries on from there. */
  function toggleAutoplay() {
    const s = Store.get();
    if (s.callStatus !== 'active') return;
    if (s.autoplay) { Store.set({ autoplay: false }); return; }
    Store.set({ autoplay: true });
    autoplayLoop();
  }

  /* Picking a mode only selects it; Start call rings, and accepting the incoming call starts it. */
  function setMode(mode) {
    const s = Store.get();
    if (s.callStatus === 'active' || s.incoming) return;
    Store.set({ mode });
  }

  function ringCall() {
    const s = Store.get();
    if (s.callStatus === 'active' || s.incoming) return;
    if (!AI.available()) { notify('This call needs an AI model: the caller is played by it.'); return; }
    if (!AI.scenarios.length) { notify('No scenarios found in scenarios/.'); return; }
    const sc = (s.scenarioPick !== 'random' && scenarioById(s.scenarioPick)) || pickRandom(AI.scenarios, lastScenarioId);
    lastScenarioId = sc.id;
    Store.set({ incoming: { scenarioId: sc.id, userId: userById(sc.customer).id } });
  }
  function acceptCall() {
    const inc = Store.get().incoming;
    if (inc) startCall({ scenarioId: inc.scenarioId });
  }
  function declineCall() { Store.set({ incoming: null }); }

  /* ------------------------------------------------------------------ */
  /* Voice input                                                          */
  /* ------------------------------------------------------------------ */
  /* Live call: the human is the support agent on the mic and the caller AI answers each turn.
     The agent's turn ends after TURN_END_MS of silence (or on Pause); the mic pauses while
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
    try { res = await AI.callerTurn(s, sc, userById(s.userId)); }
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
    if (s.callStatus !== 'active') return;
    if (!recognizer.supported) { notify('Live call needs Chrome or Edge for speech recognition.'); return; }
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
      if (Store.get().callStart !== s.callStart) return;
      const steps = (Array.isArray(res.steps) ? res.steps : []).map((x) => String(x || '').trim()).filter(Boolean).slice(0, 5);
      Store.set({ bestAnswer: { id: nextId(), t: elapsed(), query: String(res.query_summary || '').trim(), reply: String(res.reply || '').trim(), steps } });
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
    const id = nextId();
    const patch = (p) => Store.set((st) => ({ askThread: st.askThread.map((x) => (x.id === id ? Object.assign({}, x, p) : x)) }));
    Store.set((st) => ({ askBusy: true, askThread: st.askThread.concat([{ id, t: elapsed(), q: question, answer: '', bullets: [], source: '', pending: true, error: false }]) }));
    try {
      const res = await AI.ask(Store.get(), userById(s.userId), question);
      if (Store.get().callStart !== s.callStart) return;
      const bullets = (Array.isArray(res.bullets) ? res.bullets : []).map((x) => String(x || '').trim()).filter(Boolean).slice(0, 3);
      patch({ answer: String(res.answer || '').trim(), bullets, source: String(res.source || '').trim(), pending: false });
    } catch (e) {
      if (Store.get().callStart === s.callStart) patch({ pending: false, error: true });
    } finally {
      if (Store.get().callStart === s.callStart) Store.set({ askBusy: false });
    }
  }

  function updateSettings(patch) {
    const settings = Object.assign({}, Store.get().settings, patch);
    saveSettings(settings);
    AI.configure(settings);
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

  function pickScenario(id) {
    const sc = scenarioById(id);
    const idle = Store.get().callStatus === 'idle';
    Store.set(Object.assign({ scenarioPick: id }, sc && idle ? { userId: userById(sc.customer).id } : {}));
  }

  function CallControls({ s }) {
    const simulated = s.mode === 'simulated';
    const live = s.mode === 'live';
    const active = s.callStatus === 'active';
    const micOn = live && s.listening === 'agent';
    const locked = active || !!s.incoming;
    return html`
      <div class="tb-controls">
        <select class="tb-select" title="Which scenario the AI caller plays" value=${s.scenarioPick} disabled=${locked} onChange=${(e) => pickScenario(e.target.value)}>
          <option value="random">Random scenario</option>
          ${AI.scenarios.map((x, i) => html`<option key=${x.id} value=${x.id}>${i + 1}. ${x.title}</option>`)}
        </select>
        <div class="seg">
          <button class=${simulated ? 'on' : ''} disabled=${locked} title="AIs play the caller and the agent" onClick=${() => setMode('simulated')}>Simulated</button>
          <button class=${live ? 'on' : ''} disabled=${locked} title="You are the agent on the mic" onClick=${() => setMode('live')}>Live call</button>
        </div>
        <button class="tb-btn" disabled=${locked} onClick=${ringCall}>Start call</button>
        ${active && simulated ? html`<button class="tb-btn" onClick=${toggleAutoplay}>${s.autoplay ? '❚❚ Pause' : '▶ Resume'}</button>` : ''}
        ${active && live ? html`<button class="tb-btn" disabled=${!recognizer.supported} onClick=${toggleMic}>${micOn ? '❚❚ Pause' : '▶ Resume'}</button>` : ''}
        <button class="tb-btn ghost" disabled=${!active} onClick=${endCall}>End call</button>
        <button class="tb-btn ghost" disabled=${s.callStatus === 'idle' && !s.transcript.length} onClick=${resetAll}>Reset</button>
      </div>`;
  }

  const EMPTY_ICONS = {
    steps: html`<polyline points="3.5,6 5,7.5 7.5,5" /><polyline points="3.5,12 5,13.5 7.5,11" /><polyline points="3.5,18 5,19.5 7.5,17" /><path d="M11 6h9M11 12h9M11 18h9" />`,
    guidance: html`<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1 2v.2h5.2v-.2c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z" />`,
    tools: html`<path d="M14.7 6.3a4 4 0 0 0-5.4 5.1l-5.8 5.8a1.8 1.8 0 0 0 2.6 2.6l5.8-5.8a4 4 0 0 0 5.1-5.4l-2.5 2.5-2.3-.4-.4-2.3z" />`,
    transcript: html`<path d="M4 5h16v11H9l-5 4z" /><path d="M8 9.5h8M8 12.5h5" />`,
  };
  function EmptyIcon({ name }) {
    return html`<div class="empty" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${EMPTY_ICONS[name]}</svg></div>`;
  }

  function Workflow({ s }) {
    const groups = s.groups;
    return html`
      <div class="wf">
        <h2 class="panel-title"><span>Workflow Steps</span></h2>
        <div class="wf-panel">
          ${groups.length ? '' : html`<${EmptyIcon} name="steps" />`}
          ${groups.map((g) => html`
            <div key=${g.id + ':' + (g.changed || 0)} class=${'wf-group' + (g.changed ? ' pop' : '')}>
              <div class="wf-group-title">${g.title}</div>
              ${g.steps.map((st) => html`
                <button key=${st.id + ':' + (st.changed || 0)} class=${'wf-step ' + st.status + (st.changed ? ' pop' : '') + (st.running ? ' running' : '')}
                  disabled=${s.callStatus !== 'active' || st.running} onClick=${() => runStep(g.id, st.id)}>
                  <span class="wf-label">${st.label}</span>
                </button>`)}
            </div>`)}
        </div>
      </div>`;
  }

  function Tabs({ s }) {
    const tab = (id, label, badge) => html`<button class=${'tab ' + (s.tab === id ? 'on' : '')} onClick=${() => Store.set({ tab: id, unseenGuidance: id === 'guidance' ? 0 : s.unseenGuidance })}>${label}${badge ? html`<span class="tab-badge">${badge}</span>` : ''}</button>`;
    return html`<div class="tabs">${tab('guidance', 'Live Guidance', s.tab !== 'guidance' && s.unseenGuidance ? s.unseenGuidance : 0)}${tab('customer', 'Customer 360')}${tab('transcript', 'Transcript')}</div>`;
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

  function BestAnswerCard({ b }) {
    return html`
      <div class="best" key=${b.id}>
        <div class="best-head">
          <span class="best-label">Best answer</span>
          <button class="best-close" title="Dismiss" aria-label="Dismiss" onClick=${() => Store.set({ bestAnswer: null })}>×</button>
        </div>
        ${b.query ? html`<div class="best-query"><span>Caller is asking</span>${b.query}</div>` : ''}
        <div class="best-reply">${b.reply}</div>
        ${b.steps.length ? html`<ol class="best-steps">${b.steps.map((x, i) => html`<li key=${i}>${x}</li>`)}</ol>` : ''}
      </div>`;
  }

  /* The agent's private chat with the copilot; the newest exchange stays in view, earlier ones scroll up. */
  function AskThread({ items }) {
    const ref = useRef(null);
    const last = items[items.length - 1];
    useAutoScroll(ref, `${items.length}:${last.pending}`);
    return html`
      <div class="askt">
        <div class="best-head">
          <span class="askt-label">Internal chat</span>
          <button class="best-close" title="Clear the chat" aria-label="Clear the chat" onClick=${() => Store.set({ askThread: [] })}>×</button>
        </div>
        <div class="askt-list" ref=${ref}>
          ${items.map((x) => html`
            <div key=${x.id} class="askt-item">
              <div class="askt-q">${x.q}</div>
              ${x.pending ? html`<div class="askt-a muted">Thinking…</div>`
                : x.error ? html`<div class="askt-a muted">Couldn't get an answer. Try asking again.</div>`
                : html`
                  <div class="askt-a">${x.answer}</div>
                  ${x.bullets.length ? html`<ul class="askt-bullets">${x.bullets.map((b, i) => html`<li key=${i}>${b}</li>`)}</ul>` : ''}
                  ${x.source ? html`<div class="askt-src">${x.source}</div>` : ''}`}
            </div>`)}
        </div>
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
    }, [latest, cleared, s.guidance.length]);
    return html`
      <div class="guidance">
        <div class="gcol">
        <div class="gpanel">
        ${s.askThread.length ? html`<${AskThread} items=${s.askThread} />` : ''}
        ${s.bestAnswer ? html`<${BestAnswerCard} b=${s.bestAnswer} />` : ''}
        <div class="gbox" ref=${boxRef}>
          ${batches.length
            ? batches.map((b, i) => html`
              <div key=${b.batch} class=${'gbatch ' + (b.batch === latest && !cleared ? 'latest' : 'earlier')} ref=${i === batches.length - 1 ? lastRef : null}>
                ${b.cards.map((c) => html`<${GuidanceCard} key=${c.id} c=${c} />`)}
              </div>`)
            : html`<${EmptyIcon} name="guidance" />`}
          <div class="gspacer" ref=${spacerRef}></div>
        </div>
        <div class="tags">
          <span class="tags-label">Tags:</span>
          ${s.tags.length ? s.tags.map((t) => html`<span key=${t} class="tag">${t}</span>`) : ''}
        </div>
        </div>
        </div>
        <${ActionFeed} s=${s} />
      </div>`;
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

  function ManualRow({ r, s, latest }) {
    const tool = toolById(r.tool);
    if (!tool) return '';
    if (r.status === 'done') return html`<${ToolRun} r=${r} tool=${tool} latest=${latest} />`;
    return html`
      <div class="frow task single">
        <div class="fcell">
          <div class="run-head"><span class="run-title">${tool.message || tool.label}</span></div>
          <${Approval} tool=${tool} inputs=${r.inputs} running=${r.status === 'running'} disabled=${s.callStatus === 'idle'}
            onChange=${(inputs) => updateRow(r.id, { inputs, touched: true })}
            onRun=${async () => { const awaited = !!(toolWait && toolWait.tool === r.tool); await runManualRow(r.id); if (!awaited) settle(); }}
            onSkip=${() => removeRow(r)} />
        </div>
      </div>`;
  }

  /* Output field names and values in plain words: "on_file_since" reads "On file since". */
  const fieldLabel = (k) => {
    const words = String(k).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').trim().toLowerCase();
    return words.charAt(0).toUpperCase() + words.slice(1);
  };
  const readable = (v) => {
    if (v == null || v === '') return '—';
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    if (Array.isArray(v)) return v.length ? v.map(readable).join('; ') : 'None';
    if (typeof v === 'object') return Object.entries(v).map(([k, x]) => `${fieldLabel(k)}: ${readable(x)}`).join(' · ');
    return String(v);
  };

  /* A run tool: the one run last shows its heading, Input and Output tabs and the output card; earlier
     ones collapse to their heading, with the same view behind "Show details". */
  /* Fields kept for the AIs but not shown to the agent (the caller reads the passcode back). */
  const HIDDEN_OUTPUT = { send_otp: ['code'] };
  const DEMO_WORD = /\b(demo|mock)\b/i;
  const DEMO_KEY = /demo|mock|simulat/i;
  const shownText = (v) => (typeof v === 'string' && DEMO_WORD.test(v) ? '' : v);

  function ToolRun({ r, tool, latest }) {
    const [tab, setTab] = useState(latest ? 'output' : null);
    useEffect(() => { if (latest) setTab((x) => x || 'output'); else setTab(null); }, [latest]);
    const out = r.output || {};
    const hidden = ['headline', 'note'].concat(HIDDEN_OUTPUT[tool.id] || []);
    const rows = Object.entries(out).filter(([k, v]) => !hidden.includes(k) && !DEMO_KEY.test(k) && !DEMO_WORD.test(readable(v)));
    const headline = shownText(out.headline);
    const note = shownText(out.note);
    const pick = (id) => setTab((x) => (x === id ? null : id));
    const card = tab === 'output'
      ? html`
        <div class="run-card">
          ${headline || note ? html`
            <div class="run-top">
              ${headline ? html`<div class="run-headline">${headline}</div>` : ''}
              ${note ? html`<div class="run-note">${note}</div>` : ''}
            </div>` : ''}
          ${rows.length ? html`<div class="run-rows">${rows.map(([k, v]) => html`<div key=${k} class="run-row"><span class="run-k">${fieldLabel(k)}</span><span class="run-v">${readable(v)}</span></div>`)}</div>` : ''}
        </div>`
      : tab === 'input' ? html`
        <div class="run-card">
          <div class="run-rows">${tool.inputs.map((f) => html`<div key=${f.key} class="run-row"><span class="run-k">${f.label}</span><span class="run-v">${readable(r.inputs[f.key])}</span></div>`)}</div>
        </div>` : '';
    return html`
      <div class=${'frow run ' + (latest ? 'latest' : 'earlier')}>
        <div class="run-head">
          <span class="run-title">${tool.message || tool.label}</span>
          <span class="run-tabs">
            <button class=${'run-tab ' + (tab === 'input' ? 'on' : '')} onClick=${() => pick('input')}>Input</button>
            <button class=${'run-tab ' + (tab === 'output' ? 'on' : '')} onClick=${() => pick('output')}>Output</button>
          </span>
        </div>
        ${card}
      </div>`;
  }

  function ActionFeed({ s }) {
    const boxRef = useRef(null);
    const lastRun = s.feed.reduce((best, r) => (r.status === 'done' && (!best || (r.ranAt || 0) > (best.ranAt || 0)) ? r : best), null);
    /* The last run stays expanded only until a new tool row opens after it, and stays collapsed
       while that row runs or after it is skipped. */
    const latestRun = lastRun && (lastRun.ranAt || 0) > (s.lastOpenedAt || 0) ? lastRun : null;
    /* The row with the newest activity (opened or finished last) sits at the top of the column;
       earlier rows are scrolled up out of view, reachable by scrolling up. */
    const focusIdx = s.feed.reduce((best, r, i) => (Math.max(r.openedAt || 0, r.ranAt || 0) >= best.at ? { i, at: Math.max(r.openedAt || 0, r.ranAt || 0) } : best), { i: -1, at: -1 }).i;
    const focus = s.feed[focusIdx];
    const spacerRef = useRef(null);
    const seen = useRef(false);
    useEffect(() => {
      const box = boxRef.current; const spacer = spacerRef.current;
      const el = box && box.children[focusIdx];
      if (!el || !spacer) return;
      spacer.style.height = `${Math.max(0, box.clientHeight - el.offsetHeight)}px`;
      const behavior = seen.current ? 'smooth' : 'auto';
      seen.current = true;
      try { box.scrollTo({ top: el.offsetTop, behavior }); } catch (e) { box.scrollTop = el.offsetTop; }
    }, [focus && focus.id, focus && focus.status, s.feed.length, latestRun && latestRun.id]);
    if (!s.feed.length) {
      return html`<div class="feed"><${EmptyIcon} name="tools" /></div>`;
    }
    return html`
      <div class="feed" ref=${boxRef}>
        ${s.feed.map((r) => html`<${ManualRow} key=${r.id} r=${r} s=${s} latest=${r === latestRun} />`)}
        <div class="fspacer" ref=${spacerRef}></div>
      </div>`;
  }

  const C360_ICONS = {
    store: html`<path d="M4 9.5 5.5 4h13L20 9.5M4 9.5h16M4 9.5c0 1.4 1.1 2.5 2.7 2.5S9.3 10.9 9.3 9.5c0 1.4 1.2 2.5 2.7 2.5s2.7-1.1 2.7-2.5c0 1.4 1.1 2.5 2.6 2.5S20 10.9 20 9.5M5.5 12v8h13v-8M10 20v-4.5h4V20" />`,
    shield: html`<path d="M12 3 5 6v5.5c0 4.2 3 7.8 7 9.5 4-1.7 7-5.3 7-9.5V6z" /><polyline points="9,12 11.2,14.2 15,10" />`,
    people: html`<circle cx="9" cy="8.5" r="3" /><path d="M3.5 19c.6-3 2.8-4.8 5.5-4.8s4.9 1.8 5.5 4.8" /><circle cx="16.5" cy="9.5" r="2.3" /><path d="M16.2 14.3c2.3.1 3.9 1.6 4.3 4.2" />`,
    rx: html`<rect x="4" y="9" width="16" height="6" rx="3" transform="rotate(-45 12 12)" /><path d="m9.5 9.5 5 5" />`,
    pharmacy: html`<path d="M12 4v16M4 12h16" /><rect x="3.5" y="3.5" width="17" height="17" rx="4" />`,
    allergy: html`<path d="M12 4 3 19.5h18z" /><path d="M12 10v4.5M12 17v.3" />`,
    history: html`<circle cx="12" cy="12" r="8.5" /><polyline points="12,7.5 12,12 15,14" />`,
    note: html`<path d="M5 4h14v11l-5 5H5z" /><path d="M14 20v-5h5" />`,
  };
  const C360Icon = ({ name }) => html`<svg class="c360-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${C360_ICONS[name]}</svg>`;
  const C360Card = ({ icon, title, cls, children }) => html`
    <section class=${'c360-card ' + (cls || '')}>
      <h3><${C360Icon} name=${icon} />${title}</h3>
      ${children}
    </section>`;

  const DEMO_TODAY = new Date(2026, 9, 22);
  function ageFrom(dob) {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(dob || ''));
    if (!m) return null;
    const born = new Date(+m[3], +m[1] - 1, +m[2]);
    let age = DEMO_TODAY.getFullYear() - born.getFullYear();
    if (DEMO_TODAY < new Date(DEMO_TODAY.getFullYear(), born.getMonth(), born.getDate())) age -= 1;
    return age;
  }
  function rxTone(status) {
    const x = String(status || '').toLowerCase();
    if (/reject|denied|hold|expired|cancel/.test(x)) return ['bad', 'Needs attention'];
    if (/request|progress|ready|transfer|pending/.test(x)) return ['warn', 'In progress'];
    if (/^active/.test(x)) return ['ok', 'Active'];
    return ['neutral', status];
  }
  const noneLike = (v) => !v || /^(none|not enrolled|none on file)$/i.test(String(v).trim());

  function CustomerTab({ s }) {
    const u = userById(s.userId);
    const kv = (rows) => html`<dl class="kv">${rows.map(([k, v]) => html`<div key=${k}><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>`;
    const initials = u.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
    const age = ageFrom(u.dob);
    const allergies = (u.allergies || []).filter((a) => !noneLike(a));
    const reps = u.representatives || [];
    const insOk = /^active$/i.test(u.insurance.status);
    const alertsOn = !noneLike(u.textAlerts);
    const pill = (tone, text) => html`<span class=${'c360-pill ' + tone}>${text}</span>`;
    return html`
      <div class="c360">
        <section class="c360-hero">
          <div class="c360-avatar">${initials}</div>
          <div class="c360-id">
            <div class="c360-name">${u.name}
              ${s.callStatus === 'active' ? html`<span class="c360-pill ok live"><i></i>On call · matched by phone</span>` : ''}
              ${s.callStatus === 'ended' ? pill('neutral', 'Call ended') : ''}
            </div>
            <div class="c360-sub">DOB ${u.dob}${age != null ? ` · ${age} yrs` : ''} · ${u.language}</div>
            <div class="c360-chips">
              <span class="c360-chip">☏ ${u.phone}</span>
              <span class="c360-chip">✉ ${u.email}</span>
              <span class="c360-chip">Prefers ${String(u.preferredContact).toLowerCase()}</span>
            </div>
          </div>
          <div class="c360-badges">
            ${pill(insOk ? 'ok' : 'bad', `Insurance ${String(u.insurance.status).toLowerCase()}`)}
            ${allergies.length ? pill('bad', `Allergy: ${allergies.join(', ')}`) : pill('neutral', 'No known allergies')}
            ${reps.length ? pill('info', `${reps.length} authorized rep${reps.length > 1 ? 's' : ''}`) : pill('neutral', 'No reps on file')}
            ${pill(alertsOn ? 'ok' : 'neutral', alertsOn ? 'Text alerts on' : 'Text alerts off')}
            ${pill('neutral', `${u.prescriptions.length} active Rx`)}
          </div>
        </section>

        <div class="c360-row">
          <${C360Card} icon="store" title="Preferred store">
            ${kv([['Store', `${u.store.name} ${u.store.id}`], ['Address', u.store.address], ['Phone', u.store.phone], ['Hours', u.store.hours]])}
          <//>
          <${C360Card} icon="shield" title="Insurance">
            ${kv([['Plan', u.insurance.plan], ['Member ID', u.insurance.memberId], ['Group', u.insurance.group], ['Status', pill(insOk ? 'ok' : 'bad', u.insurance.status)]])}
          <//>
          <${C360Card} icon="people" title="Representatives & alerts">
            <dl class="kv">
              <div><dt>Authorized reps</dt><dd>${reps.length
                ? reps.map((r) => html`<div key=${r.name} class="c360-rep"><b>${r.name}</b><span>${r.relationship} · since ${r.since}</span></div>`)
                : html`<span class="c360-muted">None on file</span>`}</dd></div>
              <div><dt>Text alerts</dt><dd>${alertsOn ? u.textAlerts : html`<span class="c360-muted">${u.textAlerts || 'Not enrolled'}</span>`}</dd></div>
            </dl>
          <//>
        </div>

        <${C360Card} icon="rx" title="Active prescriptions" cls="wide">
          <table class="rx">
            <thead><tr><th>Medication</th><th>Directions</th><th>Supply</th><th>Refills</th><th>Last fill</th><th>Copay</th><th>Status</th></tr></thead>
            <tbody>${u.prescriptions.map((p) => {
              const [tone, label] = rxTone(p.status);
              return html`<tr key=${p.rx}>
                <td><div class="rx-drug">${p.drug}</div><div class="rx-meta">Rx ${p.rx}${p.prescriber ? ` · ${p.prescriber}` : ''}</div></td>
                <td>${p.sig}</td>
                <td class="nowrap">${p.qty} / ${p.days} days</td>
                <td>${p.refills}</td>
                <td class="nowrap">${p.lastFill}</td>
                <td class="nowrap rx-copay"><div><span>30 days</span>${p.copay30}</div><div><span>90 days</span>${p.copay90}</div></td>
                <td class="rx-status">${pill(tone, label)}${label !== p.status ? html`<div class="rx-meta">${p.status}</div>` : ''}</td>
              </tr>`;
            })}</tbody>
          </table>
        <//>

        ${(u.otherPharmacies || []).length ? html`
          <${C360Card} icon="pharmacy" title="At other pharmacies" cls="wide">
            <table class="rx">
              <thead><tr><th>Medication</th><th>Directions</th><th>Pharmacy</th><th>Copay</th><th>Note</th></tr></thead>
              <tbody>${u.otherPharmacies.map((p) => html`<tr key=${p.drug}>
                <td><div class="rx-drug">${p.drug}</div></td>
                <td>${p.sig}</td>
                <td>${p.pharmacy}</td>
                <td class="nowrap rx-copay"><div><span>30 days</span>${p.copay30}</div><div><span>90 days</span>${p.copay90}</div></td>
                <td class="rx-meta">${p.note}</td>
              </tr>`)}</tbody>
            </table>
          <//>` : ''}

        <div class="c360-row two">
          <${C360Card} icon="allergy" title="Allergies & immunizations">
            <div class="c360-label">Allergies</div>
            <div class="c360-chips">${allergies.length ? allergies.map((a) => html`<span key=${a} class="c360-pill bad">${a}</span>`) : html`<span class="c360-muted">No known allergies</span>`}</div>
            <div class="c360-label">Immunizations</div>
            ${u.immunizations.length
              ? html`<ul class="c360-imm">${u.immunizations.map((i) => html`<li key=${i.vaccine + i.date}><span>${i.vaccine}</span><span class="c360-muted">${i.date}</span></li>`)}</ul>`
              : html`<span class="c360-muted">None on file</span>`}
          <//>
          <${C360Card} icon="history" title="Recent interactions">
            <ul class="c360-timeline">${u.interactions.map((i) => html`
              <li key=${i.date + i.channel}>
                <div class="tl-head"><b>${i.date}</b><span class="c360-chip small">${i.channel}</span></div>
                <div class="tl-text">${i.summary}</div>
              </li>`)}</ul>
          <//>
        </div>

        ${u.notes ? html`<section class="c360-note"><h3><${C360Icon} name="note" />Notes</h3><p>${u.notes}</p></section>` : ''}
      </div>`;
  }

  function TranscriptTab({ s }) {
    const boxRef = useRef(null);
    useAutoScroll(boxRef, `${s.transcript.length}|${s.interim}`);
    return html`
      <div class="transcript" ref=${boxRef}>
        ${s.transcript.length || s.interim ? '' : html`<${EmptyIcon} name="transcript" />`}
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

  function IncomingCallModal({ s }) {
    const u = userById(s.incoming.userId);
    useEffect(() => {
      const onKey = (e) => { if (e.key === 'Escape') declineCall(); };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, []);
    return html`
      <div class="modal-back ring-back">
        <div class="ring" role="dialog" aria-modal="true" aria-label="Incoming call">
          <div class="ring-icon" aria-hidden="true">☏</div>
          <div class="ring-title">Incoming call</div>
          <div class="ring-number">${u.phoneMasked || u.phone}</div>
          <div class="ring-sub">Walgreens pharmacy line · ${s.mode === 'simulated' ? 'Simulated call' : 'Live call'}</div>
          <div class="ring-actions">
            <button class="ring-btn decline" onClick=${declineCall}>Decline</button>
            <button class="ring-btn accept" onClick=${acceptCall}>Accept</button>
          </div>
        </div>
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
          <p class="modal-help">The panels update automatically after every line. Behavior comes from prompts/system_prompt.md, prompts/phone_assist_workflow.md, prompts/phone_assist_guidance.md, prompts/phone_assist_best_answer.md, prompts/chat.md, tools.md and kb/. Refresh the page after editing them.</p>
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

  function Header({ s }) {
    const nav = [['⌂', 'Overview'], ['⟲', 'AI Studio'], ['▤', 'Knowledge Base'], ['☺', 'Playground'], ['◯', 'Conversations']];
    return html`
      <header class="hdr">
        <div class="topnav">
          <span class="brand">Cignara</span>
          <span class="brand-sep">/</span>
          <nav class="nav">
            ${nav.map(([ico, label]) => html`<span key=${label} class=${'nav-item' + (label === 'Playground' ? ' on' : '')}><i>${ico}</i>${label}</span>`)}
          </nav>
          <div class="org">
            <span class="org-name">Walgreens Pharmacy Self…</span>
            <span class="org-env">No environment ▾</span>
          </div>
          <span class="avatar" aria-hidden="true"></span>
        </div>
        <div class="toolbar">
          <span class="tb-title">☏ Phone Assist ▾</span>
          <span class="tb-sep"></span>
          <span class="tb-muted">Draft ▾</span>
          <span class="tb-sep"></span>
          <${CallControls} s=${s} />
          <span class="tb-right">
            <span class="tb-muted">● Select user ▾</span>
            <span class="tb-muted">☏ Assign number ▾</span>
            <span class="tb-muted">⋯</span>
          </span>
        </div>
      </header>`;
  }

  function App() {
    const s = useStore();
    return html`
      <${Header} s=${s} />
      <div class="stage">
        <div class="canvas">
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
      </div>
      ${s.incoming ? html`<${IncomingCallModal} s=${s} />` : ''}
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

  global.PhoneAssist = { Store, startCall, ringCall, acceptCall, declineCall, playNext, toggleAutoplay, openDraft, runManualRow, runStep, settle, getBestReply, askQuestion, setMode, toggleMic, agentSays, resetAll, endCall };
})(window);
