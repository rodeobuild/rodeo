// The render layers (layers.ts) drawn: the render scene through the picture's camera, each layer a
// frame of its own on the picture's renderer, after the picture is read, so they line up with it
// pixel for pixel whichever engine drew the picture. Material and object colours are flat blocks
// drawn once, unblended, so each block is one exact colour to select; the other layers average
// jittered frames as the Realistic engine's stills do, so their edges are smooth like the picture's.
// Shadows look up the lights' shadow maps (as the Realistic engine draws them); ambient occlusion,
// depth, normals, lines and the sky mask read the Realistic engine's G-buffer; base colour is each
// material's colour and texture unlit. Glass is a surface here, as the G-buffer has it.

import * as THREE from "three";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";
import { EDGE_GLSL, OUTLINE_HEIGHT, depthNoise, edgeFar } from "./finish.ts";
import { GBufferPass } from "./gbuffer.ts";
import type { LayerId } from "./layers.ts";
import { halton, jitter } from "./raster.ts";
import { shadowsFaceLights, type RenderScene } from "./sceneBuilder.ts";

/** Jittered frames a smooth layer averages: its edges then step in eighths, as finely as the eye needs. */
const SMOOTH_SAMPLES = 8;
/**
 * How far, in metres, ambient occlusion looks for what shades a point, and the power it is raised to:
 * twice the Fast engine's reach, squared, so the layer shows corners and contact shadows plainly, to be
 * turned down over the picture as wanted.
 */
const AO_RADIUS = 1;
const AO_POWER = 2;
/** Rows of a layer read off the GPU at a time. */
const STRIP = 256;
/** Layers drawn once, as exact colours: an edge between two blocks is one or the other. */
const CRISP: ReadonlySet<LayerId> = new Set<LayerId>(["material", "object"]);

const SCREEN_VERTEX = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** The cut-out test of a plant's picture, as the render material keeps it: the mask's green over the test. */
const CUTOUT_PARS = /* glsl */ `
uniform sampler2D uAlphaMap;
uniform float uAlphaTest;
varying vec2 vAlphaUv;
`;
const CUTOUT = /* glsl */ `
  if (uAlphaTest > 0.0 && texture2D(uAlphaMap, vAlphaUv).g < uAlphaTest) discard;
`;

const FLAT_VERTEX = /* glsl */ `
uniform mat3 uAlphaTransform;
uniform vec3 uColor;
#ifdef USE_ID
attribute vec3 idColor;
#endif
varying vec3 vColor;
varying vec2 vAlphaUv;

void main() {
  vAlphaUv = (uAlphaTransform * vec3(uv, 1.0)).xy;
#ifdef USE_ID
  vColor = idColor;
#else
  vColor = uColor;
#endif
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FLAT_FRAGMENT = /* glsl */ `
${CUTOUT_PARS}
varying vec3 vColor;

void main() {
${CUTOUT}
  // written as it is: no colour space, so the bytes read back are the block's own
  gl_FragColor = vec4(vColor, 1.0);
}
`;

const ALBEDO_VERTEX = /* glsl */ `
uniform mat3 uMapTransform;
uniform mat3 uAlphaTransform;
varying vec2 vMapUv;
varying vec2 vAlphaUv;

