# Phone Assist demo (Walgreens pharmacy)

A standalone, mock demo of an AI assistant that listens to a live pharmacy support call and coaches the human agent: workflow steps that tick off (or turn orange when skipped), conversation tags, live guidance cards with policy snippets, tools the agent can run from the screen, a Customer 360 tab, a live transcript, a Get Best Reply button and an ask box.

Everything here (customers, workflows, policies, tools) is invented demo content. It is not Walgreens policy.

## Where the behavior comes from

Every AI call is assembled from these files and nothing else; edit them and refresh the page.

| File | Role |
| --- | --- |
| `prompts/system_prompt.md` | Core personality plus every workflow and its numbered steps. Steps name the tool they use and the `kb/` file they follow. Nothing here is specific to Phone Assist. |
| `prompts/phone_assist.md` | Phone Assist behavior: which workflows to show, when a step turns green (done) or orange (missed), tags, live guidance, which tools to highlight and prefill, which tool to suggest, and how a tool call is simulated. |
| `prompts/phone_assist_best_reply.md` | Get Best Reply. |
| `prompts/chat.md` | Answers to questions the agent types in the ask box. |
| `tools.md` | Mock tools: name, description, inputs, and an example output. They are never executed; with `dynamic=true` the model plays the tool and returns a result in the example's format, and the example is the fallback. |
| `kb/*.md` | One policy per file. Workflows and guidance cite them by file name. |

Each call sends `system_prompt.md` plus the matching personality file as instructions, with `tools.md`, every `kb/` file and the Customer 360 record attached. HTML comments (`<!-- -->`) in any of these files are stripped first, so they are safe for notes to yourself.

## Run it

No build step and no install. Open a terminal in the unzipped folder and run one command, then use Chrome or Edge (voice input relies on the speech recognition built into those two browsers):

```
cd phone-assist-demo
./run.sh          # macOS or Linux: serves http://localhost:8080 and opens it
```

On Windows double-click `run.bat`. Both need Python 3, which macOS ships with; if you prefer Node, `npx serve .` does the same job. You can also double-click `run.command` on macOS (right-click, Open, the first time, because it was downloaded).

If you would rather not run anything, double-click `index.html`. Scripted mode works from disk; the microphone, GPT-5.6 Luna, and ElevenLabs are more reliable over `http://localhost`, which is what the scripts give you.

## Modes

**Scripted** (default). **Start call** simulates an incoming call: the phone number is recognized, the Customer 360 tab opens with the matched record, and the workflow panel stays blank until the caller says what they need. Pick the **Incoming number** in the rail to choose which caller rings, or leave it on Random. Then **Next** or **Play all** replays the call. **Speak as Caller / Speak as Support Agent** play the next line for that speaker. The script holds only the spoken lines: after each line the phone assist updates the panels, and because nobody is at the keyboard, the tool it suggests runs automatically with its prefilled inputs (at most three per line). In live mode the agent clicks Execute instead. Without an AI model the lines still play, but the panels stay empty. The three calls:

- Maria Lopez: refill rejected by insurance (code 79), price-sensitive, adds a flu shot. The agent skips reading the rejection reason back, so that step turns orange until she does it.
- James Carter: moves a blood thinner from CVS on Medicare Part D, asks about a manufacturer coupon, and the agent quotes the wrong transfer timeline before correcting it.
- Priya Nair: moves an inhaler to another store and asks a clinical question that must be escalated to the pharmacist.

