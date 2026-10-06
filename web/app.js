import * as THREE from "three";
import { AvatarAnimator } from "./vrm/avatar-animator.js";
import { IDLE_URLS, MOTION_URLS, TALKING_URL } from "./vrm/animation-library.js";
import { loadVrm, normalizeVrm, attachLookAtProxy } from "./vrm/vrm-loader.js";
import { FreeCameraController } from "./free-camera.js";
import { applyAnimeShader, createAnimeLighting } from "./anime-shader.js";

let sessionId = localStorage.getItem("cchan_ai_session") || crypto.randomUUID();
localStorage.setItem("cchan_ai_session", sessionId);

const canvas = document.querySelector("#vrm-canvas");
const form = document.querySelector("#chat-form");
const input = document.querySelector("#message");
const send = document.querySelector("#send");
const subtitle = document.querySelector("#subtitle");
const statusText = document.querySelector("#status-text");
const freeCameraButton = document.querySelector("#free-camera-toggle");

let character = null;
let currentAudio = null;
let currentAudioUrl = null;
let currentSpeechUtterance = null;

function updateMobileViewport() {
  const viewport = window.visualViewport;
  if (!viewport) return;

  const layoutHeight = window.innerHeight;
  const visibleHeight = viewport.height;
  const keyboardOffset = Math.max(0, layoutHeight - visibleHeight - viewport.offsetTop);

  document.documentElement.style.setProperty("--viewport-height", `${visibleHeight}px`);
  document.documentElement.style.setProperty("--keyboard-offset", `${keyboardOffset}px`);
  document.documentElement.classList.toggle("keyboard-open", keyboardOffset > 80);
}

if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", updateMobileViewport);
  window.visualViewport.addEventListener("scroll", updateMobileViewport);
}
window.addEventListener("resize", updateMobileViewport);
updateMobileViewport();

function buildSpeechTimeline(text) {
  const value = String(text || "").trim();
  if (!value) return { duration: 0, words: [], visemes: [] };

  const words = [];
  const wordPattern = /\S+\s*/gu;
  let match;

  while ((match = wordPattern.exec(value))) {
    const raw = match[0];
    const clean = raw.trim();
    if (!clean) continue;

    const letters = clean.replace(/[^a-zA-ZÀ-ÿ]/g, "").length;
    const punctuationPause = /[.!?…]\s*$/.test(raw) ? 260 : /[,;:]\s*$/.test(raw) ? 150 : 0;
    words.push({
      text: raw,
      weight: Math.max(1, letters) + punctuationPause / 45
    });
  }

  const totalWeight = words.reduce((sum, word) => sum + word.weight, 0) || 1;
  const duration = THREE.MathUtils.clamp(520 + totalWeight * 68, 900, 5200);
  const visemes = [];
  let elapsedWeight = 0;

  for (const word of words) {
    const wordStart = (elapsedWeight / totalWeight) * duration;
    const wordDuration = (word.weight / totalWeight) * duration;
    const vowels = [...word.text].filter((char) => /[aiueo]/i.test(char));

    if (!vowels.length) {
      visemes.push({ time: wordStart + wordDuration * 0.35, vowel: "A", strength: 0.42, duration: 85 });
    } else {
      const step = wordDuration / vowels.length;
      vowels.forEach((char, index) => {
        visemes.push({
          time: wordStart + step * index + step * 0.12,
          vowel: char.toUpperCase(),
          strength: 0.62,
          duration: Math.min(125, Math.max(65, step * 0.72))
        });
      });
    }

    elapsedWeight += word.weight;
  }

  return { duration, words, visemes };
}

function showSubtitle(text) {
  subtitle.replaceChildren();
  subtitle.classList.remove("is-visible");
  void subtitle.offsetWidth;

  const timeline = buildSpeechTimeline(text);
  const fragment = document.createDocumentFragment();
  const totalWeight = timeline.words.reduce((sum, word) => sum + word.weight, 0) || 1;
  let elapsedWeight = 0;

  timeline.words.forEach((word) => {
    const span = document.createElement("span");
    span.className = "caption-word";
    span.textContent = word.text;
    span.style.animationDelay = `${((elapsedWeight / totalWeight) * timeline.duration)}ms`;
    span.style.animationDuration = "180ms";
    fragment.appendChild(span);
    elapsedWeight += word.weight;
  });

  subtitle.appendChild(fragment);
  requestAnimationFrame(() => subtitle.classList.add("is-visible"));
  return timeline;
}

function detectEmotion(text) {
  const value = text.toLowerCase();
  if (/[!！]{2,}|wkwk|haha|lucu|senang|seru/.test(value)) return "Joy";
  if (/marah|kesal|nyebelin|benci|anjing|tolol/.test(value)) return "Angry";
  if (/sedih|nangis|kecewa|hampa/.test(value)) return "Sorrow";
  if (/kaget|serius\?|hah\?|gila\?|wow/.test(value)) return "Surprised";
  return "Neutral";
}

function showReplyAnimation(text, state = null, duration = null) {
  const timeline = buildSpeechTimeline(text);
  if (duration && timeline.duration) {
    const scale = duration / timeline.duration;
    timeline.duration = duration;
    timeline.words = timeline.words.map((word) => ({ ...word, weight: word.weight }));
    timeline.visemes = timeline.visemes.map((viseme) => ({
      ...viseme,
      time: viseme.time * scale,
      duration: viseme.duration * scale
    }));
  }
  showSubtitleWithTimeline(text, timeline);
  character?.applyCharacterState(state, text, timeline);
}

function showSubtitleWithTimeline(text, timeline) {
  subtitle.replaceChildren();
  subtitle.classList.remove("is-visible");
  void subtitle.offsetWidth;

  const fragment = document.createDocumentFragment();
  const totalWeight = timeline.words.reduce((sum, word) => sum + word.weight, 0) || 1;
  let elapsedWeight = 0;

  timeline.words.forEach((word) => {
    const span = document.createElement("span");
    span.className = "caption-word";
    span.textContent = word.text;
    span.style.animationDelay = `${((elapsedWeight / totalWeight) * timeline.duration)}ms`;
    span.style.animationDuration = "180ms";
    fragment.appendChild(span);
    elapsedWeight += word.weight;
  });

  subtitle.appendChild(fragment);
  requestAnimationFrame(() => subtitle.classList.add("is-visible"));
  return timeline;
}

function stopVoice() {
  speechPlaybackToken += 1;

  if (currentAudio) {
    currentAudio.pause();
    currentAudio.removeAttribute("src");
    currentAudio.load();
    currentAudio = null;
  }
  if (currentAudioUrl) {
    URL.revokeObjectURL(currentAudioUrl);
    currentAudioUrl = null;
  }
  if (currentSpeechUtterance) {
    window.speechSynthesis?.cancel();
    currentSpeechUtterance = null;
  }
}

let cachedSpeechVoices = [];
let speechVoicesReady = false;

function refreshSpeechVoices() {
  if (!("speechSynthesis" in window)) return [];
  cachedSpeechVoices = window.speechSynthesis.getVoices();
  speechVoicesReady = cachedSpeechVoices.length > 0;
  return cachedSpeechVoices;
}

if ("speechSynthesis" in window) {
  refreshSpeechVoices();
  window.speechSynthesis.addEventListener?.("voiceschanged", refreshSpeechVoices);
}

async function getIndonesianVoice() {
  let voices = refreshSpeechVoices();
  if (voices.length) return selectIndonesianVoice(voices);

  // Chrome/Android often exposes voices a moment after page load.
  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.speechSynthesis.removeEventListener?.("voiceschanged", finish);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, 250);
    window.speechSynthesis.addEventListener?.("voiceschanged", finish);
  });

  voices = refreshSpeechVoices();
  return selectIndonesianVoice(voices);
}

