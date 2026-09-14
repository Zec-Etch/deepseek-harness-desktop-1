# Task Runs and Evidence

Task Board v3 records execution lifecycle and review evidence without becoming a second Session-history store. The official DSH Session remains the execution source of truth. Task Board persists compact references and bounded summaries needed to understand, review, recover, and clean up a run.

## Project, Task, and Task Run

A Project binds product-facing task metadata to a Runtime Provider `workspaceId`. It may also retain a Host-generated repository identity, a default isolation choice, and a permission-policy reference. Renderer code does not supply a filesystem root.

A Task retains the existing title, description, prompt, board status, schedule, and execution compatibility records. Version 3 adds an optional `projectId`, an explicit `isolationMode`, and compact `runs` references. The default remains `shared-workspace`; migrated tasks never become Worktree tasks automatically.

A `TaskRunReference` contains only:

- `runId`, optional `sessionId`, `workspaceId`, and optional `worktreeId`;
- base/final revisions;
- start/finish timestamps and result status;
- `evidenceId` and a bounded `fallbackReason`;
- normalized Runtime Provider identity, capability state, operation result, and a boolean Session-CWD verification attestation.

It never contains Session messages, prompts copied from the Session, tool-result payloads, credentials, raw patches, arbitrary provider objects, or an absolute Session/Worktree path.

## Lifecycle

The run states are:

```text
running
awaiting-review
accepted
kept
discarded
failed
cancelled
```

An isolated execution follows this sequence:

1. Mint `runId` and resolve the task's Project/workspace.
2. Probe `workspace.register`, `session.create`, and `session.observe`.
3. Create or recover the controlled Worktree and base revision.
4. Register that Worktree with the Runtime Provider.
5. Create the Session with the controlled CWD.
6. Verify the returned Session CWD exactly matches the Worktree.
7. Subscribe before sending the prompt.
8. Observe completed, failed, or cancelled semantics.
9. Collect Worktree status and Git Graph diff evidence.
10. Persist the compact run and Evidence, then enter review.

Failure and cancellation also produce Evidence. If isolation already created a Worktree, registration failure, Session-creation failure, CWD mismatch, Session failure, and cancellation retain that Worktree and write bounded failed/cancelled Evidence. Shared-workspace success, failure, and cancellation receive a compact Evidence record with `diffSource: unavailable`. Capability or Worktree-creation fallback is recorded on the run before the existing shared executor is used.

## Evidence contract

Evidence contains:

- `evidenceId`, `runId`, optional `sessionId`, Project/workspace/Worktree references;
- base/final revisions;
- changed files with status and additions/deletions;
- aggregate additions/deletions and clean/dirty state;
- result status and timestamps;
- controlled Session/run deep links;
- diff source and cache metadata;
- normalized Runtime Provider evidence;
- at most 100 bounded audit summaries.

Git Graph is the only diff parser. Task Board accepts its typed summary and caps persisted data to 500 files and a 64 KiB preview. Binary files keep only status/statistics. Large previews are truncated and record the byte count, generation time, base/final revisions, and truncation flag. The full diff is recomputed on demand from the Host Worktree.

## Review flow

Successful Worktree runs enter `awaiting-review`. The Evidence panel shows summary, changed files, statistics, bounded preview, Session navigation, Worktree/run navigation, and the available review actions.

| Action | Preconditions | Result |
| --- | --- | --- |
| Commit/Accept | Worktree exists, conflicts absent, explicit message | Commit is created; status `accepted`; branch and Worktree remain |
| Merge | Commit/Keep state, both checkouts clean, target current, conflict preflight succeeds | Target branch is merged; status remains `accepted` |
| Keep | Awaiting review or accepted | Status `kept`; branch and Worktree remain available |
| Discard | Allowed terminal/review state and second confirmation | Controlled Worktree and safely removable generated branch are removed; status `discarded` |

Every action writes a short audit entry. A blocked action preserves the prior state and Worktree and records only a bounded error summary. Secrets, raw provider errors, command output, and patch bodies are not stored in audit entries.

## Provider fallback and blocking

Missing optional capabilities or Worktree creation failure can return `shared-workspace-fallback` before isolation begins. The UI and run show the reason and capability evidence before using the old executor. No Worktree id or isolated status is fabricated.

After a Worktree exists, workspace registration failure, Session creation failure, or a returned Session CWD mismatch is blocked and retains failed Evidence for recovery. Executing elsewhere cannot be described as isolated. Candidate CWD or event-semantic drift also blocks the 2.6 Worktree capability while leaving Stable metadata and ordinary shared execution unchanged.

See [Runtime Provider capability fallback](provider-capability-fallback.md) for the negotiation rules.

## Persistence and migration

The Host document lives at:

```text
DSH_HOME/profiles/<profile>/state/task-board/tasks-v3.json
```

Version 2 migration is copy-first:

1. Parse v2 without modifying it.
2. Copy v2 to a timestamped backup.
3. Convert old tasks with no Project and `shared-workspace` isolation.
4. Write v3 to a private temporary file.
5. Parse and digest-check the temporary file.
6. Atomically rename it and read it back.
7. Write the migration marker.

If any migration write or verification fails, the v2 source and backup remain available and Task Board starts from the safe v2-derived view. Existing v1/v2 endpoints remain compatibility fallbacks for older Hosts.

## Restart reconciliation

On page or application restart, Task Board uses the persisted Task Run, the Git registry, and provider Session lookup. A recovered running run is observed by reference; it is never prompted again and no second Worktree or Session is created. Missing Sessions become explicit blocked/cancelled results, and their Worktrees remain available for manual review.

## Deep links and notifications

- `dsh-community://task/<task-id>` opens the task and latest run.
- `dsh-community://run/<run-id>` opens the owning task and Evidence review surface.
- `dsh-community://session/<session-id>` opens the official Session transcript.

Completion and failure notifications use the run route. Deep-link identifiers are length bounded and validated; paths, commands, URLs, and arbitrary fragments are rejected.

## Verification

```powershell
pnpm --filter @linxin666/dsh-client-ui-task-board typecheck
pnpm --filter @linxin666/dsh-client-ui-task-board test
node --test scripts/dsh-candidate-execution.test.mjs scripts/dsh-candidate-report.test.mjs
pnpm --filter @linxin666/dsh-desktop pack:smoke
```

The tests cover migration, bounded Evidence, success/failure/cancellation, exact Worktree CWD, capability fallback, restart reconciliation without duplicate prompt/create, two-step discard, deep-link routing, and Candidate comparison.
