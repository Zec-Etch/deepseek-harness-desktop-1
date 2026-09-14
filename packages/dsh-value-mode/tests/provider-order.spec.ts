import { describe, expect, it } from 'vitest'
import { sortValueModeProviderGroups } from '../src/client/ModelPicker.tsx'

describe('Value Mode provider ordering', () => {
  it('pins bai first and keeps every other provider stable', () => {
    const groups = [
      { id: 'custom-a', name: 'A', models: [] },
      { id: 'project-relay', name: 'bai', models: [] },
      { id: 'custom-b', name: 'B', models: [] },
    ] as never
    expect(sortValueModeProviderGroups(groups).map(group => group.id)).toEqual(['project-relay', 'custom-a', 'custom-b'])
  })
})
