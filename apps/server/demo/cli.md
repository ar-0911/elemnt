---
title: acme CLI cheat sheet
summary: The twelve commands you use every week, what they print, and the flags that save you a trip to the docs.
style:
  preset: terminal
---

:::hero[acme, in one screen]{eyebrow="$ acme --help" art=grid}
Everything you do daily with the acme CLI, in the order you'll need it. Copy, paste, ship.

[Install](#install) [Deploy](#deploy) [Debug](#debug)
:::

## Install

:::codegroup
```sh title="macOS"
brew install acme/tap/acme
```
```sh title="Linux"
curl -fsSL https://get.acme.dev | sh
```
:::

:::stats
::stat[12]{label="Commands worth knowing"}
::stat[< 1 s]{label="Typical command time"}
::stat[3]{label="Flags you'll use daily" note="--env, --json, --dry-run"}
:::

## Deploy

:::steps
1. **Log in** once per machine: `acme login`.
2. **Preview** the change: `acme deploy --dry-run` prints what would change, nothing more.
3. **Ship it**: `acme deploy --env staging`, then `--env production` when staging is green.
:::

:::callout{type=warn}
`acme deploy --env production` asks for confirmation. `--yes` skips it; keep that out of your shell history.
:::

## Debug

::::cards{cols=2}
:::card[Tail logs]{icon=">_"}
`acme logs api --follow --since 10m`
:::
:::card[Shell into a pod]{icon="#"}
`acme exec api -- sh`
:::
:::card[What's running]{icon="$"}
`acme status --json | jq '.services[] | {name, version}'`
:::
:::card[Roll back]{icon="↩"}
`acme rollback api --to previous`
:::
::::

Try the JSON output yourself:

```js run
const status = { services: [{ name: "api", version: "2.14.0", healthy: true }, { name: "worker", version: "2.13.9", healthy: false }] };
status.services.filter((s) => !s.healthy).map((s) => `${s.name}@${s.version} is unhealthy`);
```
