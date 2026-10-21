# Phone Assist demo (Walgreens pharmacy)

A standalone, mock demo of an AI assistant that listens to a live pharmacy support call and coaches the human agent: workflow steps that tick off (or turn orange when skipped), conversation tags, live guidance cards with policy snippets, tools the agent can run from the screen, a Customer 360 tab, a live transcript, a Get Best Reply button and an ask box.

Everything in `data.js` is invented demo content. It is not Walgreens policy.

## Run it

No build step and no install. Open a terminal in the unzipped folder and run one command, then use Chrome or Edge (voice input relies on the speech recognition built into those two browsers):

```
cd phone-assist-demo
./run.sh          # macOS or Linux: serves http://localhost:8080 and opens it
```

On Windows double-click `run.bat`. Both need Python 3, which macOS ships with; if you prefer Node, `npx serve .` does the same job. You can also double-click `run.command` on macOS (right-click, Open, the first time, because it was downloaded).

If you would rather not run anything, double-click `index.html`. Scripted mode works from disk; the microphone and the Claude API are more reliable over `http://localhost`, which is what the scripts give you.

## Modes

**Scripted** (default). **Start call** picks one of three callers and situations at random, then **Next** or **Play all** replays it. **Speak as Caller / Speak as Support Agent** play the next line for that speaker. Every turn carries the panel changes (steps, tags, guidance, tools), so this mode needs no AI at all. The three calls:

- Maria Lopez: refill rejected by insurance (code 79), price-sensitive, adds a flu shot. The agent skips reading the rejection reason back, so that step turns orange until she does it.
- James Carter: moves a blood thinner from CVS on Medicare Part D, asks about a manufacturer coupon, and the agent quotes the wrong transfer timeline before correcting it.
- Priya Nair: moves an inhaler to another store and asks a clinical question that must be escalated to the pharmacist.

A step turns green only when the agent performs it: a tool runs, or the agent says it. The caller supplying information never completes a step on its own; a caller's confirmation of a store, a time or a choice does.

The lines are read aloud with the browser's built-in speech synthesis, with a different voice for the caller and the agent, so there is no need to open the Transcript tab to follow. **Audio on/off** mutes it. Voices come from the operating system; on a Mac, Chrome uses the system voices, so a quiet machine with no voices installed plays the call silently at a reading pace.

**Reset** clears the call and every panel. **Restart call** does the same and starts over immediately.

In Settings, "Scripted replay: what fills the panels" can be switched to Claude. The same script then replays, but Claude fills the panels from the transcript instead of the scripted deltas. This is the quickest way to tune the prompts in `ai.js`.

**Live voice.** **Start call** picks a caller record at random (the Customer 360 tab shows who). Then click **Speak as Caller** or **Speak as Support Agent** and talk. Each pause becomes a transcript line attributed to that speaker, and Claude updates the steps, tags, guidance and tools after every line. Click the same button again to stop, or the other button to switch speakers. Nothing talks back; only you speak. You can also type a line in the box (Enter sends as caller, Alt+Enter as agent), which is handy without a microphone.

Live Guidance only shows what deserves a glance: a compliance risk, a policy fact with specifics, a non-obvious offer, or a result to relay with its numbers. One event (a caller line or a tool result) gets at most one card, with bullet points when there are several things to know, and it lands before the agent responds. The newest card is the only one on screen; earlier ones scroll up and fade, and the feed scrolls back to them. It never scripts the agent's lines; **Get Best Reply** is the one place that produces words to say, on request. Workflow steps turn green when done and orange with a tint when skipped, and pulse when they change. When the situation calls for a specific tool, its chip flashes until it is opened or run.

In both modes, click a tool chip to open its input form, edit the pre-filled values and press **Execute**. The mock API answers and, where it makes sense, pushes a Recommendation or Tell card into Live Guidance. **Get Best Reply** proposes the next thing to say; the ask box answers a free-text question from the agent.

## Connecting Claude

Open **Settings** (gear icon, top right) and paste an Anthropic API key. The key stays in this browser's local storage and the page calls the Claude API directly, which is fine for a laptop demo. The default model is `claude-opus-5-5` at low effort; `claude-sonnet-5-5` or `claude-haiku-5-5` answer faster. If you would rather keep the key off the browser, run a small proxy and put its URL in **API base URL**.

Requests use structured outputs (`output_config.format`) so the panels always receive valid JSON, and the server-side refusal fallback (`fallbacks: "default"`) on Opus and Sonnet.

When the page is published as a claude.ai artifact, it reaches Claude through the viewer's own account instead, so no key is needed there. Voice input is not available inside the artifact; use typed lines.

## Files

- `index.html`: local entry point.
- `run.sh`, `run.command`, `run.bat`: start a local server and open the page.
- `artifact.html`: the same page with the CSS and JS inlined, in the form the claude.ai Artifact tool wraps. Regenerate it with `./build-artifact.sh` after editing the sources.
- `app.js`: the screen (Preact + htm from a CDN, no build).
- `data.js`: mock customers, knowledge base, SOP groups, tags, tools with canned outputs, the scripted call.
- `ai.js`: prompts, JSON schemas and the two Claude backends.
- `voice.js`: Web Speech API wrapper with auto-restart (speech to text).
- `tts.js`: speech synthesis wrapper that reads scripted lines aloud (text to speech).
- `styles.css`: the Cignara playground look.

## Layout

The screen is a fixed-height working session: the page never scrolls. The workflow list, the guidance feed, the tool input and output, the Customer 360 tab and the transcript each scroll inside their own panel. New guidance is appended at the bottom of the feed and older cards scroll up and fade.

## Changing the scenario

- Add or edit SOP groups in `data.js` under `SOP`; each group has a trigger sentence Claude uses to decide when it applies.
- Add a tool under `TOOLS`: `inputs` build the form (with prefill functions), `run` returns `{ output, stepsDone, tagsAdd, cards }`.
- Edit or add scripted calls under `SCENARIOS`; each turn can carry `activate`, `steps`, `tagsAdd`, `guidance` (cards with optional `bullets`), `tools`, `suggestTool` (flashes that chip), `tool` (one auto-run or a list of them) and `bestReply`. Mark a step done on the turn where the agent performs it.
- Knowledge base documents live under `KB`; the analyst cites them by title.
