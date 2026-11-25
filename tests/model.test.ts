import type { AgentInfo, ToolUseSummary } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import {
  EMPTY_DECK,
  addSpawn,
  batchElapsed,
  cardFromSpawn,
  dismiss,
  feedFrom,
  formatElapsed,
  formatUsd,
  gauge,
  gaugeTone,
  heartbeat,
  mergeCard,
  mergeDeck,
  progressBar,
  quietReason,
  shortModel,
  shouldOpen,
  sparkline,
  summarizeTool,
  tally,
  totalCost,
} from '../hooks/model'
import type { Card, FeedItem } from '../types'

const info = (over: Partial<AgentInfo> = {}): AgentInfo => ({
  id: 'a1',
  description: 'Find auth code',
  type: 'Explore',
  status: 'running',
  kind: 'local_agent',
  taskStatus: 'running',
  label: 'Find auth code',
  startTime: 1_000,
  cwd: '/repo',
  tokenCount: 100,
  tokenSamples: [0, 50, 100],
  hasRow: true,
  ...over,
})

const card = (over: Partial<Card> = {}): Card => ({
  ...cardFromSpawn('a1', 'Find auth code', 'Explore', 0),
  status: 'running',
  ...over,
})

const run = (over: Partial<FeedItem> = {}): FeedItem => ({
  id: 't1',
  tool: 'Bash',
  summary: 'npm test',
  state: 'run',
  firstSeenAt: 0,
  ...over,
})

test('sparkline draws positive deltas scaled to the busiest step', () => {
  expect(sparkline([5, 5, 5, 5], 3)).toBe('▁▁▁')
  expect(sparkline([0, 10, 30, 60], 3)).toBe('▃▆█')
  expect(sparkline([100, 20, 40], 3)).toBe(' ▁█')
  expect(sparkline([1, 2], 0)).toBe('')
})

test('gauge fills by share of the context window and colors past 70% and 90%', () => {
  expect(gauge(0, 100)).toEqual({ fill: '', rest: '──────────', pct: 0 })
  expect(gauge(58_000, 100_000)).toEqual({ fill: '━━━━━━', rest: '────', pct: 58 })
  expect(gauge(500, 100)).toEqual({ fill: '━━━━━━━━━━', rest: '', pct: 100 })
  expect(gauge(10, undefined)).toBeUndefined()
  expect(gaugeTone(69)).toBeUndefined()
  expect(gaugeTone(70)).toBe('warning')
  expect(gaugeTone(90)).toBe('error')
})

test('the heartbeat turns a quarter each second and comes round every four', () => {
  expect([0, 1_000, 2_000, 3_000, 4_000].map(heartbeat)).toEqual(['◐', '◓', '◑', '◒', '◐'])
  expect(heartbeat(1_999)).toBe('◓')
})

test('the progress bar fills with finished agents, failures in their own segment', () => {
  const live = card()
  const done = card({ status: 'completed' })
  const failed = card({ status: 'failed' })

  expect(progressBar([live, live], 10)).toEqual({ ok: '', bad: '', rest: '──────────' })
  expect(progressBar([done, live, live], 9)).toEqual({ ok: '━━━', bad: '', rest: '──────' })
  expect(progressBar([done, failed, live, live], 8)).toEqual({ ok: '━━', bad: '━━', rest: '────' })
  expect(progressBar([done, done], 6)).toEqual({ ok: '━━━━━━', bad: '', rest: '' })
  const oneFailureInTen = [failed, ...Array<Card>(4).fill(done), ...Array<Card>(5).fill(live)]
  expect(progressBar(oneFailureInTen, 4)).toEqual({ ok: '━', bad: '━', rest: '──' })
  expect(progressBar([], 4)).toEqual({ ok: '', bad: '', rest: '────' })
})

