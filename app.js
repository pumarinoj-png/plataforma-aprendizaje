/* ==========================================================
   Portal de Material y Tareas — lógica de la aplicación
   ========================================================== */

let sb = null;
let SUPABASE_URL = "";
let currentParticipant = null;   // { email, nombre, categorias }
let adminPassword = null;        // se guarda solo en memoria de esta pestaña
let tareasCache = [];            // última lista de tareas del admin (para mapear preguntas -> texto)
let questionRows = [];           // preguntas que se están armando al crear una tarea

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

function parseCategorias(text) {
  return (text || "")
    .split(",")
    .map(s => s.trim())
    .filter(s => s.length > 0);
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
    $(s).classList.toggle("hidden", s !== id);
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
  $("btnGoParticipant").onclick = () => showScreen("screen-participant-login");
  $("btnGoAdmin").onclick = () => showScreen("screen-admin-login");
  $("btnBackHome1").onclick = () => showScreen("screen-home");
  $("btnBackHome2").onclick = () => showScreen("screen-home");
  $("btnLogout").onclick = doLogout;

  $("btnParticipantEnter").onclick = participantLogin;
  $("pEmailInput").addEventListener("keydown", e => { if (e.key === "Enter") participantLogin(); });

  $("btnAdminEnter").onclick = adminLogin;
  $("adminPasswordInput").addEventListener("keydown", e => { if (e.key === "Enter") adminLogin(); });

  $("tabMaterialesBtn").onclick = () => switchParticipantTab("mat");
  $("tabTareasBtn").onclick = () => switchParticipantTab("tar");

  $("tabPartBtn").onclick = () => switchAdminTab("part");
  $("tabMatBtn").onclick = () => switchAdminTab("mat");
  $("tabTarBtn").onclick = () => switchAdminTab("tar");
  $("tabRespBtn").onclick = () => switchAdminTab("resp");
  $("tabPassBtn").onclick = () => switchAdminTab("pass");

  $("btnSavePart").onclick = adminSaveParticipante;
  $("btnSaveMat").onclick = adminSaveMaterial;
  $("btnSaveTar").onclick = adminSaveTarea;
  $("btnAddQuestion").onclick = () => { addQuestionRow(); renderQuestionsBuilder(); };
  $("btnChangePass").onclick = adminChangePassword;
  $("respFiltroTarea").onchange = () => loadAdminRespuestas();
}

function doLogout() {
  currentParticipant = null;
  adminPassword = null;
  setWho("", false);
  showScreen("screen-home");
}

/* ==========================================================
   PARTICIPANTE
   ========================================================== */

async function participantLogin() {
  const email = $("pEmailInput").value.trim();
  $("pLoginMsg").textContent = "";
  if (!email) { $("pLoginMsg").textContent = "Ingresa tu correo."; return; }

  const { data, error } = await sb.rpc("buscar_participante", { p_email: email });
  if (error) { $("pLoginMsg").textContent = "Ocurrió un error. Intenta de nuevo."; return; }
  if (!data || data.length === 0) {
    $("pLoginMsg").textContent = "No encontramos ese correo. Contacta al administrador.";
    return;
  }

  currentParticipant = { email, nombre: data[0].nombre, categorias: data[0].categorias || [] };
  setWho(`${currentParticipant.nombre} (participante)`, true);
  $("pWelcome").textContent = `Hola, ${currentParticipant.nombre}`;
  $("pCategorias").innerHTML = currentParticipant.categorias
    .map(c => `<span class="tag">${esc(c)}</span>`).join("");

  showScreen("screen-participant");
  switchParticipantTab("mat");
  await Promise.all([loadMaterialesParticipante(), loadTareasParticipante()]);
}

function switchParticipantTab(tab) {
  $("tabMaterialesBtn").classList.toggle("active", tab === "mat");
  $("tabTareasBtn").classList.toggle("active", tab === "tar");
  $("panelMateriales").classList.toggle("hidden", tab !== "mat");
  $("panelTareas").classList.toggle("hidden", tab !== "tar");
}

