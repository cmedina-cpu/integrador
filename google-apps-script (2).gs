/**
 * =========================================================================
 *  MISIÓN CIENCIA Y PALABRAS · Servicio de registro de resultados
 *  Google Apps Script (vinculado a una planilla de Google Sheets)
 * -------------------------------------------------------------------------
 *  - Cada división tiene sus propias hojas:
 *        4.º A · Resultados generales | 4.º A · Por misión | 4.º A · Detalle
 *        4.º B · Resultados generales | 4.º B · Por misión | 4.º B · Detalle
 *    Cada alumno se guarda SOLO en las hojas de su división.
 *  - Evita duplicados: cada fila tiene una "Clave única"; si llega de nuevo
 *    (porque el alumno avanzó, volvió atrás o actualizó la página), se
 *    ACTUALIZA en lugar de agregarse otra vez.
 *  - Entrega los datos al panel docente solo con la clave correcta
 *    (acción "reporte"). La clave se guarda en las Propiedades del script,
 *    nunca en el código de la página.
 *  Instrucciones completas: README.md
 * =========================================================================
 */

const DIVISIONES = { '4A': '4.º A', '4B': '4.º B' };
const COLOR_DIVISION = { '4A': '#4338ca', '4B': '#059669' };

const HOJAS = {
  GENERAL: {
    nombre: 'Resultados generales',
    columnas: [
      ['fecha', 'Fecha y hora (última actualización)'],
      ['division', 'Grado y división'],
      ['apellido', 'Apellido'],
      ['nombre', 'Nombre'],
      ['puntaje', 'Puntaje total'],
      ['porcentaje', '% de logro'],
      ['correctas', 'Respuestas correctas'],
      ['incorrectas', 'Respuestas incorrectas'],
      ['respondidas', 'Respuestas dadas'],
      ['sinResponder', 'Sin responder'],
      ['misiones', 'Misiones completadas'],
      ['tiempo', 'Tiempo total'],
      ['estado', 'Estado'],
      ['nota20', 'Equivalencia sobre 20'],
      ['tiempoSeg', 'Tiempo (segundos)'],
      ['sesion', 'ID de sesión'],
      ['clave', 'Clave única']
    ]
  },
  MISION: {
    nombre: 'Por misión',
    columnas: [
      ['division', 'Grado y división'],
      ['apellido', 'Apellido'],
      ['nombre', 'Nombre'],
      ['fecha', 'Fecha'],
      ['mision', 'Misión'],
      ['estado', 'Estado de la misión'],
      ['area', 'Área'],
      ['contenidos', 'Contenido evaluado'],
      ['correctas', 'Respuestas correctas'],
      ['incorrectas', 'Respuestas incorrectas'],
      ['sinResponder', 'Sin responder'],
      ['puntaje', 'Puntaje obtenido'],
      ['porcentaje', 'Porcentaje de logro'],
      ['sesion', 'ID de sesión'],
      ['clave', 'Clave única']
    ]
  },
  DETALLE: {
    nombre: 'Detalle',
    columnas: [
      ['division', 'Grado y división'],
      ['apellido', 'Apellido'],
      ['nombre', 'Nombre'],
      ['mision', 'Misión'],
      ['desafio', 'Desafío'],
      ['actividad', 'Identificador de actividad'],
      ['area', 'Área'],
      ['contenido', 'Contenido'],
      ['consigna', 'Consigna'],
      ['estado', 'Estado (respondida / sin responder)'],
      ['respuesta', 'Respuesta seleccionada'],
      ['correcta', 'Respuesta correcta'],
      ['resultado', 'Resultado'],
      ['fecha', 'Fecha de respuesta'],
      ['sesion', 'ID de sesión'],
      ['clave', 'Clave única']
    ]
  }
};

/* ---------------------------------------------------------------------- */
/*  Menú en la planilla                                                    */
/* ---------------------------------------------------------------------- */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🧭 Misión Ciencia')
    .addItem('1. Preparar las hojas (4.º A y 4.º B)', 'configurarPlanilla')
    .addItem('2. Establecer clave docente', 'establecerClaveDocente')
    .addToUi();
}

