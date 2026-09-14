import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import YAML from 'yaml'

import { DESKTOP_DISTRIBUTION_IDENTITY, desktopDeepLink } from '../src/distribution-identity.mjs'

const appDirectory = join(dirname(fileURLToPath(import.meta.url)), '..')

test('community Desktop owns stable namespaces outside the official distribution', async () => {
  const official = JSON.parse(await readFile(
    join(appDirectory, 'runtime-support', 'official-desktop-boundary.json'),
    'utf8',
  ))
  const identity = DESKTOP_DISTRIBUTION_IDENTITY

  assert.equal(identity.owner, 'ningbai牛逼')
  assert.equal(identity.ownerSlug, 'ningbainb')
  assert.match(identity.appId, /^com\.ningbainb\./u)
  assert.notEqual(identity.appId, 'ai.deepseek.harness.desktop')
  assert.match(identity.installerGuid, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u)
  assert.notEqual(identity.installerGuid, identity.legacyInstallerGuid)
  assert.notEqual(identity.packageName, official.desktop.packageName)
  assert.notEqual(identity.productName, official.desktop.productName)
  assert.notEqual(identity.defaultHomeDirectoryName, official.desktop.profileHome)
  assert.notEqual(identity.protocol, official.desktop.internalProtocol)
  assert.notEqual(identity.protocol, identity.legacyProtocol)
  assert.equal(identity.updateProvider.owner, 'ningbainb')
  assert.notEqual(identity.updateProvider.owner, 'deepseek-ai')
  assert.equal(desktopDeepLink('/updates'), 'dsh-community://updates')
})

test('runtime identity and electron-builder identity cannot drift apart', async () => {
  const [builderSource, packageSource] = await Promise.all([
    readFile(join(appDirectory, 'electron-builder.yml'), 'utf8'),
    readFile(join(appDirectory, 'package.json'), 'utf8'),
  ])
  const builder = YAML.parse(builderSource)
  const manifest = JSON.parse(packageSource)
  const identity = DESKTOP_DISTRIBUTION_IDENTITY

  assert.equal(builder.appId, identity.appId)
  assert.equal(builder.productName, identity.productName)
  assert.equal(builder.nsis.guid, identity.installerGuid)
  assert.deepEqual(builder.protocols.flatMap((entry) => entry.schemes ?? []), [identity.protocol])
  assert.deepEqual(builder.publish, identity.updateProvider)
  assert.equal(manifest.name, identity.packageName)
})
