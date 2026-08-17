import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import * as plugin from '../src/index.ts'
import { AiLearningEngine, LearningError } from '../src/index.ts'
import type { CreateStateInput, LearningState, Milestone, Question, Todo } from '../src/index.ts'
import { FakeFileSystem } from './fake-fs.ts'

interface Harness {
  readonly ctx: Context
  readonly fs: FakeFileSystem
  readonly engine: AiLearningEngine
}

async function makeEngine(config: Record<string, unknown> = {}): Promise<Harness> {
  const ctx = new Context()
  const fs = new FakeFileSystem()
  ctx.provide('fs', fs)
  await ctx.plugin(plugin, config)
  const engine = ctx.aiLearning
  return { ctx, fs, engine }
}

const ORIGIN: CreateStateInput['origin'] = { path: '/src/project', language: 'go' }
const SCOPE: CreateStateInput['scope'] = { level: 'beginner' }

function makeTodo(id: string, status: Todo['status'] = 'pending'): Todo {
  return { id, where: `internal/store/${id}.go ${id}`, what: `persists ${id}`, steps: ['marshal', 'write'], hint: 'use a lease', difficulty: 2, status }
}

function makeQuestion(ask: string, status: Question['status'] = 'unasked'): Question {
  return { ask, expected: ['point one', 'point two'], hints: ['hint one', 'hint two'], status, hintLevel: 0 }
}

function makeMilestone(id: string, todoIds: string[], questions: Question[] = []): Milestone {
  return { id, title: `milestone ${id}`, todos: todoIds, questions, status: 'pending' }
}

function makeState(overrides: Partial<LearningState> = {}): LearningState {
  return {
    schemaVersion: 1,
    phase: 'analyzing',
    origin: { ...ORIGIN },
    scope: { ...SCOPE },
    milestones: [],
    todos: [],
    gates: { go: { build: ['go', 'build', './...'] } },
    records: [],
    updatedAt: 0,
    ...overrides,
  }
}

describe('phase machine', () => {
  it('advances forward through the ladder and rejects skips', async () => {
    const { engine } = await makeEngine()
    const state = makeState()
    engine.advancePhase(state, 'skeletonizing')
    expect(state.phase).toBe('skeletonizing')
    expect(() => engine.advancePhase(state, 'complete')).toThrowError(LearningError)
    expect(() => engine.advancePhase(state, 'analyzing')).toThrowError(LearningError)
  })

  it('rejects entering learning without milestones', async () => {
    const { engine } = await makeEngine()
    const state = makeState({ phase: 'skeletonizing' })
    expect(() => engine.advancePhase(state, 'learning')).toThrowError(/no milestones/)
  })

  it('rejects entering learning with an empty milestone and starts the first one when legal', async () => {
    const { engine } = await makeEngine()
    const empty = makeState({ phase: 'skeletonizing', milestones: [makeMilestone('m1', [])] })
    expect(() => engine.advancePhase(empty, 'learning')).toThrowError(/has no todos/)

    const state = makeState({
      phase: 'skeletonizing',
      todos: [makeTodo('t1')],
      milestones: [makeMilestone('m1', ['t1'])],
    })
    engine.advancePhase(state, 'learning')
    expect(state.phase).toBe('learning')
    expect(state.milestones[0]!.status).toBe('in_progress')
  })

  it('rejects completing with open milestones', async () => {
    const { engine } = await makeEngine()
    const state = makeState({
      phase: 'learning',
      todos: [makeTodo('t1')],
      milestones: [makeMilestone('m1', ['t1'], [makeQuestion('q1')])],
    })
    state.milestones[0]!.status = 'in_progress'
    expect(() => engine.advancePhase(state, 'complete')).toThrowError(/still open/)
  })
})

describe('todo machine', () => {
  it('moves pending → in_progress → done and allows rework', async () => {
    const { engine } = await makeEngine()
    const state = makeState({ todos: [makeTodo('t1')] })
    engine.setTodoStatus(state, 't1', 'in_progress')
    expect(state.todos[0]!.status).toBe('in_progress')
    engine.setTodoStatus(state, 't1', 'done')
    expect(state.todos[0]!.status).toBe('done')
    engine.setTodoStatus(state, 't1', 'in_progress')
    expect(state.todos[0]!.status).toBe('in_progress')
  })

  it('rejects illegal moves and unknown ids', async () => {
    const { engine } = await makeEngine()
    const state = makeState({ todos: [makeTodo('t1', 'done')] })
    expect(() => engine.setTodoStatus(state, 't1', 'pending')).toThrowError(/from "done" to "pending"/)
    expect(() => engine.setTodoStatus(state, 'nope', 'done')).toThrowError(/unknown todo/)
  })

  it('freezes todos referenced by a verified milestone', async () => {
    const { engine } = await makeEngine()
    const state = makeState({
      phase: 'learning',
      todos: [makeTodo('t1', 'done')],
      milestones: [{ ...makeMilestone('m1', ['t1']), status: 'verified' }],
    })
    expect(() => engine.upsertTodo(state, { ...makeTodo('t1', 'done'), what: 'changed' })).toThrowError(/frozen/)
  })
})

