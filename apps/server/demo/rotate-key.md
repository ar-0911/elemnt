---
title: Rotate the production API key
summary: Quarterly key rotation for the billing service.
---

## Rotate

Current error rate is :query[~0.2%]{source=metrics key=billing.errors.rate format=percent}.

::::runbook{id=rotate-api-key}
:::step[Create the new key]
```sh
acme keys create --name prod-2026
```
:::
:::step[Revoke the old key]{gate=approve expect="revoked prod-2025"}
```sh
acme keys revoke prod-2025
```
:::
::::

---

## Check your math

```python run
print(sum(range(10)))
```

::query[Open incidents]{source=status-api key=incidents.open format=number}
