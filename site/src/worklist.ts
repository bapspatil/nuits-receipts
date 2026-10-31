// The sample To do list in the Undo scene. It behaves the way the app's lists
// do (src/worklist.ts in the app): a resolved row leaves, focus moves to the
// next open row, the banner says what happened and offers Undo. It saves
// nothing, and its keys only apply while focus is inside it, so j and k never
// steal a keystroke from the rest of the page.

const root = document.querySelector<HTMLElement>("[data-worklist]");
if (root) {
  const rows = [...root.querySelectorAll<HTMLLIElement>("[data-row]")];
  const count = root.querySelector<HTMLElement>("[data-count]")!;
  const done = root.querySelector<HTMLElement>("[data-done]")!;
  const text = root.querySelector<HTMLElement>("[data-banner-text]")!;
  const undo = root.querySelector<HTMLButtonElement>("[data-undo]")!;
  const log: HTMLLIElement[] = [];
  const motion = () => document.documentElement.dataset.motion !== "off";
  const seller = (row: HTMLLIElement) => row.querySelector(".wrow-seller")!.textContent!;
  const open = () => rows.filter((r) => !r.hidden && !r.classList.contains("is-leaving"));

  function sync() {
    const n = open().length;
    count.textContent = n ? `${n} to do` : "All done";
    done.hidden = n > 0;
  }

  function approve(row: HTMLLIElement) {
    if (row.hidden || row.classList.contains("is-leaving")) return;
    const next = open()[open().indexOf(row) + 1] ?? open()[open().indexOf(row) - 1];
    log.push(row);
    text.textContent = `Approved ${seller(row)}.`;
    undo.hidden = false;
    const leave = () => {
      row.classList.remove("is-leaving");
      row.hidden = true;
      sync();
    };
    if (motion()) {
      row.classList.add("is-leaving");
      row.addEventListener("transitionend", leave, { once: true });
      setTimeout(() => row.classList.contains("is-leaving") && leave(), 400);
    } else leave();
    (next?.querySelector("button") ?? undo).focus();
    sync();
  }

  function restore() {
    const row = log.pop();
    if (!row) return;
    row.hidden = false;
    text.textContent = `${seller(row)} is back in To do.`;
    undo.hidden = log.length === 0;
    if (motion()) {
      row.classList.add("is-back");
      row.addEventListener("animationend", () => row.classList.remove("is-back"), { once: true });
    }
    row.querySelector("button")!.focus();
    sync();
  }

  rows.forEach((row) => row.querySelector("button")!.addEventListener("click", () => approve(row)));
  undo.addEventListener("click", restore);

  root.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const list = open();
    const at = list.findIndex((r) => r.contains(document.activeElement));
    const move = (d: number) => list[Math.max(0, Math.min(list.length - 1, (at < 0 ? 0 : at + d)))]?.querySelector("button")?.focus();
    if (e.key === "j") move(1);
    else if (e.key === "k") move(-1);
    else if (e.key === "a" && at >= 0) approve(list[at]);
    else if (e.key === "u") restore();
    else return;
    e.preventDefault();
  });

  sync();
}
