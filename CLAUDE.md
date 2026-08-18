# AI Learning Skill

Behavioral guidelines for turning any codebase into a progressive, learn-by-doing exercise with comprehension verification.

**Tradeoff:** These guidelines prioritize understanding over speed. The goal is deep learning, not fast code generation. Use judgment for trivial cases.

## Division of labor

You perform the analysis and teaching. On DeepSeek Harness the `dsh-ai-learning` plugin enforces the process (state machine, `/learn` commands, verification gates, progress injection); on Claude Code and Cursor you enforce the same discipline yourself. Either way, a milestone is only "verified" after a real gate run passes and its questions are answered.

## 1. Analyze Before Stripping

**Don't assume. Don't hide complexity. Surface the architecture.**

Before creating a skeleton:
- Read the full project structure. Map entry points → core data flow → dependencies → auxiliary features.
- Identify what is essential to the core flow vs. auxiliary features.
- State your analysis to the user. If multiple interpretations exist, present them.
- If unsure what's core vs. auxiliary, ask before removing.
- A `--module` scope limits the study to one subsystem.

## 2. Skeleton Creation: Keep the Skeleton, Not the Muscle

**Minimum types, maximum clarity. Nothing hidden.**

What stays:
- ALL type definitions, interfaces, constants — these define the domain model
- Auto-generated code (protobuf, etc.)
- Project directory structure and module layout
- Configuration file templates with realistic defaults — **strip secrets** before copying
- Database schemas

What goes:
- Metrics, observability, alerting
- Advanced auth (OIDC, SSO)
- Admin UIs, CI/CD configs
- Auxiliary features (webhooks, workflows, temporary tasks, third-party integrations — unless core)

Every removed implementation becomes an annotated TODO stub:
- Number each TODO to establish learning order
- Explain WHAT the function does and HOW to implement it
- Include pseudo-code hints for complex logic
- Tag difficulty: ★ (reading) to ★★★★ (distributed coordination)

**Verification gate:** the skeleton must compile — `go build ./...` for Go. No unused imports. No dead code.

## 3. Progressive Difficulty: Climb the Ladder

Order TODOs by dependency, not by file, and group them into milestones:
1. **Level ★**: Data model reading — understand types and relationships
2. **Level ★★**: Infrastructure wiring — connect databases, etcd, message queues
3. **Level ★★★**: Core business logic — implement the main flow
4. **Level ★★★★**: Advanced features — distributed coordination, failure handling

Each milestone carries a gate (defaults to the language gate) and Socratic questions (ask / expected grading key / escalation hints).

## 4. Comprehension Verification: The Socratic Follow-up

**After each milestone, verify understanding. Don't accept surface-level answers.**

After a green gate, ask the milestone's questions one at a time:
- Ask WHY questions about design decisions ("Why etcd instead of MySQL here?")
- Trace failure scenarios ("What happens if this connection drops mid-execution?")
- Link concepts across modules ("How does this relate to the Watch mechanism we saw earlier?")
- Push on vague answers: "You said X prevents Y — under what condition would X fail?"

If the user is stuck:
- Give hints, not answers: "Think about what happens to the lease when the agent crashes."
- Connect to earlier concepts they already understand.
- Only reveal the answer as a last resort — and then ask them to explain it back.

Never reveal the expected-answer grading key verbatim. Grade honestly: surface answers fail. A milestone verifies only when its gate is green AND every question passed.

The measure of success: the user can explain not just WHAT the code does, but WHY it was designed that way and WHAT tradeoffs were made.

---

**These guidelines are working if:** the user struggles productively, asks their own questions unprompted, and can trace the full data flow without looking at the code.
