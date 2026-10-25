/**
 * A small, safe arithmetic language for `:::explore`: numbers, variables,
 * + - * / % ^, parentheses and a few math functions. No property access, no
 * calls into JavaScript, so page authors can't run code through it.
 */

export class ExprError extends Error {}

type Node =
  | { k: "num"; v: number }
  | { k: "var"; name: string }
  | { k: "neg"; a: Node }
  | { k: "bin"; op: "+" | "-" | "*" | "/" | "%" | "^"; a: Node; b: Node }
  | { k: "call"; fn: string; args: Node[] };

const FUNCS: Record<string, (...xs: number[]) => number> = {
  min: Math.min,
  max: Math.max,
  abs: Math.abs,
  round: (x, d = 0) => Math.round(x * 10 ** d) / 10 ** d,
  floor: Math.floor,
  ceil: Math.ceil,
  sqrt: Math.sqrt,
  log: Math.log,
  log10: Math.log10,
  log2: Math.log2,
  exp: Math.exp,
  pow: Math.pow,
  clamp: (x, lo, hi) => Math.min(hi, Math.max(lo, x)),
};

const MAX_LENGTH = 500;

function tokenize(src: string): string[] {
  if (src.length > MAX_LENGTH) throw new ExprError("Expression is too long");
  const tokens: string[] = [];
  const re = /\s*(?:(\d+(?:\.\d+)?(?:e[+-]?\d+)?|\.\d+)|([A-Za-z_][A-Za-z0-9_]*)|([-+*/%^(),]))/gy;
  let m: RegExpExecArray | null;
  while (re.lastIndex < src.length) {
    const start = re.lastIndex;
    m = re.exec(src);
    if (!m) {
      if (/^\s*$/.test(src.slice(start))) break;
      throw new ExprError(`Unexpected "${src.slice(start).trim()[0]}"`);
    }
    tokens.push(m[1] ?? m[2] ?? m[3]!);
  }
  return tokens;
}

export function parseExpr(src: string): Node {
  const t = tokenize(src);
  let i = 0;
  const peek = () => t[i];
  const take = (s?: string) => {
    const tok = t[i];
    if (tok === undefined || (s !== undefined && tok !== s)) throw new ExprError(s ? `Expected "${s}"` : "Unexpected end of expression");
    i++;
    return tok;
  };
  const add = (): Node => {
    let a = mul();
    while (peek() === "+" || peek() === "-") a = { k: "bin", op: take() as "+" | "-", a, b: mul() };
    return a;
  };
  const mul = (): Node => {
    let a = unary();
    while (peek() === "*" || peek() === "/" || peek() === "%") a = { k: "bin", op: take() as "*" | "/" | "%", a, b: unary() };
    return a;
  };
  const unary = (): Node => (peek() === "-" ? (take(), { k: "neg", a: unary() }) : peek() === "+" ? (take(), unary()) : pow());
  const pow = (): Node => {
    const a = atom();
    return peek() === "^" ? (take(), { k: "bin", op: "^", a, b: unary() }) : a;
  };
  const atom = (): Node => {
    const tok = take();
    if (tok === "(") {
      const e = add();
      take(")");
      return e;
    }
    if (/^[\d.]/.test(tok)) return { k: "num", v: Number(tok) };
    if (/^[A-Za-z_]/.test(tok)) {
      if (peek() !== "(") return { k: "var", name: tok };
      if (!(tok in FUNCS)) throw new ExprError(`Unknown function ${tok}()`);
      take("(");
      const args: Node[] = [];
      if (peek() !== ")") {
        args.push(add());
        while (peek() === ",") (take(), args.push(add()));
      }
      take(")");
      return { k: "call", fn: tok, args };
    }
    throw new ExprError(`Unexpected "${tok}"`);
  };
  const tree = add();
  if (i < t.length) throw new ExprError(`Unexpected "${t[i]}"`);
  return tree;
}

/** Variable names an expression reads. */
export function exprVariables(src: string): string[] {
  const out = new Set<string>();
  const walk = (n: Node): void => {
    if (n.k === "var") out.add(n.name);
    else if (n.k === "neg") walk(n.a);
    else if (n.k === "bin") (walk(n.a), walk(n.b));
    else if (n.k === "call") n.args.forEach(walk);
  };
  walk(parseExpr(src));
  return [...out];
}

export function evaluate(src: string | Node, vars: Record<string, number>): number {
  const n = typeof src === "string" ? parseExpr(src) : src;
  switch (n.k) {
    case "num":
      return n.v;
    case "var":
      if (!(n.name in vars)) throw new ExprError(`Unknown variable "${n.name}"`);
      return vars[n.name]!;
    case "neg":
      return -evaluate(n.a, vars);
    case "call":
      return FUNCS[n.fn]!(...n.args.map((a) => evaluate(a, vars)));
    case "bin": {
      const a = evaluate(n.a, vars);
      const b = evaluate(n.b, vars);
      return n.op === "+" ? a + b : n.op === "-" ? a - b : n.op === "*" ? a * b : n.op === "/" ? a / b : n.op === "%" ? a % b : a ** b;
    }
  }
}

/** Formats a result for prose: fixed digits, thousands separators, no "-0". */
export function formatNumber(x: number, digits = 0): string {
  if (!Number.isFinite(x)) return "∞";
  const v = Number(x.toFixed(digits));
  return (Object.is(v, -0) ? 0 : v).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
