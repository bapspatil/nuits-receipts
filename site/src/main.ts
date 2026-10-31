import "./nav";
import "./worklist";

type Motion = "on" | "off";

const root = document.documentElement;
const wide = matchMedia("(min-width: 64rem)");
let motion: Motion = root.dataset.motion === "off" ? "off" : "on";
let stopReel: (() => void) | null = null;
let layer: { setAnimated(on: boolean): void } | null = null;

// The reel runs whenever motion is on, in a wide or a narrow cut that is
// rebuilt when the width crosses 64rem. Motion-off readers get the static
// page, which is the designed end state of every scene, so there is nothing
// to undo on the way out.
let reelWide: boolean | null = null;
async function syncReel() {
  const want = motion === "on";
  if (stopReel && (!want || reelWide !== wide.matches)) {
    stopReel();
    stopReel = null;
  }
  if (want && !stopReel) {
    const { startReel } = await import("./reel");
    if (motion === "on" && !stopReel) {
      reelWide = wide.matches;
      stopReel = startReel(!reelWide);
    }
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
  layer?.setAnimated(next === "on");
  void syncReel();
}

const button = document.querySelector<HTMLButtonElement>(".motion-switch")!;
button.hidden = false;
button.addEventListener("click", () => setMotion(motion === "on" ? "off" : "on", true));
wide.addEventListener("change", () => void syncReel());
setMotion(motion, false);

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

// Each player (the demo and the install clip) upgrades from the native
// controls to Media Chrome when it is within a screen of view, or at once when
// the page opens on the demo.
for (const video of document.querySelectorAll<HTMLVideoElement>(".demo-player video")) {
  const upgrade = () => void import("./player").then(({ upgradePlayer }) => upgradePlayer(video)).catch(() => {});
  if (location.hash === "#demo" && video.closest("#demo")) upgrade();
  else {
    const watch = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        watch.disconnect();
        upgrade();
      },
      { rootMargin: "100% 0px" },
    );
    watch.observe(video);
  }
}
