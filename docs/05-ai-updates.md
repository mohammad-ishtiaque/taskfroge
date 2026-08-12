# 05 — AI Updates

**Provider:** DeepSeek
**Scope:** turning task data into a message a human would otherwise have written.
Nothing else.

---

## 1. Provider

DeepSeek's API is OpenAI-compatible, so the client is the standard OpenAI SDK
pointed at a different base URL. If we ever want to switch providers, it is a
configuration change rather than a rewrite.

```ts
const ai = new OpenAI({
  apiKey:  process.env.DEEPSEEK_API_KEY,
  baseURL: 'https://api.deepseek.com',
});
```

### Model choice

| Model | Input (cache miss) | Input (cache hit) | Output |
| --- | --- | --- | --- |
| **`deepseek-v4-flash`** ← ours | $0.14 / 1M | $0.0028 / 1M | $0.28 / 1M |
| `deepseek-v4-pro` | $0.435 / 1M | $0.003625 / 1M | $0.87 / 1M |

**Use `deepseek-v4-flash`.** Writing three paragraphs from a structured list of
tasks is not a reasoning problem, and Pro costs three times as much to do it.

> ⚠️ **Do not use `deepseek-chat` or `deepseek-reasoner`.** Those aliases were
> deprecated on 24 July 2026 — already past. Any tutorial you find using them is
> out of date.

### What this actually costs

Realistic numbers for an agency running ten active projects:

```text
One daily digest:
  input   ~2,000 tokens   (task list + system prompt)
  output    ~400 tokens   (three paragraphs)

10 projects × 30 days   = 300 digests / month
  input   600,000 tokens × $0.14  / 1M  = $0.084
  output  120,000 tokens × $0.28  / 1M  = $0.034
                                          ───────
                                          $0.12 / month
```

Add weekly and monthly summaries, meeting agendas and ad-hoc message polishing
and you are still **comfortably under $1 a month**. There is also a free tier of
5 million tokens to develop against.

### Prompt caching

The system prompt is identical on every call. DeepSeek charges **$0.0028/1M for
cached input against $0.14/1M for a miss — a 50× difference.** Keep the system
prompt byte-identical and put all variable content in the user message, and the
input cost effectively disappears.

This is why the prompt builder never interpolates the project name into the
system prompt. It goes in the user message.

---

## 2. What the AI does — four things

| # | Feature | Who triggers it | Output |
| --- | --- | --- | --- |
| 1 | **Client update** — daily, weekly, monthly | scheduled or PM | Three short paragraphs, plain language |
| 2 | **Polish my message** | PM | A rough note rewritten properly |
| 3 | **Meeting agenda** | PM | Discussion points from current project state |
| 4 | **Notes → tasks** | PM | Suggested tasks with owners, as drafts |

### What it does not do

No estimating. No auto-assigning. No breaking requirements into backlogs. No
health scores or risk predictions. No writing code. If a future idea does not
fit the sentence *"turn data we already have into words a human would write"*,
it does not belong in this module.

---

## 3. The rule everything else follows

> **Nothing generated is ever sent without a human pressing send.**

Every output lands in an editor with a send button. There is one exception, and
it is opt-in per project: a PM who has read twenty daily digests and trusts them
can switch on auto-send for **that project only**. Off by default, and switching
it on shows a confirmation naming the client who will receive them.

---

## 4. The digest pipeline

```text
18:00, project timezone
        │
        ▼
  Collect the day's activity
        │
        ▼
  ✂ Remove tasks where clientVisible = false        ← doc 04
  ✂ Remove all internal comments                    ← doc 04
        │
        ▼
  Nothing left?  ──► stop. Send nothing.
        │
        ▼
  Build the plain-text digest (deterministic template)
        │
        ├──── DeepSeek unavailable? ──► send the plain template. Done.
        ▼
  Generate the AI version
        │
        ▼
  Auto-send on?  ── yes ──► send to client
        │
        no
        ▼
  Email the PM: "Your update is ready — review and send"
```

Two things worth noting about that diagram:

**The filter runs before the prompt is built.** The model is never sent hidden
material with an instruction to be discreet. It simply never receives it. Prompt
instructions are not a security boundary.

**The plain template is always built first.** The AI improves the message; it is
not required to produce one. If DeepSeek is down at 18:00, the client still gets
their update — just in the deterministic format. A silent failure here means a
client hears nothing and nobody notices for a week.

### No-activity days

If nothing changed, nothing is sent. A digest that arrives daily saying "no
updates" is filtered to junk within a week, and then the one that matters is
filtered too.

---

## 5. PM customisation

You asked to be able to change what the AI produces. Four levels, from broadest
to finest.

### Level 1 — Per-project settings

Set once, applies to every generated update on that project.

```text
Tone           ● Professional   ○ Friendly   ○ Brief
Language       [ English ▾ ]    (defaults to the client's language)
Length         ○ Short (1 para)  ● Standard (3 paras)  ○ Detailed

Include:
  ☑ Completed this period
  ☑ In progress
  ☑ Blocked / waiting on you
  ☑ Coming next
  ☐ Overall progress percentage
  ☐ Due dates

Greeting     [ Hi Nadia,                              ]
Sign-off     [ Best regards,\nPriya — FreshCart team  ]
```

Sections are checkboxes rather than prose instructions because a checkbox is
verifiable and *"please mention what's blocked"* is not.

### Level 2 — Standing instructions

A free-text field on the project, added to every prompt for that project:

