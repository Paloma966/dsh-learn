/**
 * The ai-learning engine: a plain class registered as the `aiLearning`
 * service by the function plugin in `index.ts`.
 *
 * The engine enforces the process, the model performs it. Every illegal
 * transition is rejected here — the model cannot mark a milestone verified
 * without a recorded gate run, cannot edit frozen (verified) milestones, and
 * cannot skip a phase. State lives in `<cwd>/.ai-learning/state.json`, so it
 * survives sessions and travels with the skeleton repository.
 *
 * The class deliberately does NOT extend Cordis `Service`: a bundle loaded
 * into a profile resolves `@deepseek-ai/cordis` from its own dependency
 * tree, and two module copies would break the framework's symbol-keyed
 * lifecycle hooks. Registration goes through `ctx.provide` instead — the
 * same seam production boot plugins use.
 *
 * @module dsh-ai-learning/engine
 */

import type { Context } from '@deepseek-ai/cordis'
import type { StateFileSystem } from './fs-types.ts'
import { LearningError } from './errors.ts'
import type {
  AiLearningConfig,
  CreateStateInput,
  Difficulty,
  EngineStateSnapshot,
  GateOutcome,
  GateRecord,
  GateSpec,
  LearningState,
  Milestone,
  MilestoneStatus,
  Phase,
  Question,
  QuestionStatus,
  Todo,
  TodoStatus,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    aiLearning: AiLearningEngine
  }
}

/** Resolved configuration with every default materialized. */
export interface ResolvedConfig {
  readonly stateDir: string
  readonly gates: Readonly<Record<string, GateSpec>>
  readonly maxCapturedOutput: number
}

const PHASES: readonly Phase[] = ['analyzing', 'skeletonizing', 'learning', 'complete']

const PHASE_NEXT: Record<Phase, Phase | null> = {
  analyzing: 'skeletonizing',
  skeletonizing: 'learning',
  learning: 'complete',
  complete: null,
}

const TODO_STATUS: readonly TodoStatus[] = ['pending', 'in_progress', 'done']
const MILESTONE_STATUS: readonly MilestoneStatus[] = ['pending', 'in_progress', 'verified', 'failed']
const QUESTION_STATUS: readonly QuestionStatus[] = ['unasked', 'asked', 'passed', 'failed']
const DIFFICULTIES: readonly Difficulty[] = [1, 2, 3, 4]

/** Legal todo-status moves: rework (done → in_progress) is allowed. */
const TODO_MOVES: Readonly<Record<TodoStatus, readonly TodoStatus[]>> = {
  pending: ['in_progress', 'done'],
  in_progress: ['done'],
  done: ['in_progress'],
}

/**
 * The learning engine.
 *
 * All state-machine methods mutate the `state` object they receive and
 * reject illegal moves with `LearningError`. Persistence methods go through
 * the injected filesystem, so they work identically on local and remote
 * backends.
 */
export class AiLearningEngine {
  private readonly ctx: Context
  private readonly resolved: ResolvedConfig

  constructor(ctx: Context, config: AiLearningConfig = {}) {
    this.ctx = ctx
    this.resolved = {
      stateDir: config.stateDir ?? '.ai-learning',
      gates: config.gates ?? { go: { build: ['go', 'build', './...'] } },
      maxCapturedOutput: config.maxCapturedOutput ?? 8000,
    }
  }

  /** The resolved configuration (defaults materialized). */
  get config(): ResolvedConfig {
    return this.resolved
  }

  /** The host filesystem seam; `inject: ['fs']` guarantees its presence. */
  private get fs(): StateFileSystem {
    return this.ctx.get('fs') as unknown as StateFileSystem
  }

  private stateFilePath(): string {
    return `${this.resolved.stateDir}/state.json`
  }

  // ── persistence ───────────────────────────────────────────────────────

  /** Resolve the state-file target against a session cwd. */
  async stateTarget(cwd: string): Promise<ReturnType<StateFileSystem['resolve']>> {
    return this.fs.resolve(this.stateFilePath(), { cwd })
  }