void main() {
  vMapUv = (uMapTransform * vec3(uv, 1.0)).xy;
  vAlphaUv = (uAlphaTransform * vec3(uv, 1.0)).xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const ALBEDO_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform sampler2D uMap;
uniform float uUseMap;
varying vec2 vMapUv;
${CUTOUT_PARS}

vec3 toSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

void main() {
${CUTOUT}
  // the colour (linear) times the texture, which the GPU reads linear from sRGB
  vec3 c = uColor;
  if (uUseMap > 0.5) c *= texture2D(uMap, vMapUv).rgb;
  gl_FragColor = vec4(toSrgb(clamp(c, 0.0, 1.0)), 1.0);
}
`;

const SHADOW_VERTEX = /* glsl */ `
#include <common>
#include <shadowmap_pars_vertex>
uniform mat3 uAlphaTransform;
varying vec2 vAlphaUv;

void main() {
  vAlphaUv = (uAlphaTransform * vec3(uv, 1.0)).xy;
  #include <beginnormal_vertex>
  #include <defaultnormal_vertex>
  #include <begin_vertex>
  #include <project_vertex>
  #include <worldpos_vertex>
  #include <shadowmap_vertex>
}
`;

const SHADOW_FRAGMENT = /* glsl */ `
${CUTOUT_PARS}
#include <common>
#include <bsdfs>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>

void main() {
${CUTOUT}
  // 1 lit, 0 in every shadowing light's shadow, as three's ShadowMaterial measures it
  gl_FragColor = vec4(vec3(getShadowMask()), 1.0);
}
`;

const AO_FRAGMENT = /* glsl */ `
uniform sampler2D tAo;
varying vec2 vUv;

void main() {
  gl_FragColor = vec4(vec3(texture2D(tAo, vUv).r), 1.0);
}
`;

const DEPTH_FRAGMENT = /* glsl */ `
#include <packing>
uniform sampler2D tDepth;
uniform float uNear;
uniform float uFar;
uniform float uOrtho;
uniform float uMin;
uniform float uMax;
varying vec2 vUv;

void main() {
  float d = texture2D(tDepth, vUv).x;
  float model = d < 1.0 ? 1.0 : 0.0;
  // the distance along the view, in metres
  float z = uOrtho > 0.5 ? -orthographicDepthToViewZ(d, uNear, uFar) : -perspectiveDepthToViewZ(d, uNear, uFar);
#ifdef MEASURE
  gl_FragColor = vec4(z * model, model, 0.0, 1.0);
#else
  gl_FragColor = vec4(vec3(model * (1.0 - clamp((z - uMin) / max(uMax - uMin, 1.0e-6), 0.0, 1.0))), 1.0);
#endif
}
`;

const NORMAL_FRAGMENT = /* glsl */ `
uniform sampler2D tNormal;
uniform sampler2D tDepth;
varying vec2 vUv;

void main() {
  float model = texture2D(tDepth, vUv).x < 1.0 ? 1.0 : 0.0;
  // the G-buffer's normal in view space, packed into 0..1; clear over the sky (premultiplied for the average)
  gl_FragColor = vec4(texture2D(tNormal, vUv).rgb * model, model);
}
`;

const LINES_FRAGMENT = /* glsl */ `
#include <packing>
uniform sampler2D tDepth;
uniform vec2 uTexel;
uniform float uOrtho;
uniform float uNear;
uniform float uFar;
uniform float uDepthNoise;
uniform float uOutlineWidth;
uniform float uOutlineFar;
varying vec2 vUv;
${EDGE_GLSL}
void main() {
  gl_FragColor = vec4(0.0, 0.0, 0.0, edgeAt(vUv));
}
`;

const SKY_FRAGMENT = /* glsl */ `
uniform sampler2D tDepth;
varying vec2 vUv;

void main() {
  gl_FragColor = vec4(vec3(texture2D(tDepth, vUv).x >= 1.0 ? 1.0 : 0.0), 1.0);
}
`;

const ADD_FRAGMENT = /* glsl */ `
uniform sampler2D tFrame;
uniform float uWeight;
varying vec2 vUv;

void main() {
  gl_FragColor = texture2D(tFrame, vUv) * uWeight;
}
`;

const COPY_FRAGMENT = /* glsl */ `
uniform sampler2D tSource;
varying vec2 vUv;

void main() {
  gl_FragColor = texture2D(tSource, vUv);
}
`;

/** What the layers read of a mesh's own material. */
interface Finish {
  readonly color?: THREE.Color;
  readonly map?: THREE.Texture | null;
  readonly alphaMap?: THREE.Texture | null;
  readonly alphaTest: number;
  readonly transparent: boolean;
  readonly transmission?: number;
  readonly polygonOffset: boolean;
  readonly polygonOffsetFactor: number;
  readonly polygonOffsetUnits: number;
}

/** A material drawn in place of every mesh's own (scene.overrideMaterial), which takes each mesh's finish just before it is drawn. */
interface Override {
  readonly material: THREE.ShaderMaterial;
  /** puts the finish of `mesh` (and its material) into the uniforms */
  take(mesh: THREE.Mesh, m: Finish): void;
}

/**
 * Draws the render layers of one picture: make it with the picture's renderer (sized to the picture),
 * scene and camera, `draw` each layer, then `dispose`. The renderer's state is left as it was found.
 */
export class LayerPainter {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: RenderScene;
  private readonly camera: THREE.Camera;
  private readonly width: number;
  private readonly height: number;
  /** one frame of a layer: 8 bits, with depth for the scene */
  private readonly frame: THREE.WebGLRenderTarget;
  /** the average of a smooth layer's frames */
  private readonly sum: THREE.WebGLRenderTarget;
  private readonly gbuffer: GBufferPass;
  private ao: GTAOPass | null = null;
  private readonly quad = new FullScreenQuad();
  private readonly blank = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  private readonly owned: { dispose(): void }[] = [];

  constructor(renderer: THREE.WebGLRenderer, scene: RenderScene, camera: THREE.Camera, width: number, height: number) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.width = width;
    this.height = height;
    this.blank.needsUpdate = true;
    const nearest = { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false } as const;
    this.frame = new THREE.WebGLRenderTarget(width, height, { ...nearest, type: THREE.UnsignedByteType });
    // half floats add up eight 8-bit frames without losing a step
    this.sum = new THREE.WebGLRenderTarget(width, height, { ...nearest, type: THREE.HalfFloatType, depthBuffer: false });
    this.gbuffer = new GBufferPass(width, height);
  }

  /** Draws layer `id` and reads it back: width × height × RGBA, alpha not premultiplied, top row first. */
  draw(id: LayerId): ImageData {
    const renderer = this.renderer;
    const scene = this.scene.scene;
    const saved = {
      target: renderer.getRenderTarget(),
      autoClear: renderer.autoClear,
      clearColor: renderer.getClearColor(new THREE.Color()),
      clearAlpha: renderer.getClearAlpha(),
      background: scene.background,
      override: scene.overrideMaterial,
      shadows: { ...pickShadowMap(renderer.shadowMap) },
    };
    renderer.autoClear = false;
    scene.background = null;
    try {
      const frame = this.frameOf(id);
      if (CRISP.has(id)) {
        frame();
      } else {
        this.average(frame);
        this.resolve();
      }
      const pixels = this.read();
      if (id === "albedo" || id === "normal") unpremultiply(pixels.data);
      return pixels;
    } finally {
      scene.background = saved.background;
      scene.overrideMaterial = saved.override;
      Object.assign(renderer.shadowMap, saved.shadows);
      renderer.setRenderTarget(saved.target);
      renderer.autoClear = saved.autoClear;
      renderer.setClearColor(saved.clearColor, saved.clearAlpha);
    }
  }

  dispose(): void {
    this.frame.dispose();
    this.sum.dispose();
    this.gbuffer.dispose();
    this.ao?.dispose();
    this.quad.dispose();
    this.blank.dispose();
    for (const o of this.owned) o.dispose();
    this.owned.length = 0;
  }

  /** What draws one frame of layer `id` into `frame`, through the camera as it stands (jittered or not). */
  private frameOf(id: LayerId): () => void {
    switch (id) {
      case "material":
        return this.overridden(this.flat(false, this.materialColours()), 0);
      case "object":
        return this.objectFrame();
      case "shadow":
        return this.shadowFrame();
      case "albedo":
        return this.overridden(this.albedo(), 0);
      case "ao":
        return this.aoFrame();
      case "depth":
        return this.depthFrame();
      case "normal":
        return this.screen(NORMAL_FRAGMENT, (u) => {
          u.tNormal = { value: this.gbuffer.normal };
          u.tDepth = { value: this.gbuffer.depth };
        });
      case "lines":
        return this.linesFrame();
      case "sky":
        return this.screen(SKY_FRAGMENT, (u) => {
          u.tDepth = { value: this.gbuffer.depth };
        });
    }
  }

  // ---- the scene drawn in other materials ------------------------------------------------

  /** A frame of the scene drawn with `override` over a clear of white `clear` (0 or 1) and alpha `clear`. */
  private overridden(override: Override, clear: number): () => void {
    const scene = this.scene.scene;
    let last: Finish | null = null;
    override.material.onBeforeRender = (_r, _s, _c, _g, object) => {
      const mesh = object as THREE.Mesh;
      const m = mesh.material as unknown as Finish;
      // meshes of one material in a row take it once (a material's block, base colour and cut-out are its own)
      if (m === last) return;
      last = m;
      override.take(mesh, m);
      override.material.uniformsNeedUpdate = true;
    };
    return () => {
      last = null;
      this.renderer.setRenderTarget(this.frame);
      this.renderer.setClearColor(new THREE.Color(clear, clear, clear), clear);
      this.renderer.clear(true, true, false);
      scene.overrideMaterial = override.material;
      this.renderer.render(scene, this.camera);
      scene.overrideMaterial = null;
    };
  }

  /** Flat colours, a mesh's own (`colours`) or, with `perVertex`, each triangle's (an idColor attribute). */
  private flat(perVertex: boolean, colours: (mesh: THREE.Mesh) => THREE.Vector3 | null): Override {
    const uniforms = {
      uColor: { value: new THREE.Vector3() },
      ...cutoutUniforms(this.blank),
    };
    const material = this.own(
      new THREE.ShaderMaterial({
        defines: perVertex ? { USE_ID: "" } : {},
        uniforms,
        vertexShader: FLAT_VERTEX,
        fragmentShader: FLAT_FRAGMENT,
        side: THREE.DoubleSide,
      }),
    );
    return {
      material,
      take: (mesh, m) => {
        takeCutout(material, uniforms, m, this.blank);
        const c = colours(mesh);
        if (c) uniforms.uColor.value.copy(c);
      },
    };
  }

  /** Each material's block colour, by its key (stable from one render to the next). */
  private materialColours(): (mesh: THREE.Mesh) => THREE.Vector3 | null {
    const blocks = new BlockColours();
    const cache = new Map<string, THREE.Vector3>();
    return (mesh) => {
      const key = typeof mesh.userData.materialKey === "string" ? mesh.userData.materialKey : `mesh:${mesh.uuid}`;
      let c = cache.get(key);
      if (!c) {
        c = blocks.of(`material:${key}`);
        cache.set(key, c);
      }
      return c;
    };
  }

  /**
   * Object colours: each face mesh's triangles coloured by their object (a temporary geometry with an
   * idColor a corner, over the mesh's own position and UVs), the content and the ground by their own.
   */
  private objectFrame(): () => void {
    const draw = this.overridden(this.flat(true, () => null), 0);
    return () => {
      const blocks = new BlockColours();
      const ownerColour = this.scene.owners.map((id) => blocks.bytes(`object:${id}`));
      const nobody = blocks.bytes("object:");
      const swapped: { mesh: THREE.Mesh; geometry: THREE.BufferGeometry }[] = [];
      this.scene.scene.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        const geometry = o.geometry as THREE.BufferGeometry;
        const owners = o.userData.owners instanceof Int32Array ? o.userData.owners : null;
        const vertices = geometry.attributes.position.count;
        const colours = new Uint8Array(vertices * 3);
        if (owners && vertices === 3 * owners.length) {
          // a compacted face: three corners a triangle, in the owners' order. A path tracer may have given
          // it an index since, in its BVH's order, but the corners stay where they were
          for (let t = 0; t < owners.length; t++) {
            const c = owners[t] >= 0 ? ownerColour[owners[t]] : nobody;
            colours.set(c, 9 * t);
            colours.set(c, 9 * t + 3);
            colours.set(c, 9 * t + 6);
          }
        } else {
          const c = blocks.bytes(typeof o.userData.objectKey === "string" ? `object:${o.userData.objectKey}` : `object:${o.uuid}`);
          for (let v = 0; v < vertices; v++) colours.set(c, v * 3);
        }
        const temp = new THREE.BufferGeometry();
        temp.setAttribute("position", geometry.attributes.position);
        if (geometry.attributes.uv) temp.setAttribute("uv", geometry.attributes.uv);
        temp.setAttribute("idColor", new THREE.BufferAttribute(colours, 3, true));
        if (geometry.index) temp.setIndex(geometry.index);
        temp.setDrawRange(geometry.drawRange.start, geometry.drawRange.count);
        if (!geometry.boundingSphere) geometry.computeBoundingSphere();
        temp.boundingSphere = geometry.boundingSphere;
        swapped.push({ mesh: o, geometry });
        o.geometry = temp;
      });
      try {
        draw();
      } finally {
        for (const { mesh, geometry } of swapped) {
          // the temporary geometry's own attribute goes with it; the shared ones stay, the mesh's geometry's
          const temp = mesh.geometry as THREE.BufferGeometry;
          temp.deleteAttribute("position");
          temp.deleteAttribute("uv");
          temp.setIndex(null);
          temp.dispose();
          mesh.geometry = geometry;
        }
      }
    };
  }

  /** The materials' colours and textures, unlit, as sRGB. */
  private albedo(): Override {
    const uniforms = {
      uColor: { value: new THREE.Vector3(1, 1, 1) },
      uMap: { value: this.blank as THREE.Texture },
      uUseMap: { value: 0 },
      uMapTransform: { value: new THREE.Matrix3() },
      ...cutoutUniforms(this.blank),
    };
    const material = this.own(
      new THREE.ShaderMaterial({ uniforms, vertexShader: ALBEDO_VERTEX, fragmentShader: ALBEDO_FRAGMENT, side: THREE.DoubleSide }),
    );
    return {
      material,
      take: (_mesh, m) => {
        takeCutout(material, uniforms, m, this.blank);
        const c = m.color;
        uniforms.uColor.value.set(c?.r ?? 1, c?.g ?? 1, c?.b ?? 1);
        const map = m.map ?? null;
        if (map) {
          if (map.matrixAutoUpdate) map.updateMatrix();
          uniforms.uMap.value = map;
          uniforms.uMapTransform.value.copy(map.matrix);
          uniforms.uUseMap.value = 1;
        } else {
          uniforms.uMap.value = this.blank;
          uniforms.uUseMap.value = 0;
        }
      },
    };
  }

  /**
   * Shadows: each face's shadow mask from the lights that light the picture, as the Realistic engine
   * draws their shadow maps (drawn once, with the meshes' own materials, then reused by every frame).
   * White where lit, darker in shadow; the sky white.
   */
  private shadowFrame(): () => void {
    const uniforms = {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.lights),
      ...cutoutUniforms(this.blank),
    };
    const material = this.own(
      shadowsFaceLights(
        new THREE.ShaderMaterial({ uniforms, vertexShader: SHADOW_VERTEX, fragmentShader: SHADOW_FRAGMENT, lights: true, side: THREE.DoubleSide }),
      ),
    );
    const draw = this.overridden(
      {
        material,
        take: (_mesh, m) => {
          takeCutout(material, uniforms, m, this.blank);
          // a see-through face that is not glass casts no shade here and is looked through, as in the G-buffer
          const drawn = !m.transparent || (m.transmission ?? 0) > 0;
          material.colorWrite = drawn;
          material.depthWrite = drawn;
        },
      },
      1,
    );
    const scene = this.scene;
    let fresh = true;
    return () => {
      const shadows = this.renderer.shadowMap;
      shadows.enabled = true;
      shadows.type = THREE.PCFShadowMap;
      shadows.autoUpdate = false;
      // the maps are drawn with the first frame; the jittered ones after reuse them
      shadows.needsUpdate = fresh;
      fresh = false;
      // only the lights that light the picture shade it: the sun when it is up, the lamps the Realistic engine keeps
      const off = [scene.sunLight, ...scene.lamps].filter((l) => l.castShadow && (l.intensity <= 0 || l.userData.rasterSkip === true));
      const hidden = scene.lamps.filter((l) => l.userData.rasterSkip === true && l.visible);
      for (const l of off) l.castShadow = false;
      for (const l of hidden) l.visible = false;
      try {
        draw();
      } finally {
        for (const l of off) l.castShadow = true;
        for (const l of hidden) l.visible = true;
      }
    };
  }

  // ---- the layers read off the G-buffer --------------------------------------------------

  /** A frame of a full-screen shader over this frame's G-buffer, its uniforms set by `uniforms`. */
  private screen(fragment: string, uniforms: (u: Record<string, THREE.IUniform>) => void, defines: Record<string, string> = {}): () => void {
    const u: Record<string, THREE.IUniform> = {};
    uniforms(u);
    const material = this.own(
      new THREE.ShaderMaterial({ uniforms: u, defines, vertexShader: SCREEN_VERTEX, fragmentShader: fragment, depthTest: false, depthWrite: false, blending: THREE.NoBlending }),
    );
    return () => {
      this.gbuffer.draw(this.renderer, this.scene.scene, this.camera);
      this.quad.material = material;
      this.renderer.setRenderTarget(this.frame);
      this.quad.render(this.renderer);
    };
  }

  /** Ambient occlusion from the G-buffer (GTAO and its denoise, as the Fast engine has it, reaching further), full strength; white where nothing shades. */
  private aoFrame(): () => void {
    const ao = this.aoPass();
    const u = { tAo: { value: ao.pdRenderTarget.texture } };
    const material = this.own(
      new THREE.ShaderMaterial({ uniforms: u, vertexShader: SCREEN_VERTEX, fragmentShader: AO_FRAGMENT, depthTest: false, depthWrite: false, blending: THREE.NoBlending }),
    );
    return () => {
      this.gbuffer.draw(this.renderer, this.scene.scene, this.camera);
      ao.render(this.renderer, this.frame, this.frame, 0, false);
      this.quad.material = material;
      this.renderer.setRenderTarget(this.frame);
      this.quad.render(this.renderer);
    };
  }

  private aoPass(): GTAOPass {
    if (this.ao) return this.ao;
    const ao = new GTAOPass(this.scene.scene, this.camera, this.width, this.height);
    ao.output = GTAOPass.OUTPUT.Off;
    ao.setGBuffer(this.gbuffer.depth, this.gbuffer.normal);
    ao.updateGtaoMaterial({ radius: AO_RADIUS, distanceExponent: 1, thickness: 1, scale: AO_POWER, samples: 16, distanceFallOff: 1, screenSpaceRadius: false });
    ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4, rings: 2, samples: 16 });
    const perspective = this.camera instanceof THREE.PerspectiveCamera ? 1 : 0;
    if (ao.gtaoMaterial.defines.PERSPECTIVE_CAMERA !== perspective) {
      ao.gtaoMaterial.defines.PERSPECTIVE_CAMERA = perspective;
      ao.gtaoMaterial.needsUpdate = true;
    }
    this.ao = ao;
    return ao;
  }

  /**
   * Depth: the distance along the view, white at the nearest point of the model the picture shows and
   * black at its farthest (the ground beyond the model black too, so it doesn't flatten the model's
   * range), the sky black. The range is measured first, through the camera unjittered.
   */
  private depthFrame(): () => void {
    const lens = this.camera as THREE.PerspectiveCamera | THREE.OrthographicCamera;
    const ortho = this.camera instanceof THREE.OrthographicCamera ? 1 : 0;
    const shared = (u: Record<string, THREE.IUniform>): void => {
      u.tDepth = { value: this.gbuffer.depth };
      u.uNear = { value: lens.near };
      u.uFar = { value: lens.far };
      u.uOrtho = { value: ortho };
    };
    const range = this.depthRange(shared);
    return this.screen(DEPTH_FRAGMENT, (u) => {
      shared(u);
      u.uMin = { value: range.min };
      u.uMax = { value: range.max };
    });
  }

  /** The nearest and farthest the model lies along the view in the picture (the farthest no farther than the model's box). */
  private depthRange(shared: (u: Record<string, THREE.IUniform>) => void): { min: number; max: number } {
    const target = new THREE.WebGLRenderTarget(this.width, this.height, {
      type: THREE.FloatType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: false,
    });
    const u: Record<string, THREE.IUniform> = {};
    shared(u);
    u.uMin = { value: 0 };
    u.uMax = { value: 1 };
    const material = new THREE.ShaderMaterial({
      uniforms: u,
      defines: { MEASURE: "" },
      vertexShader: SCREEN_VERTEX,
      fragmentShader: DEPTH_FRAGMENT,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });
    let min = Infinity;
    let max = -Infinity;
    try {
      this.gbuffer.draw(this.renderer, this.scene.scene, this.camera);
      this.quad.material = material;
      this.renderer.setRenderTarget(target);
      this.quad.render(this.renderer);
      const rows = Math.min(STRIP, this.height);
      const strip = new Float32Array(this.width * rows * 4);
      for (let y = 0; y < this.height; y += STRIP) {
        const n = Math.min(STRIP, this.height - y);
        this.renderer.readRenderTargetPixels(target, 0, y, this.width, n, strip);
        for (let i = 0; i < this.width * n * 4; i += 4) {
          if (strip[i + 1] < 0.5) continue;
          const z = strip[i];
          if (z < min) min = z;
          if (z > max) max = z;
        }
      }
    } finally {
      material.dispose();
      target.dispose();
    }
    if (!(max >= min)) return { min: 0, max: 1 };
    // the model's box seen along the view: the ground plane beyond it reads as far
    const far = farthestAlongView(this.scene.bounds, this.camera);
    if (far > min) max = Math.min(max, far);
    if (max - min < 1e-3) max = min + 1e-3;
    return { min, max };
  }

  /** Lines along edges and creases, from the G-buffer's depth as the finish draws its outlines, black on a clear layer. */
  private linesFrame(): () => void {
    const lens = this.camera as THREE.PerspectiveCamera | THREE.OrthographicCamera;
    return this.screen(LINES_FRAGMENT, (u) => {
      u.tDepth = { value: this.gbuffer.depth };
      u.uTexel = { value: new THREE.Vector2(1 / this.width, 1 / this.height) };
      u.uOrtho = { value: this.camera instanceof THREE.OrthographicCamera ? 1 : 0 };
      u.uNear = { value: lens.near };
      u.uFar = { value: lens.far };
      u.uDepthNoise = { value: depthNoise(lens.near) };
      u.uOutlineWidth = { value: Math.max(1, this.height / OUTLINE_HEIGHT) };
      u.uOutlineFar = { value: edgeFar(this.scene, this.camera) };
    });
  }

  // ---- averaging and reading ------------------------------------------------------------

  /** SMOOTH_SAMPLES frames of `frame`, the camera jittered under a pixel for each, added into `sum` a share each. */
  private average(frame: () => void): void {
    const renderer = this.renderer;
    const camera = this.camera;
    const base = camera.projectionMatrix.clone();
    const baseInverse = camera.projectionMatrixInverse.clone();
    const add = this.addMaterial();
    try {
      renderer.setRenderTarget(this.sum);
      renderer.setClearColor(0x000000, 0);
      renderer.clear(true, false, false);
      for (let i = 0; i < SMOOTH_SAMPLES; i++) {
        jitter(camera, base, halton(i + 1, 2) - 0.5, halton(i + 1, 3) - 0.5, this.width, this.height);
        frame();
        add.uniforms.tFrame.value = this.frame.texture;
        add.uniforms.uWeight.value = 1 / SMOOTH_SAMPLES;
        this.quad.material = add;
        renderer.setRenderTarget(this.sum);
        this.quad.render(renderer);
      }
    } finally {
      camera.projectionMatrix.copy(base);
      camera.projectionMatrixInverse.copy(baseInverse);
    }
  }

  private adder: THREE.ShaderMaterial | null = null;

  private addMaterial(): THREE.ShaderMaterial {
    this.adder ??= this.own(
      new THREE.ShaderMaterial({
        uniforms: { tFrame: { value: null }, uWeight: { value: 1 } },
        vertexShader: SCREEN_VERTEX,
        fragmentShader: ADD_FRAGMENT,
        depthTest: false,
        depthWrite: false,
        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneFactor,
        blendEquationAlpha: THREE.AddEquation,
        blendSrcAlpha: THREE.OneFactor,
        blendDstAlpha: THREE.OneFactor,
      }),
    );
    return this.adder;
  }

  private copier: THREE.ShaderMaterial | null = null;

  /** The average, rounded to 8 bits, into `frame` to be read. */
  private resolve(): void {
    this.copier ??= this.own(
      new THREE.ShaderMaterial({
        uniforms: { tSource: { value: null } },
        vertexShader: SCREEN_VERTEX,
        fragmentShader: COPY_FRAGMENT,
        depthTest: false,
        depthWrite: false,
        blending: THREE.NoBlending,
      }),
    );
    this.copier.uniforms.tSource.value = this.sum.texture;
    this.quad.material = this.copier;
    this.renderer.setRenderTarget(this.frame);
    this.quad.render(this.renderer);
  }

  /** `frame` read in strips into a picture, top row first (WebGL counts rows from the bottom). */
  private read(): ImageData {
    const { width, height } = this;
    const out = new ImageData(width, height);
    const rows = Math.min(STRIP, height);
    const strip = new Uint8Array(width * rows * 4);
    const stride = width * 4;
    for (let y = 0; y < height; y += STRIP) {
      const n = Math.min(STRIP, height - y);
      this.renderer.readRenderTargetPixels(this.frame, 0, y, width, n, strip);
      for (let r = 0; r < n; r++) out.data.set(strip.subarray(r * stride, (r + 1) * stride), (height - 1 - (y + r)) * stride);
    }
    return out;
  }

  private own<T extends { dispose(): void }>(thing: T): T {
    this.owned.push(thing);
    return thing;
  }
}

/** The uniforms of a cut-out test (CUTOUT_PARS), with nothing cut out. */
function cutoutUniforms(blank: THREE.Texture): { uAlphaMap: THREE.IUniform<THREE.Texture>; uAlphaTest: THREE.IUniform<number>; uAlphaTransform: THREE.IUniform<THREE.Matrix3> } {
  return { uAlphaMap: { value: blank }, uAlphaTest: { value: 0 }, uAlphaTransform: { value: new THREE.Matrix3() } };
}

/** A mesh's cut-out and its offset behind faces lying on it, as the G-buffer takes them. */
function takeCutout(
  material: THREE.Material,
  u: { uAlphaMap: THREE.IUniform<THREE.Texture>; uAlphaTest: THREE.IUniform<number>; uAlphaTransform: THREE.IUniform<THREE.Matrix3> },
  m: Finish,
  blank: THREE.Texture,
): void {
  material.polygonOffset = m.polygonOffset;
  material.polygonOffsetFactor = m.polygonOffsetFactor;
  material.polygonOffsetUnits = m.polygonOffsetUnits;
  const alpha = m.alphaMap ?? null;
  if (alpha && m.alphaTest > 0) {
    if (alpha.matrixAutoUpdate) alpha.updateMatrix();
    u.uAlphaMap.value = alpha;
    u.uAlphaTest.value = m.alphaTest;
    u.uAlphaTransform.value.copy(alpha.matrix);
  } else {
    u.uAlphaMap.value = blank;
    u.uAlphaTest.value = 0;
  }
}

/** The renderer's shadow map settings a layer changes. */
function pickShadowMap(s: THREE.WebGLShadowMap): Pick<THREE.WebGLShadowMap, "enabled" | "type" | "autoUpdate" | "needsUpdate"> {
  return { enabled: s.enabled, type: s.type, autoUpdate: s.autoUpdate, needsUpdate: s.needsUpdate };
}

/** Colours premultiplied by their alpha (an average over the sky's clear pixels) made straight again. */
function unpremultiply(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a === 0 || a === 255) continue;
    const k = 255 / a;
    data[i] = data[i] * k;
    data[i + 1] = data[i + 1] * k;
    data[i + 2] = data[i + 2] * k;
  }
}

/** How far along the view the farthest corner of `box` lies. */
function farthestAlongView(box: THREE.Box3, camera: THREE.Camera): number {
  const eye = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
  const forward = camera.getWorldDirection(new THREE.Vector3());
  let far = -Infinity;
  const p = new THREE.Vector3();
  for (let i = 0; i < 8; i++) {
    p.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
    far = Math.max(far, p.sub(eye).dot(forward));
  }
  return far;
}

/** How far apart (in 8-bit RGB) block colours keep while there is room (about 40 blocks), so neighbouring blocks never look alike. */
const BLOCK_GAP = 48;
/** Hashes tried for a colour that far from the others; the farthest of them wins when none is. */
const GAP_TRIES = 24;
/** Past this many blocks in a layer, a colour is only kept different from the others (spreading them costs too much). */
const GAPPED_BLOCKS = 1000;

/**
 * Block colours, one a key: from a hash of the key, so a material or object keeps its colour from one
 * render to the next, bright enough to tell from the clear sky, each one different in a layer and as
 * far from the others as a few tries find.
 */
class BlockColours {
  private readonly taken = new Map<number, string>();
  private readonly made = new Map<string, number>();
  /** the colours taken, filed by cube of BLOCK_GAP+ a side, to find the near ones */
  private readonly cubes = new Map<number, number[]>();

  /** The block colour of `key`, 0..1 a channel, exact in 8 bits. */
  of(key: string): THREE.Vector3 {
    const [r, g, b] = this.bytes(key);
    return new THREE.Vector3(r / 255, g / 255, b / 255);
  }

  /** The block colour of `key` as three bytes. */
  bytes(key: string): Uint8Array {
    let rgb = this.made.get(key);
    if (rgb === undefined) {
      rgb = this.pick(key);
      this.taken.set(rgb, key);
      this.made.set(key, rgb);
      const cube = cubeOf(rgb >> 16, (rgb >> 8) & 0xff, rgb & 0xff);
      const list = this.cubes.get(cube);
      if (list) list.push(rgb);
      else this.cubes.set(cube, [rgb]);
    }
    return Uint8Array.of((rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff);
  }

  private pick(key: string): number {
    const spaced = this.taken.size < GAPPED_BLOCKS;
    let best = -1;
    let bestGap = -1;
    for (let salt = 0; salt < GAP_TRIES || best < 0; salt++) {
      const rgb = hashColour(salt === 0 ? key : `${key}#${salt}`);
      if (this.taken.has(rgb)) continue;
      if (!spaced) return rgb;
      const gap = this.gapTo(rgb);
      if (gap >= BLOCK_GAP) return rgb;
      if (gap > bestGap) {
        best = rgb;
        bestGap = gap;
      }
    }
    return best;
  }

  /** How far `rgb` is from the nearest colour taken, up to BLOCK_GAP. */
  private gapTo(rgb: number): number {
    const r = rgb >> 16;
    const g = (rgb >> 8) & 0xff;
    const b = rgb & 0xff;
    let gap = BLOCK_GAP * BLOCK_GAP;
    for (let i = 0; i < 27; i++) {
      const near = this.cubes.get(cubeOf(r, g, b, (i % 3) - 1, (Math.floor(i / 3) % 3) - 1, Math.floor(i / 9) - 1));
      if (!near) continue;
      for (const o of near) {
        const dr = (o >> 16) - r;
        const dg = ((o >> 8) & 0xff) - g;
        const db = (o & 0xff) - b;
        gap = Math.min(gap, dr * dr + dg * dg + db * db);
      }
    }
    return Math.sqrt(gap);
  }
}

