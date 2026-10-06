import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";
import { VRMAnimationLoaderPlugin, VRMLookAtQuaternionProxy } from "@pixiv/three-vrm-animation";

export function createVrmLoader() {
  const loader = new GLTFLoader();
  loader.crossOrigin = "anonymous";
  loader.register((parser) => new VRMLoaderPlugin(parser));
  loader.register((parser) => new VRMAnimationLoaderPlugin(parser));
  return loader;
}

export function applyCChanShader(vrm) {
  const materials = Array.isArray(vrm?.materials) ? vrm.materials : [];

  for (const material of materials) {
    if (!material) continue;

    // VRM 1.0 MToon parameters. Keep the original material/shader intact.
    // Only touch properties that exist so this remains compatible with
    // different three-vrm versions and VRM assets.
    if ("shadingToonyFactor" in material) {
      material.shadingToonyFactor = 0.82;
    }

    if ("shadingShiftFactor" in material) {
      material.shadingShiftFactor = -0.02;
    }

    if ("shadeColorFactor" in material && material.shadeColorFactor?.isColor) {
      material.shadeColorFactor.setRGB(0.72, 0.74, 0.82);
    }

    if ("rimColorFactor" in material && material.rimColorFactor?.isColor) {
      material.rimColorFactor.setRGB(0.55, 0.62, 0.9);
    }

    if ("rimFresnelPowerFactor" in material) {
      material.rimFresnelPowerFactor = 2.2;
    }

    if ("rimLiftFactor" in material) {
      material.rimLiftFactor = 0.02;
    }

    if ("rimLightingMixFactor" in material) {
      material.rimLightingMixFactor = 0.35;
    }

    if ("outlineWidthMode" in material && "outlineWidthFactor" in material) {
      material.outlineWidthMode = "screenCoordinates";
      material.outlineWidthFactor = 0.0035;
    }

    if ("outlineColorFactor" in material && material.outlineColorFactor?.isColor) {
      material.outlineColorFactor.setRGB(0.035, 0.025, 0.055);
    }

    if ("outlineLightingMixFactor" in material) {
      material.outlineLightingMixFactor = 0.15;
    }

    material.needsUpdate = true;
  }
}

export async function loadVrm(url, onProgress) {
  const loader = createVrmLoader();
  const gltf = await loader.loadAsync(url, (progress) => {
    if (typeof onProgress === "function") onProgress(progress);
  });
  const vrm = gltf.userData.vrm;
  if (!vrm) throw new Error("VRM loader did not produce a VRM.");

  VRMUtils.removeUnnecessaryVertices(gltf.scene);
  VRMUtils.removeUnnecessaryJoints(gltf.scene);

  if (vrm.meta?.metaVersion !== "1") {
    VRMUtils.rotateVRM0(vrm);
  }

  gltf.scene.traverse((object) => {
    object.frustumCulled = false;
  });

  applyCChanShader(vrm);

  return vrm;
}

export function normalizeVrm(vrm, targetHeight = 1.65) {
  const scene = vrm.scene;
  scene.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const height = Math.max(size.y, 0.1);
  const scale = targetHeight / height;

  scene.scale.setScalar(scale);
  scene.position.set(
    -center.x * scale,
    -box.min.y * scale - 0.05,
    -center.z * scale
  );

  return { box, size, center, scale };
}

export function attachLookAtProxy(vrm, target) {
  if (!vrm.lookAt) return null;
  vrm.lookAt.target = target;
  const proxy = new VRMLookAtQuaternionProxy(vrm.lookAt);
  proxy.name = "lookAtQuaternionProxy";
  vrm.scene.add(proxy);
  return proxy;
}

export function disposeVrm(vrm) {
  if (!vrm) return;
  vrm.scene.traverse((object) => {
    if (object.geometry) object.geometry.dispose();
    const material = object.material;
    if (Array.isArray(material)) material.forEach((item) => item.dispose());
    else material?.dispose();
  });
}
