// Small still pictures of a converted or read model for the converter page's tiles. One offscreen
// three.js renderer serves every tile: it is made on the first tile and kept, so a page with many
// files holds one WebGL context, not one per file. Each picture is a fixed three-quarter view, fitted
// to the model's bounds, drawn once and then encoded as a PNG; its geometry is freed after each one.
// The module is loaded only when a tile needs a model, so three.js stays out of the first load.

import * as THREE from "three";
import { canvasBlob } from "../../export/png.ts";
import type { PreviewMesh } from "./preview3d.ts";

/** The neutral the pictures are drawn on: a light grey that sits well on the tiles and on the page. */
const BACKGROUND = "#ececea";

/** The one renderer, made on first use and kept. Null again after the browser loses its context. */
let renderer: THREE.WebGLRenderer | null = null;

/**
 * A PNG of `mesh` from a fixed three-quarter view, `width` by `height` pixels, z up as in the editor.
 * Throws "3D preview needs WebGL" when the browser can't make a WebGL context.
 */
export async function thumb3d(mesh: PreviewMesh, width: number, height: number): Promise<Blob> {
  const r = rendererOf();
  r.setPixelRatio(1);
  r.setSize(width, height, false);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BACKGROUND);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(mesh.colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  // double-sided, as in the preview: a converted model's faces often have no inside to hide behind
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.85 });
  scene.add(new THREE.Mesh(geometry, material));

  // a model of one point (or none) still gets a frame to fit
  const sphere = geometry.boundingSphere ?? new THREE.Sphere();
  const center = sphere.center.clone();
  const radius = Number.isFinite(sphere.radius) && sphere.radius > 0 ? sphere.radius : 1;

  const hemisphere = new THREE.HemisphereLight(0xffffff, 0x555555, 2.2);
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.copy(center).add(new THREE.Vector3(1, -1.5, 2).multiplyScalar(radius));
  sun.target.position.copy(center);
  scene.add(hemisphere, sun, sun.target);

  // the same three-quarter view as the preview, fitted so the bounding sphere fills the 40° frame
  const camera = new THREE.PerspectiveCamera(40, width / height, radius * 0.01, radius * 50);
  camera.up.set(0, 0, 1);
  camera.position.copy(center).add(new THREE.Vector3(1, -1.2, 0.9).normalize().multiplyScalar(radius / Math.sin(THREE.MathUtils.degToRad(20))));
  camera.lookAt(center);

  try {
    r.render(scene, camera);
    // the canvas is read in the same turn as it is drawn: the buffer is kept for this read (preserveDrawingBuffer)
    return await canvasBlob(r.domElement, "image/png");
  } finally {
    geometry.dispose();
    material.dispose();
  }
}

/** The shared renderer, made when first needed. Throws when WebGL is missing. */
function rendererOf(): THREE.WebGLRenderer {
  if (renderer) return renderer;
  const canvas = document.createElement("canvas");
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  } catch {
    throw new Error("3D preview needs WebGL");
  }
  // a lost context is remade on the next picture, not drawn into
  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    renderer = null;
  });
  return renderer;
}