  /** Whether a learning state exists under `cwd`. */
  async hasState(cwd: string): Promise<boolean> {
    const target = await this.stateTarget(cwd)
    return (await this.fs.stat(target)) !== undefined
  }

  /**
   * Load and validate the state under `cwd`, or `undefined` when absent.
   * Malformed content rejects with `STATE_INVALID`.
   */
  async load(cwd: string): Promise<LearningState | undefined> {
    const target = await this.stateTarget(cwd)
    const info = await this.fs.stat(target)
    if (info === undefined) return undefined
    const text = await this.fs.readText(target)
    return parseState(text)
  }

  /**
   * Create the initial state for a new learning exercise.
   * Rejects with `STATE_EXISTS` when a state already exists (race-safe via
   * `createIfAbsent`), or `GATE_UNKNOWN` when the origin language has no
   * configured gate.
   */
  async create(cwd: string, input: CreateStateInput): Promise<LearningState> {
    const gate = this.resolved.gates[input.origin.language]
    if (gate === undefined) {
      throw new LearningError(
        'GATE_UNKNOWN',
        `no verification gate configured for language "${input.origin.language}" (configured: ${Object.keys(this.resolved.gates).join(', ') || 'none'})`,
      )
    }
    const target = await this.stateTarget(cwd)
    if ((await this.fs.stat(target)) !== undefined) {
      throw new LearningError('STATE_EXISTS', `a learning state already exists under ${cwd}`)
    }
    const state: LearningState = {
      schemaVersion: 1,
      phase: 'analyzing',
      origin: { path: input.origin.path, language: input.origin.language },
      scope: { ...input.scope },
      milestones: [],
      todos: [],
      gates: this.resolved.gates,
      records: [],
      updatedAt: Date.now(),
    }
    const content = serializeState(state)
    try {
      await this.fs.writeText(target, content, { createIfAbsent: true })
    } catch (error) {
      if (errorCode(error) === 'FS_NOT_OBSERVED') {
        throw new LearningError('STATE_EXISTS', `a learning state already exists under ${cwd}`)
      }
      throw error
    }
    return state
  }

  /** Persist the current state, stamping `updatedAt`. */
  async save(cwd: string, state: LearningState): Promise<void> {
    validateStateShape(state)
    state.updatedAt = Date.now()
    const target = await this.stateTarget(cwd)
    await this.fs.writeText(target, serializeState(state))
  }

  // ── phase machine ─────────────────────────────────────────────────────

  /**
   * Advance the workflow phase. Only forward moves along
   * analyzing → skeletonizing → learning → complete are legal.
   * Entering `learning` requires at least one milestone with todos;
   * entering `complete` requires every milestone verified.
   */
  advancePhase(state: LearningState, next: Phase): void {
    if (next === state.phase) return
    if (PHASE_NEXT[state.phase] !== next) {
      throw new LearningError('ILLEGAL_TRANSITION', `cannot move from phase "${state.phase}" to "${next}"`)
    }
    if (next === 'learning') {
      if (state.milestones.length === 0) {
        throw new LearningError('ILLEGAL_TRANSITION', 'cannot enter the learning phase: no milestones defined')
      }
      for (const milestone of state.milestones) {
        if (milestone.todos.length === 0) {
          throw new LearningError('ILLEGAL_TRANSITION', `milestone "${milestone.id}" has no todos`)
        }
      }
    }
    if (next === 'complete') {
      const open = state.milestones.filter((milestone) => milestone.status !== 'verified')
      if (open.length > 0) {
        throw new LearningError(
          'ILLEGAL_TRANSITION',
          `cannot complete: milestones still open: ${open.map((milestone) => milestone.id).join(', ')}`,
        )
      }
    }
    state.phase = next
    if (next === 'learning') this.startNextMilestone(state)
  }

  // ── todo machine ──────────────────────────────────────────────────────

  /** Add or replace a todo. Todos referenced by a verified milestone are frozen. */
  upsertTodo(state: LearningState, todo: Todo): void {
    if (!DIFFICULTIES.includes(todo.difficulty)) {
      throw new LearningError('ILLEGAL_TRANSITION', `todo "${todo.id}" has an invalid difficulty`)
    }
    if (!TODO_STATUS.includes(todo.status)) {
      throw new LearningError('ILLEGAL_TRANSITION', `todo "${todo.id}" has an invalid status`)
    }
    this.assertTodoEditable(state, todo.id)
    const index = state.todos.findIndex((entry) => entry.id === todo.id)
    if (index >= 0) state.todos[index] = todo
    else state.todos.push(todo)
  }