function selectIndonesianVoice(voices) {
  const list = Array.isArray(voices) ? voices : [];

  // Prefer a native Indonesian locale over a generic Indonesian-tagged voice.
  return (
    list.find((voice) => /^id-ID$/i.test(voice.lang)) ||
    list.find((voice) => /^id(?:-|$)/i.test(voice.lang)) ||
    list.find((voice) => /bahasa indonesia|indonesian|indonesia/i.test(voice.name)) ||
    null
  );
}

function getSpeechProfile(characterState, sentence = "", index = 0, total = 1) {
  const energy = THREE.MathUtils.clamp(Number(characterState?.energy ?? 68), 0, 100);
  const mood = String(characterState?.mood || "").toLowerCase();
  const emotion = String(characterState?.emotion || "");
  const text = String(sentence || "").trim();

  let rate = 0.95 + (energy - 50) * 0.00065;
  let pitch = 1.01 + (energy - 50) * 0.00022;
  let volume = 0.96;

  if (mood === "malas") { rate -= 0.022; pitch -= 0.010; volume = 0.94; }
  else if (mood === "playful" || mood === "iseng") { rate += 0.010; pitch += 0.016; }
  else if (mood === "sedikit jutek" || emotion === "Angry") { rate -= 0.005; pitch -= 0.016; volume = 0.95; }

  if (emotion === "Sorrow") { rate -= 0.030; pitch -= 0.022; volume = 0.92; }
  else if (emotion === "Surprised") { rate += 0.016; pitch += 0.028; }

  if (/\?\s*$/.test(text)) { pitch += 0.020; rate += 0.004; }
  else if (/!+\s*$/.test(text)) { pitch += 0.010; rate += 0.008; }

  if (/(?:\.\.\.|…)\s*$/.test(text)) { rate -= 0.022; pitch -= 0.006; }

  if (total > 1) {
    const cadence = index % 3;
    if (cadence === 1) rate -= 0.008;
    if (cadence === 2) rate += 0.005;
  }

  if (text && text.split(/\s+/).length <= 4) rate -= 0.010;

  return {
    rate: THREE.MathUtils.clamp(rate, 0.89, 1.035),
    pitch: THREE.MathUtils.clamp(pitch, 0.955, 1.085),
    volume: THREE.MathUtils.clamp(volume, 0.90, 1)
  };
}

function splitSpeechText(text) {
  const value = String(text || "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  if (!value) return [];

  const parts = value.match(/[^.!?…]+(?:[.!?…]+|$)/gu) || [value];
  const sentences = parts.map((part) => part.trim()).filter(Boolean);

  if (sentences.length <= 1 && value.length <= 150) return [value];

  const chunks = [];
  for (const sentence of sentences) {
    if (sentence.length <= 150) chunks.push(sentence);
    else {
      const smaller = sentence.match(/.{1,125}(?:[,;:]\s+|$)/gu) || [sentence];
      for (const item of smaller) {
        const chunk = item.trim();
        if (chunk) chunks.push(chunk);
      }
    }
  }
  return chunks.slice(0, 10);
}

function estimateSpeechPause(text) {
  if (/(?:\.\.\.|…)\s*$/.test(text)) return 300;
  if (/[!?]\s*$/.test(text)) return 145;
  if (/[,:;]\s*$/.test(text)) return 105;
  return 75;
}

function speakSpeechChunk(text, voice, characterState, token, index, total, beforePlay) {
  return new Promise((resolve, reject) => {
    if (token !== speechPlaybackToken) return resolve();

    const profile = getSpeechProfile(characterState, text, index, total);
    const timeline = buildSpeechTimeline(text);
    const utterance = new SpeechSynthesisUtterance(text);

    utterance.lang = voice?.lang || "id-ID";
    if (voice) utterance.voice = voice;
    utterance.rate = profile.rate;
    utterance.pitch = profile.pitch;
    utterance.volume = profile.volume;
    currentSpeechUtterance = utterance;

    utterance.onstart = () => {
      if (token !== speechPlaybackToken) return;
      beforePlay?.(timeline.duration, text, index, total);
    };

    utterance.onend = () => {
      if (token !== speechPlaybackToken) return resolve();
      currentSpeechUtterance = null;
      resolve();
    };

    utterance.onerror = (event) => {
      if (token !== speechPlaybackToken) return resolve();
      currentSpeechUtterance = null;
      if (event.error === "interrupted" || event.error === "canceled") resolve();
      else reject(new Error(event.error || "SpeechSynthesis error"));
    };

    window.speechSynthesis.speak(utterance);
  });
}

let speechPlaybackToken = 0;

async function playVoice(text, characterState = null, beforePlay = null) {
  stopVoice();

  const speechText = String(text || "").trim();
  if (!speechText) return 0;

  if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") {
    throw new Error("Browser SpeechSynthesis unavailable");
  }

  const voice = await getIndonesianVoice();
  const chunks = splitSpeechText(speechText.slice(0, 1200));
  if (!chunks.length) return 0;

  const token = ++speechPlaybackToken;
  let totalDuration = 0;

  for (let index = 0; index < chunks.length; index += 1) {
    if (token !== speechPlaybackToken) break;

    const chunk = chunks[index];
    const timeline = buildSpeechTimeline(chunk);
    totalDuration += timeline.duration;

    await speakSpeechChunk(
      chunk,
      voice,
      characterState,
      token,
      index,
      chunks.length,
      (duration, spokenText, chunkIndex, chunkTotal) => {
        showReplyAnimation(spokenText, characterState, duration);
        character?.startSpeaking();
        beforePlay?.(duration, spokenText, chunkIndex, chunkTotal);
      }
    );

    if (token !== speechPlaybackToken) break;

    // A tiny human-like breath between thoughts. Longer after ellipses.
    if (index < chunks.length - 1) {
      await new Promise((resolve) =>
        setTimeout(resolve, estimateSpeechPause(chunk))
      );
    }
  }

  if (token === speechPlaybackToken) {
    currentSpeechUtterance = null;
    character?.stopSpeaking();
    statusText.textContent = "di sini";
  }

  return totalDuration;
}

async function sendMessage(text) {
  send.disabled = true;
  stopVoice();
  statusText.textContent = character?.vrm ? "..." : "..." ;

  try {
    const response = await fetch("/api/ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, message: text })
    });
    const data = await response.json();

    if (!response.ok) throw new Error(data.detail || "AI unavailable");

    statusText.textContent = "...";
    try {
      await playVoice(data.reply, data.character);
    } catch (voiceError) {
      console.warn("[C-chan voice]", voiceError);
      showReplyAnimation(data.reply, data.character);
    }
  } catch (error) {
    console.error(error);
    showSubtitle("bentar.");
  } finally {
    send.disabled = false;
    if (!currentAudio) statusText.textContent = character?.vrm ? "di sini" : "di sini";
    input.focus();
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text || send.disabled) return;
  input.value = "";
  input.style.height = "40px";
  await sendMessage(text);
});

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

input.addEventListener("input", () => {
  input.style.height = "40px";
  input.style.height = `${Math.min(input.scrollHeight, 96)}px`;
  if (character?.vrm && input.value.trim() && !send.disabled) {
    character.noticeUser("typing");
    statusText.textContent = "...";
  } else if (character?.vrm && !send.disabled) {
    statusText.textContent = "di sini";
  }
});

