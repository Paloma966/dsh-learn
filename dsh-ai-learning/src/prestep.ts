/**
 * Pre-step progress injection: when the session cwd holds an active learning
 * exercise, every agent step receives a compact progress card, so a resumed
 * or fresh session never has to reconstruct the exercise from scratch.
 *
 * The card re-injects only when the state file changed (tracked per agent by
 * `updatedAt`), keeping the token cost at one card per state mutation.
 *
 * @module dsh-ai-learning/prestep
 */

import type { Context } from '@deepseek-ai/cordis'
import { AiLearningEngine } from './engine.ts'
import { newMessageId } from './tools.ts'
import type { InjectedUserMessageShape, PreStepDecisionShape, PreStepPayloadShape } from './host-types.ts'

/** Build the injected progress message for one state snapshot. */
export function buildProgressMessage(state: Awaited<ReturnType<AiLearningEngine['load']>> & object): InjectedUserMessageShape {
  const text = [
    'This workspace has an active ai-learning exercise. Help the learner progress through it.',
    '',
    'Work with the learner: guide them through the current milestone todos, ask the Socratic questions one at a time, escalate through hints before revealing anything, and grade answers against the expected points. Use the ai_learning_status, ai_learning_next, and ai_learning_update tools; run "/learn check <milestone>" only when the learner says they are done.',
    '',
  ].join('\n')
  const full = `${text}${JSON.stringify(state, null, 2)}`
  return {
    id: newMessageId(),
    role: 'user',
    content: [{ type: 'text', text: full }],
    source: {
      kind: 'plugin',
      plugin: 'ai-learning',
      form: 'snapshot',
      sections: [{ name: 'ai-learning progress', text: full }],
    },
  }
}

/** Register the pre-step listener; re-injects only when the state changed. */
export function registerPreStep(ctx: Context, engine: AiLearningEngine): void {
  const lastInjected = new WeakMap<object, number>()
  // The harness's `agent/pre-step` waterfall is declared by packages this
  // bundle cannot install, so the event name is dispatched untyped.
  const on = ctx.on.bind(ctx) as (
    name: string,
    listener: (payload: unknown, next: () => Promise<PreStepDecisionShape>) => Promise<PreStepDecisionShape>,
    options?: { prepend?: boolean },
  ) => unknown
  on(
    'agent/pre-step',
    async (payload: unknown, next: () => Promise<PreStepDecisionShape>): Promise<PreStepDecisionShape> => {
      const { agent, signal } = payload as PreStepPayloadShape
      const decision = await next()
      if (decision.kind === 'reject' || signal.aborted) return decision
      const cwd = agent?.session?.header?.cwd
      if (typeof cwd !== 'string') return decision
      let state: Awaited<ReturnType<AiLearningEngine['load']>>
      try {
        state = await engine.load(cwd)
      } catch {
        return decision
      }
      if (state === undefined || state.phase === 'complete') return decision
      if (lastInjected.get(agent) === state.updatedAt) return decision
      lastInjected.set(agent, state.updatedAt)
      return { kind: 'enter', messages: [...decision.messages, buildProgressMessage(state)] }
    },
    { prepend: true },
  )
}
