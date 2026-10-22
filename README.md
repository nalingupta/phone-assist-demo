# Phone Assist demo (Walgreens pharmacy)

A standalone, mock demo of an AI assistant that listens to a live pharmacy support call and coaches the human agent: workflow steps the agent starts one at a time, conversation tags, live guidance cards with policy snippets, tools the agent can run from the screen, a Customer 360 tab, a live transcript, a Get Best Reply button and an ask box.

Everything here (customers, workflows, policies, tools) is invented demo content. It is not Walgreens policy.

## Where the behavior comes from

Every AI call is assembled from these files and nothing else; edit them and refresh the page.

| File | Role |
| --- | --- |
| `prompts/system_prompt.md` | Core personality plus every workflow and its numbered steps. Steps name the tool they use and the `kb/` file they follow. Nothing here is specific to Phone Assist. |
| `prompts/phone_assist_workflow.md` | The workflow panel: which workflows to show. Steps turn green when the agent starts them. |
| `prompts/phone_assist_guidance.md` | Flashcard rules (triggers, what never to show, grounding, tags and word limits), tags, tool prefill, and how a tool call is simulated. |
| `prompts/phone_assist_best_reply.md` | Get Best Reply. |
| `prompts/chat.md` | Answers to questions the agent types in the ask box. |
| `tools.md` | Mock tools: name, description, inputs, and an example output. They are never executed; with `dynamic=true` the model plays the tool and returns a result in the example's format, and the example is the fallback. |
| `kb/*.md` | One policy per file. Workflows and guidance cite them by file name. |
| `prompts/caller.md` | Simulated calls: how the caller AI plays any caller. It sees its scenario, the patient facts a person would know from their own life (name, date of birth, phone, store, medications, plan name, family representatives, taken from the customer record), what was said, and the texts that reached its phone. |
| `prompts/support_agent.md` | Simulated calls: how the agent AI plays the support agent. It follows the Live Guidance card on screen and falls back on `system_prompt.md` and its workflows when there is no card. |
| `scenarios/*.md` | One simulated call per file: the customer record it uses, a "Caller" section (persona, situation, facts, requests in order) for the caller AI, a "Support agent" section of notes for the agent AI, and a "Happy path" section with the intended flow, which only the tool simulator sees. |

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

Pick a **Scenario** in the header toolbar (or leave it on Random), pick a mode (**Live call** is selected by default; **Simulated** is the other), then click **Start call**. The screen dims and an incoming-call popup shows the caller's number with only its last four digits; **Accept** starts the call and **Decline** (or Esc) dismisses it. The app never switches tabs on its own: you stay on Live Guidance unless you click another tab. **End call** stops the call and **Reset** clears every panel and selects Live call again. Lines are always read aloud.

**Simulated.** Two AIs hold a free-flowing call: one plays the caller from a scenario file, the other plays the support agent. The call plays on its own from the first turn; **Pause** stops it after the line being spoken and **Resume** carries on. Every run is different. Turns happen strictly one after another, with no added waits: a line is spoken, any tool the agent ran executes, and the phone assist updates the panels before the other side speaks, so the agent builds its reply around the card. When the agent says it is checking something and lookups or a new card arrive while it works, it keeps the floor once to deliver the results before the caller speaks. The caller's reply is drafted in the background while the panels update but is spoken only after the update. Human-only tools (Send OTP, Rerun Claim, Book Appointment…) still need you: when the agent AI asks for one, its input row opens in the tool feed with the inputs prefilled, and the call pauses until you press **Execute** (or **Skip**, which tells the agent it did not run). A simulated call needs an AI model. The scenarios:

1. Maria Lopez: refill rejected by insurance (code 79), switches to a cheaper 90-day supply, adds a flu shot.
2. James Carter: moves Eliquis from CVS on Medicare Part D, asks about a manufacturer coupon, switches to 90-day fills and text notifications.
3. Priya Nair: refills her inhaler for pickup at the Davis St store and raises a breathing red flag that goes to the pharmacist.
4. Maria Lopez: refills her metformin before a trip for Friday pickup at the Davis St store, and signs up for text alerts.
5. Lauren Carter calls for her father James as his authorized representative: a refill plus an ibuprofen-with-Eliquis question for the pharmacist.

All five are happy paths: the caller cooperates, raises only the requests in its scenario, in order, and the agent follows every workflow step. Each scenario file ends with a "Happy path" section listing the workflows and tools the call should go through. Only the tool simulator is given it, as the call's intended outcome, so tool results (dates, ready times, amounts) follow it; when neither the record nor the knowledge base has a fact a tool needs, the simulator makes up a plausible one and the result still succeeds. The caller, agent and guidance AIs never see it. Each scenario has its own customer record (`maria`, `maria_trip`, `james`, `james_rep`, `priya`), so a record holds only what fits that call; the guidance prompt also keeps cards to the caller's own requests. Every tool in `tools.md` is used by a workflow step, and every fact a tool returns comes from the customer record (`data.js`, with per-prescription copays) or the knowledge base (`kb/store_directory.md` for stores, `kb/text_alerts.md` for the approved SMS script). The demo's date is fixed at Thursday, October 22, 2026 (set in `ai.js`), and the customer records' fill dates are written to match it.

