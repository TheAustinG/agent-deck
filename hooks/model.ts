import type { AgentInfo, ToolUseSummary } from 'claude-code'

import type { AgentState, Card, Deck, FeedItem } from '../types'

export const PANE = 'agent-deck'
export const QUIET_MS = 60_000
export const SLOW_TOOL_MS = 5 * 60_000
export const CLOSE_AFTER_MS = 60_000
export const UNLISTED_GRACE_MS = 10_000
export const FEED_SIZE = 3
export const SPARK_WIDTH = 15
export const GAUGE_CELLS = 10
const DETAIL_LIMIT = 120

export const EMPTY_DECK: Deck = { batch: 0, ids: [], cards: [], feed: {}, now: 0 }

const LIVE: ReadonlySet<AgentState> = new Set<AgentState>(['pending', 'running', 'waiting'])
const ENDED: ReadonlySet<AgentState> = new Set<AgentState>(['completed', 'failed', 'killed', 'gone'])
const BARS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'] as const

export const isLiveStatus = (status: AgentState): boolean => LIVE.has(status)
export const isEndedStatus = (status: AgentState): boolean => ENDED.has(status)
export const isLive = (card: Card): boolean => isLiveStatus(card.status)

export function toJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function firstLine(text: string): string {
  const line = text.split('\n').find(one => one.trim() !== '') ?? ''
  return line.trim().replace(/\s+/g, ' ')
}

function clip(text: string): string {
  return text.length > DETAIL_LIMIT ? `${text.slice(0, DETAIL_LIMIT - 1)}…` : text
}

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

function host(url: string): string {
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
}

export function summarizeTool(
  tool: string,
  input: Readonly<Record<string, unknown>>,
): { name: string; detail: string } {
  const name = tool.startsWith('mcp__') ? tool.split('__').at(-1) || tool : tool
  const text = (key: string): string | undefined => {
    const value = input[key]
    return typeof value === 'string' && value.trim() !== '' ? value : undefined
  }

  const file = text('file_path') ?? text('notebook_path')
  if (file !== undefined) return { name, detail: clip(basename(file)) }
  const command = text('command')
  if (command !== undefined) return { name, detail: clip(firstLine(command)) }
  const pattern = text('pattern')
  if (pattern !== undefined) return { name, detail: clip(pattern) }
  const url = text('url')
  if (url !== undefined) return { name, detail: clip(host(url)) }
  for (const key of ['query', 'description']) {
    const value = text(key)
    if (value !== undefined) return { name, detail: clip(firstLine(value)) }
  }
  const first = Object.values(input).find(
    (value): value is string => typeof value === 'string' && value.trim() !== '',
  )

  return { name, detail: first === undefined ? '' : clip(firstLine(first)) }
}

export function feedFrom(
  uses: readonly ToolUseSummary[],
  previous: readonly FeedItem[],
  now: number,
): FeedItem[] {
  const seen = new Map(previous.map(item => [item.id, item.firstSeenAt] as const))

  return uses.slice(-FEED_SIZE).map(use => {
    const { name, detail } = summarizeTool(use.tool, use.input)
    const state: FeedItem['state'] = use.isError
      ? 'err'
      : use.text === undefined
        ? 'run'
        : 'ok'

    return {
      id: use.tool_use_id,
      tool: name,
      summary: detail,
      state,
      firstSeenAt: seen.get(use.tool_use_id) ?? now,
    }
  })
}

export function cardFromSpawn(id: string, description: string, type: string, now: number): Card {
  return {
    id,
    title: firstLine(description) || type,
    type,
    label: '',
    status: 'pending',
    startTime: now,
    tokenCount: 0,
    samples: [],
    lastActiveAt: now,
    hasRow: false,
  }
}

export function mergeCard(
  card: Card,
  info: AgentInfo | undefined,
  isFeedFresh: boolean,
  now: number,
): Card {
  if (info === undefined) {
    if (isEndedStatus(card.status)) return card
    if (card.status === 'pending' && now - card.startTime < UNLISTED_GRACE_MS) return card

    return { ...card, status: 'gone', endTime: card.endTime ?? now }
  }

  const hasMoved = info.tokenCount !== card.tokenCount
  const merged: Card = {
    id: card.id,
    title: firstLine(info.description) || info.name || info.type || card.title,
    type: info.type,
    label: firstLine(info.label),
    status: info.status,
    model: info.model,
    effort: info.effort === undefined ? undefined : String(info.effort),
    startTime: info.startTime,
    tokenCount: info.tokenCount,
    contextWindowSize: info.contextWindowSize,
    samples: info.tokenSamples.slice(-16),
    costUsd: info.cost?.usd,
    lastActiveAt: Math.max(
      card.lastActiveAt,
      info.lastRequest?.at ?? 0,
      hasMoved || isFeedFresh ? now : 0,
    ),
    hasRow: info.hasRow,
  }
  if (isEndedStatus(info.status)) merged.endTime = card.endTime ?? now

  return merged
}

