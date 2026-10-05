'use strict';
/* =========================================================
   Mantenimiento Hada — aplicación principal
   Toda modificación de datos pasa por las funciones RPC de la
   base (0007); el navegador solo LEE tablas.
   ========================================================= */
const sb = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);

/* ---------- Utilidades ---------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ESTADOS = ['Pendiente', 'En Proceso', 'Pendiente de Validación', 'Finalizada', 'Cancelada'];
const CLASE = { 'Pendiente': 'est-pend', 'En Proceso': 'est-proc', 'Pendiente de Validación': 'est-valid', 'Finalizada': 'est-fin', 'Cancelada': 'est-canc' };
// Nombres que ve la gente (en la base los estados no cambian)
const ETIQ = { 'Pendiente': 'Por hacer', 'En Proceso': 'En proceso', 'Pendiente de Validación': 'Por validar', 'Finalizada': 'Terminada', 'Cancelada': 'Cancelada' };
const NOMBRE_PASO = { 'Pendiente': 'Por hacer', 'En Proceso': 'En proceso', 'Pendiente de Validación': 'Por validar', 'Finalizada': 'Terminadas', 'Cancelada': 'Canceladas' };
const ABIERTOS = ['Pendiente', 'En Proceso'];
const ROLES = { administrador: 'Administrador', coordinador_produccion: 'Coordinador de producción', mantenimiento: 'Mantenimiento' };
const ACCIONES = {
  creacion: 'Creó la solicitud', asignacion: 'Asignó responsable', reasignacion: 'Cambió el responsable',
  inicio: 'Inició el trabajo', terminacion: 'Marcó el trabajo como terminado', aprobacion: 'Aprobó el trabajo',
  rechazo: 'Rechazó el trabajo', cancelacion: 'Canceló la solicitud', reapertura: 'Reabrió la solicitud',
  edicion_aviso: 'Editó el aviso',
};
const ERRORES = {
  NO_AUTENTICADO: 'Tu sesión expiró. Vuelve a entrar.',
  NO_AUTORIZADO: 'Tu rol no tiene permiso para hacer esto.',
  NO_ENCONTRADA: 'La solicitud ya no existe.',
  RESPONSABLE_INVALIDO: 'El responsable debe ser un usuario activo de Mantenimiento.',
  ESTADO_NO_PERMITE_ASIGNAR: 'Solo se asigna responsable en solicitudes pendientes o en proceso.',
  SIN_RESPONSABLE: 'Asigna un responsable antes de iniciar.',
  ESTADO_INVALIDO: 'La solicitud cambió de estado mientras la veías. Ya se actualizó: revisa e inténtalo de nuevo.',
  MISMO_USUARIO_NO_PUEDE_VALIDAR: 'Quien terminó el trabajo no puede validarlo. Debe hacerlo otro coordinador o administrador.',
  MOTIVO_OBLIGATORIO: 'Escribe el motivo del rechazo.',
  AVISO_INVALIDO: 'El aviso solo admite letras, números, espacios y guiones (máximo 30).',
  TEXTO_VACIO: 'Escribe el comentario.',
  ROL_INVALIDO: 'Rol no válido.',
  ULTIMO_ADMINISTRADOR: 'Debe quedar al menos un administrador activo.',
  LINEA_NO_PERTENECE_AL_AREA: 'La línea elegida no pertenece a esa área.',
  CORREO_YA_EXISTE: 'Ya existe un usuario con ese correo.',
  DATOS_INVALIDOS: 'Revisa los datos: hay campos vacíos o con formato incorrecto.',
  PASSWORD_CORTA: 'La contraseña debe tener al menos 8 caracteres.',
  FECHA_REQUERIDA_INVALIDA: 'La fecha para la que se necesita no puede ser anterior a hoy.',
};
function msgError(e) {
  const m = (e && (e.message || e.error)) || String(e);
  for (const k in ERRORES) if (m.includes(k)) return ERRORES[k];
  if (/duplicate key|_nombre_idx|_area_id_nombre_key/.test(m)) return 'Ya existe un registro con ese nombre.';
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Sin conexión con el servidor. Revisa tu internet.';
  if (/Invalid login credentials/i.test(m)) return 'Correo o contraseña incorrectos.';
  if (/Password should be/i.test(m)) return ERRORES.PASSWORD_CORTA;
  return m;
}
let toastTimer;
function toast(msg, tipo = '') {
  const t = $('#toast');
  t.textContent = msg; t.className = 'toast ver ' + tipo;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('ver'), tipo === 'error' ? 6000 : 3500);
}
const fFecha = (d) => { if (!d) return '—'; const [y, m, dd] = String(d).slice(0, 10).split('-'); return `${dd}/${m}/${y}`; };
const hoy = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }); // AAAA-MM-DD
const fCorta = (d) => { const [, m, dd] = String(d).slice(0, 10).split('-'); return `${dd}/${m}`; };
// Texto y clase de "para cuándo se necesita"
function vence(s) {
  if (!s.fecha_requerida) return { txt: 'Sin fecha límite', cls: 'v-sin' };
  if (!ABIERTOS.includes(s.estado)) return { txt: 'Para el ' + fFecha(s.fecha_requerida), cls: 'v-sin' };
  const h = hoy();
  const fe = new Date(s.fecha_requerida + 'T00:00:00');
  const ho = new Date(h + 'T00:00:00');
  const dias = Math.floor((fe - ho) / (24 * 3600_000));
  if (dias < 0) return { txt: `🚨 Vencida hace ${-dias} día${-dias===1?'':'s'}`, cls: 'v-vencida' };
  if (dias === 0) return { txt: '⏰ Vence hoy', cls: 'v-hoy' };
  if (dias === 1) return { txt: '⚠️ Mañana vence', cls: 'v-urgente' };
  if (dias <= 3) return { txt: `⚠️ Faltan ${dias} días`, cls: 'v-urgente' };
  return { txt: `Faltan ${dias} días`, cls: 'v-ok' };
}
const fHora = (t) => t ? new Date(t).toLocaleString('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

async function rpc(fn, args = {}) {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw error;
  return data;
}
async function funcion(nombre, body) {
  const { data, error } = await sb.functions.invoke(nombre, { body });
  if (error) {
    let det = error.message;
    try { const j = await error.context.json(); det = j.error || det; } catch (_) { /* sin cuerpo */ }
    throw new Error(det);
  }
  if (data && data.error) throw new Error(data.error);
  return data;
}
async function conBoton(btn, tarea) {
  if (btn) btn.disabled = true;
  try { await tarea(); return true; }
  catch (e) { toast(msgError(e), 'error'); return false; }
  finally { if (btn) btn.disabled = false; }
}

