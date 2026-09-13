import assert from 'node:assert/strict'
import { test } from 'node:test'

import { mergeDesktopPipeCookies } from '../src/runtime-cookie.mjs'

test('desktop pipe keeps its official session cookie and forwards a paired-device cookie', () => {
  assert.equal(mergeDesktopPipeCookies('dsh_session=official', undefined), 'dsh_session=official')
  assert.equal(mergeDesktopPipeCookies('dsh_session=official', ''), 'dsh_session=official')
  assert.equal(
    mergeDesktopPipeCookies('dsh_session=official', 'dsh_pair=device'),
    'dsh_session=official; dsh_pair=device',
  )
})
