/**
 * The bundled `ai-learning` skill provider.
 *
 * Ships the teaching methodology as a packaged Markdown skill (the same
 * pattern as `@deepseek-ai/dsh-skill-badge`): one immutable candidate whose
 * body is read from the package's `assets/` directory, with that directory
 * exposed as the resource base so the body's `references/examples.md` loads
 * on demand through the skill tool. The pedagogy stays editable Markdown —
 * the plugin code only carries the machinery.
 *
 * @module dsh-ai-learning/skill
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type {
  SkillCandidateShape,
  SkillDefinitionShape,
  SkillsProviderShape,
  SkillsServiceShape,
} from './host-types.ts'

const SKILL_DIR_URL = new URL('../assets/skills/ai-learning/', import.meta.url)
const SKILL_BODY_URL = new URL('SKILL.md', SKILL_DIR_URL)
const RESOURCE_BASE = { kind: 'directory', path: fileURLToPath(SKILL_DIR_URL) } as const

export const SKILL_NAME = 'ai-learning'
const PROVIDER_NAME = 'dsh-ai-learning'

const DESCRIPTION =
  'Turn any codebase into a progressive, learn-by-doing exercise: analyze the architecture, create a compiling skeleton with annotated TODO stubs, track milestones and verification gates in state, and verify comprehension with graded Socratic questions. Use when the user wants to learn or study a codebase, asks for a learning skeleton or simplified version, or wants a tutorial-style progressive exercise for an existing project.'

const WHEN_TO_USE =
  'Trigger when the user says "help me learn/understand this project", "create a learning skeleton", "make a simplified version for learning", "turn this into a tutorial", or references an existing project they want to study.'

const INVOCATION = { modelInvocable: true, userInvocable: true } as const

const CANDIDATE: SkillCandidateShape = {
  name: SKILL_NAME,
  description: DESCRIPTION,
  whenToUse: WHEN_TO_USE,
  invocation: INVOCATION,
  provider: PROVIDER_NAME,
  source: 'bundled',
  resourceBase: RESOURCE_BASE,
  // Below every local filesystem root (100–600), so a user's own
  // same-named skill would win; high enough to stay out of the way.
  rank: 900,
  locator: SKILL_BODY_URL,
}

const provider: SkillsProviderShape = {
  name: PROVIDER_NAME,
  list: () => Promise.resolve([CANDIDATE]),
  async get(_candidate): Promise<SkillDefinitionShape> {
    return {
      ...CANDIDATE,
      ...(CANDIDATE.whenToUse !== undefined ? { whenToUse: CANDIDATE.whenToUse } : {}),
      content: await readFile(SKILL_BODY_URL, 'utf8'),
    }
  },
}

/** Register the bundled skill provider when a skill registry is composed. */
export function registerSkill(ctx: Context): void {
  const skills = ctx.get('skills') as SkillsServiceShape | undefined
  if (skills === undefined) return
  skills.registerProvider(() => provider)
}