/* ---------- Estado ---------- */
const S = {
  perfil: null, areas: [], lineas: [], perfiles: [], solicitudes: [],
  fil: { estado: '', area: '', texto: '', mias: false },
  abierta: null, canal: null,
};
const area = (id) => S.areas.find((a) => a.id === id);
const linea = (id) => S.lineas.find((l) => l.id === id);
const persona = (id) => S.perfiles.find((p) => p.user_id === id);
const nombreDe = (id) => persona(id)?.nombre_completo ?? '—';
const rol = () => S.perfil?.rol;
const esAdmin = () => rol() === 'administrador';
const esGestor = () => rol() === 'administrador' || rol() === 'coordinador_produccion';
const esMtto = () => rol() === 'mantenimiento';
const yo = () => S.perfil?.user_id;
const tecnicos = () => S.perfiles.filter((p) => p.rol === 'mantenimiento' && p.activo);

function opciones(lista, valor, vacio) {
  return (vacio != null ? `<option value="">${esc(vacio)}</option>` : '') +
    lista.map((o) => `<option value="${esc(o.v)}"${o.v === valor ? ' selected' : ''}>${esc(o.t)}</option>`).join('');
}
const optAreas = (v, vacio) => opciones(S.areas.map((a) => ({ v: a.id, t: a.nombre })), v, vacio);
const optLineas = (areaId, v, vacio = 'Sin línea') =>
  opciones(S.lineas.filter((l) => l.area_id === areaId).map((l) => ({ v: l.id, t: l.nombre })), v, vacio);

/* =========================================================
   Sesión
   ========================================================= */
function mostrarLogin(mensaje) {
  if (S.canal) { sb.removeChannel(S.canal); S.canal = null; }
  S.perfil = null;
  $('#vista-app').hidden = true;
  $('#vista-login').hidden = false;
  const err = $('#login-error');
  err.hidden = !mensaje; err.textContent = mensaje || '';
}

$('#f-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target, btn = f.querySelector('button');
  $('#login-error').hidden = true;
  btn.disabled = true;
  const { data, error } = await sb.auth.signInWithPassword({ email: f.correo.value.trim(), password: f.password.value });
  btn.disabled = false;
  if (error) { mostrarLogin(msgError(error)); return; }
  f.reset();
  await entrar(data.user);
});

async function entrar(user) {
  const { data: perfil, error } = await sb.from('profiles').select('*').eq('user_id', user.id).maybeSingle();
  if (error || !perfil || !perfil.activo) {
    await sb.auth.signOut();
    mostrarLogin('Tu cuenta no tiene acceso a la app. Pide al administrador que la active.');
    return;
  }
  S.perfil = perfil;
  $('#u-nombre').textContent = perfil.nombre_completo;
  $('#u-rol').textContent = ROLES[perfil.rol] || perfil.rol;
  $('#tab-admin').hidden = !esAdmin();
  $('#fil-mias-wrap').hidden = !esMtto();
  $('#vista-login').hidden = true;
  $('#vista-app').hidden = false;
  $('#lista').innerHTML = '<p class="cargando">Cargando solicitudes…</p>';
  try {
    await cargarCatalogos();
    await cargarSolicitudes();
  } catch (e) { toast(msgError(e), 'error'); }
  prepararNueva();
  irA('tablero');
  suscribir();
}

$('#btn-salir').addEventListener('click', () => sb.auth.signOut());
$('#btn-pass').addEventListener('click', async () => {
  const nueva = await preguntar({ titulo: 'Cambiar contraseña', texto: 'Mínimo 8 caracteres.', campo: { label: 'Contraseña nueva', tipo: 'password', min: 8 }, boton: 'Guardar contraseña' });
  if (nueva == null) return;
  const { error } = await sb.auth.updateUser({ password: nueva });
  toast(error ? msgError(error) : 'Contraseña actualizada', error ? 'error' : '');
});

/* =========================================================
   Datos
   ========================================================= */