With the starter prompts, workflows appear from the conversation (verification plus the topic workflow at the caller's first request, with Authorized representative first when someone calls for a patient; more as new topics come up; wrap-up once every request is resolved). These rules live in `prompts/phone_assist_workflow.md`.

**Step by step.** The agent decides when to move on and when a step is finished. Every workflow step is clickable; clicking it turns the step green and opens the first tool the step names in `system_prompt.md` ("Tool: `verify_identity`") in the tool feed. The tool's inputs are editable and fill in as the call goes on; nothing runs until the agent presses the tool's button, and the row stays until they run it or skip it, however many other steps they start meanwhile (new rows are appended below). When they run it, the output shows in the row. Clicking a green step starts it again; an open row of the same tool is reused. After every line, the workflow prompt adds workflows as topics come up; after every line and every tool run, the guidance prompt updates tags and input prefill and decides whether a flashcard is warranted (see Live Guidance below). In a simulated call, when the agent AI says it is checking something, the call waits until you run or skip a tool. Get Best Reply runs only when clicked.

The lines are read aloud with the browser's built-in speech synthesis, with a different voice for the caller and the agent, so there is no need to open the Transcript tab to follow. Voices come from the operating system; on a Mac, Chrome uses the system voices, so a quiet machine with no voices installed plays the call silently at a reading pace.

**Reset** clears the call and every panel; click a mode to start again.

Running a simulated scenario is the quickest way to tune the prompt files.

**Live call.** The caller is still played by the AI from a scenario file, and you are the support agent on the microphone. Accepting the call loads the chosen (or a random) scenario and its record and turns your mic on; you greet the caller first. Speak naturally: your words show in the transcript as you talk, and about 1.5 seconds of silence ends your turn. The caller AI then answers in its voice; your mic pauses while it speaks, so use speakers or headphones freely, and resumes when it finishes. If you start talking again before the caller answers, its reply is dropped and rewritten after you finish. The phone assist updates the panels after every line, and you run human-only tools from the tool feed as usual; a passcode you send reaches the caller's phone. After the caller says goodbye, your next line ends the call. **Pause** stops listening (sending what you already said) and **Resume** turns the mic back on. Live call needs Chrome or Edge for speech recognition.

Live Guidance is a stack of flashcards written on the fly from the knowledge base, `system_prompt.md`, the customer record and the latest tool results. A card appears only when the latest line or tool result calls for one: a policy question, a fact the agent may not know, a caution, something to clarify, a cross-sell or upsell opportunity, or a result that changes what to say. Most updates add no card; cards never restate workflow steps, what to collect, or what the agent is doing. Each card has one tag (Caution, Exception, Disclosure; Offer, Ask, Tell, Do; Policy, Answer, Info) and a short subject, and a card whose subject matches one of the last three is dropped. Once the call has moved past the newest card's point (it was resolved, its step is done, or the subject changed), it scrolls up and the panel stays empty until something new is worth showing. The screen updates only on what has been heard: a line read aloud is left out of every prompt until its voice ends, though the Transcript tab shows it as it is spoken. The triggers, tags and word limits are defined in `prompts/phone_assist_guidance.md`. While you are on another tab, the Live Guidance tab shows a count of new cards. Tags are kept to what changes the handling or the documentation. The newest card is the only one on screen; earlier ones scroll up and fade, and the feed scrolls back to them. A workflow step turns green and pulses when the agent starts it.

Below Live Guidance is the tool feed: one row per tool, newest at the bottom, earlier rows scrolling up. Every row is headed by the tool's readable `message` ("Locating prescription"). An open row shows the tool's inputs, a button named after the tool and **Skip**. The tool run last shows Input and Output tabs, with Output open: a card with the result's headline, its fields under readable labels, and a short note (each tool's output in `tools.md` starts with `headline` and `note` fields for this). Earlier runs collapse to their heading, with the same view behind **Show details**. Every tool comes from `tools.md`; outputs are simulated in the shape of each tool's example, grounded in the customer record and `kb/`.

In a simulated call, the agent AI can also ask for a tool marked `auto_approved=false` (sending an SMS, rerunning a claim, paging the pharmacist…); its row opens the same way and the call waits until you run or skip it. **Get Best Reply** proposes the next thing to say; the ask box answers a free-text question from the agent.

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
- Simulated calls: add or edit a file in `scenarios/` (customer id, Caller, Support agent, Happy path). Customer records are under `USERS` in `data.js`; any tool a scenario needs must be named by a workflow step, and any fact it returns must be in the record or `kb/`.
