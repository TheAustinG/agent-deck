import type {
  BoxProps,
  ButtonProps,
  Color,
  ElementConstructor,
  RenderPropsOf,
  TextProps,
} from 'claude-code'

import type { AgentState, Card, Deck, FeedItem } from '../types'
import {
  SPARK_WIDTH,
  elapsedOf,
  formatElapsed,
  formatUsd,
  gauge,
  gaugeTone,
  isLive,
  quietReason,
  shortModel,
  sparkline,
  tally,
  totalCost,
} from './model'

export type DeckElements = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Button: ElementConstructor<ButtonProps>
}

export type DeckActions = {
  view: (agentId: string) => Promise<void>
  back: () => Promise<void>
}

type PaneProps = RenderPropsOf['Pane']

type Part = {
  card: Card
  index: number
  feed: readonly FeedItem[]
  quiet: string | undefined
  meter: { bar: string; pct: number } | undefined
  spark: string
  hasLabel: boolean
}

const LOOK: Record<AgentState, { glyph: string; color: Color }> = {
  pending: { glyph: '○', color: 'inactive' },
  running: { glyph: '●', color: 'suggestion' },
  waiting: { glyph: '◐', color: 'permission' },
  idle: { glyph: '◌', color: 'inactive' },
  completed: { glyph: '✓', color: 'success' },
  failed: { glyph: '✗', color: 'error' },
  killed: { glyph: '■', color: 'error' },
  gone: { glyph: '·', color: 'inactive' },
}

const tint = (color: Color | undefined): { color?: Color } => (color === undefined ? {} : { color })

const hotkeyOf = (index: number): { hotkey?: string } =>
  index < 9 ? { hotkey: String(index + 1) } : {}

const rowsOf = (part: Part): number =>
  2 +
  (part.meter !== undefined || part.spark !== '' ? 1 : 0) +
  (part.hasLabel ? 1 : 0) +
  part.feed.length +
  (part.quiet === undefined ? 0 : 1)

export function deckTree(els: DeckElements, deck: Deck, props: PaneProps, actions: DeckActions) {
  const { Box, Text, Button } = els

  if (deck.cards.length === 0) {
    return <Text dimColor>No subagents yet this session.</Text>
  }

  const viewing = props.view?.agentId
  const sparkWidth = Math.max(0, Math.min(SPARK_WIDTH, props.bodyColumns - 21))
  const parts: Part[] = deck.cards.map((card, index) => {
    const feed = deck.feed[card.id] ?? []

    return {
      card,
      index,
      feed,
      quiet: quietReason(card, feed, deck.now),
      meter: gauge(card.tokenCount, card.contextWindowSize),
      spark: sparkWidth > 0 && card.samples.length > 1 ? sparkline(card.samples, sparkWidth) : '',
      hasLabel: card.label !== '' && card.label !== card.title,
    }
  })
  const wantedRows = 3 + parts.reduce((sum, part) => sum + rowsOf(part) + 1, 0)
  const isTight = wantedRows > props.scroll.bodyRows
  const counts = tally(deck.cards)
  const cost = totalCost(deck.cards)

  const titleRow = (part: Part, isCompact: boolean) => {
    const { card } = part
    const look = LOOK[card.status]
    const tone = part.quiet === undefined ? look.color : 'warning'
    const isViewed = viewing === card.id
    const elapsed = formatElapsed(elapsedOf(card, deck.now))
    const tail =
      isCompact && card.costUsd !== undefined ? `${elapsed} · ${formatUsd(card.costUsd)}` : elapsed

    return (
      <Box justifyContent="space-between">
        <Button
          key={`view-${card.id}`}
          plain
          {...hotkeyOf(part.index)}
          onPress={() => actions.view(card.id)}
        >
          <Text color={tone}>{isViewed ? '▶' : look.glyph} </Text>
          <Text
            wrap="truncate-end"
            {...(isCompact ? {} : { weight: 'semibold' as const })}
            {...tint(part.quiet === undefined ? undefined : 'warning')}
          >
            {card.title}
          </Text>
        </Button>
        <Text dimColor> {tail}</Text>
      </Box>
    )
  }

  const feedLine = (item: FeedItem, isCardLive: boolean) => {
    const mark =
      item.state === 'ok'
        ? { glyph: '✓', color: 'success' as Color }
        : item.state === 'err'
          ? { glyph: '✗', color: 'error' as Color }
          : isCardLive
            ? { glyph: '…', color: 'suggestion' as Color }
            : { glyph: '·', color: 'inactive' as Color }
    const timer =
      item.state === 'run' && isCardLive ? ` (${formatElapsed(deck.now - item.firstSeenAt)})` : ''

    return (
      <Text wrap="truncate-end">
        <Text color={mark.color}>{mark.glyph}</Text> {item.tool}{' '}
        <Text dimColor>
          {item.summary}
          {timer}
        </Text>
      </Text>
    )
  }

  const fullCard = (part: Part) => {
    const { card } = part
    const meta = [
      card.type,
      shortModel(card.model),
      card.effort,
      card.costUsd === undefined ? undefined : formatUsd(card.costUsd),
    ]
      .filter((one): one is string => one !== undefined && one !== '')
      .join(' · ')
    const isCardLive = isLive(card)

    return (
      <Box flexDirection="column">
        {titleRow(part, false)}
        <Text dimColor wrap="truncate-end">
          {meta}
        </Text>
        {(part.meter !== undefined || part.spark !== '') && (
          <Text wrap="truncate-end">
            {part.meter !== undefined && <Text dimColor>ctx </Text>}
            {part.meter !== undefined && (
              <Text {...tint(gaugeTone(part.meter.pct))}>{part.meter.bar}</Text>
            )}
            {part.meter !== undefined && <Text dimColor> {part.meter.pct}% </Text>}
            {part.spark !== '' && <Text color={LOOK[card.status].color}> {part.spark}</Text>}
          </Text>
        )}
        {part.hasLabel && (
          <Text dimColor maxLines={2}>
            {card.label}
          </Text>
        )}
        {part.feed.map(item => feedLine(item, isCardLive))}
        {part.quiet !== undefined && (
          <Text color="warning" wrap="truncate-end">
            ! {part.quiet}
          </Text>
        )}
      </Box>
    )
  }

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Box justifyContent="space-between">
          <Text wrap="truncate-end">
            <Text color="suggestion">● {counts.live} running</Text>
            <Text color="success">{'  '}✓ {counts.done} done</Text>
            {counts.failed > 0 && <Text color="error">{'  '}✗ {counts.failed} failed</Text>}
          </Text>
          {cost !== undefined && <Text dimColor> {formatUsd(cost)} est.</Text>}
        </Box>
        {viewing !== undefined && (
          <Button key="back" plain hotkey="0" onPress={() => actions.back()}>
            ← back to main
          </Button>
        )}
      </Box>
      {parts.map(part =>
        isTight && !isLive(part.card) ? titleRow(part, true) : fullCard(part),
      )}
      <Text dimColor wrap="truncate-end">
        {props.isFocused
          ? '1-9 open an agent · esc back to prompt'
          : 'ctrl+x tab to focus, then 1-9 opens an agent'}
      </Text>
    </Box>
  )
}
