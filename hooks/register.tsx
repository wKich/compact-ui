import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CompactRun, CompactRuns, CompactTurn } from '../types'

const ACCENT = '#b48cff'
const ERROR = 'error'

const runsAtom = atom({ plugin: 'compact-ui', key: 'tree' } as const, { runOf: {}, runs: {} })
const turnsAtom = atom({ plugin: 'compact-ui', key: 'turns' } as const, [])
const expandedAtom = atom({ plugin: 'compact-ui', key: 'expanded' } as const, {})
const expandAllAtom = atom({ plugin: 'compact-ui', key: 'expandAll' } as const, false)
const metaAtom = atom({ plugin: 'compact-ui', key: 'meta' } as const, { mode: 'default', model: '' })

// Tool name -> [singular, plural], in the order the summary lists them.
const KINDS: ReadonlyArray<[string, string, readonly string[]]> = [
  ['command', 'commands', ['Bash', 'BashOutput', 'Monitor', 'KillShell', 'TaskStop']],
  ['edit', 'edits', ['Edit', 'MultiEdit', 'Write', 'NotebookEdit']],
  ['thought', 'thoughts', []],
  ['read', 'reads', ['Read']],
  ['search', 'searches', ['Grep', 'Glob', 'LSP', 'ToolSearch']],
  ['fetch', 'fetches', ['WebFetch', 'WebSearch']],
  ['agent', 'agents', ['Agent', 'Task']],
  ['todo', 'todos', ['TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet']],
]

const kindOf = (tool: string) => KINDS.findIndex(([, , names]) => names.includes(tool))

export const summarize = (run: CompactRun): string => {
  const counts = new Array(KINDS.length + 1).fill(0)
  for (const tool of run.tools) {
    const k = kindOf(tool)
    counts[k === -1 ? KINDS.length : k] += 1
  }
  counts[2] = run.thoughts.filter(t => t.text.trim()).length
  const parts = counts.flatMap((n, i) => {
    if (n === 0) return []
    const [one, many] = KINDS[i] ?? ['tool', 'tools']
    return [`${n} ${n === 1 ? one : many}`]
  })
  return parts.join(', ')
}

// Lines a finished Edit or Write added and removed, from its patch; null for
// any other result.
export const diffStat = (result: unknown): { added: number; removed: number } | null => {
  if (!result || typeof result !== 'object') return null
  const r = result as { structuredPatch?: unknown; gitDiff?: { additions?: unknown; deletions?: unknown } }
  if (Array.isArray(r.structuredPatch) && r.structuredPatch.length > 0) {
    let added = 0
    let removed = 0
    for (const hunk of r.structuredPatch as ReadonlyArray<{ lines?: unknown }>) {
      for (const line of Array.isArray(hunk.lines) ? (hunk.lines as unknown[]) : []) {
        if (typeof line !== 'string') continue
        if (line.startsWith('+')) added += 1
        else if (line.startsWith('-')) removed += 1
      }
    }
    return { added, removed }
  }
  const g = r.gitDiff
  if (g && typeof g.additions === 'number' && typeof g.deletions === 'number') return { added: g.additions, removed: g.deletions }
  // A file Write created has no patch: every line is new.
  const w = result as { type?: unknown; content?: unknown }
  if (w.type === 'create' && typeof w.content === 'string') return { added: w.content.split('\n').length, removed: 0 }
  return null
}

// Lines changed against HEAD, per file: [added, removed].
export type Worktree = Record<string, [number, number]>

// `git diff --numstat` output; binary files (`-`) are left out.
export const parseNumstat = (text: string): Worktree => {
  const files: Worktree = {}
  for (const line of text.split('\n')) {
    const [a, d, path] = line.split('\t')
    if (!path || a === '-' || d === '-') continue
    files[path] = [Number(a), Number(d)]
  }
  return files
}

