// How the WebGPU tracer's texture atlas takes its textures. three-gpu-pathtracer draws each scene
// texture into the atlas through a textured quad, uploading it with the texture's flipY. For an
// ImageBitmap, WebGL keeps the rows as they are (Chromium ignores flipY for them; probed), while
// WebGPU honours flipY. So a texture the 3D view and Realistic read the right way up was read upside
// down by the WebGPU tracer. The blit uploads ImageBitmap textures with flipY off, which gives the
// WebGPU tracer the rows the WebGL side reads. Other sources keep their flipY.

/** The part of a texture the atlas blit reads and sets. */
export interface AtlasTextureLike {
  flipY: boolean;
  readonly image: unknown;
}

/** The atlas's blit: (renderer, textures, placements), as three-gpu-pathtracer's AtlasTexture._renderTextures takes them. */
export type AtlasBlit = (this: unknown, renderer: unknown, textures: AtlasTextureLike[], placements: unknown) => void;

/** Whether an image is an ImageBitmap (the 3D view's, the library's and the cloud job's textures all are). */
export function isBitmapImage(image: unknown): boolean {
  return typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap;
}

/** The flipY a texture is uploaded with into the WebGPU atlas: off for an ImageBitmap, else its own. */
export function atlasFlipY(texture: { flipY: boolean; image: unknown }): boolean {
  return isBitmapImage(texture.image) ? false : texture.flipY;
}

/**
 * The blit `blit`, with each texture's flipY set to its atlas flipY for the call and put back after,
 * also when the blit throws. The textures are the drawing's own, so the 3D view and Realistic keep them as they are.
 */
export function uprightAtlasBlit(blit: AtlasBlit): AtlasBlit {
  return function (this: unknown, renderer, textures, placements) {
    const saved = textures.map((t) => t.flipY);
    textures.forEach((t) => {
      t.flipY = atlasFlipY(t);
    });
    try {
      blit.call(this, renderer, textures, placements);
    } finally {
      textures.forEach((t, i) => {
        t.flipY = saved[i];
      });
    }
  };
}
