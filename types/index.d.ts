export type AgentState =
  | 'pending'
  | 'running'
  | 'waiting'
  | 'idle'
  | 'completed'
  | 'failed'
  | 'killed'
  | 'gone'

export type FeedItem = {
  id: string
  tool: string
  summary: string
  state: 'run' | 'ok' | 'err'
  firstSeenAt: number
}

export type Card = {
  id: string
  title: string
  type: string
  label: string
  status: AgentState
  model?: string
  effort?: string
  startTime: number
  endTime?: number
  tokenCount: number
  contextWindowSize?: number
  samples: number[]
  costUsd?: number
  lastActiveAt: number
  hasRow: boolean
}

export type Deck = {
  batch: number
  ids: string[]
  cards: Card[]
  feed: Record<string, FeedItem[]>
  now: number
  allDoneAt?: number
  dismissedBatch?: number
}

declare module 'claude-code' {
  interface PluginState {
    'agent-deck': { deck: Shaped<Deck> }
  }
}
