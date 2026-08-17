/**
 * The learning-state schema persisted at `<cwd>/.ai-learning/state.json`.
 *
 * One file travels with the skeleton repository, so progress survives every
 * session boundary: milestones, todo status, asked questions, assessment
 * notes, and gate records all live here, not in conversation memory.
 *
 * @module dsh-ai-learning/types
 */

/** Difficulty, 1 (reading the data model) to 4 (distributed coordination). */
export type Difficulty = 1 | 2 | 3 | 4

/** One annotated skeleton stub: WHAT the code does and HOW to rebuild it. */
export interface Todo {
  /** Stable id referenced by milestones, e.g. "t3". */
  readonly id: string
  /** File and symbol location, e.g. "internal/store/task.go SaveTask". */
  readonly where: string
  /** One-line description of the method's purpose. */
  readonly what: string
  /** Numbered implementation hints. */
  readonly steps: readonly string[]
  /** Optional traps, design rationale, and language/library features. */
  readonly hint?: string
  /** Difficulty rating. */
  readonly difficulty: Difficulty
  status: TodoStatus
}

export type TodoStatus = 'pending' | 'in_progress' | 'done'

/** A verification gate: one executable command line that must succeed. */
export interface GateSpec {
  /** Command and arguments, e.g. ["go", "build", "./..."]. */
  build: string[]
}

/** One executed gate: the evidence that a milestone was actually verified. */
export interface GateRecord {
  /** Milestone id the gate belongs to. */
  readonly milestone: string
  /** The command line that was executed. */
  readonly command: readonly string[]
  /** Exit code of the process. */
  readonly exitCode: number
  /** Captured stdout, capped by `maxCapturedOutput`. */
  readonly stdout: string
  /** Captured stderr, capped by `maxCapturedOutput`. */
  readonly stderr: string
  /** Wall-clock duration in milliseconds. */
  readonly durationMs: number
  /** Epoch milliseconds of the run. */
  readonly at: number
}

/** One Socratic question with its assessment key and escalation hints. */
export interface Question {
  /** The question the AI should ask the learner. */
  readonly ask: string
  /**
   * Expected answer points used as the assessment key. The AI compares the
   * learner's answer against these instead of judging by vibes. Never shown
   * to the learner directly; reveal only through the hint ladder.
   */
  readonly expected: readonly string[]
  /** Escalating hints, consumed one at a time before any reveal. */
  readonly hints: readonly string[]
  status: QuestionStatus
  /** How many hints have been offered (0..hints.length). */
  hintLevel: number
  /** Assessment note recorded when the answer settles. */
  note?: string
}

export type QuestionStatus = 'unasked' | 'asked' | 'passed' | 'failed'

/** A group of related todos plus its gate and questions: one learning step. */
export interface Milestone {
  /** Stable id, e.g. "m1". */
  readonly id: string
  /** Short human title, e.g. "Task CRUD in etcd". */
  readonly title: string
  /** Todo ids this milestone covers. */
  readonly todos: readonly string[]
  /** Per-milestone gate; falls back to the language gate when omitted. */
  readonly gate?: GateSpec
  /** Socratic questions for this milestone. */
  readonly questions: readonly Question[]
  status: MilestoneStatus
}

export type MilestoneStatus = 'pending' | 'in_progress' | 'verified' | 'failed'

/** Workflow phase; advances strictly forward. */
export type Phase = 'analyzing' | 'skeletonizing' | 'learning' | 'complete'

/** Learner calibration chosen at `create` time. */
export type LearnerLevel = 'beginner' | 'intermediate' | 'advanced'

/** The whole persisted learning state. */
export interface LearningState {
  readonly schemaVersion: 1
  phase: Phase
  /** Where the original project lives and what language it speaks. */
  readonly origin: {
    /** Absolute path of the original project the learner studies. */
    readonly path: string
    /** Language key selecting the verification gate, e.g. "go". */
    readonly language: string
  }
  /** Scope configuration captured at create time. */
  readonly scope: {
    /** Optional submodule to focus on instead of the whole project. */
    readonly module?: string
    /** Learner calibration. */
    readonly level: LearnerLevel
  }
  /** Milestones in learning order. */
  milestones: Milestone[]
  /** All todos, keyed implicitly by id. */
  todos: Todo[]
  /** Language gate snapshot taken at create time. */
  readonly gates: Readonly<Record<string, GateSpec>>
  /** Every executed gate, newest last. */
  records: GateRecord[]
  /** Epoch milliseconds of the last save. */
  updatedAt: number
}

/** Fresh-state inputs for `AiLearningEngine.create`. */
export interface CreateStateInput {
  readonly origin: LearningState['origin']
  readonly scope: LearningState['scope']
}

/**
 * Deployment configuration for the ai-learning plugin. Named
 * `AiLearningConfig` so the type never merges with the `Config` schema
 * value exported by the plugin entry (TS forbids mixing local and
 * re-exported declarations in one merged name).
 */
export interface AiLearningConfig {
  /** Directory under the session cwd holding the plugin state file. */
  stateDir?: string
  /** Per-language verification gates keyed by language name, e.g. "go". */
  gates?: Record<string, GateSpec>
  /** Maximum captured characters per gate output stream. */
  maxCapturedOutput?: number
}

/** Outcome of `AiLearningEngine.recordGate`. */
export type GateOutcome =
  | { readonly kind: 'verified' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'pending-questions' }

export interface EngineStateSnapshot {
  readonly state: LearningState
  readonly phase: Phase
  readonly current: Milestone | undefined
  readonly next: Milestone | undefined
  readonly gateCount: number
  readonly questionCount: number
  readonly doneQuestionCount: number
}
