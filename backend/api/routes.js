// @ts-check
/** JSON API routes. All handlers return plain objects; errors bubble up. */

/**
 * @param {import('../../engine/index.js').WarbandEngine} engine
 */
export function createApi(engine) {
  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   * @param {string} urlPath
   * @param {URLSearchParams} query
   * @param {any} body
   */
  async function route(req, res, urlPath, query, body) {
    const method = req.method ?? 'GET';

    if (method === 'GET' && urlPath === '/api/health') {
      return {
        ok: true,
        service: 'warband-outfit-studio',
        version: '0.12.0',
        phase: 10,
        uptimeSeconds: Math.round(process.uptime()),
        node: process.version,
      };
    }

    if (method === 'GET' && urlPath === '/api/status') {
      return { ok: true, ...engine.getStatus() };
    }

    if (method === 'GET' && urlPath === '/api/diagnostics') {
      return { ok: true, ...(await engine.getDiagnostics()) };
    }

    if (method === 'GET' && urlPath === '/api/logs') {
      return { ok: true, ...(await engine.getLogTail(query.get('lines') ?? 200)) };
    }

    /* ---- installation profiles ---- */

    if (method === 'GET' && urlPath === '/api/profiles') {
      const status = engine.getStatus();
      return { ok: true, ...status.profiles, installation: status.installation };
    }

    if (method === 'POST' && urlPath === '/api/profiles') {
      if (!body?.path) {
        const error = new Error('Body must contain { path }');
        // @ts-expect-error machine-readable
        error.code = 'BAD_REQUEST';
        throw error;
      }
      const result = await engine.addProfile({ path: String(body.path), label: body.label ? String(body.label) : undefined });
      return { ok: true, ...result, status: engine.getStatus() };
    }

    const profileAction = urlPath.match(/^\/api\/profiles\/([^/]+)\/(activate|validate)$/);
    if (method === 'POST' && profileAction) {
      const id = decodeURIComponent(profileAction[1]);
      if (profileAction[2] === 'activate') {
        const result = await engine.activateProfile(id);
        return { ok: true, ...result, status: engine.getStatus() };
      }
      const result = await engine.validateProfiles();
      return { ok: true, ...result, status: engine.getStatus() };
    }

    const profileRoute = urlPath.match(/^\/api\/profiles\/([^/]+)$/);
    if (method === 'DELETE' && profileRoute) {
      const id = decodeURIComponent(profileRoute[1]);
      const confirm = query.get('confirm') ?? '';
      const result = await engine.removeProfile(id, confirm);
      return { ok: true, ...result, status: engine.getStatus() };
    }

    if (method === 'POST' && urlPath === '/api/profiles/validate') {
      const result = await engine.validateProfiles();
      return { ok: true, ...result, status: engine.getStatus() };
    }

    if (method === 'GET' && urlPath === '/api/modules') {
      engine.requireInstallation();
      return {
        ok: true,
        modules: engine.modules.map((module) => ({
          id: module.id,
          slug: module.slug,
          name: module.moduleName,
          dirName: module.dirName,
          version: module.version,
          operationSetVersion: module.operationSetVersion,
          capabilities: module.capabilities,
          commonResources: module.commonResources.length,
          moduleResources: module.moduleResources.length,
          unknownIniKeys: module.unknownKeys,
        })),
      };
    }

    const moduleSummary = urlPath.match(/^\/api\/modules\/([^/]+)\/summary$/);
    if (method === 'GET' && moduleSummary) {
      return { ok: true, ...(await engine.getModuleSummary(decodeURIComponent(moduleSummary[1]))) };
    }

    if (method === 'GET' && urlPath === '/api/items') {
      const moduleId = query.get('module') ?? 'Native';
      const result = await engine.listItems(moduleId, {
        slot: query.get('slot') ?? undefined,
        category: query.get('category') ?? undefined,
        q: query.get('q') ?? undefined,
        wearable: query.get('wearable') !== '0',
        limit: Number(query.get('limit') ?? 100),
        offset: Number(query.get('offset') ?? 0),
      });
      return { ok: true, module: moduleId, ...result };
    }

    if (method === 'GET' && urlPath === '/api/item-schema') {
      return { ok: true, ...engine.getItemSchema() };
    }

    const itemEditable = urlPath.match(/^\/api\/items\/([^/]+)\/editable$/);
    if (method === 'GET' && itemEditable) {
      const moduleId = query.get('module') ?? 'Native';
      return {
        ok: true,
        module: moduleId,
        ...(await engine.getItemEditable(moduleId, decodeURIComponent(itemEditable[1]))),
      };
    }

    const itemDetail = urlPath.match(/^\/api\/items\/([^/]+)$/);
    if (method === 'GET' && itemDetail) {
      const moduleId = query.get('module') ?? 'Native';
      const detail = await engine.getItemDetail(moduleId, decodeURIComponent(itemDetail[1]));
      return { ok: true, module: moduleId, ...detail };
    }

    if (method === 'POST' && urlPath === '/api/validate') {
      if (!body || !Array.isArray(body.ids) || body.ids.length === 0) {
        const error = new Error('Body must contain { module, ids: string[] }');
        // @ts-expect-error machine-readable
        error.code = 'BAD_REQUEST';
        throw error;
      }
      const moduleId = body.module ?? 'Native';
      const result = await engine.validate(moduleId, body.ids.map(String));
      return { ok: true, module: moduleId, ...result };
    }

    /* ---- asset index ---- */

    if (method === 'GET' && urlPath === '/api/resources') {
      const moduleId = query.get('module') ?? 'Native';
      const result = await engine.listResources(moduleId, {
        type: query.get('type') ?? 'mesh',
        q: query.get('q') ?? undefined,
        limit: Number(query.get('limit') ?? 100),
        offset: Number(query.get('offset') ?? 0),
      });
      return { ok: true, module: moduleId, ...result };
    }

    const resourceDetail = urlPath.match(/^\/api\/resources\/(mesh|material|texture|shader)\/(.+)$/);
    if (method === 'GET' && resourceDetail) {
      const moduleId = query.get('module') ?? 'Native';
      const result = await engine.getResourceDetail(
        moduleId,
        resourceDetail[1],
        decodeURIComponent(resourceDetail[2]),
      );
      return { ok: true, module: moduleId, ...result };
    }

    /* ---- viewport data ---- */

    const meshEditable = urlPath.match(/^\/api\/meshes\/(.+)\/editable$/);
    if (method === 'GET' && meshEditable) {
      const moduleId = query.get('module') ?? 'Native';
      const result = await engine.getMeshEditable(moduleId, decodeURIComponent(meshEditable[1]));
      return { ok: true, module: moduleId, ...result };
    }

    const outfitRender = urlPath.match(/^\/api\/meshes\/(.+)\/outfit-render$/);
    if (method === 'GET' && outfitRender) {
      const moduleId = query.get('module') ?? 'Native';
      const result = await engine.getOutfitMeshRenderData(moduleId, decodeURIComponent(outfitRender[1]), {
        slot: query.get('slot') ?? undefined,
        role: query.get('role') ?? undefined,
        bone: query.get('bone') ?? undefined,
      });
      return { ok: true, module: moduleId, ...result };
    }

    const meshGeometry = urlPath.match(/^\/api\/meshes\/(.+)\/geometry$/);
    if (method === 'GET' && meshGeometry) {
      const moduleId = query.get('module') ?? 'Native';
      const result = await engine.getMeshRenderData(moduleId, decodeURIComponent(meshGeometry[1]));
      return { ok: true, module: moduleId, ...result };
    }

    const textureRaw = urlPath.match(/^\/api\/textures\/(.+)\/raw$/);
    if (method === 'GET' && textureRaw) {
      const moduleId = query.get('module') ?? 'Native';
      const result = await engine.getTextureFile(moduleId, decodeURIComponent(textureRaw[1]));
      return {
        __binary: true,
        body: result.buffer,
        contentType: 'application/octet-stream',
        headers: {
          'X-Texture-Name': result.fileName,
        },
      };
    }

    /* ---- backups ---- */

    if (method === 'GET' && urlPath === '/api/workspaces') {
      return { ok: true, workspaces: await engine.listWorkspaces() };
    }

    if (method === 'POST' && urlPath === '/api/workspaces') {
      if (!body?.label) {
        const error = new Error('Body must contain { label }');
        // @ts-expect-error machine-readable
        error.code = 'BAD_REQUEST';
        throw error;
      }
      const workspace = await engine.createWorkspace(String(body.label), {
        moduleId: body.module,
        reuse: Boolean(body.reuse),
      });
      return { ok: true, workspace };
    }

    const workspaceRoute = urlPath.match(/^\/api\/workspaces\/([^/]+)$/);
    if (method === 'DELETE' && workspaceRoute) {
      const id = decodeURIComponent(workspaceRoute[1]);
      const confirm = query.get('confirm') ?? '';
      const result = await engine.removeWorkspace(id, confirm);
      return { ok: true, ...result };
    }

    if (method === 'GET' && urlPath === '/api/backups') {
      return { ok: true, ...(await engine.listBackups()) };
    }

    if (method === 'POST' && urlPath === '/api/backups/prune') {
      return {
        ok: true,
        ...(await engine.pruneBackups(body?.keep ?? 5, body?.confirm ?? '')),
      };
    }

    if (method === 'POST' && urlPath === '/api/backups/restore') {
      if (!body?.kind || !body?.path || !body?.confirm) {
        const error = new Error('Body must contain { kind, path, confirm }');
        // @ts-expect-error machine-readable
        error.code = 'BAD_REQUEST';
        throw error;
      }
      if (body.kind === 'project') {
        const result = await engine.restoreProjectBackup(String(body.path), String(body.confirm));
        return { ok: true, kind: 'project', ...result };
      }
      if (body.kind === 'workspace') {
        if (!body.workspaceId) {
          const error = new Error('Workspace restores require workspaceId');
          // @ts-expect-error machine-readable
          error.code = 'BAD_REQUEST';
          throw error;
        }
        const result = await engine.restoreWorkspaceBackup(
          String(body.workspaceId),
          String(body.path),
          String(body.confirm),
        );
        return { ok: true, kind: 'workspace', ...result };
      }
      const error = new Error(`Unknown backup kind '${body.kind}'`);
      // @ts-expect-error machine-readable
      error.code = 'BAD_REQUEST';
      throw error;
    }

    if (method === 'GET' && urlPath === '/api/projects') {
      return { ok: true, projects: await engine.projects.list() };
    }

    const materialEditable = urlPath.match(/^\/api\/materials\/(.+)\/editable$/);
    if (method === 'GET' && materialEditable) {
      const moduleId = query.get('module') ?? 'Native';
      const result = await engine.getMaterialEditable(moduleId, decodeURIComponent(materialEditable[1]));
      return { ok: true, module: moduleId, ...result };
    }

    /* ---- character bodies & outfits ---- */

    if (method === 'GET' && urlPath === '/api/skins') {
      const moduleId = query.get('module') ?? 'Native';
      return { ok: true, module: moduleId, ...(await engine.getSkins(moduleId)) };
    }

    if (method === 'GET' && urlPath === '/api/characters') {
      const moduleId = query.get('module') ?? 'Native';
      const skin = query.get('skin') ?? 'man';
      return { ok: true, module: moduleId, ...(await engine.getCharacter(moduleId, skin)) };
    }

    const outfitMeshes = urlPath.match(/^\/api\/outfit-items\/([^/]+)\/meshes$/);
    if (method === 'GET' && outfitMeshes) {
      const moduleId = query.get('module') ?? 'Native';
      return {
        ok: true,
        module: moduleId,
        ...(await engine.getOutfitItemMeshes(moduleId, decodeURIComponent(outfitMeshes[1]))),
      };
    }

    if (method === 'POST' && urlPath === '/api/outfits/analyze') {
      return { ok: true, ...(engine.analyzeOutfit(body ?? {})) };
    }

    const projectBuild = urlPath.match(/^\/api\/projects\/([^/]+)\/build$/);
    if (method === 'POST' && projectBuild) {
      const projectId = decodeURIComponent(projectBuild[1]);
      return {
        ok: true,
        ...(await engine.buildProject(projectId, {
          copyModule: body?.copyModule === true,
          label: body?.label,
        })),
      };
    }

    if (method === 'GET' && urlPath === '/api/builds') {
      return { ok: true, ...(await engine.listBuilds()) };
    }

    if (method === 'POST' && urlPath === '/api/builds/prune') {
      return {
        ok: true,
        ...(await engine.pruneBuilds(body?.keep ?? 5, body?.confirm ?? '')),
      };
    }

    const buildDiff = urlPath.match(/^\/api\/builds\/([^/]+)\/diff$/);
    if (method === 'GET' && buildDiff) {
      return { ok: true, ...(await engine.diffBuild(decodeURIComponent(buildDiff[1]))) };
    }

    const buildRollback = urlPath.match(/^\/api\/builds\/([^/]+)\/rollback$/);
    if (method === 'POST' && buildRollback) {
      return {
        ok: true,
        ...(await engine.rollbackBuild(
          body?.projectId ?? '',
          decodeURIComponent(buildRollback[1]),
          body?.confirm ?? '',
        )),
      };
    }

    const buildDetail = urlPath.match(/^\/api\/builds\/([^/]+)$/);
    if (method === 'GET' && buildDetail) {
      return { ok: true, ...(await engine.getBuild(decodeURIComponent(buildDetail[1]))) };
    }

    const projectItemsExport = urlPath.match(/^\/api\/projects\/([^/]+)\/items\/export$/);
    if (method === 'POST' && projectItemsExport) {
      const projectId = decodeURIComponent(projectItemsExport[1]);
      return {
        ok: true,
        ...(await engine.exportItemOverrides(projectId, {
          workspaceLabel: body?.workspaceLabel ?? undefined,
        })),
      };
    }

    const projectItems = urlPath.match(/^\/api\/projects\/([^/]+)\/items$/);
    if (projectItems) {
      const projectId = decodeURIComponent(projectItems[1]);
      if (method === 'GET') {
        return { ok: true, items: await engine.listItemOverrides(projectId) };
      }
      if (method === 'POST') {
        if (!body?.override) {
          const error = new Error('Body must contain { override }');
          // @ts-expect-error machine-readable
          error.code = 'BAD_REQUEST';
          throw error;
        }
        const override = await engine.saveItemOverride(projectId, body.override);
        return { ok: true, override };
      }
    }

    const projectItem = urlPath.match(/^\/api\/projects\/([^/]+)\/items\/([^/]+)$/);
    if (projectItem) {
      const projectId = decodeURIComponent(projectItem[1]);
      const itemId = decodeURIComponent(projectItem[2]);
      if (method === 'GET') {
        return { ok: true, override: await engine.getItemOverride(projectId, itemId) };
      }
      if (method === 'DELETE') {
        return { ok: true, ...(await engine.removeItemOverride(projectId, itemId, query.get('confirm') ?? '')) };
      }
    }

    const projectOutfits = urlPath.match(/^\/api\/projects\/([^/]+)\/outfits$/);
    if (projectOutfits) {
      const projectId = decodeURIComponent(projectOutfits[1]);
      if (method === 'GET') {
        return { ok: true, outfits: await engine.listOutfits(projectId) };
      }
      if (method === 'POST') {
        if (!body?.outfit) {
          const error = new Error('Body must contain { outfit }');
          // @ts-expect-error machine-readable
          error.code = 'BAD_REQUEST';
          throw error;
        }
        const outfit = await engine.saveOutfit(projectId, body.outfit);
        return { ok: true, outfit };
      }
    }

    const projectOutfit = urlPath.match(/^\/api\/projects\/([^/]+)\/outfits\/([^/]+)$/);
    if (projectOutfit) {
      const projectId = decodeURIComponent(projectOutfit[1]);
      const outfitId = decodeURIComponent(projectOutfit[2]);
      if (method === 'GET') {
        return { ok: true, outfit: await engine.getOutfit(projectId, outfitId) };
      }
      if (method === 'DELETE') {
        return { ok: true, ...(await engine.removeOutfit(projectId, outfitId, query.get('confirm') ?? '')) };
      }
    }

    /* ---- project material & texture overrides ---- */

    const projectMaterials = urlPath.match(/^\/api\/projects\/([^/]+)\/materials$/);
    if (projectMaterials) {
      const projectId = decodeURIComponent(projectMaterials[1]);
      if (method === 'GET') {
        return { ok: true, materials: await engine.listMaterialOverrides(projectId) };
      }
      if (method === 'POST') {
        if (!body?.override) {
          const error = new Error('Body must contain { override }');
          // @ts-expect-error machine-readable
          error.code = 'BAD_REQUEST';
          throw error;
        }
        const override = await engine.saveMaterialOverride(projectId, body.override);
        return { ok: true, override };
      }
    }

    const projectMaterial = urlPath.match(/^\/api\/projects\/([^/]+)\/materials\/([^/]+)$/);
    if (projectMaterial) {
      const projectId = decodeURIComponent(projectMaterial[1]);
      const materialId = decodeURIComponent(projectMaterial[2]);
      if (method === 'GET') {
        return { ok: true, override: await engine.getMaterialOverride(projectId, materialId) };
      }
      if (method === 'DELETE') {
        const result = await engine.removeMaterialOverride(projectId, materialId, query.get('confirm') ?? '');
        return { ok: true, ...result };
      }
    }

    const projectMaterialExport = urlPath.match(/^\/api\/projects\/([^/]+)\/materials\/([^/]+)\/export$/);
    if (method === 'POST' && projectMaterialExport) {
      const projectId = decodeURIComponent(projectMaterialExport[1]);
      const materialId = decodeURIComponent(projectMaterialExport[2]);
      const result = await engine.exportMaterialOverride(projectId, materialId, {
        workspaceLabel: body?.workspaceLabel,
      });
      return { ok: true, ...result };
    }

    const projectTextures = urlPath.match(/^\/api\/projects\/([^/]+)\/textures$/);
    if (projectTextures) {
      const projectId = decodeURIComponent(projectTextures[1]);
      if (method === 'GET') {
        return { ok: true, textures: await engine.listProjectTextures(projectId) };
      }
      if (method === 'POST') {
        if (!body?.texture) {
          const error = new Error('Body must contain { texture }');
          // @ts-expect-error machine-readable
          error.code = 'BAD_REQUEST';
          throw error;
        }
        return { ok: true, texture: await engine.saveProjectTexture(projectId, body.texture) };
      }
    }

    const projectTextureRaw = urlPath.match(/^\/api\/projects\/([^/]+)\/textures\/([^/]+)\/raw$/);
    if (method === 'GET' && projectTextureRaw) {
      const projectId = decodeURIComponent(projectTextureRaw[1]);
      const name = decodeURIComponent(projectTextureRaw[2]);
      const result = await engine.getProjectTextureFile(projectId, name);
      return {
        __binary: true,
        body: result.buffer,
        contentType: 'application/octet-stream',
        headers: {
          'Content-Disposition': `inline; filename="${result.texture.name.replace(/[^A-Za-z0-9._-]/g, '_')}"`,
        },
      };
    }

    const projectTexture = urlPath.match(/^\/api\/projects\/([^/]+)\/textures\/([^/]+)$/);
    if (method === 'DELETE' && projectTexture) {
      const projectId = decodeURIComponent(projectTexture[1]);
      const name = decodeURIComponent(projectTexture[2]);
      const result = await engine.removeProjectTexture(projectId, name, query.get('confirm') ?? '');
      return { ok: true, ...result };
    }

    const workspaceTexture = urlPath.match(/^\/api\/workspaces\/([^/]+)\/textures$/);
    if (method === 'POST' && workspaceTexture) {
      if (!body?.fileName || !body?.data) {
        const error = new Error('Body must contain { fileName, data } (base64)');
        // @ts-expect-error machine-readable
        error.code = 'BAD_REQUEST';
        throw error;
      }
      const buffer = Buffer.from(String(body.data), 'base64');
      const result = await engine.importTexture(
        decodeURIComponent(workspaceTexture[1]),
        String(body.fileName),
        buffer,
      );
      return { ok: true, ...result };
    }

    /* ---- project mesh overrides ---- */

    const projectMeshes = urlPath.match(/^\/api\/projects\/([^/]+)\/meshes$/);
    if (projectMeshes) {
      const projectId = decodeURIComponent(projectMeshes[1]);
      if (method === 'GET') {
        return { ok: true, meshes: await engine.listMeshOverrides(projectId) };
      }
      if (method === 'POST') {
        if (!body?.override) {
          const error = new Error('Body must contain { override }');
          // @ts-expect-error machine-readable
          error.code = 'BAD_REQUEST';
          throw error;
        }
        const override = await engine.saveMeshOverride(projectId, body.override);
        return { ok: true, override };
      }
    }

    const projectMesh = urlPath.match(/^\/api\/projects\/([^/]+)\/meshes\/([^/]+)$/);
    if (projectMesh) {
      const projectId = decodeURIComponent(projectMesh[1]);
      const meshId = decodeURIComponent(projectMesh[2]);
      if (method === 'GET') {
        return { ok: true, override: await engine.getMeshOverride(projectId, meshId) };
      }
      if (method === 'DELETE') {
        const result = await engine.removeMeshOverride(projectId, meshId, query.get('confirm') ?? '');
        return { ok: true, ...result };
      }
    }

    const projectMeshExport = urlPath.match(/^\/api\/projects\/([^/]+)\/meshes\/([^/]+)\/export$/);
    if (method === 'POST' && projectMeshExport) {
      const projectId = decodeURIComponent(projectMeshExport[1]);
      const meshId = decodeURIComponent(projectMeshExport[2]);
      const result = await engine.exportMeshOverride(projectId, meshId, {
        workspaceLabel: body?.workspaceLabel,
      });
      return { ok: true, ...result };
    }

    if (method === 'POST' && urlPath === '/api/projects') {
      const installation = engine.requireInstallation();
      const moduleId = body?.module ?? 'Native';
      engine.requireModule(moduleId);
      const project = await engine.projects.create({
        name: body?.name ?? 'Untitled outfit project',
        installationId: installation.id,
        installationPath: installation.rootPath,
        moduleId,
        notes: body?.notes ?? '',
      });
      return { ok: true, project, file: `projects/${project.id}.json` };
    }

    const projectRoute = urlPath.match(/^\/api\/projects\/([^/]+)$/);
    if (projectRoute) {
      const id = decodeURIComponent(projectRoute[1]);
      if (method === 'GET') {
        return { ok: true, project: await engine.projects.load(id) };
      }
      if (method === 'PUT') {
        if (!body?.project || body.project.id !== id) {
          const error = new Error('Body must contain { project } with the same id');
          // @ts-expect-error machine-readable
          error.code = 'BAD_REQUEST';
          throw error;
        }
        const saved = await engine.projects.save(body.project);
        return { ok: true, project: saved, backup: true };
      }
    }

    const notFound = new Error(`Unknown route ${method} ${urlPath}`);
    // @ts-expect-error machine-readable
    notFound.code = 'NOT_FOUND';
    throw notFound;
  }

  return { route };
}
