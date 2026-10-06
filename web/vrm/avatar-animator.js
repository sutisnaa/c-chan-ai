import * as THREE from "three";
import { MOTION_URLS, loadAnimationClip } from "./animation-library.js";

export class AvatarAnimator {
  constructor(root, options = {}) {
    this.mixer = new THREE.AnimationMixer(root);
    this.reanchor = options.reanchor || null;
    this.idle = null;
    this.talking = null;
    this.thinking = null;
    this.emote = null;
    this.currentName = null;
    this.disposed = false;
    this.loadToken = 0;
    this.thinkingToken = 0;
    this.idleCycle = null;
    this.lastIdle = null;
    this.idleUrls = options.idleUrls || [];
    this.talkingUrl = options.talkingUrl || null;
    this.talkingClip = null;
    this.talkingActive = false;
    this.talkingBlend = 0;
    this.onIdleReady = options.onIdleReady || (() => {});
  }

  async play(name, { speed = 1, fade = 0.2 } = {}) {
    const url = MOTION_URLS[name];
    if (!url || this.disposed || !this.vrm) return false;

    const token = ++this.loadToken;
    try {
      const clip = await loadAnimationClip(url, this.vrm, this.reanchor);
      if (this.disposed || token !== this.loadToken) return false;

      this.idle?.fadeOut(fade);
      this.idle = null;
      this.talking?.fadeOut(fade);
      this.talking = null;
      this.thinking?.fadeOut(fade);
      this.thinking = null;
      this.emote?.fadeOut(fade);

      const action = this.mixer.clipAction(clip);
      action.reset();
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.timeScale = speed;
      action.fadeIn(fade).play();

      this.emote = action;
      this.currentName = name;

      const onFinished = (event) => {
        if (event.action !== action) return;
        this.mixer.removeEventListener("finished", onFinished);
        if (this.emote !== action) return;

        action.fadeOut(0.28);
        this.emote = null;
        this.currentName = null;
        this.startIdlePool();
      };

      this.mixer.addEventListener("finished", onFinished);
      return true;
    } catch (error) {
      console.warn("[C-chan animation]", name, error);
      if (!this.emote && !this.idle) this.startIdlePool();
      return false;
    }
  }

  setVrm(vrm) {
    this.vrm = vrm;
  }

  async preloadTalking() {
    if (!this.talkingUrl || this.talkingClip || this.disposed || !this.vrm) return;
    try {
      this.talkingClip = await loadAnimationClip(this.talkingUrl, this.vrm, this.reanchor);
    } catch (error) {
      console.debug("[C-chan talking]", error);
    }
  }

  setTalking(active) {
    if (this.disposed || !this.vrm) return;
    this.talkingActive = Boolean(active);
    // Talking is now a procedural layer over the existing idle clip.
    // Keeping the idle action alive removes the hard pose swap at speech
    // start/end; talkingBlend eases the body language in and out.
    this.talking = this.talkingActive;
  }

  async startThinking(url) {
    if (!url || this.disposed || this.thinking || !this.vrm) return;
    const token = ++this.thinkingToken;
    try {
      const clip = await loadAnimationClip(url, this.vrm, this.reanchor);
      if (this.disposed || token !== this.thinkingToken) return;
      this.idle?.fadeOut(0.3);
      this.idle = null;
      const action = this.mixer.clipAction(clip);
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.reset().fadeIn(0.3).play();
      this.thinking = action;
    } catch (error) {
      console.debug("[C-chan thinking]", error);
    }
  }

  stopThinking(resume = true) {
    ++this.thinkingToken;
    this.thinking?.fadeOut(0.3);
    this.thinking = null;
    if (resume && !this.emote) this.startIdlePool();
  }

  startIdlePool() {
    if (!this.idleUrls.length || this.disposed || this.emote || this.thinking || !this.vrm) return;
    this.playNextIdle(false);
  }

  async playNextIdle(crossfade = true) {
    if (!this.idleUrls.length || this.disposed || this.emote || this.thinking || !this.vrm) return;

    const choices = this.idleUrls.filter((url) => url !== this.lastIdle);
    const url = choices[Math.floor(Math.random() * Math.max(choices.length, 1))] || this.idleUrls[0];

    try {
      const clip = await loadAnimationClip(url, this.vrm, this.reanchor);
      if (this.disposed || this.emote || this.thinking) return;

      this.idle?.fadeOut(crossfade ? 1.2 : 0);
      const action = this.mixer.clipAction(clip);
      action.setLoop(THREE.LoopRepeat, Infinity);
      if (crossfade) action.reset().fadeIn(1.2).play();
      else action.reset().play();

      this.idle = action;
      this.lastIdle = url;
      this.onIdleReady();
      this.scheduleIdleCycle(clip.duration);
    } catch (error) {
      console.debug("[C-chan idle]", error);
    }
  }

  scheduleIdleCycle(duration) {
    if (this.idleCycle) clearTimeout(this.idleCycle);
    this.idleCycle = setTimeout(() => {
      if (!this.disposed && !this.emote && !this.talking && !this.thinking) {
        this.playNextIdle(true);
      }
    }, duration * (1 + Math.random()) * 1000);
  }

  update(delta) {
    this.mixer.update(delta);
    const target = this.talkingActive ? 1 : 0;
    this.talkingBlend = THREE.MathUtils.lerp(
      this.talkingBlend,
      target,
      1 - Math.exp(-5.5 * Math.max(delta, 0.001))
    );
    if (!this.talkingActive && this.talkingBlend < 0.001) {
      this.talkingBlend = 0;
      this.talking = false;
    } else if (this.talkingActive) {
      this.talking = true;
    }
  }

  dispose() {
    this.disposed = true;
    ++this.loadToken;
    ++this.thinkingToken;
    if (this.idleCycle) clearTimeout(this.idleCycle);
    this.idleCycle = null;
    this.talkingClip = null;
    this.talkingActive = false;
    this.talkingBlend = 0;
    this.talking = null;
    this.mixer.stopAllAction();
  }
}
