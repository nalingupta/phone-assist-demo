/* Phone Assist demo: model backend.
   1. "server": localhost (or a host) calls GPT-5.6 Luna through server.mjs.
      The browser never holds the OpenAI or ElevenLabs key.
   2. "sample": the page runs inside a claude.ai artifact viewer and uses the
      viewer's own Claude access (no API key). That host cannot call OpenAI.
   Every prompt is assembled from the files: prompts/system_prompt.md plus one
   personality file (phone_assist.md, phone_assist_best_reply.md or chat.md),
   with tools.md, kb/*.md and the customer record attached as reference. */
(function (global) {
  'use strict';

  const STEP_STATUS = ['pending', 'done', 'missed'];
  const GUIDANCE_KINDS = ['say', 'ask', 'tell', 'info', 'do', 'recommendation', 'caution'];

  const ANALYSIS_SCHEMA = {
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
      },
      tags: { type: 'array', items: { type: 'string' } },
      guidance: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: GUIDANCE_KINDS },
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
      suggestedTool: { type: 'string', description: 'Name of the one tool to run right now, or "".' }
    },
    required: ['workflows', 'tags', 'guidance', 'tools', 'suggestedTool'],
    additionalProperties: false
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
        inputs: String(args.input || '').split(',').map((s) => s.trim()).filter(Boolean).map((key) => ({ key, label: labelFor(key) })),
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
  function customerText(user) {
    if (!user) return 'No customer record selected.';
    const rx = user.prescriptions.map((p) => `  - Rx ${p.rx}: ${p.drug}, ${p.sig}, qty ${p.qty}/${p.days} days, ${p.refills} refills left, last fill ${p.lastFill}, prescriber ${p.prescriber}. Status: ${p.status}`).join('\n');
    const imm = user.immunizations.length ? user.immunizations.map((i) => `${i.vaccine} on ${i.date}`).join('; ') : 'none on file';
    const past = user.interactions.map((i) => `${i.date} (${i.channel}): ${i.summary}`).join('; ');
    return [
      `Name: ${user.name}; DOB ${user.dob}; phone ${user.phone}; email ${user.email}; preferred contact ${user.preferredContact}.`,
      `Preferred store: ${user.store.name} ${user.store.id}, ${user.store.address}, hours ${user.store.hours}.`,
      `Insurance: ${user.insurance.plan}, member ${user.insurance.memberId}, status ${user.insurance.status}, copay ${user.insurance.copay30} per 30 days or ${user.insurance.copay90} per 90 days.`,
      `Prescriptions:\n${rx}`,
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
    return `Workflows on screen:\n${wf}\nTags: ${state.tags.join(', ') || 'none'}.`;
  }

  function kbText() {
    const kb = AI.files.kb;
    return kb.length ? kb.map((k) => `## ${k.file}\n${stripComments(k.text)}`).join('\n\n') : '(no knowledge-base files)';
  }

  /* system_prompt.md + one personality file, then the reference material. */
  function buildSystem(personality, user) {
    const p = AI.files.prompts;
    return [
      stripComments(p.system_prompt),
      stripComments(p[personality]),
      `# Tools (tools.md)\n${stripComments(AI.files.tools) || '(no tools)'}`,
      `# Knowledge base (kb/)\n${kbText()}`,
      `# Customer record (already looked up for this caller)\n${customerText(user)}`
    ].filter(Boolean).join('\n\n---\n\n');
  }

  /* ---------------- backends ---------------- */
  const EMPTY_FILES = { prompts: {}, tools: '', kb: [] };

  const AI = {
    mode: 'none',          // 'server' | 'sample' | 'none'
    sample: null,
    server: null,          // /api/config answer when a demo server is behind this page
    files: EMPTY_FILES,    // prompts/*.md, tools.md and kb/*.md
    tools: [],             // tools parsed from tools.md
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
        kb: Array.isArray(files && files.kb) ? files.kb : []
      };
      this.tools = parseTools(this.files.tools);
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

    analyze(state, user) {
      const shown = (state.guidance || []).slice(-8).map((c) => `- [${c.kind}] ${c.text}`).join('\n') || '- none';
      const prompt = [
        `Call transcript so far (oldest first, [mm:ss] SPEAKER):\n${transcriptText(state)}`,
        `Tool calls so far (name(inputs) -> output):\n${toolRunsText(state)}`,
        `Screen before this update:\n${screenText(state)}`,
        `Cards already on screen (do not repeat them):\n${shown}`,
        'Update the screen for this moment. Return the JSON object.'
      ].join('\n\n');
      return this.json({ system: buildSystem('phone_assist', user), user: prompt, schema: ANALYSIS_SCHEMA, maxTokens: 8000 });
    },

    bestReply(state, user) {
      const prompt = `Call transcript so far:\n${transcriptText(state)}\n\nTool calls so far:\n${toolRunsText(state)}\n\n${screenText(state)}\n\nWrite the agent's best next reply. Return the JSON object.`;
      return this.json({ system: buildSystem('phone_assist_best_reply', user), user: prompt, schema: REPLY_SCHEMA, maxTokens: 2000 });
    },

    ask(state, user, question) {
      const prompt = `Call transcript so far:\n${transcriptText(state)}\n\nTool calls so far:\n${toolRunsText(state)}\n\n${screenText(state)}\n\nThe agent asks: ${question}\n\nReturn the JSON object.`;
      return this.json({ system: buildSystem('chat', user), user: prompt, schema: ANSWER_SCHEMA, maxTokens: 2000 });
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
        const out = await this.json({ system: buildSystem('phone_assist', user), user: prompt, schema: schemaFor(tool.example), maxTokens: 2000 });
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

  AI.GUIDANCE_KINDS = GUIDANCE_KINDS;
  global.AI = AI;
})(window);
