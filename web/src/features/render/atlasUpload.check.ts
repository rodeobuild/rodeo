// Checks the WebGPU atlas upload under Node: which flipY an atlas texture is uploaded with, and that
// the blit wrapper sets and restores it. Run from web/:
//   npx tsx src/features/render/atlasUpload.check.ts
// Synthetic textures only (a stand-in ImageBitmap class); the blit is a recording function, so no
// GPU runs and no file is read or written.

import { atlasFlipY, isBitmapImage, uprightAtlasBlit, type AtlasTextureLike } from "./atlasUpload.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`);
}

// a stand-in for the browser's ImageBitmap, so instanceof works under Node
class FakeBitmap {}
(globalThis as unknown as { ImageBitmap: unknown }).ImageBitmap = FakeBitmap;

console.log("atlasFlipY");
check(isBitmapImage(new FakeBitmap()), "an ImageBitmap is a bitmap image");
check(!isBitmapImage({}), "a plain object (an HTML image, say) is not");
check(!isBitmapImage(null), "no image is not");
check(atlasFlipY({ flipY: true, image: new FakeBitmap() }) === false, "an ImageBitmap with flipY on uploads with flipY off");
check(atlasFlipY({ flipY: false, image: new FakeBitmap() }) === false, "an ImageBitmap with flipY off stays off");
check(atlasFlipY({ flipY: true, image: {} }) === true, "another image keeps flipY on");
check(atlasFlipY({ flipY: false, image: {} }) === false, "another image keeps flipY off");

console.log("uprightAtlasBlit");
{
  const seen: boolean[] = [];
  let receiver: unknown = null;
  const blit = uprightAtlasBlit(function (this: unknown, _r, textures) {
    receiver = this;
    seen.push(...textures.map((t) => t.flipY));
  });
  const bitmap: AtlasTextureLike = { flipY: true, image: new FakeBitmap() };
  const html: AtlasTextureLike = { flipY: true, image: {} };
  const owner = { name: "atlas" };
  blit.call(owner, null, [bitmap, html], null);
  check(seen[0] === false && seen[1] === true, "during the blit the bitmap is off and the other image stays on");
  check(bitmap.flipY === true && html.flipY === true, "after the blit both keep their flipY");
  check(receiver === owner, "the blit runs with the atlas as its receiver");
}
{
  const bitmap: AtlasTextureLike = { flipY: true, image: new FakeBitmap() };
  const blit = uprightAtlasBlit(function () {
    throw new Error("blit failed");
  });
  let threw = false;
  try {
    blit.call({}, null, [bitmap], null);
  } catch {
    threw = true;
  }
  check(threw, "a failing blit still throws");
  check(bitmap.flipY === true, "a failing blit puts flipY back");
}

console.log(failures === 0 ? "all checks ok" : `${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
