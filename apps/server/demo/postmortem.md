---
title: The fourteen-minute checkout outage
summary: A config push turned off retries for card payments. What happened, why we missed it, and the three changes we made.
style:
  preset: editorial
---

:::hero[The fourteen minutes checkout stood still]{eyebrow="Postmortem · 2026-09-14" art=waves}
At 14:02 a routine config push switched off retries for card payments. For fourteen minutes, one in five checkouts failed. This is the story of those minutes, and of the three changes that mean it can't happen the same way again.

[What happened](#minute-by-minute) [What we changed](#three-changes)
:::

:::stats
::stat[14 min]{label="Customer impact"}
::stat[21%]{label="Checkouts failed at peak"}
::stat[0]{label="Double charges" note="idempotency keys held"}
:::

:::quote{by="Priya Raman" role="incident commander"}
The rollback took nine minutes. Finding out we needed one took five. That second number is the one this document is about.
:::

## Minute by minute

::::timeline
:::event[Config push]{date="14:02"}
`payments.retry.enabled` flips to `false` as part of an unrelated cleanup.
:::
:::event[Error rate climbs]{date="14:04" tone=warn}
Card declines from the processor stop being retried. Checkout errors cross 5%.
:::
:::event[Page fires]{date="14:07" tone=danger}
The checkout SLO burn alert pages the on-call engineer.
:::
:::event[Cause found]{date="14:11"}
The config diff shows the flag. Rollback starts.
:::
:::event[Recovered]{date="14:16" tone=ok}
Error rate back under 0.5%.
:::
::::

## Why the retries mattered

:::graphic{alt="A line chart of checkout error rate over time: flat near zero, rising sharply after 14:02 to a peak of 21 percent around 14:09, then falling back to normal by 14:16." caption="Checkout error rate, 13:55 to 14:20"}
```svg
<svg viewBox="0 0 600 220" fill="none">
  <g stroke="currentColor" stroke-opacity=".15"><path d="M40 20H580M40 70H580M40 120H580M40 170H580"/></g>
  <g fill="currentColor" fill-opacity=".55" font-size="11"><text x="8" y="24">25%</text><text x="8" y="124">10%</text><text x="14" y="174">0%</text><text x="40" y="200">13:55</text><text x="200" y="200">14:02</text><text x="380" y="200">14:09</text><text x="530" y="200">14:20</text></g>
  <path d="M40 168 L200 167 L250 150 L300 110 L380 48 L430 70 L470 140 L500 165 L580 167" stroke="var(--accent)" stroke-width="3" stroke-linejoin="round" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"><animate attributeName="stroke-dashoffset" from="1" to="0" dur="2s" fill="freeze"/></path>
  <path d="M200 20V175" stroke="var(--accent-2)" stroke-dasharray="4 4"/>
  <text x="206" y="34" fill="var(--accent-2)" font-size="12">config push</text>
</svg>
```
:::

Card processors decline a small share of good payments for reasons that clear up in a second: a timeout, a rate limit, a flaky issuer. We retry those once, with the same :term[idempotency key]{def="A unique key sent with a payment so the processor applies it at most once, however many times it is sent."}, which is why no customer was charged twice.

## Three changes

::::cards{cols=3}
:::card[Flags that matter are typed]{icon="①" tone=accent}
`payments.retry.enabled` now lives in the payments service's own config, with a test that fails if it is ever false in production.
:::
:::card[Config diffs page a human]{icon="②" tone=accent}
Any change to a payments key needs a second reviewer from the payments team.
:::
:::card[Faster to see]{icon="③" tone=accent}
A dedicated "retries attempted" graph sits next to checkout errors, so a drop to zero is obvious in seconds.
:::
::::

:::callout[What we are not changing]{type=note}
We considered blocking all config pushes during peak hours. It would have slowed every team for a failure that the three changes above already prevent.
:::