/** Crea las seis hojas con sus encabezados (se puede ejecutar varias veces). */
function configurarPlanilla() {
  Object.keys(DIVISIONES).forEach(function (div) {
    Object.keys(HOJAS).forEach(function (k) { obtenerHoja_(HOJAS[k], div); });
  });
  try { SpreadsheetApp.getUi().alert('✅ Hojas de 4.º A y 4.º B listas. Ahora establecé la clave docente (menú 🧭 Misión Ciencia → 2).'); } catch (e) { /* ejecutado desde el editor */ }
}

/** Pide la clave docente y la guarda en las Propiedades del script. */
function establecerClaveDocente() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt('Clave docente', 'Escribí la clave para entrar al panel docente (mínimo 6 caracteres):', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const clave = r.getResponseText().trim();
  if (clave.length < 6) { ui.alert('La clave debe tener al menos 6 caracteres.'); return; }
  PropertiesService.getScriptProperties().setProperty('CLAVE_DOCENTE', clave);
  ui.alert('✅ Clave guardada. No la compartas con los alumnos.');
}

/* ---------------------------------------------------------------------- */
/*  Servicio web                                                           */
/* ---------------------------------------------------------------------- */
function doGet() {
  return json_({ ok: true, servicio: 'Misión Ciencia y Palabras', mensaje: 'El servicio está activo.' });
}