// `wc -l` output, one count per file, its total line left out.
export const parseWc = (text: string): Record<string, number> => {
  const counts: Record<string, number> = {}
  for (const line of text.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(.+)$/)
    if (m && m[2] !== 'total') counts[m[2] as string] = Number(m[1])
  }
  return counts
}

// What changed between two snapshots: lines a command added (or restored)
// and removed (or reverted).
export const worktreeDelta = (before: Worktree, after: Worktree): { added: number; removed: number } => {
  let added = 0
  let removed = 0
  for (const path of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const [a0, d0] = before[path] ?? [0, 0]
    const [a1, d1] = after[path] ?? [0, 0]
    added += Math.max(0, a1 - a0) + Math.max(0, d0 - d1)
    removed += Math.max(0, d1 - d0) + Math.max(0, a0 - a1)
  }
  return { added, removed }
}

type TextElement = ReturnType<EngineInterface['ui']['resolve']>['Text']

// ` +N -M` in green and red, for a line's end; nothing when no lines changed.
const lineCounts = (Text: TextElement, added = 0, removed = 0) => {
  if (added === 0 && removed === 0) return []
  return [
    <Text dimColor>{' '}</Text>,
    <Text color="success">{`+${added}`}</Text>,
    <Text dimColor>{' '}</Text>,
    <Text color={ERROR}>{`-${removed}`}</Text>,
  ]
}

// The work tree's changes against HEAD, with untracked files counted as
// added whole; null outside a git repo or when git fails.
async function worktree($: EngineInterface): Promise<Worktree | null> {
  try {
    const diff = await $.process.run(['git', 'diff', '--numstat', 'HEAD'], { timeoutMs: 5000 })
    if (diff.exitCode !== 0) return null
    const files = parseNumstat(diff.stdout)
    const others = await $.process.run(['git', 'ls-files', '--others', '--exclude-standard', '-z'], { timeoutMs: 5000 })
    const paths = others.stdout.split('\0').filter(Boolean).slice(0, 200)
    if (paths.length > 0) {
      const wc = await $.process.run(['wc', '-l', '--', ...paths], { timeoutMs: 5000 })
      for (const [path, n] of Object.entries(parseWc(wc.stdout))) files[path] = [n, 0]
    }
    return files
  } catch {
    return null
  }
}

export const prettyModel = (id: string): string => {
  const bare = id.replace(/\[.*?\]$/, '').replace(/^(us\.|eu\.)?anthropic\./, '').replace(/^claude-/, '')
  const m = bare.match(/^([a-z]+)-(\d+)(?:-(\d+))?/)
  const [, family = '', major = '', minor] = m ?? []
  if (!family) return bare
  const name = family.charAt(0).toUpperCase() + family.slice(1)
  return minor && minor.length <= 2 ? `${name} ${major}.${minor}` : `${name} ${major}`
}