async function loadMaterialesParticipante() {
  const { data, error } = await sb.rpc("materiales_para", { p_email: currentParticipant.email });
  const wrap = $("materialesList");
  wrap.innerHTML = "";
  if (error || !data) { $("materialesEmpty").style.display = "block"; return; }
  $("materialesEmpty").style.display = data.length === 0 ? "block" : "none";

  data.forEach(m => {
    const div = document.createElement("div");
    div.className = "card";
    const url = fileUrl(m.archivo_path);
    div.innerHTML = `
      <div class="item-header">
        <h3>${esc(m.titulo)}</h3>
        <span class="muted">${fmtFecha(m.created_at)}</span>
      </div>
      <p class="desc">${esc(m.descripcion)}</p>
      ${(m.categorias || []).map(c => `<span class="tag">${esc(c)}</span>`).join("")}
      ${url ? `<div><a class="file-link" href="${url}" target="_blank" rel="noopener">⬇ Descargar archivo</a></div>` : ""}
    `;
    wrap.appendChild(div);
  });
}

async function loadTareasParticipante() {
  const { data, error } = await sb.rpc("tareas_para", { p_email: currentParticipant.email });
  const wrap = $("tareasList");
  wrap.innerHTML = "";
  if (error || !data) { $("tareasEmpty").style.display = "block"; return; }
  $("tareasEmpty").style.display = data.length === 0 ? "block" : "none";

  data.forEach(t => {
    const div = document.createElement("div");
    div.className = "card";
    const url = fileUrl(t.archivo_path);
    const preguntas = t.preguntas || [];
    const misRespuestas = t.mis_respuestas || {};
    const done = !!t.respondido_en;

    const preguntasHtml = preguntas.map(p => `
      <label>${esc(p.texto)}</label>
      <textarea data-qid="${esc(p.id)}">${esc(misRespuestas[p.id] || "")}</textarea>
    `).join("");

    div.innerHTML = `
      <div class="item-header">
        <h3>${esc(t.titulo)}</h3>
        <span class="${done ? "pill-done" : "pill-pending"}">${done ? "Respondida" : "Pendiente"}</span>
      </div>
      <p class="desc">${esc(t.descripcion)}</p>
      ${(t.categorias || []).map(c => `<span class="tag">${esc(c)}</span>`).join("")}
      ${url ? `<div><a class="file-link" href="${url}" target="_blank" rel="noopener">⬇ Descargar archivo</a></div>` : ""}
      <hr class="divider">
      <form class="task-form">
        ${preguntasHtml || '<p class="muted">Esta tarea no tiene preguntas, solo descarga el material.</p>'}
        ${preguntas.length ? '<button type="submit">Guardar respuestas</button>' : ""}
        <span class="ok-msg task-ok"></span>
        ${done ? `<div class="muted" style="margin-top:6px;">Última respuesta: ${fmtFecha(t.respondido_en)}</div>` : ""}
      </form>
    `;

    const form = div.querySelector(".task-form");
    if (preguntas.length) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const answers = {};
        form.querySelectorAll("textarea[data-qid]").forEach(ta => {
          answers[ta.dataset.qid] = ta.value;
        });
        const { error } = await sb.rpc("enviar_respuesta_tarea", {
          p_tarea_id: t.id,
          p_email: currentParticipant.email,
          p_nombre: currentParticipant.nombre,
          p_respuestas: answers
        });
        const msg = form.querySelector(".task-ok");
        msg.textContent = error ? "No se pudo guardar. Intenta de nuevo." : "¡Respuestas guardadas!";
        if (!error) setTimeout(() => loadTareasParticipante(), 800);
      });
    }
    wrap.appendChild(div);
  });
}

/* ==========================================================
   ADMIN
   ========================================================== */

async function adminLogin() {
  const pass = $("adminPasswordInput").value;
  $("aLoginMsg").textContent = "";
  if (!pass) return;
  const { data, error } = await sb.rpc("admin_verificar", { p_password: pass });
  if (error || !data) { $("aLoginMsg").textContent = "Clave incorrecta."; return; }

  adminPassword = pass;
  $("adminPasswordInput").value = "";
  setWho("Administrador", true);
  showScreen("screen-admin");
  switchAdminTab("part");
  await refreshCategoriasSugeridas();
  await Promise.all([loadAdminParticipantes(), loadAdminMateriales(), loadAdminTareasList()]);
}

