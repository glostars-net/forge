# Forge

A terminal desk for [OpenCode](https://opencode.ai). Type a change, switch between plan and build, and watch up to two workers run the queue.

Forge does not replace OpenCode's coding prompt. It launches `opencode run --standalone` and keeps the queue, verification, and review on the desk.

## Requirements

- [Bun](https://bun.sh)
- `opencode` on `PATH`, already signed in to the providers below
- OpenCode agents named `forge`, `smith`, `atelier`, `critic`, `scout`, `prover`, and `scribe`

Forge does not ship those agent files. Seat rules travel in the task text.

## Install

```bash
bun install
bun test
bun run typecheck
bun run install:cli
```

`install:cli` installs the package with Bun and links `forge` to `~/.local/bin/forge`.

## First launch

If `~/.config/opencode/forge/desk.json` has no `"setup": true`, the box asks three questions:

1. `What should Forge call you?`
2. `Main projects directory?`
3. `Other project directories, comma-separated? Enter skips.`

A path that is not a directory is asked again. A valid answer writes `desk.json` and is not asked on the next launch.

## Use

```bash
forge
forge ~/src/my-app
forge plan.md --project ~/src/my-app
forge --resume ~/src/my-app
forge --headless plan.md --project ~/src/my-app
```

A directory opens that project. A markdown path is a plan. `--resume` reads `<project>/.opencode/forge/queue.json`. `--headless` prints status and does not take the terminal.

Inside the desk, the box is focused.

| Mode | Enter |
| --- | --- |
| `PLAN` | Writes the text to `<project>/.opencode/forge/inbox.md` and asks the planner for a queue. It does not implement. |
| `BUILD`, empty | Runs the queue already on screen. |
| `BUILD`, text | Makes one `smith` task and runs it. |
| `BUILD`, a path ending in `.md` | Plans that file, then runs it. |

An empty plan box does nothing. A second Enter while a run is going logs `busy`. Without a project, the log says to open one with `forge <directory>`.

`Tab` switches `PLAN` and `BUILD`. `Esc` clears the box. `Ctrl-C` quits. `q` types.

The welcome line changes every 8 seconds. While a worker is active, that seat steps through `.:-+=*#%@`. Idle seats stay dots. `NO_COLOR` or `TERM=dumb` freezes the field.

## What a run does

The planner returns a queue. Ready tasks with no overlapping files run together, up to `concurrency` (default 2).

| Seat | Job |
| --- | --- |
| `forge` | Turns a plan into queue JSON. Does not implement. |
| `smith` | Implementation that is not UI or markdown. |
| `atelier` | UI, motion, and visual work. |
| `scout` | Read-only research. |
| `scribe` | Markdown only. |
| `critic` | Reviews `smith`, `atelier`, and `scribe` after they finish. |
| `prover` | Reserved in the model list and on the desk. The runner does not call it. |

A task with `verify` runs that command locally. One failure gets one repair, then the task blocks. `critic` must end with `FORGE_CRITIC: CLEAN`. A blocking review gets one repair. If no critic model remains, the review is skipped and the task still completes.

The queue is saved at `<project>/.opencode/forge/queue.json`.

## Models

Default order is NVIDIA Kimi, then Grok. Claude and other providers are rejected by the tier check.

| Seat | Order |
| --- | --- |
| `forge`, `atelier`, `prover` | `nvidia/moonshotai/kimi-k3.1-pro`, then `xai/grok-4.7` |
| `smith` | Kimi, then `xai/grok-build-0.1`, then Grok |
| `critic` | Grok at `xhigh`, then Kimi at `max` |
| `scout` | `nvidia/nvidia/nemotron-3.5-lightning-30b-a3b`, then `nvidia/minimaxai/minimax-m3.1-flash` |
| `scribe` | Kimi at `low`, then Grok at `low` |

A failed call drops effort, then switches model. A rate limit waits for the provider reset, or five minutes when none was returned. A retired model is skipped.

Edit `~/.config/opencode/forge/tiers.json` to change the order. Each model id must start with `nvidia/` or `xai/`.

## Config

`~/.config/opencode/forge/desk.json`:

| Field | Default | Meaning |
| --- | --- | --- |
| `name` | `aj` | Name used in the welcome line |
| `motion` | `true` | Animate active seats |
| `concurrency` | `2` | Workers at once, clamped to 1–6 |
| `idleTimeoutMs` | `120000` | Silence before a worker is abandoned |
| `maxStageMs` | `300000` | Cap on one stage |
| `projectRoots` | directories under `~/Developer` | Where the project list looks |
| `skillRoots` | `~/.agents/skills`, `~/.config/opencode/skills` | Skill indexes |

Skills whose ids start with `higgsfield` are manual. The planner assigns one only when the plan names it.

## Environment

| Variable | Effect |
| --- | --- |
| `FORGE_IDLE_TIMEOUT_MS` | Overrides `idleTimeoutMs` |
| `FORGE_MAX_STAGE_MS` | Overrides `maxStageMs` |
| `FORGE_DEBUG=1` | Prints raw worker output on stderr |
| `FORGE_QUOTA_BIN` | Program used to read remaining quota |
| `NO_COLOR`, `TERM=dumb` | Static desk |

## Develop

```bash
bun test
bun run typecheck
```
