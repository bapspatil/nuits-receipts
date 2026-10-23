import palette from "./shaders/palette.wgsl?raw";
import guilloche from "./shaders/guilloche.wgsl?raw";

export type Field = {
  setAnimated(on: boolean): void;
};

const SOFTWARE = /llvmpipe|lavapipe|swiftshader|software|cpu/i;

// Resolves to null whenever the field should not run. The canvas then never
// gets data-ready and the hero keeps its pre-rendered fallback image.
export async function startField(canvas: HTMLCanvasElement, animated: boolean): Promise<Field | null> {
  const adapter = await navigator.gpu?.requestAdapter({ powerPreference: "low-power" });
  if (!adapter) return null;
  const info = adapter.info;
  const forced = new URLSearchParams(location.search).has("fx-force");
  // A software rasteriser makes a page that works and stutters, which is worse
  // than the static image. Blank info strings are Chrome privacy, not software.
  if (!forced && SOFTWARE.test(`${info.architecture} ${info.description} ${info.vendor}`)) return null;

  const device = await adapter.requestDevice();
  const context = canvas.getContext("webgpu");
  if (!context) return null;
  // Never an -srgb format: the shader writes token hexes and they must land in
  // the framebuffer byte for byte, matching the CSS paper beside the canvas.
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: "opaque" });

  const module = device.createShaderModule({ code: palette + guilloche });
  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module, entryPoint: "vs" },
    fragment: { module, entryPoint: "fs", targets: [{ format }] },
  });
  const uniforms = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniforms } }],
  });

  const hero = canvas.parentElement!;
  const wide = matchMedia("(min-width: 64rem)");
  let phase = 0;
  let queued = false;

  function draw() {
    queued = false;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.round(canvas.clientWidth * dpr);
    const height = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    device.queue.writeBuffer(uniforms, 0, new Float32Array([width, height, phase, dpr, wide.matches ? 1 : 0]));
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        { view: context!.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 1] },
      ],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
    device.queue.submit([encoder.finish()]);
    canvas.dataset.ready = "";
  }

  function queue() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(draw);
  }

  function onScroll() {
    const rect = hero.getBoundingClientRect();
    if (rect.bottom < 0) return;
    phase = Math.min(1, Math.max(0, -rect.top / rect.height));
    queue();
  }

  let animatedNow = false;
  function setAnimated(on: boolean) {
    if (on === animatedNow) return;
    animatedNow = on;
    if (on) {
      addEventListener("scroll", onScroll, { passive: true });
      onScroll();
    } else {
      removeEventListener("scroll", onScroll);
      phase = 0;
      queue();
    }
  }

  device.lost.then(() => {
    delete canvas.dataset.ready;
    removeEventListener("scroll", onScroll);
  });
  new ResizeObserver(queue).observe(canvas);
  setAnimated(animated);
  queue();
  return { setAnimated };
}