function switchAdminTab(tab) {
  const map = { part: "adminPanelPart", mat: "adminPanelMat", tar: "adminPanelTar", resp: "adminPanelResp", pass: "adminPanelPass" };
  Object.entries(map).forEach(([k, id]) => $(id).classList.toggle("hidden", k !== tab));
  $("tabPartBtn").classList.toggle("active", tab === "part");
  $("tabMatBtn").classList.toggle("active", tab === "mat");
  $("tabTarBtn").classList.toggle("active", tab === "tar");
  $("tabRespBtn").classList.toggle("active", tab === "resp");
  $("tabPassBtn").classList.toggle("active", tab === "pass");
  if (tab === "resp") loadAdminRespuestas();
}

async function refreshCategoriasSugeridas() {
  const { data, error } = await sb.rpc("admin_listar_categorias", { p_password: adminPassword });
  if (error) return;
  $("categoriasSugeridas").innerHTML = (data || []).map(c => `<option value="${esc(c)}">`).join("");
}

/* ---- Participantes ---- */

async function loadAdminParticipantes() {
  const { data, error } = await sb.rpc("admin_listar_participantes", { p_password: adminPassword });
  const wrap = $("partTableWrap");
  if (error) { wrap.innerHTML = `<p class="error-msg">Error al cargar.</p>`; return; }
  if (!data || data.length === 0) { wrap.innerHTML = `<p class="muted">Sin participantes aún.</p>`; return; }

  let html = `<table><tr><th>Nombre</th><th>Correo</th><th>Categorías</th><th></th></tr>`;
  data.forEach(p => {
    html += `<tr>
      <td>${esc(p.nombre)}</td>
      <td>${esc(p.email)}</td>
      <td>${(p.categorias || []).map(c => `<span class="tag">${esc(c)}</span>`).join("")}</td>
      <td>
        <button class="secondary small" onclick="editParticipante('${esc(p.email)}','${esc(p.nombre)}','${esc((p.categorias||[]).join(","))}')">Editar</button>
        <button class="danger small" onclick="deleteParticipante('${esc(p.email)}')">Eliminar</button>
      </td>
    </tr>`;
  });
  html += `</table>`;
  wrap.innerHTML = html;
}

function editParticipante(email, nombre, categorias) {
  $("newPartEmail").value = email;
  $("newPartNombre").value = nombre;
  $("newPartCategorias").value = categorias;
  window.scrollTo(0, 0);
}

async function adminSaveParticipante() {
  const email = $("newPartEmail").value.trim();
  const nombre = $("newPartNombre").value.trim();
  const categorias = parseCategorias($("newPartCategorias").value);
  const msg = $("partMsg");
  msg.className = "";
  if (!email || !nombre) { msg.className = "error-msg"; msg.textContent = "Correo y nombre son obligatorios."; return; }

  const { error } = await sb.rpc("admin_guardar_participante", {
    p_password: adminPassword, p_email: email, p_nombre: nombre, p_categorias: categorias
  });
  msg.className = error ? "error-msg" : "ok-msg";
  msg.textContent = error ? "No se pudo guardar." : "Guardado.";
  if (!error) {
    $("newPartEmail").value = ""; $("newPartNombre").value = ""; $("newPartCategorias").value = "";
    loadAdminParticipantes();
    refreshCategoriasSugeridas();
  }
}

async function deleteParticipante(email) {
  if (!confirm(`¿Eliminar a ${email}?`)) return;
  await sb.rpc("admin_eliminar_participante", { p_password: adminPassword, p_email: email });
  loadAdminParticipantes();
}

/* ---- Material ---- */

async function loadAdminMateriales() {
  const { data, error } = await sb.rpc("admin_listar_materiales", { p_password: adminPassword });
  const wrap = $("matListWrap");
  if (error) { wrap.innerHTML = `<p class="error-msg">Error al cargar.</p>`; return; }
  if (!data || data.length === 0) { wrap.innerHTML = `<p class="muted">Sin material aún.</p>`; return; }

  wrap.innerHTML = data.map(m => {
    const url = fileUrl(m.archivo_path);
    return `<div class="card">
      <div class="item-header">
        <h3>${esc(m.titulo)}</h3>
        <button class="danger small" onclick="deleteMaterial('${m.id}')">Eliminar</button>
      </div>
      <p class="desc">${esc(m.descripcion)}</p>
      ${(m.categorias || []).map(c => `<span class="tag">${esc(c)}</span>`).join("") || '<span class="muted">Visible para todos</span>'}
      ${url ? `<div><a class="file-link" href="${url}" target="_blank" rel="noopener">⬇ Ver archivo</a></div>` : ""}
    </div>`;
  }).join("");
}

