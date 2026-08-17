/**
 * In-memory `StateFileSystem` fake for engine tests.
 *
 * Implements exactly the primitives the engine uses (`resolve`, `stat`,
 * `readText`, `writeText`) plus the `createIfAbsent` write-intent contract
 * the real provider honors; everything else rejects loudly so a test that
 * accidentally reaches another primitive fails instead of passing silently.
 */

import type { StateFileSystem, LearningFsTarget, LearningWriteIntent } from '../src/fs-types.ts'

export class FakeFileSystem implements StateFileSystem {
  readonly files = new Map<string, string>()
  /** Paths stat pretends are absent (simulates the createIfAbsent race). */
  readonly hideFromStat = new Set<string>()

  private key(path: string): string {
    return path.replace(/\/+$/, '') || '/'
  }

  async resolve(path: string, opts?: { cwd?: string }): Promise<LearningFsTarget> {
    const cwd = opts?.cwd ?? '/'
    const joined = path.startsWith('/') ? path : `${cwd}/${path}`
    return { targetKey: joined, displayPath: joined }
  }

  async stat(target: LearningFsTarget): Promise<{ version: number; type: string } | undefined> {
    const key = this.key(target.targetKey as string)
    if (this.hideFromStat.has(key) || !this.files.has(key)) return undefined
    return { version: 1, type: 'file' }
  }

  async readText(target: LearningFsTarget): Promise<string> {
    const content = this.files.get(this.key(target.targetKey as string))
    if (content === undefined) {
      const error = new Error('FS_NOT_FOUND') as Error & { code: string }
      error.code = 'FS_NOT_FOUND'
      throw error
    }
    return content
  }

  async writeText(target: LearningFsTarget, content: string, expected?: LearningWriteIntent): Promise<void> {
    const key = this.key(target.targetKey as string)
    if (expected !== undefined && 'createIfAbsent' in expected && this.files.has(key)) {
      const error = new Error('FS_NOT_OBSERVED') as Error & { code: string }
      error.code = 'FS_NOT_OBSERVED'
      throw error
    }
    this.files.set(key, content)
  }
}