async function cargarCatalogos() {
  const [a, l, p] = await Promise.all([
    sb.from('areas').select('*').order('nombre'),
    sb.from('lineas').select('*').order('nombre'),
    sb.from('profiles').select('user_id, nombre_completo, correo, rol, activo, area_id, linea_id').order('nombre_completo'),
  ]);
  for (const r of [a, l, p]) if (r.error) throw r.error;
  S.areas = a.data; S.lineas = l.data; S.perfiles = p.data;
  $('#fil-area').innerHTML = optAreas(S.fil.area, 'Todas las áreas');
}
async function cargarSolicitudes() {
  const { data, error } = await sb.from('solicitudes').select('*').order('creado', { ascending: false }).limit(2000);
  if (error) throw error;
  S.solicitudes = data;
  renderTablero();
}

/* Tiempo real: si alguien cambia algo, todos lo ven */
let recargaTimer;
function suscribir() {
  if (S.canal) sb.removeChannel(S.canal);
  S.canal = sb.channel('cambios-mtto')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'solicitudes' }, () => {
      clearTimeout(recargaTimer);
      recargaTimer = setTimeout(async () => {
        try { await cargarSolicitudes(); if (S.abierta) await refrescarDetalle(); } catch (_) { /* reintenta en el próximo cambio */ }
      }, 400);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'comentarios' }, (p) => {
      const sid = (p.new && p.new.solicitud_id) || (p.old && p.old.solicitud_id);
      if (S.abierta && sid === S.abierta) cargarComentarios(S.abierta);
    })
    .subscribe();
}

/* =========================================================
   Navegación
   ========================================================= */
function irA(vista) {
  for (const id of ['tablero', 'nueva', 'admin']) $('#v-' + id).hidden = id !== vista;
  $$('.pestanas button').forEach((b) => {
    if (b.dataset.vista === vista) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  if (vista === 'admin') renderAdmin();
  if (vista === 'nueva') prepararNueva();
}
$$('.pestanas button').forEach((b) => b.addEventListener('click', () => irA(b.dataset.vista)));

/* =========================================================
   Tablero
   ========================================================= */
function filtradas() {
  const t = S.fil.texto.trim().toLowerCase();
  return S.solicitudes.filter((s) => {
    if (S.fil.estado && s.estado !== S.fil.estado) return false;
    if (S.fil.area && s.area_id !== S.fil.area) return false;
    if (S.fil.mias && s.responsable_id !== yo()) return false;
    if (t) {
      const txt = [s.consecutivo, s.actividad, s.aviso, s.solicitante, s.descripcion, linea(s.linea_id)?.nombre, area(s.area_id)?.nombre, nombreDe(s.responsable_id)].join(' ').toLowerCase();
      if (!txt.includes(t)) return false;
    }
    return true;
  }).sort((a, b) => {
    // Primero lo abierto; dentro de lo abierto, lo que vence antes
    const ab = (x) => (ABIERTOS.includes(x.estado) || x.estado === 'Pendiente de Validación') ? 0 : 1;
    if (ab(a) !== ab(b)) return ab(a) - ab(b);
    const fa = a.fecha_requerida || '9999-12-31', fb = b.fecha_requerida || '9999-12-31';
    if (ab(a) === 0 && fa !== fb) return fa < fb ? -1 : 1;
    return String(b.creado).localeCompare(String(a.creado));
  });
}

function renderTablero() {
  // Conteos respetan área, búsqueda y "mías", pero no el estado
  const base = S.solicitudes.filter((s) =>
    (!S.fil.area || s.area_id === S.fil.area) && (!S.fil.mias || s.responsable_id === yo()));
  const cuenta = (e) => base.filter((s) => s.estado === e).length;
  const flujo = $('#flujo');
  flujo.classList.toggle('filtrando', !!S.fil.estado);
  flujo.innerHTML = ESTADOS.map((e) => {
    const n = cuenta(e);
    const hay = e === 'Pendiente de Validación' && n > 0 && esGestor() ? ' hay' : '';
    return `<button type="button" class="paso ${CLASE[e]}${hay}" data-estado="${esc(e)}" aria-pressed="${S.fil.estado === e}">
      <span class="paso-num">${n}</span><span class="paso-txt">${NOMBRE_PASO[e]}</span></button>`;
  }).join('');

  const lista = filtradas();
  const cont = $('#lista');
  if (!lista.length) {
    const hayFiltro = S.fil.estado || S.fil.area || S.fil.texto || S.fil.mias;
    cont.innerHTML = `<div class="vacio"><p>${hayFiltro ? 'Ninguna solicitud coincide con estos filtros.' : 'Todavía no hay solicitudes.'}</p>
      ${hayFiltro ? '<button type="button" class="btn sec" id="btn-limpiar">Quitar filtros</button>' : '<button type="button" class="btn" data-ir="nueva">Crear la primera solicitud</button>'}</div>`;
    return;
  }
  cont.innerHTML = lista.map((s) => {
    const ar = area(s.area_id)?.nombre ?? '';
    const li = linea(s.linea_id)?.nombre || s.linea_legacy || ar || 'Sin línea';
    const resp = s.responsable_id ? esc(nombreDe(s.responsable_id))
      : (ABIERTOS.includes(s.estado) ? '<span class="sin-asignar">Sin responsable</span>' : '—');
    const v = vence(s);
    const prio = s.prioridad || 'Media';
    return `<button type="button" class="fila ${CLASE[s.estado]}" data-id="${s.id}">
      <span class="fila-linea"><span class="linea-nom">${esc(li)}</span>${ar && ar !== li ? `<span class="linea-area">${esc(ar)}</span>` : ''}</span>
      <span class="fila-cuerpo"><span class="fila-act">${esc(s.actividad)}</span>
        <span class="fila-meta"><span class="prio prio-${esc(prio)}">Prioridad ${esc(prio.toLowerCase())}</span> <span class="fila-resp">${resp}</span></span></span>
      <span class="pill ${CLASE[s.estado]}">${esc(ETIQ[s.estado])}</span>
      <span class="vence ${v.cls}">${esc(v.txt)}</span>
    </button>`;
  }).join('');
}

$('#flujo').addEventListener('click', (e) => {
  const b = e.target.closest('.paso'); if (!b) return;
  S.fil.estado = S.fil.estado === b.dataset.estado ? '' : b.dataset.estado;
  renderTablero();
});
$('#fil-texto').addEventListener('input', (e) => { S.fil.texto = e.target.value; renderTablero(); });
$('#fil-area').addEventListener('change', (e) => { S.fil.area = e.target.value; renderTablero(); });
$('#fil-mias').addEventListener('change', (e) => { S.fil.mias = e.target.checked; renderTablero(); });
$('#lista').addEventListener('click', (e) => {
  if (e.target.closest('#btn-limpiar')) {
    S.fil = { estado: '', area: '', texto: '', mias: false };
    $('#fil-texto').value = ''; $('#fil-area').value = ''; $('#fil-mias').checked = false;
    renderTablero(); return;
  }
  const ir = e.target.closest('[data-ir]'); if (ir) { irA(ir.dataset.ir); return; }
  const f = e.target.closest('.fila'); if (f) abrirDetalle(f.dataset.id);
});

/* =========================================================
   Detalle de una solicitud
   ========================================================= */
const dlg = $('#dlg-detalle');
dlg.addEventListener('close', () => { S.abierta = null; });
dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });

