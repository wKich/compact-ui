import { expect, test } from 'claude-code/testing'

import { diffStat, parseNumstat, parseWc, worktreeDelta, fmtClock, fmtCost, fmtDuration, prettyModel, preview, summarize, toolLine } from '../hooks/register'

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
  expect(preview('short thought')).toBe('short thought')
  expect(diffStat({ structuredPatch: [{ lines: [' a', '-b', '+c', '+d'] }] })).toEqual({ added: 2, removed: 1 })
  expect(diffStat({ type: 'create', content: 'x\ny', structuredPatch: [] })).toEqual({ added: 2, removed: 0 })
  expect(diffStat({ stdout: '' })).toBeNull()
  expect(parseNumstat('3\t1\ta.ts\n-\t-\timg.png\n')).toEqual({ 'a.ts': [3, 1] })
  expect(parseWc('  12 new.ts\n   4 b c.md\n  16 total\n')).toEqual({ 'new.ts': 12, 'b c.md': 4 })
  // a.ts gains 2 added lines, b.ts has its 5 deleted lines restored, c.ts is new
  expect(worktreeDelta({ 'a.ts': [3, 1], 'b.ts': [0, 5] }, { 'a.ts': [5, 1], 'c.ts': [10, 0] })).toEqual({ added: 17, removed: 0 })
  expect(worktreeDelta({ 'a.ts': [3, 1] }, { 'a.ts': [1, 4] })).toEqual({ added: 0, removed: 5 })
  expect(preview('I see Claude Code renders a standalone call output within its own row, so', 40)).toBe('I see Claude Code renders a standalone…')
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
    expect(await ui.find({ type: 'Text', text: /▾/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /- 1 command/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /engine row/ })).toBeDefined()
    await ui.press({ key: 'tool-t1' })
    expect(await ui.find({ type: 'Text', text: /▾/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /\$ ls/ })).toBeDefined()
    await ui.unmount()
  }
})