async function adminSaveMaterial() {
  const titulo = $("newMatTitulo").value.trim();
  const descripcion = $("newMatDesc").value.trim();
  const categorias = parseCategorias($("newMatCategorias").value);
  const file = $("newMatArchivo").files[0];
  const msg = $("matMsg");
  msg.className = "";
  if (!titulo) { msg.className = "error-msg"; msg.textContent = "El título es obligatorio."; return; }

  msg.textContent = "Subiendo...";
  let archivoPath = null;
  if (file) {
    archivoPath = await uploadFile(file);
    if (!archivoPath) { msg.className = "error-msg"; msg.textContent = "No se pudo subir el archivo."; return; }
  }

  const { error } = await sb.rpc("admin_agregar_material", {
    p_password: adminPassword, p_titulo: titulo, p_descripcion: descripcion,
    p_archivo_path: archivoPath, p_categorias: categorias
  });
  msg.className = error ? "error-msg" : "ok-msg";
  msg.textContent = error ? "No se pudo guardar." : "Material publicado.";
  if (!error) {
    $("newMatTitulo").value = ""; $("newMatDesc").value = ""; $("newMatCategorias").value = ""; $("newMatArchivo").value = "";
    loadAdminMateriales();
    refreshCategoriasSugeridas();
  }
}

async function deleteMaterial(id) {
  if (!confirm("¿Eliminar este material?")) return;
  await sb.rpc("admin_eliminar_material", { p_password: adminPassword, p_id: id });
  loadAdminMateriales();
}