/** The cube of side 64 (≥ BLOCK_GAP) a colour falls in, moved by a cube or none on each axis; -1 off the edge. */
function cubeOf(r: number, g: number, b: number, dr = 0, dg = 0, db = 0): number {
  const x = (r >> 6) + dr;
  const y = (g >> 6) + dg;
  const z = (b >> 6) + db;
  return x < 0 || y < 0 || z < 0 || x > 3 || y > 3 || z > 3 ? -1 : (x << 4) | (y << 2) | z;
}

/** A colour from a hash of `key`: any hue, fairly saturated, never dark (0xRRGGBB). */
export function hashColour(key: string): number {
  // FNV-1a, then a mix so neighbouring keys land far apart
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  const hue = ((h >>> 0) % 3600) / 600;
  const sat = 0.45 + (((h >>> 12) & 0xff) / 255) * 0.45;
  const val = 0.62 + (((h >>> 20) & 0xff) / 255) * 0.36;
  // HSV to RGB, the bytes as they are (no colour space)
  const f = (n: number): number => {
    const k = (n + hue) % 6;
    return Math.round(255 * (val - val * sat * Math.max(0, Math.min(k, 4 - k, 1))));
  };
  const r = f(5);
  const g = f(3);
  const b = f(1);
  return (r << 16) | (g << 8) | b;
}
