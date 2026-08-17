/**
 * Model-facing tools: `ai_learning_status`, `ai_learning_next`, and
 * `ai_learning_update`.
 *
 * The tools are the model's handle on the engine: the model performs the
 * analysis and pedagogy, but every mutation crosses the engine's validated
 * transitions and is persisted immediately. Registration goes through
 * `ctx.tools` when a tool registry is composed; definitions are plain
 * objects so no `@deepseek-ai/dsh-*` runtime import is needed.
 *
 * @module dsh-ai-learning/tools
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { AiLearningEngine } from './engine.ts'
import { isLearningError } from './errors.ts'
import { runMilestoneGate } from './gate.ts'
import type { TextBlockShape, ToolDefinitionShape, ToolRunContextShape, ToolsServiceShape } from './host-types.ts'
import type { LearningState, Milestone, Phase, Question, Todo } from './types.ts'

const TODO_STATUS = ['pending', 'in_progress', 'done'] as const
const MILESTONE_STATUS = ['pending', 'in_progress', 'verified', 'failed'] as const
const QUESTION_STATUS = ['unasked', 'asked', 'passed', 'failed'] as const
const PHASES = ['analyzing', 'skeletonizing', 'learning', 'complete'] as const
const LEVELS = ['beginner', 'intermediate', 'advanced'] as const

const TODO_SCHEMA = {
  type: 'object',
  required: ['id', 'where', 'what', 'steps', 'difficulty', 'status'],
  properties: {
    id: { type: 'string', description: 'Stable id referenced by milestones, e.g. "t3".' },
    where: { type: 'string', description: 'File and symbol location, e.g. "internal/store/task.go SaveTask".' },
    what: { type: 'string', description: 'One-line description of the method purpose.' },
    steps: { type: 'array', items: { type: 'string' }, description: 'Numbered implementation hints.' },
    hint: { type: 'string', description: 'Optional traps, design rationale, and language features.' },
    difficulty: { type: 'integer', enum: [1, 2, 3, 4], description: '1 (reading the data model) to 4 (distributed coordination).' },
    status: { type: 'string', enum: [...TODO_STATUS] },
  },
  additionalProperties: false,
} as const

const QUESTION_SCHEMA = {
  type: 'object',
  required: ['ask', 'expected', 'hints', 'status', 'hintLevel'],
  properties: {
    ask: { type: 'string', description: 'The Socratic question to ask the learner.' },
    expected: {
      type: 'array',
      items: { type: 'string' },
      description: 'Expected answer points used as the assessment key. Never reveal them verbatim.',
    },
    hints: { type: 'array', items: { type: 'string' }, description: 'Escalating hints, one at a time before any reveal.' },
    status: { type: 'string', enum: [...QUESTION_STATUS] },
    hintLevel: { type: 'integer', description: 'How many hints were already offered.' },
    note: { type: 'string', description: 'Optional assessment note recorded when the answer settles.' },
  },
  additionalProperties: false,
} as const

const MILESTONE_SCHEMA = {
  type: 'object',
  required: ['id', 'title', 'todos', 'questions'],
  properties: {
    id: { type: 'string', description: 'Stable id, e.g. "m1".' },
    title: { type: 'string', description: 'Short human title, e.g. "Task CRUD in etcd".' },
    todos: { type: 'array', items: { type: 'string' }, description: 'Todo ids this milestone covers.' },
    gate: {
      type: 'object',
      required: ['build'],
      properties: {
        build: { type: 'array', items: { type: 'string' }, description: 'Command and arguments; defaults to the language gate.' },
      },
      additionalProperties: false,
    },
    questions: { type: 'array', items: QUESTION_SCHEMA },
  },
  additionalProperties: false,
} as const

/** Register the three model-facing tools when a tool registry is composed. */
export function registerTools(ctx: Context, engine: AiLearningEngine): void {
  const tools = ctx.get('tools') as ToolsServiceShape | undefined
  if (tools === undefined) return
  tools.register(statusTool(engine))
  tools.register(nextTool(engine))
  tools.register(updateTool(ctx, engine))
}

/** Resolve the session cwd for a tool call, or reject when it is absent. */
async function toolCwd(engine: AiLearningEngine, exec: ToolRunContextShape): Promise<LearningState> {
  const cwd = exec.agent?.session.header.cwd
  if (cwd === undefined) {
    throw new Error('ai_learning tools need a session cwd; this call has no agent attached')
  }
  const state = await engine.load(cwd)
  if (state === undefined) {
    throw new Error(`no learning state under ${cwd}; run "/learn new <origin-path>" first`)
  }
  return state
}

function text(text: string): TextBlockShape[] {
  return [{ type: 'text', text }]
}

function statusTool(engine: AiLearningEngine): ToolDefinitionShape {
  return {
    name: 'ai_learning_status',
    description:
      'Read the current ai-learning state for this session cwd: phase, milestones, todo progress, open Socratic questions, and gate records. Use before acting on a learning exercise.',
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
    output: { schema: { type: 'string' }, render: (_args, value) => text(String(value)) },
    async execute(_args, exec) {
      const state = await toolCwd(engine, exec)
      return engine.describe(state)
    },
  }
}

