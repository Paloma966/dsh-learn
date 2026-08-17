import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import * as plugin from '../src/index.ts'
import type { AiLearningEngine } from '../src/index.ts'
import type { ShellExecSpecShape, ShellServiceShape, ToolDefinitionShape, ToolRunContextShape, ToolsServiceShape } from '../src/host-types.ts'
import { FakeFileSystem } from './fake-fs.ts'

const CWD = '/work'

class FakeShell implements ShellServiceShape {
  exitCode = 0
  stderrText = ''
  async run(_spec: ShellExecSpecShape) {
    return {
      exitCode: this.exitCode,
      signal: null,
      timedOut: false,
      aborted: false,
      timeoutMs: 120_000,
      stdout: { text: 'ok', truncated: false },
      stderr: { text: this.stderrText, truncated: false },
    }
  }
}

class FakeTools implements ToolsServiceShape {
  readonly registered: ToolDefinitionShape[] = []
  register(definition: ToolDefinitionShape): unknown {
    this.registered.push(definition)
    return undefined
  }

  tool(name: string): ToolDefinitionShape {
    const found = this.registered.find((definition) => definition.name === name)
    if (found === undefined) throw new Error(`tool ${name} not registered`)
    return found
  }
}

interface Harness {
  readonly ctx: Context
  readonly engine: AiLearningEngine
  readonly tools: FakeTools
  readonly shell: FakeShell
  exec(tool: ToolDefinitionShape, args?: unknown): Promise<unknown>
}

async function makeToolHarness(): Promise<Harness> {
  const ctx = new Context()
  const fs = new FakeFileSystem()
  const tools = new FakeTools()
  const shell = new FakeShell()
  ctx.provide('fs', fs)
  ctx.provide('tools', tools)
  ctx.provide('shell', shell)
  await ctx.plugin(plugin)
  const engine = ctx.aiLearning
  const exec = (tool: ToolDefinitionShape, args: unknown = {}): Promise<unknown> => {
    const runCtx: ToolRunContextShape = {
      callId: 'call-1',
      agent: { session: { header: { cwd: CWD } } },
      signal: new AbortController().signal,
    }
    return tool.execute(args, runCtx)
  }
  return { ctx, engine, tools, shell, exec }
}

async function seedState(engine: AiLearningEngine): Promise<void> {
  const state = await engine.create(CWD, { origin: { path: '/src/project', language: 'go' }, scope: { level: 'beginner' } })
  await engine.save(CWD, state)
}

describe('tool registration', () => {
  it('registers status, next, and update when a registry is composed', async () => {
    const { tools } = await makeToolHarness()
    expect(tools.registered.map((definition) => definition.name)).toEqual([
      'ai_learning_status',
      'ai_learning_next',
      'ai_learning_update',
    ])
  })

  it('skips registration without a tool registry', async () => {
    const ctx = new Context()
    ctx.provide('fs', new FakeFileSystem())
    await ctx.plugin(plugin)
    expect(ctx.get('tools')).toBeUndefined()
  })
})

describe('ai_learning_status', () => {
  it('describes the current state', async () => {
    const harness = await makeToolHarness()
    await seedState(harness.engine)
    const result = await harness.exec(harness.tools.tool('ai_learning_status'))
    expect(String(result)).toContain('phase: analyzing')
  })

  it('rejects when no state exists', async () => {
    const harness = await makeToolHarness()
    await expect(harness.exec(harness.tools.tool('ai_learning_status'))).rejects.toThrowError(/no learning state/)
  })
})

describe('ai_learning_next', () => {
  it('returns the current milestone with todos, gate, and questions', async () => {
    const harness = await makeToolHarness()
    await seedState(harness.engine)
    const state = (await harness.engine.load(CWD))!
    harness.engine.upsertTodo(state, { id: 't1', where: 'a.go f', what: 'writes a task', steps: ['one'], difficulty: 2, status: 'done' })
    harness.engine.upsertMilestone(state, {
      id: 'm1',
      title: 'Task CRUD',
      todos: ['t1'],
      questions: [{ ask: 'why etcd?', expected: ['lease safety'], hints: ['lease'], status: 'unasked', hintLevel: 0 }],
      status: 'pending',
    })
    harness.engine.advancePhase(state, 'skeletonizing')
    harness.engine.advancePhase(state, 'learning')
    await harness.engine.save(CWD, state)

    const payload = (await harness.exec(harness.tools.tool('ai_learning_next'))) as Record<string, unknown>
    const current = payload.current as Record<string, unknown>
    expect(current.id).toBe('m1')
    expect(current.gate).toEqual({ build: ['go', 'build', './...'] })
    const questions = current.questions as Array<Record<string, unknown>>
    expect(questions[0]!.ask).toBe('why etcd?')
    expect(questions[0]!.expected).toEqual(['lease safety'])
  })
})