  /** Move one todo along pending → in_progress → done (rework allowed). */
  setTodoStatus(state: LearningState, todoId: string, status: TodoStatus): void {
    const todo = state.todos.find((entry) => entry.id === todoId)
    if (todo === undefined) throw new LearningError('TODO_UNKNOWN', `unknown todo "${todoId}"`)
    if (status === todo.status) return
    if (!(TODO_MOVES[todo.status] as readonly TodoStatus[]).includes(status)) {
      throw new LearningError(
        'ILLEGAL_TRANSITION',
        `cannot move todo "${todoId}" from "${todo.status}" to "${status}"`,
      )
    }
    todo.status = status
  }

  private assertTodoEditable(state: LearningState, todoId: string): void {
    const frozen = state.milestones.some(
      (milestone) => milestone.status === 'verified' && milestone.todos.includes(todoId),
    )
    if (frozen) {
      throw new LearningError('ILLEGAL_TRANSITION', `todo "${todoId}" is frozen by a verified milestone`)
    }
  }

  // ── milestone machine ─────────────────────────────────────────────────

  /**
   * Add or replace a milestone. Verified milestones are frozen. Every todo
   * reference must resolve. New milestones start `pending`; content edits of
   * an open milestone keep its current status.
   */
  upsertMilestone(state: LearningState, milestone: Milestone): void {
    const existing = state.milestones.find((entry) => entry.id === milestone.id)
    if (existing?.status === 'verified') {
      throw new LearningError('ILLEGAL_TRANSITION', `milestone "${milestone.id}" is verified and frozen`)
    }
    for (const todoId of milestone.todos) {
      if (!state.todos.some((todo) => todo.id === todoId)) {
        throw new LearningError('TODO_UNKNOWN', `milestone "${milestone.id}" references unknown todo "${todoId}"`)
      }
    }
    for (const [index, question] of milestone.questions.entries()) {
      if (question.ask.trim() === '') {
        throw new LearningError('ILLEGAL_TRANSITION', `milestone "${milestone.id}" question ${index} has no ask text`)
      }
      if (!QUESTION_STATUS.includes(question.status)) {
        throw new LearningError(
          'ILLEGAL_TRANSITION',
          `milestone "${milestone.id}" question ${index} has an invalid status`,
        )
      }
    }
    const normalized: Milestone = {
      ...milestone,
      status: existing === undefined ? 'pending' : existing.status,
      questions: milestone.questions.map((question) => ({ ...question })),
    }
    if (existing === undefined) state.milestones.push(normalized)
    else {
      const index = state.milestones.indexOf(existing)
      if (index >= 0) state.milestones.splice(index, 1, normalized)
    }
  }

  /** Start the first pending milestone. Requires the learning phase. */
  startNextMilestone(state: LearningState): void {
    if (state.phase !== 'learning') {
      throw new LearningError('ILLEGAL_TRANSITION', `cannot start a milestone in phase "${state.phase}"`)
    }
    const next = state.milestones.find((milestone) => milestone.status === 'pending')
    if (next !== undefined) next.status = 'in_progress'
  }

  /** Reopen a failed milestone for another attempt. */
  retryMilestone(state: LearningState, milestoneId: string): void {
    const milestone = this.milestone(state, milestoneId)
    if (milestone.status !== 'failed') {
      throw new LearningError('ILLEGAL_TRANSITION', `milestone "${milestoneId}" is "${milestone.status}", not failed`)
    }
    milestone.status = 'in_progress'
  }

  private milestone(state: LearningState, milestoneId: string): Milestone {
    const milestone = state.milestones.find((entry) => entry.id === milestoneId)
    if (milestone === undefined) throw new LearningError('MILESTONE_UNKNOWN', `unknown milestone "${milestoneId}"`)
    return milestone
  }