function nextTool(engine: AiLearningEngine): ToolDefinitionShape {
  return {
    name: 'ai_learning_next',
    description:
      'Return what to do next in the ai-learning exercise for this session cwd: the current milestone with its todos, gate, and Socratic questions (including expected answer points for grading).',
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
    output: { schema: { type: 'object' }, render: (_args, value) => text(JSON.stringify(value, null, 2)) },
    async execute(_args, exec) {
      const state = await toolCwd(engine, exec)
      return nextPayload(state)
    },
  }
}

function nextPayload(state: LearningState): Record<string, unknown> {
  const current = state.milestones.find((milestone) => milestone.status === 'in_progress')
  const gate = current === undefined ? undefined : (current.gate ?? state.gates[state.origin.language])
  return {
    phase: state.phase,
    current:
      current === undefined
        ? null
        : {
          id: current.id,
          title: current.title,
          status: current.status,
          gate,
          todos: current.todos
            .map((id) => state.todos.find((todo) => todo.id === id))
            .filter((todo) => todo !== undefined),
          questions: current.questions,
        },
    nextMilestone: state.milestones.find((milestone) => milestone.status === 'pending')?.id ?? null,
    guidance:
      state.phase === 'analyzing'
        ? 'Analyze the origin project and record the architecture with ai_learning_update (upsert todos and milestones), then advance phases.'
        : state.phase === 'skeletonizing'
          ? 'Create the skeleton: strip non-core features, leave annotated TODO stubs, and verify the compile gate with /learn check.'
          : state.phase === 'learning'
            ? 'Work through the current milestone: guide the learner through its todos, ask the Socratic questions, and grade answers against the expected points.'
            : 'All milestones verified: celebrate and summarize what the learner can now explain.',
  }
}

function updateTool(ctx: Context, engine: AiLearningEngine): ToolDefinitionShape {
  return {
    name: 'ai_learning_update',
    description:
      'Apply one validated mutation to the ai-learning state for this session cwd: record todos and milestones, move todo statuses, advance phases, drive Socratic questions, and retry milestones. Every change is persisted immediately.',
    parameters: {
      type: 'object',
      required: ['action'],
      properties: {
        action: {
          type: 'string',
          enum: [
            'create',
            'upsert_todo',
            'upsert_milestone',
            'set_todo_status',
            'advance_phase',
            'ask_question',
            'give_hint',
            'assess_answer',
            'retry_milestone',
            'check_gate',
          ],
        },
        originPath: { type: 'string', description: 'Absolute path of the original project, for action create.' },
        language: { type: 'string', description: 'Language key for action create, e.g. "go".' },
        level: { type: 'string', enum: ['beginner', 'intermediate', 'advanced'], description: 'Learner level for action create.' },
        module: { type: 'string', description: 'Optional submodule focus for action create.' },
        todo: TODO_SCHEMA,
        milestone: MILESTONE_SCHEMA,
        todoId: { type: 'string' },
        status: { type: 'string', enum: [...TODO_STATUS] },
        phase: { type: 'string', enum: [...PHASES] },
        milestoneId: { type: 'string' },
        questionIndex: { type: 'integer' },
        passed: { type: 'boolean' },
        note: { type: 'string', description: 'Assessment note for assess_answer.' },
      },
      additionalProperties: false,
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(String(value)) },
    async execute(args, exec) {
      const cwd = exec.agent?.session.header.cwd
      if (cwd === undefined) {
        throw new Error('ai_learning tools need a session cwd; this call has no agent attached')
      }
      const update = args as UpdateArgs
      if (update.action === 'create') {
        const state = await engine.create(cwd, {
          origin: {
            path: requireFieldValue(update, 'originPath', 'create'),
            language: update.language ?? 'go',
          },
          scope: {
            level: update.level ?? 'beginner',
            ...(update.module !== undefined ? { module: update.module } : {}),
          },
        })
        return `exercise created for ${state.origin.path} (${state.origin.language}, ${state.scope.level}).\n${engine.describe(state)}`
      }
      const state = await toolCwd(engine, exec)
      if (update.action === 'check_gate') {
        return await checkGate(ctx, engine, exec, cwd, state, update)
      }
      const result = applyUpdate(engine, state, update)
      await engine.save(cwd, state)
      return result
    },
    timeoutMs: 60_000,
  }
}