describe('ai_learning_update', () => {
  it('records todos and milestones and persists them', async () => {
    const harness = await makeToolHarness()
    await seedState(harness.engine)
    const update = harness.tools.tool('ai_learning_update')

    const todoResult = await harness.exec(update, {
      action: 'upsert_todo',
      todo: { id: 't1', where: 'a.go f', what: 'writes a task', steps: ['one'], difficulty: 2, status: 'pending' },
    })
    expect(String(todoResult)).toContain('recorded todo t1')

    const milestoneResult = await harness.exec(update, {
      action: 'upsert_milestone',
      milestone: { id: 'm1', title: 'Task CRUD', todos: ['t1'], questions: [], status: 'pending' },
    })
    expect(String(milestoneResult)).toContain('recorded milestone m1')

    const state = await harness.engine.load(CWD)
    expect(state?.todos.map((todo) => todo.id)).toEqual(['t1'])
    expect(state?.milestones.map((milestone) => milestone.id)).toEqual(['m1'])
  })

  it('advances phases and starts the first milestone', async () => {
    const harness = await makeToolHarness()
    await seedState(harness.engine)
    const update = harness.tools.tool('ai_learning_update')
    await harness.exec(update, {
      action: 'upsert_todo',
      todo: { id: 't1', where: 'a.go f', what: 'writes a task', steps: ['one'], difficulty: 1, status: 'pending' },
    })
    await harness.exec(update, {
      action: 'upsert_milestone',
      milestone: { id: 'm1', title: 'M1', todos: ['t1'], questions: [], status: 'pending' },
    })
    await harness.exec(update, { action: 'advance_phase', phase: 'skeletonizing' })
    const result = await harness.exec(update, { action: 'advance_phase', phase: 'learning' })
    expect(String(result)).toContain('current milestone: m1')
    const state = await harness.engine.load(CWD)
    expect(state?.phase).toBe('learning')
    expect(state?.milestones[0]!.status).toBe('in_progress')
  })

  it('rejects illegal transitions through the engine', async () => {
    const harness = await makeToolHarness()
    await seedState(harness.engine)
    const update = harness.tools.tool('ai_learning_update')
    await expect(harness.exec(update, { action: 'advance_phase', phase: 'complete' })).rejects.toThrowError(/cannot move/)
  })

  it('creates a fresh exercise without a command plane', async () => {
    const harness = await makeToolHarness()
    const update = harness.tools.tool('ai_learning_update')
    const result = await harness.exec(update, {
      action: 'create',
      originPath: '/src/project',
      language: 'go',
      level: 'advanced',
      module: 'pkg',
    })
    expect(String(result)).toContain('exercise created for /src/project (go, advanced)')
    const state = await harness.engine.load(CWD)
    expect(state?.phase).toBe('analyzing')
    expect(state?.scope).toEqual({ level: 'advanced', module: 'pkg' })
    await expect(harness.exec(update, { action: 'create' })).rejects.toThrowError(/requires "originPath"/)
  })

  it('drives the question ladder: ask, hint, assess, re-ask', async () => {
    const harness = await makeToolHarness()
    await seedState(harness.engine)
    const update = harness.tools.tool('ai_learning_update')
    await harness.exec(update, {
      action: 'upsert_todo',
      todo: { id: 't1', where: 'a.go f', what: 'writes a task', steps: ['one'], difficulty: 1, status: 'done' },
    })
    await harness.exec(update, {
      action: 'upsert_milestone',
      milestone: {
        id: 'm1',
        title: 'M1',
        todos: ['t1'],
        questions: [{ ask: 'why etcd?', expected: ['leases'], hints: ['think crashes'], status: 'unasked', hintLevel: 0 }],
        status: 'pending',
      },
    })

    await expect(harness.exec(update, { action: 'give_hint', milestoneId: 'm1', questionIndex: 0 })).rejects.toThrowError(/must be asked/)
    await harness.exec(update, { action: 'ask_question', milestoneId: 'm1', questionIndex: 0 })
    const hintResult = await harness.exec(update, { action: 'give_hint', milestoneId: 'm1', questionIndex: 0 })
    expect(String(hintResult)).toContain('think crashes')

    await harness.exec(update, { action: 'assess_answer', milestoneId: 'm1', questionIndex: 0, passed: false, note: 'surface' })
    const state = await harness.engine.load(CWD)
    expect(state?.milestones[0]!.questions[0]!.status).toBe('failed')
    expect(state?.milestones[0]!.questions[0]!.note).toBe('surface')
  })

  it('runs the gate for check_gate and verifies the milestone', async () => {
    const harness = await makeToolHarness()
    await seedState(harness.engine)
    const update = harness.tools.tool('ai_learning_update')
    await harness.exec(update, {
      action: 'upsert_todo',
      todo: { id: 't1', where: 'a.go f', what: 'writes a task', steps: ['one'], difficulty: 2, status: 'done' },
    })
    await harness.exec(update, {
      action: 'upsert_milestone',
      milestone: { id: 'm1', title: 'M1', todos: ['t1'], questions: [], status: 'pending' },
    })
    await harness.exec(update, { action: 'advance_phase', phase: 'skeletonizing' })
    await harness.exec(update, { action: 'advance_phase', phase: 'learning' })

    harness.shell.exitCode = 1
    harness.shell.stderrText = 'undefined: x'
    const failed = await harness.exec(update, { action: 'check_gate' })
    expect(String(failed)).toContain('marked failed')
    expect(String(failed)).toContain('undefined: x')

    harness.shell.exitCode = 0
    const verified = await harness.exec(update, { action: 'check_gate' })
    expect(String(verified)).toContain('verified')
    expect(String(verified)).toContain('complete')
    const state = await harness.engine.load(CWD)
    expect(state?.records).toHaveLength(2)
  })
})