describe('milestone machine', () => {
  it('rejects unknown todo references', async () => {
    const { engine } = await makeEngine()
    const state = makeState()
    expect(() => engine.upsertMilestone(state, makeMilestone('m1', ['ghost']))).toThrowError(/unknown todo/)
  })

  it('freezes verified milestones and preserves status on content edits', async () => {
    const { engine } = await makeEngine()
    const state = makeState({ todos: [makeTodo('t1')], milestones: [{ ...makeMilestone('m1', ['t1']), status: 'verified' }] })
    expect(() => engine.upsertMilestone(state, makeMilestone('m1', ['t1']))).toThrowError(/verified and frozen/)

    const open = makeState({
      phase: 'learning',
      todos: [makeTodo('t1')],
      milestones: [{ ...makeMilestone('m1', ['t1']), status: 'failed' }],
    })
    engine.upsertMilestone(open, { ...makeMilestone('m1', ['t1']), title: 'renamed' })
    expect(open.milestones[0]!.title).toBe('renamed')
    expect(open.milestones[0]!.status).toBe('failed')
  })
})

describe('question machine', () => {
  it('walks unasked → asked → hints → assessed', async () => {
    const { engine } = await makeEngine()
    const question = makeQuestion('why etcd?')
    const state = makeState({ milestones: [makeMilestone('m1', [], [question])] })
    engine.askQuestion(state, 'm1', 0)
    expect(question.status).toBe('asked')
    expect(engine.giveHint(state, 'm1', 0)).toBe('hint one')
    expect(question.hintLevel).toBe(1)
    expect(engine.giveHint(state, 'm1', 0)).toBe('hint two')
    expect(engine.giveHint(state, 'm1', 0)).toBeNull()
    engine.assessAnswer(state, 'm1', 0, true, 'explained the lease back')
    expect(question.status).toBe('passed')
    expect(question.note).toBe('explained the lease back')
  })

  it('rejects assessment before asking and allows re-ask after failure', async () => {
    const { engine } = await makeEngine()
    const state = makeState({ milestones: [makeMilestone('m1', [], [makeQuestion('q1')])] })
    expect(() => engine.assessAnswer(state, 'm1', 0, true)).toThrowError(/must be asked/)
    engine.askQuestion(state, 'm1', 0)
    engine.assessAnswer(state, 'm1', 0, false, 'surface answer')
    expect(state.milestones[0]!.questions[0]!.status).toBe('failed')
    engine.askQuestion(state, 'm1', 0)
    expect(state.milestones[0]!.questions[0]!.status).toBe('asked')
  })
})

describe('verification', () => {
  it('verifies on exit 0 with questions passed and advances to the next milestone', async () => {
    const { engine } = await makeEngine()
    const q1 = makeQuestion('q1', 'passed')
    const state = makeState({
      phase: 'learning',
      todos: [makeTodo('t1', 'done'), makeTodo('t2')],
      milestones: [makeMilestone('m1', ['t1'], [q1]), makeMilestone('m2', ['t2'])],
    })
    state.milestones[0]!.status = 'in_progress'
    const outcome = engine.recordGate(state, 'm1', gateInput(0, 'ok'))
    expect(outcome).toEqual({ kind: 'verified' })
    expect(state.milestones[0]!.status).toBe('verified')
    expect(state.milestones[1]!.status).toBe('in_progress')
    expect(state.phase).toBe('learning')
  })

  it('completes the workflow when the last milestone verifies', async () => {
    const { engine } = await makeEngine()
    const state = makeState({
      phase: 'learning',
      todos: [makeTodo('t1', 'done')],
      milestones: [makeMilestone('m1', ['t1'])],
    })
    state.milestones[0]!.status = 'in_progress'
    engine.recordGate(state, 'm1', gateInput(0, 'ok'))
    expect(state.phase).toBe('complete')
  })

  it('keeps in_progress with pending questions and fails on non-zero exit', async () => {
    const { engine } = await makeEngine()
    const pending = makeState({
      phase: 'learning',
      todos: [makeTodo('t1', 'done')],
      milestones: [makeMilestone('m1', ['t1'], [makeQuestion('q1')])],
    })
    pending.milestones[0]!.status = 'in_progress'
    expect(engine.recordGate(pending, 'm1', gateInput(0, 'ok'))).toEqual({ kind: 'pending-questions' })
    expect(pending.milestones[0]!.status).toBe('in_progress')

    expect(engine.recordGate(pending, 'm1', gateInput(1, 'compile error'))).toEqual({ kind: 'failed' })
    expect(pending.milestones[0]!.status).toBe('failed')
    engine.retryMilestone(pending, 'm1')
    expect(pending.milestones[0]!.status).toBe('in_progress')
  })

  it('rejects gate records for milestones that are not in_progress', async () => {
    const { engine } = await makeEngine()
    const state = makeState({ todos: [makeTodo('t1')], milestones: [makeMilestone('m1', ['t1'])] })
    expect(() => engine.recordGate(state, 'm1', gateInput(0, 'ok'))).toThrowError(/not in_progress/)
  })

  it('caps captured output at maxCapturedOutput', async () => {
    const { engine } = await makeEngine({ maxCapturedOutput: 20 })
    const state = makeState({
      phase: 'learning',
      todos: [makeTodo('t1')],
      milestones: [makeMilestone('m1', ['t1'])],
    })
    state.milestones[0]!.status = 'in_progress'
    engine.recordGate(state, 'm1', gateInput(0, 'x'.repeat(5000)))
    const record = state.records[0]!
    expect(record.stdout.length).toBe(20)
    expect(record.stdout.startsWith('\u2026')).toBe(true)
  })
})

