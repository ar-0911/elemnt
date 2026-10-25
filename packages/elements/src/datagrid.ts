import { claim, make } from "./theme.js";

const num = (v: string) => (v.trim() !== "" && Number.isFinite(Number(v.replace(/,/g, ""))) ? Number(v.replace(/,/g, "")) : NaN);

/** Click a header to sort; type to filter rows. */
export function enhanceDatagrid(root: ParentNode): void {
  for (const el of root.querySelectorAll<HTMLElement>("elemnt-datagrid")) {
    const table = el.querySelector("table");
    const body = table?.querySelector("tbody");
    if (!table || !body || !claim(el)) continue;
    const rows = [...body.querySelectorAll<HTMLTableRowElement>(":scope > tr")];
    const filter = make("input", { type: "search", className: "elemnt-datagrid-filter", placeholder: `Filter ${rows.length} rows` });
    filter.setAttribute("aria-label", "Filter rows");
    filter.oninput = () => {
      const q = filter.value.trim().toLowerCase();
      for (const r of rows) r.hidden = Boolean(q) && !(r.textContent ?? "").toLowerCase().includes(q);
    };
    el.prepend(filter);

    const heads = [...table.querySelectorAll<HTMLTableCellElement>("thead th")];
    heads.forEach((th, col) => {
      th.dataset.sort = "none";
      th.tabIndex = 0;
      const sort = () => {
        const dir = th.dataset.sort === "asc" ? "desc" : "asc";
        heads.forEach((h) => (h.dataset.sort = "none"));
        th.dataset.sort = dir;
        const key = (r: HTMLTableRowElement) => r.children[col]?.textContent ?? "";
        const numeric = rows.every((r) => !Number.isNaN(num(key(r))) || key(r).trim() === "");
        rows.sort((a, b) => {
          const c = numeric ? (num(key(a)) || 0) - (num(key(b)) || 0) : key(a).localeCompare(key(b), undefined, { numeric: true });
          return dir === "asc" ? c : -c;
        });
        body.append(...rows);
      };
      th.onclick = sort;
      th.onkeydown = (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), sort());
    });
  }
}