export const fmtCost = (usd: number): string => (usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`)

export const fmtDuration = (ms: number): string => {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

export const fmtClock = (epochMs: number): string => {
  const d = new Date(epochMs)
  const h = d.getHours()
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

// Permission mode rides on every classic hook input.
async function trackMode($: EngineInterface, mode: string | undefined) {
  if (mode) await update($, metaAtom, m => (m.mode === mode ? m : { ...m, mode }))
}

// Fold levels: a run folded to its summary (0), a run listed one line per
// call and thought (1), and one call drawn by the engine in full (2).
const runKey = (runId: string) => `run:${runId}`
const toolKey = (id: string) => `tool:${id}`
const thoughtKey = (runId: string, i: number) => `thought:${runId}:${i}`

async function opened($: EngineInterface) {
  const all = await read($, expandAllAtom)
  const x = await read($, expandedAtom)
  return (key: string) => all || x[key] === true
}

async function toggle($: EngineInterface, key: string) {
  await update($, expandedAtom, x => ({ ...x, [key]: !x[key] }))
}

// Folding a run folds everything opened inside it too.
async function foldRun($: EngineInterface, runId: string, run: CompactRun) {
  const inner = new Set([
    runKey(runId),
    ...run.ids.map(toolKey),
    ...run.thoughts.map((_, i) => thoughtKey(runId, i)),
  ])
  await update($, expandedAtom, x => Object.fromEntries(Object.entries(x).filter(([k]) => !inner.has(k))))
}

function lookup(s: CompactRuns, id: string, tool: string, isErrored: boolean) {
  const runId = s.runOf[id] ?? id
  const run: CompactRun = s.runs[runId] ?? { leader: id, ids: [id], tools: [tool], thoughts: [], failed: isErrored ? 1 : 0 }
  return { runId, run }
}

const short = (path: string) => path.split('/').slice(-3).join('/')
const firstLine = (text: string) => (text.split('\n').find(l => l.trim()) ?? '').trim()

// A few words of `text` for a folded line: whole words up to `max`
// characters, then an ellipsis when anything was left out.
export const preview = (text: string, max = 60): string => {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  const cut = flat.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,.;:]+$/, '')}…`
}

// One compact line per call: a glyph and what the call was about.
export const toolLine = (tool: string, input: unknown): [string, string] => {
  const i = (input ?? {}) as Record<string, unknown>
  const str = (k: string) => (typeof i[k] === 'string' ? (i[k] as string) : '')
  switch (tool) {
    case 'Bash':
      return ['$', firstLine(str('command'))]
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
      return ['✎', `${tool} ${short(str('file_path'))}`]
    case 'NotebookEdit':
      return ['✎', `${tool} ${short(str('notebook_path'))}`]
    case 'Read':
      return ['→', `Read ${short(str('file_path'))}`]
    case 'Grep':
    case 'Glob':
      return ['✱', `${tool} "${str('pattern')}"`]
    case 'WebFetch':
      return ['↗', str('url')]
    case 'WebSearch':
      return ['↗', `"${str('query')}"`]
    case 'Agent':
    case 'Task':
      return ['◆', str('description') || tool]
    default:
      return ['⚙', tool.replace(/^mcp__/, '').replace(/__/g, ' ')]
  }
}

