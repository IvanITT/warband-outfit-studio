/** 3D viewport (Phase 3): meshes through the Warband Engine + DDS preview. */

import * as THREE from '../vendor/three/three.module.js';
import { OrbitCamera } from './viewer-controls.js';
import { decodeDds } from './dds.js';
import { ApiError } from './api.js';
import { el } from './ui.js';

/**
 * @param {{ api:any, state:any, dom:any, setStatus:(text:string)=>void }} ctx
 */
export function createViewer(ctx) {
  const { api, state, dom, setStatus } = ctx;
  const view = {
    moduleId: null,
    loaded: false,
    active: false,
    query: '',
    items: [],
    total: 0,
    offset: 0,
    limit: 100,
    selected: null,
    loading: false,
  };

  /** @type {any} */
  let renderer = null;
  let scene = null;
  let camera = null;
  let controls = null;
  let grid = null;
  let mesh = null;
  let material = null;
  let texture = null;
  let raf = null;
  let current = null; // { uvs, indices, bbox, materialInfo }
  let flipV = true;

  function errorText(error) {
    return error instanceof ApiError ? error.message : String(error);
  }

  function ensureRenderer() {
    if (renderer) return;
    renderer = new THREE.WebGLRenderer({ canvas: dom.canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(dom.canvas.clientWidth || 800, dom.canvas.clientHeight || 600, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0d1014);

    camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
    camera.position.set(2, 2, 2);

    controls = new OrbitCamera(camera, dom.canvas);
    controls.update();

    const hemi = new THREE.HemisphereLight(0xffffff, 0x2a3340, 1.6);
    scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(4, 6, 5);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x88aaff, 0.7);
    fill.position.set(-5, 2, -4);
    scene.add(fill);

    grid = new THREE.GridHelper(4, 20, 0x3a4656, 0x232b35);
    grid.position.y = -0.5;
    scene.add(grid);

    window.addEventListener('resize', () => resize());
    const observer = new ResizeObserver(() => resize());
    observer.observe(dom.canvas.parentElement ?? dom.canvas);
    resize();
    animate();
  }

  function resize() {
    if (!renderer || !camera) return;
    const parent = dom.canvas.parentElement;
    const width = parent?.clientWidth ?? 800;
    const height = parent?.clientHeight ?? 600;
    if (width === 0 || height === 0) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function animate() {
    if (!view.active) {
      raf = null;
      return;
    }
    raf = requestAnimationFrame(animate);
    controls?.update();
    renderer?.render(scene, camera);
  }

  function setActive(active) {
    view.active = active;
    if (active) {
      ensureRenderer();
      resize();
      if (!raf) animate();
    } else if (raf) {
      cancelAnimationFrame(raf);
      raf = null;
    }
  }

  function disposeCurrent() {
    if (mesh) {
      scene?.remove(mesh);
      mesh.geometry?.dispose();
      material?.dispose();
      mesh = null;
      material = null;
    }
    if (texture) {
      texture.dispose();
      texture = null;
    }
    current = null;
  }

  async function loadList(moduleId) {
    view.moduleId = moduleId;
    view.loaded = false;
    view.items = [];
    view.offset = 0;
    view.selected = null;
    disposeCurrent();
    dom.title.textContent = 'Selecciona una malla';
    dom.status.textContent = 'Arrastra para orbitar · rueda para zoom · botón derecho para desplazar.';
    await fetchPage(false);
  }

  async function fetchPage(append) {
    if (view.loading) return;
    view.loading = true;
    dom.more.disabled = true;
    try {
      const page = await api.resources({
        module: state.moduleId,
        type: 'mesh',
        q: view.query,
        limit: view.limit,
        offset: append ? view.offset : 0,
      });
      view.total = page.total;
      view.offset = append ? view.offset + page.items.length : page.items.length;
      view.items = append ? [...view.items, ...page.items] : page.items;
      view.loaded = true;
      renderList();
      dom.count.textContent = String(view.total);
      dom.more.hidden = view.offset >= view.total;
      dom.more.disabled = false;
    } catch (error) {
      dom.list.replaceChildren(el('p', { class: 'muted', text: errorText(error) }));
    } finally {
      view.loading = false;
    }
  }

  function renderList() {
    if (view.items.length === 0) {
      dom.list.replaceChildren(el('p', { class: 'muted', text: 'No hay mallas que coincidan.' }));
      return;
    }
    dom.list.replaceChildren(
      ...view.items.map((item) => el('button', {
        class: `resource-row${view.selected?.name === item.name ? ' is-selected' : ''}`,
        type: 'button',
        onclick: () => select(item.name),
      }, [
        el('span', { class: 'name', text: item.name }),
        el('span', { class: 'sub', text: `${item.vertexCount} v · ${item.faceCount} f · ${item.material}` }),
        el('span', { class: 'meta', text: item.lodLevel ? `lod${item.lodLevel}` : '' }),
      ])),
    );
  }

  function decodeArray(encoded) {
    const binary = atob(encoded.data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    const Type = { Float32Array, Uint32Array, Int32Array, Uint8Array }[encoded.type] ?? Uint8Array;
    return new Type(bytes.buffer);
  }

  function applyUvs(geometry, uvs, flip) {
    const attribute = new THREE.BufferAttribute(new Float32Array(uvs.length), 2);
    for (let i = 0; i < uvs.length; i += 2) {
      attribute.array[i] = uvs[i];
      attribute.array[i + 1] = flip ? 1 - uvs[i + 1] : uvs[i + 1];
    }
    geometry.setAttribute('uv', attribute);
  }

  async function select(name) {
    ensureRenderer();
    view.selected = { name };
    for (const row of dom.list.querySelectorAll('.resource-row')) {
      row.classList.toggle('is-selected', row.querySelector('.name')?.textContent === name);
    }
    dom.title.textContent = name;
    dom.status.textContent = 'Cargando malla…';
    try {
      const [data, detail] = await Promise.all([
        api.meshGeometry(state.moduleId, name),
        api.resource(state.moduleId, 'mesh', name),
      ]);

      const positions = decodeArray(data.arrays.positions);
      const normals = decodeArray(data.arrays.normals);
      const uvs = decodeArray(data.arrays.uvs);
      const indices = decodeArray(data.arrays.indices);

      disposeCurrent();

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
      applyUvs(geometry, uvs, flipV);
      geometry.setIndex(new THREE.BufferAttribute(indices, 1));
      geometry.computeBoundingSphere();
      geometry.computeBoundingBox();

      const materialInfo = detail.detail.material;
      const color = materialInfo?.color
        ? new THREE.Color(materialInfo.color[0], materialInfo.color[1], materialInfo.color[2])
        : new THREE.Color(0xcccccc);

      const diffuse = detail.detail.textures?.diffuseA;
      if (diffuse?.file?.exists) {
        try {
          const buffer = await api.textureBuffer(state.moduleId, diffuse.name);
          const dds = decodeDds(buffer);
          texture = new THREE.DataTexture(dds.data, dds.width, dds.height, THREE.RGBAFormat);
          texture.flipY = false;
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.needsUpdate = true;
        } catch (error) {
          dom.status.textContent = `Textura no disponible: ${errorText(error)}`;
          texture = null;
        }
      }

      material = new THREE.MeshStandardMaterial({
        map: texture,
        color: texture ? 0xffffff : color,
        roughness: 0.78,
        metalness: 0.05,
        side: THREE.DoubleSide,
        wireframe: dom.wire.classList.contains('is-active'),
      });

      mesh = new THREE.Mesh(geometry, material);
      scene.add(mesh);

      current = { uvs, indices, bbox: data.bbox, materialInfo, texture: diffuse };
      controls.frame(data.bbox);
      grid.position.y = data.bbox.min[1] - 0.01;
      grid.scale.setScalar(Math.max(0.5, (data.bbox.max[0] - data.bbox.min[0]) / 2));
      grid.visible = !dom.grid.classList.contains('is-off');

      const dims = detail.detail.textures?.diffuseA?.dds;
      dom.status.textContent =
        `${data.counts.vertices} vértices · ${data.counts.faces} caras · ` +
        `${materialInfo?.name ?? 'sin material'}${dims ? ` · ${dims.width}×${dims.height} ${dims.format}` : ''}`;
      setStatus(`Visor: ${name}`);
    } catch (error) {
      dom.status.textContent = `No se pudo cargar: ${errorText(error)}`;
      setStatus(`Visor: ${errorText(error)}`);
    }
  }

  function rebuildUvs() {
    if (!mesh || !current) return;
    applyUvs(mesh.geometry, current.uvs, flipV);
    mesh.geometry.attributes.uv.needsUpdate = true;
  }

  function init() {
    let timer = null;
    dom.search.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        view.query = dom.search.value.trim();
        fetchPage(false);
      }, 160);
    });
    dom.more.addEventListener('click', () => fetchPage(true));
    dom.reset.addEventListener('click', () => {
      if (current && controls) controls.frame(current.bbox);
    });
    dom.grid.addEventListener('click', () => {
      dom.grid.classList.toggle('is-off');
      if (grid) grid.visible = !dom.grid.classList.contains('is-off');
    });
    dom.wire.addEventListener('click', () => {
      dom.wire.classList.toggle('is-active');
      if (material) material.wireframe = dom.wire.classList.contains('is-active');
    });
    dom.flip.addEventListener('click', () => {
      flipV = !flipV;
      dom.flip.classList.toggle('is-active', flipV);
      rebuildUvs();
      dom.status.textContent = flipV ? 'UV: V invertida (OpenBRF)' : 'UV: V original';
    });
  }

  return { init, loadList, select, setActive, view };
}
