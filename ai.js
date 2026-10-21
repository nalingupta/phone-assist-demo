/* Phone Assist demo: Claude backend.
   Two ways to reach Claude, picked automatically:
   1. "sample": the page runs inside a claude.ai artifact viewer and uses the
      viewer's own Claude access (no API key).
   2. "direct": the page runs locally and calls the Claude API with the key the
      user saved in Settings (header anthropic-dangerous-direct-browser-access).
   If neither is available the demo still runs on scripted deltas. */
(function (global) {
  'use strict';
  const D = global.DEMO;

  const ANALYSIS_SCHEMA = {
    type: 'object',
    properties: {
      activeGroups: { type: 'array', items: { type: 'string' } },
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
            kind: { type: 'string', enum: ['ask', 'tell', 'info', 'do', 'recommendation', 'caution'] },
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
    required: ['activeGroups', 'steps', 'tags', 'guidance', 'tools', 'suggestedTool'],
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

  function analysisSystem(user) {
    const c = catalogText();
    return `You are the real-time Phone Assist analyst for a Walgreens pharmacy customer-support desk (a product demo with mock data). A human AGENT is on a live phone call with a CALLER. You read the transcript and keep the agent's screen current. You never speak to the caller.

# Output
Return one JSON object with exactly these keys:
- activeGroups: ids of the workflow groups that apply to this call so far. Always include "verification" and "wrapup".
- steps: one {id, status} for EVERY step of every active group. status is "done", "pending" or "missed".
- tags: tag strings from the vocabulary that describe the call so far. Add at most two custom tags (two or three words) only when nothing in the vocabulary fits.
- guidance: 0, 1 or at most 2 cards for THIS moment, each {kind, text, bullets, source}. One event (the latest utterance or tool result) gets at most ONE card: put several points into bullets (each under 15 words) under a one-line text. An empty array is the normal answer when nothing new deserves attention.
- tools: 3 to 6 tool ids the agent is most likely to need next, most useful first.
- suggestedTool: the one tool id the agent should run right now because the situation calls for it (a verification step is due, a claim needs checking, a slot needs booking), or "" when none.

# Step status rules
- "done" only AFTER the agent actually performed the step: a TOOL line shows it ran, or the agent's own words show it was said. A tool run completes its matching step (Send OTP completes "Send one-time passcode", Check Insurance completes "Check refill and claim status", Page Pharmacist completes the warm-transfer, Log Summary completes the summary, and so on). Never mark a step done because the caller supplied information the agent has not acted on yet: the caller giving a date of birth does not complete "Confirm name and date of birth" until the agent confirms or verifies it. A caller's explicit confirmation (the store, the time, a choice) does complete a "confirm" step.
- "missed" when the agent has moved on to a later step in the same group, or to a later group, without doing this one. Example: rerunning a claim before reading the rejection reason back to the caller. If the agent does it later, it becomes "done".
- otherwise "pending".
- Activate a group the moment its trigger appears and keep it active for the rest of the call. Never deactivate a group.

# Guidance cards: only what is worth the agent's attention
The agent is trained. Do not restate what any trained agent would do anyway (greeting, asking for date of birth, saying thank you, confirming the obvious), and never write lines for the agent to say verbatim; the Best Reply button covers that on request. A card earns its place only when it changes what the agent does next:
- caution: a compliance or policy risk (prescription details before verification, a step skipped, a promise the policy does not allow, a clinical question that must go to the pharmacist).
- info: a policy fact with specifics the agent may not have at hand (a rejection code's meaning, an eligibility rule, a timeline). source must be "KB · <document title>".
- recommendation: a non-obvious offer or next best action grounded in the customer record or a tool output; source names where it comes from.
- tell: a specific result the agent must relay, with the numbers (a copay, a ready time, a confirmation number, a date).
- do: an action with a detail that matters (run the 90-day claim, not 30), or the summary to log.
- ask: a question that is required but easy to forget, never a routine one.
Timing: the card must land BEFORE the agent responds, so it is triggered by what the caller just said or what a tool just returned; a policy reminder the agent needs for the next sentence is exactly what belongs here.
Rules: text under 20 words, bullets under 15 words each; most of the time return 0 or 1 cards, never more than 2. Never repeat a card already shown unless the situation changed. source is "" when nothing backs the card. Never invent policy, prices or eligibility; use only the knowledge base, the customer record and tool outputs.

# Workflow groups and steps
${c.groups}

# Tag vocabulary
${D.TAGS.join(', ')}

# Tools the agent can run from the screen
${c.tools}

# Knowledge base
${c.kb}

# Customer record (already looked up for this caller)
${customerText(user)}`;
  }

  function replySystem(user) {
    const c = catalogText();
    return `You are the Phone Assist copilot for a Walgreens pharmacy support AGENT who is on a live call with a CALLER (a product demo with mock data). Write the single best next thing for the AGENT to say right now, responding to the caller's latest message and moving the call forward: 1 to 3 sentences of natural spoken English in the agent's voice, consistent with the knowledge base, the customer record and any tool outputs in the transcript. Never invent prices, eligibility or policy. If identity is not verified yet, verify first. If the caller asked a clinical question, hand off to the pharmacist.
Return one JSON object {reply, why}; why is under 20 words.

# Knowledge base
${c.kb}

# Customer record
${customerText(user)}`;
  }

  function askSystem(user) {
    const c = catalogText();
    return `You are the Phone Assist copilot for a Walgreens pharmacy support AGENT (a product demo with mock data). The agent typed a question for you; the caller cannot see it. Answer the agent in under 60 words using the knowledge base, the customer record and the call so far. When policy is involved, set source to "KB · <document title>"; otherwise "".
Return one JSON object {answer, source}.

# Knowledge base
${c.kb}

# Customer record
${customerText(user)}`;
  }

  /* ---------------- backends ---------------- */
  const AI = {
    mode: 'none',          // 'sample' | 'direct' | 'none'
    sample: null,
    settings: {},
    listeners: new Set(),

    onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
    emit() { this.listeners.forEach((fn) => fn(this.status())); },

    configure(settings) {
      this.settings = settings || {};
      this.recompute();
    },

    recompute() {
      if (this.sample) this.mode = 'sample';
      else if (this.settings.apiKey && !global.claude) this.mode = 'direct';
      else this.mode = 'none';
      this.emit();
    },

    async init(settings) {
      this.settings = settings || {};
      this.recompute();
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

    status() {
      if (this.mode === 'sample') return { mode: 'sample', label: 'Claude connected through this page (no key needed)' };
      if (this.mode === 'direct') return { mode: 'direct', label: `Claude connected: ${this.settings.model || 'claude-opus-5-5'} via your API key` };
      if (global.claude) return { mode: 'none', label: 'Claude not available in this viewer; scripted deltas only' };
      return { mode: 'none', label: 'No API key saved: scripted deltas only. Open Settings to connect Claude.' };
    },

    async json({ system, user, schema, tier, effort, maxTokens, signal }) {
      if (this.mode === 'sample') {
        const prompt = `${system}\n\n---\n\n${user}\n\nReply with only one JSON object that matches this JSON Schema, no prose and no code fence:\n${JSON.stringify(schema)}`;
        try {
          return await this.sample.json(prompt, { modelTier: tier || this.settings.tier || 'quick', cache: false, signal });
        } catch (e) {
          throw new Error(sampleErrorText(e));
        }
      }
      if (this.mode === 'direct') return callDirect(this.settings, { system, user, schema, effort, maxTokens, signal });
      throw new Error('Claude is not connected. Open Settings to add an API key.');
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

  async function callDirect(settings, { system, user, schema, effort, maxTokens, signal }) {
    const model = settings.model || 'claude-opus-5-5';
    const base = (settings.baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '');
    const headers = {
      'content-type': 'application/json',
      'x-api-key': settings.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    };
    const body = {
      model,
      max_tokens: maxTokens || 8000,
      system,
      messages: [{ role: 'user', content: user }],
      output_config: { effort: effort || settings.effort || 'low', format: { type: 'json_schema', schema } }
    };
    if (/opus|sonnet/.test(model)) {
      body.fallbacks = 'default';
      headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
    }
    let res;
    try {
      res = await fetch(`${base}/v1/messages`, { method: 'POST', headers, body: JSON.stringify(body), signal });
    } catch (e) {
      throw new Error('Could not reach the Claude API (network or CORS). If you are running from a file, serve the folder over http://localhost instead.');
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = data && data.error && data.error.message ? data.error.message : `HTTP ${res.status}`;
      throw new Error(msg);
    }
    if (data.stop_reason === 'refusal') throw new Error('Claude declined this request.');
    const block = (data.content || []).find((b) => b.type === 'text');
    if (!block || !block.text) throw new Error('Claude returned no text.');
    try {
      return JSON.parse(block.text);
    } catch (e) {
      throw new Error('Claude returned something that was not JSON.');
    }
  }

  global.AI = AI;
})(window);
