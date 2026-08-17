import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import * as plugin from '../src/index.ts'
import type { AiLearningEngine } from '../src/index.ts'
import type { CommandDefinitionShape, CommandInvocationShape, CommandResultShape, ShellExecSpecShape } from '../src/host-types.ts'
import { FakeFileSystem } from './fake-fs.ts'

interface Harness {
  readonly ctx: Context
  readonly fs: FakeFileSystem
  readonly engine: AiLearningEngine
  readonly commands: FakeCommands
  readonly shell: FakeShell
  invoke(rawInput: string): Promise<CommandResultShape>
}

class FakeCommands {
  def: CommandDefinitionShape | undefined
  register(definition: CommandDefinitionShape): unknown {
    this.def = definition
    return undefined
  }
}

class FakeShell {
  readonly calls: ShellExecSpecShape[] = []
  exitCode = 0
  stdoutText = 'ok'
  stderrText = ''
  timedOut = false
  aborted = false

  async run(spec: ShellExecSpecShape) {
    this.calls.push(spec)
    return {
      exitCode: this.exitCode,
      signal: null,
      timedOut: this.timedOut,
      aborted: this.aborted,
      timeoutMs: 120_000,
      stdout: { text: this.stdoutText, truncated: false },
      stderr: { text: this.stderrText, truncated: false },
    }
  }
}

const CWD = '/work'

async function makeCommandHarness(): Promise<Harness> {
  const ctx = new Context()
  const fs = new FakeFileSystem()
  const commands = new FakeCommands()
  const shell = new FakeShell()
  ctx.provide('fs', fs)
  ctx.provide('commands', commands)
  ctx.provide('shell', shell)
  await ctx.plugin(plugin)
  const engine = ctx.aiLearning
  const invoke = (rawInput: string): Promise<CommandResultShape> => {
    const invocation: CommandInvocationShape = {
      commandId: 'cmd-1',
      agent: { session: { header: { cwd: CWD } } },
      rawInput,
      signal: new AbortController().signal,
    }
    return Promise.resolve(commands.def!.handler(invocation))
  }
  return { ctx, fs, engine, commands, shell, invoke }
}

/** Seed a state under CWD by running /learn new. */
async function seedNew(harness: Harness, rawInput = 'new /src/project'): Promise<void> {
  const result = await harness.invoke(rawInput)
  expect(result.kind).toBe('success')
}

async function seedMilestone(harness: Harness, questions = 0): Promise<void> {
  const state = (await harness.engine.load(CWD))!
  harness.engine.upsertTodo(state, { id: 't1', where: 'internal/store/task.go SaveTask', what: 'persists a task', steps: ['marshal', 'write'], difficulty: 2, status: 'done' })
  harness.engine.upsertMilestone(state, {
    id: 'm1',
    title: 'Task CRUD',
    todos: ['t1'],
    questions: questions === 0 ? [] : [{ ask: `q${questions}`, expected: ['point'], hints: ['hint'], status: 'unasked', hintLevel: 0 }],
    status: 'pending',
  })
  harness.engine.advancePhase(state, 'skeletonizing')
  harness.engine.advancePhase(state, 'learning')
  await harness.engine.save(CWD, state)
}

describe('command registration', () => {
  it('registers the learn command when a registry is composed', async () => {
    const { commands } = await makeCommandHarness()
    expect(commands.def?.name).toBe('learn')
    expect(commands.def?.input?.hint).toContain('new <origin-path>')
  })

  it('skips registration without a command registry', async () => {
    const ctx = new Context()
    ctx.provide('fs', new FakeFileSystem())
    await ctx.plugin(plugin)
    expect(ctx.get('commands')).toBeUndefined()
  })
})

