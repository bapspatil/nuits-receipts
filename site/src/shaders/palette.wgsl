// Generated from tokens.json by generate-tokens.mjs. Do not edit by hand.
// Change the source and run the generator again.


const INK       = vec3f(0.05098, 0.22745, 0.21176); // #0D3A36
const INK_SOFT  = vec3f(0.20784, 0.33725, 0.31373); // #355650
const PAPER     = vec3f(0.90196, 0.93725, 0.91373); // #E6EFE9
const SLIP      = vec3f(1.00000, 1.00000, 1.00000); // #FFFFFF
const GUILLOCHE = vec3f(0.76078, 0.84706, 0.79608); // #C2D8CB
const MINT      = vec3f(0.62353, 0.82745, 0.73725); // #9FD3BC
const STAMP     = vec3f(0.65882, 0.07059, 0.24706); // #A8123F
const ON_STAMP  = vec3f(1.00000, 1.00000, 1.00000); // #FFFFFF

// Pick a palette entry by index. Clamped, so an out-of-range
// band index yields an end colour rather than black.
fn paletteAt(i: f32) -> vec3f {
  let k = clamp(i, 0.0, 7.0);
  if k < 0.5 { return INK; }
  if k < 1.5 { return INK_SOFT; }
  if k < 2.5 { return PAPER; }
  if k < 3.5 { return SLIP; }
  if k < 4.5 { return GUILLOCHE; }
  if k < 5.5 { return MINT; }
  if k < 6.5 { return STAMP; }
  return ON_STAMP;
}
