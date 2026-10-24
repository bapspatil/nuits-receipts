import "./nav";

type Motion = "on" | "off";

const root = document.documentElement;
const wide = matchMedia("(min-width: 64rem)");
let motion: Motion = root.dataset.motion === "off" ? "off" : "on";
let field: { setAnimated(on: boolean): void } | null = null;
let stopReel: (() => void) | null = null;
let layer: { setAnimated(on: boolean): void } | null = null;

// The reel only runs on wide screens with motion on. Narrow screens and
// motion-off readers get the static page, which is the designed end state of
// every scene, so there is nothing to undo on the way out.
async function syncReel() {
  const want = motion === "on" && wide.matches;
  if (want && !stopReel) {
    const { startReel } = await import("./reel");
    if (motion === "on" && wide.matches && !stopReel) stopReel = startReel();
  } else if (!want && stopReel) {
    stopReel();
    stopReel = null;
  }
}

function setMotion(next: Motion, remember: boolean) {
  motion = next;
  root.dataset.motion = next;
  if (remember) {
    try {
      localStorage.setItem("motion", next);
    } catch {}
  }
  const button = document.querySelector<HTMLButtonElement>(".motion-switch")!;
  button.setAttribute("aria-pressed", String(next === "on"));
  button.querySelector(".motion-state")!.textContent = next;
  field?.setAnimated(next === "on");
  layer?.setAnimated(next === "on");
  void syncReel();
}

const button = document.querySelector<HTMLButtonElement>(".motion-switch")!;
button.hidden = false;
button.addEventListener("click", () => setMotion(motion === "on" ? "off" : "on", true));
wide.addEventListener("change", () => void syncReel());
setMotion(motion, false);

const canvas = document.querySelector<HTMLCanvasElement>(".field");
if (canvas && "gpu" in navigator) {
  import("./field")
    .then(({ startField }) => startField(canvas, motion === "on"))
    .then((f) => (field = f))
    .catch(() => {});
}

// The second motion layer (src/motion.ts) waits for load and an idle moment,
// so it never competes with the hero for the first paint.
function startLayer() {
  const idle = (f: () => void) =>
    window.requestIdleCallback ? requestIdleCallback(f, { timeout: 1500 }) : setTimeout(f, 200);
  idle(() => {
    import("./motion")
      .then(({ startMotion }) => (layer = startMotion(motion === "on")))
      .catch(() => {});
  });
}
if (document.readyState === "complete") startLayer();
else addEventListener("load", startLayer, { once: true });

// The demo player upgrades from the native controls to Media Chrome when the
// section is within a screen of view, or at once when the page opens on it.
const demoVideo = document.querySelector<HTMLVideoElement>("#demo video");
if (demoVideo) {
  const upgrade = () => void import("./player").then(({ upgradePlayer }) => upgradePlayer(demoVideo)).catch(() => {});
  if (location.hash === "#demo") upgrade();
  else {
    const watch = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        watch.disconnect();
        upgrade();
      },
      { rootMargin: "100% 0px" },
    );
    watch.observe(document.getElementById("demo")!);
  }
}
