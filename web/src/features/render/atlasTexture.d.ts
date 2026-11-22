// The WebGPU tracer's texture atlas class. three-gpu-pathtracer does not export it from its entry, so
// atlasUpload.ts and gpuEngine.ts import it by path; only the blit method they wrap is declared here.
declare module "three-gpu-pathtracer/src/webgpu/AtlasTexture.js" {
  export class AtlasTexture {
    protected _renderTextures(renderer: unknown, textures: unknown[], placements: unknown): void;
  }
}
