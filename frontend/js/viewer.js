/** 3D viewport + mesh editor (Phase 4). */

import * as THREE from '../vendor/three/three.module.js';
import { OrbitCamera } from './viewer-controls.js';
import { decodeDds } from './dds.js';
import { ApiError } from './api.js';
import { el } from './ui.js';
import {
  createModel, cloneModel, applyTransform, deleteFaces, duplicateFaces,
  mirrorModel, extrudeFaces, mergeVertices, splitFaces, renderArrays,
  validateModel, modelStats, modelToOverride, modelFromOverride,
  selectedVertexSet, EditError,
} from './mesh-edit.js';

/**
 * @param {{ api:any, state:any, dom:any, setStatus:(text:string)=>void }} ctx
 */
export function createViewer(ctx) {
  const { api, state, dom, setStatus } = ctx;
  const MAX_HISTORY = 25;

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
    projectId: '',
  };

  let renderer = null;
  let scene = null;
  let camera = null;
  let controls = null;
  let grid = null;
  let meshObject = null;
  let material = null;
  let texture = null;
  let raf = null;
  let baseEditable = null;
  let model = null;
  let history = [];
  let future = [];
  let flipV = true;
  let wireframe = false;
  let selection = { mode: 'vertex', vertices: new Set(), faces: new Set() };
  let selectionPoints = null;
  let selectionFaces = null;
  let pointerStart = null;
  let editingBlocked = null;

  function errorText(error) {
    return error instanceof EditError || error instanceof ApiError ? error.message : String(error);
  }

  /* ---------------- renderer ---------------- */

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

    scene.add(new THREE.HemisphereLight(0xffffff, 0x2a3340, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(4, 6, 5);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x88aaff, 0.7);
    fill.position.set(-5, 2, -4);
    scene.add(fill);

    grid = new THREE.GridHelper(4, 20, 0x3a4656, 0x232b35);
    grid.position.y = -0.5;
    scene.add(grid);

    const observer = new ResizeObserver(() => resize());
    observer.observe(dom.canvas.parentElement ?? dom.canvas);
    resize();
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

  /* ---------------- list ---------------- */

  async function loadList(moduleId) {
    view.moduleId = moduleId;
    view.loaded = false;
    view.items = [];
    view.offset = 0;
    view.selected = null;
    disposeAll();
    dom.title.textContent = 'Selecciona una malla';
    dom.status.textContent = 'Arrastra para orbitar · rueda para zoom · botón derecho para desplazar.';
    setMessage('');
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

  /* ---------------- scene / model ---------------- */

  function disposeSelection() {
    if (selectionPoints) {
      scene?.remove(selectionPoints);
      selectionPoints.geometry.dispose();
      selectionPoints.material.dispose();
      selectionPoints = null;
    }
    if (selectionFaces) {
      scene?.remove(selectionFaces);
      selectionFaces.geometry.dispose();
      selectionFaces.material.dispose();
      selectionFaces = null;
    }
  }

  function disposeAll() {
    disposeSelection();
    if (meshObject) {
      scene?.remove(meshObject);
      meshObject.geometry.dispose();
      meshObject = null;
    }
    if (material) {
      material.dispose();
      material = null;
    }
    if (texture) {
      texture.dispose();
      texture = null;
    }
    baseEditable = null;
    model = null;
    history = [];
    future = [];
    selection = { mode: selection.mode, vertices: new Set(), faces: new Set() };
  }

  async function select(name) {
    ensureRenderer();
    view.selected = { name };
    for (const row of dom.list.querySelectorAll('.resource-row')) {
      row.classList.toggle('is-selected', row.querySelector('.name')?.textContent === name);
    }
    dom.title.textContent = name;
    dom.status.textContent = 'Cargando malla…';
    setMessage('');
    try {
      const [editable, detail] = await Promise.all([
        api.meshEditable(state.moduleId, name),
        api.resource(state.moduleId, 'mesh', name),
      ]);

      disposeAll();
      baseEditable = editable;
      editingBlocked = null;
      const frameNote = editable.frameCount > 0
        ? `Malla con ${editable.frameCount} frames de animación: solo transformaciones (la topología está bloqueada).`
        : '';
      model = createModel(editable);
      selection = { mode: selection.mode, vertices: new Set(), faces: new Set() };

      await buildMaterial(detail);
      buildMeshObject();
      applyModel({ reframe: true });
      dom.status.textContent = statusText(detail);
      if (frameNote) setMessage(frameNote);
      setStatus(`Visor: ${name}`);
    } catch (error) {
      dom.status.textContent = `No se pudo cargar: ${errorText(error)}`;
      setStatus(`Visor: ${errorText(error)}`);
    }
  }

  async function buildMaterial(detail) {
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
        setMessage(`Textura no disponible: ${errorText(error)}`);
        texture = null;
      }
    }

    material = new THREE.MeshStandardMaterial({
      map: texture,
      color: texture ? 0xffffff : color,
      roughness: 0.78,
      metalness: 0.05,
      side: THREE.DoubleSide,
      wireframe,
    });
  }

  function buildMeshObject() {
    const geometry = buildGeometry();
    meshObject = new THREE.Mesh(geometry, material);
    scene.add(meshObject);
  }

  function buildGeometry() {
    const arrays = renderArrays(model);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(arrays.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(arrays.normals, 3));
    geometry.setAttribute('uv', buildUvAttribute());
    geometry.setIndex(new THREE.BufferAttribute(arrays.indices, 1));
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    return geometry;
  }

  function buildUvAttribute() {
    const attribute = new THREE.BufferAttribute(new Float32Array(model.uvs.length), 2);
    for (let i = 0; i < model.uvs.length; i += 2) {
      attribute.array[i] = model.uvs[i];
      attribute.array[i + 1] = flipV ? 1 - model.uvs[i + 1] : model.uvs[i + 1];
    }
    return attribute;
  }

  function applyModel({ reframe }) {
    if (!meshObject) return;
    const old = meshObject.geometry;
    meshObject.geometry = buildGeometry();
    old.dispose();
    const stats = modelStats(model);
    if (stats.bounds) {
      grid.position.y = stats.bounds.min[1] - 0.01;
      const size = Math.max(
        stats.bounds.max[0] - stats.bounds.min[0],
        stats.bounds.max[2] - stats.bounds.min[2],
        0.2,
      );
      grid.scale.setScalar(Math.max(0.5, size / 4));
      if (reframe) controls.frame(stats.bounds);
    }
    renderSelection();
    updateEditUi();
  }

  function statusText(detail) {
    const stats = modelStats(model);
    const dims = detail?.detail?.textures?.diffuseA?.dds;
    const mat = detail?.detail?.material?.name ?? baseEditable?.mesh?.material ?? '';
    return `${stats.vertices} vértices · ${stats.faces} caras · ${mat}${dims ? ` · ${dims.width}×${dims.height} ${dims.format}` : ''}${stats.dirty ? ' · editado' : ''}`;
  }

  function refreshStatus() {
    const stats = modelStats(model);
    dom.status.textContent = `${stats.vertices} vértices · ${stats.faces} caras${stats.dirty ? ' · editado' : ''}`;
  }

  /* ---------------- selection ---------------- */

  function setMode(mode) {
    selection.mode = mode;
    selection.vertices.clear();
    selection.faces.clear();
    dom.modeVertex.classList.toggle('is-active', mode === 'vertex');
    dom.modeFace.classList.toggle('is-active', mode === 'face');
    renderSelection();
    updateEditUi();
  }

  function clearSelection() {
    selection.vertices.clear();
    selection.faces.clear();
    renderSelection();
    updateEditUi();
  }

  function renderSelection() {
    if (!scene || !model) return;
    disposeSelection();

    const vertexSet = selectedVertexSet(model, {
      vertices: selection.mode === 'vertex' ? selection.vertices : [],
      faces: selection.faces,
    });

    if (vertexSet.size > 0) {
      const positions = new Float32Array(vertexSet.size * 3);
      let i = 0;
      for (const vertex of vertexSet) {
        const p = model.vertexPosition[vertex];
        positions[i * 3] = model.positions[p * 3];
        positions[i * 3 + 1] = model.positions[p * 3 + 1];
        positions[i * 3 + 2] = model.positions[p * 3 + 2];
        i += 1;
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const points = new THREE.PointsMaterial({
        color: 0xffb347,
        size: 7,
        sizeAttenuation: false,
        depthTest: false,
        transparent: true,
      });
      selectionPoints = new THREE.Points(geometry, points);
      selectionPoints.renderOrder = 10;
      scene.add(selectionPoints);
    }

    if (selection.faces.size > 0) {
      const positions = [];
      for (const face of selection.faces) {
        for (let corner = 0; corner < 3; corner += 1) {
          const vertex = model.indices[face * 3 + corner];
          const p = model.vertexPosition[vertex];
          positions.push(model.positions[p * 3], model.positions[p * 3 + 1], model.positions[p * 3 + 2]);
        }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffb347,
        transparent: true,
        opacity: 0.32,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      selectionFaces = new THREE.Mesh(geometry, mat);
      selectionFaces.renderOrder = 9;
      scene.add(selectionFaces);
    }
    updateSelectionCount();
  }

  function updateSelectionCount() {
    const count = selection.mode === 'vertex' ? selection.vertices.size : selection.faces.size;
    dom.selectionCount.textContent = `${count} ${selection.mode === 'vertex' ? 'vértices' : 'caras'}`;
  }

  function pick(event) {
    if (!meshObject || !camera) return null;
    const rect = dom.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObject(meshObject, false);
    return hits[0] ?? null;
  }

  function onCanvasPointerDown(event) {
    pointerStart = { x: event.clientX, y: event.clientY };
  }

  function onCanvasPointerUp(event) {
    if (!pointerStart || event.button !== 0) {
      pointerStart = null;
      return;
    }
    const moved = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y);
    pointerStart = null;
    if (moved > 5 || !model) return;

    const hit = pick(event);
    const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    if (!hit) {
      if (!additive) clearSelection();
      return;
    }

    if (selection.mode === 'vertex') {
      const corners = [0, 1, 2].map((corner) => model.indices[hit.faceIndex * 3 + corner]);
      let nearest = corners[0];
      let best = Infinity;
      for (const vertex of corners) {
        const p = model.vertexPosition[vertex];
        const dx = model.positions[p * 3] - hit.point.x;
        const dy = model.positions[p * 3 + 1] - hit.point.y;
        const dz = model.positions[p * 3 + 2] - hit.point.z;
        const distance = dx * dx + dy * dy + dz * dz;
        if (distance < best) {
          best = distance;
          nearest = vertex;
        }
      }
      if (!additive) selection.vertices.clear();
      if (selection.vertices.has(nearest)) selection.vertices.delete(nearest);
      else selection.vertices.add(nearest);
    } else {
      if (!additive) selection.faces.clear();
      if (selection.faces.has(hit.faceIndex)) selection.faces.delete(hit.faceIndex);
      else selection.faces.add(hit.faceIndex);
    }
    renderSelection();
    updateEditUi();
  }

  /* ---------------- editing ---------------- */

  function pushHistory() {
    if (!model) return;
    history.push(cloneModel(model));
    if (history.length > MAX_HISTORY) history.shift();
    future = [];
  }

  function setMessage(text, tone = '') {
    dom.message.textContent = text;
    dom.message.style.color = tone === 'error' ? 'var(--error)' : '';
  }

  function requireModel() {
    if (!model) throw new EditError('NO_MESH', 'Selecciona una malla primero.');
  }

  function applyNumericTransform() {
    try {
      requireModel();
      pushHistory();
      const selected = {
        vertices: [...selection.vertices],
        faces: [...selection.faces],
      };
      const options = {
        mode: dom.transform.value,
        axis: dom.axis.value,
        local: dom.local.checked,
        amount: Number(dom.amount.value),
        step: Number(dom.step.value),
      };
      if (options.mode === 'rotate' && options.step === 0.01) options.step = 1;
      const result = applyTransform(model, selected, options);
      applyModel({ reframe: false });
      refreshStatus();
      setMessage(`${result.affectedVertices} vértice(s) transformados`);
    } catch (error) {
      setMessage(errorText(error), 'error');
    }
  }

  function topology(action) {
    try {
      requireModel();
      pushHistory();
      const faces = [...selection.faces];
      const vertices = [...selection.vertices];
      if (action === 'delete') deleteFaces(model, faces);
      else if (action === 'duplicate') duplicateFaces(model, faces);
      else if (action === 'mirror') mirrorModel(model, 'x', true);
      else if (action === 'extrude') {
        const distance = Number(dom.amount.value) || 0.05;
        extrudeFaces(model, faces, distance);
      } else if (action === 'merge') mergeVertices(model, vertices);
      else if (action === 'split') splitFaces(model, faces);
      clearSelection();
      applyModel({ reframe: true });
      refreshStatus();
      setMessage(`${action} aplicado`);
    } catch (error) {
      history.pop();
      setMessage(errorText(error), 'error');
    }
  }

  function undo() {
    if (history.length === 0) return;
    future.push(cloneModel(model));
    model = history.pop();
    clearSelection();
    applyModel({ reframe: false });
    refreshStatus();
    setMessage('Deshecho');
  }

  function redo() {
    if (future.length === 0) return;
    history.push(cloneModel(model));
    model = future.pop();
    clearSelection();
    applyModel({ reframe: false });
    refreshStatus();
    setMessage('Rehecho');
  }

  function reset() {
    if (!baseEditable) return;
    model = createModel(baseEditable);
    history = [];
    future = [];
    clearSelection();
    applyModel({ reframe: true });
    refreshStatus();
    setMessage('Restablecido al original');
  }

  function updateEditUi() {
    dom.undo.disabled = history.length === 0;
    dom.redo.disabled = future.length === 0;
    updateSelectionCount();
  }

  /* ---------------- projects ---------------- */

  async function loadProjects() {
    try {
      const data = await api.projects();
      const current = view.projectId;
      dom.project.replaceChildren(
        el('option', { value: '', text: '— Proyecto —' }),
        ...data.projects.map((project) => el('option', { value: project.id, text: project.name })),
      );
      if (current && data.projects.some((project) => project.id === current)) dom.project.value = current;
      else view.projectId = '';
    } catch (error) {
      setMessage(`Proyectos: ${errorText(error)}`, 'error');
    }
  }

  async function createProject() {
    const name = window.prompt('Nombre del proyecto:', 'Mesh edits');
    if (!name) return;
    try {
      const result = await api.createProject({ name, module: state.moduleId });
      view.projectId = result.project.id;
      await loadProjects();
      dom.project.value = view.projectId;
      setMessage(`Proyecto creado: ${result.project.name}`);
    } catch (error) {
      setMessage(`No se pudo crear: ${errorText(error)}`, 'error');
    }
  }

  function currentProject() {
    const id = dom.project.value;
    if (!id) throw new EditError('NO_PROJECT', 'Selecciona o crea un proyecto.');
    view.projectId = id;
    return id;
  }

  async function saveMesh() {
    try {
      requireModel();
      const projectId = currentProject();
      if (!view.selected) throw new EditError('NO_MESH', 'Selecciona una malla.');
      const { issues } = validateModel(model);
      if (issues.length > 0) throw new EditError('INVALID_MODEL', `Malla inválida: ${issues.join('; ')}`);
      const override = modelToOverride(model, baseEditable.source);
      await api.saveMeshOverride(projectId, override);
      setMessage(`Malla guardada en ${projectId}`);
      model.dirty = false;
      refreshStatus();
    } catch (error) {
      setMessage(`No se pudo guardar: ${errorText(error)}`, 'error');
    }
  }

  async function loadMesh() {
    try {
      const projectId = currentProject();
      if (!view.selected) throw new EditError('NO_MESH', 'Selecciona una malla.');
      const { override } = await api.meshOverride(projectId, view.selected.name);
      model = modelFromOverride(override);
      history = [];
      future = [];
      clearSelection();
      applyModel({ reframe: true });
      refreshStatus();
      setMessage(`Override cargado (${override.stats.vertices} vértices)`);
    } catch (error) {
      setMessage(`No se pudo cargar: ${errorText(error)}`, 'error');
    }
  }

  async function exportMesh() {
    try {
      const projectId = currentProject();
      if (!view.selected) throw new EditError('NO_MESH', 'Selecciona una malla.');
      const result = await api.exportMeshOverride(projectId, view.selected.name, 'mesh-edits');
      setMessage(`Exportado: ${result.file}`);
    } catch (error) {
      setMessage(`No se pudo exportar: ${errorText(error)}`, 'error');
    }
  }

  /* ---------------- init ---------------- */

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
    dom.resetCamera.addEventListener('click', () => {
      if (model) {
        const bounds = modelStats(model).bounds;
        if (bounds) controls.frame(bounds);
      }
    });
    dom.grid.addEventListener('click', () => {
      dom.grid.classList.toggle('is-off');
      if (grid) grid.visible = !dom.grid.classList.contains('is-off');
    });
    dom.wire.addEventListener('click', () => {
      wireframe = !wireframe;
      dom.wire.classList.toggle('is-active', wireframe);
      if (material) material.wireframe = wireframe;
    });
    dom.flip.addEventListener('click', () => {
      flipV = !flipV;
      dom.flip.classList.toggle('is-active', flipV);
      if (meshObject) {
        meshObject.geometry.setAttribute('uv', buildUvAttribute());
        meshObject.geometry.attributes.uv.needsUpdate = true;
      }
      setMessage(flipV ? 'UV: V invertida (OpenBRF)' : 'UV: V original');
    });

    dom.modeVertex.addEventListener('click', () => setMode('vertex'));
    dom.modeFace.addEventListener('click', () => setMode('face'));
    dom.apply.addEventListener('click', applyNumericTransform);
    dom.delete.addEventListener('click', () => topology('delete'));
    dom.duplicate.addEventListener('click', () => topology('duplicate'));
    dom.mirror.addEventListener('click', () => topology('mirror'));
    dom.extrude.addEventListener('click', () => topology('extrude'));
    dom.merge.addEventListener('click', () => topology('merge'));
    dom.split.addEventListener('click', () => topology('split'));
    dom.undo.addEventListener('click', undo);
    dom.redo.addEventListener('click', redo);
    dom.reset.addEventListener('click', reset);

    dom.project.addEventListener('change', () => { view.projectId = dom.project.value; });
    dom.projectNew.addEventListener('click', createProject);
    dom.save.addEventListener('click', saveMesh);
    dom.load.addEventListener('click', loadMesh);
    dom.export.addEventListener('click', exportMesh);

    dom.canvas.addEventListener('pointerdown', onCanvasPointerDown);
    dom.canvas.addEventListener('pointerup', onCanvasPointerUp);

    loadProjects();
    updateEditUi();
  }

  return { init, loadList, select, setActive, view, loadProjects };
}
