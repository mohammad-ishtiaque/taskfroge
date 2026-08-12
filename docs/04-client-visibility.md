# 04 — Client Visibility

**The requirement:** when a PM creates a project, they decide what the client
will and will not see.

**The constraint I am holding myself to:** I criticised Jira for pushing every
decision onto the customer as a configuration option. A visibility settings panel
is exactly that failure mode waiting to happen. So this design is deliberately
small — **three presets, six toggles, one per-task override, and one rule that
cannot be switched off.**

---

## 1. The one rule that is not a setting

> **Internal comments are never visible to a client. Ever. Under any preset.**

This is not a toggle, because a toggle implies someone might turn it off, and the
day someone does is the day a developer's honest note about a bad estimate lands
in a client's inbox.

It is enforced in three places, and all three are tested:

1. The database query filters `isInternal = false` for client requests
2. The serialiser strips internal comments even if a query forgets
3. An integration test signs in as a client and asserts the internal comment is
   absent from the response body — not hidden in the UI, **absent from the JSON**

---

## 2. Three presets

At project creation the PM picks one. Most will never look further.

### 🔓 Open — full transparency

The client sees the board, every task, every status change, who is working on
what, and when it is due. Nothing hidden except internal comments.

*Use for: technical clients, long-running partnerships, retainers.*

### 📊 Summary — progress without the machinery

The client sees progress, what was completed, what is coming, and milestones.
They do **not** see the working board, individual task movement, or who is
assigned to what.

*Use for: non-technical clients, and anyone who will phone you the first time
they see a card in a column called "Blocked".*

### ⚙️ Custom

The six toggles below. Starts from Open.

---

## 3. The six toggles

Only these six. Anything not listed is visible if the preset says so.

| Toggle | Default (Open) | Default (Summary) | Why it exists |
| --- | :---: | :---: | --- |
| **Task board** | on | off | Some clients want the kanban; some find it noise |
| **Assignee names** | on | off | Some agencies do not name individual staff to clients |
| **Due dates** | on | on | Rarely hidden, but a client who treats every internal date as a promise is a real problem |
| **Time estimates & logged hours** | **off** | off | Commercially sensitive. A client seeing "estimated 4h, logged 11h" starts a conversation you did not plan. **Off by default even on Open** |
| **Blocked reasons** | on | off | "Waiting on client DBA" is useful. "Rahim is on leave" is not — and this is the toggle for teams who cannot yet trust their own wording |
| **Attachments** | on | on | Design files and screenshots. Off for projects handling sensitive material |

### Why time tracking is off even on "Open"

It is the only default that contradicts its own preset, so it needs a reason.
Estimates are internal planning figures, not commitments, and clients read them
as commitments. Turning it on is a deliberate act of transparency; leaving it on
by accident is a commercial risk. The PM can enable it in one click.

---

## 4. Per-task override

Project settings set the default. A single task can differ.

```text
Task.clientVisible : boolean   — inherits the project default on creation
```

Two directions, both needed:

- **Hide one task** on an otherwise open project. Internal refactors, spikes,
  and the task called "Fix the mess in the auth module".
- **Show one task** on a Summary project. A single deliverable the client needs
  to look at, without opening the whole board.

The task detail screen shows the current state plainly:

```text
👁  Visible to client        [ Hide from client ]
🔒  Hidden from client       [ Show to client ]
```

Changing it writes an activity entry, because "when did this become visible?" is
a question that gets asked after the fact.

---

## 5. What happens when something is hidden

Hiding is not a UI filter. A hidden task must be **absent**, not merely
unrendered — a client with the browser network tab open is not a threat model,
it is a Tuesday.

| Surface | Behaviour when a task is hidden |
| --- | --- |
| API list responses | Excluded from the query. Not returned and then filtered |
| Task detail by direct URL | `404`, not `403`. A `403` confirms the task exists |
| Board | Absent. Column counts recalculated so `12` does not become `9` visibly |
| Progress percentage | Computed from visible tasks only, so the number is internally consistent |
| Activity feed | Entries for hidden tasks excluded |
| Search | Not matched |
| Notifications | Never sent to a client about a hidden task |
| **Daily digest** | Excluded — see below |
| **AI draft** | The model never receives it — see below |