function abrirDetalle(id) {
  const s = S.solicitudes.find((x) => x.id === id); if (!s) return;
  S.abierta = id;
  dlg.innerHTML = `<div id="det-principal"></div>
    <div class="det-cuerpo" style="padding-top:0">
      <section class="det-sec">
        <h3>Comentarios</h3>
        <ul class="coms" id="det-coms"><li class="cargando">Cargando…</li></ul>
        <form class="f-com" id="f-com">
          <label style="flex:1">Nuevo comentario<textarea name="texto" rows="2" maxlength="2000" required></textarea></label>
          <button class="btn" type="submit">Comentar</button>
        </form>
      </section>
      <section class="det-sec">
        <h3>Historial</h3>
        <ol class="hist" id="det-hist"><li class="cargando">Cargando…</li></ol>
      </section>
    </div>`;
  renderPrincipal(s);
  if (!dlg.open) dlg.showModal();
  cargarComentarios(id); cargarHistorial(id);
}

async function refrescarDetalle() {
  const s = S.solicitudes.find((x) => x.id === S.abierta);
  if (!s) { dlg.close(); toast('La solicitud fue eliminada.'); return; }
  renderPrincipal(s);
  cargarHistorial(s.id);
}

function dato(t, v) { return `<div><dt>${esc(t)}</dt><dd>${v}</dd></div>`; }

function renderPrincipal(s) {
  const ar = area(s.area_id)?.nombre ?? '—';
  const li = linea(s.linea_id)?.nombre ?? '—';
  const datos = [
    dato('Área', esc(ar)),
    dato('Tipo', esc(s.tipo || '—')), dato('Prioridad', `<span class="prio prio-${esc(s.prioridad || 'Media')}">${esc(s.prioridad || 'Media')}</span>`),
    dato('Solicitante', esc(s.solicitante || '—') + (s.origen === 'invitado' ? ' (reporte de invitado)' : '')),
    dato('Responsable', s.responsable_id ? esc(nombreDe(s.responsable_id)) : (s.responsable_legacy ? esc(s.responsable_legacy) + ' (registro anterior)' : '<span class="sin-asignar">Sin responsable</span>')),
    dato('Aviso SAP', esc(s.aviso || '—')),
    dato('Se necesita para', s.fecha_requerida ? `<span class="vence ${vence(s).cls}">${fFecha(s.fecha_requerida)}</span>` : 'Sin fecha límite'),
    dato('Fecha de solicitud', fFecha(s.fecha_solicitud)),
    esAdmin() ? dato('Referencia', esc(s.consecutivo)) : '',
    s.creado_por ? dato('Creada por', esc(nombreDe(s.creado_por))) : '',
    s.fecha_inicio ? dato('Inicio del trabajo', fFecha(s.fecha_inicio)) : '',
    s.fecha_terminado && ['Pendiente de Validación', 'Finalizada'].includes(s.estado) ? dato('Terminada', fHora(s.fecha_terminado) + '<br>' + esc(nombreDe(s.terminado_por))) : '',
    s.estado === 'Finalizada' && s.fecha_validacion ? dato('Validada', fHora(s.fecha_validacion) + '<br>' + esc(nombreDe(s.validado_por))) : '',
    s.fecha_ejecucion ? dato('Fecha de ejecución', fFecha(s.fecha_ejecucion)) : '',
  ].join('');

  let avisos = '';
  if (s.estado === 'Pendiente de Validación') {
    avisos = `<div class="aviso-caja"><p><strong>Falta la validación.</strong> ${esc(nombreDe(s.terminado_por))} marcó el trabajo como terminado (${fHora(s.fecha_terminado)}). Un coordinador o administrador distinto debe aprobarlo o rechazarlo.</p></div>`;
  } else if (s.estado === 'En Proceso' && s.motivo_rechazo) {
    avisos = `<div class="aviso-caja rojo"><p><strong>Trabajo rechazado</strong> por ${esc(nombreDe(s.validado_por))}: ${esc(s.motivo_rechazo)}</p></div>`;
  }
  if (s.observaciones) avisos += `<div class="aviso-caja" style="border-left-color:var(--borde);background:#F6F8F9"><p><strong>Observaciones:</strong> ${esc(s.observaciones)}</p></div>`;

  $('#det-principal').innerHTML = `
    <div class="det-cab ${CLASE[s.estado]}">
      <div><div class="det-num">${esc(li !== '—' ? li : (s.linea_legacy || ar))}</div><div class="det-est">${esc(ETIQ[s.estado])}</div></div>
      <button type="button" class="cerrar" aria-label="Cerrar" data-acc="cerrar">×</button>
    </div>
    <div class="det-cuerpo">
      <h2 class="det-act">${esc(s.actividad)}</h2>
      ${s.descripcion ? `<p class="det-desc">${esc(s.descripcion)}</p>` : ''}
      ${avisos}
      <dl class="det-datos">${datos}</dl>
      ${renderAcciones(s)}
    </div>`;
}