const sameFeed = (a: readonly FeedItem[], b: readonly FeedItem[]): boolean =>
  JSON.stringify(a) === JSON.stringify(b)

export function mergeDeck(
  deck: Deck,
  infos: readonly AgentInfo[],
  feeds: Readonly<Record<string, FeedItem[]>>,
  now: number,
): Deck {
  const byId = new Map(infos.map(info => [info.id, info] as const))
  const feed: Record<string, FeedItem[]> = {}
  const cards = deck.cards.map(card => {
    const before = deck.feed[card.id] ?? []
    const after = feeds[card.id] ?? before
    feed[card.id] = after

    return mergeCard(card, byId.get(card.id), !sameFeed(before, after), now)
  })
  const isAnyLive = cards.some(isLive)

  return {
    ...deck,
    cards,
    feed,
    now: isAnyLive ? now : deck.now,
    allDoneAt: isAnyLive || cards.length === 0 ? undefined : (deck.allDoneAt ?? now),
  }
}

export function addSpawn(deck: Deck, card: Card): Deck {
  if (!deck.cards.some(isLive)) {
    return {
      batch: deck.batch + 1,
      ids: [card.id],
      cards: [card],
      feed: {},
      now: card.startTime,
      dismissedBatch: deck.dismissedBatch,
    }
  }
  if (deck.ids.includes(card.id)) {
    return {
      ...deck,
      cards: deck.cards.map(
        (one): Card =>
          one.id === card.id
            ? { ...one, status: 'pending', endTime: undefined, lastActiveAt: card.startTime }
            : one,
      ),
      now: card.startTime,
      allDoneAt: undefined,
    }
  }

  return {
    ...deck,
    ids: [...deck.ids, card.id],
    cards: [...deck.cards, card],
    now: card.startTime,
    allDoneAt: undefined,
  }
}

export const dismiss = (deck: Deck): Deck => ({ ...deck, dismissedBatch: deck.batch })

export const shouldOpen = (deck: Deck): boolean => deck.dismissedBatch !== deck.batch

export function quietReason(card: Card, feed: readonly FeedItem[], now: number): string | undefined {
  if (card.status !== 'running') return undefined

  const running = feed.filter(item => item.state === 'run')
  if (running.length > 0) {
    const oldest = running.reduce((a, b) => (b.firstSeenAt < a.firstSeenAt ? b : a))
    const ran = now - oldest.firstSeenAt

    return ran >= SLOW_TOOL_MS ? `${oldest.tool} running ${formatElapsed(ran)}` : undefined
  }

  const quiet = now - card.lastActiveAt

  return quiet >= QUIET_MS ? `quiet ${formatElapsed(quiet)}: no tokens or tools` : undefined
}

export function sparkline(samples: readonly number[], width: number = SPARK_WIDTH): string {
  if (width <= 0) return ''

  const deltas = samples.slice(1).map((value, i) => Math.max(0, value - (samples[i] ?? value)))
  const tail = deltas.slice(-width)
  const peak = Math.max(0, ...tail)
  const bars = tail.map(delta =>
    peak === 0 || delta === 0
      ? BARS[0]
      : (BARS[Math.max(1, Math.round((delta / peak) * 7))] ?? BARS[7]),
  )

  return bars.join('').padStart(width, ' ')
}

export function gauge(
  tokens: number,
  windowSize: number | undefined,
  cells: number = GAUGE_CELLS,
): { bar: string; pct: number } | undefined {
  if (windowSize === undefined || windowSize <= 0) return undefined

  const ratio = Math.min(1, Math.max(0, tokens / windowSize))
  const filled = Math.round(ratio * cells)

  return { bar: '█'.repeat(filled) + '░'.repeat(cells - filled), pct: Math.round(ratio * 100) }
}

export function gaugeTone(pct: number): 'error' | 'warning' | undefined {
  if (pct >= 90) return 'error'

  return pct >= 70 ? 'warning' : undefined
}

export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m${String(seconds % 60).padStart(2, '0')}s`

  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}m`
}

export function formatUsd(usd: number): string {
  if (usd > 0 && usd < 0.01) return '<$0.01'

  return `$${usd.toFixed(2)}`
}

export const shortModel = (model: string | undefined): string | undefined =>
  model?.replace(/^claude-/, '')

export const elapsedOf = (card: Card, now: number): number =>
  (card.endTime ?? Math.max(now, card.startTime)) - card.startTime

export function tally(cards: readonly Card[]): { live: number; done: number; failed: number } {
  let live = 0
  let done = 0
  let failed = 0
  for (const card of cards) {
    if (isLive(card)) live += 1
    else if (card.status === 'failed' || card.status === 'killed') failed += 1
    else done += 1
  }

  return { live, done, failed }
}

export function totalCost(cards: readonly Card[]): number | undefined {
  const known = cards.flatMap(card => (card.costUsd === undefined ? [] : [card.costUsd]))

  return known.length === 0 ? undefined : known.reduce((sum, usd) => sum + usd, 0)
}