test('the batch time runs from the first start to now, or to the last end once all have ended', () => {
  const first = card({ startTime: 1_000 })
  const second = card({ id: 'a2', startTime: 4_000 })
  expect(batchElapsed([first, second], 10_000)).toBe(9_000)

  const ended = [
    { ...first, status: 'completed' as const, endTime: 6_000 },
    { ...second, status: 'failed' as const, endTime: 8_000 },
  ]
  expect(batchElapsed(ended, 50_000)).toBe(7_000)
  expect(batchElapsed([], 50_000)).toBe(0)
})

test('a running agent with nothing in flight is quiet from 60s', () => {
  const idle = card({ lastActiveAt: 0 })
  expect(quietReason(idle, [], 59_000)).toBeUndefined()
  expect(quietReason(idle, [], 61_000)).toBe('quiet 1m01s: no tokens or tools')
  expect(quietReason(idle, [run({ state: 'ok' })], 61_000)).toBe('quiet 1m01s: no tokens or tools')
})

test('a tool in flight warns only from 5 minutes', () => {
  const busy = card({ lastActiveAt: 0 })
  expect(quietReason(busy, [run()], 4 * 60_000)).toBeUndefined()
  expect(quietReason(busy, [run()], 5 * 60_000)).toBe('Bash running 5m00s')
})

test('only a running agent can be quiet', () => {
  for (const status of ['waiting', 'pending', 'completed', 'failed'] as const) {
    expect(quietReason(card({ status, lastActiveAt: 0 }), [], 10 * 60_000)).toBeUndefined()
  }
})

test('summarizeTool names the part of the input worth reading', () => {
  expect(summarizeTool('Read', { file_path: '/a/b/token.ts' })).toEqual({
    name: 'Read',
    detail: 'token.ts',
  })
  expect(summarizeTool('Bash', { command: 'npm test\n--watch' }).detail).toBe('npm test')
  expect(summarizeTool('Grep', { pattern: 'refresh', path: '/repo' }).detail).toBe('refresh')
  expect(summarizeTool('WebFetch', { url: 'https://docs.example.com/x' }).detail).toBe(
    'docs.example.com',
  )
  expect(summarizeTool('WebSearch', { query: 'ink borders' }).detail).toBe('ink borders')
  expect(summarizeTool('Agent', { description: 'Map hooks', prompt: 'long' }).detail).toBe(
    'Map hooks',
  )
  expect(summarizeTool('mcp__github__create_issue', { title: 'Bug' })).toEqual({
    name: 'create_issue',
    detail: 'Bug',
  })
  expect(summarizeTool('TodoWrite', { todos: [] }).detail).toBe('')

  const long = summarizeTool('Bash', { command: 'x'.repeat(300) }).detail
  expect(long).toHaveLength(120)
  expect(long).toEndWith('…')
})

test('feedFrom keeps the last three calls and when each was first seen', () => {
  const uses: ToolUseSummary[] = [
    { tool_use_id: 't0', tool: 'Glob', input: { pattern: '*.ts' }, text: 'a.ts' },
    { tool_use_id: 't1', tool: 'Read', input: { file_path: '/x/a.ts' }, text: 'ok' },
    { tool_use_id: 't2', tool: 'Edit', input: { file_path: '/x/a.ts' }, text: 'no', isError: true },
    { tool_use_id: 't3', tool: 'Bash', input: { command: 'npm test' } },
  ]
  const feed = feedFrom(uses, [run({ id: 't1', firstSeenAt: 5 })], 99)

  expect(feed.map(item => [item.id, item.state, item.firstSeenAt])).toEqual([
    ['t1', 'ok', 5],
    ['t2', 'err', 99],
    ['t3', 'run', 99],
  ])
})

