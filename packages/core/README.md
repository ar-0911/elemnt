# @elemnt/core

Parses Elemnt source and compiles it into HTML for people and Markdown for agents. Used by the editor preview, the page renderer, the MCP server and the CLI, so all of them see the same output.

```ts
import { createElemnt } from "@elemnt/core";

const elemnt = createElemnt();
const { html, markdown, diagnostics, ok } = elemnt.compile(source);
```

- `diagnostics` carry line and column, so the editor can underline problems. `compile` never throws on bad input.
- `ok` is false when there are errors; saving should be blocked.
- `elemnt.authoringGuide()` returns Markdown describing every component, for the `/` menu and the MCP `get_authoring_guide` tool.

## Pipeline

```
source → remark-parse → gfm → frontmatter → directive → validate (zod props + structure)
       ├→ mdast-util-to-hast with component render() → hast-util-sanitize → HTML
       └→ component toMarkdown() → remark-stringify → agent Markdown
```

Raw HTML in source is dropped, and the HTML output is sanitized against `elemntSanitizeSchema`. User JavaScript never runs in this output; widgets will render in a sandboxed iframe on a separate origin.

## Components

Built in: `callout`, `tabs` / `tab`, `steps`, `details`, `diagram`. Each implements `ElemntComponent`:

```ts
interface ElemntComponent<P> {
  name: string;
  kinds: ("containerDirective" | "leafDirective" | "textDirective")[];
  props: z.ZodType<P>;
  validate?(node, props, ctx): string[];
  render(node, props, ctx): hast;        // for people
  toMarkdown(node, props, ctx): mdast[]; // for agents, required
  authoring: { doc: string; snippet: string };
}
```

Add your own with `createElemnt({ components: [...builtinComponents, mine] })`.

Unknown inline directives (`10:30`, `ratio:high`) are kept as literal text. Unknown block directives produce an error diagnostic, and their content still renders.
