/**
 * The narrow slice of the host filesystem seam this plugin needs.
 *
 * Deliberately NOT imported from `@deepseek-ai/dsh-fs`: the published rc.1
 * dependency tree references unpublished packages, so external bundles must
 * not install dsh packages. The host's real `ctx.fs` satisfies this
 * structural interface at runtime; the engine talks to it through this
 * declared contract only.
 *
 * @module dsh-ai-learning/fs-types
 */

/** Opaque resolved-file handle; only `displayPath` is safe to show. */
export interface LearningFsTarget {
  readonly targetKey: unknown
  readonly displayPath: string
}

/** Metadata returned by `stat`. */
export interface LearningFsInfo {
  readonly version: unknown
  readonly type: string
}

/** Guarded write intent: create only when the target is absent. */
export interface CreateIfAbsentIntent {
  readonly createIfAbsent: true
}

/** The write-intent union the engine ever passes to `writeText`. */
export type LearningWriteIntent = CreateIfAbsentIntent

/** Filesystem surface the engine uses; satisfied by the host `ctx.fs`. */
export interface StateFileSystem {
  resolve(path: string, opts?: { cwd?: string }): Promise<LearningFsTarget>
  stat(target: LearningFsTarget, signal?: AbortSignal): Promise<LearningFsInfo | undefined>
  readText(target: LearningFsTarget, signal?: AbortSignal): Promise<string>
  writeText(target: LearningFsTarget, content: string, expected?: LearningWriteIntent, signal?: AbortSignal): Promise<void>
}
