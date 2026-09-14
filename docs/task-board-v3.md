# Task Board v3: projects, runs, Evidence, and Worktrees

Task Board v3 gives every task an optional project, an explicit isolation choice, a compact run reference, and a derived Evidence record. The persisted record is intentionally a product summary: it does not contain a full Session transcript, tool result payloads, secrets, raw patches, filesystem paths supplied by a renderer, or arbitrary Git arguments.

Detailed operational contracts are split into [Git Worktree execution and review](worktrees.md), [Task Runs and Evidence](task-runs-and-evidence.md), and [Runtime Provider capability fallback](provider-capability-fallback.md).

## User flow

1. Create a task and choose **Shared workspace** or **Git Worktree**. Existing tasks and tasks without a project keep the shared-workspace behavior.
2. A run receives a stable `runId` and records only lifecycle, workspace, Session, Worktree, revision, provider capability, fallback, and Evidence references.
3. The board shows changed-file counts, additions/deletions, bounded diff preview, final revision, and links to the Session or run review surface.
4. A completed isolated run enters **awaiting review**. The user explicitly chooses **Commit**, **Merge**, **Keep**, or **Discard**. Discard requires a second confirmation and never runs implicitly after cancellation.

The stable Desktop Runtime Provider currently exposes lifecycle and profile capabilities. Its optional workspace and Session methods remain unsupported until a typed provider supplies them, so the UI disables an unavailable Worktree choice and an explicit shared-workspace fallback is recorded when a Worktree task is attempted.

## Persisted model

The Host owns `state/task-board/tasks-v3.json` under the active DSH home/profile. The document contains `projects`, compact `tasks`, and derived `evidences` with a monotonic document revision. Task Board v2 is never overwritten during migration: the Host copies it to a timestamped backup, writes v3 through a private temporary file, reads the result back, verifies a deterministic digest, and writes a migration marker. If migration cannot complete, v2 remains authoritative and the in-memory v3 view is marked as failed migration rather than silently deleting data.

The v3 schema is copy-first. A v2 task becomes a shared-workspace task with no inferred project. Legacy executions become compact runs with bounded status and timestamps; no transcript or raw execution payload is copied. A failed or interrupted migration can be retried on the next Host start.

## Runtime Provider boundary

Worktree execution calls only typed methods: capability probe, `workspace.register`, `session.create`, `session.observe`, and optional Session lookup during reconciliation. The provider receives a controlled workspace id, Worktree id, and canonical Worktree CWD. The coordinator verifies that the returned Session CWD equals the Worktree path before sending the prompt. Capability status and upstream identity are copied into the run and Evidence record for diagnostics; they are not treated as authorization.

Missing capabilities, Worktree creation errors, registration errors, Session creation errors, and CWD mismatches are explicit outcomes. Missing capabilities and pre-creation errors can fall back to the shared executor. Once a Worktree exists, later failures are blocked with failed Evidence and the Worktree is retained; pretending that a shared Session is isolated would violate the boundary. Fallback reasons are bounded and visible in the task detail.

## Worktree safety

Git Graph owns all Git operations in the Host half. The renderer sends only opaque ids and bounded review values to loopback routes. A Worktree is created below the Host-controlled `DSH_HOME/worktrees/<repository-hash>/<run-id>` directory with a strict `dsh/task/<safe-slug>` branch. Workspace registration is canonicalized with `realpath`; a repository outside a registered workspace, a bare repository, an unsafe id, an active operation, conflicts, an invalid branch, or a path outside the controlled root is rejected.

Commit uses an explicit message and `git add --all` followed by `git commit`. Merge requires a clean Worktree, no conflict or operation marker, and the registered main workspace already checked out to the requested target branch; it never switches the user's main checkout. Removal refuses dirty state unless the caller supplies `force` and the literal `DISCARD` confirmation. Cancellation only cancels the Session; Worktree and branch cleanup stay under review.

## Evidence and review

Evidence is derived from Git Graph's parsed file statistics and bounded preview. The default limits are 500 files and 64 KiB of preview text. It stores base/final revisions, additions/deletions, file status, clean/dirty state, diff source, cache metadata, deep links, provider capability evidence, and a bounded audit list. Shared-workspace runs also receive an Evidence summary with `diffSource: unavailable`, so every settled run has a reviewable product record without retaining a transcript.

Review actions update Evidence with a short audit entry. A successful Commit or Merge becomes `accepted`; Keep becomes `kept` and leaves the Worktree and branch in place; Discard becomes `discarded` only after the second confirmation and removes the Worktree and branch through the Host service. Failed prechecks append a bounded `blocked` audit entry and leave the Worktree available for another review attempt.

## Transport and deep links

The v3 ledger uses `GET|PUT|DELETE /api/dsh-task-board/v3`. Worktree operations use ID-only `POST /git-worktree/{list,create,status,diff,remove,commit,merge}` routes. Both surfaces are loopback-only, same-origin checked, size bounded, and reject paths and arbitrary argv. A run notification can open `dsh-community://run/<safe-id>`; Session navigation uses `dsh-community://session/<safe-id>`.

## Performance and recovery

The normal task ledger write remains a serialized atomic file write. Evidence is a compact summary and is written through the same queue, so concurrent review clicks cannot overwrite each other. Diff preview generation is bounded and delegated to Git Graph; the Task Board never parses a patch. Startup reconciliation reuses a persisted Worktree and Session pair without creating another Worktree or prompting a recovered Session a second time. An unavailable provider Session produces a cancelled/blocked reconciliation result and leaves the Worktree for review.

## Verification

Run the focused checks from the repository root:

```powershell
pnpm --filter @linxin666/dsh-client-ui-task-board typecheck
pnpm --filter @linxin666/dsh-client-ui-task-board test
pnpm --filter @linxin666/dsh-client-ui-git-graph typecheck
pnpm --filter @linxin666/dsh-client-ui-git-graph test
node --test scripts/dsh-candidate-execution.test.mjs scripts/dsh-candidate-report.test.mjs
```

The Candidate fixture uses a real temporary Git repository and treats Session CWD equality, lifecycle event semantics, cancellation, and restart reconciliation as compatibility gates. It never writes to the Known Good checkout.
