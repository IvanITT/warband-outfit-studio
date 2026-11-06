/** Minimal orbit/pan/zoom camera controls (no external addon). */

import * as THREE from '../vendor/three/three.module.js';

export class OrbitCamera {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {HTMLElement} element
   */
  constructor(camera, element) {
    this.camera = camera;
    this.element = element;
    this.target = new THREE.Vector3(0, 0, 0);
    this.distance = 3;
    this.theta = 0.7;
    this.phi = 1.05;
    this.minDistance = 0.01;
    this.maxDistance = 10_000;
    this.minPhi = 0.05;
    this.maxPhi = Math.PI - 0.05;
    this.enabled = true;
    this.pointer = null;
    this.last = { x: 0, y: 0 };

    this.onPointerDown = (event) => {
      if (!this.enabled) return;
      this.element.setPointerCapture(event.pointerId);
      this.pointer = { id: event.pointerId, button: event.button };
      this.last = { x: event.clientX, y: event.clientY };
    };
    this.onPointerMove = (event) => {
      if (!this.pointer || this.pointer.id !== event.pointerId) return;
      const dx = event.clientX - this.last.x;
      const dy = event.clientY - this.last.y;
      this.last = { x: event.clientX, y: event.clientY };
      if (this.pointer.button === 0) {
        this.theta += dx * 0.006;
        this.phi = Math.min(this.maxPhi, Math.max(this.minPhi, this.phi - dy * 0.006));
      } else {
        this.pan(dx, dy);
      }
      this.update();
    };
    this.onPointerUp = (event) => {
      if (this.pointer?.id === event.pointerId) this.pointer = null;
    };
    this.onWheel = (event) => {
      if (!this.enabled) return;
      event.preventDefault();
      this.distance = Math.min(
        this.maxDistance,
        Math.max(this.minDistance, this.distance * Math.exp(event.deltaY * 0.0012)),
      );
      this.update();
    };
    this.onContextMenu = (event) => event.preventDefault();

    element.addEventListener('pointerdown', this.onPointerDown);
    element.addEventListener('pointermove', this.onPointerMove);
    element.addEventListener('pointerup', this.onPointerUp);
    element.addEventListener('pointercancel', this.onPointerUp);
    element.addEventListener('wheel', this.onWheel, { passive: false });
    element.addEventListener('contextmenu', this.onContextMenu);
  }

  pan(dx, dy) {
    const scale = this.distance * 0.0018;
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 1);
    this.target.addScaledVector(right, -dx * scale);
    this.target.addScaledVector(up, dy * scale);
  }

  update() {
    const sinPhi = Math.sin(this.phi);
    this.camera.position.set(
      this.target.x + this.distance * sinPhi * Math.sin(this.theta),
      this.target.y + this.distance * Math.cos(this.phi),
      this.target.z + this.distance * sinPhi * Math.cos(this.theta),
    );
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }

  /** @param {{min:number[],max:number[]}} bbox */
  frame(bbox) {
    const center = new THREE.Vector3(
      (bbox.min[0] + bbox.max[0]) / 2,
      (bbox.min[1] + bbox.max[1]) / 2,
      (bbox.min[2] + bbox.max[2]) / 2,
    );
    const size = Math.max(
      bbox.max[0] - bbox.min[0],
      bbox.max[1] - bbox.min[1],
      bbox.max[2] - bbox.min[2],
      0.1,
    );
    this.target.copy(center);
    const radius = size / 2;
    const fov = (this.camera.fov * Math.PI) / 180;
    this.distance = (radius / Math.sin(fov / 2)) * 1.25;
    this.theta = 0.65;
    this.phi = 1.05;
    this.update();
  }

  dispose() {
    this.element.removeEventListener('pointerdown', this.onPointerDown);
    this.element.removeEventListener('pointermove', this.onPointerMove);
    this.element.removeEventListener('pointerup', this.onPointerUp);
    this.element.removeEventListener('pointercancel', this.onPointerUp);
    this.element.removeEventListener('wheel', this.onWheel);
    this.element.removeEventListener('contextmenu', this.onContextMenu);
  }
}