export const register: Register = on => {
  // The current segment: tool calls and thoughts between two text blocks.
  let segment: { runId: string | null; tools: number; pending: string[] } = { runId: null, tools: 0, pending: [] }
  let turnTokens: Record<string, { tokens: number; model: string; effort: string; costAtStart?: number }> = {}

  const closeSegment = () => {
    segment = { runId: null, tools: 0, pending: [] }
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'fold', description: 'Toggle folding of tool calls into summary lines' })
    const model = await $.session.model()
    await update($, metaAtom, m => (m.model ? m : { ...m, model }))
    return next(e)
  })

  on('command.run', { command: 'fold' }, async $ => {
    let isOn = false
    await update($, expandAllAtom, v => (isOn = !v))
    return { text: isOn ? 'Tool calls expanded.' : 'Tool calls folded.' }
  })

  on('classic.UserPromptSubmit', async ($, e, next) => {
    await trackMode($, e.permission_mode)
    return next(e)
  })
  on('classic.PostToolUse', async ($, e, next) => {
    await trackMode($, e.permission_mode)
    return next(e)
  })

  // True once the reply has written text since the last prompt or run: a run
  // that starts then sits under text, which the engine leaves no gap above.
  let afterText = false

  on('prompt.submit', ($, e, next) => {
    closeSegment()
    afterText = false
    return next(e)
  })

  // Every assistant block passes here once, in order: build the runs.
  on('session.append', async ($, e, next) => {
    if (e.agentId !== undefined || e.door !== 'response') return next(e)
    type Block = { type: string; id?: string; name?: string; text?: string; thinking?: string }
    for (const block of e.message.content as ReadonlyArray<Block>) {
      if (block.type === 'thinking' || block.type === 'redacted_thinking') {
        const text = (block.thinking ?? '').slice(0, 4000).trim()
        // Redacted or empty thinking has nothing to show.
        if (!text.trim()) continue
        const runId = segment.runId
        if (!runId) segment.pending.push(text)
        else {
          const thought = { at: segment.tools, text }
          await update($, runsAtom, s => withRun(s, runId, r => ({ ...r, thoughts: [...r.thoughts, thought] })))
        }
      } else if (block.type === 'tool_use' && block.id && block.name) {
        const id = block.id
        const name = block.name
        if (!segment.runId) segment.runId = id
        const runId = segment.runId
        const pending = segment.pending.map(text => ({ at: 0, text }))
        segment.pending = []
        segment.tools += 1
        const isAfterText = afterText
        afterText = false
        await update($, runsAtom, s => {
          const run = s.runs[runId] ?? { leader: runId, ids: [], tools: [], thoughts: pending, failed: 0, afterText: isAfterText }
          return {
            runOf: { ...s.runOf, [id]: runId },
            runs: { ...s.runs, [runId]: { ...run, ids: [...run.ids, id], tools: [...run.tools, name] } },
          }
        })
      } else if (block.type === 'text' && block.text?.trim()) {
        closeSegment()
        afterText = true
      }
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    // A Bash command's edits show only in the work tree: compare git's view
    // of it before and after. Approximate, and only in a git repo.
    const isTracked = (await read($, runsAtom)).runOf[e.tool_use_id] !== undefined
    const before = isTracked && e.tool === 'Bash' ? await worktree($) : null
    const ran = await next(e)
    const after = before ? await worktree($) : null
    const shell = before && after ? worktreeDelta(before, after) : null
    const stat = shell && shell.added + shell.removed > 0 ? shell : ran.isError ? null : diffStat(ran.result)
    if (ran.isError || stat) {
      await update($, runsAtom, s => {
        const runId = s.runOf[e.tool_use_id]
        if (!runId) return s
        return withRun(s, runId, r => ({
          ...r,
          failed: r.failed + (ran.isError ? 1 : 0),
          ...(stat
            ? {
                added: (r.added ?? 0) + stat.added,
                removed: (r.removed ?? 0) + stat.removed,
                callStats: { ...r.callStats, [e.tool_use_id]: stat },
              }
            : {}),
        }))
      })
    }
    return ran
  })

  // Cost is the session's running total; a turn's is the difference.
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      const usd = (await $.session.usage()).cost?.usd
      turnTokens[e.turnId] = { tokens: 0, model: '', effort: '', costAtStart: usd }
    }
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const response = yield* next(e)
    if (e.agentId === undefined) {
      const t = (turnTokens[e.turnId] ??= { tokens: 0, model: e.model, effort: '' })
      t.tokens += response.usage?.output_tokens ?? 0
      t.model = response.usage?.model ?? e.model
      t.effort = e.effort === undefined ? '' : String(e.effort)
      await update($, metaAtom, m => (m.model === t.model ? m : { ...m, model: t.model }))
    }
    return response
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) {
      const t = turnTokens[e.turnId]
      const meta = await read($, metaAtom)
      const usd = (await $.session.usage()).cost?.usd
      const turn: CompactTurn = {
        durationMs: e.durationMs,
        endedAt: await $.clock.now(),
        model: t?.model || meta.model,
        effort: t?.effort ?? '',
        outputTokens: t?.tokens ?? 0,
        costUsd: usd !== undefined && t?.costAtStart !== undefined ? usd - t.costAtStart : null,
        mode: meta.mode,
      }
      delete turnTokens[e.turnId]
      await update($, turnsAtom, list => [...list.slice(-199), turn])
      closeSegment()
    }
    return result
  })

  // ── Drawing ────────────────────────────────────────────────────────────

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const id = e.props.tool_use_id
    const { runId, run } = lookup(await read($, runsAtom), id, e.props.tool, e.props.isErrored)
    const isOpen = await opened($)
    if (await read($, expandAllAtom)) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)

    const isLeader = run.leader === id
    const isRunOpen = isOpen(runKey(runId))
    const gap = isLeader && run.afterText ? 1 : 0

    if (!isRunOpen) {
      if (!isLeader) return <Box display="none" />
      return (
        <Box paddingLeft={2} marginTop={gap}>
          <Button plain key={`run-${runId}`} onPress={() => toggle($, runKey(runId))}>
            <Text dimColor>{e.props.isRunning ? '~ ' : '+ '}{summarize(run)}</Text>
            {run.failed > 0 ? <Text color={ERROR}>{` (${run.failed} failed)`}</Text> : ''}
            {...changeTexts(run.added, run.removed)}
          </Button>
        </Box>
      )
    }

    // Level 1: the thoughts that came before this call, then the call itself;
    // the run's last call also carries the thoughts after it.
    // Level 2: the same one-line row, marked open, over the engine's own row
    // for the call (its header and output). A click on the engine's row does
    // not reach a plugin, so this line is the one that folds it.
    const at = run.ids.indexOf(id)
    const isLast = at === run.ids.length - 1
    const thoughts = run.thoughts
      .map((t, i) => ({ ...t, i }))
      .filter(t => t.text.trim() && (t.at === at || (isLast && t.at > at)))
    const [glyph, label] = toolLine(e.props.tool, e.props.input)
    const color = e.props.isErrored ? ERROR : undefined
    const isCallOpen = isOpen(toolKey(id))
    const mark = e.props.isRunning ? '~ ' : isCallOpen ? '▾ ' : '› '
    // A standalone row's output is drawn inside the engine's own row, so an
    // opened call keeps that row, as the engine draws it, under ours.
    const engineRow = isCallOpen ? await next(e) : null
    const callStat = run.callStats?.[id] ?? (e.props.isRunning || e.props.isErrored ? null : diffStat(e.props.output))

    return (
      <Box flexDirection="column" paddingLeft={2} marginTop={gap}>
        {isLeader ? (
          <Button plain key={`run-${runId}`} onPress={() => foldRun($, runId, run)}>
            <Text dimColor>{'- '}{summarize(run)}</Text>
            {...changeTexts(run.added, run.removed)}
          </Button>
        ) : null}
        {thoughts
          .filter(t => t.at === at)
          .map(t => thoughtRow(t.i))}
        <Box paddingLeft={2}>
          <Button plain key={`tool-${id}`} onPress={() => toggle($, toolKey(id))}>
            <Text dimColor>{mark}</Text>
            <Text color={color} dimColor={!color} wrap="truncate-end">{`${glyph} ${label}`}</Text>
            {...changeTexts(callStat?.added, callStat?.removed)}
          </Button>
        </Box>
        {engineRow}
        {thoughts.filter(t => t.at > at).map(t => thoughtRow(t.i))}
      </Box>
    )

    function changeTexts(added?: number, removed?: number) {
      return lineCounts(Text, added, removed)
    }

    function thoughtRow(i: number) {
      const text = run.thoughts[i]?.text ?? ''
      const isThoughtOpen = text !== '' && isOpen(thoughtKey(runId, i))
      // Folded: a few words of it. Opened: a plain header over the text.
      return (
        <Box key={`th-${runId}-${i}`} flexDirection="column" paddingLeft={2}>
          <Button plain key={`thought-${runId}-${i}`} onPress={() => toggle($, thoughtKey(runId, i))}>
            <Text dimColor>{isThoughtOpen ? '▾ ∴ ' : '› ∴ '}</Text>
            <Text dimColor italic wrap="truncate-end">{isThoughtOpen ? 'Thought' : preview(text) || 'Thought'}</Text>
          </Button>
          {isThoughtOpen ? (
            <Box paddingLeft={4}>
              <Button plain key={`thought-text-${runId}-${i}`} onPress={() => toggle($, thoughtKey(runId, i))}>
                <Text dimColor italic>{text.trim()}</Text>
              </Button>
            </Box>
          ) : null}
        </Box>
      )
    }
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    if ((await opened($))(toolKey(e.props.tool_use_id))) return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box display="none" />
  })

  // The engine's own group of reads and searches: folded, it is the run's
  // summary (or nothing); opened, its calls become ToolUse rows drawn above.
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.isExpanded) return next(e)
    const ids = e.props.calls.map(c => c.tool_use_id)
    if (ids.some(id => id === undefined)) return next(e)
    const s = await read($, runsAtom)
    const first = e.props.calls[0]
    if (!first) return next(e)
    const { runId, run } = lookup(s, first.tool_use_id as string, first.tool, first.isErrored)
    if ((await opened($))(runKey(runId))) return next({ ...e, props: { ...e.props, isExpanded: true } })
    const { Box, Button, Text } = $.ui.resolve(e)
    const leads = ids.includes(run.leader) || s.runOf[first.tool_use_id as string] === undefined
    if (!leads) return <Box display="none" />
    const shown = s.runs[runId] ? run : { ...run, ids: ids as string[], tools: e.props.calls.map(c => c.tool) }
    return (
      <Box paddingLeft={2} marginTop={ids.includes(run.leader) && run.afterText ? 1 : 0}>
        <Button plain key={`run-${runId}`} onPress={() => toggle($, runKey(runId))}>
          <Text dimColor>{e.props.isActive ? '~ ' : '+ '}{summarize(shown)}</Text>
          {shown.failed > 0 ? <Text color={ERROR}>{` (${shown.failed} failed)`}</Text> : ''}
          {...lineCounts(Text, shown.added, shown.removed)}
        </Button>
      </Box>
    )
  })

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.isExpanded || e.props.origin.kind !== 'composer') return next(e)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box borderStyle="quote" borderColor={ACCENT} paddingLeft={1}>
        <Text>{e.props.text.trim()}</Text>
      </Box>
    )
  })

  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const turns = await read($, turnsAtom)
    const meta = await read($, metaAtom)
    const turn = turns.reduce<CompactTurn | null>(
      (best, t) =>
        best === null || Math.abs(t.durationMs - e.props.durationMs) < Math.abs(best.durationMs - e.props.durationMs)
          ? t
          : best,
      null,
    )
    if (turn === null || Math.abs(turn.durationMs - e.props.durationMs) >= 2000) return next(e)
    const secs = e.props.durationMs / 1000
    const model = prettyModel(turn.model || meta.model)
    const parts = [
      `✻ ${e.props.word} for ${fmtDuration(e.props.durationMs)}`,
      turn.endedAt ? `done ${fmtClock(turn.endedAt)}` : '',
      turn.effort ? `${model} ${turn.effort}` : model,
      turn.outputTokens > 0 && secs > 0 ? `${(turn.outputTokens / secs).toFixed(1)} tok/s` : '',
      turn.costUsd !== null ? fmtCost(turn.costUsd) : '',
    ].filter(Boolean)
    const { Box, Text } = $.ui.resolve(e)
    // One Text, so the line never splits next to the engine's own row:
    // `✻ Baked for 16s · done 9:21 AM · Opus 5.5 high · 19.5 tok/s · $0.42`.
    // The margin sets it off from the reply above.
    return (
      <Box marginTop={1}>
        <Text dimColor>{parts.join(' · ')}</Text>
      </Box>
    )
  })

}

const withRun = (s: CompactRuns, runId: string, fn: (r: CompactRun) => CompactRun): CompactRuns =>
  s.runs[runId] ? { ...s, runs: { ...s.runs, [runId]: fn(s.runs[runId]) } } : s