describe('persistence', () => {
  it('creates, loads, and saves state through ctx.fs', async () => {
    const { engine } = await makeEngine()
    await engine.create('/work', { origin: ORIGIN, scope: SCOPE })
    expect(await engine.hasState('/work')).toBe(true)

    const loaded = await engine.load('/work')
    expect(loaded?.phase).toBe('analyzing')
    expect(loaded?.origin.language).toBe('go')
    expect(loaded?.gates.go?.build).toEqual(['go', 'build', './...'])

    loaded!.phase = 'skeletonizing'
    const before = Date.now()
    await engine.save('/work', loaded!)
    const again = await engine.load('/work')
    expect(again?.phase).toBe('skeletonizing')
    expect(again!.updatedAt).toBeGreaterThanOrEqual(before)
  })

  it('rejects a second create and the createIfAbsent race', async () => {
    const { engine, fs } = await makeEngine()
    await engine.create('/work', { origin: ORIGIN, scope: SCOPE })
    await expect(engine.create('/work', { origin: ORIGIN, scope: SCOPE })).rejects.toMatchObject({ code: 'STATE_EXISTS' })

    fs.files.set('/other/.ai-learning/state.json', '{"stale":true}')
    fs.hideFromStat.add('/other/.ai-learning/state.json')
    await expect(engine.create('/other', { origin: ORIGIN, scope: SCOPE })).rejects.toMatchObject({ code: 'STATE_EXISTS' })
  })

  it('rejects unknown language gates at create time', async () => {
    const { engine } = await makeEngine()
    await expect(engine.create('/work', { origin: { path: '/p', language: 'rust' }, scope: SCOPE })).rejects.toMatchObject({
      code: 'GATE_UNKNOWN',
    })
  })

  it('returns undefined for missing state and rejects malformed content', async () => {
    const { engine, fs } = await makeEngine()
    expect(await engine.load('/missing')).toBeUndefined()

    fs.files.set('/bad/.ai-learning/state.json', 'not json at all')
    await expect(engine.load('/bad')).rejects.toMatchObject({ code: 'STATE_INVALID' })

    fs.files.set(
      '/bad2/.ai-learning/state.json',
      JSON.stringify({ schemaVersion: 1, phase: 'analyzing', origin: { path: '/p', language: 'go' }, scope: { level: 'beginner' }, gates: { go: { build: [] } }, milestones: [{ id: 'm1', title: 'x', todos: ['ghost'], questions: [], status: 'pending' }], todos: [], records: [], updatedAt: 0 }),
    )
    await expect(engine.load('/bad2')).rejects.toMatchObject({ code: 'STATE_INVALID' })
  })
})

describe('views', () => {
  it('snapshots and describes the current position', async () => {
    const { engine } = await makeEngine()
    const state = makeState({
      phase: 'learning',
      todos: [makeTodo('t1', 'done'), makeTodo('t2')],
      milestones: [makeMilestone('m1', ['t1']), makeMilestone('m2', ['t2'], [makeQuestion('q1', 'passed')])],
    })
    state.milestones[0]!.status = 'verified'
    state.milestones[1]!.status = 'in_progress'
    const view = engine.snapshot(state)
    expect(view.current?.id).toBe('m2')
    expect(view.doneQuestionCount).toBe(1)
    const text = engine.describe(state)
    expect(text).toContain('milestones: 1/2 verified')
    expect(text).toContain('current: milestone m2')
  })
})

function gateInput(exitCode: number, stdout: string): { command: readonly string[]; exitCode: number; stdout: string; stderr: string; durationMs: number } {
  return { command: ['go', 'build', './...'], exitCode, stdout, stderr: '', durationMs: 42 }
}
