import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as plugin from '../src/index.ts'
import type { AiLearningEngine } from '../src/index.ts'
import type { PreStepDecisionShape, PreStepPayloadShape } from '../src/host-types.ts'
import { FakeFileSystem } from './fake-fs.ts'

const CWD = '/work'

interface Harness {
  readonly ctx: Context
  readonly engine: AiLearningEngine
  step(): Promise<PreStepDecisionShape>
}

async function makePreStepHarness(): Promise<Harness> {
  const ctx = new Context()
  ctx.provide('fs', new FakeFileSystem())
  await ctx.plugin(plugin)
  const engine = ctx.aiLearning
  const agent = { session: { header: { cwd: CWD } } }
  const waterfall = ctx.waterfall.bind(ctx) as (
    name: string,
    payload: unknown,
    fallback: () => Promise<PreStepDecisionShape>,
  ) => Promise<PreStepDecisionShape>
  const step = async (): Promise<PreStepDecisionShape> => {
    const payload: PreStepPayloadShape = {
      agent,
      turn: 1,
      step: 1,
      signal: new AbortController().signal,
    }
    return waterfall('agent/pre-step', payload, async () => ({ kind: 'enter', messages: [] }))
  }
  return { ctx, engine, step }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('pre-step progress injection', () => {
  it('injects nothing when no state exists', async () => {
    const harness = await makePreStepHarness()
    const decision = await harness.step()
    expect(decision.kind).toBe('enter')
    expect(decision.messages).toHaveLength(0)
  })

  it('injects a progress card when an active exercise exists', async () => {
    const harness = await makePreStepHarness()
    await harness.engine.create(CWD, { origin: { path: '/src/project', language: 'go' }, scope: { level: 'beginner' } })
    const decision = await harness.step()
    expect(decision.messages).toHaveLength(1)
    const message = decision.messages[0]!
    expect(message.role).toBe('user')
    expect(message.content[0]!.text).toContain('ai-learning exercise')
    expect(message.source.plugin).toBe('ai-learning')
  })

  it('re-injects only after the state changes', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const harness = await makePreStepHarness()
    const state = await harness.engine.create(CWD, { origin: { path: '/src/project', language: 'go' }, scope: { level: 'beginner' } })

    const first = await harness.step()
    expect(first.messages).toHaveLength(1)
    const second = await harness.step()
    expect(second.messages).toHaveLength(0)

    vi.setSystemTime(new Date('2026-01-01T00:01:00Z'))
    state.phase = 'skeletonizing'
    await harness.engine.save(CWD, state)
    const third = await harness.step()
    expect(third.messages).toHaveLength(1)
  })

  it('stops injecting once the exercise completes', async () => {
    const harness = await makePreStepHarness()
    const state = await harness.engine.create(CWD, { origin: { path: '/src/project', language: 'go' }, scope: { level: 'beginner' } })
    state.phase = 'complete'
    await harness.engine.save(CWD, state)
    const decision = await harness.step()
    expect(decision.messages).toHaveLength(0)
  })
})
