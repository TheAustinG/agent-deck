import type { AgentInfo, AgentSpawnInput, On, SessionMessage, UiPane } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { FoundElement } from 'claude-code/testing'

const START = 1_700_000_000_000
const SURFACES = ['terminal', 'desktop'] as const

const frameOf = (boxes: readonly FoundElement[]): FoundElement | undefined =>
  boxes.find(box => box.props.borderStyle !== undefined)

type World = {
  nextId: string
  agents: AgentInfo[]
  messages: Record<string, SessionMessage[]>
  panes: UiPane[]
  opened: string[]
  closed: string[]
  viewed: unknown[]
  toasts: string[]
  viewDeny?: string
}

const PANE = {
  plugin: 'agent-deck',
  component: 'Pane',
  requestId: 'agent-deck',
  props: {
    title: 'Agents',
    isFocused: false,
    bodyColumns: 44,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 60 },
    view: {},
  },
} as const

const world = (): World => ({
  nextId: 'a1',
  agents: [],
  messages: {},
  panes: [],
  opened: [],
  closed: [],
  viewed: [],
  toasts: [],
})

const agent = (over: Partial<AgentInfo> = {}): AgentInfo => ({
  id: 'a1',
  description: 'Find auth code',
  type: 'Explore',
  status: 'running',
  kind: 'local_agent',
  taskStatus: 'running',
  label: 'Find auth code',
  startTime: START,
  cwd: '/repo',
  tokenCount: 100,
  tokenSamples: [100, 100, 100],
  hasRow: true,
  ...over,
})

const spawn = (over: Partial<AgentSpawnInput> = {}): AgentSpawnInput => ({
  tool_use_id: 'tu1',
  prompt: 'Look around',
  description: 'Find auth code',
  subagentType: 'Explore',
  provider: { plugin: 'test', tier: 'user' },
  parentModel: 'claude-opus-5-5',
  background: true,
  fork: false,
  ...over,
})

const pane = (isFocused: boolean): UiPane => ({
  id: 'agent-deck',
  title: 'Agents',
  isShown: true,
  isFocused,
  isPlaced: true,
})

function engine(on: On, w: World) {
  on('command.register', () => ({ value: { command: 'agent-deck' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: w.nextId }))
  on('agent.list', () => ({ value: w.agents }))
  on('session.messages', (_, e) => ({
    value: w.messages[(e as { agentId?: string }).agentId ?? ''] ?? [],
  }))
  on('ui.open', (_, e) => {
    w.opened.push(e.id)

    return { value: { isPlaced: true as const } }
  })
  on('ui.close', (_, e) => {
    w.closed.push(e.id)

    return { value: undefined }
  })
  on('ui.panes', () => ({ value: w.panes }))
  on('ui.view', (_, e) => {
    w.viewed.push(e)

    return { value: w.viewDeny === undefined ? {} : { deny: w.viewDeny } }
  })
  on('ui.toast', (_, e) => {
    w.toasts.push(e.text)

    return { value: undefined }
  })

  return mock.clock(on, { now: START })
}

test('a spawn opens the pane and a tick draws the card, on every surface', async ($, on) => {
  const w = world()
  const clock = engine(on, w)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.agent.spawn(spawn())
  expect(w.opened).toEqual(['agent-deck'])

  w.agents = [
    agent({
      model: 'claude-haiku-5-5',
      effort: 'low',
      contextWindowSize: 200_000,
      tokenCount: 116_000,
      tokenSamples: [0, 40_000, 116_000],
      cost: { usd: 0.03 },
      label: 'Searching for token refresh',
    }),
  ]
  await clock.advance(1000)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ key: 'view-a1' }))?.text).toContain('Find auth code')
    expect(frameOf(await ui.findAll({ type: 'Box', text: 'Find auth code' }))?.props).toMatchObject({
      borderStyle: 'round',
      borderColor: 'suggestion',
    })
    expect(await ui.find({ type: 'Text', text: /Explore · haiku-5-5 · low · \$0\.03/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /ctx ━━━━━━──── 58%/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Searching for token refresh/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /1 running/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /done/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^ 1s · \$0\.03 est\.$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^─{40} 0\/1$/ })).toBeDefined()
    await ui.unmount()
  }
})

