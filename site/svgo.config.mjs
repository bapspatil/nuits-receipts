// svgo for src/assets/svg: optimise the numbers, keep everything the motion
// code targets (classes, pathLength, aria-hidden, focusable) and keep each
// path separate so draw-on staggers stay per stroke.
export default {
  multipass: true,
  floatPrecision: 1,
  plugins: [
    {
      name: "preset-default",
      params: { overrides: { mergePaths: false, convertShapeToPath: false, removeUnknownsAndDefaults: false } },
    },
  ],
};
