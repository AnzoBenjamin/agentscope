# AgentScope — 3-Minute Demo Video Script

**Target:** Splunk Agentic Ops Hackathon — public YouTube/Vimeo link, ≤ 3:00.
**Product:** AgentScope — a Splunk-powered control plane, black box recorder, and incident investigator for AI agents.
**One-line pitch:** "The operations plane for AI employees — every model call, tool call, and cost, captured in Splunk and replayable like a flight recorder."

---

## Title + Cold Open (0:00–0:05)

**On-screen:** 5-second title card — dark background, white text:

> **AgentScope**
> The flight recorder for AI employees.
> Built on Splunk.

**Voiceover (5s):**
> "AI agents are becoming employees — but they have no flight recorder. AgentScope is the operations plane that gives them one. Here's a live demo, three minutes, real Splunk."

**Cut directly** to a live browser window at `http://localhost:3000/agents`. No logo animation, no music swell.

---

## Section 1: The Problem (0:05–0:30) — 25 seconds

**On-screen action:** A second browser window is open at `http://localhost:8000` (Splunk Web). The screen is dominated by a single static SPL search that has returned for one agent's worth of raw events:

```spl
index=main sourcetype=agentscope:event agentName=* | head 50
```

The result panel is a wall of unmanageable nested JSON — model names, token counts, tool names, costs, durations, all jammed together in `_raw` text. No grouping, no risk level, no narrative.

**B-roll / overlay:** A red callout box appears in the top-right reading **"Is this normal? Was it expensive? Why did the tool fail?"** — three questions nobody can answer from this view.

**Voiceover (≤ 2 sentences):**
> "Your AI agent just ran for 90 seconds and made eleven model calls. Your only record of what it did is this — a firehose of raw events in Splunk. Nobody on your team can tell you what the agent actually did, what it cost, or whether it was safe."

---

## Section 2: Queue a Run (0:30–1:10) — 40 seconds

**On-screen action:** Browser tab switches to `http://localhost:3000/agents`. The user scrolls to the **"Run Splunk Investigation"** form panel at the top of the page.

Steps captured on screen:
1. Click into the prompt textarea.
2. Type the prompt verbatim: `Investigate yesterday's failed checkout runs and report any anomalies.`
3. Click the **Run** button.
4. The new run card appears in the **Recent runs** list with status `Queued` (gray).
5. The card auto-polls: `Queued` → `Running` (blue, with a spinner) → `Completed` (green check).
6. The completed card expands to show run metadata, session id, and an **"Open replay"** link.

**B-roll / overlay:** A small lower-third label appears on first click: **"Queued → Running → Completed (live, no refresh)"**.

**Reference frame:** this section targets `docs/screenshots/screenshot-agents-list.png` — the agents list with multiple run cards and the investigation form at the top.

**Voiceover (≤ 2 sentences):**
> "From the same screen, I queue a Splunk investigation run on a real agent. The status moves from Queued, to Running, to Completed in front of you — the AgentScope worker is claiming the job, running the agent, and writing the result back."

---

## Section 3: The Investigation (1:10–2:00) — 50 seconds

**On-screen action:** On the same `/agents` page, the user clicks the just-completed run card to expand it. The expanded panel reveals the **investigation report**:

1. A risk-level badge (e.g., `LOW` / `MEDIUM` / `HIGH`) with a one-line summary.
2. A **FINDINGS** section rendered as Markdown — short bulleted observations referencing specific events, token counts, and tool outcomes from the session.
3. A token-and-cost totals row (`tokensIn`, `tokensOut`, `cost`).
4. A **"Show SPL query"** toggle — clicking it reveals the exact SPL block used by the investigator, syntax-highlighted in a code block.
5. A link to the session replay.

**B-roll / overlay:** A callout banner reading **"This is the Splunk MCP Server, in production"** appears briefly while the SPL block is revealed. A second callout: **"Agent searched its own telemetry via MCP."**

**Reference frame:** `docs/screenshots/screenshot-agents-expanded.png` — investigation report with rendered markdown + SPL code block.

**Voiceover (≤ 2 sentences):**
> "The investigation you're reading wasn't hand-written — a second agent searched Splunk through the Splunk MCP Server to produce it, against the exact same telemetry the runtime just emitted. Risk level, findings, and the SPL it ran are right here on the run card."

---

## Section 4: Session Replay (2:00–2:40) — 40 seconds

**On-screen action:** User clicks **"Open replay"**. The browser navigates to `http://localhost:3000/sessions/<sessionId>`.

