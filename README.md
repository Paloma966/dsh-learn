# AI Learning Skill

> Turn any codebase into a learn-by-doing exercise. Skeleton, implement, verify.

## The Problem

Reading source code is passive. You read 10,000 lines, nod along, then realize you can't explain how the system actually works. Real understanding comes from **building** — but jumping into a production codebase is overwhelming. Where do you start?

## The Solution

AI Learning Skill transforms a complex production codebase into a **progressive, fill-in-the-blank exercise.** The AI:

1. **Analyzes** the architecture and identifies what's core vs. auxiliary
2. **Strips** non-essential features while keeping the skeleton intact
3. **Creates** numbered, annotated TODO stubs ordered by difficulty
4. **Verifies** the skeleton compiles (you can build and test as you go)
5. **Questions** you after each milestone to confirm genuine understanding

You learn by implementing one piece at a time, with hints when you're stuck, and probing questions that force you to think about **why** things are designed a certain way.

## How It Works

### Phase 1: Architecture Analysis

The AI reads the full project, maps the architecture, and presents its analysis for your confirmation. You decide what stays and what goes.

### Phase 2: Skeleton Creation

A `<project>-simple` directory is created alongside the original. All type definitions and interfaces are preserved. Business logic is replaced with guided TODO stubs like:

```go
// SaveTask persists a task to etcd.
//
// TODO 3 (★★): Implement task persistence
//   1. JSON-marshal the TaskInfo
//   2. Write to etcd with key = common.BuildKey(projectID, taskID)
//   3. Use clientv3.WithLease() for automatic cleanup
//   4. Return the serialized task
//
//   Hint: a.etcd.KV().Put(ctx, key, value, clientv3.WithLease(leaseID))
func (a *app) SaveTask(task *common.TaskInfo) (*common.TaskInfo, error) {
    return nil, fmt.Errorf("TODO 3: SaveTask not implemented")
}
```

### Phase 3: Progressive Implementation

TODOs are organized by dependency, not by file:

| Level | What | Example |
|---|---|---|
| ★ | Read and understand data models | Struct definitions, constants |
| ★★ | Wire infrastructure | Connect etcd, MySQL |
| ★★★ | Core business logic | Scheduling loop, command execution |
| ★★★★ | Distributed coordination | Leader election, distributed locks |

### Phase 4: Comprehension Checks

After each milestone, the AI asks questions that test **understanding**, not memorization:

- "Why is this stored in etcd instead of MySQL?"
- "What happens if two agents execute the same task simultaneously?"
- "Trace the full lifecycle from creation to completion. Where are the failure points?"

Surface-level answers get follow-up questions. The goal is for you to explain not just **what** the code does, but **why** it was designed that way.

## Installation

### As a Claude Code Plugin

```bash
# Add from marketplace
/plugin marketplace add chun/ai-learning-skill

# Install
/plugin install ai-learning-skill@ai-learning-skill
```

### As a Standalone CLAUDE.md

Copy `CLAUDE.md` to your project root. Any Claude Code session in that directory will follow the AI Learning guidelines.

### With Cursor

Copy `.cursor/rules/ai-learning.mdc` to your project's `.cursor/rules/` directory. Activate the rule when you want to create a learning skeleton.

## Usage

```
# Navigate to any project you want to learn
cd /path/to/complex-project

# Ask Claude Code
> I want to learn this project. Create a learning skeleton.

# The AI will:
# 1. Analyze the architecture
# 2. Create <project>-simple alongside it
# 3. Give you a numbered TODO list
# 4. Let you implement piece by piece
# 5. Question you after each milestone
```

## Example

[EXAMPLES.md](EXAMPLES.md) contains detailed before/after examples using a distributed cron scheduler.

## How to Know It's Working

- You can explain the full data flow without looking at the code
- You catch yourself asking "why is it designed this way?" before the AI asks you
- You notice design patterns from the project appearing in your own code
- The TODOs feel progressively harder but never overwhelming

## Customization

Edit `skills/ai-learning/SKILL.md` to adjust:
- Which features are stripped vs. kept
- Questioning depth and style
- Difficulty level thresholds

## License

MIT
