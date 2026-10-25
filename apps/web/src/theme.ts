import { contentCss, themeTokensCss } from "@elemnt/core";

/** The same tokens and component styles the reader uses, so the preview matches the published page. */
const style = document.createElement("style");
style.textContent = themeTokensCss + contentCss;
document.head.prepend(style);
