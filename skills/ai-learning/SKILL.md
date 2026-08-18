---
name: ai-learning-skill
description: Turn any codebase into a progressive, learn-by-doing exercise: analyze the architecture, create a compiling skeleton with annotated TODO stubs, track milestones and verification gates, and verify comprehension with graded Socratic questions. Use when the user wants to learn or study a codebase, asks for a learning skeleton or simplified version, or wants a tutorial-style progressive exercise for an existing project.
---

# AI Learning Skill

Transform a production codebase into a learn-by-doing exercise. You (the AI) do the analysis and the teaching. On DeepSeek Harness the bundled `dsh-ai-learning` plugin enforces the process (state machine, verification gates, progress injection); on Claude Code and Cursor there is no enforcement plugin, so you must enforce the same discipline yourself — track milestones explicitly, run the gate before verifying, and grade answers honestly.

## Division of labor

| Enforced by the host | Performed by you |
|---|---|
| State tracking and lifecycle (the DSH plugin) | Architecture analysis and scope negotiation |
| Milestone status machine — no skipping, no unverified completion | Skeleton creation and TODO authoring |
| Real verification gates | Socratic questioning and grading |
| Progress tracking | Teaching judgment and hint escalation |

On Claude Code / Cursor, substitute your own discipline for the "enforced by the host" column: keep an explicit milestone list, run the project's build before each milestone is verified, and record pass/fail.

## The workflow

The exercise starts when the learner asks to learn a project (`/learn new <origin-path> ...` on DeepSeek Harness, or a plain request on Claude Code / Cursor). Your phases:

### Phase 1 — Analyzing

1. Read the full project structure. Map **entry points → core data flow → dependencies → auxiliary features**.
2. State your analysis to the learner before doing anything. If core vs. auxiliary is ambiguous, present interpretations and ask. A `--module` scope limits the study to one subsystem.
3. Record the domain model as todos, grouped by dependency, not by file.

### Phase 2 — Skeletonizing

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

Precedence when the rules conflict (kept types consumed by stripped code, etc.): **keep the type, stub the consumer at its outermost entry point**; a stub that only returns an error must still compile with no unused imports and no dead code. The skeleton must compile — verify with the shell tool (`go build ./...` for Go) before advancing.

**Difficulty rubric (the ★ ratings):**

| ★ | What it means | Example |
|---|---|---|
| ★ | Read and understand existing structure | Explain how `TaskInfo` fields drive scheduling |
| ★★ | Local implementation in one module; compile gate | Implement `SaveTask` as annotated |
| ★★★ | Cross-module data flow; wiring several components | Implement the agent's watch → schedule → execute loop |
| ★★★★ | Distributed coordination, races, failure handling | Lease-based locking, crash recovery, double-execution prevention |

### Phase 3 — Defining milestones and questions

Group todos into **milestones by dependency order**. A good ladder:

1. Data model reading (★★) — understand types and relationships first
2. Infrastructure wiring (★★) — connect databases, etcd, message queues
3. Core business logic (★★★) — the main flow
4. Advanced features (★★★★) — distributed coordination, failure handling

Each milestone carries:
- `gate`: command that must succeed (defaults to the language gate, e.g. `go build ./...`; override per milestone when a stronger check fits)
- `questions`: Socratic items with `ask`, `expected` (grading key — see Phase 5), and `hints` (escalation ladder, weakest first)

### Phase 4 — Learning

Guide the learner through the current milestone's todos, updating todo statuses as they progress. When they claim completion:

1. **Review their code against the original implementation.** The origin project is the answer key — consult it to grade, never copy answers into the conversation.
2. Run the gate. A failed gate marks the milestone failed and records the error; guide the fix, then re-check.

### Phase 5 — Socratic verification (the most important phase)

After a green gate, ask the milestone's questions **one at a time**:

- Start with WHY questions about design decisions, then trace failure scenarios, then link across modules.
- Grade each answer against the question's `expected` points. **Never reveal `expected` verbatim** — it is the grading key, not the lesson.
- A weak answer gets one hint at a time: escalate the ladder before revealing anything. Hints exhausted → reveal the answer and have the learner **explain it back**, then grade that.
- Grade honestly: surface answers fail. A failed question means targeted rework, then re-ask. Stuck learners get hints, not answers — connect to concepts they already understand.
- A milestone verifies only when its gate is green AND every question passed. The workflow completes when every milestone verifies.

The measure of success: the learner can explain not just WHAT the code does, but WHY it was designed that way and WHAT tradeoffs were made.

## Language gates

Go is the default (`go build ./...`). On DeepSeek Harness other languages come from the plugin configuration (`gates` in the profile's patch layer). On Claude Code / Cursor, just run the project's own build/test command and treat it as the gate:

| Language | Typical gate |
|---|---|
| Go | `go build ./...` |
| Rust | `cargo check` |
| TypeScript | `pnpm typecheck` |

Pick the gate at start time and apply it consistently to every milestone.

## Safety rules (hard)

1. Never modify the original project — the skeleton is a separate directory.
2. Config templates ship without secrets; scan copied files for tokens, passwords, and real endpoints.
3. Respect the original project's license when copying generated code or schemas.
4. Keep grading keys (`expected` answer points) out of what you show the learner.

## Anti-patterns

| Anti-pattern | Why it fails |
|---|---|
| Deleting type definitions | The learner cannot understand the domain model |
| Blank TODO stubs | No guidance on what or how to implement |
| No dependency ordering | Distributed locking before basic CRUD |
| Claiming verification without a gate run | Fake progress; the learner never confronts their build |
| Revealing answers instead of hinting | Short-circuits the learning loop |
| Over-stripping | Loses the context that makes the architecture legible |

See `EXAMPLES.md` for a worked example through all phases.
