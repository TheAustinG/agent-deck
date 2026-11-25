# agent-deck

A Claude Code mod that opens a side panel whenever subagents start, with a live card for each agent.

```
● 2 running  ✓ 1 done            $0.14 est.

1: ● Find auth code                  2m14s
  Explore · haiku-5-5 · low · $0.03
  ctx ██████░░░░ 58%   ▁▂▅▇▃▁▁▂▁▁▁▁▁▁▁
  Searching for the token refresh logic
  ✓ Read token.ts
  … Bash npm test (12s)
```

Each card shows:

- status, title and elapsed time
- agent type, model, effort and cost estimate
- how full the agent's context window is
- a sparkline of its recent token activity
- what it says it is doing now
- its last three tool calls, with a timer on any still running
- a warning when it goes quiet or a tool call runs long

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install agent-deck --marketplace TheAustinG/agent-deck
```

Answer `y` to add the marketplace, then pick a scope. The user scope loads it in every session.

From a shell:

```
claude plugin install agent-deck --marketplace TheAustinG/agent-deck
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `TheAustinG/agent-deck`, then Add plugin.

## Use

- The panel opens by itself when an agent starts. In the terminal it docks beside the transcript in the fullscreen layout once the window is at least 144 columns wide (110 after you have opened it yourself once).
- `/agent-deck` opens it at any width, showing the latest run.
- `ctrl+x tab` focuses the panel. Then `1` to `9` open that agent's transcript, `0` returns to the main conversation, and `esc` hands the keys back to the prompt. `ctrl+x x` closes the panel.
- It closes itself 60 seconds after the last agent finishes, and waits while the panel has focus.
- A new batch of agents replaces the previous batch's cards.

## Warnings

- `! quiet 1m15s: no tokens or tools` means a running agent has produced no tokens and made no tool calls for at least a minute. One very long generation, such as writing a large file in a single call, can trigger it too.
- `! Bash running 5m02s` means a single tool call has been running for five minutes or more.

## Notes

- Cost figures are Claude Code's own client-side estimates, not billing data. On a subscription they are not charges.
- Agents started inside workflows and agent-team teammates do not get cards.
- The tool feed reads each agent's transcript every two seconds instead of hooking tool calls, because a tool-call hook would stop Claude Code from moving long-running tools to the background.
- Built on Claude Code's function-hooks plugin API, which is early access. Tested on Claude Code 2.1.332.

## Development

```
claude plugin validate .
claude plugin test .
```

`claude --plugin-dir .` starts a session with your working copy loaded. That also writes the API's type declarations to `.claude-plugin/types/`, which `tsc -p .` then reads.

## License

MIT