test('the header shows the batch time and a bar of the agents that have finished', async ($, on) => {
  const w = world()
  const clock = engine(on, w)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.agent.spawn(spawn())
  w.nextId = 'a2'
  await $.agent.spawn(spawn({ tool_use_id: 'tu2', description: 'Write the summary' }))
  w.agents = [
    agent({ status: 'completed', taskStatus: 'completed' }),
    agent({ id: 'a2', description: 'Write the summary' }),
  ]
  await clock.advance(90_000)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /^● 1 running {2}✓ 1 done$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^ 1m30s$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^━{20}─{20} 1\/2$/ })).toBeDefined()
    await ui.unmount()
  }
})

test('a running card turns its dot once a second', async ($, on) => {
  const w = world()
  const clock = engine(on, w)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.agent.spawn(spawn())
  w.agents = [agent()]

  const seen: (string | undefined)[] = []
  for (let i = 0; i < 4; i++) {
    await clock.advance(1000)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    seen.push((await ui.find({ key: 'view-a1' }))?.text.at(0))
    await ui.unmount()
  }
  expect([...seen].sort()).toEqual(['◐', '◑', '◒', '◓'])
})

test('the feed shows a finished call and one in flight', async ($, on) => {
  const w = world()
  const clock = engine(on, w)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.agent.spawn(spawn())
  w.agents = [agent()]
  w.messages.a1 = [
    {
      role: 'assistant',
      text: '',
      toolUses: [
        { tool_use_id: 't1', tool: 'Read', input: { file_path: '/repo/src/token.ts' }, text: 'ok' },
        { tool_use_id: 't2', tool: 'Bash', input: { command: 'npm test' } },
      ],
    },
  ]
  await clock.advance(2000)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /✓ Read token\.ts/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /… Bash npm test \(\d+s\)/ })).toBeDefined()
    await ui.unmount()
  }
})

test('a running agent with no tokens or tools for a minute is flagged quiet', async ($, on) => {
  const w = world()
  const clock = engine(on, w)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.agent.spawn(spawn())
  w.agents = [agent()]
  await clock.advance(30_000)

  const early = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await early.find({ type: 'Text', text: /quiet/ })).toBeUndefined()
  await early.unmount()

  await clock.advance(32_000)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /quiet 1m0\ds: no tokens or tools/ })).toBeDefined()
    expect((await ui.find({ key: 'view-a1' }))?.text).toBe('● Find auth code')
    expect(frameOf(await ui.findAll({ type: 'Box', text: 'Find auth code' }))?.props.borderColor).toBe(
      'warning',
    )
    await ui.unmount()
  }

  await clock.advance(1000)
  const later = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await later.find({ key: 'view-a1' }))?.text).toBe('● Find auth code')
  await later.unmount()
})

test('the pane closes 60s after the last agent ends, later while focused', async ($, on) => {
  const w = world()
  const clock = engine(on, w)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.agent.spawn(spawn())
  w.agents = [agent({ status: 'completed', taskStatus: 'completed' })]
  w.panes = [pane(false)]

  await clock.advance(1000)
  await clock.advance(59_000)
  expect(w.closed).toEqual([])

  w.panes = [pane(true)]
  await clock.advance(2000)
  expect(w.closed).toEqual([])

  w.panes = [pane(false)]
  await clock.advance(30_000)
  expect(w.closed).toEqual([])

  await clock.advance(31_000)
  expect(w.closed).toEqual(['agent-deck'])
})

