import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import test from 'node:test'

const require = createRequire(import.meta.url)

test('Desktop sidebar defaults bottom-panel expansion to no implicit terminal', async () => {
  const packageRoot = dirname(require.resolve('dsh-better-sidebar/package.json'))
  const client = await readFile(join(packageRoot, 'lib', 'client.js'), 'utf8')
  assert.match(client, /bottomPanelAutoTerminal:\s*false/u)
  assert.match(client, /typeof record\.bottomPanelAutoTerminal === "boolean"\s*\? record\.bottomPanelAutoTerminal\s*:\s*SIDEBAR_PREFS_DEFAULTS\.bottomPanelAutoTerminal/u)
  assert.match(client, /seed\.type === "terminal"[\s\S]{0,500}desktop\.toolAction\("terminal-open"\)/u)
})