function renderAcciones(s) {
  const mioResp = s.responsable_id === yo();
  const puedeTrabajar = esAdmin() || (esMtto() && mioResp);
  const partes = [];

  if (esGestor() && ['Pendiente', 'En Proceso'].includes(s.estado)) {
    partes.push(`<div class="grupo"><label>Responsable<select id="sel-resp">${opciones(tecnicos().map((p) => ({ v: p.user_id, t: p.nombre_completo })), s.responsable_id, 'Elegir técnico')}</select></label>
      <button type="button" class="btn sec" data-acc="asignar">${s.responsable_id ? 'Reasignar' : 'Asignar'}</button></div>`);
  }
  if (ABIERTOS.includes(s.estado) && puedeTrabajar && s.responsable_id) partes.push('<button type="button" class="btn ok" data-acc="terminar">Marcar como terminada</button>');
  if (s.estado === 'Pendiente de Validación' && esGestor()) {
    if (s.terminado_por === yo()) partes.push('<p class="nota">Tú marcaste este trabajo como terminado, así que la validación la debe hacer otra persona.</p>');
    else partes.push('<button type="button" class="btn ok" data-acc="aprobar">Aprobar trabajo</button><button type="button" class="btn peligro" data-acc="rechazar">Rechazar trabajo</button>');
  }
  if (esGestor() && ['Pendiente', 'En Proceso'].includes(s.estado)) partes.push('<button type="button" class="btn peligro" data-acc="cancelar">Cancelar solicitud</button>');
  if (esGestor() && ['Finalizada', 'Cancelada'].includes(s.estado)) partes.push('<button type="button" class="btn sec" data-acc="reabrir">Reabrir solicitud</button>');

  if (esGestor() || (esMtto() && mioResp)) {
    partes.push(`<span class="sep"></span><div class="grupo"><label>Aviso SAP<input id="inp-aviso" maxlength="30" value="${esc(s.aviso || '')}"></label>
      <button type="button" class="btn sec chico" data-acc="aviso">Guardar aviso</button></div>`);
  }
  if (esAdmin()) partes.push('<button type="button" class="btn peligro chico" data-acc="eliminar" style="margin-left:auto">Eliminar solicitud</button>');

  if (!partes.length) {
    if (esMtto() && !mioResp) return '<div class="det-acciones"><p class="nota">Esta solicitud no está asignada a ti. Solo puedes comentar.</p></div>';
    return '';
  }
  return `<div class="det-acciones">${partes.join('')}</div>`;
}

