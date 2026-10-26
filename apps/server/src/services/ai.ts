import Anthropic from "@anthropic-ai/sdk";
import { HttpError } from "./errors.js";

export const AI_MODEL = "claude-opus-5-5";

export type Effort = "low" | "medium" | "high";

export interface AiRequest {
  /** Stable instructions; cached, so keep per-request details out of it. */
  system: string;
  prompt: string;
  /** JSON schema the reply must match. */
  schema: Record<string, unknown>;
  effort?: Effort;
  maxTokens?: number;
}

/** One workspace's connection to Claude. Tests swap in a fake. */
export interface AiClient {
  json<T>(req: AiRequest): Promise<T>;
}

export type AiProvider = (apiKey: string) => AiClient;

/** Calls Claude with the workspace's own key, streaming so long pages never hit request timeouts. */
export const anthropicProvider: AiProvider = (apiKey) => {
  const client = new Anthropic({ apiKey });
  return {
    async json<T>(req: AiRequest): Promise<T> {
      let message: Anthropic.Beta.BetaMessage;
      try {
        message = await client.beta.messages
          .stream({
            model: AI_MODEL,
            max_tokens: req.maxTokens ?? 32000,
            // On a safety decline, retry on Anthropic's recommended fallback model instead of failing.
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
            output_config: { effort: req.effort ?? "medium", format: { type: "json_schema", schema: req.schema } },
            system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
            messages: [{ role: "user", content: req.prompt }],
          })
          .finalMessage();
      } catch (err) {
        if (err instanceof Anthropic.AuthenticationError) throw new HttpError(400, "The workspace's Anthropic API key was rejected. An admin can replace it in Settings.");
        if (err instanceof Anthropic.RateLimitError) throw new HttpError(429, "Claude is rate limiting this workspace's key. Try again in a minute.");
        if (err instanceof Anthropic.APIError) throw new HttpError(502, `Claude returned an error (${err.status ?? "network"}).`);
        throw err;
      }
      if (message.stop_reason === "refusal") throw new HttpError(422, "Claude declined this request.");
      if (message.stop_reason === "max_tokens") throw new HttpError(422, "The answer was too long. Try a smaller selection.");
      const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      return JSON.parse(text) as T;
    },
  };
};

/** System prompt for edits: the authoring guide plus how to behave. */
export function editorSystemPrompt(authoringGuide: string): string {
  return `You edit pages in Elemnt, a documentation tool. Pages are Markdown with directives for rich components. People read the rendered page; agents read a Markdown projection. Both come from the source you write.

Write clear, specific, explanatory docs. Prefer short paragraphs, concrete examples and the components below where they genuinely help the reader (a callout for a real warning, tabs for alternatives, steps for a procedure). Keep the author's voice, facts and structure unless asked to change them. Never invent product facts, commands, URLs or numbers; if something is unknown, leave a clearly marked TODO.

Keep the page's \`style:\` frontmatter unless asked to change it. When asked to make a page more engaging or visual, reach for :::hero, ::::cards, :::stats, ::::timeline, :::graphic (inline SVG using var(--accent)) and :::band, but every flourish must carry information and the page must stay easy to scan.

Every component you use must be valid per this guide:

${authoringGuide}`;
}

export const EDIT_SCHEMA = {
  type: "object",
  properties: {
    replacement: { type: "string", description: "The new text for the selected region, or the whole page source when nothing was selected." },
    summary: { type: "string", description: "One sentence describing the change, for the reviewer." },
  },
  required: ["replacement", "summary"],
  additionalProperties: false,
} as const;

export function assistPrompt(input: { source: string; instruction: string; selection?: { from: number; to: number } }): string {
  if (!input.selection) {
    return `Here is the full page source:\n\n<page>\n${input.source}\n</page>\n\nInstruction: ${input.instruction}\n\nReturn the complete revised page source as "replacement".`;
  }
  const { from, to } = input.selection;
  const marked = `${input.source.slice(0, from)}<<<SELECTION>>>${input.source.slice(from, to)}<<<END SELECTION>>>${input.source.slice(to)}`;
  return `Here is the full page source. The part to change sits between <<<SELECTION>>> and <<<END SELECTION>>>:\n\n<page>\n${marked}\n</page>\n\nInstruction: ${input.instruction}\n\nReturn only the new text for the selected part as "replacement", without the markers. It must fit back into the surrounding source.`;
}
