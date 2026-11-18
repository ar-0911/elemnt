import { describe, expect, it } from "vitest";
import { createElemnt } from "../src/index.js";
import { parseArch } from "../src/components/architecture.js";

const elemnt = createElemnt();
const page = (body: string) => `---\ntitle: T\n---\n\n:::architecture{caption="Hub"}\n\`\`\`arch\n${body}\n\`\`\`\n:::\n`;
const SRC = `laptop dev "Engineer laptop"
zone aws "AWS · eu-west-1" region {
  zone vpc "Hub VPC · 10.40.0.0/16" vpc {
    lb nlb "Network LB" "UDP 51820"
    vpn hub "VPN hub"
  }
  db app "App database" "10.50.2.15"
}
dev => nlb "WireGuard"
nlb -> hub
hub <-> app "5432"
app --> dev`;

describe("architecture", () => {
  it("parses zones, services and links", () => {
    const { spec, problems } = parseArch(SRC);
    expect(problems).toEqual([]);
    expect(spec.items.map((i) => i.id)).toEqual(["dev", "aws"]);
    expect(spec.links.map((l) => [l.from, l.to, l.style, l.both])).toEqual([
      ["dev", "nlb", "tunnel", false],
      ["nlb", "hub", "solid", false],
      ["hub", "app", "solid", true],
      ["app", "dev", "dashed", false],
    ]);
  });

  it("reports mistakes with line numbers", () => {
    const { problems } = parseArch('server a "A"\nwidget b "B"\na -> c\nzone z "Z" vpc {');
    expect(problems.join("\n")).toMatch(/line 2: unknown kind "widget"/);
    expect(problems.join("\n")).toMatch(/line 3: link to "c"/);
    expect(problems.join("\n")).toMatch(/never closed/);
    expect(elemnt.parse(page('server a "A"\na -> nope')).diagnostics.map((d) => d.message).join()).toMatch(/link to "nope"/);
  });

  it("draws an SVG with zones, icons, wires and moving traffic", () => {
    const { html, diagnostics } = elemnt.compile(page(SRC));
    expect(diagnostics).toEqual([]);
    expect(html).toContain('class="elemnt-arch"');
    expect(html).toMatch(/<svg[^>]*class="ea-svg"/);
    expect(html).toContain("ea-z-vpc");
    expect(html).toContain("Hub VPC · 10.40.0.0/16");
    expect(html).toContain("<animateMotion");
    expect(html).toContain("ea-l-tunnel");
    expect(html).not.toContain("user-content");
  });

  it("gives agents a plain outline instead of a picture", () => {
    const { markdown } = elemnt.compile(page(SRC));
    expect(markdown).toContain("**Architecture: Hub**");
    expect(markdown).toContain("- AWS · eu-west-1 (region)");
    expect(markdown).toContain("    - Network LB: lb, UDP 51820");
    expect(markdown).toContain("- Engineer laptop → Network LB: WireGuard (tunnel)");
    expect(markdown).toContain("- VPN hub ↔ App database: 5432");
  });
});