class CChanCharacter {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.vrm = null;
    this.expressionManager = null;
    this.mouthMorphs = new Map();
    this.mouthCurrent = new Map();
    this.mouthTarget = new Map();
    this.baseRotationY = 0;
    this.mouthTimer = null;
    this.mouthUntil = 0;
    this.mouthToken = 0;
    this.nextBlink = performance.now() + 1800;
    this.blinkUntil = 0;
    this.blinkStart = 0;
    this.blinkDuration = 180;
    this.gazeCurrent = new THREE.Vector2();
    this.gazeTarget = new THREE.Vector2();
    this.nextGaze = performance.now() + 900;
    this.gazeStart = performance.now();
    this.gazeDuration = 260;
    this.gazeMode = "user";
    this.gazeUntil = 0;
    this.gazeOffset = new THREE.Vector3();
    this.gazeTargetOffset = new THREE.Vector3();
    this.listeningUntil = 0;
    this.microExpressionUntil = 0;
    this.bones = {};
    this.restRotations = new Map();
    this.poseReady = false;
    this.animator = null;
    // The look-at target is the camera itself. This gives true eye contact;
    // the eyes never drift toward a random point in screen space.
    this.lookAtTarget = new THREE.Object3D();
    this.lookAtTarget.position.set(0, 0, 0);
    this.camera.add(this.lookAtTarget);

    this.headWorld = new THREE.Vector3();
    this.baseHeadWorld = null;
    this.baseHeadQuaternion = null;
    this.baseCameraPosition = this.camera.position.clone();
    this.baseCameraTarget = new THREE.Vector3(0, 1.06, 0);
    this.cameraTracking = new THREE.Vector3();

    // Double-click focus: the camera can smoothly look at any visible body
    // part without breaking the normal head tracking when no focus is active.
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.cameraFocusTarget = new THREE.Vector3();
    this.cameraFocusCurrent = new THREE.Vector3();
    this.cameraFocusActive = false;

    // Manual camera pan. Dragging the canvas moves the camera in world space
    // while keeping the same viewing direction.
    this.cameraPanTarget = new THREE.Vector2(0, 0);
    this.cameraPanCurrent = new THREE.Vector2(0, 0);
    this.cameraPanPointer = new THREE.Vector2();
    this.cameraPanDragging = false;
    this.cameraPanMoved = false;
    this.cameraPanStart = new THREE.Vector2();

    // Small behavioral layer over the VRMA idle clips. The goal is presence,
    // not constant motion: long quiet periods with occasional human-like
    // breathing, weight shifts, head movement and attention changes.
    this.idleMotionTime = Math.random() * 10;
    this.idleMotionSeed = Math.random() * 100;
    this.nextIdleGesture = performance.now() + 3500 + Math.random() * 6500;
    this.idleGesture = null;
    this.idleGestureStart = 0;
    this.idleGestureDuration = 1200;
    this.idleGestureAmount = 0;
    this.attention = 0;
    this.attentionTarget = 0;
    this.attentionUntil = 0;
    this.touchCooldownUntil = 0;
    this.talkMotionTime = Math.random() * 10;

    // Local companion interaction state. It survives refreshes but never leaves
    // the browser; physical interaction stays instant and does not call the AI.
    this.interactionState = this.loadInteractionState();
    this.interactionSaveTimer = null;
    this.interactionStreak = 0;
    this.lastInteractionAt = 0;
    this.lastTapAt = 0;
    this.lastTapPart = null;
    this.pointerGazeActive = false;
    this.pointerGaze = new THREE.Vector2();
    this.holdTimer = null;
    this.holdTriggered = false;
    this.touchPart = null;
    this.touchStartPoint = new THREE.Vector2();
    this.touchLastPoint = new THREE.Vector2();
    this.touchLastAt = 0;
    this.caressDistance = 0;
    this.nextInitiativeAt = performance.now() + 120000 + Math.random() * 180000;
    this.touchReaction = null;

