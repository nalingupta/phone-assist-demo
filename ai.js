/* Phone Assist demo: model backend.
   1. "server": localhost (or a host) calls GPT-5.6 Luna through server.mjs.
      The browser never holds the OpenAI or ElevenLabs key.
   2. "sample": the page runs inside a claude.ai artifact viewer and uses the
      viewer's own Claude access (no API key). That host cannot call OpenAI.
   Every prompt is assembled from the files: prompts/system_prompt.md plus one
   task file (phone_assist_workflow.md, phone_assist_guidance.md,
   phone_assist_best_reply.md, chat.md or support_agent.md),
   with tools.md, kb/*.md and the customer record attached as reference.
   The simulated caller gets only caller.md and its scenarios/*.md section. */
(function (global) {
  'use strict';

  const STEP_STATUS = ['pending', 'done', 'missed'];

  const WORKFLOW_SCHEMA = {
    type: 'object',
    properties: {
      workflows: {
        type: 'array',
        description: 'Every workflow shown on screen, in order, each with all of its steps.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            steps: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, status: { type: 'string', enum: STEP_STATUS } }, required: ['label', 'status'], additionalProperties: false } }
          },
          required: ['name', 'steps'], additionalProperties: false
        }
      }
    },
    required: ['workflows'],
    additionalProperties: false
  };
  const GUIDANCE_SCHEMA = {
    type: 'object',
    properties: {
      tags: { type: 'array', items: { type: 'string' } },
      guidance: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            kind: { type: 'string', description: 'The guidance type name defined in your instructions.' },
            text: { type: 'string' },
            bullets: { type: 'array', items: { type: 'string' } },
            source: { type: 'string' }
          },
          required: ['kind', 'text', 'bullets', 'source'], additionalProperties: false
        }
      },
      tools: {
        type: 'array',
        description: 'Tools to highlight, most useful first, each with its inputs prefilled; value is "" when unknown.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            inputs: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, value: { type: 'string' } }, required: ['name', 'value'], additionalProperties: false } }
          },
          required: ['name', 'inputs'], additionalProperties: false
        }
      },
      suggestedTool: { type: 'string', description: 'Name of the one tool the agent should run right now, or "".' },
      autoTask: { type: 'string', description: 'Short goal of a task to handle now with auto-approved tools, or "".' }
    },
    required: ['tags', 'guidance', 'tools', 'suggestedTool', 'autoTask'],
    additionalProperties: false
  };
  const STEP_SCHEMA = {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['call_tool', 'finish'] },
      tool: { type: 'string', description: 'Tool to call when action is call_tool, else "".' },
      inputs: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, value: { type: 'string' } }, required: ['name', 'value'], additionalProperties: false } },
      summary: {
        type: 'object',
        description: 'The final finding when action is finish; empty strings and rows otherwise.',
        properties: {
          title: { type: 'string' },
          rows: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, value: { type: 'string' } }, required: ['label', 'value'], additionalProperties: false } },
          note: { type: 'string' }
        },
        required: ['title', 'rows', 'note'], additionalProperties: false
      }
    },
    required: ['action', 'tool', 'inputs', 'summary'],
    additionalProperties: false
  };
  const CALLER_SCHEMA = {
    type: 'object',
    properties: { say: { type: 'string' }, end_call: { type: 'boolean' } },
    required: ['say', 'end_call'], additionalProperties: false
  };
  const AGENT_SCHEMA = {
    type: 'object',
    properties: {
      say: { type: 'string' },
      tool: { type: 'string' },
      inputs: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, value: { type: 'string' } }, required: ['name', 'value'], additionalProperties: false } },
      end_call: { type: 'boolean' },
      hand_over: { type: 'boolean' }
    },
    required: ['say', 'tool', 'inputs', 'end_call', 'hand_over'], additionalProperties: false
  };

  const REPLY_SCHEMA = {
    type: 'object',
    properties: { reply: { type: 'string' }, why: { type: 'string' } },
    required: ['reply', 'why'], additionalProperties: false
  };
  const ANSWER_SCHEMA = {
    type: 'object',
    properties: { answer: { type: 'string' }, source: { type: 'string' } },
    required: ['answer', 'source'], additionalProperties: false
  };
  const PING_SCHEMA = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false };

  /* ---------------- tools.md ---------------- */
  const LABEL_WORDS = { otp: 'OTP', rx: 'Rx', id: 'ID', sms: 'SMS', url: 'URL', dob: 'DOB' };
  function labelFor(name) {
    const words = String(name).replace(/([a-z])([A-Z])/g, '$1_$2').split('_').filter(Boolean);
    return words.map((w, i) => LABEL_WORDS[w.toLowerCase()] || (i === 0 ? w[0].toUpperCase() + w.slice(1) : w.toLowerCase())).join(' ');
  }
  const toolLabel = (name) => String(name).split('_').filter(Boolean).map((w) => LABEL_WORDS[w] || (w[0].toUpperCase() + w.slice(1))).join(' ');

  const stripComments = (text) => String(text || '').replace(/<!--[\s\S]*?-->/g, '').trim();

  function jsonObjectAt(text, start) {
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) return { raw: text.slice(start, i + 1), end: i + 1 };
    }
    return null;
  }

  function withDemoMode(obj) {
    if (!obj || typeof obj !== 'object') return { demo_mode: true };
    if (Array.isArray(obj)) return { demo_mode: true, result: obj };
    const rest = Object.assign({}, obj);
    delete rest.demo_mode;
    return Object.assign({ demo_mode: true }, rest);
  }

  /* Blocks look like: tool_name(\n  desc="...", input="a, b", message="...", dynamic=true\n) -> { example JSON } */
  function parseTools(source) {
    const text = stripComments(source);
    const header = /^([A-Za-z_][A-Za-z0-9_]*)\(\s*\n([\s\S]*?)^\)\s*->\s*/gm;
    const tools = [];
    let m;
    while ((m = header.exec(text))) {
      const args = {};
      for (const line of m[2].split('\n')) {
        const a = line.match(/^\s*(\w+)\s*=\s*("(?:[^"\\]|\\.)*"|true|false)\s*,?\s*$/);
        if (!a) continue;
        args[a[1]] = a[2] === 'true' ? true : a[2] === 'false' ? false : JSON.parse(a[2]);
      }
      const out = text[header.lastIndex] === '{' ? jsonObjectAt(text, header.lastIndex) : null;
      let example = null;
      if (out) {
        try { example = JSON.parse(out.raw); } catch (e) { example = null; }
        header.lastIndex = out.end;
      }
      tools.push({
        id: m[1],
        label: toolLabel(m[1]),
        description: String(args.desc || ''),
        message: String(args.message || ''),
        dynamic: args.dynamic !== false,
        autoApproved: args.auto_approved === true,
        inputs: String(args.input || '').split(',').map((s) => s.trim()).filter(Boolean).map((raw) => {
          const optional = raw.endsWith('?');
          const key = optional ? raw.slice(0, -1).trim() : raw;
          return { key, label: labelFor(key), optional };
        }),
        example: withDemoMode(example)
      });
    }
    return tools;
  }

  /* Strict JSON schema shaped like a tool's example output, so a simulated result keeps its keys. */
  function schemaFor(value) {
    if (Array.isArray(value)) return { type: 'array', items: value.length ? schemaFor(value[0]) : { type: 'string' } };
    if (value && typeof value === 'object') {
      const keys = Object.keys(value);
      const properties = {};
      keys.forEach((k) => { properties[k] = schemaFor(value[k]); });
      return { type: 'object', properties, required: keys, additionalProperties: false };
    }
    if (typeof value === 'boolean') return { type: 'boolean' };
    if (typeof value === 'number') return { type: 'number' };
    return { type: 'string' };
  }

  /* ---------------- prompt pieces ---------------- */
  /* The demo's fixed "today", so every prompt and the mock records agree on dates. */
  const DEMO_TODAY = "# Today\nToday is Thursday, October 22, 2026 (10/22/2026). The call is happening now, in the early afternoon.";

  function customerText(user) {
    if (!user) return 'No customer record selected.';
    const rx = user.prescriptions.map((p) => `  - Rx ${p.rx}: ${p.drug}, ${p.sig}, qty ${p.qty}/${p.days} days, ${p.refills} refills left, last fill ${p.lastFill}, prescriber ${p.prescriber}. Status: ${p.status}`).join('\n');
    const imm = user.immunizations.length ? user.immunizations.map((i) => `${i.vaccine} on ${i.date}`).join('; ') : 'none on file';
    const past = user.interactions.map((i) => `${i.date} (${i.channel}): ${i.summary}`).join('; ');
    return [
      `Name: ${user.name}; DOB ${user.dob}; phone ${user.phone}; email ${user.email}; preferred contact ${user.preferredContact}.`,
      `Preferred store: ${user.store.name} ${user.store.id}, ${user.store.address}, hours ${user.store.hours}.`,
      `Insurance: ${user.insurance.plan}, member ${user.insurance.memberId}, status ${user.insurance.status}, copay ${user.insurance.copay30} per 30 days or ${user.insurance.copay90} per 90 days.`,
      `Prescriptions (all on file at ${user.store.name} ${user.store.id}):\n${rx}`,
      `Allergies: ${user.allergies.join(', ')}. Immunizations: ${imm}.`,
      `Previous interactions: ${past || 'none'}.`,
      `Notes: ${user.notes}`
    ].join('\n');
  }

  function fmtTime(t) {
    const s = Math.max(0, Math.round(t || 0));
    return `[${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}]`;
  }

  function transcriptText(state) {
    if (!state.transcript.length) return '(no lines yet)';
    return state.transcript.map((l) => {
      const who = l.speaker === 'caller' ? 'CALLER' : l.speaker === 'agent' ? 'AGENT' : 'TOOL';
      return `${fmtTime(l.t)} ${who}: ${l.text}`;
    }).join('\n');
  }

  function toolRunsText(state) {
    const runs = state.toolRuns || [];
    if (!runs.length) return 'none';
    return runs.map((r) => `${r.tool}(${JSON.stringify(r.inputs || {})}) -> ${JSON.stringify(r.output || {})}`).join('\n');
  }

  function screenText(state) {
    const wf = state.groups.length
      ? state.groups.map((g) => `- ${g.title}: ${g.steps.map((s, i) => `${i + 1}. ${s.label} [${s.status}]`).join('; ')}`).join('\n')
      : '- none yet';
    const tasks = (state.feed || []).filter((r) => r.type === 'task');
    const taskText = tasks.length
      ? tasks.map((t) => `- "${t.goal}" [${t.status}]${t.summary && t.summary.title ? `: ${t.summary.title}` : ''}`).join('\n')
      : '- none yet';
    return `Workflows on screen:\n${wf}\nTags: ${state.tags.join(', ') || 'none'}.\nTasks you already started:\n${taskText}`;
  }

  function stepsText(task) {
    const done = task.steps.filter((st) => st.status === 'done' || st.status === 'skipped');
    return done.length ? done.map((st) => `${st.tool}(${JSON.stringify(st.inputs)}) -> ${st.status === 'skipped' ? 'not run: the human agent skipped it' : JSON.stringify(st.output)}`).join('\n') : 'none yet';
  }

  function kbText() {
    const kb = AI.files.kb;
    return kb.length ? kb.map((k) => `## ${k.file}\n${stripComments(k.text)}`).join('\n\n') : '(no knowledge-base files)';
  }

  /* system_prompt.md + one personality file, then the reference material. */
  function buildSystem(personality, user) {
    const p = AI.files.prompts;
    return [
      DEMO_TODAY,
      stripComments(p.system_prompt),
      stripComments(p[personality]),
      `# Tools (tools.md)\n${stripComments(AI.files.tools) || '(no tools)'}`,
      `# Knowledge base (kb/)\n${kbText()}`,
      `# Customer record (already looked up for this caller)\n${customerText(user)}`
    ].filter(Boolean).join('\n\n---\n\n');
  }

  /* ---------------- backends ---------------- */
  const EMPTY_FILES = { prompts: {}, tools: '', kb: [], scenarios: [] };

  /* scenarios/*.md: "# Title", "customer: <id>", then "## Caller" and "## Support agent" sections. */
  function parseScenario({ file, text }) {
    const body = stripComments(text || '');
    const customer = (body.match(/^customer:\s*(\S+)/m) || [])[1];
    if (!customer) return null;
    const section = (name) => {
      const m = body.match(new RegExp(`^##\\s+${name}\\s*$([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, 'mi'));
      return m ? m[1].trim() : '';
    };
    return {
      id: file.replace(/\.md$/, ''),
      file,
      title: ((body.match(/^#\s+(.+)$/m) || [])[1] || file).trim(),
      customer,
      caller: section('Caller'),
      agent: section('Support agent')
    };
  }

  /* What the caller hears: spoken lines only, from the caller's point of view. */
  function callerTranscript(state) {
    const lines = state.transcript.filter((l) => l.speaker === 'caller' || l.speaker === 'agent');
    return lines.length ? lines.map((l) => `${l.speaker === 'caller' ? 'YOU' : 'AGENT'}: ${l.text}`).join('\n') : '(the call has just connected)';
  }

  /* Messages the human-only tools sent to the caller's phone (passcodes, confirmations). */
  function phoneTexts(state) {
    const sent = (state.toolRuns || []).filter((r) => (r.tool === 'send_otp' || r.tool === 'send_confirmation') && r.output);
    if (!sent.length) return '(no texts yet)';
    return sent.map((r) => {
      const o = r.output;
      if (r.tool === 'send_otp') return `- Walgreens: your one-time passcode is ${o.code_demo_only || o.code || '(unreadable)'}.`;
      return `- ${o.channel || 'Message'}: ${o.message || 'Walgreens confirmation'}`;
    }).join('\n');
  }

  const AI = {
    mode: 'none',          // 'server' | 'sample' | 'none'
    sample: null,
    server: null,          // /api/config answer when a demo server is behind this page
    files: EMPTY_FILES,    // prompts/*.md, tools.md and kb/*.md
    tools: [],             // tools parsed from tools.md
    scenarios: [],         // scenarios parsed from scenarios/*.md
    settings: {},
    listeners: new Set(),

    onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
    emit() { this.listeners.forEach((fn) => fn(this.status())); },

    configure(settings) {
      this.settings = settings || {};
      this.recompute();
    },

    recompute() {
      if (this.server && this.server.openai) this.mode = 'server';
      else if (this.sample) this.mode = 'sample';
      else this.mode = 'none';
      this.emit();
    },

    setFiles(files) {
      this.files = {
        prompts: (files && files.prompts) || {},
        tools: (files && files.tools) || '',
        kb: Array.isArray(files && files.kb) ? files.kb : [],
        scenarios: Array.isArray(files && files.scenarios) ? files.scenarios : []
      };
      this.tools = parseTools(this.files.tools);
      this.scenarios = this.files.scenarios.map(parseScenario).filter(Boolean);
    },

    async init(settings) {
      this.settings = settings || {};
      if (global.PROMPT_FILES) this.setFiles(global.PROMPT_FILES);   // inlined by build-artifact.sh
      this.recompute();
      if (!global.claude && /^https?:/.test(location.protocol)) {
        try {
          const r = await fetch('api/config', { cache: 'no-store' });
          if (r.ok) { const cfg = await r.json(); if (cfg && typeof cfg === 'object') this.server = cfg; }
        } catch (e) { this.server = null; }
        if (this.server) {
          try {
            const r = await fetch('api/prompts', { cache: 'no-store' });
            if (r.ok) this.setFiles(await r.json());
          } catch (e) { /* keep whatever was inlined */ }
        }
        this.recompute();
      }
      if (global.claude && typeof global.claude.use === 'function') {
        try {
          const s = await global.claude.use('sample');
          this.sample = s || null;
        } catch (e) {
          this.sample = null;
        }
        this.recompute();
      }
    },

    available() { return this.mode !== 'none'; },

    hasVoice() { return !!(this.server && this.server.elevenlabs); },

    status() {
      if (this.mode === 'server') {
        const model = this.server.model === 'gpt-5.6-luna' ? 'GPT-5.6 Luna' : (this.server.model || 'GPT-5.6 Luna');
        return { mode: 'server', label: `${model} connected` + (this.server.elevenlabs ? ' · ElevenLabs voices' : ' · browser voices') + (this.server.build && this.server.build.commit ? ` · build ${this.server.build.commit}` : '') };
      }
      if (this.mode === 'sample') return { mode: 'sample', label: 'Claude connected through this page (no key needed)' };
      if (global.claude) return { mode: 'none', label: 'Claude not available in this viewer; the call plays without AI' };
      if (this.server) return { mode: 'none', label: 'Server has no OpenAI key yet; the call plays without AI' };
      return { mode: 'none', label: 'No AI service behind this page; the call plays without AI' };
    },

    async json({ system, user, schema, tier, effort, maxTokens, signal }) {
      if (this.mode === 'server') {
        let r;
        try {
          r = await fetch('api/llm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ system, user, schema, maxTokens, effort: effort || this.settings.effort || 'low' }), signal });
        } catch (e) { throw new Error('Could not reach the demo server.'); }
        const data = await r.json().catch(() => null);
        if (!r.ok) throw new Error((data && data.error) || `Server error ${r.status}`);
        return data.result;
      }
      if (this.mode === 'sample') {
        const prompt = `${system}\n\n---\n\n${user}\n\nReply with only one JSON object that matches this JSON Schema, no prose and no code fence:\n${JSON.stringify(schema)}`;
        try {
          return await this.sample.json(prompt, { modelTier: tier || this.settings.tier || 'quick', cache: false, signal });
        } catch (e) {
          throw new Error(sampleErrorText(e));
        }
      }
      throw new Error('No AI model is connected.');
    },

    /* Runs at the same time as guidance(): only the workflow panel. */
    workflow(state, user) {
      const prompt = [
        `Call transcript so far (oldest first, [mm:ss] SPEAKER):\n${transcriptText(state)}`,
        `Tool calls so far (name(inputs) -> output):\n${toolRunsText(state)}`,
        `Workflow panel before this update:\n${screenText(state)}`,
        'Update the workflow panel for this moment. Return the JSON object.'
      ].join('\n\n');
      return this.json({ system: buildSystem('phone_assist_workflow', user), user: prompt, schema: WORKFLOW_SCHEMA, maxTokens: 4000 });
    },

    /* Runs at the same time as workflow(): tags, guidance cards, tools and AI tasks. */
    guidance(state, user) {
      const recent = (state.guidance || []).slice(-10);
      const shown = recent.map((c, i) => `${fmtTime(c.t)} ${c.kind}: ${c.text}${i === recent.length - 1 ? '   <- newest card, still on screen' : ''}`).join('\n') || '(none yet)';
      const prompt = [
        `Call transcript so far (oldest first, [mm:ss] SPEAKER):\n${transcriptText(state)}`,
        `Tool calls so far (name(inputs) -> output):\n${toolRunsText(state)}`,
        `Screen before this update:\n${screenText(state)}`,
        `Guidance already shown (oldest first, [mm:ss] since the call started, same clock as the transcript):\n${shown}`,
        'Update the guidance and tools for this moment. Return the JSON object.'
      ].join('\n\n');
      return this.json({ system: buildSystem('phone_assist_guidance', user), user: prompt, schema: GUIDANCE_SCHEMA, maxTokens: 6000 });
    },

    /* Simulated call: the caller's next line. Sees only its scenario, what was said and its phone's texts. */
    callerTurn(state, scenario) {
      const system = [DEMO_TODAY, stripComments(this.files.prompts.caller || ''), `# Your scenario\n${scenario.caller}`].join('\n\n---\n\n');
      const prompt = [
        `The call so far:\n${callerTranscript(state)}`,
        `Texts on your phone:\n${phoneTexts(state)}`,
        'Say your next line. Return the JSON object.'
      ].join('\n\n');
      return this.json({ system, user: prompt, schema: CALLER_SCHEMA, maxTokens: 1500 });
    },

    /* Simulated call: the support agent's next line, driven by the guidance on screen. */
    agentTurn(state, user, scenario) {
      const lastAgent = [...state.transcript].reverse().find((l) => l.speaker === 'agent');
      const card = (state.guidance || [])[state.guidance.length - 1];
      const cardText = card
        ? `${fmtTime(card.t)} ${card.kind}: ${card.text}${(card.bullets || []).length ? `\n${card.bullets.map((b) => `  - ${b}`).join('\n')}` : ''}${card.source ? `\n(source: ${card.source})` : ''}\n${!lastAgent || card.t >= lastAgent.t ? 'This card appeared since your last line: act on it.' : 'This card was already on screen before your last line.'}`
        : '(no card on screen)';
      const humanTools = this.tools.filter((t) => !t.autoApproved).map((t) => `- ${t.id}(${t.inputs.map((f) => f.key + (f.optional ? '?' : '')).join(', ')}): ${t.description}`).join('\n');
      const suggested = state.suggestedTool ? `The copilot suggests running ${state.suggestedTool} now.` : 'No tool is suggested right now.';
      const prompt = [
        `Call transcript so far (oldest first, [mm:ss] SPEAKER):\n${transcriptText(state)}`,
        `Tool calls so far (name(inputs) -> output):\n${toolRunsText(state)}`,
        `Your screen:\n${screenText(state)}`,
        `Earlier guidance this call (oldest first, background only):\n${(state.guidance || []).slice(-6, -1).map((c) => `${fmtTime(c.t)} ${c.kind}: ${c.text}`).join('\n') || '(none)'}`,
        `Live Guidance card on screen:\n${cardText}`,
        `Tools only you can run:\n${humanTools}\n${suggested}`,
        `Your scenario notes:\n${scenario.agent || '(none)'}`,
        state.callerDone
          ? 'The caller has said goodbye: this is your closing line. Return the JSON object.'
          : state.agentFollowUp
            ? 'You still have the floor: the caller has not spoken since your last line, and new lookup results or a Caution arrived while you were working. Continue your own turn now and deliver what is new (do not greet again). Never repeat or reword a question or statement from your last line; if the new results and card add nothing you have not already said, return say "" and the caller will speak. Return the JSON object.'
            : 'Say your next line. Return the JSON object.'
      ].join('\n\n');
      return this.json({ system: buildSystem('support_agent', user), user: prompt, schema: AGENT_SCHEMA, maxTokens: 2000 });
    },

    bestReply(state, user) {
      const prompt = `Call transcript so far:\n${transcriptText(state)}\n\nTool calls so far:\n${toolRunsText(state)}\n\n${screenText(state)}\n\nWrite the agent's best next reply. Return the JSON object.`;
      return this.json({ system: buildSystem('phone_assist_best_reply', user), user: prompt, schema: REPLY_SCHEMA, maxTokens: 2000 });
    },

    ask(state, user, question) {
      const prompt = `Call transcript so far:\n${transcriptText(state)}\n\nTool calls so far:\n${toolRunsText(state)}\n\n${screenText(state)}\n\nThe agent asks: ${question}\n\nReturn the JSON object.`;
      return this.json({ system: buildSystem('chat', user), user: prompt, schema: ANSWER_SCHEMA, maxTokens: 2000 });
    },

    /* One step of a task the phone assist runs on its own: the next tool call, or the final summary. */
    nextStep(state, user, task, mustFinish) {
      const allowed = this.tools.filter((t) => t.autoApproved).map((t) => t.id).join(', ') || 'none';
      const humanOnly = this.tools.filter((t) => !t.autoApproved).map((t) => t.id).join(', ') || 'none';
      const prompt = [
        `You are running this task on your own: ${task.goal}`,
        `Tools you may run on your own (auto_approved=true): ${allowed}\nTools only the human agent may run: ${humanOnly}\nNo other tools exist.`,
        `Tool calls so far in this task:\n${stepsText(task)}`,
        `Call transcript so far:\n${transcriptText(state)}`,
        `Earlier tool calls in this call:\n${toolRunsText(state)}`,
        mustFinish
          ? 'Stop now. Return action "finish" with the summary of what you found.'
          : 'Return the next tool call (action "call_tool", the tool and its inputs, "" for an input you do not know), or action "finish" with the summary once the task is answered.'
      ].join('\n\n');
      return this.json({ system: buildSystem('phone_assist_guidance', user), user: prompt, schema: STEP_SCHEMA, maxTokens: 3000 });
    },

    /* Returns { output, simulated, fallback?, error? }. The example output is the fallback. */
    async simulateTool(tool, inputs, state, user) {
      if (!tool.dynamic) return { output: tool.example, simulated: false };
      if (!this.available()) return { output: tool.example, simulated: false, fallback: true, error: 'No AI model is connected.' };
      const prompt = [
        `Simulate this tool call now.\nTool: ${tool.id}\nDescription: ${tool.description}\nInputs given: ${JSON.stringify(inputs || {})}`,
        `Example output (the format to follow):\n${JSON.stringify(tool.example, null, 2)}`,
        `Call transcript so far:\n${transcriptText(state)}`,
        `Earlier tool calls in this call:\n${toolRunsText(state)}`,
        'Return the JSON object this tool returns.'
      ].join('\n\n');
      try {
        const out = await this.json({ system: buildSystem('phone_assist_guidance', user), user: prompt, schema: schemaFor(tool.example), maxTokens: 2000 });
        return { output: withDemoMode(out), simulated: true };
      } catch (e) {
        return { output: tool.example, simulated: false, fallback: true, error: e.message || String(e) };
      }
    },

    ping() {
      return this.json({ system: 'You answer connectivity checks.', user: 'Reply with the JSON object {"ok": true}.', schema: PING_SCHEMA, maxTokens: 500 });
    }
  };

  function sampleErrorText(e) {
    const code = e && e.code;
    switch (code) {
      case 'not_granted': return 'Claude access was not allowed for this page.';
      case 'rate_limited': return 'Claude is rate limited right now; try again in a moment.';
      case 'invalid_json': return 'Claude returned something that was not JSON; try again.';
      case 'cancelled': return 'Cancelled.';
      case 'refused': return 'Claude declined this request.';
      default: return (e && e.message) ? e.message : 'Claude request failed.';
    }
  }

  global.AI = AI;
})(window);