That last pair matters most. It is easy to hide a task from the board and then
have the AI cheerfully summarise it in the client's Friday email.

---

## 6. Preview as client

One button on the project settings screen: **"See it as your client sees it."**

It opens the client view, rendered against real data, with a banner across the
top. It is a read-only impersonation of the *view*, not of a user — no actions,
no chat, nothing written.

This is the feature that makes the rest trustworthy. A settings panel nobody can
verify is a settings panel nobody believes. A PM who can look at exactly what
their client will see will actually use the controls.

---

## 7. Where it lives in the project creation flow

Three steps. This is the third, and it is not skippable — there is no "set it up
later", because later means never and the default gets discovered by a client.

```text
Step 1  Project details      name, key (WEB), description, client
Step 2  Team                 add PM(s) and developers
Step 3  What the client sees ← this document

        ○ Open      Full transparency. They see the board and all tasks.
        ● Summary   Progress and milestones. No working board.
        ○ Custom    Choose individually.

        Internal comments are never shown to clients.        ← stated, not a toggle

        [ Preview as client ]              [ Create project ]
```

Editable afterwards from project settings. Changing it writes an activity entry
naming who changed it and when.

---

## 8. Data model

```text
ProjectVisibility
  projectId          uuid   (primary key — one row per project)
  preset             enum   OPEN | SUMMARY | CUSTOM
  showBoard          bool
  showAssignees      bool
  showDueDates       bool
  showTimeTracking   bool   -- default false
  showBlockedReasons bool
  showAttachments    bool
  updatedById        uuid
  updatedAt          timestamp

Task
  clientVisible      bool   -- default from the project preset
```

Stored as a row rather than derived from the preset, so changing a preset later
does not silently rewrite a PM's custom choices.

---

## 9. Enforcement

One function, called by every client-facing query. Not a convention — a single
code path.

```ts
// Applied to every request where the caller's role is CLIENT.
function clientTaskFilter(projectId: string): TaskWhere {
  return { projectId, clientVisible: true, archivedAt: null };
}

// And a field-level pass before serialising:
function redactForClient(task: Task, settings: ProjectVisibility): ClientTask {
  return {
    ...task,
    assignee:      settings.showAssignees      ? task.assignee      : null,
    dueDate:       settings.showDueDates       ? task.dueDate       : null,
    estimateHours: settings.showTimeTracking   ? task.estimateHours : null,
    loggedHours:   settings.showTimeTracking   ? task.loggedHours   : null,
    blockedReason: settings.showBlockedReasons ? task.blockedReason : null,
    comments:      task.comments.filter((c) => !c.isInternal),   // never optional
  };
}
```

**Tests that must exist before this module ships:**

- A client requesting a hidden task by direct id receives `404`
- A client's task list never contains a task with `clientVisible = false`
- A client's response body never contains a comment with `isInternal = true`
- With `showTimeTracking = false`, no response contains `estimateHours` or
  `loggedHours` — checked on the raw JSON, not the rendered page
- Switching a preset does not overwrite existing custom toggles
- The daily digest for a client contains no hidden task
- The AI prompt payload contains no hidden task and no internal comment

Those seven tests are the module. Everything else is the screen around them.

---

## 10. Interaction with the digest and the AI

Restating, because this is where a visibility bug would do the most damage — it
would be sent by email, to the client, automatically, with nobody reading it
first.

```text
Task set → filter clientVisible → filter internal comments
         → build digest → build AI prompt → PM reviews → send
```

The filtering happens **before** the prompt is assembled. The model is never sent
hidden material and asked to be discreet about it; it simply never receives it.
Prompt instructions are not a security boundary.

Detailed in [`05-ai-updates.md`](05-ai-updates.md).
