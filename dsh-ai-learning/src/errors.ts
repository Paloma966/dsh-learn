/**
 * Structured errors for the learning engine. Every rejection carries a
 * stable `code` so callers (commands, tools) can branch without string
 * matching prose.
 *
 * @module dsh-ai-learning/errors
 */

export type LearningErrorCode =
  /** A state file already exists where create requires absence. */
  | 'STATE_EXISTS'
  /** No state file exists for this cwd. */
  | 'STATE_NOT_FOUND'
  /** The state file exists but does not parse or fails validation. */
  | 'STATE_INVALID'
  /** The requested transition violates the state machine. */
  | 'ILLEGAL_TRANSITION'
  /** The milestone id is unknown. */
  | 'MILESTONE_UNKNOWN'
  /** The todo id is unknown. */
  | 'TODO_UNKNOWN'
  /** The question index is out of range. */
  | 'QUESTION_UNKNOWN'
  /** The language has no gate in the resolved configuration. */
  | 'GATE_UNKNOWN'
  /** No shell executor is composed, so a gate cannot run. */
  | 'SHELL_MISSING'

/** A rejected learning-engine operation. */
export class LearningError extends Error {
  /** Stable machine-readable code. */
  readonly code: LearningErrorCode

  constructor(code: LearningErrorCode, message: string) {
    super(message)
    this.name = 'LearningError'
    this.code = code
  }
}

/** True when an arbitrary rejection is a LearningError. */
export function isLearningError(error: unknown): error is LearningError {
  return error instanceof LearningError
}
