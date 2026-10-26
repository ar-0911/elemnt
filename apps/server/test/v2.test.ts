import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AiProvider, AiRequest } from "../src/services/ai.js";
import { ASK_SCHEMA } from "../src/services/ask.js";
import { COMPONENT_SCHEMA, widgetSnippet } from "../src/services/library.js";
import { LEVEL_SCHEMA } from "../src/services/levels.js";
import { createElemnt } from "@elemnt/core";
import { SANDBOX_URL, setup } from "./helpers.js";

const SOURCE = "---\ntitle: Rate limits\nsummary: Limits per plan.\n---\n## Limits\n\nFree plans get 60 requests a minute.\n\n## Errors\n\nOver the limit you get a 429.\n";

let t: Awaited<ReturnType<typeof setup>>;
let pageId: string;
let requests: AiRequest[];

const COMPONENT = { name: "Seat cost", slug: "seat-cost", description: "Shows cost by seats", summary: "A slider: monthly cost is $8 per seat.", html: '<input id="s" type="range">', css: "input{width:100%}", js: "const s = document.getElementById('s');\nconst f = `${s.value}`;", height: 200 };

const fakeAi: AiProvider = () => ({
  async json<T>(req: AiRequest) {
    requests.push(req);
    if (req.schema === ASK_SCHEMA) {
      const gap = req.prompt.includes("SSO");
      return { answer: gap ? "This page doesn't cover SSO." : "You get a **429**.\n\n:::callout{type=tip}\nBack off and retry.\n:::", covered: !gap, section: gap ? null : "errors", sources: [] } as T;
    }
    if (req.schema === LEVEL_SCHEMA) return { source: "---\ntitle: Rate limits\n---\nBottom line: 60 requests a minute on Free.\n" } as T;
    if (req.schema === COMPONENT_SCHEMA) return COMPONENT as T;
    if (JSON.stringify(req.schema).includes("commentary")) return { commentary: "Rate limits, explained.\n→ 60/min\nhttps://x" } as T;
    return { replacement: SOURCE + "\n## SSO\n\nTODO: explain SSO.\n", summary: "Answer the SSO question" } as T;
  },
});

beforeEach(async () => {
  requests = [];
  t = await setup({ ai: fakeAi });
  await t.call("/api/spaces", { method: "POST", token: t.ownerToken, json: { slug: "pub", name: "Pub", visibility: "public" } });
  const res = await t.call("/api/spaces/pub/pages", { method: "POST", token: t.ownerToken, json: { path: "limits", source: SOURCE } });
  ({ pageId } = (await res.json()) as { pageId: string });
  await t.call("/api/ai/key", { method: "PUT", token: t.ownerToken, json: { apiKey: "sk-ant-api03-test-key-0000000000wxyz" } });
});
afterEach(() => t.close());

const ask = (question: string, token?: string) => t.call(`/api/pages/${pageId}/ask`, { method: "POST", ...(token ? { token } : {}), json: { question, source: "linkedin" } });

describe("ask the page", () => {
  it("answers members with sanitized component HTML and links the section", async () => {
    const res = await ask("What happens over the limit?", t.ownerToken);
    const body = (await res.json()) as { html: string; covered: boolean; section: string };
    expect(res.status).toBe(200);
    expect(body.html).toContain("<strong>429</strong>");
    expect(body.html).toContain("elemnt-callout");
    expect(body.section).toBe("errors");
    expect(requests[0]!.prompt).toContain("errors: Errors");
    expect(requests[0]!.system).toContain("Answer only from the page");
  });

  it("is off for anonymous readers until an admin allows it, and is rate limited", async () => {
    expect((await ask("What is the limit?")).status).toBe(403);
    expect(await (await t.call("/s/pub/limits")).text()).toContain('"ask":false');
    await t.call("/api/settings/ask", { method: "PUT", token: t.ownerToken, json: { askPublic: true } });
    expect(await (await t.call("/s/pub/limits")).text()).toContain('"ask":true');
    for (let i = 0; i < 10; i++) expect((await ask("What is the limit?")).status).toBe(200);
    expect((await ask("What is the limit?")).status).toBe(429);
  });

  it("records gaps and turns questions into one suggestion", async () => {
    await ask("Do you support SSO?", t.ownerToken);
    await ask("What happens over the limit?", t.ownerToken);
    const qs = (await (await t.call(`/api/pages/${pageId}/questions`, { token: t.ownerToken })).json()) as { id: string; gap: boolean; source: string }[];
    expect(qs.map((q) => q.gap).sort()).toEqual([false, true]);
    expect(qs[0]!.source).toBe("linkedin");
    const gap = qs.find((q) => q.gap)!;
    const res = await t.call(`/api/pages/${pageId}/questions/suggest`, { method: "POST", token: t.ownerToken, json: { ids: [gap.id] } });
    expect(res.status).toBe(201);
    const { suggestionId } = (await res.json()) as { suggestionId: string };
    const { suggestion } = (await (await t.call(`/api/suggestions/${suggestionId}`, { token: t.ownerToken })).json()) as { suggestion: { origin: string; summary: string } };
    expect(suggestion).toMatchObject({ origin: "ask" });
    expect(suggestion.summary).toContain("1 reader question");
    expect(((await (await t.call(`/api/pages/${pageId}/questions`, { token: t.ownerToken })).json()) as unknown[]).length).toBe(1);
  });
});

