import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ToolUseSummary } from 'claude-code'

import type { FeedItem } from '../types'
import {
  CLOSE_AFTER_MS,
  EMPTY_DECK,
  PANE,
  addSpawn,
  cardFromSpawn,
  dismiss,
  feedFrom,
  isLive,
  isLiveStatus,
  mergeDeck,
  shouldOpen,
  toJson,
} from './model'
import { deckTree } from './view'

const deck = atom({ plugin: 'agent-deck', key: 'deck' } as const, EMPTY_DECK, {
  shape: 'deck-1',
})

const PANE_ARGS = { id: PANE, title: 'Agents', columns: 44 } as const

let isActive = false
let isTicking = false
let ticks = 0
let lastError: string | undefined

async function toolUsesOf(
  $: EngineInterface,
  agentId: string,
): Promise<ToolUseSummary[] | undefined> {
  try {
    const rows = await $.session.messages({ agentId, last: 4 })

    return Array.isArray(rows) ? rows.flatMap(row => row.toolUses) : undefined
  } catch {
    return undefined
  }
}

async function closeWhenIdle($: EngineInterface, now: number): Promise<void> {
  const latest = await read($, deck)
  if (latest.cards.some(isLive)) return

  const pane = (await $.ui.panes()).find(one => one.id === PANE)
  if (pane?.isFocused) {
    await update($, deck, current => ({ ...current, allDoneAt: now }))

    return
  }

  isActive = false
  await update($, deck, current => toJson({ ...current, allDoneAt: undefined }))
  if (pane !== undefined) await $.ui.close({ id: PANE })
}

async function refresh($: EngineInterface): Promise<void> {
  const current = await read($, deck)
  if (current.cards.length === 0) {
    isActive = false

    return
  }

  const listed = await $.agent.list()
  const infos = listed.filter(info => info.kind === 'local_agent' && current.ids.includes(info.id))
  const now = await $.clock.now()
  ticks += 1

  const byId = new Map(infos.map(info => [info.id, info] as const))
  const feeds: Record<string, FeedItem[]> = {}
  for (const card of current.cards) {
    const status = byId.get(card.id)?.status ?? card.status
    const hasEnded = isLive(card) && !isLiveStatus(status)
    if (hasEnded || (isLiveStatus(status) && ticks % 2 === 0)) {
      const uses = await toolUsesOf($, card.id)
      if (uses !== undefined) feeds[card.id] = feedFrom(uses, current.feed[card.id] ?? [], now)
    }
  }

  const merged = toJson(mergeDeck(current, infos, feeds, now))
  const written =
    JSON.stringify(merged) === JSON.stringify(current)
      ? current
      : await update($, deck, latest => toJson(mergeDeck(latest, infos, feeds, now)))

  if (written.allDoneAt !== undefined && now - written.allDoneAt >= CLOSE_AFTER_MS) {
    await closeWhenIdle($, now)
  }
}

async function tick($: EngineInterface): Promise<void> {
  if (!isActive || isTicking) return

  isTicking = true
  try {
    await refresh($)
    lastError = undefined
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message !== lastError) {
      lastError = message
      $.ui.log(`agent-deck: ${message}`)
    }
  } finally {
    isTicking = false
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'agent-deck',
      description: 'Show the subagent panel with the latest run',
      immediate: true,
    })
    const saved = await read($, deck)
    isActive = saved.cards.some(isLive) || saved.allDoneAt !== undefined
    $.clock.every(1000, () => tick($))

    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (started.deny !== undefined || started.agentId === undefined) return started
    if (e.workflow !== undefined || e.isTeammate === true) return started

    const now = await $.clock.now()
    const card = cardFromSpawn(started.agentId, e.description, e.subagentType, now)
    const written = await update($, deck, current => toJson(addSpawn(current, card)))
    isActive = true
    if (shouldOpen(written)) await $.ui.open(PANE_ARGS).catch(() => undefined)

    return started
  }).catch(($, e, next) => next(e))

  on('ui.close', { id: PANE }, async ($, e, next) => {
    if (e.origin.kind === 'person') await update($, deck, dismiss)

    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'agent-deck' }, async $ => {
    const saved = await update($, deck, current =>
      toJson({ ...current, dismissedBatch: undefined }),
    )
    isActive = isActive || saved.cards.some(isLive)
    const opened = await $.ui.open(PANE_ARGS)

    return opened.isPlaced
      ? {}
      : { text: `agent-deck: ${opened.reason}`, isTextDisplayOnly: true as const }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const shown = await read($, deck)

    return deckTree($.ui.resolve(e), shown, e.props, {
      view: async agentId => {
        const result = await $.ui.view({ agentId })
        if (result.deny !== undefined) {
          $.ui.toast(`agent-deck: can't open that agent (${result.deny})`)
        }
      },
      back: async () => {
        await $.ui.view({})
      },
    })
  })
}