  // ── question machine ──────────────────────────────────────────────────

  /** Ask (or re-ask after a failure) one milestone question. */
  askQuestion(state: LearningState, milestoneId: string, questionIndex: number): void {
    const question = this.question(state, milestoneId, questionIndex)
    if (question.status === 'asked') return
    if (question.status !== 'unasked' && question.status !== 'failed') {
      throw new LearningError('ILLEGAL_TRANSITION', `question ${questionIndex} is "${question.status}", not askable`)
    }
    question.status = 'asked'
  }

  /**
   * Offer the next escalation hint for an asked question. Returns the hint
   * text, or `null` when the ladder is exhausted — the answer must then be
   * revealed and the learner explain it back via `assessAnswer`.
   */
  giveHint(state: LearningState, milestoneId: string, questionIndex: number): string | null {
    const question = this.question(state, milestoneId, questionIndex)
    if (question.status !== 'asked') {
      throw new LearningError('ILLEGAL_TRANSITION', `question ${questionIndex} must be asked before hints`)
    }
    if (question.hintLevel >= question.hints.length) return null
    const hint = question.hints[question.hintLevel]
    question.hintLevel += 1
    return hint ?? null
  }

  /** Settle an asked question with the assessment outcome and an optional note. */
  assessAnswer(
    state: LearningState,
    milestoneId: string,
    questionIndex: number,
    passed: boolean,
    note?: string,
  ): void {
    const question = this.question(state, milestoneId, questionIndex)
    if (question.status !== 'asked') {
      throw new LearningError('ILLEGAL_TRANSITION', `question ${questionIndex} must be asked before assessment`)
    }
    question.status = passed ? 'passed' : 'failed'
    if (note !== undefined) question.note = note
  }

  private question(state: LearningState, milestoneId: string, questionIndex: number): Question {
    const milestone = this.milestone(state, milestoneId)
    const question = milestone.questions[questionIndex]
    if (question === undefined) {
      throw new LearningError('QUESTION_UNKNOWN', `milestone "${milestoneId}" has no question ${questionIndex}`)
    }
    return question
  }

  // ── verification ──────────────────────────────────────────────────────

  /**
   * Record one executed gate and fold its outcome into the milestone.
   *
   * - exit code 0 with every question passed → `verified`, then the next
   *   pending milestone starts (or the workflow completes);
   * - exit code 0 with open questions → stays in_progress
   *   (`pending-questions`);
   * - non-zero exit → `failed`; reopen with `retryMilestone`.
   */
  recordGate(
    state: LearningState,
    milestoneId: string,
    input: Omit<GateRecord, 'milestone' | 'at'>,
  ): GateOutcome {
    const milestone = this.milestone(state, milestoneId)
    if (milestone.status !== 'in_progress') {
      throw new LearningError('ILLEGAL_TRANSITION', `milestone "${milestoneId}" is "${milestone.status}", not in_progress`)
    }
    const record: GateRecord = {
      milestone: milestoneId,
      command: [...input.command],
      exitCode: input.exitCode,
      stdout: truncate(input.stdout, this.resolved.maxCapturedOutput),
      stderr: truncate(input.stderr, this.resolved.maxCapturedOutput),
      durationMs: input.durationMs,
      at: Date.now(),
    }
    state.records.push(record)
    if (input.exitCode !== 0) {
      milestone.status = 'failed'
      return { kind: 'failed' }
    }
    const openQuestions = milestone.questions.filter((question) => question.status !== 'passed')
    if (openQuestions.length > 0) {
      return { kind: 'pending-questions' }
    }
    milestone.status = 'verified'
    const open = state.milestones.filter((entry) => entry.status === 'pending')
    if (open.length === 0) {
      state.phase = 'complete'
      return { kind: 'verified' }
    }
    open[0]!.status = 'in_progress'
    return { kind: 'verified' }
  }

  // ── views ─────────────────────────────────────────────────────────────

