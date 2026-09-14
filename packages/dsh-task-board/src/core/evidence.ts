/** Derived Evidence collector. Full DSH Session history is intentionally absent. */

import {
  boundedUtf8,
  createEvidence,
  type Evidence,
  type EvidenceFile,
  type RuntimeProviderEvidence,
  type TaskRunResultStatus,
} from './runs.ts'

export interface DiffEvidenceFile {
  path: string
  additions?: number
  deletions?: number
  binary?: boolean
  status?: EvidenceFile['status']
}

export interface DiffEvidenceSnapshot {
  baseRevision?: string
  finalRevision?: string
  files: readonly DiffEvidenceFile[]
  additions: number
  deletions: number
  preview?: string
  previewTruncated?: boolean
}

export interface WorktreeEvidenceStatus {
  clean: boolean
  dirty: boolean
  head?: string
  baseRevision?: string
}

export interface EvidenceCollectorInput {
  evidenceId: string
  runId: string
  sessionId?: string
  projectId?: string
  workspaceId: string
  worktreeId?: string
  startedAt: number
  finishedAt?: number
  resultStatus: TaskRunResultStatus
  status?: WorktreeEvidenceStatus
  diff?: DiffEvidenceSnapshot
  runtimeProviderEvidence?: RuntimeProviderEvidence
}

const MAX_FILES = 500
const MAX_PREVIEW = 64 * 1024

/**
 * Build the bounded Evidence summary used by the board and review panel.
 * `diff` is supplied by Git Graph's parser; this module never parses a patch.
 */
export function collectEvidence(input: EvidenceCollectorInput): Evidence {
  const diff = input.diff
  const files = (diff?.files ?? []).slice(0, MAX_FILES).map(file => ({
    path: file.path.slice(0, 1_024),
    status: file.status ?? (file.binary ? 'binary' : 'modified'),
    additions: Math.max(0, Math.floor(file.additions ?? 0)),
    deletions: Math.max(0, Math.floor(file.deletions ?? 0)),
    ...(file.binary ? { binary: true } : {}),
  }))
  const clean = input.status?.clean ?? !(input.status?.dirty ?? false)
  const dirty = input.status?.dirty ?? !clean
  const baseRevision = diff?.baseRevision ?? input.status?.baseRevision
  const finalRevision = diff?.finalRevision ?? input.status?.head
  const rawPreview = diff?.preview
  const rawPreviewBytes = rawPreview === undefined ? 0 : new TextEncoder().encode(rawPreview).byteLength
  const preview = rawPreview === undefined ? undefined : boundedUtf8(rawPreview, MAX_PREVIEW)
  return createEvidence({
    evidenceId: input.evidenceId,
    runId: input.runId,
    ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
    ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
    workspaceId: input.workspaceId,
    ...(input.worktreeId === undefined ? {} : { worktreeId: input.worktreeId }),
    ...(baseRevision === undefined ? {} : { baseRevision }),
    ...(finalRevision === undefined ? {} : { finalRevision }),
    changedFiles: files,
    additions: diff?.additions ?? files.reduce((sum, file) => sum + (file.additions ?? 0), 0),
    deletions: diff?.deletions ?? files.reduce((sum, file) => sum + (file.deletions ?? 0), 0),
    clean,
    dirty,
    resultStatus: input.resultStatus,
    startedAt: input.startedAt,
    ...(input.finishedAt === undefined ? {} : { finishedAt: input.finishedAt }),
    sessionDeepLink: input.sessionId === undefined ? undefined : `dsh-community://session/${input.sessionId}`,
    worktreeDeepLink: input.worktreeId === undefined ? undefined : `dsh-community://run/${input.runId}`,
    diffSource: diff === undefined ? 'unavailable' : 'git-graph',
    ...(diff === undefined ? {} : {
      diffCache: {
        source: 'git-graph' as const,
        generatedAt: input.finishedAt ?? Date.now(),
        ...(baseRevision === undefined ? {} : { baseRevision }),
        ...(finalRevision === undefined ? {} : { finalRevision }),
        bytes: new TextEncoder().encode(preview ?? '').byteLength,
        truncated: diff.previewTruncated === true || rawPreviewBytes > MAX_PREVIEW,
      },
    }),
    ...(preview === undefined ? {} : { preview }),
    runtimeProviderEvidence: input.runtimeProviderEvidence ?? {},
    audit: [],
  })
}

/** A small in-memory/store seam used by the review flow and UI tests. */
export interface EvidenceStore {
  get(evidenceId: string): Evidence | undefined | Promise<Evidence | undefined>
  put(evidence: Evidence): void | Promise<void>
  list?(runId?: string): Evidence[] | Promise<Evidence[]>
}

export class InMemoryEvidenceStore implements EvidenceStore {
  private readonly values = new Map<string, Evidence>()

  get(evidenceId: string): Evidence | undefined {
    const value = this.values.get(evidenceId)
    return value === undefined ? undefined : structuredClone(value)
  }

  put(evidence: Evidence): void {
    this.values.set(evidence.evidenceId, structuredClone(evidence))
  }

  list(runId?: string): Evidence[] {
    return [...this.values.values()]
      .filter(value => runId === undefined || value.runId === runId)
      .map(value => structuredClone(value))
  }
}