dlg.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-acc]'); if (!b) return;
  const s = S.solicitudes.find((x) => x.id === S.abierta); if (!s) return;
  const id = { p_solicitud_id: s.id };
  const acc = b.dataset.acc;
  if (acc === 'cerrar') { dlg.close(); return; }

  const ok = await conBoton(b, async () => {
    switch (acc) {
      case 'asignar': {
        const uid = $('#sel-resp').value;
        if (!uid) { toast('Elige un técnico de la lista.', 'error'); return; }
        await rpc('asignar_responsable', { ...id, p_responsable_id: uid });
        toast('Responsable asignado'); break;
      }
      case 'terminar':
        if (!await preguntar({ titulo: 'Marcar como terminada', texto: 'El trabajo queda pendiente de validación. Un coordinador o administrador lo revisará.', boton: 'Marcar como terminada' })) return;
        await rpc('terminar_tarea', id); toast('Marcada como terminada. Falta la validación.'); break;
      case 'aprobar':
        if (!await preguntar({ titulo: 'Aprobar trabajo', texto: 'La solicitud quedará terminada.', boton: 'Aprobar trabajo' })) return;
        await rpc('aprobar_tarea', id); toast('Trabajo aprobado'); break;
      case 'rechazar': {
        const motivo = await preguntar({ titulo: 'Rechazar trabajo', texto: 'El trabajo vuelve al mismo técnico como "En proceso", con tu motivo.', campo: { label: 'Motivo del rechazo' }, boton: 'Rechazar trabajo', peligro: true });
        if (motivo == null) return;
        await rpc('rechazar_tarea', { ...id, p_motivo: motivo }); toast('Trabajo rechazado'); break;
      }
      case 'cancelar':
        if (!await preguntar({ titulo: 'Cancelar solicitud', texto: 'La solicitud quedará cancelada. Se puede reabrir después.', boton: 'Cancelar solicitud', peligro: true })) return;
        await rpc('cancelar_tarea', id); toast('Solicitud cancelada'); break;
      case 'reabrir':
        if (!await preguntar({ titulo: 'Reabrir solicitud', texto: s.estado === 'Finalizada' ? 'Vuelve a "En proceso" y se borran los datos de terminación y validación.' : 'Vuelve a "Pendiente".', boton: 'Reabrir solicitud' })) return;
        await rpc('reabrir_tarea', id); toast('Solicitud reabierta'); break;
      case 'aviso': {
        const v = $('#inp-aviso').value.trim();
        if (v && !/^[A-Za-z0-9][A-Za-z0-9 \-]{0,29}$/.test(v)) { toast(ERRORES.AVISO_INVALIDO, 'error'); return; }
        await rpc('editar_aviso', { p_id: s.id, p_aviso: v }); toast('Aviso guardado'); break;
      }
      case 'eliminar':
        if (!await preguntar({ titulo: 'Eliminar solicitud', texto: 'Se borra la solicitud con sus comentarios e historial. No se puede deshacer.', boton: 'Eliminar definitivamente', peligro: true })) return;
        await rpc('eliminar_solicitud', id); dlg.close(); toast('Solicitud eliminada'); break;
      case 'borrar-com':
        if (!await preguntar({ titulo: 'Eliminar comentario', texto: 'El comentario dejará de verse.', boton: 'Eliminar comentario', peligro: true })) return;
        await rpc('eliminar_comentario', { p_comentario_id: b.dataset.com });
        await cargarComentarios(s.id); return;
    }
    await cargarSolicitudes();
    if (S.abierta) await refrescarDetalle();
  });
  // Si falló (p. ej. otra persona cambió el estado), sincroniza la vista
  if (!ok && S.abierta) cargarSolicitudes().then(() => S.abierta && refrescarDetalle()).catch(() => {});
});

dlg.addEventListener('submit', async (e) => {
  if (e.target.id !== 'f-com') return;
  e.preventDefault();
  const f = e.target, txt = f.texto.value.trim();
  if (!txt) return;
  await conBoton(f.querySelector('button'), async () => {
    await rpc('agregar_comentario', { p_solicitud_id: S.abierta, p_texto: txt });
    f.reset();
    await cargarComentarios(S.abierta);
  });
});

async function cargarComentarios(id) {
  const { data, error } = await sb.from('comentarios').select('*').eq('solicitud_id', id).is('eliminado_en', null).order('creado_en');
  const ul = $('#det-coms'); if (!ul || S.abierta !== id) return;
  if (error) { ul.innerHTML = `<li class="error">${esc(msgError(error))}</li>`; return; }
  ul.innerHTML = data.length ? data.map((c) => `
    <li class="com ${c.tipo === 'sistema' ? 'sistema' : ''}">
      <div class="com-cab"><span>${c.tipo === 'sistema' ? 'Sistema' : esc(nombreDe(c.usuario_id))}, ${fHora(c.creado_en)}</span>
      ${esAdmin() && c.tipo !== 'sistema' ? `<button type="button" class="link" data-acc="borrar-com" data-com="${c.id}">Eliminar</button>` : ''}</div>
      <p class="com-txt">${esc(c.texto)}</p></li>`).join('')
    : '<li class="nota" style="color:var(--tinta-2)">Sin comentarios todavía.</li>';
}

async function cargarHistorial(id) {
  const { data, error } = await sb.from('historial_solicitudes').select('*').eq('solicitud_id', id).order('creado_en');
  const ol = $('#det-hist'); if (!ol || S.abierta !== id) return;
  if (error) { ol.innerHTML = `<li class="error">${esc(msgError(error))}</li>`; return; }
  ol.innerHTML = data.length ? data.map((h) => `
    <li><time>${fHora(h.creado_en)}</time><span><strong>${h.usuario_id ? esc(nombreDe(h.usuario_id)) : 'Invitado o sistema'}</strong>: ${esc(ACCIONES[h.accion] || h.accion)}${h.comentario ? '. ' + esc(h.comentario) : ''}</span></li>`).join('')
    : '<li>Sin movimientos registrados.</li>';
}

/* =========================================================
   Diálogo de confirmación / texto
   ========================================================= */