    this.freeCamera = new FreeCameraController({
      canvas,
      camera: this.camera,
      button: freeCameraButton,
      getTarget: () => this.headWorld
    });
  }

  getBone(name) {
    return this.vrm?.humanoid?.getNormalizedBoneNode(name) || null;
  }

  cacheBones() {
    for (const name of [
      "spine", "chest", "upperChest", "head",
      "leftUpperArm", "leftLowerArm", "rightUpperArm", "rightLowerArm"
    ]) {
      const bone = this.getBone(name);
      if (!bone) continue;
      this.bones[name] = bone;
      this.restRotations.set(name, bone.quaternion.clone());
    }
  }

  applyStandingPose() {
    if (!this.poseReady) return;
    const zAxis = new THREE.Vector3(0, 0, 1);

    const relativeZ = (name, degrees) => {
      const bone = this.bones[name];
      const rest = this.restRotations.get(name);
      if (!bone || !rest) return;
      const offset = new THREE.Quaternion().setFromAxisAngle(
        zAxis,
        THREE.MathUtils.degToRad(degrees)
      );
      bone.quaternion.copy(rest).multiply(offset);
    };

    relativeZ("leftUpperArm", 62);
    relativeZ("rightUpperArm", -62);
    relativeZ("leftLowerArm", 4);
    relativeZ("rightLowerArm", -4);

    for (const name of ["spine", "chest", "upperChest"]) {
      const bone = this.bones[name];
      const rest = this.restRotations.get(name);
      if (bone && rest) bone.quaternion.copy(rest);
    }
  }

  updateStandingIdle(time) {
    if (!this.poseReady) return;
    const breath = Math.sin(time * 0.0012) * 0.006;
    const xAxis = new THREE.Vector3(1, 0, 0);

    for (const [name, amount] of [
      ["spine", 0.35],
      ["chest", 1],
      ["leftUpperArm", 0.25],
      ["rightUpperArm", 0.25]
    ]) {
      const bone = this.bones[name];
      if (!bone) continue;
      const offset = new THREE.Quaternion().setFromAxisAngle(xAxis, breath * amount);
      bone.quaternion.multiply(offset);
    }
  }

  reAnchorRootPositionTrack(clip) {
    if (!this.vrm?.humanoid) return;
    const hips = this.vrm.humanoid.getNormalizedBoneNode("hips");
    if (!hips) return;

    hips.updateMatrixWorld(true);
    const defaultHipPos = new THREE.Vector3();
    hips.getWorldPosition(defaultHipPos);

    const hipsTrack = clip.tracks.find(
      (track) =>
        track instanceof THREE.VectorKeyframeTrack &&
        track.name === `${hips.name}.position`
    );
    if (!(hipsTrack instanceof THREE.VectorKeyframeTrack)) return;

    const animationHipPos = new THREE.Vector3(
      hipsTrack.values[0],
      hipsTrack.values[1],
      hipsTrack.values[2]
    );
    const delta = animationHipPos.sub(defaultHipPos);

    for (const track of clip.tracks) {
      if (!(track instanceof THREE.VectorKeyframeTrack) || !track.name.endsWith(".position")) continue;
      for (let i = 0; i < track.values.length; i += 3) {
        track.values[i] -= delta.x;
        track.values[i + 1] -= delta.y;
        track.values[i + 2] -= delta.z;
      }
    }
  }

  setupCameraFocus() {
    const onDoubleClick = (event) => {
      if (!this.vrm || this.freeCamera?.active) return;

      const rect = this.camera.domElement?.getBoundingClientRect?.() || canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      this.raycaster.setFromCamera(this.pointer, this.camera);
      const hits = this.raycaster.intersectObject(this.vrm.scene, true);
      const hit = hits.find((entry) => entry.object?.isMesh);

      if (!hit) return;

      this.cameraFocusTarget.copy(hit.point);
      this.cameraFocusActive = true;
    };

    canvas.addEventListener("dblclick", onDoubleClick);
    this._removeCameraFocusListener = () => {
      canvas.removeEventListener("dblclick", onDoubleClick);
    };
  }

  loadInteractionState() {
    const fallback = {
      head: 0,
      nose: 0,
      cheek: 0,
      eye: 0,
      shoulder: 0,
      body: 0,
      hand: 0,
      taps: 0,
      doubleTaps: 0,
      holds: 0,
      caresses: 0,
      annoyed: 0
    };

    try {
      const saved = JSON.parse(localStorage.getItem("cchan_interactions") || "{}");
      return { ...fallback, ...saved };
    } catch {
      return fallback;
    }
  }

  saveInteractionState() {
    clearTimeout(this.interactionSaveTimer);
    this.interactionSaveTimer = setTimeout(() => {
      try {
        localStorage.setItem(
          "cchan_interactions",
          JSON.stringify(this.interactionState)
        );
      } catch {
        // Local storage is optional; interaction still works without it.
      }
    }, 300);
  }

  getBonePoint(name) {
    const bone = this.bones[name];
    if (!bone) return null;
    bone.updateMatrixWorld(true);
    const point = new THREE.Vector3();
    bone.getWorldPosition(point);
    return point;
  }

  classifyTouch(hit) {
    const objectName = String(hit?.object?.name || "").toLowerCase();
    const head = this.getBonePoint("head");

    if (/eye|eyeball/.test(objectName)) return "eye";
    if (/nose/.test(objectName)) return "nose";

    // Many VRMs use one material/mesh named only "Face", so do not depend
    // on mesh names for nose and cheek detection.
    if (head && /face|head|hair|bang|fringe|ponytail/.test(objectName)) {
      const local = hit.point.clone().sub(head);
      if (
        local.y < 0.035 &&
        Math.abs(local.x) < 0.075 &&
        local.z > -0.045
      ) {
        return "nose";
      }
      if (local.y < 0.075 && Math.abs(local.x) < 0.17) {
        return local.x < 0 ? "cheek-left" : "cheek-right";
      }
      if (local.y > 0.045) return "head";
      if (local.y > -0.035) return "eye";
      return "head";
    }

    if (/shoulder|upperarm/.test(objectName)) return "shoulder";
    if (/hand|wrist|forearm/.test(objectName)) return "hand";
    if (/chest|spine|body|torso/.test(objectName)) return "body";

    const chest = this.getBonePoint("chest") || this.getBonePoint("upperChest");
    if (head && hit.point.distanceTo(head) < 0.21) return "head";
    if (chest && hit.point.distanceTo(chest) < 0.30) return "body";
    return null;
  }

  raycastAt(clientX, clientY) {
    if (!this.vrm) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;

    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const hits = this.raycaster.intersectObject(this.vrm.scene, true);
    return hits.find((entry) => entry.object?.isMesh) || null;
  }

  reactToInteraction(part, gesture = "tap") {
    const now = performance.now();
    if (!part || now < this.touchCooldownUntil) return;

    this.lastInteractionAt = now;
    this.interactionStreak += 1;
    this.attentionTarget = 1;
    this.attentionUntil = now + 1400;
    this.nextIdleGesture = now + 2600;
    this.nextInitiativeAt = now + 120000 + Math.random() * 180000;

    const key = part.startsWith("cheek") ? "cheek" : part;
    if (this.interactionState[key] != null) this.interactionState[key] += 1;
    if (gesture === "double") this.interactionState.doubleTaps += 1;
    else if (gesture === "hold") this.interactionState.holds += 1;
    else if (gesture === "caress") this.interactionState.caresses += 1;
    else this.interactionState.taps += 1;
    this.saveInteractionState();

    const count = this.interactionState[key] || 1;
    const streak = this.interactionStreak;

    // A physical reaction must be visible even when the VRM has limited
    // facial blendshapes. Body/head motion is therefore the primary signal.
    this.touchReaction = {
      part,
      gesture,
      startedAt: now,
      duration: gesture === "hold" || gesture === "caress" ? 850 : 620,
      amount: 1
    };

    const resetStreak = setTimeout(() => {
      if (performance.now() - this.lastInteractionAt >= 1800) {
        this.interactionStreak = 0;
      }
    }, 1900);

    void resetStreak;

    if (part === "head") {
      if (gesture === "hold" || gesture === "caress") {
        this.setGaze("user", 900);
        this.setMicroExpression("soft_smile", 1000);
        this.setExpression("Joy", count > 4 ? 0.20 : 0.28);
        this.touchCooldownUntil = now + 220;
      } else if (count >= 7 || streak >= 5) {
        this.setGaze("away", 900);
        this.setExpression("Angry", 0.20);
        this.interactionState.annoyed += 1;
        this.touchCooldownUntil = now + 650;
      } else if (count >= 4 || gesture === "double") {
        this.setGaze("away", 650);
        this.setExpression("Joy", 0.12);
        this.touchCooldownUntil = now + 320;
      } else {
        this.setGaze("user", 900);
        this.setMicroExpression("soft_smile", 750);
        this.touchCooldownUntil = now + 260;
      }
      return;
    }

    if (part === "nose") {
      if (count >= 4 || streak >= 3) {
        this.setGaze("away", 900);
        this.setExpression("Angry", 0.32);
        this.interactionState.annoyed += 1;
        this.touchCooldownUntil = now + 700;
      } else {
        this.setGaze("user", 700);
        this.setExpression("Surprised", gesture === "double" ? 0.62 : 0.48);
        this.microExpressionUntil = now + 700;
        this.touchCooldownUntil = now + 350;
      }
      this.saveInteractionState();
      return;
    }

    if (part === "eye") {
      this.blink();
      this.setGaze("away", count >= 3 ? 1000 : 600);
      if (count >= 3) {
        this.setExpression("Angry", 0.18);
        this.interactionState.annoyed += 1;
      }
      this.touchCooldownUntil = now + 500;
      this.saveInteractionState();
      return;
    }

    if (part === "cheek-left" || part === "cheek-right") {
      if (gesture === "caress" || gesture === "hold") {
        this.setGaze("user", 850);
        this.setMicroExpression("soft_smile", 900);
        this.setExpression("Joy", 0.22);
      } else {
        this.setGaze("away", count >= 5 ? 900 : 650);
        this.setExpression("Joy", count >= 5 ? 0.12 : 0.28);
      }
      if (count >= 8) {
        this.setExpression("Angry", 0.16);
        this.interactionState.annoyed += 1;
      }
      this.touchCooldownUntil = now + 280;
      this.saveInteractionState();
      return;
    }

    if (part === "shoulder") {
      this.setGaze("away", gesture === "double" ? 900 : 600);
      this.setMicroExpression("curious", 550);
      this.touchCooldownUntil = now + 300;
      return;
    }

    if (part === "hand") {
      this.setGaze("down", 650);
      this.setMicroExpression("curious", 500);
      this.touchCooldownUntil = now + 260;
      return;
    }

    if (part === "body") {
      this.setGaze("down", 650);
      this.setMicroExpression("curious", 550);
      this.touchCooldownUntil = now + 300;
    }
  }

  setupTouchInteraction() {
    let downX = 0;
    let downY = 0;
    let downTime = 0;
    let downPart = null;
    let pointerId = null;

    const onPointerDown = (event) => {
      if (!this.vrm || this.freeCamera?.active || event.button !== 0) return;

      const hit = this.raycastAt(event.clientX, event.clientY);
      downPart = this.classifyTouch(hit);
      if (!downPart) return;

      pointerId = event.pointerId;
      downX = event.clientX;
      downY = event.clientY;
      this.touchStartPoint.set(downX, downY);
      this.touchLastPoint.set(downX, downY);
      this.touchLastAt = performance.now();
      this.caressDistance = 0;
      downTime = performance.now();
      this.touchPart = downPart;
      this.holdTriggered = false;

      clearTimeout(this.holdTimer);
      this.holdTimer = setTimeout(() => {
        if (!this.touchPart || this.cameraPanMoved) return;
        this.holdTriggered = true;
        this.reactToInteraction(this.touchPart, "hold");
      }, 520);
    };

    const onPointerMove = (event) => {
      if (pointerId !== event.pointerId) return;

      const now = performance.now();
      const step = Math.hypot(
        event.clientX - this.touchLastPoint.x,
        event.clientY - this.touchLastPoint.y
      );
      this.caressDistance += step;
      this.touchLastPoint.set(event.clientX, event.clientY);
      this.touchLastAt = now;

      // While a finger/mouse is moving slowly over the character, keep the
      // eyes on it and allow the head/cheek interaction to feel continuous.
      if (!this.touchPart || this.cameraPanMoved) return;
      if (this.caressDistance < 18) return;

      const hit = this.raycastAt(event.clientX, event.clientY);
      const part = this.classifyTouch(hit);
      if (!part) return;

      if (
        (this.touchPart === "head" && part === "head") ||
        (this.touchPart?.startsWith("cheek") && part?.startsWith("cheek"))
      ) {
        this.setGaze("user", 220);
        this.setMicroExpression("soft_smile", 260);
      }
    };

    const finishPointer = (event) => {
      if (pointerId !== event.pointerId) return;

      clearTimeout(this.holdTimer);
      this.holdTimer = null;

      const moved = Math.hypot(event.clientX - downX, event.clientY - downY);
      const elapsed = performance.now() - downTime;
      const part = this.touchPart;

      pointerId = null;
      this.touchPart = null;

      if (!part || this.cameraPanMoved || moved > 14) return;

      if (this.holdTriggered) return;

      const now = performance.now();
      const isDouble =
        this.lastTapPart === part &&
        now - this.lastTapAt >= 80 &&
        now - this.lastTapAt <= 360;

      this.lastTapAt = now;
      this.lastTapPart = part;

      if (isDouble) {
        this.reactToInteraction(part, "double");
        this.lastTapAt = 0;
        this.lastTapPart = null;
      } else if (elapsed >= 170 && this.caressDistance >= 24) {
        this.reactToInteraction(part, "caress");
      } else {
        this.reactToInteraction(part, "tap");
      }
    };

    const onPointerCancel = (event) => {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
      if (pointerId === event.pointerId) {
        pointerId = null;
        this.touchPart = null;
      }
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", finishPointer);
    canvas.addEventListener("pointercancel", onPointerCancel);

    this._removeTouchListeners = () => {
      clearTimeout(this.holdTimer);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", finishPointer);
      canvas.removeEventListener("pointercancel", onPointerCancel);
    };
  }

  setupPointerGaze() {
    const onPointerMove = (event) => {
      if (!this.vrm || this.cameraPanDragging) return;

      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      const y = ((event.clientY - rect.top) / rect.height) * 2 - 1;
      const distance = Math.hypot(x, y);

      this.pointerGazeActive = distance < 1.05;
      if (!this.pointerGazeActive) return;

      this.pointerGaze.set(x, -y);
      if (!this.gazeUntil) {
        this.gazeTargetOffset.set(
          THREE.MathUtils.clamp(x * 0.34, -0.34, 0.34),
          THREE.MathUtils.clamp(-y * 0.22, -0.22, 0.22),
          -0.08
        );
      }
    };

    const onPointerLeave = () => {
      this.pointerGazeActive = false;
      if (!this.gazeUntil) this.gazeTargetOffset.set(0, 0, 0);
    };

    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerleave", onPointerLeave);

    this._removePointerGazeListeners = () => {
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerleave", onPointerLeave);
    };
  }

  setupCameraPan() {
    const onPointerDown = (event) => {
      if (!this.vrm || event.button !== 0) return;

      this.cameraPanDragging = true;
      this.cameraPanMoved = false;
      this.cameraPanPointer.set(event.clientX, event.clientY);
      this.cameraPanStart.set(event.clientX, event.clientY);
      this.cameraFocusActive = false;
      canvas.classList.add("is-panning");
      canvas.setPointerCapture?.(event.pointerId);
    };

    const onPointerMove = (event) => {
      if (!this.cameraPanDragging) return;

      const dx = event.clientX - this.cameraPanPointer.x;
      const dy = event.clientY - this.cameraPanPointer.y;

      if (Math.abs(event.clientX - this.cameraPanStart.x) + Math.abs(event.clientY - this.cameraPanStart.y) > 4) {
        this.cameraPanMoved = true;
      }

      this.cameraPanTarget.x = THREE.MathUtils.clamp(
        this.cameraPanTarget.x - dx * 0.0024,
        -0.65,
        0.65
      );
      this.cameraPanTarget.y = THREE.MathUtils.clamp(
        this.cameraPanTarget.y + dy * 0.0020,
        -0.38,
        0.38
      );

      this.cameraPanPointer.set(event.clientX, event.clientY);
    };

    const stopPan = (event) => {
      if (!this.cameraPanDragging) return;
      this.cameraPanDragging = false;
      canvas.classList.remove("is-panning");
      if (event?.pointerId != null) {
        canvas.releasePointerCapture?.(event.pointerId);
      }
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", stopPan);
    canvas.addEventListener("pointercancel", stopPan);

    this._removeCameraPanListeners = () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", stopPan);
      canvas.removeEventListener("pointercancel", stopPan);
    };
  }

  async load(url) {
    try {
      const vrm = await loadVrm(url, (progress) => {
        statusText.textContent = progress.total
          ? `loading ${Math.round((progress.loaded / progress.total) * 100)}%`
          : "loading VRM...";
      });

      this.vrm = vrm;
      this.expressionManager = vrm.expressionManager;
      this.setupCameraFocus();
      this.setupCameraPan();
      this.setupTouchInteraction();
      this.setupPointerGaze();
      this.cacheMouthMorphs();
      this.scene.add(vrm.scene);
      normalizeVrm(vrm, 1.65);

      this.cacheBones();
      this.poseReady = Object.keys(this.bones).length > 0;

      const head = this.bones.head;
      if (head) {
        head.updateMatrixWorld(true);
        this.baseHeadWorld = new THREE.Vector3();
        this.baseHeadQuaternion = new THREE.Quaternion();
        head.getWorldPosition(this.baseHeadWorld);
        head.getWorldQuaternion(this.baseHeadQuaternion);      }

      this.restRotations = new Map(
        Object.entries(this.bones).map(([name, bone]) => [name, bone.quaternion.clone()])
      );

      attachLookAtProxy(vrm, this.lookAtTarget);

      this.animator = new AvatarAnimator(vrm.scene, {
        idleUrls: IDLE_URLS,
        talkingUrl: TALKING_URL,
        reanchor: (clip) => this.reAnchorRootPositionTrack(clip)
      });
      this.animator.setVrm(vrm);
      this.animator.startIdlePool();
      void this.animator.preloadTalking();

      this.baseRotationY = vrm.scene.rotation.y;
      this.setExpression("Neutral", 1);
      this.applyStandingPose();


      statusText.textContent = "di sini";
    } catch (error) {
      console.error("[C-chan VRM]", error);
      statusText.textContent = "sebentar...";
      throw error;
    }
  }

  setGaze(mode = "user", duration = 900) {
    const now = performance.now();
    this.gazeMode = mode;
    this.gazeUntil = now + duration;

    if (mode === "away") {
      const side = Math.random() < 0.5 ? -1 : 1;
      this.gazeTargetOffset.set(side * (0.22 + Math.random() * 0.10), -0.02, -0.12);
    } else if (mode === "down") {
      this.gazeTargetOffset.set((Math.random() - 0.5) * 0.08, -0.16, -0.08);
    } else {
      this.gazeTargetOffset.set(0, 0, 0);
    }
  }

  setMicroExpression(type = "neutral", duration = 1200) {
    const now = performance.now();
    this.microExpressionUntil = now + duration;
    if (type === "listening") this.setExpression("Surprised", 0.16);
    else if (type === "curious") this.setExpression("Surprised", 0.20);
    else if (type === "amused") this.setExpression("Joy", 0.20);
    else if (type === "soft_smile") this.setExpression("Joy", 0.14);
  }

  clearMicroExpression() {
    this.setExpression("Surprised", 0);
    this.setExpression("Joy", 0);
    this.microExpressionUntil = 0;
  }

  noticeUser(kind = "message") {
    const now = performance.now();
    this.attentionTarget = 1;
    this.attentionUntil = now + (kind === "typing" ? 1200 : 1800);
    this.nextIdleGesture = Math.min(this.nextIdleGesture, now + 650);
    if (kind === "typing") {
      this.listeningUntil = now + 1200;
      this.setGaze("user", 700);
      this.setMicroExpression("listening", 850);
    } else {
      this.setGaze("user", 1100);
      this.setMicroExpression("curious", 900);
    }
  }

  startResponseAttention() {
    const now = performance.now();
    this.attentionTarget = 1;
    this.attentionUntil = now + 2600;
    this.nextIdleGesture = now + 350;
    this.setGaze("user", 1700);
    this.setMicroExpression("curious", 700);
  }

  startSpeaking() {
    this.setGaze("user", 900);
    this.animator?.setTalking(true);
  }

  stopSpeaking() {
    this.animator?.setTalking(false);
    this.setGaze("user", 1200);
    this.setMicroExpression("soft_smile", 900);
  }

  chooseIdleGesture(now) {
    if (this.idleGesture || now < this.nextIdleGesture) return;

    const choices = [
      { type: "tilt", duration: 900 + Math.random() * 700 },
      { type: "shift", duration: 1200 + Math.random() * 1000 },
      { type: "lookAway", duration: 1400 + Math.random() * 1100 }
    ];

    // Avoid doing a gesture while the character is actively responding.
    if (this.attention > 0.82) {
      this.nextIdleGesture = now + 1800 + Math.random() * 2800;
      return;
    }

    this.idleGesture = choices[Math.floor(Math.random() * choices.length)];
    this.idleGestureStart = now;
    this.idleGestureDuration = this.idleGesture.duration;
    this.idleGestureAmount = 0.8 + Math.random() * 0.2;
  }

  updateNaturalIdle(delta, now) {
    if (!this.vrm || !this.poseReady) return;

    this.idleMotionTime += delta;

    // Physical touch reaction: short, deliberately readable motion layered
    // over idle. It fades back to the normal pose instead of snapping.
    let touchTilt = 0;
    let touchYaw = 0;
    let touchLean = 0;
    if (this.touchReaction) {
      const reaction = this.touchReaction;
      const progress = THREE.MathUtils.clamp(
        (now - reaction.startedAt) / reaction.duration,
        0,
        1
      );
      const pulse = Math.sin(progress * Math.PI);
      const side = reaction.part === "cheek-left" || reaction.part === "shoulder" ? -1 : 1;

      if (reaction.part === "head") {
        touchTilt = side * 0.10 * pulse;
        touchYaw = -side * 0.035 * pulse;
      } else if (reaction.part === "nose") {
        touchYaw = side * 0.08 * pulse;
        touchLean = -0.035 * pulse;
      } else if (reaction.part === "cheek-left" || reaction.part === "cheek-right") {
        touchYaw = side * 0.12 * pulse;
        touchTilt = -side * 0.035 * pulse;
      } else if (reaction.part === "eye") {
        touchYaw = side * 0.06 * pulse;
      } else if (reaction.part === "shoulder") {
        touchLean = side * 0.055 * pulse;
      } else if (reaction.part === "body" || reaction.part === "hand") {
        touchLean = 0.035 * pulse;
      }

      if (progress >= 1) this.touchReaction = null;
    }
    const elapsed = now - this.idleGestureStart;

    if (this.attentionUntil && now > this.attentionUntil) {
      this.attentionTarget = 0;
      this.attentionUntil = 0;
    }

    // Very occasional initiative: after a few quiet minutes C-chan notices
    // the user without generating a message or consuming an AI request.
    if (
      now >= this.nextInitiativeAt &&
      !this.idleGesture &&
      !this.attention &&
      !this.animator?.talking &&
      !this.animator?.emote &&
      !this.animator?.thinking
    ) {
      this.nextInitiativeAt = now + 120000 + Math.random() * 180000;
      this.setGaze("user", 1500);
      this.setMicroExpression(Math.random() < 0.45 ? "soft_smile" : "curious", 900);
      this.nextIdleGesture = now + 2200;
    }

    const attentionSmooth = 1 - Math.exp(-5 * Math.max(delta, 0.001));
    this.attention = THREE.MathUtils.lerp(this.attention, this.attentionTarget, attentionSmooth);

    this.chooseIdleGesture(now);

    const wave = this.idleMotionTime;
    this.talkMotionTime += delta;

    const breathing = Math.sin(wave * 1.35 + this.idleMotionSeed) * 0.0035;
    const sway = Math.sin(wave * 0.43 + this.idleMotionSeed * 0.7) * 0.004;
    const shoulder = Math.sin(wave * 0.72 + this.idleMotionSeed) * 0.006;

    // Speech body language is deliberately small and continuous. It does not
    // replace the idle animation; it gently adds posture, nods and breathing
    // that naturally fade with the talkingBlend.
    const talkBlend = this.animator?.talkingBlend || 0;
    const talkWave = this.talkMotionTime;
    const talkBreath = Math.sin(talkWave * 2.15 + this.idleMotionSeed) * 0.004;
    const talkNod = Math.sin(talkWave * 1.45 + this.idleMotionSeed * 0.35) * 0.010;
    const talkSway = Math.sin(talkWave * 0.72 + this.idleMotionSeed) * 0.006;
    const talkShoulder = Math.sin(talkWave * 1.9 + this.idleMotionSeed * 0.6) * 0.008;

    let tilt = sway + talkSway * talkBlend;
    let shift = sway * 0.75 + talkSway * 0.35 * talkBlend;
    let lookAway = 0;

    if (this.idleGesture) {
      const p = THREE.MathUtils.clamp(elapsed / this.idleGestureDuration, 0, 1);
      const eased = Math.sin(p * Math.PI);

      if (this.idleGesture.type === "tilt") {
        tilt = eased * 0.028 * this.idleGestureAmount;
      } else if (this.idleGesture.type === "shift") {
        shift = eased * 0.012 * this.idleGestureAmount;
      } else if (this.idleGesture.type === "lookAway") {
        lookAway = eased * 0.16 * this.idleGestureAmount;
        if (p < 0.82) this.setGaze("away", this.idleGestureDuration * 0.72);
      }

      if (p >= 1) {
        this.idleGesture = null;
        this.idleGestureAmount = 0;
        this.nextIdleGesture = now + 5000 + Math.random() * 8500;
      }
    }

    const head = this.bones.head;
    const chest = this.bones.chest || this.bones.upperChest;
    const spine = this.bones.spine;

    if (head) {
      const rest = this.restRotations.get("head");
      if (rest) {
        const q = new THREE.Quaternion().setFromEuler(
          new THREE.Euler(
            breathing * 0.55 + touchLean + talkBreath * 0.45 * talkBlend + talkNod * 0.55 * talkBlend,
            shift * 0.55 - lookAway + touchYaw + talkSway * 0.35 * talkBlend,
            tilt + shoulder * 0.35 + touchTilt + talkShoulder * 0.35 * talkBlend,
            "XYZ"
          )
        );
        head.quaternion.multiply(q);
      }
    }

    if (chest) {
      const rest = this.restRotations.get(this.bones.chest ? "chest" : "upperChest");
      if (rest) {
        const q = new THREE.Quaternion().setFromEuler(
          new THREE.Euler(
            breathing + talkBreath * 0.35 * talkBlend,
            shift * 0.35 + talkSway * 0.25 * talkBlend,
            shoulder + talkShoulder * 0.55 * talkBlend,
            "XYZ"
          )
        );
        chest.quaternion.multiply(q);
      }
    }

    if (spine) {
      const rest = this.restRotations.get("spine");
      if (rest) {
        const q = new THREE.Quaternion().setFromEuler(
          new THREE.Euler(
            breathing * 0.7 + talkBreath * 0.25 * talkBlend,
            shift * 0.2 + talkSway * 0.18 * talkBlend,
            shoulder * 0.35 + talkShoulder * 0.30 * talkBlend,
            "XYZ"
          )
        );
        spine.quaternion.multiply(q);
      }
    }
  }

  applyCharacterState(state, text, timeline = null) {
    const meta = state || {};
    this.startResponseAttention();
    const emotion = meta.emotion || detectEmotion(text);
    this.setEmotion(emotion);
    if (emotion === "Joy") this.setMicroExpression("amused", 1600);
    else if (emotion === "Angry") this.setGaze("away", 1200);
    else if (emotion === "Surprised") this.setMicroExpression("curious", 1300);
    else if (emotion === "Sorrow") this.setGaze("down", 1100);
    else this.setMicroExpression("soft_smile", 900);

    const action = meta.action || "idle";
    if (action !== "idle" && MOTION_URLS[action]) {
      void this.animator?.play(action, { fade: 0.16 });
    }

    this.syncCaptionLipSync(timeline || buildSpeechTimeline(text));
  }

  setExpression(name, value) {
    if (!this.expressionManager) return;
    try {
      const expressionAliases = {
        A: "aa",
        I: "ih",
        U: "ou",
        E: "ee",
        O: "oh",
        Joy: "happy",
        Angry: "angry",
        Sorrow: "sad",
        Surprised: "surprised",
        Blink: "blink"
      };
      this.expressionManager.setValue(expressionAliases[name] || name, value);
    } catch (error) {
      console.debug("[C-chan expression]", name, error);
    }
  }

  cacheMouthMorphs() {
    this.mouthMorphs.clear();

    const aliases = {
      A: ["A", "a", "aa", "Aa", "vrc.v_aa", "v_aa"],
      I: ["I", "i", "ih", "Ih", "vrc.v_ih", "v_ih"],
      U: ["U", "u", "ou", "Ou", "vrc.v_ou", "v_ou"],
      E: ["E", "e", "ee", "Ee", "vrc.v_ee", "v_ee"],
      O: ["O", "o", "oh", "Oh", "vrc.v_oh", "v_oh"]
    };

    const normalized = (value) => String(value || "").replace(/[._\-\s]/g, "").toLowerCase();

    for (const vowel of Object.keys(aliases)) {
      const names = new Set(aliases[vowel].map(normalized));

      for (const object of this.vrm.scene.traverse ? this.vrm.scene.children : []) {
        object.traverse?.((node) => {
          if (!node.isMesh || !node.morphTargetDictionary || !node.morphTargetInfluences) return;

          for (const [targetName, index] of Object.entries(node.morphTargetDictionary)) {
            if (!names.has(normalized(targetName))) continue;

            if (!this.mouthMorphs.has(vowel)) this.mouthMorphs.set(vowel, []);
            this.mouthMorphs.get(vowel).push({ mesh: node, index });
          }
        });
      }

      this.mouthCurrent.set(vowel, 0);
      this.mouthTarget.set(vowel, 0);
    }

    const count = [...this.mouthMorphs.values()].reduce((sum, items) => sum + items.length, 0);
    console.debug("[C-chan mouth] morph targets:", count, Object.fromEntries(
      [...this.mouthMorphs.entries()].map(([key, value]) => [key, value.length])
    ));
  }

  setMouthMorph(vowel, value) {
    const targets = this.mouthMorphs.get(vowel);
    if (!targets?.length) return;

    for (const target of targets) {
      target.mesh.morphTargetInfluences[target.index] = value;
    }
  }

  updateMouthMorphs(delta) {
    const smooth = 1 - Math.exp(-18 * Math.max(delta, 0.001));

    for (const vowel of ["A", "I", "U", "E", "O"]) {
      const current = this.mouthCurrent.get(vowel) || 0;
      const target = this.mouthTarget.get(vowel) || 0;
      const next = THREE.MathUtils.lerp(current, target, smooth);

      this.mouthCurrent.set(vowel, next);
      this.setExpression(vowel, next);
      this.setMouthMorph(vowel, next);
    }
  }

  setEmotion(name) {
    for (const emotion of ["Joy", "Angry", "Sorrow", "Surprised"]) {
      this.setExpression(emotion, emotion === name ? 0.65 : 0);
    }
  }

  blink() {
    const now = performance.now();
    this.blinkStart = now;
    this.blinkDuration = 180;
    this.blinkUntil = now + this.blinkDuration;
  }

  updateBlink(now) {
    if (now >= this.nextBlink) {
      this.blink();
      this.nextBlink = now + 2600 + Math.random() * 4300;
    }

    if (!this.blinkUntil) return;

    const progress = THREE.MathUtils.clamp(
      (now - this.blinkStart) / this.blinkDuration, 0, 1
    );
    const value = progress < 0.5 ? progress * 2 : (1 - progress) * 2;
    this.setExpression("Blink", Math.sin(value * Math.PI * 0.5));

    if (progress >= 1) {
      this.setExpression("Blink", 0);
      this.blinkUntil = 0;
    }
  }

  updateGaze(now = performance.now(), delta = 0.016) {
    if (!this.vrm?.lookAt) return;

    if (this.gazeUntil && now >= this.gazeUntil) {
      this.gazeMode = "user";
      this.gazeUntil = 0;
      if (this.pointerGazeActive) {
        const x = this.pointerGaze.x;
        const y = this.pointerGaze.y;
        this.gazeTargetOffset.set(
          THREE.MathUtils.clamp(x * 0.34, -0.34, 0.34),
          THREE.MathUtils.clamp(y * 0.22, -0.22, 0.22),
          -0.08
        );
      } else {
        this.gazeTargetOffset.set(0, 0, 0);
      }
    }

    if (!this.gazeUntil && this.pointerGazeActive && !this.touchPart) {
      const x = this.pointerGaze.x;
      const y = this.pointerGaze.y;
      this.gazeTargetOffset.set(
        THREE.MathUtils.clamp(x * 0.34, -0.34, 0.34),
        THREE.MathUtils.clamp(y * 0.22, -0.22, 0.22),
        -0.08
      );
    }

    this.gazeOffset.lerp(this.gazeTargetOffset, 1 - Math.exp(-7 * Math.max(delta, 0.001)));
    this.lookAtTarget.position.copy(this.gazeOffset);

    // VRM animations can write look-at state during vrm.update(). Apply the
    // final gaze after that update so normal conversation always has real
    // eye contact with the camera, while away/down modes still override it.
    if (this.gazeMode === "user") {
      this.lookAtTarget.updateWorldMatrix(true, false);
      const targetWorld = new THREE.Vector3();
      this.lookAtTarget.getWorldPosition(targetWorld);
      this.vrm.lookAt.lookAt(targetWorld);
    }

    if (this.microExpressionUntil && now >= this.microExpressionUntil) {
      this.clearMicroExpression();
    }
  }

  syncCaptionLipSync(timeline) {
    if (!timeline?.duration) return;

    cancelAnimationFrame(this.mouthTimer);
    clearTimeout(this.mouthTimer);
    clearInterval(this.mouthTimer);

    const token = ++this.mouthToken;
    const startedAt = performance.now();

    for (const vowel of ["A", "I", "U", "E", "O"]) {
      this.mouthTarget.set(vowel, 0);
    }

    const update = () => {
      if (token !== this.mouthToken) return;

      const elapsed = performance.now() - startedAt;
      if (elapsed >= timeline.duration) {
        for (const vowel of ["A", "I", "U", "E", "O"]) {
          this.mouthTarget.set(vowel, 0);
        }
        this.mouthTimer = null;
        return;
      }

      let active = null;
      let strength = 0;

      for (const viseme of timeline.visemes) {
        const distance = elapsed - viseme.time;
        if (distance >= 0 && distance <= viseme.duration) {
          const progress = distance / viseme.duration;
          active = viseme.vowel;
          strength = viseme.strength * Math.sin(progress * Math.PI);
          break;
        }
      }

      for (const vowel of ["A", "I", "U", "E", "O"]) {
        this.mouthTarget.set(vowel, vowel === active ? strength : 0);
      }

      this.mouthTimer = requestAnimationFrame(update);
    };

    this.mouthTimer = requestAnimationFrame(update);
  }

  update(delta) {
    if (!this.vrm) return;

    this.animator?.update(delta);

    // Layer subtle behavior over the loaded VRMA idle. It stays almost still
    // most of the time, then makes small, non-repeating movements.
    if (!this.animator?.emote && !this.animator?.thinking) {
      this.updateNaturalIdle(delta, performance.now());
    }

    this.vrm.update(delta);

    // Apply mouth after vrm.update(): direct morph fallback must be the final
    // writer for the frame, otherwise the VRM expression update can overwrite it.
    this.updateMouthMorphs(delta);

    const now = performance.now();
    this.updateBlink(now);
    this.updateGaze(now, delta);

    // Keep the character's root stable. The camera, not the root, follows the
    // actual head orientation so a left/right head turn changes the viewpoint.
    this.vrm.scene.rotation.y = this.baseRotationY;

    const head = this.bones.head;
    if (head && this.baseHeadWorld) {
      head.updateMatrixWorld(true);
      head.getWorldPosition(this.headWorld);

      const headQuaternion = new THREE.Quaternion();
      head.getWorldQuaternion(headQuaternion);

      // Follow only the head's rotation relative to its starting orientation.
      // Using the absolute head forward vector makes the VRM's internal/rest
      // orientation decide what "left" and "right" mean, which can invert the
      // camera orbit for a differently oriented model.
      let headYaw = 0;
      if (this.baseHeadQuaternion) {
        const relativeHeadRotation = this.baseHeadQuaternion.clone().invert().multiply(headQuaternion);
        const relativeEuler = new THREE.Euler().setFromQuaternion(
          relativeHeadRotation,
          "YXZ"
        );
        headYaw = THREE.MathUtils.clamp(relativeEuler.y, -0.72, 0.72);
      }

      if (this.freeCamera?.active) {
        this.freeCamera.update(delta);
      } else {
      const followDistance = 2.05;
      const baseOffset = this.baseCameraPosition.clone().sub(this.baseHeadWorld);
      baseOffset.y += 0.02;
      baseOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), headYaw);

      const desiredHeadCamera = this.headWorld.clone().add(baseOffset);

      const dx = this.headWorld.x - this.baseHeadWorld.x;
      const dy = this.headWorld.y - this.baseHeadWorld.y;
      const panX = this.cameraPanCurrent.x;
      const panY = this.cameraPanCurrent.y;

      desiredHeadCamera.x += panX;
      desiredHeadCamera.y += panY;

      // Keep a small amount of body-position tracking so normal idle movement
      // remains grounded while the relative head yaw drives the camera orbit.
      desiredHeadCamera.x += dx * 0.18;
      desiredHeadCamera.y += dy * 0.18;

      const cameraFollow = 1 - Math.exp(-8 * Math.max(delta, 0.001));
      this.camera.position.lerp(desiredHeadCamera, cameraFollow);

      this.cameraPanCurrent.lerp(
        this.cameraPanTarget,
        1 - Math.exp(-12 * Math.max(delta, 0.001))
      );

      // Double-click focus remains available, but normal conversation always
      // uses the head as the camera's physical reference.
      if (this.cameraFocusActive) {
        this.cameraFocusCurrent.lerp(
          this.cameraFocusTarget,
          1 - Math.exp(-7 * Math.max(delta, 0.001))
        );
        this.cameraTracking.lerp(
          this.cameraFocusCurrent,
          1 - Math.exp(-7 * Math.max(delta, 0.001))
        );

        if (this.cameraFocusCurrent.distanceTo(this.cameraFocusTarget) < 0.012) {
          this.cameraFocusCurrent.copy(this.cameraFocusTarget);
        }

        this.camera.lookAt(this.cameraTracking);
      } else {
        // Keep the face centered. The orbit itself now carries the head yaw,
        // so the target must not apply a second forward-direction inversion.
        const desiredHeadTarget = this.headWorld.clone()
          .add(new THREE.Vector3(0, -0.015, 0));

        this.cameraTracking.lerp(
          desiredHeadTarget,
          1 - Math.exp(-11 * Math.max(delta, 0.001))
        );
        this.camera.lookAt(this.cameraTracking);
      }

      }
    }

    if (!this.animator?.emote && !this.animator?.idle && !this.animator?.thinking) {
      this.applyStandingPose();
      this.updateStandingIdle(now);
    }
  }

  dispose() {
    this._removeCameraFocusListener?.();
    this._removeCameraPanListeners?.();
    this._removeTouchListeners?.();
    this._removePointerGazeListeners?.();
    this.freeCamera?.dispose();
    clearTimeout(this.holdTimer);
    clearTimeout(this.interactionSaveTimer);
    cancelAnimationFrame(this.mouthTimer);
    clearTimeout(this.mouthTimer);
    clearInterval(this.mouthTimer);
    ++this.mouthToken;
    for (const vowel of ["A", "I", "U", "E", "O"]) {
      this.mouthTarget.set(vowel, 0);
      this.mouthCurrent.set(vowel, 0);
    }
    this.animator?.dispose();
    this.animator = null;
  }
}

