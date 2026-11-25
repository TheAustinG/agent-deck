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
  GAUGE_CELLS,
  SPARK_WIDTH,
  batchElapsed,
  elapsedOf,
  formatElapsed,
  formatUsd,
  gauge,
  gaugeTone,
  heartbeat,
  isLive,
  progressBar,
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
  meter: { fill: string; rest: string; pct: number } | undefined
  spark: string
  labelRows: number
}

const LOOK: Record<AgentState, { glyph: string; color: Color }> = {
  pending: { glyph: '○', color: 'inactive' },
  running: { glyph: '●', color: 'suggestion' },
  waiting: { glyph: '‖', color: 'permission' },
  idle: { glyph: '◌', color: 'inactive' },
  completed: { glyph: '✓', color: 'success' },
  failed: { glyph: '✗', color: 'error' },
  killed: { glyph: '■', color: 'error' },
  gone: { glyph: '·', color: 'inactive' },
}

const FEED_LOOK: Record<FeedItem['state'], { glyph: string; color: Color; tool: TextProps }> = {
  run: { glyph: '…', color: 'suggestion', tool: { weight: 'semibold' } },
  err: { glyph: '✗', color: 'error', tool: {} },
  ok: { glyph: '✓', color: 'success', tool: { dimColor: true } },
}

const FRAME_COLUMNS = 4
const FRAME_ROWS = 2
const HEADER_ROWS = 3
const FOOTER_ROWS = 2
const INDENT = '1: '.length
const ACTIVITY_FIXED = 'ctx '.length + GAUGE_CELLS + ' 100%'.length + '  '.length

const tint = (color: Color | undefined): { color?: Color } => (color === undefined ? {} : { color })

const hotkeyOf = (index: number): { hotkey?: string } =>
  index < 9 ? { hotkey: String(index + 1) } : {}

const liveRows = (part: Part): number =>
  FRAME_ROWS +
  2 +
  (part.meter !== undefined || part.spark !== '' ? 1 : 0) +
  part.labelRows +
  part.feed.length +
  (part.quiet === undefined ? 0 : 1)

