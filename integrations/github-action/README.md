# Elemnt explainer sync (GitHub Action)

Keeps the Elemnt page that explains your repo accurate. After each push, Elemnt looks at the files the page cites (its GitHub links, `::snippet` and `::filetree` paths, and the folders chosen when linking). If any changed, Claude drafts an update and it waits in Elemnt as a suggestion for a person to accept. Nothing is ever written to your repo.

Use this when you can't install the Elemnt GitHub App, for example on a self-hosted server without a public webhook URL. With the App installed you don't need it.

```yaml
# .github/workflows/elemnt.yml
name: Elemnt
on:
  push:
    branches: [main]
jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: ar-0911/elemnt/integrations/github-action@main
        with:
          server: https://docs.example.com
          token: ${{ secrets.ELEMNT_TOKEN }}
```

Create the token in Elemnt under **Settings → Account → API tokens** (an editor's token), and save it as the `ELEMNT_TOKEN` repository secret.
