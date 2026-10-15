import { expect, test } from 'claude-code/testing'

import { fmtClock, fmtCost, fmtDuration, prettyModel, summarize, toolLine } from '../hooks/register'

const toolUse = (id: string) => ({
  component: 'ToolUse' as const,
  requestId: id,
  props: { tool_use_id: id, tool: 'Bash', input: { command: 'ls' }, isRunning: false, isErrored: false, isInterrupted: false },
})

test('summaries read like opencode', async () => {
  expect(summarize({ leader: 'a', ids: [], tools: ['Bash', 'Bash', 'Edit', 'Read', 'Foo'], thoughts: [{ at: 0, text: 'a' }, { at: 1, text: '' }, { at: 2, text: 'b' }, { at: 2, text: ' \n' }], failed: 0 }))
    .toBe('2 commands, 1 edit, 2 thoughts, 1 read, 1 tool')
  expect(prettyModel('claude-opus-5-5')).toBe('Opus 5.5')
  expect(prettyModel('claude-sonnet-4-20250514')).toBe('Sonnet 4')
  expect(fmtDuration(301_000)).toBe('5m 1s')
  expect(fmtCost(0.4234)).toBe('$0.42')
  const at = (h: number, m: number) => new Date(2026, 0, 1, h, m).getTime()
  expect(fmtClock(at(9, 21))).toBe('9:21 AM')
  expect(fmtClock(at(0, 5))).toBe('12:05 AM')
  expect(fmtClock(at(13, 0))).toBe('1:00 PM')
  expect(toolLine('Edit', { file_path: '/a/b/c/d.ts' })).toEqual(['✎', 'Edit b/c/d.ts'])
})

test('a call unfolds one level per press', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine row</Text>
  })
  for (const surface of ['terminal'] as const) {
    const ui = await $.ui.mount({ plugin: 'compact-ui', surface, ...toolUse('t1') })
    expect(await ui.find({ type: 'Text', text: /\+ 1 command/ })).toBeDefined()
    await ui.press({ key: 'run-t1' })
    expect(await ui.find({ type: 'Text', text: /\$ ls/ })).toBeDefined()
    await ui.press({ key: 'tool-t1' })
    expect(await ui.find({ type: 'Text', text: /engine row/ })).toBeDefined()
    await ui.press({ key: 'tool-t1' })
    expect(await ui.find({ type: 'Text', text: /engine row/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /\$ ls/ })).toBeDefined()
    await ui.unmount()
  }
})
