/**
 * Loader-contract composition test over the BUILT artifact (`lib/index.js`):
 * the exact module shape a profile Loader consumes (name/inject/Config/apply,
 * no default export), full-surface registration, and fiber disposal.
 *
 * Runs after `npm run build` (see the `pretest` script), so what this test
 * loads is what `dsh plugin add` ships — not the source tree.
 */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import type {
  CommandDefinitionShape,
  ShellExecSpecShape,
  ShellRunResultShape,
  SkillsProviderShape,
  ToolDefinitionShape,
} from '../src/host-types.ts'
import { FakeFileSystem } from './fake-fs.ts'

const BUILT_URL = new URL('../lib/index.js', import.meta.url)

class FakeCommands {
  def: CommandDefinitionShape | undefined
  register(definition: CommandDefinitionShape): unknown {
    this.def = definition
    return undefined
  }
}

class FakeShell {
  async run(_spec: ShellExecSpecShape): Promise<ShellRunResultShape> {
    return { exitCode: 0, signal: null, timedOut: false, aborted: false, timeoutMs: 0, stdout: { text: '', truncated: false }, stderr: { text: '', truncated: false } }
  }
}

interface FakeToolsShape {
  registered: ToolDefinitionShape[]
  register(definition: ToolDefinitionShape): unknown
}

interface FakeSkillsShape {
  provider: SkillsProviderShape | undefined
  registerProvider(create: (control: unknown) => SkillsProviderShape): () => void
}

async function makeComposition() {
  const built = (await import(BUILT_URL.href)) as {
    name: string
    inject: readonly string[]
    Config: unknown
    apply: (ctx: Context, config?: Record<string, unknown>) => void
    default?: unknown
  }
  const ctx = new Context()
  const commands = new FakeCommands()
  const tools: FakeToolsShape = { registered: [], register: (definition) => { tools.registered.push(definition) } }
  const skills: FakeSkillsShape = { provider: undefined, registerProvider: (create) => { skills.provider = create({}); return () => {} } }
  ctx.provide('fs', new FakeFileSystem())
  ctx.provide('commands', commands)
  ctx.provide('tools', tools)
  ctx.provide('skills', skills)
  ctx.provide('shell', new FakeShell())
  return { built, ctx, commands, tools, skills }
}

describe('built artifact composition', () => {
  it('exports the loader contract with no default export', async () => {
    const { built } = await makeComposition()
    expect(built.name).toBe('ai-learning')
    expect(built.inject).toEqual(['fs'])
    expect(built.Config).toBeDefined()
    expect(built.apply).toBeTypeOf('function')
    expect(built.default).toBeUndefined()
  })

  it('registers every surface and removes them on fiber disposal', async () => {
    const { built, ctx, commands, tools, skills } = await makeComposition()
    const fiber = await ctx.plugin(built as Parameters<Context['plugin']>[0])
    expect(ctx.get('aiLearning')).toBeDefined()
    expect(commands.def?.name).toBe('learn')
    expect(tools.registered.map((definition) => definition.name)).toEqual([
      'ai_learning_status',
      'ai_learning_next',
      'ai_learning_update',
    ])
    expect(skills.provider?.name).toBe('dsh-ai-learning')
    const engine = ctx.aiLearning
    expect(engine.config.stateDir).toBe('.ai-learning')

    await fiber.dispose()
    expect(ctx.get('aiLearning')).toBeUndefined()
  })
})