async function initVRM() {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true
  });

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // Soft anime-game presentation: preserve shadow detail without washing out
  // the VRM under bright default lighting.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    30,
    canvas.clientWidth / canvas.clientHeight,
    0.01,
    100
  );

  // Slightly higher camera position and target keep the head comfortably framed
  // instead of crowding the top of the viewport.
  camera.position.set(0, 1.12, 2.05);
  camera.lookAt(0, 1.06, 0);

  // Anime shader reference lighting: restrained key, cool ambient fill,
  // and a subtle back rim. Kept outside the VRM loader so rendering changes
  // remain isolated and reversible.
  createAnimeLighting(scene);

  character = new CChanCharacter(scene, camera);

  try {
    await character.load("/vrm/cchan.vrm");
    applyAnimeShader(character.vrm);

  } catch (error) {
    console.error("[C-chan] character initialization failed", error);
    statusText.textContent = "VRM error";
  }

  function resize() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;

    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  }

  window.addEventListener("resize", resize);
  window.addEventListener("beforeunload", () => character?.dispose());
  resize();

  const clock = new THREE.Clock();

  function animate() {
    requestAnimationFrame(animate);
    character.update(clock.getDelta());
    renderer.render(scene, camera);
  }

  animate();
}

initVRM().catch((error) => {
  console.error("[C-chan]", error);
  statusText.textContent = "sebentar...";
});