import * as THREE from "three";

const DEFAULTS={toony:0.9,shift:-0.035,shade:[0.68,0.72,0.82]};
export function applyAnimeShader(vrm,options={}){const cfg={...DEFAULTS,...options}; for(const material of vrm?.materials||[]){if(!material)continue;if("shadingToonyFactor" in material)material.shadingToonyFactor=cfg.toony;if("shadingShiftFactor" in material)material.shadingShiftFactor=cfg.shift;material.needsUpdate=true;}}
export function createAnimeLighting(scene){const key=new THREE.DirectionalLight(0xffffff,2.2);key.position.set(2,4,3);scene.add(key);const fill=new THREE.HemisphereLight(0xffffff,0x445566,1.0);scene.add(fill);return {key,fill};}
