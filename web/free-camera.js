import * as THREE from "three";

export class FreeCameraController {
  constructor({ canvas, camera, button, getTarget }) {
    this.canvas = canvas;
    this.camera = camera;
    this.button = button;
    this.getTarget = getTarget;

    this.active = false;
    this.yaw = 0;
    this.pitch = 0;
    this.radius = 2.05;

    this.minRadius = 0.95;
    this.maxRadius = 3.8;
    this.minPitch = -0.62;
    this.maxPitch = 0.58;
    this.rotateSpeed = 0.008;
    this.zoomSpeed = 0.0018;

    this.pointers = new Map();
    this.lastPinchDistance = 0;
    this.pointerId = null;
    this.lastX = 0;
    this.lastY = 0;

    this.target = new THREE.Vector3();
    this.offset = new THREE.Vector3();

    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
    this.onWheel = this.onWheel.bind(this);
    this.onToggle = this.onToggle.bind(this);

    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointercancel", this.onPointerUp);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    button?.addEventListener("click", this.onToggle);
  }

  onToggle() {
    this.setActive(!this.active);
  }

  setActive(active) {
    this.active = Boolean(active);
    this.pointers.clear();
    this.lastPinchDistance = 0;
    this.pointerId = null;

    const target = this.getTarget?.();
    if (this.active && target) {
      this.target.copy(target);
      this.offset.copy(this.camera.position).sub(this.target);
      const distance = Math.max(this.offset.length(), 0.01);

      this.radius = THREE.MathUtils.clamp(distance, this.minRadius, this.maxRadius);
      this.yaw = Math.atan2(this.offset.x, this.offset.z);
      this.pitch = Math.asin(THREE.MathUtils.clamp(this.offset.y / distance, -1, 1));
      this.pitch = THREE.MathUtils.clamp(this.pitch, this.minPitch, this.maxPitch);
    }

    this.canvas.classList.toggle("is-free-camera", this.active);
    this.button?.classList.toggle("is-active", this.active);
    this.button?.setAttribute("aria-pressed", String(this.active));
  }

  onPointerDown(event) {
    if (!this.active) return;

    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    this.canvas.setPointerCapture?.(event.pointerId);

    if (this.pointers.size === 1) {
      this.pointerId = event.pointerId;
      this.lastX = event.clientX;
      this.lastY = event.clientY;
    } else if (this.pointers.size === 2) {
      const points = [...this.pointers.values()];
      this.lastPinchDistance = Math.hypot(
        points[0].x - points[1].x,
        points[0].y - points[1].y
      );
    }

    event.preventDefault();
    event.stopImmediatePropagation();
  }

  onPointerMove(event) {
    if (!this.active || !this.pointers.has(event.pointerId)) return;

    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (this.pointers.size >= 2) {
      const points = [...this.pointers.values()];
      const distance = Math.hypot(
        points[0].x - points[1].x,
        points[0].y - points[1].y
      );

      if (this.lastPinchDistance > 0) {
        this.radius = THREE.MathUtils.clamp(
          this.radius - (distance - this.lastPinchDistance) * 0.006,
          this.minRadius,
          this.maxRadius
        );
      }

      this.lastPinchDistance = distance;
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }

    if (event.pointerId !== this.pointerId) return;

    const dx = event.clientX - this.lastX;
    const dy = event.clientY - this.lastY;

    this.yaw -= dx * this.rotateSpeed;
    this.pitch = THREE.MathUtils.clamp(
      this.pitch + dy * this.rotateSpeed,
      this.minPitch,
      this.maxPitch
    );

    this.lastX = event.clientX;
    this.lastY = event.clientY;

    event.preventDefault();
    event.stopImmediatePropagation();
  }

  onPointerUp(event) {
    if (!this.active) return;

    this.pointers.delete(event.pointerId);
    if (event.pointerId === this.pointerId) {
      const next = this.pointers.keys().next();
      this.pointerId = next.done ? null : next.value;
      if (this.pointerId != null) {
        const point = this.pointers.get(this.pointerId);
        this.lastX = point.x;
        this.lastY = point.y;
      }
    }

    if (this.pointers.size < 2) this.lastPinchDistance = 0;
    event.stopImmediatePropagation();
  }

  onWheel(event) {
    if (!this.active) return;

    this.radius = THREE.MathUtils.clamp(
      this.radius + event.deltaY * this.zoomSpeed,
      this.minRadius,
      this.maxRadius
    );

    event.preventDefault();
    event.stopImmediatePropagation();
  }

  update(delta = 0.016) {
    if (!this.active) return;

    const target = this.getTarget?.();
    if (!target) return;

    this.target.copy(target);

    const horizontal = Math.cos(this.pitch) * this.radius;
    this.offset.set(
      Math.sin(this.yaw) * horizontal,
      Math.sin(this.pitch) * this.radius,
      Math.cos(this.yaw) * horizontal
    );

    const desiredPosition = this.target.clone().add(this.offset);
    const smooth = 1 - Math.exp(-12 * Math.max(delta, 0.001));

    this.camera.position.lerp(desiredPosition, smooth);
    this.camera.lookAt(this.target);
  }

  dispose() {
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerUp);
    this.canvas.removeEventListener("wheel", this.onWheel);
    this.button?.removeEventListener("click", this.onToggle);
    this.pointers.clear();
  }
}