test('a spawn after the batch has ended replaces the old cards', async ($, on) => {
  const w = world()
  const clock = engine(on, w)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.agent.spawn(spawn())
  w.agents = [agent({ status: 'completed', taskStatus: 'completed' })]
  await clock.advance(1000)

  w.nextId = 'a2'
  await $.agent.spawn(spawn({ tool_use_id: 'tu2', description: 'Write the summary' }))
  w.agents = [
    agent({ status: 'completed', taskStatus: 'completed' }),
    agent({ id: 'a2', description: 'Write the summary' }),
  ]
  await clock.advance(1000)
  expect(w.opened).toEqual(['agent-deck', 'agent-deck'])

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ key: 'view-a2' }))?.text).toContain('Write the summary')
    expect(await ui.find({ key: 'view-a1' })).toBeUndefined()
    await ui.unmount()
  }
})

test('a card opens its agent, says why when it cannot, and back returns', async ($, on) => {
  const w = world()
  const clock = engine(on, w)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.agent.spawn(spawn())
  w.agents = [agent()]
  await clock.advance(1000)

  for (const surface of SURFACES) {
    w.viewed = []
    w.toasts = []
    w.viewDeny = undefined
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'view-a1' })
    expect(w.viewed).toEqual([{ agentId: 'a1' }])

    w.viewDeny = 'no row for it'
    await ui.press({ key: 'view-a1' })
    expect(w.toasts).toEqual(["agent-deck: can't open that agent (no row for it)"])
    await ui.unmount()

    const viewing = await $.ui.mount({
      ...PANE,
      surface,
      props: { ...PANE.props, view: { agentId: 'a1' } },
    })
    await viewing.press({ key: 'back' })
    expect(w.viewed.at(-1)).toEqual({})
    await viewing.unmount()
  }
})

test('workflow and teammate spawns open nothing', async ($, on) => {
  const w = world()
  engine(on, w)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.agent.spawn(spawn({ workflow: { runId: 'r1', agentIndex: 0 } }))
  await $.agent.spawn(spawn({ tool_use_id: 'tu2', isTeammate: true }))
  expect(w.opened).toEqual([])

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /No subagents yet/ })).toBeDefined()
  await ui.unmount()
})

test('a value an earlier version stored is declined', async ($, on) => {
  on('state.get', () => ({
    value: { value: { cards: [{ id: 'old' }] }, version: 1 },
  }))

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /No subagents yet/ })).toBeDefined()
  await ui.unmount()
})

test('a finished card folds to one dim row and drops its frame when the pane is short', async ($, on) => {
  const w = world()
  const clock = engine(on, w)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.agent.spawn(spawn())
  w.nextId = 'a2'
  await $.agent.spawn(spawn({ tool_use_id: 'tu2', description: 'Write the summary' }))
  w.agents = [
    agent({ status: 'completed', taskStatus: 'completed', model: 'claude-haiku-5-5', cost: { usd: 0.02 } }),
    agent({
      id: 'a2',
      description: 'Write the summary',
      label: 'Drafting the summary',
      model: 'claude-haiku-5-5',
    }),
  ]
  await clock.advance(1000)

  for (const surface of SURFACES) {
    const roomy = await $.ui.mount({ ...PANE, surface })
    expect(await roomy.findAll({ type: 'Text', text: /haiku-5-5/ })).toHaveLength(1)
    expect(await roomy.find({ type: 'Text', text: /^ \ds · \$0\.02$/ })).toBeDefined()
    expect(frameOf(await roomy.findAll({ type: 'Box', text: 'Find auth code' }))?.props).toMatchObject({
      borderStyle: 'round',
      borderColor: 'success',
      borderDimColor: true,
    })
    expect((await roomy.find({ type: 'Text', text: 'Find auth code' }))?.props.dimColor).toBe(true)
    await roomy.unmount()

    const short = await $.ui.mount({
      ...PANE,
      surface,
      props: { ...PANE.props, scroll: { offset: 0, bodyRows: 8 } },
    })
    expect(frameOf(await short.findAll({ type: 'Box', text: 'Find auth code' }))).toBeUndefined()
    expect(frameOf(await short.findAll({ type: 'Box', text: 'Write the summary' }))).toBeDefined()
    expect(await short.find({ type: 'Text', text: /\$0\.02/ })).toBeDefined()
    await short.unmount()
  }
})
