# Phone Assist demo (Walgreens pharmacy)

A standalone, mock demo of an AI assistant that listens to a live pharmacy support call and coaches the human agent: workflow steps that tick off (or turn orange when skipped), conversation tags, live guidance cards with policy snippets, tools the agent can run from the screen, a Customer 360 tab, a live transcript, a Get Best Reply button and an ask box.

Everything here (customers, workflows, policies, tools) is invented demo content. It is not Walgreens policy.

## Where the behavior comes from

Every AI call is assembled from these files and nothing else; edit them and refresh the page.

| File | Role |
| --- | --- |
| `prompts/system_prompt.md` | Core personality plus every workflow and its numbered steps. Steps name the tool they use and the `kb/` file they follow. Nothing here is specific to Phone Assist. |
| `prompts/phone_assist_workflow.md` | The workflow panel: which workflows to show and when a step turns green (done) or orange (missed). |
| `prompts/phone_assist_guidance.md` | Tags, live guidance, which tools to highlight and prefill, which human-only tool to suggest, the tasks the assistant runs on its own, and how a tool call is simulated. |
| `prompts/phone_assist_best_reply.md` | Get Best Reply. |
| `prompts/chat.md` | Answers to questions the agent types in the ask box. |
| `tools.md` | Mock tools: name, description, inputs, and an example output. They are never executed; with `dynamic=true` the model plays the tool and returns a result in the example's format, and the example is the fallback. |
| `kb/*.md` | One policy per file. Workflows and guidance cite them by file name. |
| `prompts/caller.md` | Simulated calls: how the caller AI plays any caller. It sees only its scenario, what was said, and the texts that reached its phone. |
| `prompts/support_agent.md` | Simulated calls: how the agent AI plays the support agent. It follows the Live Guidance card on screen and falls back on `system_prompt.md` and its workflows when there is no card. |
| `scenarios/*.md` | One simulated call per file: the customer record it uses, a "Caller" section (persona, situation, facts, behavior) for the caller AI, and a "Support agent" section of notes for the agent AI. |

Each call sends `system_prompt.md` plus the matching personality file as instructions, with `tools.md`, every `kb/` file and the Customer 360 record attached. HTML comments (`<!-- -->`) in any of these files are stripped first, so they are safe for notes to yourself.

## Run it

No build step and no install. Open a terminal in the unzipped folder and run one command, then use Chrome or Edge (voice input relies on the speech recognition built into those two browsers):

```
cd phone-assist-demo
./run.sh          # macOS or Linux: serves http://localhost:8080 and opens it
```

On Windows double-click `run.bat`. Both need Python 3, which macOS ships with; if you prefer Node, `npx serve .` does the same job. You can also double-click `run.command` on macOS (right-click, Open, the first time, because it was downloaded).

If you would rather not run anything, double-click `index.html`. Without the server there is no AI, so simulated calls do not run; the microphone, GPT-5.6 Luna, and ElevenLabs are more reliable over `http://localhost`, which is what the scripts give you.

## Modes

**Simulated** (default). Two AIs hold a free-flowing call: one plays the caller from a scenario file, the other plays the support agent. Pick a **Scenario** in the rail, or leave it on Random, then **Play all** runs the call and **Next** plays one turn (**Speak as Caller / Speak as Support Agent** play the next turn when it belongs to that speaker). Every run is different. Turns happen strictly one after another, with no added waits: a line is spoken, any tool the agent ran executes, and the phone assist updates the panels before the other side speaks, so the agent builds its reply around the card. When the agent says it is checking something and lookups or a new card arrive while it works, it keeps the floor once to deliver the results before the caller speaks. The caller's reply is drafted in the background while the panels update but is spoken only after the update. Human-only tools (Send OTP, Rerun Claim, Book Appointment…) still need you: when the agent AI asks for one, its input row opens in the tool feed with the inputs prefilled, and the call pauses until you press **Execute** (or **Skip**, which tells the agent it did not run). A simulated call needs an AI model. The scenarios:

1. Maria Lopez: refill rejected by insurance (code 79), price-sensitive, adds a flu shot.
2. James Carter: moves a blood thinner from CVS on Medicare Part D and asks about a manufacturer coupon.
3. Priya Nair: moves an inhaler to another store and raises a breathing red flag that goes to the pharmacist.
4. Maria Lopez: refills her metformin before a trip and picks it up Friday at the Davis St store.
5. Lauren Carter calls for her father James: a refill plus an ibuprofen-with-Eliquis question for the pharmacist.

