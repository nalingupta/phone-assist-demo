/* Phone Assist demo: model backend.
   1. "server": localhost (or a host) calls GPT-5.6 Luna through server.mjs.
      The browser never holds the OpenAI or ElevenLabs key.
   2. "sample": the page runs inside a claude.ai artifact viewer and uses the
      viewer's own Claude access (no API key). That host cannot call OpenAI.
   If neither is available the demo still runs on scripted deltas. */
(function (global) {
  'use strict';
  const D = global.DEMO;

  const ANALYSIS_SCHEMA = {
    type: 'object',
    properties: {
      activeGroups: { type: 'array', items: { type: 'string' } },
      customGroups: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' }, title: { type: 'string' },
            steps: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, label: { type: 'string' }, status: { type: 'string', enum: ['pending', 'done', 'missed'] } }, required: ['id', 'label', 'status'], additionalProperties: false } }
          },
          required: ['id', 'title', 'steps'], additionalProperties: false
        }
      },
      steps: {
        type: 'array',
        items: {
          type: 'object',
          properties: { id: { type: 'string' }, status: { type: 'string', enum: ['pending', 'done', 'missed'] } },
          required: ['id', 'status'], additionalProperties: false
        }
      },
      tags: { type: 'array', items: { type: 'string' } },
      guidance: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['say', 'ask', 'tell', 'info', 'do', 'recommendation', 'caution'] },
            text: { type: 'string' },
            bullets: { type: 'array', items: { type: 'string' } },
            source: { type: 'string' }
          },
          required: ['kind', 'text', 'bullets', 'source'], additionalProperties: false
        }
      },
      tools: { type: 'array', items: { type: 'string' } },
      suggestedTool: { type: 'string' }
    },
    required: ['activeGroups', 'customGroups', 'steps', 'tags', 'guidance', 'tools', 'suggestedTool'],
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

  /* ---------------- prompt pieces ---------------- */
  function catalogText() {
    const groups = D.SOP.map((g) => {
      const steps = g.steps.map((s) => `    - ${s.id}: ${s.label}`).join('\n');
      return `- ${g.id} "${g.title}"${g.always ? ' (always active)' : ''}. Trigger: ${g.when}\n${steps}`;
    }).join('\n');
    const tools = D.TOOLS.map((t) => `- ${t.id} "${t.label}": ${t.description}`).join('\n');
    const kb = D.KB.map((k) => `### ${k.title}\n${k.text}`).join('\n\n');
    return { groups, tools, kb };
  }

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

  function stateText(state) {
    const active = state.groups.filter((g) => g.active).map((g) => g.id).join(', ');
    const steps = state.groups.filter((g) => g.active).flatMap((g) => g.steps.map((s) => `${s.id}=${s.status}`)).join(', ');
    return `Active groups: ${active || 'none'}. Step statuses: ${steps || 'none'}. Tags: ${state.tags.join(', ') || 'none'}.`;
  }

  const TEMPLATES = { analysis: null, best_reply: null, ask: null };   // filled from prompts/*.md when reachable

  function fill(template, user) {
    const c = catalogText();
    return template
      .replace(/\{\{groups\}\}/g, c.groups)
      .replace(/\{\{tags\}\}/g, D.TAGS.join(', '))
      .replace(/\{\{tools\}\}/g, c.tools)
      .replace(/\{\{kb\}\}/g, c.kb)
      .replace(/\{\{customer\}\}/g, customerText(user));
  }

  const DEFAULT_TEMPLATES = {
    analysis: `You are the real-time Phone Assist analyst for a Walgreens pharmacy customer-support desk (a product demo with mock data). A human AGENT is on a live phone call with a CALLER. You read the transcript and keep the agent's screen current. Return one JSON object with keys activeGroups, customGroups, steps, tags, guidance, tools, suggestedTool. The screen starts blank; groups appear from the conversation; a step is done only after the agent performed it; guidance is at most one short card per event and usually none.

# Workflow groups and steps
{{groups}}

# Tag vocabulary
{{tags}}

# Tools
{{tools}}

# Knowledge base
{{kb}}

# Customer record
{{customer}}`,
    best_reply: `You are the Phone Assist copilot for a pharmacy support AGENT on a live call. Write the single best next thing for the AGENT to say: 1 to 3 sentences, consistent with the knowledge base and customer record. Return JSON {reply, why}.

# Knowledge base
{{kb}}

# Customer record
{{customer}}`,
    ask: `You are the Phone Assist copilot for a pharmacy support AGENT. Answer the agent's question in under 60 words from the knowledge base, the customer record and the call. Return JSON {answer, source}.

# Knowledge base
{{kb}}

# Customer record
{{customer}}`
  };

  async function loadTemplates() {
    await Promise.all(Object.keys(TEMPLATES).map(async (name) => {
      try {
        const r = await fetch(`prompts/${name}.md`, { cache: 'no-cache' });
        if (r.ok) { const t = await r.text(); if (t.trim()) TEMPLATES[name] = t; }
      } catch (e) { /* file:// or offline: keep the embedded default */ }
    }));
  }

  const analysisSystem = (user) => fill(TEMPLATES.analysis || DEFAULT_TEMPLATES.analysis, user);
  const replySystem = (user) => fill(TEMPLATES.best_reply || DEFAULT_TEMPLATES.best_reply, user);
  const askSystem = (user) => fill(TEMPLATES.ask || DEFAULT_TEMPLATES.ask, user);

  /* ---------------- backends ---------------- */
  const AI = {
    mode: 'none',          // 'server' | 'sample' | 'none'
    sample: null,
    server: null,          // /api/config answer when a demo server is behind this page
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

    async init(settings) {
      this.settings = settings || {};
      this.recompute();
      loadTemplates();
      if (!global.claude && /^https?:/.test(location.protocol)) {
        try {
          const r = await fetch('api/config', { cache: 'no-store' });
          if (r.ok) { const cfg = await r.json(); if (cfg && typeof cfg === 'object') this.server = cfg; }
        } catch (e) { this.server = null; }
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
      if (global.claude) return { mode: 'none', label: 'Claude not available in this viewer; scripted playback only' };
      if (this.server) return { mode: 'none', label: 'Server has no OpenAI key yet; scripted playback only' };
      return { mode: 'none', label: 'No AI service behind this page; scripted playback only' };
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
      throw new Error('OpenAI is not connected on this server.');
    },

    analyze(state, user) {
      const shown = (state.guidance || []).slice(-8).map((c) => `- [${c.kind}] ${c.text}`).join('\n') || '- none';
      const prompt = `Call transcript so far (oldest first, [mm:ss] SPEAKER):\n${transcriptText(state)}\n\nScreen state before this update: ${stateText(state)}\n\nCards already on screen (do not repeat them):\n${shown}\n\nUpdate the screen for this moment. Return the JSON object.`;
      return this.json({ system: analysisSystem(user), user: prompt, schema: ANALYSIS_SCHEMA, maxTokens: 8000 });
    },

    bestReply(state, user) {
      const prompt = `Call transcript so far:\n${transcriptText(state)}\n\n${stateText(state)}\n\nWrite the agent's best next reply. Return the JSON object.`;
      return this.json({ system: replySystem(user), user: prompt, schema: REPLY_SCHEMA, maxTokens: 2000 });
    },

    ask(state, user, question) {
      const prompt = `Call transcript so far:\n${transcriptText(state)}\n\n${stateText(state)}\n\nThe agent asks: ${question}\n\nReturn the JSON object.`;
      return this.json({ system: askSystem(user), user: prompt, schema: ANSWER_SCHEMA, maxTokens: 2000 });
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