```text
Custom instructions for this client
┌──────────────────────────────────────────────────────────┐
│ Always refer to the launch date as "mid-September".      │
│ The client is non-technical — no jargon, no task keys.   │
│ Never mention staff by name, say "the team".             │
└──────────────────────────────────────────────────────────┘
```

This is where the things you learn about a client after three months live — the
phrasing they dislike, the date they are sensitive about. Worth its own field
because it is the difference between a draft you edit every time and one you send.

### Level 3 — Edit the draft

The main screen. This is where a PM actually spends their time.

```text
┌─ Weekly update — FreshCart Mobile App ──────────────────┐
│                                                          │
│  Hi Nadia,                                               │
│                                                          │
│  This week the team finished the sign-in work — your     │
│  customers can now sign in with their Google account,    │
│  and stay signed in between visits. Work has started on  │
│  the order history screen and is on track for the 16th.  │
│                                                          │
│  One item is waiting on your side: the database          │
│  migration needs approval from your DBA. It's currently  │
│  holding up two other pieces of work.                    │
│                                                          │
│  Next week we expect to finish order history and begin   │
│  the checkout review.                                    │
│                                                          │
│  Best regards,                                           │
│  Priya                                                   │
│                                                          │
├──────────────────────────────────────────────────────────┤
│ 🔄 Regenerate   Tone: [Professional ▾]   ✨ Shorten      │
│                                                          │
│ Based on 9 tasks · 3 completed · 1 blocked   [ Preview ] │
│                                                          │
│                            [ Save draft ]  [ Send now ]  │
└──────────────────────────────────────────────────────────┘
```

Plain editable text — not a locked AI output with an "accept" button. **Regenerate**
tries again with the same inputs, **Tone** re-runs with a different instruction,
**Shorten** and **Expand** adjust length.

*"Based on 9 tasks · 3 completed · 1 blocked"* is deliberate: a PM should be able
to see at a glance whether the draft covers what actually happened, and click
through to the list.

### Level 4 — Ignore it entirely

Clear the box and write your own. The AI is a starting point, not a workflow
step. A PM who writes better updates than the model should not be slowed down by
it.

---

## 6. Prompt design

Kept in one file, versioned, so a change in output quality is a reviewable diff.

**System prompt** — byte-identical on every call, for caching:

```text
You write short project updates from a software agency to its client.

Rules:
- Plain language. No task IDs, no internal jargon, no framework names.
- Describe outcomes, not activity. "Customers can now sign in with Google",
  not "completed the OAuth integration task".
- Never invent progress. If the data does not say something was finished,
  it was not finished.
- If something is waiting on the client, say so plainly and without blame.
- Do not apologise for normal progress.
- No headings, no bullet lists, no markdown. Flowing paragraphs only.
- Write in the language requested.
```

**User message** — everything variable:

```text
<period>Weekly update, 4–10 August 2026</period>
<project>FreshCart Mobile App</project>
<language>English</language>
<tone>Professional</tone>
<length>3 paragraphs</length>

<custom_instructions>
The client is non-technical. Never name individual staff.
</custom_instructions>

<completed>
- Google sign-in button and error states
- Session persistence between app launches
- Fix for incorrect cart totals
</completed>

<in_progress>
- Order history endpoint (due 14 Aug)
- Order history screen (due 16 Aug)
</in_progress>

<blocked>
- Database migration — waiting on the client's DBA to approve a window
</blocked>

<upcoming>
- Checkout review
</upcoming>
```

Task titles are rewritten into outcome language by the model, which is most of the
value — *"WEB-142 Implement /auth/google callback"* is not a sentence you send a
client.

---

## 7. Failure handling

| Failure | Behaviour |
| --- | --- |
| API unreachable | Send the plain template. Log it. Do not retry into the void |
| Timeout (> 30s) | Same |
| Rate limited | Retry twice with jittered backoff, then the plain template |
| Empty or malformed response | Plain template |
| Monthly spend cap reached | Plain template, and notify the admin once |

**The client always gets an update.** The AI changes how it reads, never whether
it arrives. That principle is why the template is generated first and the AI runs
second, rather than the reverse.

Every call is logged: which project, how many tokens, how much it cost, how long
it took, and whether it fell back. One admin screen shows the month's spend.

---

## 8. Guardrails

| | |
| --- | --- |
| **Never sees internal comments** | Filtered before the prompt is built, not requested in the prompt |
| **Never sees client-hidden tasks** | Same filter, same point in the pipeline |
| **Never sends autonomously** | Except with per-project auto-send, explicitly enabled |
| **Never invents facts** | The prompt forbids it; the PM reviews it; the task list is shown beside the draft |
| **Cost capped** | Per-month limit in config, falls back rather than overspending |
| **Client text is untrusted** | A client request pasted into a prompt is user input from outside the company. Wrapped in delimiters, never concatenated into instructions |

---

## 9. Configuration

```bash
DEEPSEEK_API_KEY=sk-...
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash
AI_ENABLED=true
AI_TIMEOUT_MS=30000
AI_MONTHLY_BUDGET_USD=10
```

`AI_ENABLED=false` turns the whole module off cleanly — digests still send, using
the plain template. Nothing breaks, and it is the first thing to try when
debugging something that looks like an AI problem.

---

## 10. Build order

This is **M10**, near the end, and that is deliberate. The AI writes about task
data — so tasks, statuses, comments, visibility rules and the digest all have to
exist and be correct first.

Building it earlier would mean generating summaries of data that is still
changing shape, and rewriting it twice.

---

*Pricing verified August 2026. DeepSeek publishes changes with notice, but check
before relying on the figures in §1 for a budget.*
