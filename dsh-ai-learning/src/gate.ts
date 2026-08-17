/**
 * Shared gate execution: run a milestone's verification command through
 * `ctx.shell`, fold the outcome into the engine (record + status + save),
 * and hand the settled result back for rendering.
 *
 * Used by both the human `/learn check` command and the model-facing
 * `ai_learning_update` `check_gate` action, so the two surfaces can never
 * drift on what "verified" means.
 *
 * @module dsh-ai-learning/gate
 */

import type { Context } from '@deepseek-ai/cordis'
import { AiLearningEngine } from './engine.ts'
import { LearningError } from './errors.ts'
import type { ShellServiceShape } from './host-types.ts'
import type { GateOutcome, LearningState, Milestone } from './types.ts'

export const GATE_TIMEOUT_MS = 120_000

/** The settled result of one gate run. */
export interface MilestoneGateOutcome {
  readonly outcome: GateOutcome
  readonly command: readonly string[]
  readonly exitCode: number
  readonly interrupted: boolean
  readonly stdout: string
  readonly stderr: string
}

/**
 * Run the effective gate for `milestone`, record it, persist the state, and
 * return the settled outcome. A failed milestone reopens automatically —
 * re-running the check after a fix is the intended retry loop.
 *
 * `session` (the calling agent's session, when available) feeds the host's
 * per-call sandbox-policy resolution, so a sandboxing shell executor
 * receives the policy it requires instead of falling back to deployment
 * defaults.
 */
export async function runMilestoneGate(
  ctx: Context,
  engine: AiLearningEngine,
  cwd: string,
  state: LearningState,
  milestone: Milestone,
  signal: AbortSignal,
  session?: unknown,
): Promise<MilestoneGateOutcome> {
  const shell = ctx.get('shell') as ShellServiceShape | undefined
  if (shell === undefined) {
    throw new LearningError('SHELL_MISSING', 'no shell executor composed; cannot run the verification gate')
  }
  const gate = milestone.gate ?? state.gates[state.origin.language]
  if (gate === undefined) {
    throw new LearningError('GATE_UNKNOWN', `no gate recorded for language "${state.origin.language}"`)
  }
  if (milestone.status === 'failed') engine.retryMilestone(state, milestone.id)
  const command = [...gate.build]
  const started = Date.now()
  const result = await shell.run({
    command: command.join(' '),
    workdir: cwd,
    timeoutMs: GATE_TIMEOUT_MS,
    stdoutMaxBytes: engine.config.maxCapturedOutput,
    signal,
    sandboxPolicy: resolveSandboxPolicy(ctx, session),
  })
  const durationMs = Date.now() - started
  const interrupted = result.timedOut || result.aborted
  const exitCode = interrupted ? 1 : (result.exitCode ?? 1)
  const outcome = engine.recordGate(state, milestone.id, {
    command,
    exitCode,
    stdout: result.stdout.text,
    stderr: result.stderr.text,
    durationMs,
  })
  await engine.save(cwd, state)
  return { outcome, command, exitCode, interrupted, stdout: result.stdout.text, stderr: result.stderr.text }
}

interface SandboxPolicyServiceShape {
  resolve(request?: { session?: unknown }): unknown
}

/** Resolve the per-call sandbox policy when the host composes one. */
function resolveSandboxPolicy(ctx: Context, session: unknown): unknown {
  const service = ctx.get('sandboxPolicy') as SandboxPolicyServiceShape | undefined
  if (service === undefined) return undefined
  return service.resolve(session === undefined ? {} : { session })
}