With the starter prompts, workflows appear from the conversation (verification plus the topic workflow at the caller's first request, more as new topics come up, wrap-up once the main request is resolved), and a step turns green only when the agent performs it. These rules live in `prompts/phone_assist.md`.

The lines are read aloud with the browser's built-in speech synthesis, with a different voice for the caller and the agent, so there is no need to open the Transcript tab to follow. **Audio on/off** mutes it. Voices come from the operating system; on a Mac, Chrome uses the system voices, so a quiet machine with no voices installed plays the call silently at a reading pace.

**Reset** clears the call and every panel. **Restart call** does the same and starts over immediately.

Replaying a scripted call is the quickest way to tune the prompt files.

**Live voice.** **Start call** rings from the chosen or a random incoming number and opens Customer 360 with the matched record. Then click **Speak as Caller** or **Speak as Support Agent** and talk. Each pause becomes a transcript line attributed to that speaker, and GPT-5.6 Luna updates the steps, tags, guidance and tools after every line. Click the same button again to stop, or the other button to switch speakers. Nothing talks back; only you speak. You can also type a line in the box (Enter sends as caller, Alt+Enter as agent), which is handy without a microphone.

Live Guidance shows short contextual notes when there is something to know or keep in mind for the next thing the agent says or does: a fact from the record, a policy note, a caution, a suggested phrasing for a delicate moment, a next best action or a tool result to relay. One event (a caller line or a tool result) gets at most one card, with bullet points when there are several things to know, and it lands before the agent responds. While you are on another tab, the Live Guidance tab shows a count of new cards. Tags are kept to what changes the handling or the documentation. The newest card is the only one on screen; earlier ones scroll up and fade, and the feed scrolls back to them. It never scripts the agent's lines; **Get Best Reply** is the one place that produces words to say, on request. Workflow steps turn green when done and orange with a tint when skipped, and pulse when they change. When the situation calls for a specific tool, its chip flashes until it is opened or run.

In both modes, click a tool chip to open its input form. Inputs the phone assist found in the call or the customer record are pre-filled; the rest are blank for the agent to fill. **Execute** simulates the tool, shows its output and adds a tool line to the transcript; the next panel update decides what the result means. **Get Best Reply** proposes the next thing to say; the ask box answers a free-text question from the agent.

## Hosting it with GPT-5.6 Luna and ElevenLabs

The browser never holds a key. A small Node server (`server.mjs`) serves the page and keeps the keys. For local iteration, run that server on this machine. Refresh the browser after editing the page, scripts, or prompts. Restart `npm start` only after changing `server.mjs` or `.env`.

- `POST /api/llm` runs every model call (panel updates, best reply, ask box, tool simulation) on GPT-5.6 Luna (`gpt-5.6-luna`) with structured JSON output. A simulated tool result must match the shape of the tool's example output.
- `GET /api/prompts` returns the prompt files, `tools.md` and `kb/*.md`, read from disk on each request.
- `POST /api/tts` turns scripted lines into speech with ElevenLabs (falls back to the browser's own voices when no key is set).
- `GET /api/config` tells the page which services are configured.

Put the keys in a gitignored `.env` file next to `server.mjs`:

| Variable | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | GPT-5.6 Luna access (required for live analysis) |
| `ELEVENLABS_API_KEY` | ElevenLabs voices for the scripted call (optional) |
| `OPENAI_MODEL` | defaults to `gpt-5.6-luna` |
| `OPENAI_EFFORT` | defaults to `low` |
| `ELEVENLABS_VOICE_CALLER`, `ELEVENLABS_VOICE_AGENT` | voice ids, default Sarah and Rachel |

The start command is `npm start`, then open http://localhost:8080. The same server can be deployed anywhere that runs Node 20+ (Railway, Render, Fly) by setting those environment variables on the host. A push to `main` updates a host only when that host is already connected to the repo.

Whenever GPT-5.6 Luna is reachable, it drives every panel from the transcript, in scripted replays as well as live calls. Without it, the call plays but the panels stay empty. Live transcription uses the speech recognition built into Chrome and Edge.

## Files

- `index.html`: local entry point.
- `run.sh`, `run.command`, `run.bat`: start a local server and open the page.
- `artifact.html`: the same page with the CSS, JS, prompt files, `tools.md` and `kb/` inlined, in the form the claude.ai Artifact tool wraps. Regenerate it with `./build-artifact.sh` after editing any of them.
- `app.js`: the screen (Preact + htm from a CDN, no build).
- `data.js`: mock customers (Customer 360 records) and the spoken lines of the scripted calls.
- `ai.js`: prompt assembly from the files, the `tools.md` parser, JSON schemas and the model backends (local GPT-5.6 Luna server, or the claude.ai artifact viewer).
- `server.mjs`, `package.json`: the key-holding server for hosting.
- `prompts/`, `tools.md`, `kb/`: the behavior, described above.
- `voice.js`: Web Speech API wrapper with auto-restart (speech to text).
- `tts.js`: speech synthesis wrapper that reads scripted lines aloud (text to speech).
- `styles.css`: the Cignara playground look.

## Layout

The screen is a fixed-height working session: the page never scrolls. The workflow list, the guidance feed, the tool input and output, the Customer 360 tab and the transcript each scroll inside their own panel. New guidance is appended at the bottom of the feed and older cards scroll up and fade.

## Changing the scenario

- Workflows: add a `## Workflow: <name>` section with numbered steps to `prompts/system_prompt.md`.
- Tools: add a `tool_name( ... ) -> { ... }` block to `tools.md` with `desc`, `input`, `message`, `dynamic` and `auto_approved`, followed by an example JSON output.
- Policies: add a Markdown file to `kb/` and cite it by file name from a workflow step.
- Scripted calls: edit `SCENARIOS` in `data.js`; each turn is just `{ speaker, text }`. Customer records are under `USERS`.
