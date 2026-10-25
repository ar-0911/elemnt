import { describe, expect, it } from "vitest";
import { parseRoute } from "../src/router";

describe("parseRoute", () => {
  it("reads space and nested page paths", () => {
    expect(parseRoute("/app/docs/guides/setup")).toEqual({ space: "docs", path: "guides/setup" });
    expect(parseRoute("/app/docs/")).toEqual({ space: "docs", path: undefined });
    expect(parseRoute("/app")).toEqual({ space: undefined, path: undefined });
  });
});
