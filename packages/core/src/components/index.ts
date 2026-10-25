import type { AnyComponent } from "../types.js";
import { callout } from "./callout.js";
import { details } from "./details.js";
import { diagram } from "./diagram.js";
import { query } from "./query.js";
import { runbook, step } from "./runbook.js";
import { steps } from "./steps.js";
import { tab, tabs } from "./tabs.js";
import { annotate } from "./annotate.js";
import { chart } from "./chart.js";
import { codegroup } from "./codegroup.js";
import { compare, side } from "./compare.js";
import { datagrid } from "./datagrid.js";
import { calc, explore, variable } from "./explore.js";
import { quiz } from "./quiz.js";
import { term } from "./term.js";
import { widget } from "./widget.js";
import { badge, band, card, cards, event, hero, quote, stat, stats, timeline } from "./layout.js";
import { graphic } from "./graphic.js";

export { badge, band, card, cards, event, graphic, hero, quote, stat, stats, timeline };
export { annotate, calc, callout, chart, codegroup, compare, datagrid, details, diagram, explore, query, quiz, runbook, side, step, steps, tab, tabs, term, variable, widget };
export { widgetCode, widgetHash, type WidgetCode } from "./widget.js";
export { cleanSvg, SVG_ATTRIBUTES, SVG_TAGS } from "./graphic.js";

export const builtinComponents: readonly AnyComponent[] = [
  callout,
  tabs,
  tab,
  codegroup,
  steps,
  details,
  diagram,
  chart,
  datagrid,
  explore,
  variable,
  calc,
  annotate,
  quiz,
  compare,
  side,
  term,
  widget,
  runbook,
  step,
  query,
  hero,
  cards,
  card,
  stats,
  stat,
  timeline,
  event,
  band,
  badge,
  quote,
  graphic,
];