export function deckTree(els: DeckElements, deck: Deck, props: PaneProps, actions: DeckActions) {
  const { Box, Text, Button } = els

  if (deck.cards.length === 0) {
    return <Text dimColor>No subagents yet this session.</Text>
  }

  const viewing = props.view?.agentId
  const detailColumns = props.bodyColumns - FRAME_COLUMNS - INDENT
  const sparkWidth = Math.max(0, Math.min(SPARK_WIDTH, detailColumns - ACTIVITY_FIXED))
  const parts: Part[] = deck.cards.map((card, index) => {
    const feed = deck.feed[card.id] ?? []
    const hasLabel = card.label !== '' && card.label !== card.title

    return {
      card,
      index,
      feed,
      quiet: quietReason(card, feed, deck.now),
      meter: gauge(card.tokenCount, card.contextWindowSize),
      spark: sparkWidth > 0 && card.samples.length > 1 ? sparkline(card.samples, sparkWidth) : '',
      labelRows: hasLabel ? (card.label.length > detailColumns ? 2 : 1) : 0,
    }
  })
  const framedRows =
    HEADER_ROWS +
    (viewing === undefined ? 0 : 1) +
    parts.reduce((sum, part) => sum + (isLive(part.card) ? liveRows(part) : FRAME_ROWS + 1), 0) +
    FOOTER_ROWS
  const isTight = framedRows > props.scroll.bodyRows
  const counts = tally(deck.cards)
  const cost = totalCost(deck.cards)
  const finished = ` ${counts.done + counts.failed}/${deck.cards.length}`
  const bar = progressBar(deck.cards, props.bodyColumns - finished.length)
  const groups = [
    { count: counts.live, glyph: '●', word: 'running', color: 'suggestion' },
    { count: counts.done, glyph: '✓', word: 'done', color: 'success' },
    { count: counts.failed, glyph: '✗', word: 'failed', color: 'error' },
  ].filter(group => group.count > 0)
  const hints: readonly (readonly [string, string])[] = props.isFocused
    ? [
        ['1-9', ' open an agent · '],
        ['esc', ' back to prompt'],
      ]
    : [
        ['ctrl+x tab', ' to focus, then '],
        ['1-9', ' opens an agent'],
      ]

  const titleRow = (part: Part) => {
    const { card, quiet } = part
    const look = LOOK[card.status]
    const isCardLive = isLive(card)
    const glyph =
      viewing === card.id
        ? '▶'
        : card.status === 'running' && quiet === undefined
          ? heartbeat(deck.now)
          : look.glyph
    const elapsed = formatElapsed(elapsedOf(card, deck.now))
    const costTail = card.costUsd === undefined ? '' : ` · ${formatUsd(card.costUsd)}`

    return (
      <Box justifyContent="space-between" {...(part.index < 9 ? {} : { paddingLeft: INDENT })}>
        <Button
          key={`view-${card.id}`}
          plain
          {...hotkeyOf(part.index)}
          onPress={() => actions.view(card.id)}
        >
          <Text color={quiet === undefined ? look.color : 'warning'}>{glyph} </Text>
          <Text
            wrap="truncate-end"
            {...(isCardLive ? { weight: 'semibold' as const } : { dimColor: true })}
            {...tint(quiet === undefined ? undefined : 'warning')}
          >
            {card.title}
          </Text>
        </Button>
        <Box flexShrink={0}>
          {isCardLive ? (
            <Text tabular> {elapsed}</Text>
          ) : (
            <Text dimColor tabular>
              {' '}
              {elapsed}
              {costTail}
            </Text>
          )}
        </Box>
      </Box>
    )
  }

  const activityRow = (part: Part) => {
    const { meter, spark } = part
    const color = LOOK[part.card.status].color
    const tone = meter === undefined ? undefined : gaugeTone(meter.pct)

    return (
      <Text wrap="truncate-end">
        {meter !== undefined && (
          <Text>
            <Text dimColor>ctx </Text>
            {meter.fill !== '' && <Text color={tone ?? color}>{meter.fill}</Text>}
            {meter.rest !== '' && <Text dimColor>{meter.rest}</Text>}
            <Text {...tint(tone)}> {meter.pct}%</Text>
          </Text>
        )}
        {spark !== '' && (
          <Text color={color}>
            {meter !== undefined && '  '}
            {spark}
          </Text>
        )}
      </Text>
    )
  }

  const feedLine = (item: FeedItem) => {
    const look = FEED_LOOK[item.state]
    const isRunning = item.state === 'run'

    return (
      <Text wrap="truncate-end">
        <Text color={look.color}>{look.glyph}</Text>{' '}
        <Text {...look.tool}>{item.tool}</Text>{' '}
        <Text {...(isRunning ? {} : { dimColor: true })}>
          {item.summary}
          {isRunning ? ` (${formatElapsed(deck.now - item.firstSeenAt)})` : ''}
        </Text>
      </Text>
    )
  }

  const liveCard = (part: Part) => {
    const { card, quiet } = part
    const meta = [
      card.type,
      shortModel(card.model),
      card.effort,
      card.costUsd === undefined ? undefined : formatUsd(card.costUsd),
    ]
      .filter((one): one is string => one !== undefined && one !== '')
      .join(' · ')

    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={quiet === undefined ? LOOK[card.status].color : 'warning'}
        paddingX={1}
      >
        {titleRow(part)}
        <Box flexDirection="column" paddingLeft={INDENT}>
          <Text dimColor wrap="truncate-end">
            {meta}
          </Text>
          {(part.meter !== undefined || part.spark !== '') && activityRow(part)}
          {part.labelRows > 0 && <Text maxLines={2}>{card.label}</Text>}
          {part.feed.map(feedLine)}
          {quiet !== undefined && (
            <Text color="warning" wrap="truncate-end">
              ! {quiet}
            </Text>
          )}
        </Box>
      </Box>
    )
  }

  const foldedCard = (part: Part) => (
    <Box
      flexDirection="column"
      {...(isTight
        ? { paddingX: 2 }
        : {
            borderStyle: 'round',
            borderColor: LOOK[part.card.status].color,
            borderDimColor: true,
            paddingX: 1,
          })}
    >
      {titleRow(part)}
    </Box>
  )

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" marginBottom={1}>
        <Box justifyContent="space-between">
          <Text wrap="truncate-end">
            {groups.map((group, i) => (
              <Text color={group.color}>
                {i > 0 && '  '}
                {group.glyph} {group.count} {group.word}
              </Text>
            ))}
          </Text>
          <Box flexShrink={0}>
            <Text>
              <Text weight="semibold" tabular>
                {' '}
                {formatElapsed(batchElapsed(deck.cards, deck.now))}
              </Text>
              {cost !== undefined && <Text dimColor> · {formatUsd(cost)} est.</Text>}
            </Text>
          </Box>
        </Box>
        <Text wrap="truncate-end">
          {bar.ok !== '' && <Text color="success">{bar.ok}</Text>}
          {bar.bad !== '' && <Text color="error">{bar.bad}</Text>}
          {bar.rest !== '' && <Text dimColor>{bar.rest}</Text>}
          <Text dimColor>{finished}</Text>
        </Text>
        {viewing !== undefined && (
          <Button key="back" plain hotkey="0" onPress={() => actions.back()}>
            ← back to main
          </Button>
        )}
      </Box>
      {parts.map(part => (isLive(part.card) ? liveCard(part) : foldedCard(part)))}
      <Box flexDirection="column" marginTop={1}>
        <Text wrap="truncate-end">
          {hints.map(([key, words]) => (
            <Text>
              {key}
              <Text dimColor>{words}</Text>
            </Text>
          ))}
        </Text>
      </Box>
    </Box>
  )
}