function doPost(e) {
  let data;
  try {
    data = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'Datos inválidos' });
  }
  try {
    if (data.action === 'guardar') return json_(guardar_(data));
    if (data.action === 'reporte') return json_(reporte_(data));
    return json_({ ok: false, error: 'Acción desconocida' });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

/* ---------------------------------------------------------------------- */
/*  Guardar resultados (sin duplicados, en la división que corresponde)    */
/* ---------------------------------------------------------------------- */
function guardar_(data) {
  const sesion = String(data.sesion || '');
  if (!/^[A-Z0-9]{6,40}$/i.test(sesion)) throw new Error('Sesión inválida');
  const div = String(data.division || '').toUpperCase();
  if (!DIVISIONES[div]) throw new Error('División inválida: solo 4A o 4B');
  const g0 = data.general || {};
  if (!g0.apellido || !g0.nombre) throw new Error('Faltan el nombre o el apellido');

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ahora = new Date();
    const quien = { division: DIVISIONES[div], apellido: g0.apellido, nombre: g0.nombre };
    const g = Object.assign({}, g0, quien, { fecha: ahora, sesion: sesion, clave: sesion });
    upsert_(HOJAS.GENERAL, div, [g]);

    const misiones = (data.misiones || []).slice(0, 50).map(function (m) {
      return Object.assign({}, m, quien, { fecha: m.fecha ? new Date(m.fecha) : ahora, sesion: sesion, clave: sesion + '|' + m.mision + '|' + m.area });
    });
    if (misiones.length) upsert_(HOJAS.MISION, div, misiones);

    const detalle = (data.detalle || []).slice(0, 1000).map(function (d) {
      return Object.assign({}, d, quien, { fecha: d.fecha ? new Date(d.fecha) : '', sesion: sesion, clave: sesion + '|' + d.actividad });
    });
    if (detalle.length) upsert_(HOJAS.DETALLE, div, detalle);

    return { ok: true, guardado: ahora.toISOString(), division: DIVISIONES[div], filas: { general: 1, misiones: misiones.length, detalle: detalle.length } };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Inserta o actualiza filas según la columna "Clave única" (última columna).
 * Las actualizaciones contiguas se escriben en bloque para que sea rápido.
 */
function upsert_(def, div, objetos) {
  const hoja = obtenerHoja_(def, div);
  const nCols = def.columnas.length;
  const ultima = hoja.getLastRow();
  const indice = {};
  if (ultima > 1) {
    hoja.getRange(2, nCols, ultima - 1, 1).getValues().forEach(function (r, i) { if (r[0]) indice[r[0]] = i + 2; });
  }
  const nuevas = [], cambios = [];
  objetos.forEach(function (o) {
    const fila = def.columnas.map(function (c) { return limpiar_(o[c[0]]); });
    const n = indice[o.clave];
    if (n) cambios.push({ fila: n, valores: fila });
    else { nuevas.push(fila); indice[o.clave] = -1; }
  });
  cambios.sort(function (a, b) { return a.fila - b.fila; });
  let i = 0;
  while (i < cambios.length) {
    let j = i;
    while (j + 1 < cambios.length && cambios[j + 1].fila === cambios[j].fila + 1) j++;
    const tramo = cambios.slice(i, j + 1);
    hoja.getRange(tramo[0].fila, 1, tramo.length, nCols).setValues(tramo.map(function (t) { return t.valores; }));
    i = j + 1;
  }
  if (nuevas.length) hoja.getRange(hoja.getLastRow() + 1, 1, nuevas.length, nCols).setValues(nuevas);
}

/** Evita textos demasiado largos y fórmulas inyectadas. */
function limpiar_(v) {
  if (v === undefined || v === null) return '';
  if (v instanceof Date) return v;
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  let s = String(v).slice(0, 500);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}

function nombreHoja_(def, div) { return DIVISIONES[div] + ' · ' + def.nombre; }

function obtenerHoja_(def, div) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const nombre = nombreHoja_(def, div);
  let hoja = ss.getSheetByName(nombre);
  if (!hoja) {
    hoja = ss.insertSheet(nombre);
    const enc = def.columnas.map(function (c) { return c[1]; });
    hoja.getRange(1, 1, 1, enc.length).setValues([enc])
      .setFontWeight('bold').setBackground(COLOR_DIVISION[div]).setFontColor('#ffffff').setWrap(true);
    hoja.setFrozenRows(1);
    hoja.setColumnWidths(1, enc.length, 150);
    hoja.setTabColor(COLOR_DIVISION[div]);
  }
  return hoja;
}

/* ---------------------------------------------------------------------- */
/*  Reporte para el panel docente (protegido con clave del servidor)       */
/* ---------------------------------------------------------------------- */
function reporte_(data) {
  const cache = CacheService.getScriptCache();
  const fallos = Number(cache.get('fallos') || 0);
  if (fallos >= 8) return { ok: false, error: 'Demasiados intentos fallidos. Esperá 10 minutos.' };

  const clave = PropertiesService.getScriptProperties().getProperty('CLAVE_DOCENTE');
  if (!clave) return { ok: false, error: 'Falta establecer la clave docente en la planilla (menú 🧭 Misión Ciencia).' };
  if (String(data.clave || '') !== clave) {
    cache.put('fallos', String(fallos + 1), 600);
    Utilities.sleep(1200);
    return { ok: false, error: 'Clave incorrecta' };
  }
  const out = { ok: true, generado: new Date().toISOString(), general: [], misiones: [], detalle: [] };
  Object.keys(DIVISIONES).forEach(function (div) {
    out.general = out.general.concat(leer_(HOJAS.GENERAL, div));
    out.misiones = out.misiones.concat(leer_(HOJAS.MISION, div));
    out.detalle = out.detalle.concat(leer_(HOJAS.DETALLE, div));
  });
  return out;
}

function leer_(def, div) {
  const hoja = obtenerHoja_(def, div);
  const ultima = hoja.getLastRow();
  if (ultima < 2) return [];
  const valores = hoja.getRange(2, 1, ultima - 1, def.columnas.length).getValues();
  return valores.map(function (fila) {
    const o = {};
    def.columnas.forEach(function (c, i) { o[c[0]] = fila[i] instanceof Date ? fila[i].toISOString() : fila[i]; });
    o.division = DIVISIONES[div];
    return o;
  });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
