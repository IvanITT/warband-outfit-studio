# Change log

Registro documental de actualizaciones posteriores a la primera versión pública.
Las entradas se añaden en orden cronológico inverso.

---

## 2026-11-06 — Vista previa, importación y exportación de texturas

**Versión:** `0.12.0`  
**Tipo:** mejora funcional
**Estado:** implementado

### Añadido

- Vista previa DDS al seleccionar una textura en **Recursos**.
- Render de la textura sobre un fondo de tablero para comprobar transparencia.
- Exportación de la textura seleccionada como archivo `.dds`.
- Importación de archivos `.dds` desde el detalle de una textura.
- Selector de proyecto dentro del detalle de textura.
- Botón **+ Nuevo** para crear un proyecto desde la vista de texturas.
- Las texturas importadas se registran en `project.textures[]` y aparecen en la lista de **Recursos** como texturas del proyecto.
- Las texturas de proyecto se pueden previsualizar y exportar igual que las del juego.
- Las texturas importadas quedan disponibles en el editor de materiales para asignarlas a diffuse/bump/spec y usarlas en nuevas prendas, ítems y personajes.

### Detalles técnicos

- `frontend/js/resources.js`
  - Decodificación DDS con `decodeDds`.
  - Vista previa sobre `canvas`.
  - Filtro de texturas del proyecto.
  - Importación a workspace `textures` y registro en proyecto.
  - Exportación mediante descarga Blob.
- `frontend/js/api.js`
  - `projectTextureBuffer(projectId, name)`.
- `backend/api/routes.js`
  - `GET /api/projects/:id/textures/:name/raw`.
- `engine/index.js`
  - `getProjectTextureFile(projectId, name)`.
- `frontend/index.html`
  - Selector de proyecto para texturas.
- `frontend/css/app.css`
  - Estilos de preview, selector de proyecto y formulario de importación.

### Verificación

- Selección de textura del juego: preview DDS 256×256 DXT1.
- Exportación de textura: descarga `.dds` de 43 832 bytes.
- Importación de un DDS como `my_custom_texture.dds`.
- Registro correcto en `project.textures[]`.
- Visualización del nuevo recurso en la lista de proyecto.
- Endpoint raw de textura de proyecto responde `200` con cabecera `DDS `.

### Notas

- El proyecto no modifica la instalación del juego.
- La textura importada se guarda en `workspace/textures/Textures/`.
- Para usarla en un personaje/ítem, se asigna desde el editor de materiales y se construye/exporta el proyecto correspondiente.

---

## Base inicial

**Versión:** `0.11.0`  
**Estado:** primera versión pública

El roadmap 0–10 quedó completo: visor 3D, edición de mallas, materiales,
outfits, editor de ítems, builder, retención/recuperación, release portátil,
primer arranque, diagnóstico y accesibilidad.