describe('learn new', () => {
  it('creates a state with defaults and reports the next step', async () => {
    const harness = await makeCommandHarness()
    const result = await harness.invoke('new /src/project')
    expect(result).toMatchObject({ kind: 'success' })
    expect((result as { text: string }).text).toContain('Learning exercise created for /src/project (go, beginner)')
    const state = await harness.engine.load(CWD)
    expect(state?.origin).toEqual({ path: '/src/project', language: 'go' })
    expect(state?.phase).toBe('analyzing')
  })

  it('applies flags and rejects invalid levels', async () => {
    const harness = await makeCommandHarness()
    await seedNew(harness, 'new /src/p --lang go --level advanced --module pkg')
    const state = await harness.engine.load(CWD)
    expect(state?.scope).toEqual({ level: 'advanced', module: 'pkg' })

    const bad = await harness.invoke('new /src/p --level guru')
    expect(bad).toMatchObject({ kind: 'error' })
    expect((bad as { text: string }).text).toContain('invalid level')
  })

  it('rejects missing path and duplicate create', async () => {
    const harness = await makeCommandHarness()
    expect((await harness.invoke('new')).kind).toBe('error')
    await seedNew(harness)
    const again = await harness.invoke('new /other')
    expect((again as { text: string }).text).toContain('already exists')
  })
})

describe('learn status', () => {
  it('errors without state and describes with state', async () => {
    const harness = await makeCommandHarness()
    const missing = await harness.invoke('status')
    expect(missing).toMatchObject({ kind: 'error' })

    await seedNew(harness)
    const result = await harness.invoke('status')
    expect(result.kind).toBe('success')
    expect((result as { text: string }).text).toContain('phase: analyzing')
  })
})

describe('learn check', () => {
  it('errors without state or without a runnable milestone', async () => {
    const harness = await makeCommandHarness()
    expect((await harness.invoke('check')).kind).toBe('error')
    await seedNew(harness)
    const result = await harness.invoke('check')
    expect(result.kind).toBe('error')
    expect((result as { text: string }).text).toContain('nothing to check')
  })

  it('runs the gate, verifies on exit 0, and saves the record', async () => {
    const harness = await makeCommandHarness()
    await seedNew(harness)
    await seedMilestone(harness)
    const result = await harness.invoke('check')
    expect(result).toMatchObject({ kind: 'success' })
    expect((result as { text: string }).text).toContain('verified')
    expect(harness.shell.calls[0]?.command).toBe('go build ./...')
    expect(harness.shell.calls[0]?.workdir).toBe(CWD)

    const state = await harness.engine.load(CWD)
    expect(state?.milestones[0]!.status).toBe('verified')
    expect(state?.phase).toBe('complete')
    expect(state?.records).toHaveLength(1)
  })

  it('fails the milestone on non-zero exit and reports stderr', async () => {
    const harness = await makeCommandHarness()
    await seedNew(harness)
    await seedMilestone(harness)
    harness.shell.exitCode = 1
    harness.shell.stderrText = 'undefined: fmt'
    const result = await harness.invoke('check')
    expect(result).toMatchObject({ kind: 'error' })
    expect((result as { text: string }).text).toContain('undefined: fmt')
    const state = await harness.engine.load(CWD)
    expect(state?.milestones[0]!.status).toBe('failed')
  })

  it('retries a failed milestone on the next check', async () => {
    const harness = await makeCommandHarness()
    await seedNew(harness)
    await seedMilestone(harness)
    harness.shell.exitCode = 1
    await harness.invoke('check')
    harness.shell.exitCode = 0
    const result = await harness.invoke('check')
    expect(result).toMatchObject({ kind: 'success' })
    const state = await harness.engine.load(CWD)
    expect(state?.milestones[0]!.status).toBe('verified')
  })

  it('reports pending questions on a green gate with open Socratic items', async () => {
    const harness = await makeCommandHarness()
    await seedNew(harness)
    await seedMilestone(harness, 1)
    const result = await harness.invoke('check')
    expect(result).toMatchObject({ kind: 'success' })
    expect((result as { text: string }).text).toContain('question(s) remain open')
    const state = await harness.engine.load(CWD)
    expect(state?.milestones[0]!.status).toBe('in_progress')
  })
})
