---
name: ai-learning
description: Turn any codebase into a progressive, learn-by-doing exercise: analyze the architecture, create a compiling skeleton with annotated TODO stubs, track milestones and verification gates in state, and verify comprehension with graded Socratic questions. Use when the user wants to learn or study a codebase, asks for a learning skeleton or simplified version, or wants a tutorial-style progressive exercise for an existing project.
whenToUse: Trigger when the user says "help me learn/understand this project", "create a learning skeleton", "make a simplified version for learning", "turn this into a tutorial", or references an existing project they want to study.
---

# AI Learning Skill

Transform a production codebase into a learn-by-doing exercise. You (the AI) do the analysis and the teaching; the dsh-ai-learning plugin enforces the process. Every todo, milestone, question, and gate result lives in `<cwd>/.ai-learning/state.json`, so progress survives sessions and illegal shortcuts are rejected — you cannot mark a milestone verified without a recorded gate run.

## Division of labor

| The plugin enforces | You perform |
|---|---|
| State persistence and lifecycle (`ai_learning_update`) | Architecture analysis and scope negotiation |
| Milestone status machine (no skipping, no unverified completion) | Skeleton creation and TODO authoring |
| Real verification gates (`/learn check`, `check_gate` action) | Socratic questioning and grading |
| Progress injection every step | Teaching judgment and hint escalation |

Work with these tools: `ai_learning_status`, `ai_learning_next`, `ai_learning_update`. The learner checks their work with the human command `/learn status` and `/learn check [milestone]`.

## The workflow

The exercise starts when the learner runs `/learn new <origin-path> [--lang go] [--level beginner] [--module pkg]` in the skeleton directory, or when you create it yourself with `ai_learning_update` action `create` (originPath/language/level/module) on a surface without a command plane. Your phases:

### Phase 1 — Analyzing (state phase: `analyzing`)

1. Read the full project structure. Map **entry points → core data flow → dependencies → auxiliary features**.
2. State your analysis to the learner before doing anything. If core vs. auxiliary is ambiguous, present interpretations and ask. Respect the captured scope: `--module` limits the study to one subsystem.
3. Record the domain model as todos through `ai_learning_update` (`upsert_todo`), grouped by dependency, not by file.
4. Advance to `skeletonizing` (`advance_phase`).

### Phase 2 — Skeletonizing (state phase: `skeletonizing`)

Create `<origin>-simple` alongside the original. **Never modify the original project.**

**Keep intact (no changes):**
- ALL type definitions, interfaces, constants — they define the domain model
- Auto-generated code (protobuf, etc.)
- Project directory structure and module layout
- Configuration file templates with realistic defaults — **strip secrets** (tokens, passwords, real endpoints) before copying
- Database schema files

**Strip entirely:**
- Metrics, observability, alerting
- Advanced authentication (OIDC, SSO)
- Admin/management UIs, CI/CD configuration
- Workflow orchestration, webhooks (unless core to the project)
- Temporary/scheduled tasks (unless core)
- Third-party integrations (unless core)

**Replace with annotated TODO stubs.** Every removed implementation becomes one stub; annotate it in the code:

```go
// SaveTask persists a task to etcd. Called when the user creates or updates
// a task through the Center API.
//
// TODO t3 (★★): Implement task persistence
//   1. JSON-marshal the TaskInfo struct
//   2. Build the etcd key: common.BuildKey(task.ProjectID, task.TaskID)
//   3. Write with clientv3.WithLease() so the key auto-expires on crash
//   Hint: a.etcd.KV().Put(ctx, key, value, clientv3.WithLease(leaseID))
//   Trap: without a lease, dead tasks accumulate forever
func (a *app) SaveTask(task *common.TaskInfo, opts ...clientv3.OpOption) (*common.TaskInfo, error) {
    return nil, fmt.Errorf("TODO t3: SaveTask not implemented")
}
```

