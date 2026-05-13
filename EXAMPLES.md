# Examples: AI Learning Skill in Action

This document shows concrete examples of each phase using a hypothetical
distributed cron job scheduler (modeled after gopherCron).

---

## Phase 1: Architecture Analysis

### Correct: State analysis before modifying anything

> This is a distributed cron scheduling system with two components:
>
> **Center Service** — manages tasks via HTTP API, stores metadata in MySQL,
> uses etcd for real-time task distribution and service discovery.
>
> **Agent** — runs on worker nodes, receives tasks via gRPC from Center,
> schedules them locally using cron expressions, executes shell commands,
> reports results back.
>
> Core data flow: Create task → Store in etcd → Agent watch picks it up →
> Scheduler triggers at cron time → Executer runs shell command → Report
> result to Center → Center logs to MySQL.
>
> I'll keep: task CRUD in etcd, Agent scheduling loop, command execution,
> result reporting. I'll strip: workflow orchestration, webhooks, OIDC auth,
> metrics/Prometheus, Admin UI, temporary tasks, RBAC permissions.

### Wrong: Jumping straight to implementation

> I'll create a simplified version. Let me start by removing all the files
> that look complicated...
>
> [No analysis of what's core vs. auxiliary. User has no chance to correct.]

---

## Phase 2: Skeleton Creation

### Correct: Annotated TODO with hints

```go
// SaveTask persists a task to etcd. Called when user creates or updates a task
// through the Center API.
//
// TODO 3 (★★): Implement task persistence
//   1. JSON-marshal the TaskInfo struct
//   2. Build etcd key: common.BuildKey(task.ProjectID, task.TaskID)
//   3. Write with clientv3.WithLease() so the key auto-expires if Center crashes
//   4. Return the task as stored (useful when defaults were applied)
//
//   Hint: Use a.etcd.KV().Put(ctx, key, value, clientv3.WithLease(leaseID))
//   Hint: Don't forget to set task.CreateTime if empty
//   Trap: If you omit WithLease, dead tasks accumulate forever in etcd
func (a *app) SaveTask(task *common.TaskInfo, opts ...clientv3.OpOption) (*common.TaskInfo, error) {
    return nil, fmt.Errorf("TODO 3: SaveTask not implemented")
}
```

### Wrong: Blank stub with no guidance

```go
func (a *app) SaveTask(task *common.TaskInfo, opts ...clientv3.OpOption) (*common.TaskInfo, error) {
    // TODO
    return nil, nil
}
```

### Wrong: Removing entire interfaces

```go
// "I'll just delete the App interface, it's too complex"
// → Now the user can't understand how gin handlers depend on the app layer
```

---

## Phase 3: Learning Guide

### Correct: Clear roadmap

```markdown
## Learning Roadmap

### Step 1: Understand the data model (reading only)
- Read common/protocol.go — TaskInfo, TaskSchedulePlan, TaskExecutingInfo
- Read common/model.go — User, Project, TaskLog
- Read common/const.go — task states, events, etcd prefixes

### Step 2: Wire infrastructure (TODO 1, 27)
- app/app.go NewApp() — connect etcd + MySQL
- pkg/store/sqlStore/store.go — implement SQL store

### Step 3: Implement task CRUD (TODO 3-7)
- etcd-based task create/read/update/delete
- This is the foundation agents need to get tasks

...
```

### Wrong: Just a list of files

```markdown
## TODOs
- app.go
- scheduler.go
- executer.go
```
---

## Phase 4: Comprehension Verification

### Correct: Socratic follow-up

```
User: I've completed TODO 3-7 (etcd CRUD). Here's my code.

AI: [reviews code] The CRUD looks correct. A few questions:

1. You used KV.Put for SaveTask. The original code passes `opts ...clientv3.OpOption`.
   What would a caller use that for? Can you think of a scenario where you'd want
   to attach a lease to a task key?

2. Walk me through what happens when two Center instances try to SaveTask with
   the same project_id + task_id simultaneously. Is there a data race? Does
   etcd provide any guarantees?

3. Why do you think tasks are stored in etcd and not MySQL? What makes etcd
   more suitable for this specific use case?

User: Um, etcd is faster?

AI: "Faster" is part of it, but think deeper. In the next module, you'll
implement the Agent scheduler. How does the Agent know a new task was created?
What would happen if tasks were only in MySQL?
```

### Wrong: Vague praise with no verification

```
AI: Looks good! Moving on to the next module.
```

### Wrong: Giving the answer immediately

```
User: [vague answer]

AI: Actually, tasks are stored in etcd because of the Watch mechanism.
Agents subscribe to task prefixes and get real-time notifications when
tasks change. MySQL doesn't support push-based notifications...
```
---

## Anti-Patterns Summary

| Anti-Pattern | Why It Fails |
|---|---|
| Deleting type definitions | User can't understand the domain model |
| Blank TODO stubs | User has no idea what to implement |
| No difficulty ordering | User hits distributed locking before understanding basic CRUD |
| Surface-level verification | User memorizes code patterns without understanding design rationale |
| Giving answers too quickly | Short-circuits the learning process |
| Over-stripping | Loses essential context for understanding the architecture |
| Not compiling | User can't iterate and test their work |
