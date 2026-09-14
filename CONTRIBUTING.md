# Contributing

Contributions to the desktop shell, plugins, skins, documentation, and tests are welcome.

## Development setup

Use Windows 10 or 11, Node.js 24, and pnpm 11.22.0:

```powershell
corepack enable
pnpm install --frozen-lockfile
pnpm desktop:test
pnpm desktop:dev
```

Build a local Windows installer with:

```powershell
$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
pnpm desktop:pack
```

## Change expectations

- Preserve the original DSH Web surface and official package composition.
- Add tests for lifecycle, profile, extension, security, or recovery behavior.
- Keep the Electron renderer sandboxed, context-isolated, and free of Node integration.
- Do not accept raw shell fragments, arbitrary URLs, or unvalidated filesystem paths over IPC.
- Do not commit credentials, local profiles, logs, or generated release directories.
- Keep source, documentation, commit messages, and user-visible strings free of emoji.

Before submitting a change, run `pnpm desktop:test`, `pnpm --filter @linxin666/dsh-desktop pack:verify` after packaging, and `git diff --check`.
