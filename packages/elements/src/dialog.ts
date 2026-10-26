import { make } from "./theme.js";

/** "You're leaving for example.com": shown before any link a widget asks to open. */
export function confirmLeave(url: URL): Promise<boolean> {
  return new Promise((resolve) => {
    const dialog = make("dialog", { className: "elemnt-leave" });
    const go = make("button", { type: "button", className: "elemnt-run-btn", textContent: "Continue" });
    const stay = make("button", { type: "button", textContent: "Stay here" });
    dialog.append(
      make("p", {}, make("strong", { textContent: "You're leaving for " }), make("code", { textContent: url.hostname })),
      make("p", { className: "elemnt-leave-url", textContent: url.href }),
      make("p", { textContent: "This link comes from an interactive widget on this page, not from Elemnt. Only continue if you trust it." }),
      make("p", {}, go, " ", stay),
    );
    const done = (ok: boolean) => {
      dialog.close();
      dialog.remove();
      resolve(ok);
    };
    go.onclick = () => done(true);
    stay.onclick = () => done(false);
    dialog.oncancel = () => done(false);
    document.body.append(dialog);
    dialog.showModal();
    stay.focus();
  });
}
