'use strict';
/* Formulario público de reporte (sin usuario). Habla solo con la
   Edge Function reportar-solicitud; no toca tablas directamente. */
const sb = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MENSAJES = {
  LIMITE_ALCANZADO: 'Se enviaron muchos reportes desde esta conexión. Espera una hora o avisa a mantenimiento directamente.',
  DATOS_INVALIDOS: 'Completa el área, qué está fallando y tu nombre.',
  LINEA_NO_PERTENECE_AL_AREA: 'La línea elegida no pertenece a esa área.',
  FECHA_REQUERIDA_INVALIDA: 'La fecha para la que se necesita no puede ser anterior a hoy.',
};
let CAT = { areas: [], lineas: [], tecnicos: [], hoy: '' };

async function llamar(body) {
  const { data, error } = await sb.functions.invoke('reportar-solicitud', { body });
  if (error) {
    let cod = error.message;
    try { const j = await error.context.json(); cod = j.error || cod; } catch (_) { /* sin cuerpo */ }
    throw new Error(cod);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}
function mostrarError(e) {
  const p = $('#rep-error');
  const m = e?.message || String(e);
  p.textContent = MENSAJES[m] || (/fetch|network/i.test(m) ? 'Sin conexión. Revisa tu internet e inténtalo otra vez.' : 'No se pudo enviar el reporte. Inténtalo otra vez.');
  p.hidden = false;
}
function pintarLineas() {
  const f = $('#f-reporte');
  const ls = CAT.lineas.filter((l) => l.area_id === f.area_id.value);
  f.linea_id.innerHTML = '<option value="">No sé / no aplica</option>' + ls.map((l) => `<option value="${esc(l.id)}">${esc(l.nombre)}</option>`).join('');
}

(async () => {
  const f = $('#f-reporte');
  try {
    CAT = await llamar({ accion: 'catalogos' });
    f.area_id.innerHTML = '<option value="">Elegir área</option>' + CAT.areas.map((a) => `<option value="${esc(a.id)}">${esc(a.nombre)}</option>`).join('');
    if (CAT.areas.length === 1) f.area_id.value = CAT.areas[0].id;
    pintarLineas();
    f.responsable_id.innerHTML = '<option value="">Elegir técnico</option>'
      + CAT.tecnicos.map((t) => `<option value="${esc(t.user_id)}">${esc(t.nombre_completo)}</option>`).join('')
      + '<option value="auto">No sé, que lo asigne el sistema</option>';
    f.fecha_requerida.min = CAT.hoy || new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
  } catch (e) { mostrarError(e); }

  f.area_id.addEventListener('change', pintarLineas);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#rep-error').hidden = true;
    const btn = f.querySelector('[type=submit]'); btn.disabled = true;
    try {
      const r = await llamar({
        accion: 'crear', area_id: f.area_id.value, linea_id: f.linea_id.value || null,
        actividad: f.actividad.value.trim(), descripcion: f.descripcion.value.trim(),
        solicitante: f.solicitante.value.trim(), prioridad: f.prioridad.value, sitio_web: f.sitio_web.value,
        responsable_id: f.responsable_id.value === 'auto' ? null : f.responsable_id.value,
        fecha_requerida: f.fecha_requerida.value || null,
      });
      const lin = CAT.lineas.find((l) => l.id === f.linea_id.value)?.nombre
        || CAT.areas.find((a) => a.id === f.area_id.value)?.nombre || '';
      $('#rep-num').textContent = lin;
      $('#rep-detalle').textContent = r.responsable
        ? `Lo atenderá ${r.responsable}.` + (f.fecha_requerida.value ? ` Se necesita para el ${f.fecha_requerida.value.split('-').reverse().join('/')}.` : '')
        : 'Mantenimiento lo asignará a un técnico.';
      f.hidden = true; $('#rep-ok').hidden = false;
    } catch (err) { mostrarError(err); } finally { btn.disabled = false; }
  });
  $('#rep-otro').addEventListener('click', () => {
    const nombre = f.solicitante.value, area = f.area_id.value;
    f.reset(); f.solicitante.value = nombre; f.area_id.value = area; pintarLineas();
    $('#rep-ok').hidden = true; f.hidden = false;
  });
})();
