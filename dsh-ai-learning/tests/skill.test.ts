import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import * as plugin from '../src/index.ts'
import type { SkillCandidateShape, SkillDefinitionShape, SkillsProviderShape, SkillsServiceShape } from '../src/host-types.ts'
import { FakeFileSystem } from './fake-fs.ts'

class FakeSkills implements SkillsServiceShape {
  provider: SkillsProviderShape | undefined
  registerProvider(create: (control: unknown) => SkillsProviderShape): () => void {
    this.provider = create({})
    return () => {}
  }
}

const SKILL_DIR = fileURLToPath(new URL('../assets/skills/ai-learning/', import.meta.url))

describe('bundled skill provider', () => {
  it('registers the ai-learning provider when a registry is composed', async () => {
    const ctx = new Context()
    const skills = new FakeSkills()
    ctx.provide('fs', new FakeFileSystem())
    ctx.provide('skills', skills)
    await ctx.plugin(plugin)
    expect(skills.provider?.name).toBe('dsh-ai-learning')

    const candidate = (await skills.provider!.list({}))[0] as SkillCandidateShape
    expect(candidate.name).toBe('ai-learning')
    expect(candidate.invocation).toEqual({ modelInvocable: true, userInvocable: true })
    expect(candidate.resourceBase).toEqual({ kind: 'directory', path: SKILL_DIR })

    const definition = (await skills.provider!.get(candidate, {})) as SkillDefinitionShape
    expect(definition.content).toContain('name: ai-learning')
    expect(definition.content).toContain('Socratic verification')
  })

  it('skips registration without a skill registry', async () => {
    const ctx = new Context()
    ctx.provide('fs', new FakeFileSystem())
    await ctx.plugin(plugin)
    expect(ctx.get('skills')).toBeUndefined()
  })

  it('ships the skill body and references on disk', () => {
    expect(existsSync(join(SKILL_DIR, 'SKILL.md'))).toBe(true)
    expect(existsSync(join(SKILL_DIR, 'references', 'examples.md'))).toBe(true)
  })
})