  /** Read-only snapshot used by status views, tools, and injections. */
  snapshot(state: LearningState): EngineStateSnapshot {
    const current = state.milestones.find((milestone) => milestone.status === 'in_progress')
    const next = state.milestones.find((milestone) => milestone.status === 'pending')
    let questionCount = 0
    let doneQuestionCount = 0
    for (const milestone of state.milestones) {
      questionCount += milestone.questions.length
      doneQuestionCount += milestone.questions.filter((question) => question.status === 'passed').length
    }
    return {
      state,
      phase: state.phase,
      current,
      next,
      gateCount: state.records.length,
      questionCount,
      doneQuestionCount,
    }
  }

  /** Human-readable status text for `/learn status`. */
  describe(state: LearningState): string {
    const view = this.snapshot(state)
    const verified = state.milestones.filter((milestone) => milestone.status === 'verified').length
    const lines = [
      `ai-learning status — phase: ${view.phase}`,
      `  origin: ${state.origin.path} (${state.origin.language})`,
      `  level: ${state.scope.level}${state.scope.module === undefined ? '' : `, module: ${state.scope.module}`}`,
      `  milestones: ${verified}/${state.milestones.length} verified`,
      `  todos: ${state.todos.filter((todo) => todo.status === 'done').length}/${state.todos.length} done`,
      `  questions: ${view.doneQuestionCount}/${view.questionCount} passed`,
      `  gate runs: ${view.gateCount}`,
    ]
    if (view.current !== undefined) {
      const todos = view.current.todos
        .map((id) => state.todos.find((todo) => todo.id === id))
        .filter((todo) => todo !== undefined)
      const doneCount = todos.filter((todo) => todo.status === 'done').length
      lines.push(
        `  current: ${view.current.title} (todos ${doneCount}/${todos.length} done, questions ${view.current.questions.length})`,
      )
    } else if (view.next !== undefined) {
      lines.push(`  next: ${view.next.title}`)
    }
    return lines.join('\n')
  }
}

// ── pure helpers ─────────────────────────────────────────────────────────

function serializeState(state: LearningState): string {
  return `${JSON.stringify(state, null, 2)}\n`
}

function parseState(text: string): LearningState {
  let value: unknown
  try {
    value = JSON.parse(text) as unknown
  } catch {
    throw new LearningError('STATE_INVALID', 'state file is not valid JSON')
  }
  const state = value as LearningState
  validateStateShape(state)
  return state
}

/** Structural validation of a loaded (or to-be-saved) state. */
function validateStateShape(value: unknown): asserts value is LearningState {
  if (typeof value !== 'object' || value === null) {
    throw new LearningError('STATE_INVALID', 'state must be an object')
  }
  const state = value as Partial<LearningState>
  if (state.schemaVersion !== 1) {
    throw new LearningError('STATE_INVALID', `unsupported schemaVersion ${String(state.schemaVersion)}`)
  }
  if (!PHASES.includes(state.phase as Phase)) {
    throw new LearningError('STATE_INVALID', `invalid phase ${String(state.phase)}`)
  }
  if (
    typeof state.origin?.path !== 'string' ||
    typeof state.origin.language !== 'string' ||
    typeof state.scope?.level !== 'string'
  ) {
    throw new LearningError('STATE_INVALID', 'origin or scope fields are malformed')
  }
  if (state.gates === undefined || typeof state.gates[state.origin.language] !== 'object') {
    throw new LearningError('STATE_INVALID', `no gate recorded for language "${state.origin.language}"`)
  }
  if (!Array.isArray(state.milestones) || !Array.isArray(state.todos) || !Array.isArray(state.records)) {
    throw new LearningError('STATE_INVALID', 'milestones, todos, or records are not arrays')
  }
  for (const milestone of state.milestones) {
    if (!MILESTONE_STATUS.includes(milestone.status)) {
      throw new LearningError('STATE_INVALID', `milestone "${milestone.id}" has an invalid status`)
    }
    for (const todoId of milestone.todos) {
      if (!state.todos.some((todo) => todo.id === todoId)) {
        throw new LearningError('STATE_INVALID', `milestone "${milestone.id}" references unknown todo "${todoId}"`)
      }
    }
  }
}

function errorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code
    if (typeof code === 'string') return code
  }
  return undefined
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `\u2026${text.slice(-(max - 1))}`
}
