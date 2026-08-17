/**
 * Structural contracts for the host surfaces this plugin consumes
 * optionally: the command registry, the shell executor, and the receiving
 * agent.
 *
 * Deliberately NOT imported from `@deepseek-ai/dsh-*`: the published rc.1
 * dependency tree references unpublished packages, so external bundles must
 * not install dsh packages. These interfaces declare exactly the fields the
 * plugin reads; the host's real services satisfy them at runtime. The
 * mandatory `fs` seam lives in `fs-types.ts`.
 *
 * @module dsh-ai-learning/host-types
 */

/** One captured output stream from the shell executor. */
export interface CollectedOutputShape {
  /** Collected text — the TAIL of the stream when truncated. */
  readonly text: string
  /** True when bytes were dropped from `text`. */
  readonly truncated: boolean
  /** Path to a file holding the COMPLETE stream, when available. */
  readonly spillPath?: string
}

/** Foreground shell result: nonzero exits resolve, they never reject. */
export interface ShellRunResultShape {
  /** Exit code; null when the process died from a signal. */
  readonly exitCode: number | null
  /** Terminating signal (e.g. 'SIGTERM'); null on normal exit. */
  readonly signal: string | null
  /** True when the executor's own timeout killed the command. */
  readonly timedOut: boolean
  /** True when the caller's AbortSignal killed the command. */
  readonly aborted: boolean
  /** The effective timeout applied to this run. */
  readonly timeoutMs: number
  readonly stdout: CollectedOutputShape
  readonly stderr: CollectedOutputShape
}

/** The subset of the shell exec request the plugin ever sets. */
export interface ShellExecSpecShape {
  /** The full command line, e.g. "go build ./...". */
  readonly command: string
  readonly workdir?: string
  readonly timeoutMs?: number
  readonly stdoutMaxBytes?: number
  readonly signal?: AbortSignal
  /** Per-call sandbox policy resolved from the calling session. */
  readonly sandboxPolicy?: unknown
}

/** The shell seam (`ctx.shell`); provided by one bash provider per host. */
export interface ShellServiceShape {
  run(spec: ShellExecSpecShape): Promise<ShellRunResultShape>
}

/** The receiving agent slice commands are invoked against. */
export interface AgentShape {
  readonly session: {
    readonly header: {
      /** The session's working directory. */
      readonly cwd: string
    }
  }
}

/** Invocation passed to one registered command handler. */
export interface CommandInvocationShape {
  readonly commandId: unknown
  readonly agent: AgentShape
  readonly rawInput: string
  readonly signal: AbortSignal
}

/** Command outcome rendered directly by the dispatching UI. */
export type CommandResultShape =
  | { readonly kind: 'success'; readonly text?: string }
  | { readonly kind: 'error'; readonly text: string }

/** Plugin-owned command registration (`ctx.commands.register`). */
export interface CommandDefinitionShape {
  readonly name: string
  readonly description: string
  readonly input?: { readonly hint: string }
  readonly recordInput?: boolean
  handler(invocation: CommandInvocationShape): CommandResultShape | Promise<CommandResultShape>
}

/** The command registry (`ctx.commands`); optional in headless compositions. */
export interface CommandsServiceShape {
  register(definition: CommandDefinitionShape): unknown
}

/** One text content block in a model-facing message or tool render. */
export interface TextBlockShape {
  readonly type: 'text'
  readonly text: string
}

/** The tool registry (`ctx.tools`); optional in executor-less compositions. */
export interface ToolsServiceShape {
  register(definition: ToolDefinitionShape): unknown
}

/** A registered tool: JSON-Schema parameters plus execution and render. */
export interface ToolDefinitionShape {
  readonly name: string
  readonly description: string
  /** JSON Schema object for the arguments. */
  readonly parameters: Record<string, unknown>
  readonly output: {
    readonly schema: Record<string, unknown>
    render(args: unknown, value: unknown): TextBlockShape[]
  }
  execute(args: unknown, exec: ToolRunContextShape): Promise<unknown>
  readonly timeoutMs?: number
}

/** Runtime context handed to a tool body. */
export interface ToolRunContextShape {
  readonly callId: unknown
  /** The agent on whose behalf the call runs; absent in executor-less loops. */
  readonly agent?: AgentShape
  readonly signal: AbortSignal
}

/** A transient injected user-role message for pre-step context. */
export interface InjectedUserMessageShape {
  readonly id: string
  readonly role: 'user'
  readonly content: readonly TextBlockShape[]
  readonly source: {
    readonly kind: 'plugin'
    readonly plugin: string
    readonly form: string
    readonly sections: readonly { readonly name: string; readonly text: string }[]
  }
}

/** The `agent/pre-step` waterfall decision the plugin extends. */
export interface PreStepDecisionShape {
  readonly kind: 'enter' | 'reject'
  readonly messages: readonly InjectedUserMessageShape[]
}

/** Payload of one `agent/pre-step` waterfall dispatch. */
export interface PreStepPayloadShape {
  readonly agent: AgentShape
  readonly turn: number
  readonly step: number
  readonly signal: AbortSignal
}

/** Model and user invocation controls carried by a skill summary. */
export interface SkillInvocationPolicyShape {
  readonly modelInvocable: boolean
  readonly userInvocable: boolean
}

/** Provider-specific base for relative skill resources. */
export type SkillResourceBaseShape =
  | { readonly kind: 'directory'; readonly path: string }
  | { readonly kind: 'url'; readonly url: string }
  | { readonly kind: 'opaque'; readonly description: string }

/** One provider catalog entry. */
export interface SkillCandidateShape {
  readonly name: string
  readonly description: string
  readonly whenToUse?: string
  readonly invocation: SkillInvocationPolicyShape
  readonly provider: string
  readonly source: string
  readonly resourceBase?: SkillResourceBaseShape
  /** Lower ranks win duplicate skill names. */
  readonly rank: number
  /** Opaque provider-owned handle passed back to `provider.get()`. */
  readonly locator: unknown
  readonly path?: string
  readonly metadata?: Readonly<Record<string, unknown>>
}

/** Complete parsed skill body returned by `provider.get()`. */
export interface SkillDefinitionShape {
  readonly name: string
  readonly description: string
  readonly whenToUse?: string
  readonly invocation: SkillInvocationPolicyShape
  readonly provider: string
  readonly source: string
  readonly resourceBase?: SkillResourceBaseShape
  readonly content: string
  readonly path?: string
  readonly metadata?: Readonly<Record<string, unknown>>
}

/** One skill source registered on `ctx.skills`. */
export interface SkillsProviderShape {
  readonly name: string
  list(options: unknown): Promise<readonly SkillCandidateShape[]>
  get(candidate: SkillCandidateShape, options: unknown): Promise<SkillDefinitionShape | undefined>
}

/** The skill registry (`ctx.skills`); optional in minimal compositions. */
export interface SkillsServiceShape {
  registerProvider(create: (control: unknown) => SkillsProviderShape): () => void
}