function preguntar({ titulo, texto = '', campo = null, boton = 'Confirmar', peligro = false }) {
  return new Promise((resolver) => {
    const d = $('#dlg-pregunta');
    let hecho = false;
    const fin = (v) => { if (hecho) return; hecho = true; if (d.open) d.close(); resolver(v); };
    const control = !campo ? '' : campo.tipo === 'password'
      ? `<label>${esc(campo.label)}<input name="valor" type="password" minlength="${campo.min || 1}" required autocomplete="new-password"></label>`
      : `<label>${esc(campo.label)}<textarea name="valor" rows="3" maxlength="1000" required></textarea></label>`;
    d.innerHTML = `<form><h2>${esc(titulo)}</h2>${texto ? `<p>${esc(texto)}</p>` : ''}${control}
      <menu><button type="button" class="btn sec" data-volver>Volver</button>
      <button type="submit" class="btn ${peligro ? 'peligro' : ''}">${esc(boton)}</button></menu></form>`;
    const f = d.querySelector('form');
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      if (campo) { const v = f.valor.value.trim(); if (!v) return; fin(campo.tipo === 'password' ? f.valor.value : v); }
      else fin(true);
    });
    d.querySelector('[data-volver]').addEventListener('click', () => fin(null));
    d.addEventListener('close', () => fin(null), { once: true });
    d.showModal();
    (f.valor || f.querySelector('[type=submit]')).focus();
  });
}

/* =========================================================
   Nueva solicitud
   ========================================================= */
function prepararNueva() {
  const f = $('#f-nueva');
  const actual = f.area_id.value;
  const planta = S.areas.find((a) => a.nombre.toLowerCase() === 'planta');
  const def = actual || S.perfil?.area_id || planta?.id || S.areas[0]?.id || '';
  f.area_id.innerHTML = optAreas(def, 'Elegir área');
  f.linea_id.innerHTML = optLineas(f.area_id.value, f.linea_id.value);
  f.responsable_id.innerHTML = opciones(tecnicos().map((p) => ({ v: p.user_id, t: p.nombre_completo })), f.responsable_id.value, 'Automático (según línea y carga)');
  if (!f.solicitante.value) f.solicitante.value = S.perfil?.nombre_completo || '';
  f.fecha_requerida.min = hoy();
}
$('#f-nueva').area_id.addEventListener('change', (e) => { $('#f-nueva').linea_id.innerHTML = optLineas(e.target.value, ''); });

$('#f-nueva').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  await conBoton(f.querySelector('[type=submit]'), async () => {
    const nueva = await rpc('crear_solicitud', {
      p_area_id: f.area_id.value || null, p_linea_id: f.linea_id.value || null,
      p_tipo: f.tipo.value.trim(), p_actividad: f.actividad.value.trim(), p_descripcion: f.descripcion.value.trim(),
      p_aviso: f.aviso.value.trim(), p_prioridad: f.prioridad.value, p_solicitante: f.solicitante.value.trim(),
      p_responsable_id: f.responsable_id.value || null,
      p_fecha_requerida: f.fecha_requerida.value || null,
    });
    const area_id = f.area_id.value;
    f.reset(); f.area_id.value = area_id;
    toast(nueva.responsable_id
      ? `Solicitud creada y asignada a ${nombreDe(nueva.responsable_id)}`
      : 'Solicitud creada. No hay técnicos activos para asignarla.');
    await cargarSolicitudes();
    irA('tablero');
  });
});

/* =========================================================
   Administración (solo administrador)
   ========================================================= */
function renderAdmin() {
  if (!esAdmin()) return;
  const filas = S.perfiles.map((p) => `
    <tr class="${p.activo ? '' : 'inactivo'}">
      <td>${esc(p.nombre_completo)}</td><td>${esc(p.correo)}</td><td>${esc(ROLES[p.rol] || p.rol)}</td>
      <td>${esc(area(p.area_id)?.nombre || '—')}${p.linea_id ? ' / ' + esc(linea(p.linea_id)?.nombre || '') : ''}</td>
      <td>${p.activo ? 'Activo' : 'Inactivo'}</td>
      <td><button type="button" class="btn sec chico" data-editar="${p.user_id}">Editar</button></td></tr>`).join('');
  $('#tabla-usuarios').innerHTML = `<table><thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Área / línea</th><th>Estado</th><th></th></tr></thead><tbody>${filas}</tbody></table>`;

  $('#lista-areas').innerHTML = S.areas.map((a) => {
    const ls = S.lineas.filter((l) => l.area_id === a.id);
    return `<div class="area-bloque"><h3>${esc(a.nombre)}</h3>
      <p class="area-coord">Coordinador: ${a.coordinador_id ? esc(nombreDe(a.coordinador_id)) : 'sin asignar'}</p>
      <div class="chips">${ls.length ? ls.map((l) => `<span class="chip">${esc(l.nombre)}</span>`).join('') : '<span class="area-coord">Sin líneas</span>'}</div></div>`;
  }).join('');

  const fu = $('#f-usuario');
  fu.area_id.innerHTML = optAreas(fu.area_id.value, 'Sin área');
  fu.linea_id.innerHTML = optLineas(fu.area_id.value, fu.linea_id.value);
  $('#f-area').coordinador_id.innerHTML = opciones(S.perfiles.filter((p) => p.activo && p.rol === 'coordinador_produccion').map((p) => ({ v: p.user_id, t: p.nombre_completo })), '', 'Sin coordinador');
  $('#f-linea').area_id.innerHTML = optAreas($('#f-linea').area_id.value, 'Elegir área');
}

