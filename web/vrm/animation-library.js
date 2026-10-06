import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VRMAnimationLoaderPlugin, createVRMAnimationClip } from "@pixiv/three-vrm-animation";

const UTSUWA_RAW = "https://raw.githubusercontent.com/JuiceBoxxGames/utsuwa/main/static/animations/";

export const MOTION_URLS = {
  showcase: `${UTSUWA_RAW}VRMA_01.vrma`,
  greeting: `${UTSUWA_RAW}VRMA_02.vrma`,
  peace: `${UTSUWA_RAW}VRMA_03.vrma`,
  shoot: `${UTSUWA_RAW}VRMA_04.vrma`,
  spin: `${UTSUWA_RAW}VRMA_05.vrma`,
  model_pose: `${UTSUWA_RAW}VRMA_06.vrma`,
  squat: `${UTSUWA_RAW}VRMA_07.vrma`
};

export const IDLE_URLS = [
  `${UTSUWA_RAW}idle.vrma`,
  `${UTSUWA_RAW}idle_2.vrma`,
  `${UTSUWA_RAW}idle_3.vrma`,
  `${UTSUWA_RAW}idle_4.vrma`,
  `${UTSUWA_RAW}idle_5.vrma`
];

export const TALKING_URL = `${UTSUWA_RAW}talking.vrma`;

const animationCache = new Map();

function loadRawAnimation(url) {
  const cached = animationCache.get(url);
  if (cached) return cached;

  const promise = new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.crossOrigin = "anonymous";
    loader.register((parser) => new VRMAnimationLoaderPlugin(parser));
    loader.load(
      url,
      (gltf) => {
        const animation = gltf.userData.vrmAnimations?.[0];
        if (!animation) {
          reject(new Error(`No VRMA animation found: ${url}`));
          return;
        }
        resolve(animation);
      },
      undefined,
      reject
    );
  });

  promise.catch(() => animationCache.delete(url));
  animationCache.set(url, promise);
  return promise;
}

export async function loadAnimationClip(url, vrm, reanchor) {
  const animation = await loadRawAnimation(url);
  const clip = createVRMAnimationClip(animation, vrm);
  if (typeof reanchor === "function") reanchor(clip);
  return clip;
}

export function clearAnimationCache() {
  animationCache.clear();
}

export function evictAnimation(url) {
  animationCache.delete(url);
}

export function animationCacheSize() {
  return animationCache.size;
}