/** Run the milestone gate from the model surface and render the outcome. */
async function checkGate(
  ctx: Context,
  engine: AiLearningEngine,
  exec: ToolRunContextShape,
  cwd: string,
  state: LearningState,
  args: UpdateArgs,
): Promise<string> {
  const milestone = pickCheckMilestone(state.milestones, args.milestoneId)
  if (milestone === undefined) {
    throw new Error(
      args.milestoneId === undefined
        ? 'no milestone is in_progress or failed; nothing to check'
        : `unknown milestone "${args.milestoneId}"`,
    )
  }
  const settled = await runMilestoneGate(ctx, engine, cwd, state, milestone, exec.signal, exec.agent?.session)
  const label = `gate "${settled.command.join(' ')}"`
  if (settled.interrupted) return `${label} was interrupted; milestone marked failed`
  if (settled.outcome.kind === 'failed') {
    return `${label} failed (exit code ${settled.exitCode}); milestone marked failed.\nstderr tail:\n${settled.stderr}`
  }
  if (settled.outcome.kind === 'pending-questions') {
    return `${label} passed, but ${milestone.questions.filter((question) => question.status !== 'passed').length} question(s) remain open: ask and grade them, then re-run check_gate.`
  }
  return `${label} passed — milestone "${milestone.id}" verified.${state.phase === 'complete' ? ' All milestones verified: the exercise is complete.' : ''}`
}

function pickCheckMilestone(milestones: readonly Milestone[], requestedId: string | undefined): Milestone | undefined {
  if (requestedId !== undefined) return milestones.find((milestone) => milestone.id === requestedId)
  return (
    milestones.find((milestone) => milestone.status === 'in_progress') ??
    milestones.find((milestone) => milestone.status === 'failed')
  )
}

interface UpdateArgs {
  readonly action: string
  readonly originPath?: string
  readonly language?: string
  readonly level?: (typeof LEVELS)[number]
  readonly module?: string
  readonly todo?: Todo
  readonly milestone?: Milestone
  readonly todoId?: string
  readonly status?: (typeof TODO_STATUS)[number]
  readonly phase?: Phase
  readonly milestoneId?: string
  readonly questionIndex?: number
  readonly passed?: boolean
  readonly note?: string
}

function applyUpdate(engine: AiLearningEngine, state: LearningState, args: UpdateArgs): string {
  switch (args.action) {
    case 'upsert_todo': {
      if (args.todo === undefined) throw new Error('upsert_todo requires "todo"')
      engine.upsertTodo(state, args.todo)
      return `recorded todo ${args.todo.id} (${args.todo.where})`
    }
    case 'upsert_milestone': {
      if (args.milestone === undefined) throw new Error('upsert_milestone requires "milestone"')
      engine.upsertMilestone(state, args.milestone)
      return `recorded milestone ${args.milestone.id} (${args.milestone.title}) with ${args.milestone.todos.length} todos and ${args.milestone.questions.length} questions`
    }
    case 'set_todo_status': {
      requireField(args, 'todoId', 'set_todo_status')
      requireField(args, 'status', 'set_todo_status')
      engine.setTodoStatus(state, args.todoId!, args.status!)
      return `todo ${args.todoId} → ${args.status}`
    }
    case 'advance_phase': {
      requireField(args, 'phase', 'advance_phase')
      engine.advancePhase(state, args.phase!)
      return `phase → ${state.phase}${state.phase === 'learning' ? `; current milestone: ${state.milestones.find((milestone) => milestone.status === 'in_progress')?.id ?? 'none'}` : ''}`
    }
    case 'ask_question': {
      requireField(args, 'milestoneId', 'ask_question')
      requireField(args, 'questionIndex', 'ask_question')
      engine.askQuestion(state, args.milestoneId!, args.questionIndex!)
      return `question ${args.milestoneId}[${args.questionIndex}] marked asked`
    }
    case 'give_hint': {
      requireField(args, 'milestoneId', 'give_hint')
      requireField(args, 'questionIndex', 'give_hint')
      const hint = engine.giveHint(state, args.milestoneId!, args.questionIndex!)
      return hint === null
        ? `hint ladder exhausted for ${args.milestoneId}[${args.questionIndex}]; reveal the answer and have the learner explain it back, then assess`
        : `hint ${args.milestoneId}[${args.questionIndex}]: ${hint}`
    }
    case 'assess_answer': {
      requireField(args, 'milestoneId', 'assess_answer')
      requireField(args, 'questionIndex', 'assess_answer')
      requireField(args, 'passed', 'assess_answer')
      engine.assessAnswer(state, args.milestoneId!, args.questionIndex!, args.passed!, args.note)
      return `question ${args.milestoneId}[${args.questionIndex}] assessed ${args.passed ? 'passed' : 'failed'}`
    }
    case 'retry_milestone': {
      requireField(args, 'milestoneId', 'retry_milestone')
      engine.retryMilestone(state, args.milestoneId!)
      return `milestone ${args.milestoneId} reopened for another attempt`
    }
    default:
      throw new Error(`unknown update action "${args.action}"`)
  }
}

function requireField(args: UpdateArgs, key: keyof UpdateArgs, action: string): void {
  if (args[key] === undefined) throw new Error(`${action} requires "${key}"`)
}

/** Return a required string field with a narrowed type, or throw. */
function requireFieldValue(args: UpdateArgs, key: 'originPath' | 'language' | 'module' | 'milestoneId' | 'todoId', action: string): string {
  const value = args[key]
  if (typeof value !== 'string' || value === '') throw new Error(`${action} requires "${key}"`)
  return value
}

/** Random helper used by the pre-step injection; exported for reuse. */
export function newMessageId(): string {
  return randomUUID()
}

export { isLearningError }
