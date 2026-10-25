import type { AnyComponent } from "../types.js";
import { callout } from "./callout.js";
import { details } from "./details.js";
import { diagram } from "./diagram.js";
import { steps } from "./steps.js";
import { tab, tabs } from "./tabs.js";

export { callout, details, diagram, steps, tab, tabs };

export const builtinComponents: readonly AnyComponent[] = [callout, tabs, tab, steps, details, diagram];
