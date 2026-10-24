// The native controls stay until the components have registered, so a chunk
// that fails to load leaves the reader a working player with nothing to undo.
export async function upgradePlayer(video: HTMLVideoElement) {
  await import("media-chrome");
  video.removeAttribute("controls");
}