test('a spawn starts a batch, joins a live one, and replaces a finished one', () => {
  const first = addSpawn(EMPTY_DECK, cardFromSpawn('a1', 'One', 'Explore', 10))
  expect(first.batch).toBe(1)
  expect(first.ids).toEqual(['a1'])

  const joined = addSpawn(first, cardFromSpawn('a2', 'Two', 'Plan', 20))
  expect(joined.batch).toBe(1)
  expect(joined.ids).toEqual(['a1', 'a2'])

  const finished = {
    ...joined,
    cards: joined.cards.map((one): Card => ({ ...one, status: 'completed', endTime: 30 })),
    dismissedBatch: 1,
  }
  const next = addSpawn(finished, cardFromSpawn('a3', 'Three', 'Explore', 40))
  expect(next.batch).toBe(2)
  expect(next.ids).toEqual(['a3'])
  expect(next.feed).toEqual({})
  expect(shouldOpen(next)).toBe(true)
})

test('a person closing the pane holds it shut for the rest of that batch', () => {
  const live = addSpawn(EMPTY_DECK, cardFromSpawn('a1', 'One', 'Explore', 10))
  const closed = dismiss(live)
  expect(shouldOpen(closed)).toBe(false)
  expect(shouldOpen(addSpawn(closed, cardFromSpawn('a2', 'Two', 'Explore', 20)))).toBe(false)
})

test('the end time is stamped once, when the agent is first seen ended', () => {
  const ended = mergeCard(card(), info({ status: 'completed' }), false, 5_000)
  expect(ended.endTime).toBe(5_000)
  expect(mergeCard(ended, info({ status: 'completed' }), false, 9_000).endTime).toBe(5_000)
})

test('an agent that drops off the list is gone, unless it was only just spawned', () => {
  const pending = cardFromSpawn('a1', 'One', 'Explore', 0)
  expect(mergeCard(pending, undefined, false, 5_000)).toBe(pending)

  const gone = mergeCard(card(), undefined, false, 20_000)
  expect(gone.status).toBe('gone')
  expect(gone.endTime).toBe(20_000)
})

test('activity moves lastActiveAt: tokens, a new request, or the feed', () => {
  const quiet = card({ tokenCount: 100, lastActiveAt: 0 })
  expect(mergeCard(quiet, info({ tokenCount: 100 }), false, 50_000).lastActiveAt).toBe(0)
  expect(mergeCard(quiet, info({ tokenCount: 140 }), false, 50_000).lastActiveAt).toBe(50_000)
  expect(mergeCard(quiet, info({ lastRequest: { at: 42_000, model: 'm' } }), false, 50_000).lastActiveAt).toBe(42_000)
  expect(mergeCard(quiet, info(), true, 50_000).lastActiveAt).toBe(50_000)
})

test('the deck records when every agent has ended and forgets it on new work', () => {
  const live = addSpawn(EMPTY_DECK, cardFromSpawn('a1', 'One', 'Explore', 0))
  const done = mergeDeck(live, [info({ status: 'completed' })], {}, 7_000)
  expect(done.allDoneAt).toBe(7_000)
  expect(mergeDeck(done, [info({ status: 'completed' })], {}, 9_000).allDoneAt).toBe(7_000)
  expect(mergeDeck(done, [info({ status: 'running' })], {}, 9_000).allDoneAt).toBeUndefined()
})

test('formatting: elapsed, model, cost, tallies', () => {
  expect(formatElapsed(0)).toBe('0s')
  expect(formatElapsed(59_999)).toBe('59s')
  expect(formatElapsed(61_000)).toBe('1m01s')
  expect(formatElapsed(3_660_000)).toBe('1h01m')
  expect(shortModel('claude-haiku-5-5')).toBe('haiku-5-5')
  expect(formatUsd(0)).toBe('$0.00')
  expect(formatUsd(0.004)).toBe('<$0.01')
  expect(formatUsd(1.234)).toBe('$1.23')

  const cards = [
    card({ status: 'running', costUsd: 0.1 }),
    card({ status: 'completed', costUsd: 0.2 }),
    card({ status: 'killed' }),
  ]
  expect(tally(cards)).toEqual({ live: 1, done: 1, failed: 1 })
  expect(Math.round((totalCost(cards) ?? 0) * 100)).toBe(30)
  expect(totalCost([card()])).toBeUndefined()
})
