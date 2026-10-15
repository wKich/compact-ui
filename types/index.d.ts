export type CompactThought = { at: number; text: string }
export type CompactRun = { leader: string; ids: string[]; tools: string[]; thoughts: CompactThought[]; failed: number }
export type CompactRuns = { runOf: Record<string, string>; runs: Record<string, CompactRun> }
export type CompactTurn = {
  durationMs: number
  model: string
  effort: string
  outputTokens: number
  costUsd: number | null
  mode: string
}
export type CompactMeta = { mode: string; model: string }

declare module 'claude-code' {
  interface PluginState {
    'compact-ui': {
      tree: CompactRuns
      turns: CompactTurn[]
      meta: CompactMeta
      expanded: Record<string, boolean>
      expandAll: boolean
    }
  }
}