$('#btn-autoasignar').addEventListener('click', async (e) => {
  const sin = S.solicitudes.filter((s) => s.estado === 'Pendiente' && !s.responsable_id).length;
  if (!sin) { toast('No hay solicitudes pendientes sin responsable.'); return; }
  if (!await preguntar({ titulo: 'Asignar pendientes', texto: `${sin} solicitudes pendientes no tienen responsable. Se repartirán entre los técnicos según su línea, área y carga de trabajo.`, boton: 'Asignar automáticamente' })) return;
  await conBoton(e.currentTarget, async () => {
    const n = await rpc('autoasignar_pendientes');
    toast(n ? `${n} solicitudes asignadas` : 'No hay técnicos activos de Mantenimiento.');
    await cargarSolicitudes();
  });
});

$('#f-usuario').area_id.addEventListener('change', (e) => { $('#f-usuario').linea_id.innerHTML = optLineas(e.target.value, ''); });

$('#f-usuario').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  await conBoton(f.querySelector('[type=submit]'), async () => {
    await funcion('admin-create-user', {
      accion: 'crear', nombre_completo: f.nombre_completo.value.trim(), correo: f.correo.value.trim(),
      password: f.password.value, rol: f.rol.value, area_id: f.area_id.value || null, linea_id: f.linea_id.value || null,
    });
    toast(`Usuario creado. Entrega a ${f.nombre_completo.value.trim()} su correo y contraseña inicial.`);
    f.reset();
    await cargarCatalogos(); renderAdmin();
  });
});

$('#f-area').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  await conBoton(f.querySelector('[type=submit]'), async () => {
    await rpc('crear_area', { p_nombre: f.nombre.value.trim(), p_coordinador_id: f.coordinador_id.value || null });
    toast('Área creada'); f.reset();
    await cargarCatalogos(); renderAdmin(); prepararNueva();
  });
});

$('#f-linea').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  await conBoton(f.querySelector('[type=submit]'), async () => {
    await rpc('crear_linea', { p_area_id: f.area_id.value, p_nombre: f.nombre.value.trim() });
    toast('Línea creada'); f.nombre.value = '';
    await cargarCatalogos(); renderAdmin(); prepararNueva();
  });
});

$('#tabla-usuarios').addEventListener('click', (e) => {
  const b = e.target.closest('[data-editar]'); if (b) editarUsuario(b.dataset.editar);
});

function editarUsuario(uid) {
  const p = persona(uid); if (!p) return;
  const d = $('#dlg-usuario');
  d.innerHTML = `<form id="f-editar">
    <h2>Editar usuario</h2><p>${esc(p.correo)}</p>
    <label>Nombre completo<input name="nombre" maxlength="120" required value="${esc(p.nombre_completo)}"></label>
    <label>Rol<select name="rol">${opciones(Object.entries(ROLES).map(([v, t]) => ({ v, t })), p.rol)}</select></label>
    <div class="rejilla">
      <label>Área<select name="area_id">${optAreas(p.area_id, 'Sin área')}</select></label>
      <label>Línea<select name="linea_id">${optLineas(p.area_id, p.linea_id)}</select></label>
    </div>
    ${p.rol === 'mantenimiento' ? '<p class="nota" style="color:var(--tinta-2);font-size:.9rem">El área y la línea definen qué solicitudes le llegan automáticamente: primero las de su línea, luego las de su área.</p>' : ''}
    <label class="check"><input type="checkbox" name="activo" ${p.activo ? 'checked' : ''}> Puede entrar a la app</label>
    <menu>
      <button type="button" class="btn sec" data-pass>Asignar contraseña nueva</button>
      <button type="button" class="btn sec" data-cerrar>Volver</button>
      <button type="submit" class="btn">Guardar cambios</button>
    </menu></form>`;
  const f = d.querySelector('form');
  f.area_id.addEventListener('change', () => { f.linea_id.innerHTML = optLineas(f.area_id.value, ''); });
  d.querySelector('[data-cerrar]').addEventListener('click', () => d.close());
  d.querySelector('[data-pass]').addEventListener('click', async (ev) => {
    d.close();
    const nueva = await preguntar({ titulo: 'Contraseña nueva', texto: `Para ${p.nombre_completo}. Mínimo 8 caracteres. Entrégasela en persona.`, campo: { label: 'Contraseña nueva', tipo: 'password', min: 8 }, boton: 'Asignar contraseña' });
    if (nueva == null) return;
    try { await funcion('admin-create-user', { accion: 'cambiar_password', user_id: uid, password: nueva }); toast('Contraseña asignada'); }
    catch (err) { toast(msgError(err), 'error'); }
  });
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    await conBoton(f.querySelector('[type=submit]'), async () => {
      await rpc('actualizar_usuario', {
        p_user_id: uid, p_nombre_completo: f.nombre.value.trim(), p_rol: f.rol.value, p_activo: f.activo.checked,
        p_area_id: f.area_id.value || null, p_linea_id: f.linea_id.value || null,
      });
      d.close(); toast('Usuario actualizado');
      await cargarCatalogos(); renderAdmin();
      if (uid === yo()) { const { data: { user } } = await sb.auth.getUser(); await entrar(user); }
    });
  });
  d.showModal();
}

/* =========================================================
   Arranque
   ========================================================= */
(async function arrancar() {
  sb.auth.onAuthStateChange((evento) => { if (evento === 'SIGNED_OUT' && S.perfil) setTimeout(() => mostrarLogin(), 0); });
  const { data: { session } } = await sb.auth.getSession();
  if (session) await entrar(session.user); else mostrarLogin();
})();