Steps captured on screen:
1. The session replay page loads, showing a header with the session id, agent name, model, total cost, and a `Completed` status pill.
2. The vertical timeline renders with 13 events, each as a row with a colored SVG icon (model = purple, tool = cyan, search = orange, cost = green, completed = green check), the event type label, and a relative time delta (e.g., `+0.4s`, `+1.2s`).
3. The narrator scrolls slowly to a `ModelInvoked` event and points out the `tokensIn` / `tokensOut` / `cost` / `duration` chip strip.
4. Scrolls to the orange **Splunk MCP search** event — the moment the investigator hit Splunk via MCP.
5. Ends on the final `Investigation Completed` event at the bottom of the timeline.

**B-roll / overlay:** A small label highlights the Splunk MCP search row: **"← Splunk MCP call"**. Another label points at the model call row: **"Model: gpt-4o · 812 tokens · $0.0041"**.

**Reference frame:** `docs/screenshots/screenshot-session-replay.png` — the 13-event timeline with SVG icons and time deltas.

**Voiceover (≤ 2 sentences):**
> "Every event from the run is here, in order, with icons and timing — model calls, tool calls, cost, and this one: the Splunk MCP search. This is the flight recorder. The same data the investigator just queried is what you're scrolling through."

---

## Section 5: The Splunk Truth (2:40–2:55) — 15 seconds

**On-screen action:** Tab switches back to Splunk Web at `http://localhost:8000`. The user pastes and runs the canonical SPL query that proves the AgentScope events are real, in Splunk, with all the fields the UI shows:

```spl
index=main sourcetype=agentscope:event | sort -_time | head 10 | table _time sessionId eventType agentName modelName cost tokensIn tokensOut
```

The result panel returns a clean table with the requested columns populated, timestamps in the last few minutes.

**B-roll / overlay:** A checkmark stamp overlay: **"Same data. Source of truth: Splunk."**

**Voiceover (≤ 2 sentences):**
> "And here's the source of truth — the same events, in Splunk, with the same fields the UI just showed. AgentScope doesn't mirror Splunk; it writes to it, and an agent reads back from it through MCP."

---

## Closing (2:55–3:00) — 5 seconds

**On-screen:** Title card returns, dark background, white text:

> **AgentScope** — the flight recorder for AI employees.
> github.com/<org>/agentscope
> Built on Splunk HEC + Splunk MCP Server.

**Voiceover (5s):**
> "AgentScope. Open source. Built on Splunk. Link in the description."

---

## Recording Checklist

Run through this before hitting record:

- [ ] **Browser viewport:** Chrome DevTools device toolbar set to **1440 × 900** (matches the screenshot dimensions and gives clean framing).
- [ ] **macOS appearance:** System Settings → Appearance → **Dark**. The UI is dark-first and callout overlays read better on dark.
- [ ] **Splunk Web open in a second tab** at `http://localhost:8000` (admin / `agentscope123`), already authenticated and on the Search & Reporting app, so the Section 5 cut is instant.
- [ ] **Dev server running:** `pnpm dev:next` (Next.js on `:3000`) and `pnpm dev:worker` (AgentScope worker) both up in separate terminals; the worker log visible for a quick "look, it's running" beat if needed.
- [ ] **Seed script run:** `pnpm --filter @agentscope/db seed` executed recently so `/dashboard` and `/agents` are populated and the Splunk readiness panel shows **HEC: ok** and **MCP: ok**.
- [ ] **Notifications muted:** macOS Do Not Disturb on, Slack / Mail / Calendar banners suppressed, phone face-down. No surprise notification over a 3-minute recording.
- [ ] **Clean recent-run slate:** clear or finish any in-flight runs on `/agents` *before* recording, so the Queued → Running → Completed transition in Section 2 is unambiguous and not a leftover.
- [ ] **Capture settings:** OBS (or QuickTime New Screen Recording) at **30 fps**, 1440 × 900 canvas, system audio **muted** at the source (we're doing live VO from a mic). Have a lapel / USB mic ready; do a 10-second test recording and listen back for plosives and room noise.

---

## Runtime Confirmation

| Section                 | Duration |
|-------------------------|----------|
| Title + Cold Open       | 5 s      |
| 1. The Problem          | 25 s     |
| 2. Queue a Run          | 40 s     |
| 3. The Investigation    | 50 s     |
| 4. Session Replay       | 40 s     |
| 5. The Splunk Truth     | 15 s     |
| Closing                 | 5 s      |
| **Total**               | **180 s** |

**Total estimated runtime: 180 seconds (3:00 exactly) — fits the ≤ 3-minute limit.**

**File written to:** `/home/ben/Code/Fullstack/agentscope/docs/DEMO_VIDEO_SCRIPT.md`