All five are happy paths: the caller cooperates and the agent follows every workflow step. The demo's date is fixed at Thursday, October 22, 2026 (set in `ai.js`), and the customer records' fill dates are written to match it.

With the starter prompts, workflows appear from the conversation (verification plus the topic workflow at the caller's first request, more as new topics come up, wrap-up once the main request is resolved), and a step turns green only when the agent performs it. These rules live in `prompts/phone_assist_workflow.md`. After every line and every tool result, the workflow prompt and the guidance prompt run at the same time, and each updates its own part of the screen when it answers. Get Best Reply runs only when clicked.

The lines are read aloud with the browser's built-in speech synthesis, with a different voice for the caller and the agent, so there is no need to open the Transcript tab to follow. **Audio on/off** mutes it. Voices come from the operating system; on a Mac, Chrome uses the system voices, so a quiet machine with no voices installed plays the call silently at a reading pace.

**Reset** clears the call and every panel. **Restart call** does the same and starts over immediately.

Running a simulated scenario is the quickest way to tune the prompt files.

**Live voice.** **Start call** rings from the chosen or a random incoming number and opens Customer 360 with the matched record. Then click **Speak as Caller** or **Speak as Support Agent** and talk. Each pause becomes a transcript line attributed to that speaker, and GPT-5.6 Luna updates the steps, tags, guidance and tools after every line. Click the same button again to stop, or the other button to switch speakers. Nothing talks back; only you speak. You can also type a line in the box (Enter sends as caller, Alt+Enter as agent), which is handy without a microphone.

Live Guidance works answer-first: the assistant does the lookups itself and shows the result (an eligibility, a ready time, a rejection reason, an exact disclosure), not instructions to go check. Each update gets zero or one card, usually one sentence. The card types (Say, Ask, Do, Recommend, Info, Policy, Caution), how many cards an update may add, and whether Say cards appear are all defined in `prompts/phone_assist_guidance.md`; the screen shows whatever type a card uses. While a lookup runs, the guidance box shows "Looking up: …" with animated dots instead of a card. While you are on another tab, the Live Guidance tab shows a count of new cards. Tags are kept to what changes the handling or the documentation. The newest card is the only one on screen; earlier ones scroll up and fade, and the feed scrolls back to them. Workflow steps turn green when done and orange with a tint when skipped, and pulse when they change. When the situation calls for a specific tool, its chip flashes until it is opened or run.

Below Live Guidance is the action feed: one row per tool call, newest at the bottom, earlier rows scrolling up.

- **AI tasks.** The phone assist runs tools marked `auto_approved=true` in `tools.md` on its own. It starts a task with a short goal (for example "Check refill and claim status"), calls one tool at a time and chains the next call from each result. Every tool comes from `tools.md`, including read-only lookups such as `get_rx_status`, `get_disclosure`, `find_stores` and `lookup_policy`. Outputs are simulated in the shape of each tool's example; policy files that `lookup_policy` cites need not exist in `kb/`. The left side lists each call as an action line with its duration, which can be expanded to show that call's inputs and result. The right side shows one summary of what the task found, not every intermediate output. If a required input is unknown, the task pauses and shows input boxes with a **Run** button.
- **Tools switch** (left rail). **Auto + manual** follows `auto_approved` in `tools.md`: lookups marked true run on their own. **All manual** makes every tool wait for you: each step the AI picks shows its inputs with a button named after the tool and **Skip**, and a simulated call waits until you choose.
- **Manual tools.** Tools marked `auto_approved=false` (sending an SMS or email, enrolling in text alerts, rerunning a claim, booking, transferring, paging the pharmacist) only run when the agent clicks them. When one is needed, a row opens in the tool feed with its inputs on the left; values found in the call or the customer record are pre-filled and the rest are blank. **Execute** simulates the tool and puts the output on the right of the same row.

In a simulated call, the agent AI runs manual tools itself. In live mode, AI tasks run in the background so guidance keeps updating. **Get Best Reply** proposes the next thing to say; the ask box answers a free-text question from the agent.

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
- Tools: add a `tool_name( ... ) -> { ... }` block to `tools.md` with `desc`, `input` (mark optional inputs with a trailing `?`), `message` (the action text shown while it runs), `dynamic` and `auto_approved` (true lets the AI run it on its own), followed by an example JSON output.
- Policies: add a Markdown file to `kb/` and cite it by file name from a workflow step.
- Scripted calls: edit `SCENARIOS` in `data.js`; each turn is just `{ speaker, text }`. Customer records are under `USERS`.
