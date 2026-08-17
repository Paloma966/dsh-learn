/**
 * The `/learn` human command: `new`, `status`, and `check`.
 *
 * Registration goes through `ctx.commands` when a command adapter is
 * composed (interactive deployments); headless and ACP-only compositions
 * have no registry and simply skip this surface. The command plane renders
 * results directly — nothing here enters model history.
 *
 * @module dsh-ai-learning/commands
 */

import type { Context } from '@deepseek-ai/cordis'
import { AiLearningEngine } from './engine.ts'
import { isLearningError } from './errors.ts'
import { runMilestoneGate } from './gate.ts'
import type {
  CommandDefinitionShape,
  CommandInvocationShape,
  CommandResultShape,
  CommandsServiceShape,
} from './host-types.ts'
import type { LearnerLevel, Milestone } from './types.ts'

const DEFAULT_LANGUAGE = 'go'
const LEVELS: readonly LearnerLevel[] = ['beginner', 'intermediate', 'advanced']

/** Register the `learn` command when a command registry is composed. */
export function registerCommands(ctx: Context, engine: AiLearningEngine): void {
  const commands = ctx.get('commands') as CommandsServiceShape | undefined
  if (commands === undefined) return
  commands.register({
    name: 'learn',
    description: 'Create, inspect, and verify an ai-learning exercise: new <origin-path> | status | check [milestone]',
    input: {
      hint: 'new <origin-path> [--lang go] [--level beginner] [--module pkg] | status | check [milestone]',
    },
    handler: (invocation) => handleLearn(ctx, engine, invocation),
  })
}

async function handleLearn(
  ctx: Context,
  engine: AiLearningEngine,
  invocation: CommandInvocationShape,
): Promise<CommandResultShape> {
  try {
    const tokens = invocation.rawInput.trim().split(/\s+/)
    const sub = tokens[0] ?? ''
    const args = tokens.slice(1)
    if (sub === 'new') return await handleNew(engine, invocation, args)
    if (sub === 'status') return await handleStatus(engine, invocation)
    if (sub === 'check') return await handleCheck(ctx, engine, invocation, args)
    return { kind: 'error', text: `unknown subcommand "${sub}"; expected new | status | check` }
  } catch (error) {
    if (isLearningError(error)) return { kind: 'error', text: error.message }
    const message = error instanceof Error ? error.message : String(error)
    return { kind: 'error', text: `internal error: ${message}` }
  }
}

interface NewOptions {
  path?: string
  language: string
  level: LearnerLevel
  module?: string
}

function parseNewArgs(args: readonly string[]): NewOptions {
  const options: NewOptions = { language: DEFAULT_LANGUAGE, level: 'beginner' }
  const positional: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!
    if (arg === '--lang' || arg === '--level' || arg === '--module') {
      const value = args[index + 1]
      if (value === undefined) continue
      if (arg === '--lang') options.language = value
      else if (arg === '--level') options.level = value as LearnerLevel
      else options.module = value
      index += 1
      continue
    }
    if (arg.startsWith('--lang=')) options.language = arg.slice('--lang='.length)
    else if (arg.startsWith('--level=')) options.level = arg.slice('--level='.length) as LearnerLevel
    else if (arg.startsWith('--module=')) options.module = arg.slice('--module='.length)
    else positional.push(arg)
  }
  const first = positional[0]
  if (first !== undefined) options.path = first
  return options
}

async function handleNew(
  engine: AiLearningEngine,
  invocation: CommandInvocationShape,
  args: readonly string[],
): Promise<CommandResultShape> {
  const options = parseNewArgs(args)
  if (options.path === undefined) {
    return {
      kind: 'error',
      text: 'usage: /learn new <origin-path> [--lang go] [--level beginner] [--module pkg]',
    }
  }
  if (!LEVELS.includes(options.level)) {
    return { kind: 'error', text: `invalid level "${options.level}"; expected ${LEVELS.join(' | ')}` }
  }
  const cwd = invocation.agent.session.header.cwd
  const state = await engine.create(cwd, {
    origin: { path: options.path, language: options.language },
    scope: { level: options.level, ...(options.module !== undefined ? { module: options.module } : {}) },
  })
  return {
    kind: 'success',
    text:
      `Learning exercise created for ${options.path} (${options.language}, ${options.level}).\n` +
      `${engine.describe(state)}\n` +
      `Next: have the AI analyze the project and record todos and milestones with the ai_learning tools.`,
  }
}

async function handleStatus(
  engine: AiLearningEngine,
  invocation: CommandInvocationShape,
): Promise<CommandResultShape> {
  const cwd = invocation.agent.session.header.cwd
  const state = await engine.load(cwd)
  if (state === undefined) {
    return { kind: 'error', text: `no learning state under ${cwd}; run "/learn new <origin-path>" first` }
  }
  return { kind: 'success', text: engine.describe(state) }
}

async function handleCheck(
  ctx: Context,
  engine: AiLearningEngine,
  invocation: CommandInvocationShape,
  args: readonly string[],
): Promise<CommandResultShape> {
  const cwd = invocation.agent.session.header.cwd
  const state = await engine.load(cwd)
  if (state === undefined) {
    return { kind: 'error', text: `no learning state under ${cwd}; run "/learn new <origin-path>" first` }
  }
  const milestone = pickMilestone(state.milestones, args[0])
  if (milestone === undefined) {
    return {
      kind: 'error',
      text: args[0] === undefined
        ? 'no milestone is in_progress or failed; nothing to check'
        : `unknown milestone "${args[0]}"`,
    }
  }
  if (milestone.status === 'failed') engine.retryMilestone(state, milestone.id)

  const settled = await runMilestoneGate(ctx, engine, cwd, state, milestone, invocation.signal, invocation.agent.session)

  if (settled.interrupted) {
    return { kind: 'error', text: `gate "${settled.command.join(' ')}" was interrupted; milestone marked failed` }
  }
  if (settled.outcome.kind === 'failed') {
    return {
      kind: 'error',
      text:
        `gate "${settled.command.join(' ')}" failed with exit code ${settled.exitCode}; milestone marked failed.\n` +
        (settled.stderr.trim() === '' ? `stdout tail:\n${settled.stdout}` : `stderr tail:\n${settled.stderr}`),
    }
  }
  if (settled.outcome.kind === 'pending-questions') {
    return {
      kind: 'success',
      text:
        `gate "${settled.command.join(' ')}" passed, but ${milestone.questions.filter((question) => question.status !== 'passed').length} question(s) remain open.\n` +
        'Have the AI finish the Socratic follow-ups; the milestone verifies when every question passes and the gate is green.',
    }
  }
  const next = state.milestones.find((entry) => entry.status === 'in_progress')
  const complete = state.phase === 'complete'
  return {
    kind: 'success',
    text:
      `gate "${settled.command.join(' ')}" passed — milestone "${milestone.id}" verified.\n` +
      (complete ? 'All milestones verified: the exercise is complete.' : `Next milestone: ${next?.title ?? 'none'}.`),
  }
}

function pickMilestone(milestones: readonly Milestone[], requestedId: string | undefined): Milestone | undefined {
  if (requestedId !== undefined) {
    return milestones.find((milestone) => milestone.id === requestedId)
  }
  return (
    milestones.find((milestone) => milestone.status === 'in_progress') ??
    milestones.find((milestone) => milestone.status === 'failed')
  )
}