describe("confusion heatmap", () => {
  it("aggregates section signals and questions per section and source", async () => {
    const beacon = (body: object) => t.call(`/api/pages/${pageId}/signals`, { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify(body) });
    expect((await beacon({ sections: { limits: 4000, errors: 9000 }, exit: "errors", source: "linkedin" })).status).toBe(204);
    expect((await beacon({ sections: { limits: 2000, errors: 500 }, exit: "limits" })).status).toBe(204);
    await ask("What happens over the limit?", t.ownerToken);
    const all = (await (await t.call(`/api/pages/${pageId}/insights`, { token: t.ownerToken })).json()) as { sections: { id: string; views: number; exits: number; questions: number; avgSeconds: number }[]; sources: string[] };
    expect(all.sources).toEqual(["direct", "linkedin"]);
    expect(all.sections.map((s) => [s.id, s.views, s.exits, s.questions])).toEqual([
      ["limits", 2, 1, 0],
      ["errors", 1, 1, 1],
    ]);
    const li = (await (await t.call(`/api/pages/${pageId}/insights?source=linkedin`, { token: t.ownerToken })).json()) as { sections: { id: string; avgSeconds: number }[] };
    expect(li.sections[1]).toMatchObject({ id: "errors", avgSeconds: 9 });
  });

  it("ignores junk section ids", async () => {
    await t.call(`/api/pages/${pageId}/signals`, { method: "POST", body: JSON.stringify({ sections: { "<script>": 5000 } }) });
    const res = (await (await t.call(`/api/pages/${pageId}/insights`, { token: t.ownerToken })).json()) as { sections: { views: number }[] };
    expect(res.sections.every((s) => s.views === 0)).toBe(true);
  });
});

describe("reading levels", () => {
  it("generates a level as pending, shows it to readers only once approved, and serves it to agents", async () => {
    const gen = await t.call(`/api/pages/${pageId}/levels/exec/generate`, { method: "POST", token: t.ownerToken });
    expect(gen.status).toBe(201);
    expect(await gen.json()).toMatchObject({ level: "exec", status: "pending", stale: false });
    expect(await (await t.call("/s/pub/limits?level=exec")).text()).not.toContain("Bottom line");

    await t.call(`/api/pages/${pageId}/levels/exec/approve`, { method: "POST", token: t.ownerToken });
    const page = await (await t.call("/s/pub/limits?level=exec")).text();
    expect(page).toContain("Bottom line");
    expect(page).toContain('aria-label="Reading level"');
    expect(await (await t.call("/s/pub/limits.md?level=exec")).text()).toContain("Bottom line");
    expect(await (await t.call("/s/pub/limits")).text()).toContain("Free plans get 60");
  });
});

describe("make me a component", () => {
  it("drafts a widget the editor can preview, then saves it to the library and the authoring guide", async () => {
    const draft = (await (await t.call("/api/components/generate", { method: "POST", token: t.ownerToken, json: { description: "seat cost slider" } })).json()) as { hash: string; snippet: string; findings: unknown[] };
    expect(draft.findings).toEqual([]);
    expect((await t.call(`${SANDBOX_URL}/w/${draft.hash}`)).status).toBe(200);
    expect(requests[0]!.system).toContain("No network access");

    expect((await t.call("/api/components", { method: "POST", token: t.ownerToken, json: COMPONENT })).status).toBe(201);
    const list = (await (await t.call("/api/components", { token: t.ownerToken })).json()) as { slug: string; snippet: string }[];
    expect(list.map((c) => c.slug)).toEqual(["seat-cost"]);

    // The snippet compiles back to a widget with the same code (backticks in the JS included).
    const compiled = createElemnt().compile(list[0]!.snippet);
    expect(compiled.ok).toBe(true);
    expect(compiled.widgets[0]!.code.js).toBe(COMPONENT.js);
    expect(compiled.widgets[0]!.hash).toBe(draft.hash);
  });

  it("refuses to save components that fail the scan", async () => {
    const res = await t.call("/api/components", { method: "POST", token: t.ownerToken, json: { ...COMPONENT, js: "WebAssembly.instantiate(x)" } });
    expect(res.status).toBe(422);
  });

  it("quotes summaries safely in the snippet", () => {
    const s = widgetSnippet({ ...COMPONENT, summary: 'Say "hi" and move on' });
    expect(createElemnt().compile(s).ok).toBe(true);
  });
});

describe("present mode and LinkedIn", () => {
  it("renders the page as slides and as a carousel to print", async () => {
    const deck = await (await t.call("/s/pub/limits?view=present")).text();
    expect(deck.match(/class="elemnt-slide"/g)).toHaveLength(3);
    expect(deck).toContain("mountDeck");
    const carousel = await (await t.call("/s/pub/limits?view=carousel")).text();
    expect(carousel).toContain("size:1080px 1350px");
  });

  it("drafts a LinkedIn post with Claude", async () => {
    const res = await t.call(`/api/pages/${pageId}/linkedin/draft`, { method: "POST", token: t.ownerToken });
    expect(await res.json()).toMatchObject({ commentary: expect.stringContaining("Rate limits") });
    expect(requests[0]!.prompt).toContain("utm_source=linkedin");
  });
});
