/* ==========================================================
   Portal de Material y Tareas — versión 2
   Con gestión de cursos, sesiones, batch import, y links
   ========================================================== */

let sb = null;
let SUPABASE_URL = "";
let currentParticipant = null;   // { email, nombre, cargo, sesiones: [] }
let adminPassword = null;
let cursoActual = null;
let sesionesCache = [];
let materialCache = [];
let tareasCache = [];
let questionRows = [];

/* ---------------------- utilidades ---------------------- */

function $(id) { return document.getElementById(id); }

function esc(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function fmtFecha(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("es-CL", { dateStyle: "medium", timeStyle: "short" });
}

function fileUrl(path) {
  if (!path) return null;
  return sb.storage.from("materiales").getPublicUrl(path).data.publicUrl;
}

function showScreen(id) {
  ["screen-home", "screen-participant-login", "screen-participant",
   "screen-admin-login", "screen-admin"].forEach(s => {
    const el = $(s);
    if (el) el.classList.toggle("hidden", s !== id);
  });
}

function setWho(text, showLogout) {
  $("whoLabel").textContent = text || "";
  $("btnLogout").classList.toggle("hidden", !showLogout);
}

/* ---------------------- arranque ---------------------- */

async function init() {
  const res = await fetch("./config.json");
  const cfg = await res.json();
  SUPABASE_URL = cfg.SUPABASE_URL;
  sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  wireEvents();
  showScreen("screen-home");
}

function wireEvents() {
  // Home
  $("btnGoParticipant").onclick = () => showScreen("screen-participant-login");
  $("btnGoAdmin").onclick = () => showScreen("screen-admin-login");
  $("btnBackHome1").onclick = () => showScreen("screen-home");
  $("btnBackHome2").onclick = () => showScreen("screen-home");
  $("btnLogout").onclick = doLogout;

  // Participant login
  $("btnParticipantEnter").onclick = participantLogin;
  $("pEmailInput").addEventListener("keydown", e => { if (e.key === "Enter") participantLogin(); });

  // Admin login
  $("btnAdminEnter").onclick = adminLogin;
  $("adminPasswordInput").addEventListener("keydown", e => { if (e.key === "Enter") adminLogin(); });

  // Admin tabs
  $("tabCursoBtn").onclick = () => switchAdminTab("curso");
  $("tabPartBtn").onclick = () => switchAdminTab("part");
  $("tabMatBtn").onclick = () => switchAdminTab("mat");
  $("tabTarBtn").onclick = () => switchAdminTab("tar");
  $("tabRespBtn").onclick = () => switchAdminTab("resp");
  $("tabPassBtn").onclick = () => switchAdminTab("pass");

  // Course management
  $("btnSaveCurso").onclick = adminSaveCurso;
  $("btnAddSesion").onclick = adminAddSesion;
  $("btnSaveSesion").onclick = adminSaveSesion;
  $("btnDeleteSesion").onclick = adminDeleteSesion;

  // Participant management
  $("btnSavePart").onclick = adminSaveParticipante;
  $("btnBatchImportPart").onclick = adminBatchImportParticipantes;

  // Material and Task management
  $("btnSaveMat").onclick = adminSaveMaterial;
  $("btnSaveTar").onclick = adminSaveTarea;
  $("btnAddQuestion").onclick = () => { addQuestionRow(); renderQuestionsBuilder(); };

  // Password
  $("btnChangePass").onclick = adminChangePassword;

  // Participant view
  $("tabMaterialesBtn").onclick = () => switchParticipantTab("mat");
  $("tabTareasBtn").onclick = () => switchParticipantTab("tar");

  // Filters
  $("respFiltroTarea").onchange = () => loadAdminRespuestas();
}

function doLogout() {
  currentParticipant = null;
  adminPassword = null;
  setWho("", false);
  showScreen("screen-home");
}

/* ===================== PARTICIPANT FLOW ===================== */

async function participantLogin() {
  const email = $("pEmailInput").value.trim().toLowerCase();
  if (!email) return alert("Ingresa tu correo");

  try {
    const { data } = await sb.rpc("buscar_participante", { p_email: email });
    if (!data || data.length === 0) return alert("Correo no registrado");

    const p = data[0];
    currentParticipant = { email, nombre: p.nombre, cargo: p.cargo, sesiones: p.sesiones };
    setWho(`${p.nombre} (${p.cargo || "participante"})`, true);

    await loadMaterialesParticipante();
    switchParticipantTab("mat");
    showScreen("screen-participant");
  } catch (e) {
    alert(`Error: ${e.message}`);
  }
}

async function loadMaterialesParticipante() {
  try {
    const { data } = await sb.rpc("materiales_para", { p_email: currentParticipant.email });
    materialCache = data || [];
    renderMateriales();
  } catch (e) {
    alert(`Error cargando material: ${e.message}`);
  }
}

async function loadTareasParticipante() {
  try {
    const { data } = await sb.rpc("tareas_para", { p_email: currentParticipant.email });
    tareasCache = data || [];
    renderTareas();
  } catch (e) {
    alert(`Error cargando tareas: ${e.message}`);
  }
}

function switchParticipantTab(tab) {
  $("tabMaterialesBtn").classList.toggle("active", tab === "mat");
  $("tabTareasBtn").classList.toggle("active", tab === "tar");
  $("materialContent").classList.toggle("hidden", tab !== "mat");
  $("tareasContent").classList.toggle("hidden", tab !== "tar");

  if (tab === "mat") loadMaterialesParticipante();
  else loadTareasParticipante();
}

function renderMateriales() {
  const html = materialCache
    .sort((a, b) => (a.sesion_nombre || "").localeCompare(b.sesion_nombre || ""))
    .reduce((acc, m) => {
      const folder = m.sesion_nombre || "General";
      if (!acc[folder]) acc[folder] = [];
      acc[folder].push(m);
      return acc;
    }, {});

  let out = "";
  for (const [folder, items] of Object.entries(html)) {
    out += `<div class="material-folder"><h3>${esc(folder)}</h3>`;
    for (const m of items) {
      out += `<div class="material-item">
        <h4>${esc(m.titulo)}</h4>
        <p>${esc(m.descripcion)}</p>`;

      if (m.archivo_path) {
        const url = fileUrl(m.archivo_path);
        out += `<a href="${esc(url)}" target="_blank" class="btn-link">📥 Descargar archivo</a>`;
      } else if (m.link_externo) {
        out += `<a href="${esc(m.link_externo)}" target="_blank" class="btn-link">🔗 Ver contenido</a>`;
      }
      out += `</div>`;
    }
    out += `</div>`;
  }
  $("materialContent").innerHTML = out || "<p>Sin material disponible</p>";
}

function renderTareas() {
  const html = tareasCache
    .sort((a, b) => (a.sesion_nombre || "").localeCompare(b.sesion_nombre || ""))
    .reduce((acc, t) => {
      const folder = t.sesion_nombre || "General";
      if (!acc[folder]) acc[folder] = [];
      acc[folder].push(t);
      return acc;
    }, {});

  let out = "";
  for (const [folder, items] of Object.entries(html)) {
    out += `<div class="tarea-folder"><h3>${esc(folder)}</h3>`;
    for (const t of items) {
      const respondido = t.respondido_en ? `Respondida: ${fmtFecha(t.respondido_en)}` : "Sin responder";
      out += `<div class="tarea-item">
        <h4>${esc(t.titulo)}</h4>
        <p>${esc(t.descripcion)} <em>(${respondido})</em></p>`;

      if (t.archivo_path) {
        const url = fileUrl(t.archivo_path);
        out += `<a href="${esc(url)}" target="_blank" class="btn-link">📥 Archivo</a>`;
      }

      const preguntas = t.preguntas || [];
      out += `<form onsubmit="submitTarea(event, '${t.id}')">`;
      for (const q of preguntas) {
        const respuesta = (t.mis_respuestas || {})[q.id] || "";
        out += `<div class="question">
          <label>${esc(q.texto)}</label>
          <textarea name="q_${q.id}" required>${esc(respuesta)}</textarea>
        </div>`;
      }
      out += `<button type="submit" class="btn-primary">Enviar respuestas</button></form></div>`;
    }
    out += `</div>`;
  }
  $("tareasContent").innerHTML = out || "<p>Sin tareas disponibles</p>";
}

async function submitTarea(e, tareaId) {
  e.preventDefault();
  const form = e.target;
  const respuestas = {};

  // Recopilar todas las respuestas del formulario
  Array.from(form.elements).forEach(el => {
    if (el.name && el.name.startsWith("q_")) {
      respuestas[el.name.substring(2)] = el.value;
    }
  });

  try {
    await sb.rpc("enviar_respuesta_tarea", {
      p_tarea_id: tareaId,
      p_email: currentParticipant.email,
      p_nombre: currentParticipant.nombre,
      p_respuestas: respuestas
    });
    alert("✓ Respuestas enviadas");
    await loadTareasParticipante();
  } catch (e) {
    alert(`Error: ${e.message}`);
  }
}

/* ===================== ADMIN FLOW ===================== */

async function adminLogin() {
  const pwd = $("adminPasswordInput").value;
  if (!pwd) return alert("Ingresa la clave");

  try {
    const { data } = await sb.rpc("admin_verificar", { p_password: pwd });
    if (!data) return alert("Clave incorrecta");

    adminPassword = pwd;
    setWho("ADMINISTRADOR", true);

    await loadAdminData();
    switchAdminTab("curso");
    showScreen("screen-admin");
  } catch (e) {
    alert(`Error: ${e.message}`);
  }
}

async function loadAdminData() {
  try {
    const { data: cursos } = await sb.rpc("admin_obtener_curso", { p_password: adminPassword });
    cursoActual = cursos?.[0] || { nombre: "", descripcion: "" };

    const { data: sesiones } = await sb.rpc("admin_listar_sesiones", { p_password: adminPassword });
    sesionesCache = sesiones || [];

    const { data: materiales } = await sb.rpc("admin_listar_materiales", { p_password: adminPassword });
    materialCache = materiales || [];

    const { data: tareas } = await sb.rpc("admin_listar_tareas", { p_password: adminPassword });
    tareasCache = tareas || [];
  } catch (e) {
    alert(`Error cargando datos: ${e.message}`);
  }
}

function switchAdminTab(tab) {
  const tabs = ["curso", "part", "mat", "tar", "resp", "pass"];
  tabs.forEach(t => {
    const btn = $(`tab${t === "curso" ? "Curso" : t === "part" ? "Part" : t === "mat" ? "Mat" : t === "tar" ? "Tar" : t === "resp" ? "Resp" : "Pass"}Btn`);
    const content = $(`${t}Content`);
    if (btn) btn.classList.toggle("active", t === tab);
    if (content) content.classList.toggle("hidden", t !== tab);
  });

  if (tab === "curso") renderCursoEditor();
  else if (tab === "part") renderParticipantesEditor();
  else if (tab === "mat") renderMaterialesEditor();
  else if (tab === "tar") renderTareasEditor();
  else if (tab === "resp") loadAdminRespuestas();
}

/* --------- Course Management --------- */

function renderCursoEditor() {
  const c = cursoActual || { nombre: "", descripcion: "" };
  let out = `<h2>Información del Curso</h2>
    <div class="form-group">
      <label>Nombre del curso:</label>
      <input type="text" id="cursoNombre" value="${esc(c.nombre)}" placeholder="Ej: Curso de Matemáticas">
    </div>
    <div class="form-group">
      <label>Descripción:</label>
      <textarea id="cursoDescripcion" placeholder="Descripción breve del curso">${esc(c.descripcion)}</textarea>
    </div>
    <button id="btnSaveCurso" class="btn-primary">Guardar curso</button>

    <hr>
    <h2>Sesiones</h2>
    <p><em>Las sesiones agrupan el material y las tareas</em></p>

    <div id="sesionesListContainer">`;

  for (const s of sesionesCache) {
    out += `<div class="sesion-item">
      <strong>${esc(s.nombre)}</strong>
      <button onclick="editSesion('${s.id}')" class="btn-small">Editar</button>
      <button onclick="deleteSesion('${s.id}')" class="btn-small btn-danger">Eliminar</button>
    </div>`;
  }

  out += `</div>
    <hr>
    <h3>Nueva sesión:</h3>
    <div class="form-group">
      <label>Nombre:</label>
      <input type="text" id="newSesionNombre" placeholder="Ej: Sesión 1">
    </div>
    <button id="btnAddSesion" class="btn-primary">Agregar sesión</button>`;

  $("cursoContent").innerHTML = out;

  // Re-wire buttons
  $("btnSaveCurso").onclick = adminSaveCurso;
  $("btnAddSesion").onclick = adminAddSesion;
}

async function adminSaveCurso() {
  const nombre = $("cursoNombre").value.trim();
  const descripcion = $("cursoDescripcion").value.trim();
  if (!nombre) return alert("Ingresa nombre del curso");

  try {
    await sb.rpc("admin_guardar_curso", {
      p_password: adminPassword,
      p_nombre: nombre,
      p_descripcion: descripcion
    });
    alert("✓ Curso guardado");
    await loadAdminData();
    renderCursoEditor();
  } catch (e) {
    alert(`Error: ${e.message}`);
  }
}

async function adminAddSesion() {
  const nombre = $("newSesionNombre").value.trim();
  if (!nombre) return alert("Ingresa nombre de la sesión");

  try {
    const nextOrden = (sesionesCache.length || 0) + 1;
    await sb.rpc("admin_guardar_sesion", {
      p_password: adminPassword,
      p_id: null,
      p_nombre: nombre,
      p_orden: nextOrden
    });
    alert("✓ Sesión agregada");
    await loadAdminData();
    renderCursoEditor();
  } catch (e) {
    alert(`Error: ${e.message}`);
  }
}

function editSesion(id) {
  const s = sesionesCache.find(x => x.id === id);
  if (!s) return;

  const newNombre = prompt("Nuevo nombre:", s.nombre);
  if (newNombre === null) return;

  adminSaveSesionDirectly(id, newNombre.trim(), s.orden);
}

function deleteSesion(id) {
  if (!confirm("¿Eliminar esta sesión? Se perderá todo su material y tareas.")) return;
  adminDeleteSesionDirectly(id);
}

async function adminSaveSesionDirectly(id, nombre, orden) {
  try {
    await sb.rpc("admin_guardar_sesion", {
      p_password: adminPassword,
      p_id: id,
      p_nombre: nombre,
      p_orden: orden
    });
    await loadAdminData();
    renderCursoEditor();
  } catch (e) {
    alert(`Error: ${e.message}`);
  }
}

async function adminDeleteSesionDirectly(id) {
  try {
    await sb.rpc("admin_eliminar_sesion", {
      p_password: adminPassword,
      p_id: id
    });
    await loadAdminData();
    renderCursoEditor();
  } catch (e) {
    alert(`Error: ${e.message}`);
  }
}

/* --------- Participant Management --------- */

function renderParticipantesEditor() {
  let out = `<h2>Agregar participante</h2>
    <div class="form-group">
      <label>Correo:</label>
      <input type="email" id="partEmail" placeholder="ejemplo@mail.com">
    </div>
    <div class="form-group">
      <label>Nombre:</label>
      <input type="text" id="partNombre" placeholder="Juan Pérez">
    </div>
    <div class="form-group">
      <label>Cargo:</label>
      <input type="text" id="partCargo" placeholder="director, docente, etc">
    </div>
    <div class="form-group">
      <label>Sesiones (selecciona con Ctrl/Cmd):</label>
      <select id="partSesiones" multiple size="5">`;

  for (const s of sesionesCache) {
    out += `<option value="${s.id}">${esc(s.nombre)}</option>`;
  }

  out += `</select>
    </div>
    <button id="btnSavePart" class="btn-primary">Guardar participante</button>

    <hr>
    <h2>Importar varios participantes</h2>
    <p><em>Pega una lista en formato: email, nombre, cargo (una persona por línea)</em></p>
    <textarea id="batchImportText" placeholder="usuario1@mail.com, Juan Pérez, director&#10;usuario2@mail.com, María López, docente" rows="6"></textarea>
    <button id="btnBatchImportPart" class="btn-primary">Importar lote</button>

    <hr>
    <h2>Participantes existentes</h2>
    <div id="participantesListContainer"></div>`;

  $("partContent").innerHTML = out;

  loadAndRenderParticipantes();
}

async function loadAndRenderParticipantes() {
  try {
    const { data } = await sb.rpc("admin_listar_participantes", { p_password: adminPassword });
    const participantes = data || [];

    let out = "";
    for (const p of participantes) {
      const sesionesNombres = p.sesiones
        ?.map(id => sesionesCache.find(s => s.id === id)?.nombre || "?")
        .join(", ") || "(ninguna)";

      out += `<div class="participante-item">
        <strong>${esc(p.nombre)}</strong> (${esc(p.email)})
        <br><small>Cargo: ${esc(p.cargo)}, Sesiones: ${sesionesNombres}</small>
        <button onclick="deleteParticipante('${p.email}')" class="btn-small btn-danger">Eliminar</button>
      </div>`;
    }

    $("participantesListContainer").innerHTML = out || "<p>Sin participantes</p>";
  } catch (e) {
    alert(`Error: ${e.message}`);
  }
}

async function adminSaveParticipante() {
  const email = $("partEmail").value.trim().toLowerCase();
  const nombre = $("partNombre").value.trim();
  const cargo = $("partCargo").value.trim();
  const selectEl = $("partSesiones");
  const sesiones = Array.from(selectEl.selectedOptions).map(o => o.value);

  if (!email || !nombre) return alert("Falta email o nombre");

  try {
    await sb.rpc("admin_guardar_participante", {
      p_password: adminPassword,
      p_email: email,
      p_nombre: nombre,
      p_cargo: cargo,
      p_sesiones: sesiones
    });
    alert("✓ Participante guardado");
    $("partEmail").value = "";
    $("partNombre").value = "";
    $("partCargo").value = "";
    selectEl.selectedIndex = -1;
    await loadAndRenderParticipantes();
  } catch (e) {
    alert(`Error: ${e.message}`);
  }
}

async function adminBatchImportParticipantes() {
  const text = $("batchImportText").value.trim();
  if (!text) return alert("Pega datos en el cuadro de importación");

  const lineas = text.split("\n").map(l => l.trim()).filter(l => l);
  let count = 0;

  for (const linea of lineas) {
    const partes = linea.split(",").map(p => p.trim());
    if (partes.length < 3) continue;

    try {
      await sb.rpc("admin_guardar_participante", {
        p_password: adminPassword,
        p_email: partes[0].toLowerCase(),
        p_nombre: partes[1],
        p_cargo: partes[2],
        p_sesiones: [] // Sin sesiones asignadas en batch
      });
      count++;
    } catch (e) {
      console.error(`Error en "${linea}":`, e);
    }
  }

  alert(`✓ Importados ${count} participantes`);
  $("batchImportText").value = "";
  await loadAndRenderParticipantes();
}

async function deleteParticipante(email) {
  if (!confirm(`¿Eliminar a ${email}?`)) return;

  try {
    await sb.rpc("admin_eliminar_participante", { p_password: adminPassword, p_email: email });
    await loadAndRenderParticipantes();
  } catch (e) {
    alert(`Error: ${e.message}`);
  }
}

/* --------- Material Management --------- */

function renderMaterialesEditor() {
  let out = `<h2>Agregar material</h2>
    <div class="form-group">
      <label>Sesión:</label>
      <select id="matSesion">
        <option value="">-- General (sin sesión) --</option>`;

  for (const s of sesionesCache) {
    out += `<option value="${s.id}">${esc(s.nombre)}</option>`;
  }

  out += `</select>
    </div>
    <div class="form-group">
      <label>Título:</label>
      <input type="text" id="matTitulo" placeholder="Ej: Lectura 1">
    </div>
    <div class="form-group">
      <label>Descripción:</label>
      <textarea id="matDescripcion" placeholder="Breve descripción"></textarea>
    </div>
    <div class="form-group">
      <label>¿Tipo de contenido?</label>
      <div>
        <label><input type="radio" name="matTipo" value="archivo" checked> 📥 Subir archivo</label>
        <label><input type="radio" name="matTipo" value="link"> 🔗 Link externo</label>
      </div>
    </div>
    <div class="form-group" id="matArchivoGroup">
      <label>Archivo:</label>
      <input type="file" id="matArchivo">
    </div>
    <div class="form-group" id="matLinkGroup" style="display:none;">
      <label>URL:</label>
      <input type="url" id="matLink" placeholder="https://...">
    </div>
    <div class="form-group">
      <label>Cargos que pueden verlo (vacío = todos):</label>
      <input type="text" id="matCargos" placeholder="director, docente (separados por coma)">
    </div>
    <button id="btnSaveMat" class="btn-primary">Guardar material</button>

    <hr>
    <h2>Material existente</h2>
    <div id="materialListContainer"></div>`;

  $("matContent").innerHTML = out;

  // Toggle file/link inputs
  document.querySelectorAll("input[name='matTipo']").forEach(r => {
    r.onchange = () => {
      const isArchivo = r.value === "archivo";
      $("matArchivoGroup").style.display = isArchivo ? "block" : "none";
      $("matLinkGroup").style.display = isArchivo ? "none" : "block";
    };
  });

  $("btnSaveMat").onclick = adminSaveMaterial;

  loadAndRenderMateriales();
}

async function loadAndRenderMateriales() {
  let out = "";
  const materiales = materialCache || [];

  for (const m of materiales) {
    const sesion = sesionesCache.find(s => s.id === m.sesion_id);
    const folder = sesion ? sesion.nombre : "General";
    const cargosStr = m.cargos?.length > 0 ? m.cargos.join(", ") : "Todos";

    let contenido = "";
    if (m.archivo_path) {
      const url = fileUrl(m.archivo_path);
      contenido = `<a href="${esc(url)}" target="_blank" class="btn-link">Ver archivo</a>`;
    } else if (m.link_externo) {
      contenido = `<a href="${esc(m.link_externo)}" target="_blank" class="btn-link">Ver link</a>`;
    }

    out += `<div class="material-item">
      <h4>${esc(m.titulo)}</h4>
      <p><strong>Sesión:</strong> ${esc(folder)}</p>
      <p><small>${esc(m.descripcion)}</small></p>
      <p><small>Visible para: ${cargosStr}</small></p>
      ${contenido}
      <button onclick="deleteMaterial('${m.id}')" class="btn-small btn-danger">Eliminar</button>
    </div>`;
  }

  $("materialListContainer").innerHTML = out || "<p>Sin material</p>";
}

async function adminSaveMaterial() {
  const sesionId = $("matSesion").value || null;
  const titulo = $("matTitulo").value.trim();
  const descripcion = $("matDescripcion").value.trim();
  const tipo = document.querySelector("input[name='matTipo']:checked").value;
  const cargosText = $("matCargos").value.trim();
  const cargos = cargosText ? cargosText.split(",").map(c => c.trim()) : [];

  if (!titulo) return alert("Ingresa título");

  let archivoPath = null;
  let linkExterno = null;

  if (tipo === "archivo") {
    const file = $("matArchivo").files[0];
    if (!file) return alert("Selecciona un archivo");

    // Subir a storage
    const path = `${Date.now()}-${file.name}`;
    try {
      await sb.storage.from("materiales").upload(path, file);
      archivoPath = path;
    } catch (e) {
      return alert(`Error subiendo archivo: ${e.message}`);
    }
  } else {
    linkExterno = $("matLink").value.trim();
    if (!linkExterno) return alert("Ingresa una URL");
  }

  try {
    await sb.rpc("admin_agregar_material", {
      p_password: adminPassword,
      p_sesion_id: sesionId,
      p_titulo: titulo,
      p_descripcion: descripcion,
      p_archivo_path: archivoPath,
      p_link_externo: linkExterno,
      p_cargos: cargos
    });
    alert("✓ Material guardado");
    $("matTitulo").value = "";
    $("matDescripcion").value = "";
    $("matArchivo").value = "";
    $("matLink").value = "";
    $("matCargos").value = "";
    await loadAdminData();
    loadAndRenderMateriales();
  } catch (e) {
    alert(`Error: ${e.message}`);
  }
}

async function deleteMaterial(id) {
  if (!confirm("¿Eliminar este material?")) return;

  try {
    await sb.rpc("admin_eliminar_material", { p_password: adminPassword, p_id: id });
    await loadAdminData();
    loadAndRenderMateriales();
  } catch (e) {
    alert(`Error: ${e.message}`);
  }
}

/* --------- Task Management --------- */

function renderTareasEditor() {
  let out = `<h2>Crear tarea</h2>
    <div class="form-group">
      <label>Sesión:</label>
      <select id="tarSesion">
        <option value="">-- General (sin sesión) --</option>`;

  for (const s of sesionesCache) {
    out += `<option value="${s.id}">${esc(s.nombre)}</option>`;
  }

  out += `</select>
    </div>
    <div class="form-group">
      <label>Título:</label>
      <input type="text" id="tarTitulo" placeholder="Ej: Trabajo práctico 1">
    </div>
    <div class="form-group">
      <label>Descripción:</label>
      <textarea id="tarDescripcion" placeholder="Instrucciones"></textarea>
    </div>
    <div class="form-group">
      <label>Archivo adjunto (opcional):</label>
      <input type="file" id="tarArchivo">
    </div>
    <div class="form-group">
      <label>Cargos que pueden verla (vacío = todos):</label>
      <input type="text" id="tarCargos" placeholder="director, docente (separados por coma)">
    </div>
    <hr>
    <h3>Preguntas</h3>
    <div id="questionsBuilder"></div>
    <button id="btnAddQuestion" class="btn-secondary">+ Agregar pregunta</button>
    <button id="btnSaveTar" class="btn-primary">Guardar tarea</button>

    <hr>
    <h2>Tareas existentes</h2>
    <div id="tareasListContainer"></div>`;

  $("tarContent").innerHTML = out;

  questionRows = [];
  renderQuestionsBuilder();

  $("btnAddQuestion").onclick = () => { addQuestionRow(); renderQuestionsBuilder(); };
  $("btnSaveTar").onclick = adminSaveTarea;

  loadAndRenderTareas();
}

function renderQuestionsBuilder() {
  let out = "";
  questionRows.forEach((q, i) => {
    out += `<div class="question-input">
      <input type="text" value="${esc(q)}" onchange="questionRows[${i}] = this.value" placeholder="Pregunta ${i + 1}">
      <button type="button" onclick="questionRows.splice(${i}, 1); renderQuestionsBuilder();" class="btn-small btn-danger">Quitar</button>
    </div>`;
  });
  $("questionsBuilder").innerHTML = out;
}

function addQuestionRow() {
  questionRows.push("");
}

async function adminSaveTarea() {
  const sesionId = $("tarSesion").value || null;
  const titulo = $("tarTitulo").value.trim();
  const descripcion = $("tarDescripcion").value.trim();
  const cargosText = $("tarCargos").value.trim();
  const cargos = cargosText ? cargosText.split(",").map(c => c.trim()) : [];

  if (!titulo) return alert("Ingresa título de la tarea");

  // Procesar preguntas
  const preguntas = questionRows
    .filter(q => q.trim())
    .map(q => ({ id: Math.random().toString(36).substr(2, 9), texto: q }));

  let archivoPath = null;
  const file = $("tarArchivo").files[0];
  if (file) {
    const path = `${Date.now()}-${file.name}`;
    try {
      await sb.storage.from("materiales").upload(path, file);
      archivoPath = path;
    } catch (e) {
      return alert(`Error: ${e.message}`);
    }
  }

  try {
    await sb.rpc("admin_agregar_tarea", {
      p_password: adminPassword,
      p_sesion_id: sesionId,
      p_titulo: titulo,
      p_descripcion: descripcion,
      p_archivo_path: archivoPath,
      p_cargos: cargos,
      p_preguntas: preguntas
    });
    alert("✓ Tarea guardada");
    $("tarTitulo").value = "";
    $("tarDescripcion").value = "";
    $("tarArchivo").value = "";
    $("tarCargos").value = "";
    questionRows = [];
    await loadAdminData();
    renderTareasEditor();
  } catch (e) {
    alert(`Error: ${e.message}`);
  }
}

async function loadAndRenderTareas() {
  let out = "";
  const tareas = tareasCache || [];

  for (const t of tareas) {
    const sesion = sesionesCache.find(s => s.id === t.sesion_id);
    const folder = sesion ? sesion.nombre : "General";
    const cargosStr = t.cargos?.length > 0 ? t.cargos.join(", ") : "Todos";

    out += `<div class="tarea-item">
      <h4>${esc(t.titulo)}</h4>
      <p><strong>Sesión:</strong> ${esc(folder)}</p>
      <p><small>${esc(t.descripcion)}</small></p>
      <p><small>Visible para: ${cargosStr}</small></p>
      <p><small>Preguntas: ${(t.preguntas || []).length}</small></p>
      <button onclick="deleteTarea('${t.id}')" class="btn-small btn-danger">Eliminar</button>
    </div>`;
  }

  $("tareasListContainer").innerHTML = out || "<p>Sin tareas</p>";
}

async function deleteTarea(id) {
  if (!confirm("¿Eliminar esta tarea?")) return;

  try {
    await sb.rpc("admin_eliminar_tarea", { p_password: adminPassword, p_id: id });
    await loadAdminData();
    loadAndRenderTareas();
  } catch (e) {
    alert(`Error: ${e.message}`);
  }
}

/* --------- Responses --------- */

async function loadAdminRespuestas() {
  const filtroTarea = $("respFiltroTarea").value;

  try {
    const { data } = await sb.rpc("admin_listar_respuestas", {
      p_password: adminPassword,
      p_tarea_id: filtroTarea || null
    });

    let out = "<h2>Respuestas de participantes</h2>";

    if (!data || data.length === 0) {
      out += "<p>Sin respuestas</p>";
    } else {
      for (const r of data) {
        out += `<div class="respuesta-item">
          <strong>${esc(r.tarea_titulo)}</strong>
          <p><em>${esc(r.nombre)} (${esc(r.email)})</em> - ${fmtFecha(r.submitted_at)}</p>
          <div class="respuesta-contenido">`;

        for (const [pregId, resp] of Object.entries(r.respuestas || {})) {
          out += `<p><strong>→</strong> ${esc(String(resp))}</p>`;
        }

        out += `</div></div>`;
      }
    }

    $("respContent").innerHTML = out;
  } catch (e) {
    alert(`Error: ${e.message}`);
  }
}

/* --------- Password --------- */

async function adminChangePassword() {
  const actual = prompt("Clave actual:");
  if (!actual) return;

  const nueva = prompt("Nueva clave:");
  if (!nueva) return;

  const repetida = prompt("Repite la nueva clave:");
  if (nueva !== repetida) return alert("Las claves no coinciden");

  try {
    const { data } = await sb.rpc("admin_cambiar_password", {
      p_password_actual: actual,
      p_password_nueva: nueva
    });

    if (!data) return alert("Clave actual incorrecta");
    alert("✓ Clave cambiada");
  } catch (e) {
    alert(`Error: ${e.message}`);
  }
}

/* ===== Inicializar ===== */
window.addEventListener("load", init);
