import { readFile } from 'node:fs/promises'

import YAML from 'yaml'

import { DESKTOP_DISTRIBUTION_IDENTITY } from './distribution-identity.mjs'

export function assertUpdateIdentity(value, expected = DESKTOP_DISTRIBUTION_IDENTITY.updateProvider) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('packaged update identity must be an object')
  }
  for (const field of ['provider', 'owner', 'repo']) {
    if (value[field] !== expected[field]) {
      throw new Error(`packaged update identity has an unexpected ${field}`)
    }
  }
  return Object.freeze({ provider: value.provider, owner: value.owner, repo: value.repo })
}

export async function assertPackagedUpdateIdentity(path) {
  const source = await readFile(path, 'utf8')
  return assertUpdateIdentity(YAML.parse(source))
}
