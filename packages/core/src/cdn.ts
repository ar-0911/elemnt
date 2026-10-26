/**
 * Where readers' browsers load Mermaid from. The page CSP allows exactly this
 * package folder, not all of jsDelivr, which would serve any npm or GitHub
 * file as script.
 */
export const MERMAID_BASE = "https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/";
