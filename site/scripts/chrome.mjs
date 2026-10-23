import { chromium } from "playwright-core";

export const CHROME = process.env.CHROME ?? "/usr/bin/google-chrome";

// SwiftShader WebGPU, so headless Chrome can render the field. The page itself
// refuses software adapters; `?fx-force` is how the tooling opts back in.
// `extra` adds flags, e.g. --disable-webgl for the no-WebGL fallback run.
export const launch = (gpu = false, extra = []) =>
  chromium.launch({
    executablePath: CHROME,
    args: [
      ...extra,
      ...(gpu
      ? [
          "--enable-unsafe-webgpu",
          "--enable-unsafe-swiftshader",
          "--use-webgpu-adapter=swiftshader",
          // Without Vulkan on SwiftShader the canvas renders but never reaches
          // a screenshot, which reads as a field that drew nothing.
          "--enable-features=Vulkan",
          "--use-vulkan=swiftshader",
          "--use-angle=swiftshader",
        ]
      : []),
    ],
  });

export const BASE = process.env.SITE_URL ?? "http://localhost:4321/";