async function uploadFile(file) {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safeName}`;
  const { error } = await sb.storage.from("materiales").upload(path, file);
  if (error) { console.error(error); return null; }
  return path;
}

/* ---- Tareas ---- */

function addQuestionRow() {
  questionRows.push({ id: crypto.randomUUID(), texto: "" });
}

function renderQuestionsBuilder() {
  const wrap = $("questionsBuilder");
  wrap.innerHTML = questionRows.map((q, i) => `
    <div class="question-row">
      <input type="text" placeholder="Pregunta ${i + 1}" value="${esc(q.texto)}" data-idx="${i}">
      <button type="button" class="danger small" data-remove="${i}">✕</button>
    </div>
  `).join("");
  wrap.querySelectorAll("input[data-idx]").forEach(inp => {
    inp.addEventListener("input", () => { questionRows[+inp.dataset.idx].texto = inp.value; });
  });
  wrap.querySelectorAll("button[data-remove]").forEach(btn => {
    btn.addEventListener("click", () => {
      questionRows.splice(+btn.dataset.remove, 1);
      renderQuestionsBuilder();
    });
  });
}

async function loadAdminTareasList() {
  const { data, error } = await sb.rpc("admin_listar_tareas", { p_password: adminPassword });
  const wrap = $("tarListWrap");
  const select = $("respFiltroTarea");
  if (error || !data) { wrap.innerHTML = `<p class="error-msg">Error al cargar.</p>`; return; }
  tareasCache = data;

  select.innerHTML = `<option value="">Todas las tareas</option>` +
    data.map(t => `<option value="${t.id}">${esc(t.titulo)}</option>`).join("");

  if (data.length === 0) { wrap.innerHTML = `<p class="muted">Sin tareas aún.</p>`; return; }

  wrap.innerHTML = data.map(t => {
    const url = fileUrl(t.archivo_path);
    return `<div class="card">
      <div class="item-header">
        <h3>${esc(t.titulo)}</h3>
        <button class="danger small" onclick="deleteTarea('${t.id}')">Eliminar</button>
      </div>
      <p class="desc">${esc(t.descripcion)}</p>
      ${(t.categorias || []).map(c => `<span class="tag">${esc(c)}</span>`).join("") || '<span class="muted">Visible para todos</span>'}
      ${url ? `<div><a class="file-link" href="${url}" target="_blank" rel="noopener">⬇ Ver archivo</a></div>` : ""}
      <div class="muted" style="margin-top:8px;">Preguntas: ${(t.preguntas || []).map(p => esc(p.texto)).join(" · ") || "(ninguna)"}</div>
    </div>`;
  }).join("");
}

async function adminSaveTarea() {
  const titulo = $("newTarTitulo").value.trim();
  const descripcion = $("newTarDesc").value.trim();
  const categorias = parseCategorias($("newTarCategorias").value);
  const file = $("newTarArchivo").files[0];
  const preguntas = questionRows.filter(q => q.texto.trim().length > 0);
  const msg = $("tarMsg");
  msg.className = "";
  if (!titulo) { msg.className = "error-msg"; msg.textContent = "El título es obligatorio."; return; }

  msg.textContent = "Guardando...";
  let archivoPath = null;
  if (file) {
    archivoPath = await uploadFile(file);
    if (!archivoPath) { msg.className = "error-msg"; msg.textContent = "No se pudo subir el archivo."; return; }
  }

  const { error } = await sb.rpc("admin_agregar_tarea", {
    p_password: adminPassword, p_titulo: titulo, p_descripcion: descripcion,
    p_archivo_path: archivoPath, p_categorias: categorias, p_preguntas: preguntas
  });
  msg.className = error ? "error-msg" : "ok-msg";
  msg.textContent = error ? "No se pudo guardar." : "Tarea creada.";
  if (!error) {
    $("newTarTitulo").value = ""; $("newTarDesc").value = ""; $("newTarCategorias").value = ""; $("newTarArchivo").value = "";
    questionRows = [];
    renderQuestionsBuilder();
    loadAdminTareasList();
    refreshCategoriasSugeridas();
  }
}

async function deleteTarea(id) {
  if (!confirm("¿Eliminar esta tarea? También se borrarán sus respuestas.")) return;
  await sb.rpc("admin_eliminar_tarea", { p_password: adminPassword, p_id: id });
  loadAdminTareasList();
}

/* ---- Respuestas ---- */

async function loadAdminRespuestas() {
  const tareaId = $("respFiltroTarea").value || null;
  const { data, error } = await sb.rpc("admin_listar_respuestas", { p_password: adminPassword, p_tarea_id: tareaId });
  const wrap = $("respTableWrap");
  if (error) { wrap.innerHTML = `<p class="error-msg">Error al cargar.</p>`; return; }
  if (!data || data.length === 0) { wrap.innerHTML = `<p class="muted">Sin respuestas aún.</p>`; return; }

  wrap.innerHTML = data.map(r => {
    const tarea = tareasCache.find(t => t.id === r.tarea_id);
    const preguntas = tarea ? tarea.preguntas : [];
    const detalle = preguntas.length
      ? preguntas.map(p => `<div><strong>${esc(p.texto)}:</strong> ${esc((r.respuestas || {})[p.id] || "(sin respuesta)")}</div>`).join("")
      : `<pre style="white-space:pre-wrap;">${esc(JSON.stringify(r.respuestas))}</pre>`;
    return `<div class="card">
      <div class="item-header">
        <h3>${esc(r.tarea_titulo)}</h3>
        <span class="muted">${fmtFecha(r.submitted_at)}</span>
      </div>
      <div class="muted">${esc(r.nombre)} — ${esc(r.email)}</div>
      <hr class="divider">
      ${detalle}
    </div>`;
  }).join("");
}

/* ---- Cambiar clave ---- */

async function adminChangePassword() {
  const oldPass = $("oldPass").value;
  const newPass = $("newPass").value;
  const msg = $("passMsg");
  msg.className = "";
  if (!oldPass || !newPass) { msg.className = "error-msg"; msg.textContent = "Completa ambos campos."; return; }

  const { data, error } = await sb.rpc("admin_cambiar_password", { p_password_actual: oldPass, p_password_nueva: newPass });
  if (error || !data) { msg.className = "error-msg"; msg.textContent = "Clave actual incorrecta."; return; }

  adminPassword = newPass;
  msg.className = "ok-msg";
  msg.textContent = "Clave actualizada.";
  $("oldPass").value = ""; $("newPass").value = "";
}

/* ---------------------- arranque ---------------------- */

addQuestionRow();
document.addEventListener("DOMContentLoaded", () => {
  renderQuestionsBuilder();
  init();
});
