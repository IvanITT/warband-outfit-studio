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
  let materialEditable = null;
  let materialFields = null;
  const textureCache = new Map();
  let outfitActive = false;
  let outfitGroup = null;
  let outfitBody = null;
  let outfitSlots = {};
  let outfitItems = [];
  let outfitCachedGeometries = new Map();
  let outfitCachedMaterials = new Map();
  let outfitBuildToken = 0;
  let outfitDataModule = '';
  let outfitState = {
    skin: 'man',
    projectId: '',
    name: 'Outfit 1',
    entries: { body: '', head: '', hand: '', foot: '' },
    transforms: {},
  };
  let viewSideTab = 'mesh';
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
    if (viewSideTab === 'outfit') {
      await refreshOutfitData();
      await buildOutfit();
    }
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
    for (const cached of textureCache.values()) cached.dispose();
    textureCache.clear();
    materialEditable = null;
    materialFields = null;
    baseEditable = null;
    model = null;
    history = [];
    future = [];
    clearOutfit();
    selection = { mode: selection.mode, vertices: new Set(), faces: new Set() };
  }

  function clearOutfit() {
    outfitBuildToken += 1;
    if (outfitGroup) {
      scene?.remove(outfitGroup);
      outfitGroup = null;
    }
    outfitBody = null;
    outfitSlots = {};
    for (const geometry of outfitCachedGeometries.values()) geometry.dispose();
    outfitCachedGeometries.clear();
    for (const cached of outfitCachedMaterials.values()) cached.dispose();
    outfitCachedMaterials.clear();
  }

  function ensureOutfitGroup() {
    if (!outfitGroup) {
      outfitGroup = new THREE.Group();
      scene.add(outfitGroup);
    }
    return outfitGroup;
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

      const materialName = detail.detail.material?.name ?? null;
      materialEditable = materialName
        ? await api.materialEditable(state.moduleId, materialName)
        : null;
      if (materialEditable) populateMaterialPanel(materialEditable);
      else clearMaterialPanel();

      material = new THREE.MeshStandardMaterial({
        color: 0xcccccc,
        roughness: 0.78,
        metalness: 0.05,
        side: THREE.DoubleSide,
        wireframe,
      });
      await applyMaterialPreview();
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

  async function loadTexture(name, role = 'diffuseA') {
    if (!name || name === 'none') return null;
    const key = name.toLowerCase();
    if (textureCache.has(key)) return textureCache.get(key);
    try {
      const buffer = await api.textureBuffer(state.moduleId, name);
      const dds = decodeDds(buffer);
      const tex = new THREE.DataTexture(dds.data, dds.width, dds.height, THREE.RGBAFormat);
      tex.flipY = false;
      tex.colorSpace = role === 'diffuseA' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      tex.needsUpdate = true;
      textureCache.set(key, tex);
      return tex;
    } catch (error) {
      setMaterialMessage(`Textura ${name}: ${errorText(error)}`, 'error');
      return null;
    }
  }

  async function applyMaterialPreview() {
    if (!material || !materialEditable) return;
    readMaterialForm();
    const fields = materialFields;
    const diffuse = await loadTexture(fields.diffuseA, 'diffuseA');
    const normal = dom.matNormalToggle.checked ? await loadTexture(fields.bump, 'bump') : null;
    const spec = dom.matSpecToggle.checked ? await loadTexture(fields.spec, 'spec') : null;

    material.map = diffuse;
    material.normalMap = normal;
    material.normalScale.set(1, 1);
    material.metalnessMap = spec;
    material.metalness = spec ? 0.6 : 0.05;
    material.roughness = Math.max(0.2, 0.9 - Number(fields.specular ?? 0) * 0.05);
    material.color.setRGB(
      diffuse ? 1 : fields.r / 255,
      diffuse ? 1 : fields.g / 255,
      diffuse ? 1 : fields.b / 255,
    );
    material.transparent = dom.matAlphaToggle.checked;
    material.depthWrite = !dom.matAlphaToggle.checked;
    material.side = dom.matDoubleToggle.checked ? THREE.DoubleSide : THREE.FrontSide;
    material.needsUpdate = true;
    setMaterialMessage('Preview actualizado');
  }

  function rgbToHex(r, g, b) {
    const to = (value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
    return `#${to(r)}${to(g)}${to(b)}`;
  }

  function hexToRgb(hex) {
    const value = hex.replace('#', '');
    return {
      r: parseInt(value.slice(0, 2), 16),
      g: parseInt(value.slice(2, 4), 16),
      b: parseInt(value.slice(4, 6), 16),
    };
  }

  function populateMaterialPanel(editable) {
    materialFields = { ...editable.fields };
    dom.matName.textContent = editable.material.name;
    dom.matShader.replaceChildren(
      ...(editable.shaders.includes(editable.fields.shader)
        ? editable.shaders
        : [editable.fields.shader, ...editable.shaders]).map((shader) => el('option', { value: shader, text: shader })),
    );
    dom.matShader.value = editable.fields.shader;
    dom.matColor.value = rgbToHex(editable.fields.r, editable.fields.g, editable.fields.b);
    dom.matSpecular.value = String(editable.fields.specular);
    dom.matDiffuseA.value = editable.fields.diffuseA ?? '';
    dom.matBump.value = editable.fields.bump ?? '';
    dom.matSpec.value = editable.fields.spec ?? '';
    refreshTextureList();
  }

  function clearMaterialPanel() {
    materialFields = null;
    dom.matName.textContent = '—';
    dom.matShader.replaceChildren();
    dom.matDiffuseA.value = '';
    dom.matBump.value = '';
    dom.matSpec.value = '';
    dom.matMessage.textContent = 'Selecciona una malla con material.';
  }

  function readMaterialForm() {
    if (!materialFields) return;
    materialFields.shader = dom.matShader.value;
    materialFields.diffuseA = dom.matDiffuseA.value.trim();
    materialFields.bump = dom.matBump.value.trim();
    materialFields.spec = dom.matSpec.value.trim();
    materialFields.specular = Number(dom.matSpecular.value) || 0;
    const color = hexToRgb(dom.matColor.value);
    materialFields.r = color.r;
    materialFields.g = color.g;
    materialFields.b = color.b;
  }

  function setMaterialMessage(text, tone = '') {
    dom.matMessage.textContent = text;
    dom.matMessage.style.color = tone === 'error' ? 'var(--error)' : '';
  }

  async function refreshTextureList() {
    const names = new Set([
      materialFields?.diffuseA,
      materialFields?.bump,
      materialFields?.spec,
    ].filter(Boolean));
    if (view.projectId) {
      try {
        const data = await api.projectTextures(view.projectId);
        for (const texture of data.textures) names.add(texture.name);
      } catch {
        /* project textures are optional */
      }
    }
    dom.matTextureList.replaceChildren(
      ...[...names].sort().map((name) => el('option', { value: name })),
    );
  }

  function buildMaterialOverride() {
    return {
      schemaVersion: 1,
      id: materialEditable.material.name,
      source: {
        moduleId: state.moduleId,
        material: materialEditable.material.name,
        brf: materialEditable.material.brf,
      },
      fields: { ...materialFields },
      editedAt: new Date().toISOString(),
    };
  }

  async function saveMaterial() {
    try {
      if (!materialEditable) throw new EditError('NO_MATERIAL', 'Selecciona una malla con material.');
      const projectId = currentProject();
      readMaterialForm();
      await api.saveMaterialOverride(projectId, buildMaterialOverride());
      setMaterialMessage(`Material guardado en ${projectId}`);
    } catch (error) {
      setMaterialMessage(`No se pudo guardar: ${errorText(error)}`, 'error');
    }
  }

  async function loadMaterial() {
    try {
      if (!materialEditable) throw new EditError('NO_MATERIAL', 'Selecciona una malla con material.');
      const projectId = currentProject();
      const { override } = await api.materialOverride(projectId, materialEditable.material.name);
      materialFields = { ...override.fields };
      populateMaterialPanel({ ...materialEditable, fields: materialFields });
      await applyMaterialPreview();
      setMaterialMessage('Material cargado');
    } catch (error) {
      setMaterialMessage(`No se pudo cargar: ${errorText(error)}`, 'error');
    }
  }

  async function exportMaterial() {
    try {
      if (!materialEditable) throw new EditError('NO_MATERIAL', 'Selecciona una malla con material.');
      const projectId = currentProject();
      const result = await api.exportMaterialOverride(projectId, materialEditable.material.name, 'materials');
      setMaterialMessage(`Exportado: ${result.file} (+${result.textures.length} texturas)`);
    } catch (error) {
      setMaterialMessage(`No se pudo exportar: ${errorText(error)}`, 'error');
    }
  }

  function fileToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  async function importMaterialTexture() {
    try {
      if (!materialEditable) throw new EditError('NO_MATERIAL', 'Selecciona una malla con material.');
      const projectId = currentProject();
      const file = dom.matFile.files?.[0];
      if (!file) throw new EditError('NO_FILE', 'Selecciona un archivo .dds.');
      const buffer = await file.arrayBuffer();
      const workspaceResult = await api.createWorkspace({
        label: 'textures',
        module: state.moduleId,
        reuse: true,
      });
      const imported = await api.importTexture(
        workspaceResult.workspace.id,
        file.name,
        fileToBase64(buffer),
      );
      await api.saveProjectTexture(projectId, imported);
      const role = dom.matRole.value;
      if (role === 'diffuseA') dom.matDiffuseA.value = imported.name;
      else if (role === 'bump') dom.matBump.value = imported.name;
      else dom.matSpec.value = imported.name;
      readMaterialForm();
      await refreshTextureList();
      setMaterialMessage(`Textura importada: ${imported.name} (${imported.width}×${imported.height} ${imported.format})`);
    } catch (error) {
      setMaterialMessage(`No se pudo importar: ${errorText(error)}`, 'error');
    }
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
      renderOutfitProjectOptions(data.projects);
      refreshTextureList();
    } catch (error) {
      setMessage(`Proyectos: ${errorText(error)}`, 'error');
    }
  }

  async function setSideTab(tab) {
    viewSideTab = tab;
    const materialTab = tab === 'material';
    const outfitTab = tab === 'outfit';
    dom.meshPanel.hidden = tab !== 'mesh';
    dom.materialPanel.hidden = !materialTab;
    dom.outfitPanel.hidden = !outfitTab;
    dom.tabMesh.classList.toggle('is-active', tab === 'mesh');
    dom.tabMaterial.classList.toggle('is-active', materialTab);
    dom.tabOutfit.classList.toggle('is-active', outfitTab);
    dom.editbar.hidden = outfitTab;
    outfitActive = outfitTab;

    if (outfitTab) {
      if (meshObject) meshObject.visible = false;
      await refreshOutfitData();
      await buildOutfit();
    } else {
      clearOutfit();
      if (meshObject) meshObject.visible = true;
      dom.title.textContent = view.selected?.name ?? 'Selecciona una malla';
      if (materialTab) refreshTextureList();
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

  /* ---------------- outfits ---------------- */

  function prettyName(name) {
    return String(name ?? '').replace(/_/g, ' ');
  }

  function slugify(text) {
    return String(text ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || `outfit-${Date.now()}`;
  }

  function decodeEncodedArray(encoded) {
    if (!encoded) return new Float32Array(0);
    const binary = atob(encoded.data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    const Type = { Float32Array, Uint32Array, Int32Array, Uint16Array, Uint8Array }[encoded.type] ?? Float32Array;
    return new Type(bytes.buffer);
  }

  function outfitMessage(text, tone = '') {
    if (!dom.outfitMessage) return;
    dom.outfitMessage.textContent = text;
    dom.outfitMessage.dataset.tone = tone;
  }

  function emptyEntries() {
    return { body: '', head: '', hand: '', foot: '' };
  }

  function outfitTransform(slot) {
    const value = outfitState.transforms?.[slot] ?? {};
    return {
      x: Number(value.x ?? 0) || 0,
      y: Number(value.y ?? 0) || 0,
      z: Number(value.z ?? 0) || 0,
      scale: Number(value.scale ?? 1) || 1,
    };
  }

  function bboxToJson(box) {
    if (!box || box.isEmpty()) return null;
    return { min: box.min.toArray(), max: box.max.toArray() };
  }

  function renderOutfitProjectOptions(projects) {
    if (!dom.outfitProject) return;
    const current = outfitState.projectId || view.projectId;
    dom.outfitProject.replaceChildren(
      el('option', { value: '', text: 'Sin proyecto' }),
      ...projects.map((project) => el('option', { value: project.id, text: project.name })),
    );
    outfitState.projectId = projects.some((project) => project.id === current)
      ? current
      : (projects[0]?.id ?? '');
    dom.outfitProject.value = outfitState.projectId;
  }

  async function refreshOutfitProjects() {
    try {
      const data = await api.projects();
      renderOutfitProjectOptions(data.projects);
      await refreshOutfitList();
    } catch (error) {
      outfitMessage(`Proyectos: ${errorText(error)}`, 'error');
    }
  }

  async function refreshOutfitList() {
    if (!dom.outfitList) return;
    if (!outfitState.projectId) {
      dom.outfitList.replaceChildren(el('option', { value: '', text: 'Sin outfits guardados' }));
      return;
    }
    try {
      const data = await api.outfits(outfitState.projectId);
      dom.outfitList.replaceChildren(
        el('option', { value: '', text: data.outfits.length ? 'Selecciona un outfit' : 'Sin outfits guardados' }),
        ...data.outfits.map((outfit) => el('option', { value: outfit.id, text: outfit.name })),
      );
    } catch (error) {
      dom.outfitList.replaceChildren(el('option', { value: '', text: 'No se pudo leer' }));
      outfitMessage(`Outfits: ${errorText(error)}`, 'error');
    }
  }

  function renderOutfitSlotOptions() {
    const maps = [
      ['body', dom.outfitSlotBody],
      ['head', dom.outfitSlotHead],
      ['hand', dom.outfitSlotHand],
      ['foot', dom.outfitSlotFoot],
    ];
    for (const [slot, select] of maps) {
      if (!select) continue;
      const options = outfitItems
        .filter((item) => item.slot === slot)
        .map((item) => el('option', {
          value: item.id,
          text: `${item.name || prettyName(item.id)} · ${item.id}`,
        }));
      select.replaceChildren(
        el('option', { value: '', text: '— Ninguno —' }),
        ...options,
      );
      select.value = outfitState.entries[slot] ?? '';
    }
  }

  async function refreshOutfitItems(force = false) {
    if (!dom.outfitSlotBody) return;
    if (!force && outfitDataModule === state.moduleId && outfitItems.length > 0) {
      renderOutfitSlotOptions();
      return;
    }
    if (outfitDataModule && outfitDataModule !== state.moduleId) {
      outfitState.entries = emptyEntries();
      outfitState.transforms = {};
      outfitItems = [];
    }
    const page = await api.items({ module: state.moduleId, limit: 1000 });
    outfitItems = page.items;
    outfitDataModule = state.moduleId;
    renderOutfitSlotOptions();
  }

  async function refreshOutfitData() {
    try {
      if (!dom.outfitSkin) return;
      const skins = await api.skins(state.moduleId);
      const names = skins.skins.map((skin) => skin.name);
      dom.outfitSkin.replaceChildren(
        ...skins.skins.map((skin) => el('option', {
          value: skin.name,
          text: `${skin.name}${skin.skeleton ? ` · ${skin.skeleton}` : ''}`,
        })),
      );
      if (!names.includes(outfitState.skin)) outfitState.skin = names[0] ?? 'man';
      dom.outfitSkin.value = outfitState.skin;
      await refreshOutfitItems();
      await refreshOutfitProjects();
      syncOutfitControls();
    } catch (error) {
      outfitMessage(`Outfit: ${errorText(error)}`, 'error');
    }
  }

  function syncOutfitControls() {
    if (dom.outfitName) dom.outfitName.value = outfitState.name;
    if (dom.outfitSkin) dom.outfitSkin.value = outfitState.skin;
    for (const [slot, select] of [
      ['body', dom.outfitSlotBody],
      ['head', dom.outfitSlotHead],
      ['hand', dom.outfitSlotHand],
      ['foot', dom.outfitSlotFoot],
    ]) {
      if (select) select.value = outfitState.entries[slot] ?? '';
    }
    const slot = dom.outfitTransformSlot?.value ?? 'body';
    const transform = outfitTransform(slot);
    if (dom.outfitX) dom.outfitX.value = String(transform.x);
    if (dom.outfitY) dom.outfitY.value = String(transform.y);
    if (dom.outfitZ) dom.outfitZ.value = String(transform.z);
    if (dom.outfitScale) dom.outfitScale.value = String(transform.scale);
  }

  async function outfitGeometryFor(name, options = {}) {
    const key = `${name.toLowerCase()}:${options.slot ?? ''}:${options.role ?? ''}`;
    if (outfitCachedGeometries.has(key)) return outfitCachedGeometries.get(key);
    const data = await api.outfitMeshRender(state.moduleId, name, options);
    const positions = decodeEncodedArray(data.arrays.positions);
    const normals = decodeEncodedArray(data.arrays.normals);
    const uvs = decodeEncodedArray(data.arrays.uvs);
    const indices = decodeEncodedArray(data.arrays.indices);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    if (flipV) {
      for (let i = 1; i < uvs.length; i += 2) uvs[i] = 1 - uvs[i];
    }
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    outfitCachedGeometries.set(key, geometry);
    return geometry;
  }

  async function outfitMaterialFor(name) {
    if (!name) {
      return new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.8, side: THREE.DoubleSide });
    }
    const key = name.toLowerCase();
    if (outfitCachedMaterials.has(key)) return outfitCachedMaterials.get(key);
    const editable = await api.materialEditable(state.moduleId, name);
    const fields = editable.fields;
    const materialValue = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: Math.max(0.2, 0.9 - Number(fields.specular ?? 0) * 0.05),
      metalness: 0.05,
      side: THREE.DoubleSide,
      wireframe,
    });
    const diffuse = await loadTexture(fields.diffuseA, 'diffuseA');
    const normal = await loadTexture(fields.bump, 'bump');
    const spec = await loadTexture(fields.spec, 'spec');
    materialValue.map = diffuse;
    materialValue.normalMap = normal;
    if (normal) materialValue.normalScale.set(1, 1);
    materialValue.metalnessMap = spec;
    materialValue.metalness = spec ? 0.55 : 0.05;
    materialValue.color.setRGB(
      diffuse ? 1 : fields.r / 255,
      diffuse ? 1 : fields.g / 255,
      diffuse ? 1 : fields.b / 255,
    );
    materialValue.needsUpdate = true;
    outfitCachedMaterials.set(key, materialValue);
    return materialValue;
  }

  async function loadOutfitVisual(meshName, materialName, options = {}) {
    const geometry = await outfitGeometryFor(meshName, options);
    const materialValue = await outfitMaterialFor(materialName);
    const mesh = new THREE.Mesh(geometry, materialValue);
    mesh.name = meshName;
    return mesh;
  }

  async function buildOutfit() {
    if (!outfitActive || !scene || !dom.outfitPanel) return;
    const token = ++outfitBuildToken;
    ensureRenderer();
    const group = ensureOutfitGroup();
    group.clear();
    group.visible = true;
    outfitBody = null;
    outfitSlots = {};
    outfitMessage('Cargando outfit…');

    try {
      const character = await api.character(state.moduleId, outfitState.skin);
      if (token !== outfitBuildToken) return;
      const bodyGroup = new THREE.Group();
      bodyGroup.name = 'body';
      let pieces = 0;
      for (const part of character.parts) {
        try {
          const mesh = await loadOutfitVisual(part.name, part.material, { role: part.role });
          bodyGroup.add(mesh);
          pieces += 1;
        } catch (error) {
          outfitMessage(`Cuerpo ${part.name}: ${errorText(error)}`, 'error');
        }
      }
      group.add(bodyGroup);
      outfitBody = bodyGroup;

      for (const slot of ['body', 'head', 'hand', 'foot']) {
        if (token !== outfitBuildToken) return;
        const itemId = outfitState.entries[slot];
        if (!itemId) continue;
        const info = await api.outfitItemMeshes(state.moduleId, itemId);
        const slotGroup = new THREE.Group();
        slotGroup.name = slot;
        for (const meshInfo of info.meshes) {
          try {
            const mesh = await loadOutfitVisual(meshInfo.name, meshInfo.material, { slot });
            slotGroup.add(mesh);
            pieces += 1;
          } catch (error) {
            outfitMessage(`${itemId}: ${errorText(error)}`, 'error');
          }
        }
        if (slotGroup.children.length === 0) continue;
        const transform = outfitTransform(slot);
        slotGroup.position.set(transform.x, transform.y, transform.z);
        slotGroup.scale.setScalar(transform.scale);
        group.add(slotGroup);
        outfitSlots[slot] = slotGroup;
      }

      if (token !== outfitBuildToken) return;
      const box = new THREE.Box3().setFromObject(group);
      if (!box.isEmpty()) {
        controls.frame(bboxToJson(box));
        const size = Math.max(
          box.max[0] - box.min[0],
          box.max[1] - box.min[1],
          box.max[2] - box.min[2],
          0.2,
        );
        grid.position.y = box.min[1] - 0.01;
        grid.scale.setScalar(Math.max(0.5, size / 4));
      }
      if (!group.children.length) {
        outfitMessage('No hay cuerpo ni prendas cargadas.', 'warning');
      } else {
        outfitMessage(`${pieces} pieza(s) · ${outfitState.skin} · ${box.isEmpty() ? 'sin bounds' : 'listo'}`);
      }
      dom.title.textContent = `Outfit · ${outfitState.skin}`;
      setStatus(`Outfit: ${outfitState.name}`);
    } catch (error) {
      if (token !== outfitBuildToken) return;
      outfitMessage(`No se pudo componer el outfit: ${errorText(error)}`, 'error');
      setStatus(`Outfit: ${errorText(error)}`);
    }
  }

  function renderOutfitClipping(result) {
    if (!dom.outfitClipping) return;
    if (!result.issues.length) {
      dom.outfitClipping.replaceChildren(
        el('div', { class: 'mat-message', text: 'Sin solapamientos bounding-box relevantes.' }),
      );
      return;
    }
    dom.outfitClipping.replaceChildren(
      ...result.issues.map((issue) => el('div', {
        class: `issue ${issue.severity}`,
        title: issue.code,
      }, [
        el('div', { class: 'code', text: issue.code }),
        el('div', { class: 'message', text: issue.message }),
      ])),
    );
  }

  async function analyzeOutfit() {
    if (!outfitActive) return;
    try {
      const bodyBox = outfitBody ? new THREE.Box3().setFromObject(outfitBody) : null;
      const items = [];
      for (const slot of ['body', 'head', 'hand', 'foot']) {
        const slotGroup = outfitSlots[slot];
        if (!slotGroup || !outfitState.entries[slot]) continue;
        items.push({
          slot,
          itemId: outfitState.entries[slot],
          bbox: bboxToJson(new THREE.Box3().setFromObject(slotGroup)),
        });
      }
      const result = await api.analyzeOutfit({
        bodyBbox: bboxToJson(bodyBox),
        items,
      });
      renderOutfitClipping(result);
      outfitMessage(`Clipping: ${result.summary.errors} error(es), ${result.summary.warnings} aviso(s).`,
        result.summary.errors ? 'error' : '');
    } catch (error) {
      outfitMessage(`No se pudo analizar: ${errorText(error)}`, 'error');
    }
  }

  function applyOutfitTransform() {
    const slot = dom.outfitTransformSlot?.value ?? 'body';
    outfitState.transforms = {
      ...(outfitState.transforms ?? {}),
      [slot]: {
        x: Number(dom.outfitX?.value ?? 0) || 0,
        y: Number(dom.outfitY?.value ?? 0) || 0,
        z: Number(dom.outfitZ?.value ?? 0) || 0,
        scale: Number(dom.outfitScale?.value ?? 1) || 1,
      },
    };
    buildOutfit();
  }

  function presetOutfit() {
    for (const slot of ['body', 'head', 'hand', 'foot']) {
      const first = outfitItems.find((item) => item.slot === slot);
      outfitState.entries[slot] = first?.id ?? '';
    }
    syncOutfitControls();
    buildOutfit();
  }

  async function saveOutfit() {
    try {
      if (!outfitState.projectId) throw new EditError('NO_PROJECT', 'Selecciona un proyecto.');
      const name = dom.outfitName?.value.trim() || outfitState.name;
      const outfit = {
        schemaVersion: 1,
        id: slugify(name),
        name,
        moduleId: state.moduleId,
        bodySkin: outfitState.skin,
        entries: { ...outfitState.entries },
        transforms: { ...(outfitState.transforms ?? {}) },
        updatedAt: new Date().toISOString(),
      };
      await api.saveOutfit(outfitState.projectId, outfit);
      outfitState.name = name;
      outfitState.entries = { ...outfit.entries };
      await refreshOutfitList();
      if (dom.outfitList) dom.outfitList.value = outfit.id;
      outfitMessage(`Outfit guardado: ${outfit.name}`);
    } catch (error) {
      outfitMessage(`No se pudo guardar: ${errorText(error)}`, 'error');
    }
  }

  async function loadOutfit() {
    try {
      if (!outfitState.projectId) throw new EditError('NO_PROJECT', 'Selecciona un proyecto.');
      const outfitId = dom.outfitList?.value;
      if (!outfitId) throw new EditError('NO_OUTFIT', 'Selecciona un outfit guardado.');
      const result = await api.outfit(outfitState.projectId, outfitId);
      const outfit = result.outfit;
      outfitState.skin = outfit.bodySkin ?? 'man';
      outfitState.name = outfit.name;
      outfitState.entries = { ...emptyEntries(), ...(outfit.entries ?? {}) };
      outfitState.transforms = { ...(outfit.transforms ?? {}) };
      syncOutfitControls();
      await buildOutfit();
      outfitMessage(`Outfit cargado: ${outfit.name}`);
    } catch (error) {
      outfitMessage(`No se pudo cargar: ${errorText(error)}`, 'error');
    }
  }

  function exportOutfitSnapshot() {
    if (!outfitActive || !renderer || !scene || !camera) {
      outfitMessage('No hay una vista de outfit activa.', 'warning');
      return;
    }
    try {
      renderer.render(scene, camera);
      const link = document.createElement('a');
      link.href = renderer.domElement.toDataURL('image/png');
      link.download = `outfit-${slugify(outfitState.name)}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      outfitMessage(`Snapshot exportado: ${link.download}`);
    } catch (error) {
      outfitMessage(`No se pudo exportar: ${errorText(error)}`, 'error');
    }
  }

  async function deleteOutfit() {
    try {
      if (!outfitState.projectId) throw new EditError('NO_PROJECT', 'Selecciona un proyecto.');
      const outfitId = dom.outfitList?.value;
      if (!outfitId) throw new EditError('NO_OUTFIT', 'Selecciona un outfit guardado.');
      const confirm = window.prompt(`Escribe el id para eliminar '${outfitId}':`, '');
      if (confirm !== outfitId) {
        outfitMessage('Eliminación cancelada.', 'warning');
        return;
      }
      await api.removeOutfit(outfitState.projectId, outfitId, confirm);
      await refreshOutfitList();
      outfitMessage(`Outfit eliminado: ${outfitId}`);
    } catch (error) {
      outfitMessage(`No se pudo eliminar: ${errorText(error)}`, 'error');
    }
  }

  async function previewItem(itemId, slot) {
    if (!['body', 'head', 'hand', 'foot'].includes(slot)) {
      setMessage(`No se puede previsualizar la ranura '${slot}'.`, 'error');
      return;
    }
    outfitState.entries[slot] = itemId;
    if (viewSideTab !== 'outfit') {
      await setSideTab('outfit');
    } else {
      syncOutfitControls();
      await buildOutfit();
    }
  }

  /* ---------------- init ---------------- */

  function init() {
    let timer = null;
    dom.search.addEventListener('input', () => {      clearTimeout(timer);
      timer = setTimeout(() => {
        view.query = dom.search.value.trim();
        fetchPage(false);
      }, 160);
    });
    dom.more.addEventListener('click', () => fetchPage(true));
    dom.resetCamera.addEventListener('click', () => {
      if (outfitActive && outfitGroup) {
        const bounds = bboxToJson(new THREE.Box3().setFromObject(outfitGroup));
        if (bounds) controls.frame(bounds);
      } else if (model) {
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
      for (const cached of outfitCachedMaterials.values()) cached.wireframe = wireframe;
    });
    dom.flip.addEventListener('click', () => {
      flipV = !flipV;
      dom.flip.classList.toggle('is-active', flipV);
      if (meshObject) {
        meshObject.geometry.setAttribute('uv', buildUvAttribute());
        meshObject.geometry.attributes.uv.needsUpdate = true;
      }
      if (outfitActive) {
        for (const geometry of outfitCachedGeometries.values()) geometry.dispose();
        outfitCachedGeometries.clear();
        buildOutfit();
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

    dom.project.addEventListener('change', () => {
      view.projectId = dom.project.value;
      refreshTextureList();
    });
    dom.projectNew.addEventListener('click', async () => {
      await createProject();
      refreshTextureList();
    });
    dom.save.addEventListener('click', saveMesh);
    dom.load.addEventListener('click', loadMesh);
    dom.export.addEventListener('click', exportMesh);

    dom.tabMesh.addEventListener('click', () => setSideTab('mesh'));
    dom.tabMaterial.addEventListener('click', () => setSideTab('material'));
    dom.tabOutfit.addEventListener('click', () => setSideTab('outfit'));

    dom.outfitSkin.addEventListener('change', () => {
      outfitState.skin = dom.outfitSkin.value;
      buildOutfit();
    });
    for (const [slot, select] of [
      ['body', dom.outfitSlotBody],
      ['head', dom.outfitSlotHead],
      ['hand', dom.outfitSlotHand],
      ['foot', dom.outfitSlotFoot],
    ]) {
      select.addEventListener('change', () => {
        outfitState.entries[slot] = select.value;
        buildOutfit();
      });
    }
    dom.outfitTransformSlot.addEventListener('change', () => {
      const transform = outfitTransform(dom.outfitTransformSlot.value);
      dom.outfitX.value = String(transform.x);
      dom.outfitY.value = String(transform.y);
      dom.outfitZ.value = String(transform.z);
      dom.outfitScale.value = String(transform.scale);
    });
    dom.outfitApplyTransform.addEventListener('click', applyOutfitTransform);
    dom.outfitRefresh.addEventListener('click', async () => {
      await refreshOutfitData();
      await buildOutfit();
    });
    dom.outfitPreset.addEventListener('click', presetOutfit);
    dom.outfitAnalyze.addEventListener('click', analyzeOutfit);
    dom.outfitSave.addEventListener('click', saveOutfit);
    dom.outfitLoad.addEventListener('click', loadOutfit);
    dom.outfitDelete.addEventListener('click', deleteOutfit);
    dom.outfitExportSnapshot.addEventListener('click', exportOutfitSnapshot);
    dom.outfitProject.addEventListener('change', async () => {
      outfitState.projectId = dom.outfitProject.value;
      await refreshOutfitList();
    });

    dom.matPreview.addEventListener('click', () => applyMaterialPreview());
    dom.matSave.addEventListener('click', saveMaterial);
    dom.matLoad.addEventListener('click', loadMaterial);
    dom.matExport.addEventListener('click', exportMaterial);
    dom.matImport.addEventListener('click', importMaterialTexture);
    for (const toggle of [dom.matNormalToggle, dom.matSpecToggle, dom.matAlphaToggle, dom.matDoubleToggle]) {
      toggle.addEventListener('change', () => applyMaterialPreview());
    }

    dom.canvas.addEventListener('pointerdown', onCanvasPointerDown);
    dom.canvas.addEventListener('pointerup', onCanvasPointerUp);

    loadProjects();
    updateEditUi();
  }

  return { init, loadList, select, setActive, view, loadProjects, previewItem };
}
