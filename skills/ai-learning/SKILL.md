---
name: ai-learning-skill
description: Turn any codebase into a progressive learning skeleton. Analyze project architecture, strip non-essentials, create numbered TODO stubs with implementation hints, and verify understanding through Socratic questioning after each completion milestone.
---

# AI Learning Skill

Transform a production codebase into a learn-by-doing exercise. The AI analyzes the project, strips away non-core features, leaves a compiling skeleton with annotated TODO stubs, then questions the learner to verify genuine understanding — not surface-level memorization.

## When to Use

Trigger when the user says any of:
- "I want to learn this project" / "help me understand this codebase"
- "create a learning skeleton" / "make a simplified version for learning"
- "turn this into a tutorial" / "progressive learning exercise"
- References an existing project and wants to study it

## The Process

### Phase 1: Architecture Analysis

Read the full project structure. Identify:

1. **Entry points** — How does the system start? (main.go, command handlers)
2. **Core data flow** — What is the primary data path through the system?
3. **External dependencies** — What does it connect to? (databases, message queues, RPC)
4. **Supporting features** — What is auxiliary? (metrics, admin UI, advanced auth)

State your analysis to the user before proceeding. Example:

> This is a distributed X system. Center manages metadata in etcd, Agents execute work items on a cron schedule, communication is via gRPC. Core flow: Create item → Store in etcd → Agent picks up → Execute → Report result. I'll keep the task lifecycle, strip workflow/webhook/admin features.

### Phase 2: Skeleton Creation

Create a new directory `<project>-simple` alongside the original. Follow these rules:

**Keep intact (no changes):**
- All type definitions (structs, interfaces, constants) — these define the domain model
- Auto-generated code (protobuf, etc.)
- Project directory structure and module layout
- Configuration file skeletons (with realistic defaults)
- Database schema files (table definitions)

**Strip entirely:**
- Metrics, observability, alerting
- Advanced authentication (OIDC, SSO)
- Admin/management UIs
- CI/CD configuration
- Workflow orchestration, webhooks (unless core to the project)
- Temporary/scheduled tasks (unless core)
- Third-party integrations (unless core)

**Replace with annotated TODOs:**
- Every function body that implements business logic
- Every database query method
- Every gRPC/RPC handler
- Every scheduling/matching algorithm

**TODO annotation format:**

```go
// SaveTask persists a task to etcd.
//
// TODO 3: Implement
//   1. JSON-marshal the TaskInfo
//   2. Write to etcd with key = common.BuildKey(projectID, taskID)
//   3. Return the serialized task
//   Hint: Use clientv3.WithLease() for automatic cleanup
func (a *app) SaveTask(task *common.TaskInfo) (*common.TaskInfo, error) {
    return nil, fmt.Errorf("TODO: SaveTask not implemented")
}
```

Each TODO must include:
- **Number** — establishes learning order
- **What** — one-line description of the method's purpose
- **Steps** — numbered implementation hints
- **Hint** (optional) — traps to avoid, design rationale, relevant Go/library features
- **Difficulty** (optional) — ★ to ★★★★

**Order TODOs by dependency:**
1. Data model reading (understand types first)
2. Infrastructure wiring (connect to databases, etcd)
3. Basic CRUD (read/write operations)
4. Core business logic (the main flow)
5. Advanced features (distributed coordination, edge cases)

**Verification gate:** The skeleton MUST compile (`go build ./...` passes, no unused imports).

### Phase 3: Create the Learning Guide

Generate a `CLAUDE.md` or `LEARNING.md` in the skeleton directory containing:

- Architecture diagram (ASCII art)
- Directory overview table with completion status
- Learning roadmap (which TODOs to tackle in which order)
- Full TODO index with numbers, files, methods, and difficulty ratings
- Running instructions

### Phase 4: Comprehension Verification (Socratic Follow-up)

This is the most important phase. After the user completes a milestone (a group of related TODOs), do NOT just say "good job." Ask probing questions:

**For infrastructure questions:**
- "Why is this data stored in X instead of Y? What would break if we swapped?"
- "What happens if the connection to X fails? Is there a fallback?"

**For design questions:**
- "Why is this an interface instead of a concrete type?"
- "What problem does this abstraction solve? Could we remove it?"

**For distributed systems:**
- "Trace the full lifecycle of a task from creation to completion. Where are the failure points?"
- "If two agents pick up the same task simultaneously, what prevents double execution?"

**For Go-specific questions:**
- "Why is this channel buffered to 3000? What happens if it fills up?"
- "Why use sync.Map here instead of a regular map with a mutex?"

**Questioning rules:**
- Don't accept one-sentence answers. Follow up: "What specifically would break? Walk me through the scenario."
- If the user gives a surface-level answer, push deeper: "You said X prevents Y — but under what condition would X fail?"
- If the user is stuck, give hints, not answers: "Think about what happens to the lease when the agent crashes."
- Link back to earlier concepts: "Remember when we talked about the etcd Watch mechanism — how does that apply here?"

## Example Interaction

```
User: I finished TODO 3-7 (etcd CRUD operations). Can you check?

AI: Let me review. [reads code]

Good, the basic CRUD looks correct. Now, a few questions:

1. In GetTask, you used a simple KV.Get. What happens if two Centers 
   try to update the same task simultaneously? Is there a race condition?

2. Your DeleteTask just removes the key. But what if an Agent is 
   currently executing that task? Walk me through what would happen.

3. Why do you think the original code stores tasks in etcd instead of 
   MySQL? What property of etcd makes it suitable for this?
```

## Important Defaults

- The skeleton directory name is `<original-project>-simple`
- Place it alongside the original project
- Always `go mod tidy && go build ./...` to verify compilation
- If the original project has a `CLAUDE.md`, preserve its behavioral guidelines in the skeleton
- Prefer keeping something as-is over stripping it when uncertain — the user can always ignore it