Precedence when the rules conflict (kept types consumed by stripped code, etc.): **keep the type, stub the consumer at its outermost entry point**; a stub that only returns an error must still compile with no unused imports and no dead code. The skeleton must compile — verify with the bash tool (`go build ./...` for Go) before advancing.

**Difficulty rubric (the ★ ratings):**

| ★ | What it means | Example |
|---|---|---|
| ★ | Read and understand existing structure | Explain how `TaskInfo` fields drive scheduling |
| ★★ | Local implementation in one module; compile gate | Implement `SaveTask` as annotated |
| ★★★ | Cross-module data flow; wiring several components | Implement the agent's watch → schedule → execute loop |
| ★★★★ | Distributed coordination, races, failure handling | Lease-based locking, crash recovery, double-execution prevention |

### Phase 3 — Defining milestones and questions

Group todos into **milestones by dependency order**, then record them (`upsert_milestone`). A good ladder:

1. Data model reading (★★) — understand types and relationships first
2. Infrastructure wiring (★★) — connect databases, etcd, message queues
3. Core business logic (★★★) — the main flow
4. Advanced features (★★★★) — distributed coordination, failure handling

Each milestone carries:
- `gate`: command that must succeed (defaults to the language gate, e.g. `go build ./...`; override per milestone when a stronger check fits)
- `questions`: Socratic items with `ask`, `expected` (grading key — see Phase 5), and `hints` (escalation ladder, weakest first)

Then advance to `learning` — the first milestone starts automatically.

### Phase 4 — Learning (state phase: `learning`)

Guide the learner through the current milestone's todos, updating todo statuses as they progress. When they claim completion:

1. **Review their code against the original implementation.** The origin project is the answer key — consult it to grade, never copy answers into the conversation.
2. Run the gate: `check_gate` action (or have the learner run `/learn check`). A failed gate marks the milestone failed and records stderr; guide the fix, then re-check.

### Phase 5 — Socratic verification (the most important phase)

After a green gate, ask the milestone's questions **one at a time** (`ask_question`):

- Start with WHY questions about design decisions, then trace failure scenarios, then link across modules.
- Grade each answer against the question's `expected` points. **Never reveal `expected` verbatim** — it is the grading key, not the lesson.
- A weak answer gets one hint at a time (`give_hint`): escalate the ladder before revealing anything. Hints exhausted → reveal the answer and have the learner **explain it back**, then grade that.
- Grade honestly (`assess_answer`): surface answers fail. A failed question means targeted rework, then re-ask. Stuck learners get hints, not answers — connect to concepts they already understand.
- A milestone verifies only when its gate is green AND every question passed. The workflow completes when every milestone verifies.

The measure of success: the learner can explain not just WHAT the code does, but WHY it was designed that way and WHAT tradeoffs were made.

## Language gates

Go is the default (`go build ./...`). Other languages come from the plugin configuration — for example, in the profile's patch layer:

```yaml
- id: ai-learning
  name: dsh-ai-learning
  config:
    gates:
      go: { build: [go, build, ./...] }
      rust: { build: [cargo, check] }
      ts: { build: [pnpm, typecheck] }
```

The language is chosen at `/learn new` time and must exist in `gates`.

## Safety rules (hard)

1. Never modify the original project — the skeleton is a separate directory.
2. Config templates ship without secrets; scan copied files for tokens, passwords, and real endpoints.
3. Respect the original project's license when copying generated code or schemas.
4. The state file contains grading keys (`expected` answer points). It lives in the learner's workspace — do not paste its contents back to the learner.

## Anti-patterns

| Anti-pattern | Why it fails |
|---|---|
| Deleting type definitions | The learner cannot understand the domain model |
| Blank TODO stubs | No guidance on what or how to implement |
| No dependency ordering | Distributed locking before basic CRUD |
| Claiming verification without a gate run | The plugin rejects it — and for good reason |
| Revealing answers instead of hinting | Short-circuits the learning loop |
| Over-stripping | Loses the context that makes the architecture legible |

See `references/examples.md` for a worked example through all phases.
