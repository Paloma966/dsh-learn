# dsh-ai-learning

English | [中文](README.zh.md)

Turn any codebase into a progressive, learn-by-doing exercise — with state-tracked milestones, real verification gates, and graded Socratic follow-ups — as one installable DeepSeek Harness plugin bundle.

The plugin is the machinery; the teaching methodology ships as a bundled skill (`ai-learning`, editable Markdown in `assets/skills/ai-learning/`). The model performs the analysis and pedagogy, while the plugin enforces the process: progress lives in `<cwd>/.ai-learning/state.json`, illegal transitions are rejected, and no milestone can verify without a recorded gate run.

## Install

```sh
dsh plugin --profile <name> add dsh-ai-learning     # from npm
dsh plugin --profile <name> add ./dsh-ai-learning   # from a local checkout
dsh plugin --profile <name> add github:you/dsh-ai-learning#<sha>   # from git
```

Git installs fetch sources: pnpm runs the package's `prepare` script (build), so allow the build once (`dsh` prints the exact `allowBuilds` snippet), and pin a commit SHA.

## Usage

### For the learner

| Command | What it does |
|---|---|
| `/learn new <origin-path> [--lang go] [--level beginner] [--module pkg]` | Creates the exercise state in the session cwd |
| `/learn status` | Shows phase, milestones, todos, questions, gate runs |
| `/learn check [milestone]` | Runs the milestone's verification gate (e.g. `go build ./...`) and records the result |

Then work with the AI: the `ai-learning` skill loads automatically when the task matches (learning a codebase, creating a skeleton, tutorial-style exercises), or invoke it with `/ai-learning`.

### For the model

Three tools drive the exercise (registered when a tool registry is composed):

- `ai_learning_status` — current phase, milestones, todos, open questions.
- `ai_learning_next` — the current milestone with todos, gate, and Socratic questions including expected answer points for grading.
- `ai_learning_update` — one validated mutation per call: `create`, `upsert_todo`, `upsert_milestone`, `set_todo_status`, `advance_phase`, `ask_question`, `give_hint`, `assess_answer`, `retry_milestone`, `check_gate`.

Every step of an active exercise also receives an injected progress card (re-injected only when the state changes).

## Configuration

All fields are optional; the defaults follow Go-first.

| Field | Default | Meaning |
|---|---|---|
| `stateDir` | `.ai-learning` | Directory under the session cwd holding `state.json` |
| `gates` | `{ go: { build: [go, build, ./...] } }` | Per-language verification gates, keyed by the language chosen at create time |
| `maxCapturedOutput` | `8000` | Captured characters per gate output stream |

The default `gates` table covers **Go only** — choosing any other language at `/learn new` time fails with `GATE_UNKNOWN` until you add that language to `gates`.

Set them in the profile's patch layer:

```yaml
- id: ai-learning
  name: dsh-ai-learning
  config:
    gates:
      go: { build: [go, build, ./...] }
      rust: { build: [cargo, check] }
      ts: { build: [pnpm, typecheck] }
```

## State file

`<cwd>/.ai-learning/state.json` — one file that travels with the skeleton repository, so progress survives every session boundary:

- `phase`: `analyzing → skeletonizing → learning → complete` (forward only)
- `origin` / `scope`: what is studied and at what level
- `milestones[]`: id, title, todo ids, optional per-milestone gate, Socratic questions (`ask` / `expected` / `hints` / status / hint level), status
- `todos[]`: id, location, WHAT, steps, hint, difficulty (1–4), status
- `gates`: language gate snapshot taken at create time
- `records[]`: every executed gate with exit code, captured output, and duration

Verified milestones and their todos are frozen — the model cannot silently rewrite history.

## Development

```sh
pnpm install
pnpm typecheck   # tsc --noEmit
pnpm test        # builds first (pretest), then 52 vitest tests incl. a built-artifact composition test
pnpm build       # tsdown → lib/index.js, tsc → lib/types/
```

`pnpm pack` publishes `lib/`, `cordis.patch.yml`, and `assets/` only.

Verified against DeepSeek Harness 0.1.0-rc.5: `dsh plugin add` into a test profile, `--dump-config` composition, and a real headless boot where the model created an exercise through `ai_learning_update`.

## Model Experience

### Request context and condition

#### What the model sees

- The `ai-learning` skill summary in the skill catalog (`name` + `description`); the full methodology loads through the `skill` tool or the `/ai-learning` gesture, with `references/examples.md` on demand.
- During an active exercise, one injected user-role progress card per pre-step — only when the state file's `updatedAt` changed since the last injection for that agent. The card carries the exercise directive plus the full state JSON.
- Tool results from `ai_learning_status` / `ai_learning_next` / `ai_learning_update` (bounded strings; gate output is capped by `maxCapturedOutput`).

#### Token effect

Zero tokens when no exercise state exists. With an active state: one card per state mutation (state JSON size grows with recorded todos, milestones, questions, and gate records); tool results cost as ordinary tool results.

#### KV Cache effect

Append-only injections at the pre-step boundary; a card appears only after a state change, so unaffected requests keep stable prefixes. Tool results follow ordinary tool-result cache behavior.

## Known Limitations and Deferred Work

- **Structural host contracts.** The published `@deepseek-ai/dsh-*` rc.1 tree references unpublished packages, so this bundle cannot install dsh packages; the host surfaces (`ctx.fs`, `ctx.commands`, `ctx.tools`, `ctx.skills`, `ctx.shell`, `agent/pre-step`) are consumed through locally declared structural interfaces in `src/host-types.ts` and `src/fs-types.ts`. These hand-written interfaces must be updated by hand whenever the host contract changes — a maintenance burden that is not being refactored away yet. Revisit when the dsh packages publish a coherent dependency tree.
- **Grading keys are in the workspace.** `expected` answer points ride in the state file (and `ai_learning_next`), so a determined learner can read them — the same honor-system leak as the original project sitting next door; the skill instructs the model never to reveal them verbatim.
- **Commands need a command adapter.** `/learn new|status|check` register only in interactive compositions; headless/ACP flows use `ai_learning_update` `create` / `check_gate` instead.
- **Tool calls need a session cwd.** Tools reject when the execution has no agent attached.
- **Gate output is tail-truncated** to `maxCapturedOutput` (spill paths are not surfaced).
- **No versioned state migrations yet.** `schemaVersion: 1` is validated and rejected when unsupported, but there is no upgrader.
- **Language matrix untested beyond Go.** The gate table is generic, but only Go has been exercised end to end.
