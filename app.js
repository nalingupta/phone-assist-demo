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
  const DEFAULT_SETTINGS = { apiKey: '', model: 'gpt-5.6-luna', effort: 'low', baseUrl: '', tier: 'quick', audio: true, toolMode: 'auto' };
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
  const MAX_TASKS_PER_TURN = 2;
  const MAX_TASK_STEPS = 6;
  const STEP_STATUS = ['pending', 'done', 'missed'];
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
      tags: [], guidance: [], findings: [], pendingFindings: [], batch: 0, toolPrefill: {},
      feed: [], toolRuns: [], suggestedTool: null, agentRequest: null, pendingTask: '',
      scenarioId: null, turnCount: 0, nextSpeaker: 'agent', callerDone: false, agentFollowUp: false, autoplay: false, listening: null, speaking: null, aiBusy: false, aiError: '', bestBusy: false, askBusy: false
    };
  }

  const Store = (() => {
    let state = Object.assign(freshCall(), {
      userId: pickRandom(D.USERS).id, incoming: 'random', scenarioPick: 'random', mode: 'simulated', tab: 'guidance', settings: loadSettings(), settingsOpen: false,
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

  /* A guidance update: its card plus the conclusions of tasks that finished since the last one, shown together. */
  function pushCards(cards) {
    cards = cards || [];
    if (!cards.length && !Store.get().pendingFindings.length) return;
    Store.set((s) => {
      const batch = s.batch + 1;
      const t = elapsed();
      const fresh = cards.map((c) => ({ id: nextId(), batch, t, kind: c.kind, text: c.text, bullets: Array.isArray(c.bullets) ? c.bullets.filter((b) => typeof b === 'string' && b.trim()).slice(0, 3) : [], source: c.source || '' }));
      const found = s.pendingFindings.map((f) => Object.assign({}, f, { batch, t }));
      const added = fresh.length + found.length;
      return { batch, guidance: s.guidance.concat(fresh).slice(-60), findings: s.findings.concat(found).slice(-60), pendingFindings: [], unseenGuidance: s.tab === 'guidance' ? 0 : s.unseenGuidance + added };
    });
  }

  function addFinding(summary) {
    if (!summary || (!summary.title && !(summary.rows || []).length)) return;
    const rows = (summary.rows || []).filter((r) => r && r.label && r.value);
    Store.set((s) => ({ pendingFindings: s.pendingFindings.concat([{ id: nextId(), title: summary.title || '', rows }]) }));
  }

  /* ---------------- action feed: manual tool rows and AI task rows ---------------- */
  const prefilledInputs = (tool, values) => {
    const inputs = {};
    tool.inputs.forEach((f) => { inputs[f.key] = (values && values[f.key]) || ''; });
    return inputs;
  };
  const missingInputs = (tool, inputs) => tool.inputs.filter((f) => !f.optional && !String(inputs[f.key] || '').trim()).map((f) => f.key);
  const feedRow = (id) => Store.get().feed.find((r) => r.id === id);
  function updateRow(id, patch) {
    Store.set((s) => ({ feed: s.feed.map((r) => (r.id === id ? Object.assign({}, r, typeof patch === 'function' ? patch(r) : patch) : r)) }));
  }
  function updateStep(taskId, stepId, patch) {
    updateRow(taskId, (r) => ({ steps: r.steps.map((st) => (st.id === stepId ? Object.assign({}, st, patch) : st)) }));
  }

  /* Simulates one call and records it in the transcript and the call's tool history. */
  async function simulate(tool, inputs) {
    const s = Store.get();
    const started = Date.now();
    const res = await AI.simulateTool(tool, inputs, s, userById(s.userId));
    if (res.fallback) notify(`Could not simulate ${tool.label}; showing its example output.${res.error ? ' ' + res.error : ''}`);
    const output = res.output || { demo_mode: true };
    const summary = Object.entries(output).filter(([k]) => k !== 'demo_mode').slice(0, 2).map(([k, v]) => `${k}: ${fmtVal(v)}`).join(' · ');
    addLine('tool', `${tool.label} → ${summary}`);
    Store.set((st) => ({ toolRuns: st.toolRuns.concat([{ id: nextId(), tool: tool.id, inputs, output, t: elapsed() }]) }));
    return { output, ms: Date.now() - started };
  }

  /* Opens a human-only tool's input row, prefilled, so the agent only has to press Execute.
     `auto` is 'agent' (the agent AI asked for it) or 'suggested' (the copilot suggested it). */
  function openDraft(id, auto, values) {
    const tool = toolById(id);
    if (!tool) return;
    Store.set((s) => {
      const draft = s.feed.find((r) => r.type === 'manual' && r.tool === id && r.status === 'draft');
      const filled = prefilledInputs(tool, Object.assign({}, s.toolPrefill[id], values));
      if (draft) {
        const inputs = Object.assign({}, draft.inputs);
        if (!draft.touched) Object.entries(filled).forEach(([k, v]) => { if (v) inputs[k] = v; });
        return { feed: s.feed.map((r) => (r.id === draft.id ? Object.assign({}, r, { inputs, auto: auto === 'agent' ? 'agent' : r.auto }) : r)) };
      }
      return { feed: s.feed.concat([{ id: nextId(), type: 'manual', tool: id, by: 'agent', auto, touched: false, status: 'draft', inputs: filled }]) };
    });
  }

  /* A new guidance update: fill blanks in open rows and open the newly suggested tool below them.
     Open rows stay until the agent executes or skips them. */
  function syncSuggestedDrafts(suggested) {
    Store.set((s) => ({
      feed: s.feed.map((r) => {
        if (r.type !== 'manual' || r.status !== 'draft' || r.touched) return r;
        const tool = toolById(r.tool);
        const pre = s.toolPrefill[r.tool] || {};
        const inputs = Object.assign({}, r.inputs);
        tool.inputs.forEach((f) => { if (!String(inputs[f.key] || '').trim() && pre[f.key]) inputs[f.key] = pre[f.key]; });
        return Object.assign({}, r, { inputs });
      })
    }));
    if (suggested && !Store.get().toolRuns.some((t) => t.tool === suggested)) openDraft(suggested, 'suggested');
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

  function removeRow(r) {
    Store.set((st) => ({ feed: st.feed.filter((x) => x.id !== r.id) }));
    if (r.type === 'manual') finishToolWait(r.tool, false);
  }

  async function runManualRow(rowId) {
    const row = feedRow(rowId);
    const tool = row && toolById(row.tool);
    if (!tool || row.status !== 'draft') return;
    updateRow(rowId, { status: 'running' });
    Store.set((s) => ({ suggestedTool: s.suggestedTool === tool.id ? null : s.suggestedTool }));
    const { output, ms } = await simulate(tool, row.inputs);
    updateRow(rowId, { status: 'done', output, ms });
    Store.set((st) => ({ feed: st.feed.filter((x) => !(x.type === 'manual' && x.tool === tool.id && x.status === 'draft' && !x.touched && x.id !== rowId)) }));
    finishToolWait(tool.id, true);
  }

  /* Resolves when a task is done, including any steps waiting for the agent's click. */
  const taskWaiters = new Map();
  function finishTask(taskId, patch) {
    updateRow(taskId, Object.assign({ status: 'done' }, patch));
    const resolve = taskWaiters.get(taskId);
    taskWaiters.delete(taskId);
    if (resolve) resolve();
  }
  function releaseWaits() {
    finishToolWait(null, false);
    taskWaiters.forEach((resolve) => resolve());
    taskWaiters.clear();
  }

  /* Runs the next steps of an AI task until it finishes, hits its step limit, or needs the agent:
     a missing input, or (with "All manual" tools) the agent's click to run the step. */
  async function continueTask(taskId, forceFinish) {
    for (;;) {
      const task = feedRow(taskId);
      if (!task || task.status !== 'running' || Store.get().callStatus === 'idle') return;
      const doneSteps = task.steps.filter((st) => st.status === 'done' || st.status === 'skipped').length;
      const mustFinish = forceFinish || doneSteps >= MAX_TASK_STEPS;
      const s = Store.get();
      let step;
      try { step = await AI.nextStep(s, userById(s.userId), task, mustFinish); }
      catch (e) { finishTask(taskId, { summary: { title: 'Could not finish this task', rows: [], note: e.message || String(e) } }); return; }
      if (step.action === 'finish' || mustFinish) {
        finishTask(taskId, { summary: step.summary });
        addFinding(step.summary);
        return;
      }
      const tool = toolById(String(step.tool || '').trim());
      if (!tool || !tool.autoApproved) {
        if (tool) Store.set({ suggestedTool: tool.id });
        forceFinish = true;
        continue;
      }
      const values = {};
      (step.inputs || []).forEach((f) => { if (f && f.name) values[f.name] = String(f.value || ''); });
      const inputs = prefilledInputs(tool, values);
      /* Repeating a call this task already made returns the same answer: wrap up instead. */
      if (task.steps.some((st) => st.status === 'done' && st.tool === tool.id && JSON.stringify(st.inputs) === JSON.stringify(inputs))) {
        forceFinish = true;
        continue;
      }
      const missing = s.mode === 'simulated' ? [] : missingInputs(tool, inputs);
      const pause = missing.length || s.settings.toolMode === 'manual';
      const stepId = nextId();
      updateRow(taskId, (r) => ({ steps: r.steps.concat([{ id: stepId, tool: tool.id, inputs, missing, status: pause ? 'needs_input' : 'running' }]) }));
      if (pause) { updateRow(taskId, { status: 'needs_input' }); return; }
      const { output, ms } = await simulate(tool, inputs);
      updateStep(taskId, stepId, { status: 'done', output, ms });
    }
  }

  function startTask(goal) {
    const id = nextId();
    const done = new Promise((resolve) => taskWaiters.set(id, resolve));
    Store.set((s) => ({ feed: s.feed.concat([{ id, type: 'task', goal, status: 'running', steps: [], started: Date.now() }]), tab: 'guidance' }));
    continueTask(id);
    return done;
  }

  /* The agent skipped a step a paused task was waiting on; the task wraps up with what it has. */
  async function skipStep(taskId, stepId) {
    const task = feedRow(taskId);
    if (!task || task.status !== 'needs_input') return;
    updateStep(taskId, stepId, { status: 'skipped', missing: [] });
    updateRow(taskId, { status: 'running' });
    await continueTask(taskId, true);
    if (Store.get().mode !== 'simulated') settle();
  }

  /* The agent ran (and if needed filled in) the step a paused task was waiting on. */
  async function resumeTask(taskId, stepId, inputs) {
    const task = feedRow(taskId);
    const step = task && task.steps.find((st) => st.id === stepId);
    const tool = step && toolById(step.tool);
    if (!tool || task.status !== 'needs_input') return;
    if (missingInputs(tool, inputs).length) { notify('Fill in the required inputs first.'); return; }
    updateStep(taskId, stepId, { inputs, missing: [], status: 'running' });
    updateRow(taskId, { status: 'running' });
    const { output, ms } = await simulate(tool, inputs);
    updateStep(taskId, stepId, { status: 'done', output, ms });
    await continueTask(taskId);
    if (Store.get().mode === 'simulated') return;
    settle();
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

  function applyWorkflow(res) {
    if (!res || typeof res !== 'object') throw new Error('Empty workflow update');
    Store.set((s) => ({ groups: mergeWorkflows(s.groups, res.workflows || []) }));
  }

  function applyGuidance(res) {
    if (!res || typeof res !== 'object') throw new Error('Empty guidance update');
    const tools = (res.tools || []).filter((t) => t && toolById(t.name));
    const prefill = {};
    tools.forEach((t) => {
      const values = {};
      (t.inputs || []).forEach((f) => { if (f && f.name && typeof f.value === 'string') values[f.name] = f.value; });
      prefill[t.name] = values;
    });
    /* Only a human-only tool can be suggested; auto-approved tools must go through a task. */
    const suggestedDef = typeof res.suggestedTool === 'string' && toolById(res.suggestedTool.trim());
    const suggested = suggestedDef && !suggestedDef.autoApproved ? suggestedDef.id : null;
    const task = typeof res.autoTask === 'string' ? res.autoTask.trim() : '';
    Store.set((s) => ({
      pendingTask: task,
      tags: Array.isArray(res.tags) ? res.tags.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim()).slice(0, 8) : s.tags,
      toolPrefill: Object.assign({}, s.toolPrefill, prefill),
      suggestedTool: suggested
    }));
    if (Store.get().callStatus === 'active') syncSuggestedDrafts(suggested);
    /* One card at a time; whether a new card is worth replacing the current one is up to the guidance prompt. */
    const cards = (res.guidance || []).filter((c) => c && c.text && c.kind).slice(0, 1)
      .filter((c) => !holdTasks || /^caution$/i.test(String(c.kind).trim()));
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

  /* After a line or a tool result: update the screen, then let the phone assist run the task it asked for. */
  let turnTasks = 0;
  function newTurn() { turnTasks = 0; }
  /* Simulated call: the agent just handed the turn to the caller, so lookups and new cards
     (other than a Caution) wait for the update after the caller's reply. */
  let holdTasks = false;

  async function settleOnce() {
    for (let n = 0; n < MAX_TASKS_PER_TURN + 1; n++) {
      await scheduleAnalysis();
      const s = Store.get();
      if (s.callStatus !== 'active') return;
      const taskRunning = s.feed.some((r) => r.type === 'task' && r.status === 'running');
      if (s.pendingTask && !taskRunning && turnTasks < MAX_TASKS_PER_TURN && !holdTasks) {
        turnTasks++;
        const goal = s.pendingTask;
        Store.set({ pendingTask: '' });
        if (s.mode === 'simulated') { await startTask(goal); continue; }
        startTask(goal).then(() => settle());   // live: guidance keeps updating while the task runs
        return;
      }
      return;
    }
  }

  let settling = null;
  let settleAgain = false;
  function settle() {
    if (!AI.available()) return Promise.resolve();
    if (settling) { settleAgain = true; return settling; }
    settling = (async () => {
      do { settleAgain = false; await settleOnce(); } while (settleAgain);
      if (Store.get().callStatus !== 'idle') pushCards([]);   // a conclusion no card followed still shows on its own
      settling = null;
    })();
    return settling;
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
    releaseWaits();
    const s = Store.get();
    let scenarioId = null;
    let userId;
    if (s.mode === 'simulated') {
      if (!AI.available()) { notify('A simulated call needs an AI model: both the caller and the agent are played by it.'); return false; }
      if (!AI.scenarios.length) { notify('No scenarios found in scenarios/.'); return false; }
      const pick = opts.scenarioId || (s.scenarioPick !== 'random' ? s.scenarioPick : null);
      const sc = (pick && scenarioById(pick)) || pickRandom(AI.scenarios, lastScenarioId);
      scenarioId = sc.id;
      userId = userById(sc.customer).id;
      lastScenarioId = sc.id;
    } else {
      const chosen = opts.userId || (s.incoming !== 'random' ? s.incoming : null);
      userId = (chosen && userById(chosen).id === chosen) ? chosen : pickRandom(D.USERS, lastUserId).id;
      lastUserId = userId;
    }
    Store.set(Object.assign(freshCall(), { userId, scenarioId, callStatus: 'active', callStart: Date.now(), tab: 'customer', aiStatus: AI.status() }));
    if (s.mode === 'simulated') {
      if (autoFirst) setTimeout(() => { if (Store.get().callStatus === 'active' && Store.get().turnCount === 0) playNext(); }, 0);
    } else {
      if (!AI.available()) notify('OpenAI is not connected on this server, so the panels will not update in live mode.');
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

  async function speakLine(speaker, text) {
    if (!Store.get().settings.audio || !TTS.supported) return false;
    Store.set({ speaking: speaker });
    try { return await TTS.speak(text, speaker); }
    finally { if (Store.get().speaking === speaker) Store.set({ speaking: null }); }
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
    if (say) {
      const line = addLine(speaker, say);
      if (speaker === 'agent') line.handOver = !!res.hand_over;
    }
    const callerDone = s.callerDone || (speaker === 'caller' && !!res.end_call);
    /* The call ends on the agent's closing line after the caller has said goodbye. */
    const ending = (speaker === 'agent' && s.callerDone) || s.turnCount + 1 >= MAX_SIM_TURNS;
    const followUp = speaker === 'agent' && s.agentFollowUp;
    Store.set({ turnCount: s.turnCount + 1, nextSpeaker: speaker === 'agent' ? 'caller' : 'agent', callerDone, agentFollowUp: false });
    if (say) await speakLine(speaker, say);
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
    const batchBefore = Store.get().batch;
    const handOver = speaker === 'agent' && !!say && !!res.hand_over;
    newTurn();
    holdTasks = handOver;
    try { await settle(); } finally { holdTasks = false; }
    if (!live()) return { played: true };
    if (speaker === 'agent' && say && !followUp) {
      const after = Store.get();
      const card = after.guidance[after.guidance.length - 1];
      const newCaution = after.batch !== batchBefore && card && /^caution$/i.test(String(card.kind).trim());
      const newCard = after.batch !== batchBefore;
      if (handOver ? newCaution : (after.toolRuns.length > s.toolRuns.length || newCard)) {
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
    newTurn();
    settle();
  }

  function speakAs(speaker) {
    const s = Store.get();
    if (s.callStatus !== 'active') { notify('Start the call first.'); return; }
    if (s.mode === 'simulated') {
      if (s.autoplay) return;
      if (s.nextSpeaker !== speaker) { notify(`The next turn belongs to the ${s.nextSpeaker === 'caller' ? 'caller' : 'support agent'}.`); return; }
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
    const sc = simulated ? scenarioById(s.scenarioId) : null;
    const user = userById(s.userId);
    const speakClass = (who) => {
      let c = 'rail-btn';
      if (simulated && active && !s.autoplay && s.nextSpeaker === who) c += ' next';
      if (!simulated && s.listening === who) c += ' listening';
      return c;
    };
    const pausedStep = s.feed.filter((r) => r.type === 'task' && r.status === 'needs_input').map((r) => r.steps.find((st) => st.status === 'needs_input')).find(Boolean);
    const waitingTool = (s.agentRequest && toolById(s.agentRequest.tool)) || (pausedStep && toolById(pausedStep.tool));
    const waitingOn = waitingTool ? waitingTool.label : '';
    const send = (who) => { const t = draft.trim(); if (!t) return; if (!active) { notify('Start the call first.'); return; } addLiveLine(who, t); setDraft(''); };
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
        <div class="rail-field">
          <span class="rail-field-label">Tools</span>
          <div class="seg" title="Auto + manual: lookups the tools file allows run on their own. All manual: every tool waits for you to run it.">
            <button class=${s.settings.toolMode !== 'manual' ? 'on' : ''} onClick=${() => updateSettings({ toolMode: 'auto' })}>Auto + manual</button>
            <button class=${s.settings.toolMode === 'manual' ? 'on' : ''} onClick=${() => updateSettings({ toolMode: 'manual' })}>All manual</button>
          </div>
        </div>
        <button class=${'rail-btn ' + (s.callStatus === 'idle' ? 'primary' : '')} onClick=${() => startCall()}>${s.callStatus === 'idle' ? 'Start call' : 'New call'}</button>
        <button class=${speakClass('caller')} disabled=${!active || (simulated && s.autoplay)} onClick=${() => speakAs('caller')}>
          ${!simulated && s.listening === 'caller' ? html`<i class="dot"></i>` : ''}Speak as Caller
        </button>
        <button class=${speakClass('agent')} disabled=${!active || (simulated && s.autoplay)} onClick=${() => speakAs('agent')}>
          ${!simulated && s.listening === 'agent' ? html`<i class="dot"></i>` : ''}Speak as Support Agent
        </button>

        ${simulated ? html`
          <div class="rail-row">
            <button class="rail-small" onClick=${toggleAutoplay}>${s.autoplay ? '❚❚ Pause' : '▶ Play all'}</button>
            <button class="rail-small" disabled=${!active || s.autoplay} onClick=${() => playNext()}>Next ▸</button>
          </div>
          <div class="rail-row">
            <button class=${'rail-small ' + (s.settings.audio ? '' : 'off')} title=${TTS.supported ? 'Read the lines aloud' : 'Speech synthesis is not available in this browser'} onClick=${() => updateSettings({ audio: !s.settings.audio })}>${s.settings.audio ? '🔊 Audio on' : '🔇 Audio off'}</button>
            <span class="rail-note center">${sc && s.callStatus !== 'idle' ? `Turn ${s.turnCount}` : ''}</span>
          </div>
          <div class="rail-note">${sc && s.callStatus !== 'idle' ? html`<b>${user.phone}</b> · ${sc.title}` : 'An AI plays the caller and another plays the agent. Pick a scenario below, or leave it random.'}</div>
          ${s.settings.audio && !TTS.supported ? html`<div class="rail-warn">No speech synthesis here; lines play silently.</div>` : ''}
          ${waitingOn ? html`<div class="rail-warn">Waiting for you to run ${waitingOn}.</div>` : ''}
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

        ${simulated ? html`
          <label class="rail-select" title="Which scenario the simulated call plays">
            <span>Scenario</span>
            <select value=${s.scenarioPick} disabled=${active} onChange=${(e) => Store.set({ scenarioPick: e.target.value })}>
              <option value="random">Random</option>
              ${AI.scenarios.map((x, i) => html`<option key=${x.id} value=${x.id}>${i + 1}. ${x.title}</option>`)}
            </select>
          </label>` : html`
          <label class="rail-select" title="Which phone number the call comes from">
            <span>Incoming number</span>
            <select value=${s.incoming} disabled=${active} onChange=${(e) => Store.set({ incoming: e.target.value })}>
              <option value="random">Random</option>
              ${D.USERS.map((u) => html`<option key=${u.id} value=${u.id}>${u.phone}</option>`)}
            </select>
          </label>`}
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

  function Tabs({ s }) {
    const tab = (id, label, badge) => html`<button class=${'tab ' + (s.tab === id ? 'on' : '')} onClick=${() => Store.set({ tab: id, unseenGuidance: id === 'guidance' ? 0 : s.unseenGuidance })}>${label}${badge ? html`<span class="tab-badge">${badge}</span>` : ''}</button>`;
    return html`<div class="tabs">${tab('guidance', 'Live Guidance', s.tab !== 'guidance' && s.unseenGuidance ? s.unseenGuidance : 0)}${tab('customer', 'Customer 360')}${tab('transcript', 'Transcript')}
      ${s.tab === 'guidance' && (s.guidance.length || s.findings.length) ? html`<button class="link tabs-action" onClick=${() => Store.set({ guidance: [], findings: [] })}>Clear guidance</button>` : ''}</div>`;
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
        ${c.source ? html`<span class="gsrc">${c.source}</span>` : ''}
      </div>`;
  }

  function Finding({ f }) {
    return html`
      <div class="gfind">
        <div class="gline">
          <span class="kw kw-find">AI conclusion:</span>
          <span class="gtext">${f.title}</span>
        </div>
        ${f.rows.length ? html`<div class="gfrows">${f.rows.map((r, i) => html`<span key=${i}><b>${r.label}:</b> ${r.value}</span>`)}</div>` : ''}
      </div>`;
  }

  function GuidanceTab({ s }) {
    const boxRef = useRef(null);
    const lastRef = useRef(null);
    const spacerRef = useRef(null);
    const byBatch = new Map();
    const group = (b) => { if (!byBatch.has(b)) byBatch.set(b, { batch: b, findings: [], cards: [] }); return byBatch.get(b); };
    s.findings.forEach((f) => group(f.batch).findings.push(f));
    s.guidance.forEach((c) => group(c.batch).cards.push(c));
    const batches = [...byBatch.values()].sort((a, b) => a.batch - b.batch);
    const latest = batches.length ? batches[batches.length - 1].batch : 0;
    const lookups = s.feed.filter((r) => r.type === 'task' && r.status === 'running');
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
    }, [latest, s.guidance.length, s.findings.length, s.aiBusy, s.aiError, lookups.length]);
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
                ${b.findings.map((f) => html`<${Finding} key=${f.id} f=${f} />`)}
                ${b.cards.map((c) => html`<${GuidanceCard} key=${c.id} c=${c} />`)}
              </div>`)
            : html`<div class="gempty">${s.callStatus === 'idle' ? 'Start a call. Only things worth your attention show up here: policy risks, facts the caller needs, offers worth making.' : 'Nothing needs your attention yet.'}</div>`}
          ${s.aiBusy && !lookups.length ? html`<div class="gbusy">GPT-5.6 Luna is updating the screen…</div>` : ''}
          ${s.aiError ? html`<div class="gerror">${s.aiError}</div>` : ''}
          <div class="gspacer" ref=${spacerRef}></div>
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
      return html`<div class="frow task single"><ul class="tsteps"><${TaskStep} st=${r} prefix="You ran" /></ul></div>`;
    }
    const waitedOn = !!(s.agentRequest && s.agentRequest.tool === r.tool);
    const heading = waitedOn ? 'Agent request:' : r.auto === 'suggested' ? 'Suggested:' : 'Run:';
    return html`
      <div class="frow task single">
        <div class="fcell">
          <div class="io-label">${heading} <span class="io-tool">${tool.description || tool.label}</span></div>
          <${Approval} tool=${tool} inputs=${r.inputs} running=${r.status === 'running'} disabled=${s.callStatus === 'idle'}
            skipLabel=${waitedOn || r.auto === 'suggested' ? 'Skip' : 'Remove'}
            onChange=${(inputs) => updateRow(r.id, { inputs, touched: true })}
            onRun=${async () => { const awaited = !!(toolWait && toolWait.tool === r.tool); await runManualRow(r.id); if (!awaited) settle(); }}
            onSkip=${() => removeRow(r)} />
        </div>
      </div>`;
  }

  function TaskStep({ task, st, prefix }) {
    const [open, setOpen] = useState(false);
    const tool = toolById(st.tool);
    if (!tool) return '';
    if (st.status === 'needs_input') {
      return html`
        <li class="tstep-approve">
          <${Approval} tool=${tool} inputs=${st.inputs} running=${false} disabled=${Store.get().callStatus === 'idle'}
            onChange=${(inputs) => updateStep(task.id, st.id, { inputs })}
            onRun=${() => resumeTask(task.id, st.id, st.inputs)}
            onSkip=${() => skipStep(task.id, st.id)} />
        </li>`;
    }
    const text = st.status === 'running' ? `${tool.message || tool.label}…` : `${prefix ? prefix + ' ' : ''}${tool.label}`;
    return html`
      <li class=${'tstep ' + st.status}>
        <span class="tdot"></span>
        <div class="tbody">
          <div class="tsline">
            <span>${text}</span>
            ${st.status === 'skipped' ? html`<span class="tskip">skipped</span>` : ''}
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

  /* Raw tool outputs stay behind each action's details; the task's conclusion shows in Live Guidance. */
  function TaskRow({ r }) {
    return html`
      <div class="frow task single">
        <div class="fcell">
          <div class="io-label">AI task: <span class="io-tool">${r.goal}</span>${r.status === 'running' ? html`<span class="dots"><i></i><i></i><i></i></span>` : ''}</div>
          <ul class="tsteps">
            ${r.steps.map((st) => html`<${TaskStep} key=${st.id} task=${r} st=${st} />`)}
            ${r.status === 'running' && !r.steps.some((st) => st.status === 'running') ? html`<li class="tstep thinking"><span class="tdot"></span><div class="tbody"><div class="tsline">Working out the next step…</div></div></li>` : ''}
            ${r.status === 'done' && !r.steps.length ? html`<li class="tstep thinking"><span class="tdot"></span><div class="tbody"><div class="tsline">No tool was called.</div></div></li>` : ''}
          </ul>
        </div>
      </div>`;
  }

  function ActionFeed({ s }) {
    const boxRef = useRef(null);
    const steps = s.feed.reduce((n, r) => n + (r.steps ? r.steps.length : 0), 0);
    useAutoScroll(boxRef, `${s.feed.length}|${steps}`);
    if (!s.feed.length) {
      return html`<div class="toolio-hint">Tool calls appear here. The assistant runs lookups and checks on its own and shows what it found. When a tool needs you, it opens here with its inputs: check them and press Execute. Inputs found in the call or the customer record are pre-filled; blank ones are yours to fill.</div>`;
    }
    return html`
      <div class="feed" ref=${boxRef}>
        ${s.feed.map((r) => (r.type === 'task' ? html`<${TaskRow} key=${r.id} r=${r} />` : html`<${ManualRow} key=${r.id} r=${r} s=${s} />`))}
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

  global.PhoneAssist = { Store, startCall, playNext, toggleAutoplay, openDraft, runManualRow, resumeTask, settle, getBestReply, askQuestion, setMode, speakAs, addLiveLine, resetAll, endCall };
})(window);
