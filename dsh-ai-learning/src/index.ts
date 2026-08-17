/**
 * dsh-ai-learning: turn any codebase into a progressive, learn-by-doing
 * exercise with comprehension verification.
 *
 * Function plugin form (name/inject/Config/apply, no default export): the
 * Loader convention for plugins that register capabilities instead of
 * exporting a Cordis service class. `apply` constructs the engine and
 * registers it on `ctx.aiLearning` through `ctx.provide`, the same seam
 * production boot plugins use. Later layers (commands, model tools,
 * pre-step injection) hang off the same service.
 *
 * @module dsh-ai-learning
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { AiLearningEngine } from './engine.ts'
import { registerCommands } from './commands.ts'
import { registerPreStep } from './prestep.ts'
import { registerSkill } from './skill.ts'
import { registerTools } from './tools.ts'
import type { AiLearningConfig } from './types.ts'

export const name = 'ai-learning'

export const inject = ['fs']

export { AiLearningEngine } from './engine.ts'
export { LearningError, isLearningError } from './errors.ts'
export type { LearningErrorCode } from './errors.ts'
export type * from './types.ts'
export type * from './fs-types.ts'
export type * from './host-types.ts'

export const Config: z<AiLearningConfig> = z.object({
  stateDir: z.string().default('.ai-learning'),
  gates: z
    .dict(
      z.object({
        build: z.array(z.string()),
      }),
    )
    .default({ go: { build: ['go', 'build', './...'] } }),
  maxCapturedOutput: z.number().default(8000),
})

export function apply(ctx: Context, config: AiLearningConfig = {}): void {
  const engine = new AiLearningEngine(ctx, config)
  ctx.provide('aiLearning', engine)
  registerCommands(ctx, engine)
  registerTools(ctx, engine)
  registerPreStep(ctx, engine)
  registerSkill(ctx)
}
