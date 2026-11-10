/* =========================================================================
   MISIÓN CIENCIA Y PALABRAS: Exploradores del conocimiento
   Integrador gamificado de Lengua y Ciencias Naturales · 4.º grado
   -------------------------------------------------------------------------
   Índice
     1. Configuración  ← ACÁ se pega la URL de Google Apps Script
     2. Utilidades
     3. Contenidos evaluados (etiquetas para el panel docente)
     4. Misiones y actividades (banco de consignas con respuestas validadas)
     5. Ilustraciones (SVG)
     6. Tipos de actividad (motor interactivo)
     7. Estado, guardado local y cronómetro
     8. Envío de resultados a Google Sheets (cola con reintentos)
     9. Pantallas del alumno
    10. Panel docente
    11. Inicio
   ========================================================================= */
'use strict';

/* =========================================================================
   1. CONFIGURACIÓN
   ========================================================================= */
const CONFIG = {
  // Pegá entre las comillas la URL de la aplicación web de Apps Script
  // (termina en /exec). Ver README.md, paso 3.
  SHEETS_URL: '',

  PUNTOS_POR_CORRECTA: 10,          // puntos por cada respuesta correcta
  STORAGE_PREFIX: 'mcp_v2_alumno_', // partidas guardadas (una por alumno)
  CURRENT_KEY: 'mcp_v2_actual',     // partida abierta en esta compu
  OUTBOX_KEY: 'mcp_envios_v2',      // envíos pendientes
  REINTENTO_MS: 30000,              // cada cuánto se reintenta enviar resultados pendientes
  ENVIO_DIFERIDO_MS: 15000          // al navegar entre desafíos, se envía 15 s después del último cambio
};

/* =========================================================================
   2. UTILIDADES
   ========================================================================= */
const SVG_NS = 'http://www.w3.org/2000/svg';
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Crea un elemento HTML: el('div', {class:'x', onclick: fn}, hijos...) */
function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    n.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return n;
}
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** Texto seguro con resaltados: «palabra» → resaltada; **texto** → negrita */
const fmt = s => esc(s)
  .replace(/«([^»]+)»/g, '«<mark class="hl">$1</mark>»')
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
/** Quita signos de puntuación de una palabra */
const clean = w => String(w).replace(/[.,;:!¡?¿«»()"]/g, '');
const words = s => s.split(' ');

function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) { let a = seed; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
/** Mezcla estable: el mismo alumno ve el mismo orden aunque recargue la página */
function shuffle(arr, seed = 'x') { const r = rng(hashStr(seed)); const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const uid = () => 'S' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 7).toUpperCase();
function fmtTime(ms) { const s = Math.round((ms || 0) / 1000); const m = Math.floor(s / 60); return `${m} min ${String(s % 60).padStart(2, '0')} s`; }
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

let toastTimer = null;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}
function confetti(n = 90) {
  const box = $('#confetti'); const colors = ['#4338ca', '#7c3aed', '#059669', '#0891b2', '#f5b301', '#e05a2b'];
  for (let i = 0; i < n; i++) {
    const c = el('i'); c.style.left = Math.random() * 100 + '%'; c.style.background = pick(colors);
    c.style.animationDuration = (2 + Math.random() * 2.2) + 's'; c.style.animationDelay = (Math.random() * .6) + 's';
    c.style.transform = `rotate(${Math.random() * 360}deg)`; box.append(c); setTimeout(() => c.remove(), 5200);
  }
}

/* =========================================================================
   3. CONTENIDOS EVALUADOS
   Cada ítem queda asociado a un contenido y un área. Así el panel docente
   y la planilla muestran qué contenidos tienen más errores.
   ========================================================================= */
const LEN = 'Lengua', NAT = 'Ciencias Naturales';
const CONT = {
  L_CLASES: { label: 'Clases de palabras', area: LEN },
  L_PROP: { label: 'Sustantivos propios y comunes', area: LEN },
  L_CONC: { label: 'Sustantivos concretos y abstractos', area: LEN },
  L_COLEC: { label: 'Sustantivos individuales y colectivos', area: LEN },
  L_ADJ: { label: 'Adjetivos calificativos', area: LEN },
  L_GENT: { label: 'Adjetivos gentilicios', area: LEN },
  L_NUM: { label: 'Numerales (cardinales, ordinales y partitivos)', area: LEN },
  L_ART: { label: 'Artículos definidos e indefinidos', area: LEN },
  L_PRON: { label: 'Pronombres personales', area: LEN },
  L_GN: { label: 'Género y número (análisis morfológico)', area: LEN },
  L_ORAC: { label: 'Oraciones bimembres y unimembres', area: LEN },
  L_SP: { label: 'Sujeto y predicado', area: LEN },
  L_NUC: { label: 'Núcleo del sujeto y núcleo verbal', area: LEN },
  L_COMP: { label: 'Comprensión lectora', area: LEN },
  N_AMB: { label: 'Ambientes aeroterrestres y acuáticos', area: NAT },
  N_ADAP: { label: 'Adaptaciones de los animales', area: NAT },
  N_EST: { label: 'Estructuras del aparato locomotor', area: NAT },
  N_FUN: { label: 'Funciones del aparato locomotor', area: NAT },
  N_PREV: { label: 'Prevención y cuidado del aparato locomotor', area: NAT },
  N_MAG: { label: 'La Tierra como imán y la brújula', area: NAT },
  N_ELEC: { label: 'Fenómenos electrostáticos', area: NAT }
};
const GN = ['masculino singular', 'femenino singular', 'masculino plural', 'femenino plural'];

/* =========================================================================
   4. MISIONES Y ACTIVIDADES
   Tipos: quiz · tf (verdadero/falso) · fill (completar) · classify (arrastrar
   y clasificar) · match (unir con flechas) · tokens (seleccionar palabras) ·
   order (ordenar secuencias) · syntax (análisis de oraciones) · table
   (análisis por palabra) · hotspot (ilustración con zonas seleccionables)
   ========================================================================= */
const MISSIONS = [
  /* ---------------------------------------------------------------- M1 */
  {
    id: 'M1', num: 1, icon: '🦅', scene: 'cordillera',
    title: 'Los secretos de los animales de Mendoza', short: 'Animales de Mendoza',
    badge: { name: 'Guardián de la cordillera', icon: '🏔️' },
    pills: ['Clases de palabras', 'Ambientes y adaptaciones'],
    story: 'Llegaste a la cordillera mendocina. Entre rocas, ríos y viento helado viven animales asombrosos. Los guardaparques dejaron pistas escritas: si las descifrás, vas a descubrir cómo sobreviven el cóndor, el guanaco, el puma y el zorro… ¡y vas a recuperar la primera pieza del mapa!',
    activities: [
      {
        id: 'M1A1', type: 'tokens', title: 'Pista 1: el guanaco',
        consigna: 'Leé la pista y, en cada fila, tocá las palabras que se piden.',
        sentence: 'El guanaco posee un pelaje grueso y patas resistentes. Camina por terrenos rocosos y montañosos.',
        tasks: [
          { id: 'sus', prompt: 'Tocá todos los sustantivos.', answers: [1, 4, 7, 11], cont: 'L_CLASES', explain: 'Los sustantivos nombran seres y objetos: guanaco, pelaje, patas y terrenos.' },
          { id: 'adj', prompt: 'Tocá todos los adjetivos calificativos.', answers: [5, 8, 12, 14], cont: 'L_ADJ', explain: 'Los adjetivos calificativos dicen cómo es el sustantivo: grueso, resistentes, rocosos y montañosos.' },
          { id: 'ver', prompt: 'Tocá todos los verbos.', answers: [2, 9], cont: 'L_CLASES', explain: 'Los verbos indican acciones: posee y camina.' }
        ]
      },
      {
        id: 'M1A2', type: 'quiz', title: '¿Dónde vive y cómo sobrevive?',
        consigna: 'Volvé a leer la pista del guanaco y respondé como un guardaparque.',
        context: 'El guanaco posee un pelaje grueso y patas resistentes. Camina por terrenos rocosos y montañosos.',
        questions: [
          { id: 'amb', q: '¿En qué tipo de ambiente vive el guanaco?', options: ['Aeroterrestre', 'Acuático'], answer: 0, cont: 'N_AMB', explain: 'El guanaco vive sobre el suelo y respira el oxígeno del aire: su ambiente es aeroterrestre.' },
          { id: 'car', q: '¿Cómo es el ambiente de montaña donde vive el guanaco?', options: ['Suelo rocoso, viento y mucho frío', 'Agua por todos lados y poca luz en lo profundo', 'Calor y humedad todo el año'], answer: 0, cont: 'N_AMB', explain: 'En la cordillera el suelo es rocoso, hay viento y las temperaturas son bajas.' },
          { id: 'pel', q: '¿Para qué le sirve al guanaco su pelaje grueso?', options: ['Para protegerse del frío de la montaña', 'Para nadar más rápido', 'Para atrapar a sus presas'], answer: 0, cont: 'N_ADAP', explain: 'El pelaje grueso funciona como abrigo: es una adaptación al frío.' },
          { id: 'pat', q: '¿Para qué le sirven sus patas resistentes?', options: ['Para caminar por terrenos rocosos y empinados', 'Para planear en el aire', 'Para respirar debajo del agua'], answer: 0, cont: 'N_ADAP', explain: 'Sus patas resistentes le permiten moverse con firmeza entre rocas y pendientes.' }
        ]
      },
      {
        id: 'M1A3', type: 'classify', title: 'Nombres de la cordillera', cont: 'L_PROP',
        consigna: 'Arrastrá cada sustantivo a su grupo (o tocalo y después tocá el grupo).',
        bins: [{ id: 'p', label: 'Sustantivo propio' }, { id: 'c', label: 'Sustantivo común' }],
        cards: [
          { id: 'mendoza', text: 'Mendoza', bin: 'p', explain: '«Mendoza» es propio: nombra un lugar en particular y va con mayúscula.' },
          { id: 'aconcagua', text: 'Aconcagua', bin: 'p', explain: '«Aconcagua» es propio: es el nombre de un cerro en particular.' },
          { id: 'atuel', text: 'Atuel', bin: 'p', explain: '«Atuel» es propio: es el nombre de un río en particular.' },
          { id: 'condor', text: 'cóndor', bin: 'c', explain: '«cóndor» es común: nombra a cualquier ave de esa especie.' },
          { id: 'montana', text: 'montaña', bin: 'c', explain: '«montaña» es común: nombra a cualquier montaña, sin decir cuál.' },
          { id: 'rio', text: 'río', bin: 'c', explain: '«río» es común: nombra a cualquier río, sin decir cuál.' }
        ]
      },
      {
        id: 'M1A4', type: 'classify', title: '¿Se puede tocar?', cont: 'L_CONC',
        consigna: 'Clasificá los sustantivos en concretos y abstractos.',
        bins: [{ id: 'c', label: 'Sustantivo concreto' }, { id: 'a', label: 'Sustantivo abstracto' }],
        cards: [
          { id: 'pelaje', text: 'pelaje', bin: 'c', explain: '«pelaje» es concreto: lo podemos ver y tocar.' },
          { id: 'roca', text: 'roca', bin: 'c', explain: '«roca» es concreto: se percibe con los sentidos.' },
          { id: 'pluma', text: 'pluma', bin: 'c', explain: '«pluma» es concreto: la podemos ver y tocar.' },
          { id: 'miedo', text: 'miedo', bin: 'a', explain: '«miedo» es abstracto: nombra un sentimiento que no se puede tocar.' },
          { id: 'libertad', text: 'libertad', bin: 'a', explain: '«libertad» es abstracto: nombra una idea.' },
          { id: 'valentia', text: 'valentía', bin: 'a', explain: '«valentía» es abstracto: nombra una cualidad.' }
        ]
      },
      {
        id: 'M1A5', type: 'match', title: '¿Uno o muchos?', cont: 'L_COLEC',
        consigna: 'Uní cada sustantivo individual con su colectivo: tocá una palabra de la izquierda y después su pareja.',
        pairs: [
          { id: 'pajaro', left: 'pájaro', right: 'bandada', explain: 'Un grupo de pájaros forma una bandada.' },
          { id: 'pez', left: 'pez', right: 'cardumen', explain: 'Un grupo de peces forma un cardumen.' },
          { id: 'abeja', left: 'abeja', right: 'enjambre', explain: 'Un grupo de abejas forma un enjambre.' },
          { id: 'perro', left: 'perro', right: 'jauría', explain: 'Un grupo de perros forma una jauría.' },
          { id: 'estrella', left: 'estrella', right: 'constelación', explain: 'Un grupo de estrellas forma una constelación.' }
        ]
      },
      {
        id: 'M1A6', type: 'classify', title: 'Cada uno en su ambiente', cont: 'N_AMB',
        consigna: 'Ubicá cada animal y cada característica en el ambiente que corresponde.',
        bins: [{ id: 'at', label: '🏔️ Aeroterrestre' }, { id: 'ac', label: '💧 Acuático' }],
        cards: [
          { id: 'condor', text: '🦅 cóndor', bin: 'at', explain: 'El cóndor vuela y se posa en las rocas: vive en el ambiente aeroterrestre.' },
          { id: 'guanaco', text: '🦙 guanaco', bin: 'at', explain: 'El guanaco camina sobre el suelo y respira el aire: es aeroterrestre.' },
          { id: 'puma', text: '🐆 puma', bin: 'at', explain: 'El puma caza sobre el suelo y respira el aire: es aeroterrestre.' },
          { id: 'zorro', text: '🦊 zorro', bin: 'at', explain: 'El zorro vive sobre el suelo: es aeroterrestre.' },
          { id: 'pejerrey', text: '🐟 pejerrey', bin: 'ac', explain: 'El pejerrey vive dentro del agua: su ambiente es acuático.' },
          { id: 'trucha', text: '🐟 trucha', bin: 'ac', explain: 'La trucha vive en ríos y lagos: su ambiente es acuático.' },
          { id: 'aire', text: 'Los seres vivos respiran el oxígeno del aire.', bin: 'at', explain: 'En el ambiente aeroterrestre los seres vivos toman el oxígeno del aire.' },
          { id: 'agua', text: 'Los seres vivos toman el oxígeno disuelto en el agua.', bin: 'ac', explain: 'En el ambiente acuático el oxígeno está disuelto en el agua.' }
        ]
      },
      {
        id: 'M1A7', type: 'tokens', title: 'Pista 2: cazadores y planeadores', cont: 'L_ADJ',
        consigna: 'Tocá los adjetivos calificativos que describen las adaptaciones de cada animal.',
        tasks: [
          { id: 'puma', words: 'El puma tiene garras afiladas y un pelaje pardo.', prompt: 'El puma:', answers: [4, 8], explain: '«afiladas» y «pardo» dicen cómo son las garras y el pelaje del puma.' },
          { id: 'condor', words: 'El cóndor tiene alas enormes y una vista aguda.', prompt: 'El cóndor:', answers: [4, 8], explain: '«enormes» y «aguda» dicen cómo son las alas y la vista del cóndor.' }
        ]
      },
      {
        id: 'M1A8', type: 'match', title: '¿Para qué le sirve?', cont: 'N_ADAP',
        consigna: 'Uní cada adaptación con la función que cumple para sobrevivir.',
        pairs: [
          { id: 'alas', left: 'Alas enormes del cóndor', right: 'Planear largas distancias aprovechando el viento', explain: 'Las alas enormes le permiten al cóndor planear casi sin aletear.' },
          { id: 'garras', left: 'Garras afiladas del puma', right: 'Atrapar y sujetar a sus presas', explain: 'El puma es cazador: sus garras le sirven para atrapar presas.' },
          { id: 'pelaje', left: 'Pelaje grueso del guanaco', right: 'Protegerse del frío de la montaña', explain: 'El pelaje grueso abriga al guanaco en la cordillera.' },
          { id: 'orejas', left: 'Orejas grandes del zorro', right: 'Escuchar sonidos lejanos para encontrar alimento', explain: 'Las orejas grandes le permiten al zorro oír muy bien.' },
          { id: 'aletas', left: 'Aletas del pejerrey', right: 'Desplazarse dentro del agua', explain: 'Las aletas son una adaptación para nadar en el ambiente acuático.' }
        ]
      }
    ]
  },

  /* ---------------------------------------------------------------- M2 */
  {
    id: 'M2', num: 2, icon: '🔬', scene: 'laboratorio',
    title: 'El cuerpo humano en acción', short: 'Cuerpo en acción',
    badge: { name: 'Investigador del cuerpo', icon: '🦴' },
    pills: ['Artículos y pronombres personales', 'Aparato locomotor'],
    story: 'Bienvenido al laboratorio de investigación del cuerpo humano. Los científicos necesitan ayuda: las etiquetas de huesos, articulaciones y músculos se mezclaron. Con tus conocimientos de Lengua y de Naturales vas a ordenar todo… ¡y a ganar la segunda pieza del mapa!',
    activities: [
      {
        id: 'M2A1', type: 'fill', title: 'Etiquetas del laboratorio', cont: 'L_ART',
        consigna: 'Completá cada oración con el artículo definido correcto.',
        rows: [
          { id: 'costillas', text: '___ costillas protegen órganos como los pulmones y el corazón.', options: ['El', 'La', 'Los', 'Las'], answer: 3, explain: '«costillas» es femenino y plural: va con «las».' },
          { id: 'femur', text: '___ fémur es el hueso más largo del cuerpo.', options: ['El', 'La', 'Los', 'Las'], answer: 0, explain: '«fémur» es masculino y singular: va con «el».' },
          { id: 'rodilla', text: '___ rodilla es la articulación que une el fémur con la tibia.', options: ['El', 'La', 'Los', 'Las'], answer: 1, explain: '«rodilla» es femenino y singular: va con «la».' },
          { id: 'musculos', text: '___ músculos se contraen para mover los huesos.', options: ['El', 'La', 'Los', 'Las'], answer: 2, explain: '«músculos» es masculino y plural: va con «los».' }
        ]
      },
      {
        id: 'M2A2', type: 'classify', title: '¿Definido o indefinido?', cont: 'L_ART',
        consigna: 'Clasificá los artículos.',
        bins: [{ id: 'd', label: 'Artículo definido' }, { id: 'i', label: 'Artículo indefinido' }],
        cards: [
          { id: 'el', text: 'el', bin: 'd', explain: '«el» es definido: habla de algo conocido o determinado.' },
          { id: 'las', text: 'las', bin: 'd', explain: '«las» es definido (femenino plural).' },
          { id: 'los', text: 'los', bin: 'd', explain: '«los» es definido (masculino plural).' },
          { id: 'un', text: 'un', bin: 'i', explain: '«un» es indefinido: habla de algo no determinado.' },
          { id: 'una', text: 'una', bin: 'i', explain: '«una» es indefinido (femenino singular).' },
          { id: 'unos', text: 'unos', bin: 'i', explain: '«unos» es indefinido (masculino plural).' }
        ]
      },
      {
        id: 'M2A3', type: 'fill', title: 'Reemplazos en el laboratorio', cont: 'L_PRON',
        consigna: 'Reemplazá las palabras resaltadas por el pronombre personal correspondiente.',
        rows: [
          { id: 'tomas', original: '«Tomás» flexiona la rodilla.', text: '___ flexiona la rodilla.', options: ['Él', 'Ella', 'Nosotros', 'Ellos'], answer: 0, explain: '«Tomás» es una sola persona, masculino: se reemplaza por «él».' },
          { id: 'sofia', original: '«Sofía» estira los brazos.', text: '___ estira los brazos.', options: ['Él', 'Ella', 'Ellas', 'Ustedes'], answer: 1, explain: '«Sofía» es una sola persona, femenino: se reemplaza por «ella».' },
          { id: 'martina', original: '«Martina y Lucas» saltan la soga.', text: '___ saltan la soga.', options: ['Ellas', 'Ellos', 'Nosotros', 'Él'], answer: 1, explain: 'Cuando en el grupo hay al menos un varón, usamos «ellos».' },
          { id: 'nenas', original: '«Las nenas del equipo» corren en el patio.', text: '___ corren en el patio.', options: ['Ellos', 'Ellas', 'Ella', 'Nosotras'], answer: 1, explain: '«Las nenas» son varias y femenino: se reemplaza por «ellas».' },
          { id: 'juan', original: '«Juan y yo» cuidamos nuestra postura.', text: '___ cuidamos nuestra postura.', options: ['Ellos', 'Ustedes', 'Nosotros', 'Yo'], answer: 2, explain: '«Juan y yo» incluye a quien habla: se reemplaza por «nosotros».' }
        ]
      },
      {
        id: 'M2A4', type: 'hotspot', title: 'El esqueleto del laboratorio', cont: 'N_EST',
        consigna: 'Elegí una etiqueta y después tocá la parte del esqueleto que corresponde.',
        zones: [
          { id: 'craneo', label: 'cráneo', explain: 'El cráneo está en la cabeza y protege el cerebro.' },
          { id: 'costillas', label: 'costillas', explain: 'Las costillas forman una caja que protege los pulmones y el corazón.' },
          { id: 'columna', label: 'columna vertebral', explain: 'La columna vertebral es el eje del cuerpo: va por el centro de la espalda.' },
          { id: 'codo', label: 'codo', explain: 'El codo es la articulación que está en la mitad del brazo.' },
          { id: 'femur', label: 'fémur', explain: 'El fémur es el hueso del muslo, entre la cadera y la rodilla.' },
          { id: 'rodilla', label: 'rodilla', explain: 'La rodilla es la articulación entre el fémur y la tibia.' }
        ]
      },
      {
        id: 'M2A5', type: 'classify', title: '¿Hueso, articulación, músculo o ligamento?', cont: 'N_EST',
        consigna: 'Clasificá cada estructura del aparato locomotor.',
        bins: [{ id: 'h', label: 'Hueso' }, { id: 'a', label: 'Articulación' }, { id: 'm', label: 'Músculo' }, { id: 'l', label: 'Ligamento' }],
        cards: [
          { id: 'femur', text: 'fémur', bin: 'h', explain: 'El fémur es un hueso: el más largo del cuerpo.' },
          { id: 'craneo', text: 'cráneo', bin: 'h', explain: 'El cráneo es un hueso de la cabeza.' },
          { id: 'codo', text: 'codo', bin: 'a', explain: 'El codo es una articulación: allí se unen los huesos del brazo y del antebrazo.' },
          { id: 'hombro', text: 'hombro', bin: 'a', explain: 'El hombro es una articulación: une el brazo con el tronco.' },
          { id: 'biceps', text: 'bíceps', bin: 'm', explain: 'El bíceps es un músculo del brazo.' },
          { id: 'gemelos', text: 'gemelos', bin: 'm', explain: 'Los gemelos son músculos de la pantorrilla.' },
          { id: 'lig', text: 'ligamentos del tobillo', bin: 'l', explain: 'Los ligamentos son cintas resistentes que mantienen unidos los huesos.' }
        ]
      },
      {
        id: 'M2A6', type: 'match', title: '¿Qué función cumple?', cont: 'N_FUN',
        consigna: 'Uní cada estructura con su función.',
        pairs: [
          { id: 'huesos', left: 'Huesos', right: 'Sostienen el cuerpo y protegen órganos', explain: 'Los huesos forman el esqueleto: sostienen y protegen.' },
          { id: 'artic', left: 'Articulaciones', right: 'Son las uniones entre huesos que permiten el movimiento', explain: 'Las articulaciones son los puntos donde se unen dos o más huesos.' },
          { id: 'ligam', left: 'Ligamentos', right: 'Mantienen unidos los huesos en las articulaciones', explain: 'Los ligamentos son como cintas que sujetan los huesos.' },
          { id: 'musc', left: 'Músculos', right: 'Al contraerse y relajarse, mueven los huesos', explain: 'Los músculos tiran de los huesos para producir el movimiento.' }
        ]
      },
      {
        id: 'M2A7', type: 'table', title: 'Fichas del investigador',
        consigna: 'Completá la ficha de cada palabra: artículo definido, género y número, y tipo de estructura.',
        columns: [
          { key: 'art', label: 'Artículo definido', options: ['el', 'la', 'los', 'las'], cont: 'L_ART' },
          { key: 'gn', label: 'Género y número', options: GN, cont: 'L_GN' },
          { key: 'est', label: 'Tipo de estructura', options: ['hueso', 'articulación', 'ligamento', 'músculo'], cont: 'N_EST' }
        ],
        rows: [
          { id: 'craneo', word: 'cráneo', art: 'el', gn: 'masculino singular', est: 'hueso' },
          { id: 'rodilla', word: 'rodilla', art: 'la', gn: 'femenino singular', est: 'articulación' },
          { id: 'costillas', word: 'costillas', art: 'las', gn: 'femenino plural', est: 'hueso' },
          { id: 'ligamentos', word: 'ligamentos', art: 'los', gn: 'masculino plural', est: 'ligamento' }
        ]
      },
      {
        id: 'M2A8', type: 'quiz', title: 'Situaciones del día a día', cont: 'N_PREV',
        consigna: 'Leé cada situación y elegí la mejor manera de cuidar el aparato locomotor.',
        questions: [
          { id: 'hockey', q: 'Lucía va a jugar un partido de hockey. ¿Qué le conviene hacer antes?', options: ['Hacer una entrada en calor y estirar los músculos', 'Empezar a correr fuerte enseguida, sin preparar el cuerpo', 'Quedarse sentada hasta que empiece el partido'], answer: 0, explain: 'La entrada en calor prepara músculos y articulaciones y ayuda a prevenir lesiones.' },
          { id: 'mochila', q: 'Mateo lleva una mochila muy pesada colgada de un solo hombro. ¿Qué le aconsejás?', options: ['Usar las dos tiras y llevar solo lo necesario', 'Cambiarla al otro hombro', 'Seguir así, porque la columna no se ve afectada'], answer: 0, explain: 'Repartir el peso en los dos hombros y no cargar de más cuida la columna vertebral.' },
          { id: 'bici', q: 'Al andar en bicicleta, ¿qué elemento protege el cráneo?', options: ['El casco', 'Las rodilleras', 'Las zapatillas'], answer: 0, explain: 'El casco protege la cabeza y el cráneo en caso de caídas.' }
        ]
      }
    ]
  },

  /* ---------------------------------------------------------------- M3 */
  {
    id: 'M3', num: 3, icon: '🌎', scene: 'tierra',
    title: 'La Tierra: un imán gigante', short: 'Un imán gigante',
    badge: { name: 'Maestro del magnetismo', icon: '🧲' },
    pills: ['Análisis de oraciones', 'Fenómenos magnéticos y electrostáticos'],
    story: '¡Atención, explorador! Las brújulas del equipo se comportan de manera misteriosa y algunos globos se quedan pegados a las paredes del campamento. Vas a investigar fuerzas invisibles y a convertirte en detective de oraciones para ganar la tercera pieza del mapa.',
    activities: [
      {
        id: 'M3A1', type: 'tf', title: 'Fuerzas invisibles', cont: 'N_MAG',
        consigna: 'Leé cada afirmación y decidí si es verdadera o falsa.',
        statements: [
          { id: 'iman', s: 'La Tierra se comporta como un imán gigante.', answer: true, explain: 'La Tierra tiene propiedades magnéticas, como un enorme imán.' },
          { id: 'aguja', s: 'La aguja de la brújula es un pequeño imán.', answer: true, explain: 'La aguja está imantada: es un pequeño imán que puede girar.' },
          { id: 'sigue', s: 'La aguja de la brújula siempre señala hacia donde camina el explorador.', answer: false, explain: 'La aguja no sigue al explorador: siempre se orienta hacia el norte.' },
          { id: 'polos', s: 'Dos polos iguales de dos imanes se atraen.', answer: false, explain: 'Los polos iguales se rechazan; los polos distintos se atraen.' },
          { id: 'hierro', s: 'Un imán atrae objetos de hierro, como un clip.', answer: true, explain: 'Los imanes atraen objetos de hierro, como clips, clavos o tornillos.' },
          { id: 'madera', s: 'Un imán atrae la madera y el plástico.', answer: false, explain: 'La madera y el plástico no son atraídos por los imanes.' }
        ]
      },
      {
        id: 'M3A2', type: 'order', title: 'Armamos una brújula casera', cont: 'N_MAG',
        consigna: 'Ordená los pasos del experimento. Arrastrá las tarjetas o usá las flechas.',
        steps: [
          'Frotamos una aguja con un imán, siempre en el mismo sentido.',
          'Pegamos la aguja imantada sobre un trocito de corcho.',
          'Ponemos el corcho a flotar en un plato con agua.',
          'Observamos que la aguja gira y se orienta en dirección norte-sur.'
        ],
        explain: 'Primero se imanta la aguja, después se la apoya sobre el corcho, se la pone a flotar y, por último, se observa cómo se orienta.'
      },
      {
        id: 'M3A3', type: 'quiz', title: 'Perdidos en la montaña', cont: 'N_MAG',
        consigna: 'Resolvé las situaciones con lo que sabés sobre la brújula.',
        questions: [
          { id: 'sur', q: 'La aguja de la brújula señala el norte y el explorador necesita ir hacia el sur. ¿Qué tiene que hacer?', options: ['Caminar en sentido contrario al que señala la aguja', 'Caminar hacia donde señala la aguja', 'Esperar a que la aguja señale el sur'], answer: 0, explain: 'El sur está en sentido opuesto al norte que marca la aguja.' },
          { id: 'porque', q: '¿Por qué la aguja de la brújula se orienta hacia el norte?', options: ['Porque la Tierra se comporta como un imán gigante', 'Porque el viento la empuja', 'Porque la aguja es muy liviana'], answer: 0, explain: 'La aguja imantada se orienta por el magnetismo de la Tierra.' }
        ]
      },
      {
        id: 'M3A4', type: 'syntax', title: 'Detectives de oraciones',
        consigna: 'Decidí si cada oración es bimembre o unimembre. En las bimembres, pintá el sujeto y el predicado y marcá sus núcleos.',
        sentences: [
          { id: 's1', text: 'La aguja de la brújula señala el norte.', type: 'bi', subjEnd: 4, ns: 1, nv: 5 },
          { id: 's2', text: '¡Qué imán tan poderoso!', type: 'uni' },
          { id: 's3', text: 'Los imanes atraen objetos de hierro.', type: 'bi', subjEnd: 1, ns: 1, nv: 2 },
          { id: 's4', text: 'Un experimento con globos y papelitos.', type: 'uni' }
        ]
      },
      {
        id: 'M3A5', type: 'table', title: 'Laboratorio de palabras',
        consigna: 'Analizá cada palabra de la oración: su clase y su género y número.',
        context: 'La aguja imantada señala el norte geográfico.',
        columns: [
          { key: 'clase', label: 'Clase de palabra', options: ['sustantivo', 'adjetivo', 'verbo', 'artículo'], cont: 'L_CLASES' },
          { key: 'gn', label: 'Género y número', options: GN, cont: 'L_GN' }
        ],
        rows: [
          { id: 'la', word: 'La', clase: 'artículo', gn: 'femenino singular' },
          { id: 'aguja', word: 'aguja', clase: 'sustantivo', gn: 'femenino singular' },
          { id: 'imantada', word: 'imantada', clase: 'adjetivo', gn: 'femenino singular' },
          { id: 'el', word: 'el', clase: 'artículo', gn: 'masculino singular' },
          { id: 'norte', word: 'norte', clase: 'sustantivo', gn: 'masculino singular' },
          { id: 'geografico', word: 'geográfico', clase: 'adjetivo', gn: 'masculino singular' }
        ]
      },
      {
        id: 'M3A6', type: 'classify', title: '¿Magnético o electrostático?',
        consigna: 'Clasificá cada situación según el fenómeno que se observa.',
        bins: [{ id: 'm', label: '🧲 Fenómeno magnético' }, { id: 'e', label: '⚡ Fenómeno electrostático' }],
        cards: [
          { id: 'heladera', text: 'Un imán queda pegado a la puerta de la heladera.', bin: 'm', cont: 'N_MAG', explain: 'El imán es atraído por el metal de la heladera: es un fenómeno magnético.' },
          { id: 'brujula', text: 'La aguja de la brújula señala el norte.', bin: 'm', cont: 'N_MAG', explain: 'La brújula funciona por el magnetismo de la Tierra.' },
          { id: 'clips', text: 'Un imán levanta varios clips.', bin: 'm', cont: 'N_MAG', explain: 'El imán atrae el hierro de los clips: es magnetismo.' },
          { id: 'globo', text: 'Un globo frotado con el pelo queda pegado a la pared.', bin: 'e', cont: 'N_ELEC', explain: 'Al frotar el globo, se carga de electricidad estática.' },
          { id: 'peine', text: 'Después de peinarnos, el pelo se levanta y se pega al peine.', bin: 'e', cont: 'N_ELEC', explain: 'El roce del peine carga el pelo de electricidad estática.' },
          { id: 'buzo', text: 'Al sacarnos un buzo de lana se escuchan chasquidos.', bin: 'e', cont: 'N_ELEC', explain: 'Los chasquidos son pequeñas descargas de electricidad estática.' }
        ]
      },
      {
        id: 'M3A7', type: 'quiz', title: 'Experimento del globo', cont: 'N_ELEC',
        consigna: 'Observá el experimento y respondé.',
        context: 'Valentina frota un globo con su pelo y lo acerca a unos papelitos.',
        questions: [
          { id: 'que', q: '¿Qué ocurre con los papelitos?', options: ['Son atraídos por el globo', 'Se mojan', 'No pasa nada, porque el globo no es un imán'], answer: 0, explain: 'El globo frotado atrae los papelitos aunque no sea un imán.' },
          { id: 'por', q: '¿Por qué ocurre?', options: ['Porque al frotarlo, el globo se cargó de electricidad estática', 'Porque el globo tiene un imán adentro', 'Porque la Tierra atrae a los papelitos'], answer: 0, explain: 'El frotamiento carga el globo de electricidad estática: es un fenómeno electrostático.' }
        ]
      },
      {
        id: 'M3A8', type: 'quiz', title: 'Desafío de lectura',
        consigna: 'Leé el texto y respondé.',
        text: {
          title: 'Un imán del tamaño de un planeta',
          paras: [
            'La Tierra se comporta como un imán gigante. Por eso, la aguja de una brújula apunta siempre hacia el norte. Los exploradores usan la brújula para orientarse en la montaña.',
            'En el campamento, Joaquín frotó un globo con su pelo. Luego, el globo atrajo pequeños trozos de papel. ¡Era un fenómeno electrostático!'
          ]
        },
        questions: [
          { id: 'para', q: 'Según el texto, ¿para qué usan la brújula los exploradores?', options: ['Para orientarse en la montaña', 'Para atraer papelitos', 'Para medir la temperatura'], answer: 0, cont: 'L_COMP', explain: 'El texto dice que la usan para orientarse en la montaña.' },
          { id: 'fen', q: '¿Qué fenómeno ocurrió en el campamento?', options: ['Un fenómeno electrostático', 'Un fenómeno magnético', 'Ninguno'], answer: 0, cont: 'N_ELEC', explain: 'El globo frotado atrajo papelitos: es electricidad estática.' },
          { id: 'expl', q: 'En la oración «Los exploradores usan la brújula», ¿qué clase de palabra es «exploradores» y cuál es su género y número?', options: ['Sustantivo, masculino plural', 'Adjetivo, masculino plural', 'Sustantivo, femenino singular', 'Verbo, plural'], answer: 0, cont: 'L_GN', explain: '«exploradores» nombra a personas: es sustantivo, masculino y plural.' },
          { id: 'peq', q: 'En «pequeños trozos de papel», ¿cuál es el adjetivo calificativo?', options: ['pequeños', 'trozos', 'papel'], answer: 0, cont: 'L_ADJ', explain: '«pequeños» dice cómo son los trozos: es un adjetivo calificativo.' }
        ]
      },
      {
        id: 'M3A9', type: 'syntax', title: 'Análisis del texto',
        consigna: 'Analizá esta oración del texto.',
        text: 'M3A8',
        sentences: [
          { id: 's1', text: 'Joaquín frotó un globo con su pelo.', type: 'bi', subjEnd: 0, ns: 0, nv: 1 }
        ]
      }
    ]
  },

  /* ---------------------------------------------------------------- M4 */
  {
    id: 'M4', num: 4, icon: '🔎', scene: 'detectives',
    title: 'Detectives de palabras y naturaleza', short: 'Detectives',
    badge: { name: 'Detective de palabras', icon: '🔎' },
    pills: ['Clasificación avanzada de palabras', 'Animales, cuerpo humano y Tierra'],
    story: 'Encontraste el archivo secreto de los científicos: tres textos de divulgación llenos de pistas. Para abrir el cofre de la cuarta pieza vas a tener que usar todo lo aprendido: sustantivos, adjetivos, numerales, artículos, pronombres… ¡y ciencia!',
    activities: [
      {
        id: 'M4A1', type: 'classify', title: '¿Cómo es o de dónde es?',
        consigna: 'Clasificá los adjetivos: ¿dicen cómo es algo o de dónde es?',
        bins: [{ id: 'c', label: 'Adjetivo calificativo' }, { id: 'g', label: 'Adjetivo gentilicio' }],
        cards: [
          { id: 'mendocino', text: 'mendocino', bin: 'g', cont: 'L_GENT', explain: '«mendocino» indica el lugar de origen (Mendoza): es gentilicio.' },
          { id: 'argentino', text: 'argentino', bin: 'g', cont: 'L_GENT', explain: '«argentino» indica el lugar de origen (Argentina): es gentilicio.' },
          { id: 'chileno', text: 'chileno', bin: 'g', cont: 'L_GENT', explain: '«chileno» indica el lugar de origen (Chile): es gentilicio.' },
          { id: 'rocoso', text: 'rocoso', bin: 'c', cont: 'L_ADJ', explain: '«rocoso» dice cómo es algo: es calificativo.' },
          { id: 'veloz', text: 'veloz', bin: 'c', cont: 'L_ADJ', explain: '«veloz» dice cómo es algo: es calificativo.' },
          { id: 'abrigado', text: 'abrigado', bin: 'c', cont: 'L_ADJ', explain: '«abrigado» dice cómo es algo: es calificativo.' }
        ]
      },
      {
        id: 'M4A2', type: 'classify', title: 'Los numerales', cont: 'L_NUM',
        consigna: 'Clasificá cada numeral: ¿indica cantidad, orden o una parte?',
        bins: [{ id: 'c', label: 'Cardinal (cantidad)' }, { id: 'o', label: 'Ordinal (orden)' }, { id: 'p', label: 'Partitivo (parte)' }],
        cards: [
          { id: 'uno', text: 'uno', bin: 'c', explain: '«uno» indica una cantidad exacta: es cardinal.' },
          { id: 'dos', text: 'dos', bin: 'c', explain: '«dos» indica una cantidad exacta: es cardinal.' },
          { id: 'cuatro', text: 'cuatro', bin: 'c', explain: '«cuatro» indica una cantidad exacta: es cardinal.' },
          { id: 'diez', text: 'diez', bin: 'c', explain: '«diez» indica una cantidad exacta: es cardinal.' },
          { id: 'primero', text: 'primero', bin: 'o', explain: '«primero» indica un lugar en un orden: es ordinal.' },
          { id: 'segundo', text: 'segundo', bin: 'o', explain: '«segundo» indica un lugar en un orden: es ordinal.' },
          { id: 'tercero', text: 'tercero', bin: 'o', explain: '«tercero» indica un lugar en un orden: es ordinal.' },
          { id: 'mitad', text: 'mitad', bin: 'p', explain: '«mitad» indica una parte de un todo: es partitivo.' },
          { id: 'tercio', text: 'tercio', bin: 'p', explain: '«tercio» indica una parte de un todo: es partitivo.' }
        ]
      },
      {
        id: 'M4A3', type: 'quiz', title: 'La misma palabra, distinto trabajo', cont: 'L_NUM', fixed: true,
        consigna: 'Leé cada oración y decidí qué tipo de numeral es la palabra resaltada.',
        questions: [
          { id: 'lugar', q: 'Nuestro grupo terminó la carrera de orientación en «cuarto» lugar.', options: ['Numeral cardinal', 'Numeral ordinal', 'Numeral partitivo'], answer: 1, explain: 'Acá «cuarto» indica una posición en un orden: es ordinal.' },
          { id: 'torta', q: 'Los exploradores comieron un «cuarto» de la torta.', options: ['Numeral cardinal', 'Numeral ordinal', 'Numeral partitivo'], answer: 2, explain: 'Acá «cuarto» indica una parte de un todo: es partitivo.' },
          { id: 'guanacos', q: 'En la ladera vimos «cuatro» guanacos.', options: ['Numeral cardinal', 'Numeral ordinal', 'Numeral partitivo'], answer: 0, explain: '«cuatro» indica una cantidad exacta: es cardinal.' }
        ]
      },
      {
        id: 'M4A4', type: 'quiz', title: 'Texto 1: el gigante de los Andes', fixed: true,
        consigna: 'Leé el texto y analizá las palabras resaltadas.',
        text: {
          title: 'El gigante de los Andes',
          paras: ['El cóndor andino es una de las aves voladoras más grandes del mundo. Sus dos alas enormes le permiten planear durante horas sobre la cordillera mendocina. Una bandada de cóndores puede recorrer muchos kilómetros en un solo día.']
        },
        questions: [
          { id: 'dos', q: '¿Qué tipo de palabra es «dos»?', options: ['Numeral cardinal', 'Numeral ordinal', 'Adjetivo gentilicio', 'Adjetivo calificativo'], answer: 0, cont: 'L_NUM', explain: '«dos» indica cantidad exacta: es numeral cardinal.' },
          { id: 'mendocina', q: '¿Qué tipo de palabra es «mendocina»?', options: ['Numeral cardinal', 'Numeral ordinal', 'Adjetivo gentilicio', 'Adjetivo calificativo'], answer: 2, cont: 'L_GENT', explain: '«mendocina» indica de dónde es la cordillera: es gentilicio.' },
          { id: 'enormes', q: '¿Qué tipo de palabra es «enormes»?', options: ['Numeral cardinal', 'Numeral ordinal', 'Adjetivo gentilicio', 'Adjetivo calificativo'], answer: 3, cont: 'L_ADJ', explain: '«enormes» dice cómo son las alas: es calificativo.' },
          { id: 'bandada', q: '¿Qué tipo de sustantivo es «bandada»?', options: ['Sustantivo propio', 'Sustantivo común colectivo', 'Sustantivo común individual', 'Sustantivo abstracto'], answer: 1, cont: 'L_COLEC', explain: '«bandada» nombra un conjunto de aves: es común y colectivo.' },
          { id: 'planear', q: 'Según el texto, ¿qué le permite al cóndor planear durante horas?', options: ['Sus alas enormes', 'Su pico curvo', 'Sus patas fuertes', 'Su vista aguda'], answer: 0, cont: 'N_ADAP', explain: 'Las alas enormes son la adaptación que le permite planear.' }
        ]
      },
      {
        id: 'M4A5', type: 'quiz', title: 'Texto 2: un esqueleto lleno de sorpresas', fixed: true,
        consigna: 'Leé el texto y respondé.',
        text: {
          title: 'Un esqueleto lleno de sorpresas',
          paras: ['El cuerpo humano adulto tiene más de doscientos huesos. ¡Más de la mitad de ellos están en las manos y en los pies! Los músculos trabajan junto con los huesos y las articulaciones para que podamos movernos.']
        },
        questions: [
          { id: 'doscientos', q: '¿Qué tipo de numeral es «doscientos»?', options: ['Numeral cardinal', 'Numeral ordinal', 'Numeral partitivo'], answer: 0, cont: 'L_NUM', explain: '«doscientos» indica cantidad: es cardinal.' },
          { id: 'mitad', q: '¿Qué tipo de numeral es «mitad»?', options: ['Numeral cardinal', 'Numeral ordinal', 'Numeral partitivo'], answer: 2, cont: 'L_NUM', explain: '«mitad» indica una parte de un todo: es partitivo.' },
          { id: 'ellos', q: 'En el texto, ¿a qué palabra reemplaza el pronombre «ellos»?', options: ['huesos', 'pies', 'músculos', 'manos'], answer: 0, cont: 'L_PRON', explain: '«ellos» reemplaza a «huesos»: más de la mitad de los huesos están en manos y pies.' },
          { id: 'las', q: '¿Cómo se analiza «las» en «las manos»?', options: ['Artículo definido, femenino plural', 'Artículo indefinido, femenino plural', 'Artículo definido, masculino plural', 'Pronombre personal'], answer: 0, cont: 'L_ART', explain: '«las» es artículo definido, femenino y plural, como «manos».' },
          { id: 'mover', q: 'Según el texto, ¿qué trabaja junto con los huesos para que podamos movernos?', options: ['Los músculos y las articulaciones', 'Los pulmones y el corazón', 'Solamente la piel'], answer: 0, cont: 'N_FUN', explain: 'Huesos, articulaciones y músculos forman el aparato locomotor.' }
        ]
      },
      {
        id: 'M4A6', type: 'quiz', title: 'Texto 3: un planeta con brújula incluida', fixed: true,
        consigna: 'Leé el texto y respondé.',
        text: {
          title: 'Un planeta con brújula incluida',
          paras: ['La Tierra es el tercer planeta del sistema solar y funciona como un imán gigante. Un explorador argentino llevó su brújula a la montaña. Ella señaló el norte y así el explorador encontró el camino.']
        },
        questions: [
          { id: 'tercer', q: '¿Qué tipo de palabra es «tercer»?', options: ['Numeral cardinal', 'Numeral ordinal', 'Numeral partitivo', 'Adjetivo gentilicio'], answer: 1, cont: 'L_NUM', explain: '«tercer» indica el lugar en un orden: es ordinal.' },
          { id: 'argentino', q: '¿Qué tipo de palabra es «argentino»?', options: ['Adjetivo calificativo', 'Adjetivo gentilicio', 'Sustantivo propio', 'Numeral ordinal'], answer: 1, cont: 'L_GENT', explain: '«argentino» indica de dónde es el explorador: es gentilicio.' },
          { id: 'ella', q: 'El pronombre «Ella» reemplaza a…', options: ['la brújula', 'la Tierra', 'la montaña', 'el explorador'], answer: 0, cont: 'L_PRON', explain: 'La que señaló el norte fue la brújula.' },
          { id: 'norte', q: '¿Por qué la brújula pudo señalar el norte?', options: ['Porque la Tierra funciona como un imán gigante', 'Porque la montaña estaba al norte', 'Porque el explorador la giró'], answer: 0, cont: 'N_MAG', explain: 'El magnetismo de la Tierra orienta la aguja de la brújula.' }
        ]
      },
      {
        id: 'M4A7', type: 'syntax', title: 'Análisis del texto 3',
        consigna: 'Analizá estas oraciones del texto 3.',
        text: 'M4A6',
        sentences: [
          { id: 's1', text: 'Un explorador argentino llevó su brújula a la montaña.', type: 'bi', subjEnd: 2, ns: 1, nv: 3 },
          { id: 's2', text: 'Ella señaló el norte.', type: 'bi', subjEnd: 0, ns: 0, nv: 1 }
        ]
      },
      {
        id: 'M4A8', type: 'table', title: 'Fichero de sustantivos', cont: 'L_PROP',
        consigna: 'Clasificá cada sustantivo de dos maneras.',
        columns: [
          { key: 'pc', label: '¿Propio o común?', options: ['propio', 'común'], cont: 'L_PROP' },
          { key: 'ca', label: '¿Concreto o abstracto?', options: ['concreto', 'abstracto'], cont: 'L_CONC' }
        ],
        rows: [
          { id: 'aconcagua', word: 'Aconcagua', pc: 'propio', ca: 'concreto' },
          { id: 'cardumen', word: 'cardumen', pc: 'común', ca: 'concreto' },
          { id: 'curiosidad', word: 'curiosidad', pc: 'común', ca: 'abstracto' },
          { id: 'amistad', word: 'amistad', pc: 'común', ca: 'abstracto' }
        ]
      }
    ]
  }
];

/* =========================================================================
   5. ILUSTRACIONES (SVG propias, sin archivos externos)
   ========================================================================= */
/* ---------- Biblioteca de ilustraciones con volumen (SVG propio) ----------
   Cada dibujo recibe un prefijo único (p) para sus degradados y sombras, así
   varias ilustraciones pueden convivir en la página sin pisarse. */
let ART_N = 0;
const artId = () => 'a' + (++ART_N) + '_';
const G = (p, id) => `url(#${p}${id})`;
function artDefs(p) {
  const lg = (id, a, b, c, dir = 'x1="0" y1="0" x2="0" y2="1"') => `<linearGradient id="${p}${id}" ${dir}><stop offset="0" stop-color="${a}"/>${c ? `<stop offset=".55" stop-color="${b}"/><stop offset="1" stop-color="${c}"/>` : `<stop offset="1" stop-color="${b}"/>`}</linearGradient>`;
  const rg = (id, a, b, c, cx = '.35', cy = '.3') => `<radialGradient id="${p}${id}" cx="${cx}" cy="${cy}" r=".75"><stop offset="0" stop-color="${a}"/>${c ? `<stop offset=".6" stop-color="${b}"/><stop offset="1" stop-color="${c}"/>` : `<stop offset="1" stop-color="${b}"/>`}</radialGradient>`;
  return `<defs>
    <filter id="${p}sh" x="-40%" y="-40%" width="180%" height="190%"><feDropShadow dx="0" dy="7" stdDeviation="6" flood-color="#1e2541" flood-opacity=".28"/></filter>
    <filter id="${p}shs" x="-40%" y="-40%" width="180%" height="190%"><feDropShadow dx="0" dy="3" stdDeviation="2.5" flood-color="#1e2541" flood-opacity=".25"/></filter>
    <filter id="${p}blur"><feGaussianBlur stdDeviation="10"/></filter>
    ${lg('sky', '#60c3f5', '#bfe8fb', '#eaf8ff')}
    ${lg('mL', '#a597d6', '#7c6bb6')}${lg('mD', '#5b4a92', '#3f3170')}
    ${lg('mLb', '#c7c4ec', '#a9a6dc')}${lg('mDb', '#9590cd', '#7b76b8')}
    ${lg('snow', '#ffffff', '#dbeafe')}
    ${lg('grass', '#8be36a', '#3fb24a', '#228b3b')}${lg('grass2', '#5fcf5b', '#1f9a45', '#166d33')}
    ${lg('water', '#8ff0ff', '#22b8e0', '#0a7fb0')}
    ${rg('sun', '#fffbe0', '#fde047', '#f59e0b')}
    ${rg('gold', '#fff6c4', '#fbbf24', '#b45309')}
    ${rg('ball', '#ffffff', '#e8e4f8', '#b9b3dd')}
    ${rg('face', '#fffef8', '#fbf1d2', '#e8d29a', '.5', '.4')}
    ${lg('wood', '#c98a4b', '#9b6230', '#6e411c')}${lg('woodTop', '#e0a868', '#c48545')}
    ${rg('skin', '#ffe3c6', '#f6c39a', '#e0a072')}
    ${lg('khaki', '#e9c98a', '#c79a52', '#9c7232')}${lg('khakiD', '#c79a52', '#8a6128')}
    ${lg('teal', '#5eead4', '#14b8a6', '#0f766e')}
    ${lg('red', '#fb8a8a', '#e23b3b', '#a51d1d', 'x1="0" y1="0" x2="1" y2="1"')}
    ${lg('blue', '#93c5fd', '#3b82f6', '#1e40af', 'x1="0" y1="0" x2="1" y2="1"')}
    ${lg('metal', '#ffffff', '#cbd5e1', '#64748b', 'x1="0" y1="0" x2="1" y2="1"')}
    ${lg('fur', '#f1cf9c', '#d39d5e', '#a8703a')}${lg('furD', '#c58c4e', '#8a5a2b')}
    ${lg('grey', '#e2e8f0', '#94a3b8', '#56657a')}
    ${lg('dark', '#5b6478', '#2b3142', '#151924')}
    ${lg('ivory', '#fffdf6', '#f3e8cf', '#d9c59b')}
    ${lg('fish', '#c8f5ff', '#5fb7d4', '#2f6f8c')}
    ${rg('ocean', '#a7e3ff', '#3b82f6', '#1e3a8a')}
    ${rg('shade', 'rgba(0,0,0,0)', 'rgba(0,0,0,0)', 'rgba(10,20,60,.45)', '.4', '.35')}
    ${lg('glass', 'rgba(255,255,255,.75)', 'rgba(210,240,255,.35)')}
    ${lg('space', '#3b2f8f', '#1f1a5a', '#0c0a2a')}
    ${lg('lab', '#e8f6ff', '#c9e9fb')}${lg('floor', '#d7dee9', '#a9b4c6')}
    ${lg('study', '#fff4d6', '#fbe0a1')}
    ${lg('purple', '#c4b5fd', '#8b5cf6', '#5b21b6', 'x1="0" y1="0" x2="1" y2="1"')}
    ${lg('green', '#a7f3d0', '#10b981', '#047857', 'x1="0" y1="0" x2="1" y2="1"')}
    ${lg('orange', '#fed7aa', '#fb923c', '#c2410c', 'x1="0" y1="0" x2="1" y2="1"')}
    ${lg('paper', '#fffaf0', '#f3e3bf')}
    ${lg('sand', '#fde68a', '#f4c96b')}
  </defs>`;
}
const starPts = (cx, cy, R, r, n = 5) => Array.from({ length: n * 2 }, (_, i) => { const a = Math.PI / n * i - Math.PI / 2, d = i % 2 ? r : R; return `${(cx + Math.cos(a) * d).toFixed(1)},${(cy + Math.sin(a) * d).toFixed(1)}`; }).join(' ');

function aMountains(p, peaks, base, light = 'mL', dark = 'mD', snow = true) {
  return peaks.map(([x, y, w]) => {
    const h = base - y, s = x + w * 0.12;
    return `<path d="M${x - w} ${base} L${x} ${y} L${s} ${base}Z" fill="${G(p, light)}"/>
      <path d="M${x} ${y} L${x + w} ${base} L${s} ${base}Z" fill="${G(p, dark)}"/>
      ${snow ? `<path d="M${x} ${y} L${x - w * 0.27} ${y + h * 0.27} L${x - w * 0.12} ${y + h * 0.22} L${x - w * 0.02} ${y + h * 0.31} L${x + w * 0.1} ${y + h * 0.21} L${x + w * 0.27} ${y + h * 0.27}Z" fill="${G(p, 'snow')}"/>
      <path d="M${x} ${y} L${x + w * 0.27} ${y + h * 0.27} L${x + w * 0.1} ${y + h * 0.21}Z" fill="#c7d6f5"/>` : ''}`;
  }).join('');
}
const aCloud = (x, y, s = 1) => `<g class="cloud"><g transform="translate(${x} ${y}) scale(${s})" opacity=".96">
  <ellipse cx="0" cy="10" rx="48" ry="13" fill="#d4e6f7"/>
  <circle cx="-22" cy="0" r="18" fill="#fff"/><circle cx="2" cy="-10" r="24" fill="#fff"/><circle cx="26" cy="2" r="17" fill="#fff"/>
  <ellipse cx="0" cy="8" rx="46" ry="11" fill="#fff"/></g></g>`;
const aBush = (p, x, y, s = 1) => `<g transform="translate(${x} ${y}) scale(${s})">
  <ellipse cx="0" cy="4" rx="26" ry="6" fill="#14532d" opacity=".25"/>
  <circle cx="-12" cy="-8" r="13" fill="${G(p, 'grass2')}"/><circle cx="10" cy="-9" r="14" fill="${G(p, 'grass2')}"/><circle cx="0" cy="-17" r="14" fill="${G(p, 'grass')}"/>
  <circle cx="-4" cy="-22" r="4" fill="#fff" opacity=".35"/></g>`;
const aStar = (p, x, y, R, cls = '') => `<polygon class="${cls}" points="${starPts(x, y, R, R * 0.45)}" fill="${G(p, 'gold')}" stroke="#b45309" stroke-width="${R * 0.08}" stroke-linejoin="round"/>`;

function aCondor(p, x, y, s = 1) {
  return `<g class="bird"><g transform="translate(${x} ${y}) scale(${s})" filter="url(#${p}shs)">
    <g><path d="M0 0 C-28 -20 -72 -26 -118 -10 C-104 -6 -96 0 -86 2 C-96 6 -100 10 -104 16 C-76 10 -54 12 -36 14 C-22 10 -10 7 0 6Z" fill="${G(p, 'dark')}"/>
       <path d="M-30 -6 C-50 -12 -70 -12 -88 -6 C-70 -4 -52 -1 -34 2Z" fill="#e5e7eb" opacity=".9"/></g>
    <g transform="scale(-1 1)"><path d="M0 0 C-28 -20 -72 -26 -118 -10 C-104 -6 -96 0 -86 2 C-96 6 -100 10 -104 16 C-76 10 -54 12 -36 14 C-22 10 -10 7 0 6Z" fill="${G(p, 'dark')}"/>
       <path d="M-30 -6 C-50 -12 -70 -12 -88 -6 C-70 -4 -52 -1 -34 2Z" fill="#e5e7eb" opacity=".9"/></g>
    <ellipse cx="0" cy="8" rx="15" ry="11" fill="${G(p, 'dark')}"/>
    <ellipse cx="0" cy="-3" rx="9" ry="5.5" fill="#fff"/>
    <circle cx="0" cy="-11" r="6.5" fill="#d79a8c"/><circle cx="-2" cy="-13" r="2" fill="#fff" opacity=".6"/>
    <path d="M-2 -8 L0 -2 L2 -8Z" fill="#4b5563"/></g></g>`;
}
function aGuanaco(p, x, y, s = 1) {
  return `<g transform="translate(${x} ${y}) scale(${s})" filter="url(#${p}shs)">
    <ellipse cx="4" cy="50" rx="44" ry="7" fill="#1e2541" opacity=".18"/>
    <rect x="22" y="10" width="8" height="40" rx="4" fill="${G(p, 'furD')}"/><rect x="-14" y="10" width="8" height="40" rx="4" fill="${G(p, 'furD')}"/>
    <rect x="32" y="10" width="8" height="40" rx="4" fill="${G(p, 'fur')}"/><rect x="-24" y="10" width="8" height="40" rx="4" fill="${G(p, 'fur')}"/>
    <ellipse cx="8" cy="4" rx="38" ry="20" fill="${G(p, 'fur')}"/>
    <ellipse cx="6" cy="15" rx="28" ry="8" fill="#fbf0dd"/>
    <ellipse cx="45" cy="-2" rx="7" ry="5" fill="${G(p, 'furD')}"/>
    <path d="M-30 2 L-17 -4 L-26 -52 L-40 -48Z" fill="${G(p, 'fur')}"/>
    <path d="M-30 2 L-24 0 L-34 -48 L-40 -47Z" fill="#fbf0dd"/>
    <ellipse cx="-40" cy="-56" rx="14" ry="8.5" transform="rotate(-14 -40 -56)" fill="${G(p, 'fur')}"/>
    <ellipse cx="-51" cy="-53" rx="6.5" ry="5.5" fill="#6b5a4c"/>
    <ellipse cx="-31" cy="-67" rx="3" ry="7" transform="rotate(-12 -31 -67)" fill="${G(p, 'furD')}"/><ellipse cx="-36" cy="-67" rx="3" ry="7" transform="rotate(-22 -36 -67)" fill="${G(p, 'fur')}"/>
    <circle cx="-42" cy="-58" r="2.4" fill="#1f1b18"/><circle cx="-42.8" cy="-58.8" r=".8" fill="#fff"/>
    <ellipse cx="0" cy="-8" rx="22" ry="5" fill="#fff" opacity=".25"/>
    ${[-24, -14, 22, 32].map(lx => `<rect x="${lx}" y="45" width="8" height="5" rx="2" fill="#3b2a1d"/>`).join('')}</g>`;
}
function aFox(p, x, y, s = 1) {
  return `<g transform="translate(${x} ${y}) scale(${s})" filter="url(#${p}shs)">
    <ellipse cx="4" cy="26" rx="34" ry="6" fill="#1e2541" opacity=".18"/>
    <path d="M14 18 C40 20 52 4 46 -14 C58 0 58 22 34 28 C26 30 16 26 14 18Z" fill="${G(p, 'grey')}"/>
    <path d="M46 -14 C52 -8 54 0 52 6 C48 2 46 -6 46 -14Z" fill="#fff"/>
    <ellipse cx="0" cy="6" rx="18" ry="22" fill="${G(p, 'grey')}"/>
    <ellipse cx="-3" cy="8" rx="9" ry="14" fill="#f8fafc"/>
    <rect x="-12" y="16" width="7" height="12" rx="3" fill="#c88a55"/><rect x="2" y="16" width="7" height="12" rx="3" fill="#c88a55"/>
    <path d="M-16 -30 L-12 -46 L-3 -32Z M6 -32 L14 -46 L16 -28Z" fill="${G(p, 'grey')}"/>
    <path d="M-13 -32 L-11 -41 L-6 -33Z M8 -32 L13 -41 L14 -30Z" fill="#3f4656"/>
    <ellipse cx="0" cy="-22" rx="17" ry="13" fill="${G(p, 'grey')}"/>
    <path d="M-6 -20 L-24 -14 L-6 -10Z" fill="#e2e8f0"/><circle cx="-23" cy="-14.5" r="2.6" fill="#111827"/>
    <ellipse cx="2" cy="-18" rx="9" ry="6" fill="#c88a55" opacity=".55"/>
    <circle cx="-6" cy="-25" r="2.6" fill="#111827"/><circle cx="-6.8" cy="-25.8" r=".9" fill="#fff"/></g>`;
}
function aFish(p, x, y, s = 1, rot = 0) {
  return `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})" filter="url(#${p}shs)">
    <path d="M26 0 L46 -14 L42 0 L46 14Z" fill="#5fa4bf"/>
    <ellipse cx="0" cy="0" rx="30" ry="13" fill="${G(p, 'fish')}"/>
    <path d="M-20 2 C-6 5 10 5 24 1" stroke="#f9a8d4" stroke-width="4" fill="none" stroke-linecap="round"/>
    <path d="M-6 -12 L6 -22 L12 -11Z" fill="#5fa4bf"/>
    ${[[-4, -5], [6, -6], [14, -3], [2, 6]].map(([a, b]) => `<circle cx="${a}" cy="${b}" r="1.6" fill="#2f5d70"/>`).join('')}
    <circle cx="-19" cy="-3" r="3.4" fill="#fff"/><circle cx="-19.5" cy="-3" r="1.8" fill="#0f172a"/>
    <ellipse cx="-4" cy="-7" rx="14" ry="3" fill="#fff" opacity=".45"/></g>`;
}
function aCompass(p, x, y, r, cls = '') {
  const t = Array.from({ length: 16 }, (_, i) => { const a = i * Math.PI / 8, r1 = r * (i % 4 ? .66 : .6), r2 = r * .72; return `<line x1="${(Math.cos(a) * r1).toFixed(1)}" y1="${(Math.sin(a) * r1).toFixed(1)}" x2="${(Math.cos(a) * r2).toFixed(1)}" y2="${(Math.sin(a) * r2).toFixed(1)}" stroke="#9a7b3c" stroke-width="${i % 4 ? 1.5 : 3}"/>`; }).join('');
  return `<g transform="translate(${x} ${y})" filter="url(#${p}sh)">
    <circle r="${r}" fill="${G(p, 'gold')}"/><circle r="${r * 0.88}" fill="#9a6a1c"/>
    <circle r="${r * 0.84}" fill="${G(p, 'face')}"/>${t}
    <text y="${-r * 0.42}" text-anchor="middle" font-size="${r * 0.26}" font-weight="900" fill="#c2410c" font-family="Baloo 2, sans-serif">N</text>
    <text y="${r * 0.56}" text-anchor="middle" font-size="${r * 0.2}" font-weight="800" fill="#6b5a3a" font-family="Baloo 2, sans-serif">S</text>
    <g class="${cls}"><polygon points="0,${-r * 0.7} ${r * 0.13},0 ${-r * 0.13},0" fill="#ef4444"/><polygon points="0,${-r * 0.7} 0,0 ${-r * 0.13},0" fill="#b91c1c"/>
    <polygon points="0,${r * 0.7} ${r * 0.13},0 ${-r * 0.13},0" fill="#64748b"/><polygon points="0,${r * 0.7} 0,0 ${r * 0.13},0" fill="#334155"/></g>
    <circle r="${r * 0.11}" fill="${G(p, 'gold')}" stroke="#8a5a12" stroke-width="1.5"/>
    <path d="M${-r * 0.62} ${-r * 0.2} A${r * 0.66} ${r * 0.66} 0 0 1 ${r * 0.1} ${-r * 0.66}" stroke="#fff" stroke-width="${r * 0.08}" fill="none" opacity=".55" stroke-linecap="round"/></g>`;
}
function aGlobe(p, x, y, r) {
  const c = p + 'gc';
  return `<g transform="translate(${x} ${y})">
    <ellipse cx="0" cy="${r * 1.15}" rx="${r * 0.8}" ry="${r * 0.12}" fill="#000" opacity=".25" filter="url(#${p}blur)"/>
    <clipPath id="${c}"><circle r="${r}"/></clipPath>
    <circle r="${r}" fill="${G(p, 'ocean')}"/>
    <g clip-path="url(#${c})">
      <path d="M${-r * .7} ${-r * .55} C${-r * .3} ${-r * .9} ${r * .1} ${-r * .6} ${-r * .05} ${-r * .25} C${-r * .2} 0 ${-r * .55} ${-r * .05} ${-r * .5} ${r * .3} C${-r * .6} ${r * .45} ${-r * 1} ${r * .2} ${-r * .9} ${-r * .2}Z" fill="${G(p, 'grass')}"/>
      <path d="M${r * .2} ${r * .05} C${r * .55} ${-r * .1} ${r * .8} ${r * .2} ${r * .6} ${r * .55} C${r * .45} ${r * .8} ${r * .15} ${r * .75} ${r * .25} ${r * .45}Z" fill="${G(p, 'grass2')}"/>
      <path d="M${r * .25} ${-r * .75} C${r * .5} ${-r * .8} ${r * .8} ${-r * .55} ${r * .55} ${-r * .38} C${r * .4} ${-r * .3} ${r * .2} ${-r * .5} ${r * .25} ${-r * .75}Z" fill="${G(p, 'grass')}"/>
      <ellipse cx="0" cy="${-r * .98}" rx="${r * .5}" ry="${r * .16}" fill="#fff"/><ellipse cx="0" cy="${r * .98}" rx="${r * .55}" ry="${r * .16}" fill="#fff"/>
    </g>
    <circle r="${r}" fill="${G(p, 'shade')}"/>
    <ellipse cx="${-r * .38}" cy="${-r * .42}" rx="${r * .32}" ry="${r * .2}" transform="rotate(-30 ${-r * .38} ${-r * .42})" fill="#fff" opacity=".45"/></g>`;
}
function aMagnet(p, x, y, s = 1, rot = 0) {
  return `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})" filter="url(#${p}sh)">
    <path d="M-30 -36 L-30 8 A30 30 0 0 0 30 8 L30 -36" stroke="${G(p, 'red')}" stroke-width="26" fill="none"/>
    <path d="M-36 -36 L-36 8 A36 36 0 0 0 -8 43" stroke="#fff" stroke-width="5" fill="none" opacity=".4" stroke-linecap="round"/>
    <rect x="-43" y="-60" width="26" height="24" rx="3" fill="${G(p, 'metal')}"/><rect x="17" y="-60" width="26" height="24" rx="3" fill="${G(p, 'metal')}"/>
    <text x="-30" y="-42" text-anchor="middle" font-size="14" font-weight="900" fill="#334155" font-family="Baloo 2, sans-serif">N</text>
    <text x="30" y="-42" text-anchor="middle" font-size="14" font-weight="900" fill="#334155" font-family="Baloo 2, sans-serif">S</text></g>`;
}
function aMagnifier(p, x, y, s = 1, rot = -35) {
  return `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})" filter="url(#${p}sh)">
    <rect x="-8" y="34" width="16" height="58" rx="7" fill="${G(p, 'wood')}"/><rect x="-10" y="30" width="20" height="10" rx="3" fill="${G(p, 'metal')}"/>
    <circle r="36" fill="${G(p, 'glass')}"/><circle r="36" fill="none" stroke="${G(p, 'metal')}" stroke-width="9"/>
    <path d="M-22 -14 A26 26 0 0 1 4 -26" stroke="#fff" stroke-width="6" fill="none" stroke-linecap="round" opacity=".85"/></g>`;
}
function aBone(p, x, y, s = 1, rot = 0) {
  return `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})" filter="url(#${p}sh)">
    <rect x="-50" y="-10" width="100" height="20" rx="9" fill="${G(p, 'ivory')}"/>
    <circle cx="-52" cy="-10" r="14" fill="${G(p, 'ivory')}"/><circle cx="-52" cy="10" r="14" fill="${G(p, 'ivory')}"/>
    <circle cx="52" cy="-10" r="14" fill="${G(p, 'ivory')}"/><circle cx="52" cy="10" r="14" fill="${G(p, 'ivory')}"/>
    <rect x="-40" y="-6" width="80" height="4" rx="2" fill="#fff" opacity=".8"/></g>`;
}
function aFlask(p, x, y, s = 1, color = 'green') {
  return `<g transform="translate(${x} ${y}) scale(${s})" filter="url(#${p}shs)">
    <path d="M-9 -44 L-9 -18 L-30 18 Q-34 28 -24 28 L24 28 Q34 28 30 18 L9 -18 L9 -44Z" fill="${G(p, 'glass')}" stroke="#94a3b8" stroke-width="2.5"/>
    <path d="M-18 0 L18 0 L30 18 Q34 28 24 28 L-24 28 Q-34 28 -30 18Z" fill="${G(p, color)}" opacity=".9"/>
    <circle cx="-6" cy="12" r="3" fill="#fff" opacity=".7"/><circle cx="6" cy="6" r="2" fill="#fff" opacity=".7"/><circle cx="2" cy="18" r="2.5" fill="#fff" opacity=".6"/>
    <rect x="-12" y="-48" width="24" height="6" rx="3" fill="#94a3b8"/>
    <path d="M-5 -38 L-5 -20" stroke="#fff" stroke-width="3" opacity=".8" stroke-linecap="round"/></g>`;
}
function aMicroscope(p, x, y, s = 1) {
  return `<g transform="translate(${x} ${y}) scale(${s})" filter="url(#${p}sh)">
    <ellipse cx="0" cy="2" rx="46" ry="10" fill="#1e2541" opacity=".2"/>
    <rect x="-40" y="-14" width="80" height="16" rx="6" fill="${G(p, 'blue')}"/>
    <path d="M18 -14 C30 -40 30 -70 10 -92" stroke="${G(p, 'blue')}" stroke-width="16" fill="none" stroke-linecap="round"/>
    <rect x="-30" y="-46" width="44" height="8" rx="3" fill="#334155"/>
    <g transform="rotate(-28 -6 -78)"><rect x="-16" y="-120" width="20" height="62" rx="5" fill="${G(p, 'metal')}"/><rect x="-19" y="-128" width="26" height="12" rx="4" fill="#475569"/><rect x="-12" y="-60" width="12" height="12" rx="2" fill="#475569"/></g>
    <circle cx="24" cy="-62" r="7" fill="${G(p, 'metal')}"/>
    <path d="M-34 -10 L34 -10" stroke="#fff" stroke-width="3" opacity=".45" stroke-linecap="round"/></g>`;
}
function aBalloon(p, x, y, s = 1) {
  return `<g transform="translate(${x} ${y}) scale(${s})" filter="url(#${p}sh)">
    <path d="M0 52 C-6 70 8 86 0 110" stroke="#64748b" stroke-width="2" fill="none"/>
    <ellipse cx="0" cy="0" rx="40" ry="48" fill="${G(p, 'red')}"/>
    <path d="M-6 48 L6 48 L3 56 L-3 56Z" fill="#a51d1d"/>
    <ellipse cx="-14" cy="-18" rx="10" ry="16" transform="rotate(20 -14 -18)" fill="#fff" opacity=".5"/></g>
    ${[[-58, 40, '#fde047', 20], [-46, 66, '#a78bfa', -15], [-70, 72, '#34d399', 40], [52, 58, '#60a5fa', 10]].map(([a, b, c, r]) => `<rect x="${x + a * s}" y="${y + b * s}" width="${10 * s}" height="${7 * s}" fill="${c}" transform="rotate(${r} ${x + a * s} ${y + b * s})" class="float-bit"/>`).join('')}`;
}
function aScroll(p, x, y, s = 1) {
  return `<g transform="translate(${x} ${y}) scale(${s})" filter="url(#${p}sh)">
    <rect x="-90" y="-50" width="180" height="100" rx="6" fill="${G(p, 'paper')}"/>
    <rect x="-100" y="-56" width="16" height="112" rx="8" fill="${G(p, 'khaki')}"/><rect x="84" y="-56" width="16" height="112" rx="8" fill="${G(p, 'khaki')}"/>
    <path d="M-70 30 C-40 -20 -10 40 20 -6 S60 -10 66 -30" stroke="#b45309" stroke-width="4" stroke-dasharray="6 7" fill="none" stroke-linecap="round"/>
    <path d="M56 -38 l16 16 M72 -38 l-16 16" stroke="#dc2626" stroke-width="5" stroke-linecap="round"/>
    <path d="M-72 -30 l12 -16 l12 16z M-54 -30 l10 -12 l10 12z" fill="#7c6bb6"/>
    <circle cx="-40" cy="14" r="6" fill="#3fb24a"/><circle cx="-10" cy="22" r="5" fill="#3fb24a"/></g>`;
}
function aBooks(p, x, y, s = 1) {
  const b = (dx, dy, w, h, g) => `<rect x="${dx}" y="${dy}" width="${w}" height="${h}" rx="3" fill="${G(p, g)}"/><rect x="${dx + 3}" y="${dy + 3}" width="${w - 6}" height="3" fill="#fff" opacity=".5"/>`;
  return `<g transform="translate(${x} ${y}) scale(${s})" filter="url(#${p}shs)">${b(-40, -16, 84, 16, 'blue')}${b(-34, -32, 76, 16, 'green')}${b(-44, -48, 80, 16, 'purple')}${b(-36, -64, 72, 16, 'orange')}</g>`;
}
/** Personaje explorador. prop: 'map' | 'magnifier' | 'compass' */
function aExplorer(p, x, y, s = 1, prop = 'map') {
  const propSvg = prop === 'magnifier' ? aMagnifier(p, 40, -132, .42, -20)
    : prop === 'compass' ? aCompass(p, 40, -128, 17)
    : prop === 'none' ? ''
    : `<g transform="translate(38 -128) rotate(-8)"><rect x="-6" y="-22" width="34" height="40" rx="3" fill="${G(p, 'paper')}" stroke="#c79a52" stroke-width="2"/><path d="M-1 8 C6 -6 14 10 22 -10" stroke="#b45309" stroke-width="2.5" stroke-dasharray="3 3" fill="none"/></g>`;
  return `<g transform="translate(${x} ${y}) scale(${s})" class="explorer">
    <ellipse cx="0" cy="0" rx="36" ry="8" fill="#1e2541" opacity=".2"/>
    <rect x="-19" y="-16" width="16" height="16" rx="5" fill="#6b3f1d"/><rect x="3" y="-16" width="16" height="16" rx="5" fill="#6b3f1d"/>
    <rect x="-16" y="-50" width="11" height="38" rx="5" fill="${G(p, 'skin')}"/><rect x="5" y="-50" width="11" height="38" rx="5" fill="${G(p, 'skin')}"/>
    <rect x="-20" y="-74" width="40" height="30" rx="8" fill="${G(p, 'khaki')}"/>
    <rect x="-34" y="-124" width="22" height="52" rx="9" fill="${G(p, 'red')}"/>
    <rect x="-22" y="-126" width="44" height="58" rx="15" fill="${G(p, 'teal')}"/>
    <path d="M-16 -124 L14 -74" stroke="${G(p, 'khakiD')}" stroke-width="6" stroke-linecap="round"/>
    <rect x="4" y="-108" width="12" height="10" rx="2" fill="#0f766e"/>
    <rect x="-30" y="-120" width="11" height="40" rx="5.5" transform="rotate(10 -24 -120)" fill="${G(p, 'skin')}"/>
    <rect x="18" y="-122" width="11" height="34" rx="5.5" transform="rotate(-50 22 -122)" fill="${G(p, 'skin')}"/>
    ${propSvg}
    <rect x="-6" y="-134" width="12" height="10" fill="${G(p, 'skin')}"/>
    <circle cx="0" cy="-150" r="25" fill="${G(p, 'skin')}"/>
    <path d="M-24 -152 C-22 -170 22 -172 24 -152 C14 -160 -12 -162 -24 -152Z" fill="#5b3415"/>
    <ellipse cx="0" cy="-165" rx="38" ry="9" fill="${G(p, 'khakiD')}"/>
    <path d="M-24 -166 C-22 -192 22 -192 24 -166Z" fill="${G(p, 'khaki')}"/>
    <rect x="-24" y="-172" width="48" height="6" rx="2" fill="#dc2626"/>
    <ellipse cx="-8" cy="-182" rx="9" ry="4" fill="#fff" opacity=".35"/>
    <circle cx="-9" cy="-148" r="3.6" fill="#1e2541"/><circle cx="9" cy="-148" r="3.6" fill="#1e2541"/>
    <circle cx="-8" cy="-149.5" r="1.3" fill="#fff"/><circle cx="10" cy="-149.5" r="1.3" fill="#fff"/>
    <ellipse cx="-15" cy="-139" rx="5" ry="3" fill="#fb7185" opacity=".45"/><ellipse cx="15" cy="-139" rx="5" ry="3" fill="#fb7185" opacity=".45"/>
    <path d="M-8 -137 Q0 -130 8 -137" stroke="#7c2d12" stroke-width="2.6" fill="none" stroke-linecap="round"/></g>`;
}
/** Carita del explorador para acompañar las consignas. */
function explorerAvatar() {
  const p = artId();
  return `<svg class="avatar" viewBox="-44 -196 88 88" aria-hidden="true">${artDefs(p)}<circle cx="0" cy="-152" r="42" fill="#fff4d6"/>${aExplorer(p, 0, 0, 1, 'none')}</svg>`;
}

/** Escenas de cada misión (también se usan como fondo de pantalla). */
function sceneSVG(kind, opts = {}) {
  const p = artId();
  const vb = '0 0 600 380';
  const wrap = inner => `<svg viewBox="${vb}" xmlns="${SVG_NS}" role="img" preserveAspectRatio="${opts.slice ? 'xMidYMid slice' : 'xMidYMid meet'}">${artDefs(p)}${inner}</svg>`;
  switch (kind) {
    case 'bienvenida':
    case 'cordillera': {
      const welcome = kind === 'bienvenida';
      return wrap(`<rect width="600" height="380" fill="${G(p, 'sky')}"/>
        <circle cx="500" cy="70" r="70" fill="#fff6b0" opacity=".55" filter="url(#${p}blur)"/><circle cx="500" cy="70" r="36" fill="${G(p, 'sun')}"/>
        ${aCloud(110, 60, .9)}${aCloud(330, 40, .7)}${aCloud(560, 140, .6)}
        ${aMountains(p, [[110, 120, 120], [300, 72, 150], [480, 110, 130]], 270, 'mLb', 'mDb')}
        ${aMountains(p, [[40, 170, 95], [220, 140, 115], [420, 158, 120], [585, 182, 100]], 292)}
        <path d="M0 290 C90 262 180 300 290 284 C400 268 470 300 600 280 L600 380 L0 380Z" fill="${G(p, 'grass')}"/>
        <path d="M0 330 C130 306 240 342 360 326 C460 314 530 334 600 322 L600 380 L0 380Z" fill="${G(p, 'grass2')}"/>
        <path d="M600 300 C540 312 520 330 470 338 C420 346 410 366 380 380 L460 380 C480 362 520 350 560 344 C580 340 590 334 600 332Z" fill="${G(p, 'water')}"/>
        <path d="M590 312 C550 322 530 334 500 340" stroke="#fff" stroke-width="3" fill="none" opacity=".7" stroke-linecap="round"/>
        ${aBush(p, 250, 318, .8)}${aBush(p, 330, 352, .9)}${aBush(p, 560, 300, .6)}
        ${welcome ? `${aCondor(p, 360, 120, .8)}${aCompass(p, 480, 300, 52, 'needle')}${aExplorer(p, 175, 368, 1.12, 'compass')}${aGuanaco(p, 330, 300, .75)}`
          : `${aCondor(p, 330, 100, .85)}${aGuanaco(p, 470, 282, 1.05)}${aFox(p, 360, 330, .95)}${aFish(p, 520, 350, .75, -25)}${aExplorer(p, 110, 362, .95, 'map')}`}`);
    }
    case 'laboratorio':
      return wrap(`<rect width="600" height="380" fill="${G(p, 'lab')}"/>
        <rect x="0" y="0" width="600" height="18" fill="#bae6fd"/>
        <rect x="330" y="22" width="200" height="92" rx="10" fill="#fff" filter="url(#${p}shs)"/><rect x="342" y="32" width="176" height="72" rx="6" fill="#e0f2fe"/>
        ${aBone(p, 430, 60, .5, -10)}<text x="430" y="96" text-anchor="middle" font-family="Baloo 2, sans-serif" font-weight="800" font-size="14" fill="#0369a1">APARATO LOCOMOTOR</text>
        <rect x="40" y="112" width="250" height="14" rx="4" fill="${G(p, 'woodTop')}" filter="url(#${p}shs)"/>
        ${aFlask(p, 80, 82, .65, 'green')}${aFlask(p, 140, 82, .65, 'purple')}${aFlask(p, 200, 82, .65, 'orange')}${aBooks(p, 255, 112, .45)}
        <path d="M0 300 L600 300 L600 380 L0 380Z" fill="${G(p, 'floor')}"/>
        ${[0, 1, 2, 3, 4, 5, 6].map(i => `<line x1="${i * 100}" y1="300" x2="${i * 120 - 60}" y2="380" stroke="#fff" stroke-width="2" opacity=".5"/>`).join('')}
        <path d="M150 230 L590 230 L600 252 L140 252Z" fill="${G(p, 'woodTop')}"/><rect x="140" y="252" width="460" height="26" fill="${G(p, 'wood')}"/>
        <rect x="160" y="278" width="14" height="46" fill="${G(p, 'wood')}"/><rect x="570" y="278" width="14" height="46" fill="${G(p, 'wood')}"/>
        ${aMicroscope(p, 500, 232, .85)}${aBone(p, 300, 214, .85, -8)}${aFlask(p, 555, 216, .7, 'blue')}
        ${aExplorer(p, 92, 362, .95, 'magnifier')}`);
    case 'tierra':
      return wrap(`<rect width="600" height="380" fill="${G(p, 'space')}"/>
        <circle cx="140" cy="90" r="120" fill="#7c3aed" opacity=".25" filter="url(#${p}blur)"/><circle cx="500" cy="300" r="140" fill="#db2777" opacity=".18" filter="url(#${p}blur)"/>
        ${Array.from({ length: 46 }, (_, i) => `<circle class="${i % 5 ? '' : 'twinkle'}" cx="${(i * 97 + 13) % 600}" cy="${(i * 53 + 7) % 380}" r="${i % 4 ? 1.2 : 2.2}" fill="#fff" opacity="${.5 + (i % 3) * .2}"/>`).join('')}
        <ellipse cx="320" cy="180" rx="250" ry="120" fill="none" stroke="#f472b6" stroke-width="2.5" stroke-dasharray="8 9" opacity=".75"/>
        <ellipse cx="320" cy="180" rx="180" ry="86" fill="none" stroke="#a78bfa" stroke-width="2.5" stroke-dasharray="8 9" opacity=".85"/>
        ${aGlobe(p, 320, 180, 96)}
        <text x="320" y="64" text-anchor="middle" fill="#fff" font-weight="900" font-size="24" font-family="Baloo 2, sans-serif">N</text>
        <text x="320" y="312" text-anchor="middle" fill="#fff" font-weight="900" font-size="24" font-family="Baloo 2, sans-serif">S</text>
        <path d="M0 330 C80 310 160 330 220 352 L220 380 L0 380Z" fill="${G(p, 'grey')}"/>
        <ellipse cx="60" cy="350" rx="16" ry="5" fill="#475569" opacity=".5"/><ellipse cx="150" cy="356" rx="10" ry="3" fill="#475569" opacity=".5"/>
        ${aCompass(p, 520, 300, 44, 'needle')}${aMagnet(p, 520, 110, .85, 18)}${aBalloon(p, 150, 120, .75)}
        ${aExplorer(p, 92, 358, .85, 'compass')}`);
    default: // detectives
      return wrap(`<rect width="600" height="380" fill="${G(p, 'study')}"/>
        <rect x="20" y="30" width="150" height="190" rx="8" fill="${G(p, 'wood')}" filter="url(#${p}shs)"/>
        <rect x="30" y="40" width="130" height="80" fill="#5b3415"/><rect x="30" y="128" width="130" height="82" fill="#5b3415"/>
        ${[[34, 'blue'], [52, 'green'], [70, 'purple'], [88, 'orange'], [106, 'red'], [124, 'blue']].map(([bx, g], i) => `<rect x="${bx}" y="${50 + (i % 2) * 6}" width="16" height="${70 - (i % 2) * 6}" rx="2" fill="${G(p, g)}"/>`).join('')}
        ${aFlask(p, 70, 196, .5, 'green')}${aBone(p, 128, 192, .32, 0)}
        <circle cx="470" cy="30" r="110" fill="#fff3a8" opacity=".6" filter="url(#${p}blur)"/>
        <path d="M0 250 L600 236 L600 268 L0 286Z" fill="${G(p, 'woodTop')}"/><path d="M0 286 L600 268 L600 380 L0 380Z" fill="${G(p, 'wood')}"/>
        ${aScroll(p, 290, 236, .95)}${aMagnifier(p, 340, 214, .9, -30)}
        <g filter="url(#${p}shs)"><rect x="140" y="216" width="70" height="46" rx="4" fill="#fff" transform="rotate(-8 175 239)"/><text x="160" y="248" font-family="Baloo 2, sans-serif" font-weight="900" font-size="26" fill="#4338ca" transform="rotate(-8 175 239)">Aa</text></g>
        <path d="M430 236 C440 210 470 204 486 214 C474 222 460 232 430 236Z" fill="${G(p, 'grass')}"/>
        ${aMagnet(p, 230, 296, .45, -20)}
        ${aExplorer(p, 525, 368, 1, 'magnifier')}`);
  }
}
const SCENE_OF = { M1: 'cordillera', M2: 'laboratorio', M3: 'tierra', M4: 'detectives' };

/** Esqueleto con zonas seleccionables (actividad M2A4) */
const SKELETON_ANCHORS = {
  craneo: { x: 188, y: 52, ty: 52 }, costillas: { x: 205, y: 180, ty: 160 }, columna: { x: 157, y: 285, ty: 290 },
  codo: { x: 232, y: 229, ty: 225 }, femur: { x: 183, y: 380, ty: 375 }, rodilla: { x: 190, y: 443, ty: 450 }
};
function skeletonSVG() {
  const dl = (x1, y1, x2, y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#7c6f57" stroke-width="16" stroke-linecap="round"/><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#fbf6e9" stroke-width="10" stroke-linecap="round"/>`;
  const ribs = [152, 170, 188, 206, 224].map(y => `<path d="M100 ${y + 8} Q150 ${y - 10} 200 ${y + 8}"/>`).join('');
  return `<svg class="hs-svg" viewBox="0 0 420 540" xmlns="${SVG_NS}" role="img" aria-label="Esqueleto humano">
    <g>
      ${dl(100, 118, 200, 118)}
      ${dl(98, 124, 83, 216)}${dl(202, 124, 217, 216)}
      ${dl(79, 242, 70, 318)}${dl(221, 242, 230, 318)}
      <circle cx="68" cy="332" r="10" class="bone" style="pointer-events:none"/><circle cx="232" cy="332" r="10" class="bone" style="pointer-events:none"/>
      <path d="M108 300 Q150 282 192 300 L186 334 Q150 352 114 334 Z" class="bone" style="pointer-events:none"/>
      ${dl(123, 458, 121, 512)}${dl(177, 458, 179, 512)}
      <ellipse cx="114" cy="524" rx="15" ry="7" class="bone"/><ellipse cx="186" cy="524" rx="15" ry="7" class="bone"/>
    </g>
    <g class="zone" data-zone="costillas"><ellipse class="bone" cx="150" cy="190" rx="58" ry="62"/><g stroke="#7c6f57" stroke-width="3" fill="none" pointer-events="none">${ribs}</g></g>
    <g class="zone" data-zone="columna"><rect class="bone" x="143" y="110" width="14" height="198" rx="6"/><g stroke="#7c6f57" stroke-width="2" pointer-events="none">${Array.from({ length: 10 }, (_, i) => `<line x1="143" y1="${128 + i * 18}" x2="157" y2="${128 + i * 18}"/>`).join('')}</g></g>
    <g class="zone" data-zone="craneo"><ellipse class="bone" cx="150" cy="58" rx="40" ry="46"/><circle cx="135" cy="54" r="8" fill="#7c6f57"/><circle cx="165" cy="54" r="8" fill="#7c6f57"/><path d="M150 64 l-5 12 h10z" fill="#7c6f57"/><path d="M132 88 h36" stroke="#7c6f57" stroke-width="3"/></g>
    <g class="zone" data-zone="codo"><circle class="bone" cx="81" cy="229" r="14"/><circle class="bone" cx="219" cy="229" r="14"/></g>
    <g class="zone" data-zone="femur"><polygon class="bone" points="117,334 137,334 131,428 116,428"/><polygon class="bone" points="163,334 183,334 184,428 169,428"/></g>
    <g class="zone" data-zone="rodilla"><circle class="bone" cx="124" cy="443" r="15"/><circle class="bone" cx="176" cy="443" r="15"/></g>
    <g id="hs-tags"></g>
  </svg>`;
}

/* =========================================================================
   6. TIPOS DE ACTIVIDAD
   Cada tipo define:
     items(act)  → lista de ítems evaluables {id, cont, prompt, correct, explain}
     render(act, root, ctx) → controlador con:
        collect()      → {idÍtem: {value, correct, raw}}  (value null = sin responder)
        restore(raw)   → vuelve a mostrar respuestas guardadas ({idÍtem: raw})
        lock(ids)      → muestra como bloqueados los ítems ya respondidos
   ctx.locked(id) → el ítem ya fue respondido y no se puede modificar.
   ctx.onChange() → avisa que el alumno cambió algo (se guarda un borrador).
   No hay corrección visible durante el juego: las respuestas se registran y
   se bloquean cuando el alumno sale del desafío.
   ========================================================================= */
const TYPES = {};

/* ---------- Opción múltiple · Verdadero/Falso · Completar ---------- */
TYPES.quiz = {
  items(a) {
    return a.questions.map(q => ({
      id: `${a.id}-${q.id}`, cont: q.cont || a.cont,
      prompt: (q.original ? q.original.replace(/[«»]/g, '') + ' → ' : '') + q.q.replace(/[«»]/g, '"'),
      correct: q.options[q.answer], explain: q.explain
    }));
  },
  render(a, root, ctx) {
    const sel = {}, cards = {};
    a.questions.forEach((q, qi) => {
      const id = `${a.id}-${q.id}`;
      const idx = q.options.map((_, i) => i);
      const order = (a.fixed || q.fixed) ? idx : shuffle(idx, ctx.seed + id);
      const btns = {};
      let blank = null, card;
      const choose = (i, silent) => {
        if (!silent && ctx.locked(id)) return;
        sel[id] = i;
        Object.values(btns).forEach(b => b.classList.remove('sel'));
        if (btns[i]) btns[i].classList.add('sel');
        if (blank) { blank.textContent = q.options[i]; blank.className = 'blank'; }
        if (!silent) ctx.onChange();
      };
      const opts = el('div', { class: a.layout === 'tf' ? 'tf-btns' : 'opts' });
      order.forEach(i => { btns[i] = el('button', { type: 'button', class: 'opt', onclick: () => choose(i) }, q.options[i]); opts.append(btns[i]); });

      if (a.layout === 'tf') {
        card = el('div', { class: 'card tf-row' }, el('p', { html: `<span class="q-num">${qi + 1}</span>${fmt(q.q)}` }), opts);
      } else if (a.layout === 'fill') {
        const html = fmt(q.q).replace('___', '<span class="blank empty">______</span>');
        card = el('div', { class: 'card fill-row' },
          q.original ? el('p', { class: 'original', html: `📝 ${fmt(q.original)}` }) : null,
          el('p', { class: 'sentence', html: `<span class="q-num">${qi + 1}</span>${html}` }), opts);
        blank = $('.blank', card);
      } else {
        card = el('div', { class: 'card' }, el('p', { class: 'q-text', html: `<span class="q-num">${qi + 1}</span>${fmt(q.q)}` }), opts);
      }
      root.append(card);
      cards[id] = { card, q, choose };
    });
    return {
      collect() {
        const r = {};
        for (const [id, c] of Object.entries(cards)) r[id] = sel[id] == null ? { value: null } : { value: c.q.options[sel[id]], correct: sel[id] === c.q.answer, raw: sel[id] };
        return r;
      },
      restore(raw) { for (const [id, v] of Object.entries(raw)) if (cards[id] && v != null) cards[id].choose(v, true); },
      lock(ids) { ids.forEach(id => cards[id] && cards[id].card.classList.add('done-item')); }
    };
  }
};

/* ---------- Clasificar (arrastrar y soltar + tocar y ubicar) ---------- */
TYPES.classify = {
  items(a) {
    return a.cards.map(c => ({
      id: `${a.id}-${c.id}`, cont: c.cont || a.cont, prompt: `Clasificar "${c.text}"`,
      correct: a.bins.find(b => b.id === c.bin).label, explain: c.explain
    }));
  },
  render(a, root, ctx) {
    const place = {}, chips = {}, bins = {};
    let selected = null;
    const binLabel = id => a.bins.find(b => b.id === id).label;
    const bank = el('div', { class: 'bank', 'aria-label': 'Tarjetas para clasificar' });
    const binsWrap = el('div', { class: 'bins', style: `grid-template-columns: repeat(${Math.min(a.bins.length, 5)}, 1fr)` });

    const highlight = on => Object.values(bins).forEach(b => b.box.classList.toggle('target', on));
    const select = id => {
      if (selected) chips[selected].chip.classList.remove('sel');
      if (selected === id) { selected = null; highlight(false); return; }
      selected = id; chips[id].chip.classList.add('sel'); highlight(true);
    };
    const updateBank = () => bank.classList.toggle('empty', !bank.querySelector('.chip'));
    const moveTo = (id, binId, silent) => {
      const ch = chips[id]; if (!ch || !(binId == null || bins[binId])) return;
      ch.chip.classList.remove('sel');
      place[id] = binId || null; (binId ? bins[binId].cards : bank).append(ch.chip);
      selected = null; highlight(false); updateBank();
      if (!silent) ctx.onChange();
    };
    const dropZone = (node, binId) => {
      node.addEventListener('dragover', e => { e.preventDefault(); node.classList.add('over'); });
      node.addEventListener('dragleave', () => node.classList.remove('over'));
      node.addEventListener('drop', e => { e.preventDefault(); node.classList.remove('over'); const id = e.dataTransfer.getData('text/plain'); if (chips[id] && !ctx.locked(id)) moveTo(id, binId); });
      node.addEventListener('click', e => { if (e.target.closest('.chip')) return; if (selected) moveTo(selected, binId); });
    };

    a.bins.forEach((b, i) => {
      const cards = el('div', { class: 'bin-cards' });
      const box = el('div', { class: `bin bin-c${i % 5}` }, el('div', { class: 'bin-title' }, b.label), cards);
      dropZone(box, b.id); bins[b.id] = { box, cards }; binsWrap.append(box);
    });
    dropZone(bank, null);

    shuffle(a.cards, ctx.seed + a.id).forEach(c => {
      const id = `${a.id}-${c.id}`;
      const chip = el('button', { type: 'button', class: 'chip card-word', draggable: 'true' }, c.text);
      chip.addEventListener('click', e => {
        e.stopPropagation();
        // Si hay otra tarjeta elegida y se toca una tarjeta que ya está en un grupo, la elegida va a ese grupo
        if (selected && selected !== id && place[id]) { moveTo(selected, place[id]); return; }
        if (!ctx.locked(id)) select(id);
      });
      chip.addEventListener('dragstart', e => { if (ctx.locked(id)) { e.preventDefault(); return; } e.dataTransfer.setData('text/plain', id); chip.classList.add('dragging'); });
      chip.addEventListener('dragend', () => chip.classList.remove('dragging'));
      chips[id] = { chip, c }; bank.append(chip);
    });
    root.append(bank, binsWrap);

    return {
      collect() {
        const r = {};
        for (const [id, ch] of Object.entries(chips)) r[id] = place[id] ? { value: binLabel(place[id]), correct: place[id] === ch.c.bin, raw: place[id] } : { value: null };
        return r;
      },
      restore(raw) { for (const [id, v] of Object.entries(raw)) if (v) moveTo(id, v, true); },
      lock(ids) { ids.forEach(id => { const ch = chips[id]; if (ch) { ch.chip.classList.add('done-item'); ch.chip.draggable = false; } }); }
    };
  }
};

/* ---------- Unir con flechas ---------- */
TYPES.match = {
  items(a) {
    return a.pairs.map(p => ({ id: `${a.id}-${p.id}`, cont: p.cont || a.cont, prompt: `Unir "${p.left}"`, correct: p.right, explain: p.explain }));
  },
  render(a, root, ctx) {
    const wrap = el('div', { class: 'match' });
    const L = el('div', { class: 'match-col left' }), R = el('div', { class: 'match-col right' });
    const svg = document.createElementNS(SVG_NS, 'svg'); svg.classList.add('match-lines');
    const link = {}, lefts = {}, rights = {};
    let active = null;

    a.pairs.forEach(p => {
      const id = `${a.id}-${p.id}`;
      const n = el('div', { class: 'match-item', role: 'button', tabindex: '0' }, p.left, el('span', { class: 'dot' }));
      const act = () => {
        if (ctx.locked(id)) return;
        if (link[id]) { delete link[id]; ctx.onChange(); }
        active = active === id ? null : id; refresh();
      };
      n.addEventListener('click', act); n.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(); } });
      lefts[id] = { n, p }; L.append(n);
    });
    shuffle(a.pairs, ctx.seed + a.id).forEach(p => {
      const n = el('div', { class: 'match-item', role: 'button', tabindex: '0' }, el('span', { class: 'dot' }), p.right);
      const act = () => {
        if (!active) { toast('Primero tocá una opción de la columna izquierda.'); return; }
        for (const [lid, rp] of Object.entries(link)) {
          if (rp !== p.id) continue;
          if (ctx.locked(lid)) { toast('Esa opción ya quedó unida.'); return; }
          delete link[lid];
        }
        link[active] = p.id; active = null; refresh(); ctx.onChange();
      };
      n.addEventListener('click', act); n.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(); } });
      rights[p.id] = { n, p }; R.append(n);
    });
    wrap.append(L, R, svg); root.append(wrap);

    function refresh() {
      Object.values(lefts).forEach(o => o.n.classList.remove('active', 'linked', 'done-item'));
      Object.values(rights).forEach(o => o.n.classList.remove('linked', 'done-item'));
      if (active) lefts[active].n.classList.add('active');
      for (const [lid, rp] of Object.entries(link)) {
        lefts[lid].n.classList.add('linked'); rights[rp].n.classList.add('linked');
        if (ctx.locked(lid)) { lefts[lid].n.classList.add('done-item'); rights[rp].n.classList.add('done-item'); }
      }
      draw();
    }
    function draw() {
      const box = wrap.getBoundingClientRect(); if (!box.width) return;
      svg.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
      svg.setAttribute('width', box.width); svg.setAttribute('height', box.height);
      svg.innerHTML = '';
      for (const [lid, rp] of Object.entries(link)) {
        const a1 = lefts[lid].n.getBoundingClientRect(), b1 = rights[rp].n.getBoundingClientRect();
        const x1 = a1.right - box.left, y1 = a1.top + a1.height / 2 - box.top, x2 = b1.left - box.left, y2 = b1.top + b1.height / 2 - box.top;
        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('d', `M${x1} ${y1} C${x1 + 45} ${y1}, ${x2 - 45} ${y2}, ${x2} ${y2}`);
        path.setAttribute('stroke', ctx.locked(lid) ? '#8a92ad' : '#7c3aed'); path.setAttribute('stroke-width', '4'); path.setAttribute('fill', 'none');
        path.setAttribute('stroke-linecap', 'round');
        svg.append(path);
      }
    }
    const ro = new ResizeObserver(() => draw()); ro.observe(wrap);
    requestAnimationFrame(draw);

    return {
      collect() {
        const r = {};
        for (const [id, o] of Object.entries(lefts)) r[id] = link[id] ? { value: rights[link[id]].p.right, correct: link[id] === o.p.id, raw: link[id] } : { value: null };
        return r;
      },
      restore(raw) { for (const [id, v] of Object.entries(raw)) if (lefts[id] && rights[v]) link[id] = v; refresh(); },
      lock() { refresh(); }
    };
  }
};

/* ---------- Seleccionar palabras de una oración ---------- */
TYPES.tokens = {
  items(a) {
    return a.tasks.map(t => {
      const w = words(t.words || a.sentence);
      return { id: `${a.id}-${t.id}`, cont: t.cont || a.cont, prompt: `${t.prompt} ${t.words || a.sentence}`, correct: t.answers.map(i => clean(w[i])).join(', '), explain: t.explain };
    });
  },
  render(a, root, ctx) {
    const tasks = {};
    if (a.sentence) root.append(el('div', { class: 'card', html: `<p class="q-text">🔍 ${esc(a.sentence)}</p>` }));
    a.tasks.forEach((t, ti) => {
      const id = `${a.id}-${t.id}`;
      const w = words(t.words || a.sentence);
      const sel = new Set(); const btns = [];
      const box = el('div', { class: 'words' });
      w.forEach((word, i) => {
        const b = el('button', { type: 'button', class: 'word' }, word);
        b.addEventListener('click', () => {
          if (ctx.locked(id)) return;
          sel.has(i) ? sel.delete(i) : sel.add(i);
          b.classList.toggle('sel', sel.has(i)); ctx.onChange();
        });
        btns.push(b); box.append(b);
      });
      const card = el('div', { class: 'card' }, el('p', { class: 'task-prompt', html: `<span class="q-num">${ti + 1}</span>${fmt(t.prompt)}` }), box);
      root.append(card);
      tasks[id] = { t, w, sel, btns, card };
    });
    return {
      collect() {
        const r = {};
        for (const [id, o] of Object.entries(tasks)) {
          if (!o.sel.size) { r[id] = { value: null }; continue; }
          const chosen = [...o.sel].sort((x, y) => x - y);
          const ok = chosen.length === o.t.answers.length && chosen.every(i => o.t.answers.includes(i));
          r[id] = { value: chosen.map(i => clean(o.w[i])).join(', '), correct: ok, raw: chosen };
        }
        return r;
      },
      restore(raw) {
        for (const [id, v] of Object.entries(raw)) {
          const o = tasks[id]; if (!o || !Array.isArray(v)) continue;
          o.sel.clear(); v.forEach(i => o.sel.add(i));
          o.btns.forEach((b, i) => b.classList.toggle('sel', o.sel.has(i)));
        }
      },
      lock(ids) { ids.forEach(id => tasks[id] && tasks[id].card.classList.add('done-item')); }
    };
  }
};

/* ---------- Ordenar secuencias ---------- */
TYPES.order = {
  items(a) { return [{ id: `${a.id}-orden`, cont: a.cont, prompt: a.title, correct: a.steps.join(' → '), explain: a.explain }]; },
  render(a, root, ctx) {
    const id = `${a.id}-orden`;
    let order = shuffle(a.steps.map((_, i) => i), ctx.seed + a.id);
    if (order.every((v, i) => v === i)) order.reverse();
    let touched = false;   // se considera respondida cuando el alumno movió al menos una tarjeta
    const list = el('div', { class: 'order-list' });
    let dragFrom = null;
    const move = (from, to) => {
      if (ctx.locked(id) || to < 0 || to >= order.length || from === to) return;
      const [x] = order.splice(from, 1); order.splice(to, 0, x); touched = true; draw(); ctx.onChange();
    };
    function draw() {
      list.innerHTML = '';
      order.forEach((stepIdx, pos) => {
        const item = el('div', { class: 'order-item', draggable: 'true' },
          el('span', {}, a.steps[stepIdx]),
          el('div', { class: 'arrows' },
            el('button', { type: 'button', 'aria-label': 'Subir', onclick: () => move(pos, pos - 1) }, '▲'),
            el('button', { type: 'button', 'aria-label': 'Bajar', onclick: () => move(pos, pos + 1) }, '▼')));
        item.addEventListener('dragstart', e => { if (ctx.locked(id)) { e.preventDefault(); return; } dragFrom = pos; item.classList.add('dragging'); e.dataTransfer.setData('text/plain', String(pos)); });
        item.addEventListener('dragend', () => item.classList.remove('dragging'));
        item.addEventListener('dragover', e => e.preventDefault());
        item.addEventListener('drop', e => { e.preventDefault(); if (dragFrom != null) move(dragFrom, pos); dragFrom = null; });
        list.append(item);
      });
    }
    draw();
    root.append(el('p', { class: 'hint' }, '👆 Mové las tarjetas hasta que queden en el orden correcto.'), list);
    return {
      collect() { return { [id]: touched ? { value: order.map(i => a.steps[i]).join(' → '), correct: order.every((v, i) => v === i), raw: [...order] } : { value: null } }; },
      restore(raw) { const v = raw[id]; if (Array.isArray(v) && v.length === order.length) { order = [...v]; touched = true; draw(); } },
      lock(ids) { if (ids.includes(id)) list.classList.add('done-item'); }
    };
  }
};

/* ---------- Análisis sintáctico ---------- */
TYPES.syntax = {
  items(a) {
    const out = [];
    a.sentences.forEach(s => {
      const w = words(s.text), base = `${a.id}-${s.id}`;
      out.push({ id: `${base}-tipo`, cont: 'L_ORAC', prompt: `¿Bimembre o unimembre? ${s.text}`, correct: s.type === 'bi' ? 'Bimembre' : 'Unimembre',
        explain: s.type === 'bi' ? `«${s.text}» es bimembre: se puede dividir en sujeto y predicado.` : `«${s.text}» es unimembre: no se puede dividir en sujeto y predicado.` });
      if (s.type === 'bi') {
        const suj = w.slice(0, s.subjEnd + 1).join(' '), pred = clean(w.slice(s.subjEnd + 1).join(' '));
        out.push({ id: `${base}-sp`, cont: 'L_SP', prompt: `Sujeto y predicado: ${s.text}`, correct: `S: ${suj} | P: ${pred}`,
          explain: `El sujeto es «${suj}» (de quién se habla) y el predicado es «${pred}» (lo que se dice del sujeto).` });
        out.push({ id: `${base}-ns`, cont: 'L_NUC', prompt: `Núcleo del sujeto: ${s.text}`, correct: clean(w[s.ns]),
          explain: `El núcleo del sujeto es «${clean(w[s.ns])}», la palabra más importante del sujeto.` });
        out.push({ id: `${base}-nv`, cont: 'L_NUC', prompt: `Núcleo verbal: ${s.text}`, correct: clean(w[s.nv]),
          explain: `El núcleo del predicado es el verbo «${clean(w[s.nv])}».` });
      }
    });
    return out;
  },
  render(a, root, ctx) {
    const sents = {};
    root.append(el('div', { class: 'card', html: '<p class="q-text" style="margin:0">🛠️ <strong>Cómo se usa:</strong> elegí <strong>Bimembre</strong> o <strong>Unimembre</strong>. Si es bimembre, elegí una herramienta y tocá las palabras: <span style="color:#1d4ed8">Sujeto</span>, <span style="color:#c2410c">Predicado</span>, <strong>NS</strong> (núcleo del sujeto) y <strong>NV</strong> (núcleo verbal).</p>' }));
    a.sentences.forEach((s, si) => {
      const base = `${a.id}-${s.id}`;
      const w = words(s.text);
      const st = { type: null, paint: Array(w.length).fill(null), ns: null, nv: null, tool: 'S' };
      const typeBtns = {};
      const setType = (t, silent) => {
        if (!silent && ctx.locked(`${base}-tipo`)) return;
        st.type = t; Object.entries(typeBtns).forEach(([k, b]) => b.classList.toggle('sel', k === t));
        drawWords(); if (!silent) ctx.onChange();
      };
      typeBtns.bi = el('button', { type: 'button', class: 'opt', onclick: () => setType('bi') }, 'Bimembre');
      typeBtns.uni = el('button', { type: 'button', class: 'opt', onclick: () => setType('uni') }, 'Unimembre');
      const typeStep = el('div', { class: 'syn-step' }, el('span', {}, '¿Qué tipo de oración es?'), typeBtns.bi, typeBtns.uni);
      const tools = {};
      const toolDefs = [['S', '🟦 Sujeto', 't-s'], ['P', '🟧 Predicado', 't-p'], ['NS', 'NS', 't-ns'], ['NV', 'NV', 't-nv'], ['X', '🧽 Borrar', '']];
      const toolBar = el('div', { class: 'syn-tools' });
      toolDefs.forEach(([k, label, cls]) => {
        tools[k] = el('button', { type: 'button', class: `tool ${cls}`, onclick: () => { st.tool = k; Object.values(tools).forEach(t => t.classList.remove('active')); tools[k].classList.add('active'); } }, label);
        toolBar.append(tools[k]);
      });
      tools.S.classList.add('active');
      const wordBox = el('div', { class: 'syn-words' });
      const card = el('div', { class: 'card syn-card' },
        el('p', { class: 'syn-sentence' }, `${si + 1}. ${s.text}`),
        typeStep,
        el('div', { class: 'syn-step' }, el('span', {}, 'Herramientas:'), toolBar),
        wordBox);
      const clickWord = i => {
        const t = st.tool;
        if ((t === 'S' || t === 'P') && !ctx.locked(`${base}-sp`)) st.paint[i] = st.paint[i] === t ? null : t;
        else if (t === 'NS' && !ctx.locked(`${base}-ns`)) st.ns = st.ns === i ? null : i;
        else if (t === 'NV' && !ctx.locked(`${base}-nv`)) st.nv = st.nv === i ? null : i;
        else if (t === 'X') {
          if (!ctx.locked(`${base}-sp`)) st.paint[i] = null;
          if (st.ns === i && !ctx.locked(`${base}-ns`)) st.ns = null;
          if (st.nv === i && !ctx.locked(`${base}-nv`)) st.nv = null;
        }
        drawWords(); ctx.onChange();
      };
      function drawWords() {
        wordBox.innerHTML = '';
        wordBox.classList.toggle('disabled', st.type !== 'bi');
        w.forEach((word, i) => {
          const b = el('button', { type: 'button', class: `sw ${st.paint[i] || ''}`, onclick: () => clickWord(i) }, word);
          const isNS = st.ns === i, isNV = st.nv === i;
          if (isNS || isNV) b.append(el('span', { class: `mk ${isNS && isNV ? 'both' : isNS ? 'ns' : 'nv'}` }, isNS && isNV ? 'NS·NV' : isNS ? 'NS' : 'NV'));
          wordBox.append(b);
        });
      }
      drawWords(); root.append(card);
      sents[s.id] = { s, w, st, card, typeStep, base, drawWords, setType };
    });

    return {
      collect() {
        const r = {};
        for (const o of Object.values(sents)) {
          const { s, w, st, base } = o;
          r[`${base}-tipo`] = st.type ? { value: st.type === 'bi' ? 'Bimembre' : 'Unimembre', correct: st.type === s.type, raw: st.type } : { value: null };
          if (s.type !== 'bi') continue;
          if (st.type === 'uni') {
            ['sp', 'ns', 'nv'].forEach(k => { r[`${base}-${k}`] = { value: 'No analizada (eligió unimembre)', correct: false, raw: 'uni' }; });
            continue;
          }
          if (st.type == null || st.paint.some(p => !p)) r[`${base}-sp`] = { value: null };
          else {
            const suj = w.filter((_, i) => st.paint[i] === 'S').join(' '), pred = clean(w.filter((_, i) => st.paint[i] === 'P').join(' '));
            r[`${base}-sp`] = { value: `S: ${suj || '—'} | P: ${pred || '—'}`, correct: st.paint.every((p, i) => p === (i <= s.subjEnd ? 'S' : 'P')), raw: [...st.paint] };
          }
          r[`${base}-ns`] = st.ns == null || st.type == null ? { value: null } : { value: clean(w[st.ns]), correct: st.ns === s.ns, raw: st.ns };
          r[`${base}-nv`] = st.nv == null || st.type == null ? { value: null } : { value: clean(w[st.nv]), correct: st.nv === s.nv, raw: st.nv };
        }
        return r;
      },
      restore(raw) {
        for (const o of Object.values(sents)) {
          const { base, st } = o;
          const t = raw[`${base}-tipo`]; if (t === 'bi' || t === 'uni') st.type = t;
          const sp = raw[`${base}-sp`]; if (Array.isArray(sp) && sp.length === st.paint.length) st.paint = [...sp];
          const ns = raw[`${base}-ns`]; if (Number.isInteger(ns)) st.ns = ns;
          const nv = raw[`${base}-nv`]; if (Number.isInteger(nv)) st.nv = nv;
          if (st.type) o.setType(st.type, true); else o.drawWords();
        }
      },
      lock() {
        for (const o of Object.values(sents)) {
          const ids = ['tipo', 'sp', 'ns', 'nv'].map(k => `${o.base}-${k}`).filter(id => ITEMS_BY_ACT[a.id].some(it => it.id === id));
          if (ctx.locked(`${o.base}-tipo`)) o.typeStep.classList.add('done-item');
          if (ids.every(id => ctx.locked(id))) o.card.classList.add('done-item');
        }
      }
    };
  }
};

/* ---------- Tabla de análisis por palabra ---------- */
TYPES.table = {
  items(a) {
    const out = [];
    a.rows.forEach(r => a.columns.forEach(c => out.push({
      id: `${a.id}-${r.id}-${c.key}`, cont: c.cont || a.cont, prompt: `${c.label}: "${r.word}"`, correct: r[c.key],
      explain: `«${r.word}» → ${c.label.replace(/[¿?]/g, '').toLowerCase()}: ${r[c.key]}.`
    })));
    return out;
  },
  render(a, root, ctx) {
    const selects = {};
    if (a.context) root.append(el('div', { class: 'card', html: `<p class="q-text" style="margin:0">🔍 ${esc(a.context)}</p>` }));
    const thead = el('tr', {}, el('th', {}, 'Palabra'), a.columns.map(c => el('th', {}, c.label)));
    const tbody = el('tbody');
    a.rows.forEach(r => {
      const tr = el('tr', {}, el('td', {}, r.word, r.ctx ? el('span', { class: 'ctx' }, r.ctx) : null));
      a.columns.forEach(c => {
        const id = `${a.id}-${r.id}-${c.key}`;
        const s = el('select', { 'aria-label': `${c.label} de ${r.word}` }, el('option', { value: '' }, 'Elegí…'), c.options.map(o => el('option', { value: o }, o)));
        s.addEventListener('change', () => { if (!ctx.locked(id)) ctx.onChange(); });
        tr.append(el('td', {}, s));
        selects[id] = { s, correct: r[c.key] };
      });
      tbody.append(tr);
    });
    root.append(el('div', { class: 'card' }, el('table', { class: 'tbl' }, el('thead', {}, thead), tbody)));
    return {
      collect() {
        const r = {};
        for (const [id, o] of Object.entries(selects)) r[id] = o.s.value ? { value: o.s.value, correct: o.s.value === o.correct, raw: o.s.value } : { value: null };
        return r;
      },
      restore(raw) { for (const [id, v] of Object.entries(raw)) if (selects[id] && v) selects[id].s.value = v; },
      lock(ids) { ids.forEach(id => { const o = selects[id]; if (o) { o.s.disabled = true; o.s.classList.add('done-item'); } }); }
    };
  }
};

/* ---------- Ilustración con zonas seleccionables (esqueleto) ---------- */
TYPES.hotspot = {
  items(a) { return a.zones.map(z => ({ id: `${a.id}-${z.id}`, cont: a.cont, prompt: `Ubicar en el esqueleto: ${z.label}`, correct: z.label, explain: z.explain })); },
  render(a, root, ctx) {
    const assign = {}, chips = {};
    let chosen = null;
    const zoneLocked = zid => ctx.locked(`${a.id}-${zid}`);
    const labelLocked = lid => Object.entries(assign).some(([zid, l]) => l === lid && zoneLocked(zid));
    const labelsBox = el('div', { class: 'hs-labels' }, el('p', { class: 'task-prompt' }, 'Etiquetas'));
    shuffle(a.zones, ctx.seed + a.id).forEach(z => {
      const chip = el('button', { type: 'button', class: 'chip' }, z.label);
      chip.addEventListener('click', () => {
        if (labelLocked(z.id)) { toast('Esa etiqueta ya quedó ubicada.'); return; }
        if (chosen) chips[chosen].classList.remove('sel');
        chosen = chosen === z.id ? null : z.id; if (chosen) chip.classList.add('sel');
      });
      chips[z.id] = chip; labelsBox.append(chip);
    });
    const svgWrap = el('div', { html: skeletonSVG() });
    root.append(el('div', { class: 'hotspot' }, labelsBox, svgWrap));
    const svg = $('svg', svgWrap), tags = $('#hs-tags', svg);
    const zoneEl = id => $(`.zone[data-zone="${id}"]`, svg);
    const label = id => a.zones.find(z => z.id === id).label;

    $$('.zone', svg).forEach(g => g.addEventListener('click', () => {
      const zid = g.dataset.zone;
      if (zoneLocked(zid)) return;
      if (!chosen) { toast('Primero elegí una etiqueta de la lista.'); return; }
      for (const [k, v] of Object.entries(assign)) if (v === chosen && !zoneLocked(k)) delete assign[k];
      assign[zid] = chosen;
      chips[chosen].classList.remove('sel'); chosen = null; draw(); ctx.onChange();
    }));

    function draw() {
      tags.innerHTML = '';
      Object.values(chips).forEach(c => { c.style.opacity = ''; c.classList.remove('done-item'); });
      a.zones.forEach(z => {
        const an = SKELETON_ANCHORS[z.id], g = zoneEl(z.id);
        const locked = zoneLocked(z.id);
        g.classList.toggle('done', locked);
        if (assign[z.id]) {
          const ch = chips[assign[z.id]];
          if (locked) ch.classList.add('done-item'); else ch.style.opacity = '.45';
          const color = locked ? '#4b5575' : '#4338ca';
          tags.insertAdjacentHTML('beforeend',
            `<line x1="${an.x}" y1="${an.y}" x2="292" y2="${an.ty}" stroke="${color}" stroke-width="2.5"/>
             <circle cx="${an.x}" cy="${an.y}" r="5" fill="${color}"/>
             <text class="zone-tag" x="298" y="${an.ty + 5}" fill="${color}" stroke="#fff" stroke-width="4" paint-order="stroke">${locked ? '🔒 ' : ''}${esc(label(assign[z.id]))}</text>`);
        } else {
          tags.insertAdjacentHTML('beforeend', `<circle cx="${an.x}" cy="${an.y}" r="10" fill="#f5b301" stroke="#fff" stroke-width="2" pointer-events="none"/><text x="${an.x}" y="${an.y + 5}" text-anchor="middle" font-size="13" font-weight="800" fill="#3d2a00" pointer-events="none">?</text>`);
        }
      });
    }
    draw();
    return {
      collect() {
        const r = {};
        a.zones.forEach(z => { const id = `${a.id}-${z.id}`; r[id] = assign[z.id] ? { value: label(assign[z.id]), correct: assign[z.id] === z.id, raw: assign[z.id] } : { value: null }; });
        return r;
      },
      restore(raw) { a.zones.forEach(z => { const v = raw[`${a.id}-${z.id}`]; if (v && chips[v]) assign[z.id] = v; }); draw(); },
      lock() { draw(); }
    };
  }
};

/* ---------- Preparación del banco de actividades ---------- */
function normalize(a) {
  if (a.type === 'tf') {
    a.type = 'quiz'; a.layout = 'tf'; a.fixed = true;
    a.questions = a.statements.map(s => ({ id: s.id, q: s.s, options: ['Verdadero', 'Falso'], answer: s.answer ? 0 : 1, explain: s.explain, cont: s.cont }));
  }
  if (a.type === 'fill') {
    a.type = 'quiz'; a.layout = 'fill'; a.fixed = true;
    a.questions = a.rows.map(r => ({ id: r.id, q: r.text, original: r.original, options: r.options, answer: r.answer, explain: r.explain, cont: r.cont }));
  }
}
const ALL_ITEMS = [];          // todos los ítems evaluables
const ITEMS_BY_ACT = {};       // ítems de cada actividad
const ITEMS_BY_MISSION = {};   // ítems de cada misión
const ACT_BY_ID = {};
MISSIONS.forEach(m => {
  ITEMS_BY_MISSION[m.id] = [];
  m.activities.forEach(a => {
    normalize(a); ACT_BY_ID[a.id] = a;
    const its = TYPES[a.type].items(a).map(it => ({ ...it, mission: m.id, act: a.id, area: CONT[it.cont].area, contLabel: CONT[it.cont].label }));
    ITEMS_BY_ACT[a.id] = its; ITEMS_BY_MISSION[m.id].push(...its); ALL_ITEMS.push(...its);
  });
});
const missionById = id => MISSIONS.find(m => m.id === id);
const missionLabel = m => `Misión ${m.num}: ${m.title}`;
function actArea(a) {
  const areas = new Set(ITEMS_BY_ACT[a.id].map(i => i.area));
  return areas.size > 1 ? 'integra' : (areas.has(LEN) ? 'lengua' : 'naturales');
}
const AREA_LABEL = { lengua: 'Lengua', naturales: 'Ciencias Naturales', integra: 'Lengua + Ciencias Naturales' };

/** Control de calidad automático del banco de actividades (se ejecuta al iniciar). */
function validateContent() {
  const errors = []; const ids = new Set();
  ALL_ITEMS.forEach(it => {
    if (ids.has(it.id)) errors.push(`ID repetido: ${it.id}`); ids.add(it.id);
    if (!CONT[it.cont]) errors.push(`Contenido inexistente en ${it.id}`);
    if (!it.correct) errors.push(`Sin respuesta correcta: ${it.id}`);
    if (!it.explain) errors.push(`Sin explicación: ${it.id}`);
  });
  MISSIONS.forEach(m => m.activities.forEach(a => {
    if (a.type === 'quiz') a.questions.forEach(q => {
      if (q.answer < 0 || q.answer >= q.options.length) errors.push(`Respuesta fuera de rango: ${a.id}-${q.id}`);
      if (new Set(q.options).size !== q.options.length) errors.push(`Opciones repetidas: ${a.id}-${q.id}`);
      if (a.layout === 'fill' && !q.q.includes('___')) errors.push(`Falta el espacio ___: ${a.id}-${q.id}`);
    });
    if (a.type === 'classify') a.cards.forEach(c => { if (!a.bins.some(b => b.id === c.bin)) errors.push(`Grupo inexistente: ${a.id}-${c.id}`); });
    if (a.type === 'classify') a.bins.forEach(b => { if (!a.cards.some(c => c.bin === b.id)) errors.push(`Grupo vacío: ${a.id}-${b.id}`); });
    if (a.type === 'match' && new Set(a.pairs.map(p => p.right)).size !== a.pairs.length) errors.push(`Parejas repetidas: ${a.id}`);
    if (a.type === 'tokens') a.tasks.forEach(t => { const n = words(t.words || a.sentence).length; if (t.answers.some(i => i < 0 || i >= n)) errors.push(`Índice de palabra inválido: ${a.id}-${t.id}`); });
    if (a.type === 'syntax') a.sentences.forEach(s => {
      if (s.type !== 'bi') return; const n = words(s.text).length;
      if (!(s.subjEnd >= 0 && s.subjEnd < n - 1)) errors.push(`Sujeto inválido: ${a.id}-${s.id}`);
      if (!(s.ns <= s.subjEnd)) errors.push(`NS fuera del sujeto: ${a.id}-${s.id}`);
      if (!(s.nv > s.subjEnd && s.nv < n)) errors.push(`NV fuera del predicado: ${a.id}-${s.id}`);
    });
    if (a.type === 'table') a.rows.forEach(r => a.columns.forEach(c => { if (!c.options.includes(r[c.key])) errors.push(`Respuesta no está entre las opciones: ${a.id}-${r.id}-${c.key}`); }));
    if (typeof a.text === 'string' && !ACT_BY_ID[a.text]) errors.push(`Texto de referencia inexistente: ${a.id}`);
  }));
  if (errors.length) console.warn('⚠️ Control de calidad:', errors); else console.info(`✅ Control de calidad: ${ALL_ITEMS.length} ítems verificados en ${MISSIONS.length} misiones.`);
  return errors;
}

/* =========================================================================
   7. ESTADO, GUARDADO LOCAL Y CRONÓMETRO
   Cada alumno tiene su propia partida guardada en el navegador, identificada
   por división + apellido + nombre. Así, si dos alumnos usan la misma compu
   en semanas distintas, cada uno retoma lo suyo.
   ========================================================================= */
let S = null;      // estado de la partida del alumno
let CUR = null;    // actividad en pantalla
const DIVISIONES = { '4A': '4.º A', '4B': '4.º B' };
const normTxt = v => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const studentKey = (div, ap, no) => `${div}|${normTxt(ap)}|${normTxt(no)}`;
const storeName = key => `${CONFIG.STORAGE_PREFIX}${hashStr(key).toString(36)}`;
const fullName = st => `${st.nombre} ${st.apellido}`;

const Store = {
  load(name) { try { return JSON.parse(localStorage.getItem(name)); } catch { return null; } },
  save() { try { if (S) { localStorage.setItem(S.store, JSON.stringify(S)); localStorage.setItem(CONFIG.CURRENT_KEY, S.store); } } catch { /* sin espacio */ } },
  current() { try { const n = localStorage.getItem(CONFIG.CURRENT_KEY); return n ? this.load(n) : null; } catch { return null; } },
  release() { try { localStorage.removeItem(CONFIG.CURRENT_KEY); } catch { /* */ } }
};
function newState(div, apellido, nombre) {
  const key = studentKey(div, apellido, nombre);
  return {
    v: 2, sessionId: uid(), key, store: storeName(key), division: div, apellido, nombre,
    startedAt: new Date().toISOString(), activeMs: 0,
    visited: {}, done: {}, doneAt: {}, items: {}, drafts: {}, cur: null, finished: false, finishedAt: null
  };
}
let lastTick = Date.now();
setInterval(() => {
  const now = Date.now(), delta = now - lastTick; lastTick = now;
  if (S && !S.finished && document.visibilityState === 'visible' && delta < 60000) { S.activeMs += delta; Store.save(); }
}, 5000);

/** Un ítem cuenta como respondido cuando quedó registrado (bloqueado). */
const isDone = id => !!(S.items[id] && S.items[id].locked);
function statsOf(items) {
  let answered = 0, ok = 0, pts = 0;
  items.forEach(it => { const r = S.items[it.id]; if (!r || !r.locked) return; answered++; if (r.ok) ok++; pts += r.pts || 0; });
  const total = items.length;
  return { total, answered, ok, ko: answered - ok, pending: total - answered, pts, pct: total ? Math.round(ok / total * 100) : 0 };
}
const nextMissionIdx = () => { const i = MISSIONS.findIndex(m => !S.done[m.id]); return i < 0 ? MISSIONS.length : i; };
/** Primer desafío con respuestas pendientes (en una misión o en toda la aventura). */
function firstPending(missionId) {
  for (const m of MISSIONS) {
    if (missionId && m.id !== missionId) continue;
    if (!missionId && !S.visited[m.id]) continue;
    const i = m.activities.findIndex(a => ITEMS_BY_ACT[a.id].some(it => !isDone(it.id)));
    if (i >= 0) return { mission: m.id, act: i };
  }
  return null;
}

/* =========================================================================
   8. ENVÍO DE RESULTADOS A GOOGLE SHEETS
   - Cada envío es acumulativo (incluye todo lo realizado), así un envío
     posterior reemplaza a uno anterior que no llegó.
   - La cola se guarda en localStorage: si no hay conexión o se recarga la
     página, los resultados no se pierden y se reintenta automáticamente.
   - El servidor guarda cada alumno en las hojas de SU división y actualiza
     filas existentes (clave única) → sin duplicados al avanzar, retroceder
     o actualizar la página.
   ========================================================================= */
function buildPayload() {
  const visited = MISSIONS.filter(m => S.visited[m.id]);
  const g = statsOf(ALL_ITEMS);
  const now = new Date().toISOString();
  const quien = { division: DIVISIONES[S.division], apellido: S.apellido, nombre: S.nombre };
  const misiones = [];
  visited.forEach(m => {
    [LEN, NAT].forEach(area => {
      const its = ITEMS_BY_MISSION[m.id].filter(i => i.area === area);
      if (!its.length) return;
      const st = statsOf(its);
      misiones.push({
        ...quien, fecha: S.doneAt[m.id] || now, mision: missionLabel(m), area,
        estado: S.done[m.id] ? 'Completada' : 'En curso',
        contenidos: [...new Set(its.map(i => i.contLabel))].join(' · '),
        correctas: st.ok, incorrectas: st.ko, sinResponder: st.pending, puntaje: st.pts, porcentaje: st.pct
      });
    });
  });
  const detalle = [];
  visited.forEach(m => ITEMS_BY_MISSION[m.id].forEach(it => {
    const r = S.items[it.id], done = r && r.locked;
    detalle.push({
      ...quien, mision: missionLabel(m), desafio: ACT_BY_ID[it.act].title, actividad: it.id, area: it.area, contenido: it.contLabel,
      consigna: it.prompt, estado: done ? 'Respondida' : 'Sin responder', respuesta: done ? r.v : '', correcta: it.correct,
      resultado: done ? (r.ok ? 'Correcta' : 'Incorrecta') : 'Sin responder', fecha: done ? r.at : ''
    });
  }));
  return {
    action: 'guardar', sesion: S.sessionId, division: S.division, enviadoEn: Date.now(),
    general: {
      ...quien, puntaje: g.pts, porcentaje: g.pct, correctas: g.ok, incorrectas: g.ko,
      respondidas: g.answered, sinResponder: g.pending,
      misiones: `${MISSIONS.filter(m => S.done[m.id]).length}/${MISSIONS.length}`,
      tiempo: fmtTime(S.activeMs), tiempoSeg: Math.round(S.activeMs / 1000),
      estado: S.finished ? (g.pending ? 'Finalizado con pendientes' : 'Finalizado') : 'En curso',
      nota20: Math.round(g.pct / 5)
    },
    misiones, detalle
  };
}

const Outbox = {
  get() { try { return JSON.parse(localStorage.getItem(CONFIG.OUTBOX_KEY)) || {}; } catch { return {}; } },
  set(o) { try { localStorage.setItem(CONFIG.OUTBOX_KEY, JSON.stringify(o)); } catch { /* */ } },
  put(p) { const o = this.get(); o[p.sesion] = p; this.set(o); updateSyncUI(); flush(); },
  pendingFor(sesion) { return !!this.get()[sesion]; },
  count() { return Object.keys(this.get()).length; }
};
const SYNC = { flushing: false, lastOk: null, lastError: null, timer: null };

/** Envía ya (al terminar misión o aventura). */
function sendNow() { clearTimeout(SYNC.timer); if (S) Outbox.put(buildPayload()); }
/** Envío diferido mientras el alumno navega entre desafíos (agrupa varios cambios en uno). */
function sendSoon() {
  if (!S) return;
  clearTimeout(SYNC.timer);
  SYNC.timer = setTimeout(sendNow, CONFIG.ENVIO_DIFERIDO_MS);
}
// Si se cierra o se oculta la pestaña, se deja el envío en la cola (no se pierde).
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && SYNC.timer && S) sendNow(); });
window.addEventListener('pagehide', () => { if (SYNC.timer && S) { clearTimeout(SYNC.timer); const o = Outbox.get(); const p = buildPayload(); o[p.sesion] = p; Outbox.set(o); } });

async function postJSON(body, timeout = 25000) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    // Sin encabezados personalizados → "solicitud simple" (sin preflight CORS), compatible con Apps Script.
    const res = await fetch(CONFIG.SHEETS_URL, { method: 'POST', body: JSON.stringify(body), signal: ctrl.signal, redirect: 'follow' });
    return await res.json();
  } finally { clearTimeout(t); }
}
async function flush() {
  if (!CONFIG.SHEETS_URL || SYNC.flushing) { updateSyncUI(); return; }
  const queue = Outbox.get(); const keys = Object.keys(queue);
  if (!keys.length) { updateSyncUI(); return; }
  SYNC.flushing = true; updateSyncUI();
  let again = false;
  for (const k of keys) {
    const p = queue[k];
    try {
      const res = await postJSON(p);
      if (!res || !res.ok) throw new Error((res && res.error) || 'Respuesta inesperada del servidor');
      const now = Outbox.get();
      if (now[k] && now[k].enviadoEn === p.enviadoEn) { delete now[k]; Outbox.set(now); } else if (now[k]) again = true;
      SYNC.lastOk = Date.now(); SYNC.lastError = null;
    } catch (e) {
      SYNC.lastError = navigator.onLine ? (e.name === 'AbortError' ? 'El servidor tardó demasiado' : e.message) : 'Sin conexión';
    }
  }
  SYNC.flushing = false; updateSyncUI();
  if (again && !SYNC.lastError) setTimeout(flush, 1500);   // llegó una versión más nueva mientras se enviaba
}
setInterval(flush, CONFIG.REINTENTO_MS);
window.addEventListener('online', flush);

function syncState() {
  if (!CONFIG.SHEETS_URL) return { cls: '', txt: '💾 Guardado en esta compu' };
  if (SYNC.flushing) return { cls: 'wait', txt: '⏳ Guardando resultados…' };
  const pending = S ? Outbox.pendingFor(S.sessionId) : Outbox.count() > 0;
  if (pending) return { cls: 'wait', txt: SYNC.lastError ? '📴 Pendiente: se reintentará' : '⏳ Pendiente de envío' };
  if (SYNC.lastOk) return { cls: 'ok', txt: '☁️ Resultados guardados' };
  return { cls: '', txt: '☁️ Conectado a la planilla' };
}
function updateSyncUI() {
  const st = syncState();
  const h = $('#hud-sync'); if (h) { h.className = `hud-sync ${st.cls}`; h.textContent = st.txt; }
  const f = $('#final-sync');
  if (f) {
    const pending = S && Outbox.pendingFor(S.sessionId);
    if (!CONFIG.SHEETS_URL) { f.className = 'sync-msg wait'; f.textContent = '💾 Tus resultados quedaron guardados en esta compu (la planilla todavía no está configurada).'; }
    else if (pending || SYNC.timer) { f.className = 'sync-msg wait'; f.textContent = '⏳ Tus resultados se enviarán automáticamente apenas haya conexión.'; }
    else { f.className = 'sync-msg ok'; f.textContent = '✅ ¡Tus resultados quedaron registrados!'; }
  }
}

/* =========================================================================
   9. PANTALLAS DEL ALUMNO
   ========================================================================= */
const STUDENT_SCREENS = ['s-mapa', 's-intro', 's-actividad', 's-fin-mision', 's-final'];
let BG_MISSION = null;   // misión cuyo escenario se usa de fondo
function setBackdrop(id) {
  const bd = $('#backdrop'); if (!bd) return;
  const kind = ['s-actividad', 's-intro', 's-fin-mision'].includes(id) && BG_MISSION ? SCENE_OF[BG_MISSION]
    : id === 's-final' ? 'cordillera' : id === 's-docente' ? null : id === 's-bienvenida' ? 'cordillera' : null;
  if (bd.dataset.kind === String(kind)) return;
  bd.dataset.kind = String(kind);
  bd.innerHTML = kind ? sceneSVG(kind, { slice: true }) : '';
  bd.className = `backdrop ${kind ? 'bd-' + kind : ''}`;
}
function show(id) {
  $$('.screen').forEach(s => s.classList.toggle('active', s.id === id));
  setBackdrop(id);
  $('#hud').hidden = !(S && STUDENT_SCREENS.includes(id));
  const sc = $('#' + id); if (sc) sc.scrollTop = 0;
  updateHUD();
}
function updateHUD() {
  if (!S) return;
  const st = statsOf(ALL_ITEMS);
  const prog = Math.round(st.answered / ALL_ITEMS.length * 100);
  $('#hud-explorer').textContent = `${fullName(S)} · ${DIVISIONES[S.division]}`;
  $('#hud-progress-txt').textContent = `${prog}%`;
  $('#hud-progress-bar').style.width = `${prog}%`;
  $('#hud-score').textContent = `${MISSIONS.filter(m => S.done[m.id]).length}/${MISSIONS.length}`;
  $('#hud-badges').innerHTML = MISSIONS.map(m => `<span class="hud-badge ${S.done[m.id] ? 'got' : ''}" title="${esc(m.badge.name)}">${m.badge.icon}</span>`).join('');
  updateSyncUI();
}

/* ---------- Bienvenida e ingreso ---------- */
/** Acepta 4A, 4a, 4B, 4b (también "4 A", "4°A", "4.º B"). Devuelve '4A', '4B' o null. */
function parseDivision(v) {
  const m = String(v || '').toUpperCase().replace(/[\s°º.]/g, '').match(/^4([AB])$/);
  return m ? '4' + m[1] : null;
}
const NAME_RE = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ' -]*$/;
const tidyName = v => String(v || '').trim().replace(/\s+/g, ' ')
  .split(' ').map(w => w.split('-').map(p => p ? p.charAt(0).toLocaleUpperCase('es') + p.slice(1).toLocaleLowerCase('es') : p).join('-')).join(' ');
function fieldError(input, msg) {
  const box = $(`#err-${input.id}`);
  input.classList.toggle('invalid', !!msg);
  input.setAttribute('aria-invalid', msg ? 'true' : 'false');
  if (box) box.textContent = msg || '';
  return !msg;
}
function validateLogin() {
  const d = $('#in-div'), n = $('#in-nombre'), a = $('#in-apellido');
  const div = parseDivision(d.value);
  const nombre = tidyName(n.value), apellido = tidyName(a.value);
  const okD = fieldError(d, !d.value.trim() ? 'Escribí tu grado y división.' : !div ? 'Solo se acepta 4A o 4B.' : '');
  const okN = fieldError(n, !nombre ? 'Escribí tu nombre.' : nombre.length < 2 || !NAME_RE.test(nombre) ? 'Revisá tu nombre: solo letras.' : '');
  const okA = fieldError(a, !apellido ? 'Escribí tu apellido.' : apellido.length < 2 || !NAME_RE.test(apellido) ? 'Revisá tu apellido: solo letras.' : '');
  return okD && okN && okA ? { div, nombre, apellido } : null;
}
function initWelcome() {
  const wa = $('#welcome-art'); if (wa && !wa.innerHTML.trim()) wa.innerHTML = sceneSVG('bienvenida');
  const saved = Store.current();
  const box = $('#resume-box');
  if (saved && saved.v === 2) {
    box.hidden = false;
    $('#resume-name').textContent = `${fullName(saved)} (${DIVISIONES[saved.division]})`;
  } else box.hidden = true;
  $('#btn-resume').onclick = () => { S = Store.current(); if (!S) return; lastTick = Date.now(); S.finished ? renderFinal() : renderMap(); };
  $('#btn-new').onclick = () => { Store.release(); box.hidden = true; $('#in-div').focus(); };
  ['in-div', 'in-nombre', 'in-apellido'].forEach(id => { $('#' + id).oninput = e => { if (e.target.classList.contains('invalid')) fieldError(e.target, ''); }; });
  $('#login-form').onsubmit = e => {
    e.preventDefault();
    const data = validateLogin();
    if (!data) { const bad = $('#login-form .invalid'); if (bad) bad.focus(); toast('Completá los datos que faltan.'); return; }
    const key = studentKey(data.div, data.apellido, data.nombre);
    const prev = Store.load(storeName(key));
    if (prev && prev.v === 2 && prev.key === key) {
      S = prev; toast(`¡Hola de nuevo, ${S.nombre}! Seguís donde quedaste.`);
    } else {
      S = newState(data.div, data.apellido, data.nombre);
      Store.save(); sendNow();   // registra el inicio (aparece como "En curso" en el panel)
    }
    Store.save(); lastTick = Date.now();
    $('#login-form').reset();
    S.finished ? renderFinal() : renderMap();
  };
}

/* ---------- Mapa de misiones ---------- */
const MAP_POS = [[170, 440], [390, 250], [620, 420], [840, 235]];
let MAP_JUST = null;   // misión recién completada (solo en memoria: no se repite al recargar)
function mapArt(p, next) {
  const deco = [
    `${aMountains(p, [[95, 300, 60], [165, 280, 70], [235, 310, 55]], 360)}${aCondor(p, 260, 300, .35)}`,
    `<g transform="translate(100 -12)"><g filter="url(#${p}sh)"><path d="M330 175 L450 175 L450 220 L330 220Z" fill="#e0f2fe"/><path d="M450 175 L472 160 L472 205 L450 220Z" fill="#93c5fd"/><path d="M322 178 L390 140 L458 178Z" fill="${G(p, 'red')}"/><path d="M458 178 L390 140 L412 128 L480 164Z" fill="#a51d1d"/>
      <rect x="350" y="186" width="20" height="18" rx="2" fill="#7dd3fc"/><rect x="410" y="186" width="20" height="18" rx="2" fill="#7dd3fc"/></g>${aFlask(p, 485, 205, .35, 'green')}</g>`,
 `<g transform="translate(140 80)"><g filter="url(#${p}sh)"><rect x="660" y="330" width="80" height="40" fill="#cbd5e1"/><path d="M660 332 A40 40 0 0 1 740 332Z" fill="${G(p, 'metal')}"/><rect x="694" y="296" width="12" height="40" rx="3" transform="rotate(30 700 316)" fill="#475569"/></g></g>${aMagnet(p, 545, 330, .3, -15)}`,
    `<g transform="translate(-150 40)"><g filter="url(#${p}sh)"><path d="M780 150 L900 150 L900 190 L780 190Z" fill="#fde68a"/><path d="M772 152 L840 112 L908 152Z" fill="${G(p, 'purple')}"/><rect x="828" y="160" width="22" height="30" rx="3" fill="#92400e"/></g>${aMagnifier(p, 925, 170, .3, -30)}</g>`
  ];
  const nodes = MISSIONS.map((m, i) => {
    const [x, y] = MAP_POS[i];
    const done = !!S.done[m.id], current = i === next, locked = i > next;
    const pend = done ? statsOf(ITEMS_BY_MISSION[m.id]).pending : 0;
    const ball = done ? 'gold' : current ? 'ball' : 'grey';
    const lw = Math.max(150, `${m.num}. ${m.short}`.length * 10.6 + 40);
    return `<g class="map-node ${locked ? 'locked' : ''} ${current ? 'current' : ''} ${done ? 'done' : ''} ${MAP_JUST === m.id ? 'just' : ''}" data-i="${i}" tabindex="0" role="button" aria-label="${esc(missionLabel(m))}${done ? ' (completada)' : locked ? ' (bloqueada)' : ''}">
      <ellipse cx="${x}" cy="${y + 40}" rx="56" ry="14" fill="#1e2541" opacity=".25"/>
      <path d="M${x - 50} ${y + 22} L${x - 50} ${y + 34} A50 13 0 0 0 ${x + 50} ${y + 34} L${x + 50} ${y + 22}Z" fill="${done ? '#b45309' : '#8c7a5b'}"/>
      <ellipse cx="${x}" cy="${y + 22}" rx="50" ry="13" fill="${done ? '#fcd34d' : '#d8c9a3'}"/>
      <g class="node-ring"><circle cx="${x}" cy="${y - 6}" r="42" fill="${G(p, ball)}" stroke="${done ? '#b45309' : current ? '#7c3aed' : '#94a3b8'}" stroke-width="5"/>
      <ellipse cx="${x - 13}" cy="${y - 24}" rx="14" ry="8" fill="#fff" opacity=".55"/>
      <text x="${x}" y="${y + 8}" font-size="38" text-anchor="middle">${locked ? '🔒' : m.icon}</text></g>
      ${done ? `<g class="done-stamp"><circle cx="${x + 34}" cy="${y - 38}" r="16" fill="${G(p, 'green')}" stroke="#fff" stroke-width="3"/><path d="M${x + 26} ${y - 38} l6 6 l11 -12" stroke="#fff" stroke-width="4.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>
        <g><line x1="${x - 36}" y1="${y - 30}" x2="${x - 36}" y2="${y - 78}" stroke="#5b3415" stroke-width="4"/><path d="M${x - 34} ${y - 78} L${x - 4} ${y - 70} L${x - 34} ${y - 60}Z" fill="#dc2626"/></g>` : ''}
      ${pend ? `<g><rect x="${x - 30}" y="${y - 84}" width="60" height="24" rx="12" fill="#fff7d6" stroke="#f59e0b" stroke-width="2"/><text x="${x}" y="${y - 67}" font-size="15" text-anchor="middle" fill="#b45309">⏳ ${pend}</text></g>` : ''}
      <g><rect x="${x - lw / 2}" y="${y + 52}" width="${lw}" height="32" rx="16" fill="${done ? '#fff7d6' : '#fff'}" stroke="${done ? '#f59e0b' : '#d6cdb5'}" stroke-width="2.5" filter="url(#${p}shs)"/>
      <text x="${x}" y="${y + 74}" font-size="18" text-anchor="middle" fill="#2b2140">${m.num}. ${esc(m.short)}</text></g>
      ${current ? `<g class="marker">${aExplorer(p, x + 4, y - 52, .38, 'map')}</g>` : ''}
      ${locked ? `<g opacity=".9">${aCloud(x - 10, y - 4, 1.05)}${aCloud(x + 30, y + 14, .8)}</g>` : ''}
    </g>`;
  }).join('');
  const route = 'M170 440 C 240 340, 300 280, 390 250 S 540 400, 620 420 S 760 280, 840 235';
  return `<svg class="map-svg" viewBox="0 0 1000 600" preserveAspectRatio="xMidYMid meet" xmlns="${SVG_NS}" role="img" aria-label="Mapa de misiones">
    ${artDefs(p)}
    <rect width="1000" height="600" fill="${G(p, 'water')}"/>
    ${Array.from({ length: 14 }, (_, i) => `<path class="wave" d="M${(i * 137) % 980} ${30 + (i * 71) % 560} q10 -7 20 0 t20 0" stroke="#fff" stroke-width="3" fill="none" opacity=".55" stroke-linecap="round"/>`).join('')}
    <path d="M70 330 C60 200 180 120 330 110 C470 100 560 140 700 120 C850 100 960 170 950 290 C940 420 880 520 720 530 C560 540 450 560 300 540 C150 520 80 450 70 330Z" transform="translate(0 22)" fill="#9a6a2f"/>
    <path d="M70 330 C60 200 180 120 330 110 C470 100 560 140 700 120 C850 100 960 170 950 290 C940 420 880 520 720 530 C560 540 450 560 300 540 C150 520 80 450 70 330Z" fill="${G(p, 'sand')}"/>
    <path d="M100 330 C95 220 200 150 330 140 C470 130 560 165 700 150 C830 136 925 190 918 290 C910 400 860 490 720 500 C560 510 450 528 300 512 C170 498 108 440 100 330Z" fill="${G(p, 'grass')}"/>
    <path d="M140 300 C200 260 210 200 250 160" stroke="${G(p, 'water')}" stroke-width="12" fill="none" stroke-linecap="round" opacity=".9"/>
    ${[[300, 470], [520, 300], [700, 470], [760, 330], [470, 470], [250, 210], [560, 190], [880, 380]].map(([a, b], i) => aBush(p, a, b, .7 + (i % 3) * .1)).join('')}
    ${deco.join('')}
    <path d="${route}" stroke="#fff" stroke-width="14" fill="none" stroke-linecap="round" opacity=".85"/>
    <path d="${route}" stroke="#8b5e34" stroke-width="6" fill="none" stroke-dasharray="2 14" stroke-linecap="round"/>
    ${aCompass(p, 935, 525, 46)}
    ${aCloud(90, 70, .9)}${aCloud(560, 60, .7)}
    ${nodes}
  </svg>`;
}
function renderMap() {
  const root = $('#s-mapa'); root.innerHTML = '';
  const next = nextMissionIdx();
  const p = artId();
  const svg = mapArt(p, next);
  const pieces = MISSIONS.map(m => `<div class="piece ${S.done[m.id] ? 'got' : ''} ${MAP_JUST === m.id ? 'just' : ''}" title="${esc(m.badge.name)}">${S.done[m.id] ? m.badge.icon : '🧩'}</div>`).join('');
  const list = MISSIONS.map((m, i) => {
    const done = !!S.done[m.id];
    const stt = statsOf(ITEMS_BY_MISSION[m.id]);
    const pend = done && stt.pending ? `<span class="pend" title="Respuestas sin responder">⏳ ${stt.pending}</span>` : '';
    return `<div class="mission-item ${i > next ? 'locked' : ''} ${i === next ? 'current' : ''} ${done ? 'done' : ''}"><span class="mi-icon">${i > next ? '🔒' : m.icon}</span><span>${m.num}. ${esc(m.short)}</span>${pend}<span class="mi-check">${done ? '✔' : ''}</span></div>`;
  }).join('');
  const all = next >= MISSIONS.length;
  const cta = all
    ? el('button', { class: 'btn btn-gold', type: 'button', onclick: () => renderFinal() }, '🏆 Ver el final del recorrido')
    : el('button', { class: 'btn btn-gold', type: 'button', onclick: () => startMission(MISSIONS[next]) }, S.cur && S.cur.mission === MISSIONS[next].id ? `Continuar misión ${next + 1} ➜` : `Ir a la misión ${next + 1} ➜`);
  const pendTotal = statsOf(MISSIONS.filter(m => S.done[m.id]).flatMap(m => ITEMS_BY_MISSION[m.id])).pending;
  root.append(el('div', { class: 'map-layout' },
    el('div', { class: 'map-wrap', html: svg }),
    el('aside', { class: 'side' },
      el('div', { class: 'side-card', html: `<h3>🧩 Piezas del mapa</h3><div class="pieces">${pieces}</div>` }),
      el('div', { class: 'side-card', html: `<h3>🗺️ Misiones</h3><div class="mission-list">${list}</div>${pendTotal ? '<p class="side-note">⏳ = respuestas que te quedaron sin responder. Tocá la misión en el mapa para completarlas.</p>' : ''}` }),
      cta)));
  $$('.map-node', root).forEach(n => {
    const go = () => { const i = +n.dataset.i; if (i > next) toast('Esta misión se desbloquea al terminar la anterior.'); else startMission(MISSIONS[i]); };
    n.addEventListener('click', go); n.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  });
  MAP_JUST = null;
  show('s-mapa');
}

/* ---------- Transiciones y celebraciones ----------
   Breves, se pueden saltear con un toque o una tecla y nunca bloquean la
   navegación (la pantalla siguiente ya está cargada debajo). No muestran
   puntajes ni si las respuestas son correctas. */
function fxIcon(kind, badge) {
  const p = artId();
  if (kind === 'pend') return `<svg viewBox="-60 -60 120 120">${artDefs(p)}<circle r="50" fill="${G(p, 'ball')}" filter="url(#${p}sh)"/>
    <line x1="-12" y1="34" x2="-12" y2="-34" stroke="#5b3415" stroke-width="6" stroke-linecap="round"/><path d="M-9 -34 L30 -22 L-9 -8Z" fill="${G(p, 'blue')}"/>
    <ellipse cx="-16" cy="-28" rx="16" ry="9" fill="#fff" opacity=".5"/></svg>`;
  if (kind === 'mission') return `<svg viewBox="-80 -80 160 160">${artDefs(p)}
    <g class="rays">${Array.from({ length: 12 }, (_, i) => `<path d="M0 0 L-9 -78 L9 -78Z" fill="#fde68a" opacity=".7" transform="rotate(${i * 30})"/>`).join('')}</g>
    <path d="M-30 30 L-44 76 L-22 66 L-12 84 L0 40Z M30 30 L44 76 L22 66 L12 84 L0 40Z" fill="${G(p, 'red')}"/>
    <circle r="52" fill="${G(p, 'gold')}" stroke="#b45309" stroke-width="5" filter="url(#${p}sh)"/><circle r="40" fill="none" stroke="#fff3c4" stroke-width="3" stroke-dasharray="5 6"/>
    <text y="17" text-anchor="middle" font-size="48">${badge || '🏆'}</text>
    <ellipse cx="-18" cy="-26" rx="16" ry="9" fill="#fff" opacity=".55"/></svg>`;
  return `<svg viewBox="-60 -60 120 120">${artDefs(p)}<polygon points="${starPts(0, 2, 54, 25)}" fill="${G(p, 'gold')}" stroke="#b45309" stroke-width="4" stroke-linejoin="round" filter="url(#${p}sh)"/>
    <ellipse cx="-14" cy="-14" rx="12" ry="7" fill="#fff" opacity=".6"/></svg>`;
}
function sparkles(n) {
  const box = $('#confetti');
  for (let i = 0; i < n; i++) {
    const s = el('i', { class: 'spark' });
    const a = Math.random() * Math.PI * 2, d = 140 + Math.random() * 260;
    s.style.setProperty('--dx', `${Math.cos(a) * d}px`); s.style.setProperty('--dy', `${Math.sin(a) * d}px`);
    s.style.animationDelay = `${Math.random() * .25}s`; s.style.setProperty('--sz', `${14 + Math.random() * 18}px`);
    box.append(s); setTimeout(() => s.remove(), 1800);
  }
}
function playFx({ kind, title, text, badge, duration }) {
  const old = $('#fx'); if (old) old.remove();
  $('#confetti').innerHTML = '';   // sin restos de una animación anterior (nunca confeti en «pendiente»)
  const ov = el('div', { class: `fx fx-${kind}`, id: 'fx', role: 'status', 'aria-live': 'polite' },
    el('div', { class: 'fx-card' },
      el('div', { class: 'fx-icon', html: fxIcon(kind, badge) }),
      el('h3', {}, title), el('p', {}, text),
      el('span', { class: 'fx-skip' }, 'Tocá para continuar')));
  $('#app').append(ov);
  if (kind === 'ok') { confetti(70); sparkles(14); }
  if (kind === 'mission') { confetti(170); sparkles(28); setTimeout(() => sparkles(18), 700); }
  let closed = false;
  const close = () => {
    if (closed) return; closed = true;
    ov.classList.add('out'); document.removeEventListener('keydown', close);
    setTimeout(() => ov.remove(), 320);
  };
  ov.addEventListener('click', close);
  setTimeout(() => document.addEventListener('keydown', close), 150);
  setTimeout(close, duration || (kind === 'mission' ? 3400 : kind === 'pend' ? 2600 : 1800));
}

/* ---------- Inicio de misión ---------- */
function startMission(m) {
  // Misión ya terminada: se vuelve a abrir para revisar o completar lo pendiente.
  if (S.done[m.id]) {
    const p = firstPending(m.id);
    S.cur = { mission: m.id, act: p ? p.act : 0 }; Store.save(); renderActivity(); return;
  }
  if (S.cur && S.cur.mission === m.id) { renderActivity(); return; }
  S.cur = { mission: m.id, act: 0 }; S.visited[m.id] = true; Store.save(); sendSoon();
  BG_MISSION = m.id;
  const root = $('#s-intro'); root.innerHTML = '';
  const total = ITEMS_BY_MISSION[m.id].length;
  root.append(el('div', { class: 'intro' },
    el('div', { class: 'intro-scene', html: sceneSVG(m.scene) }),
    el('div', {},
      el('span', { class: 'pill gold' }, `Misión ${m.num} de ${MISSIONS.length}`),
      el('h2', {}, `${m.icon} ${m.title}`),
      el('p', { class: 'story' }, m.story),
      el('div', { class: 'integration' }, el('span', { class: 'pill lengua' }, '📘 ' + m.pills[0]), el('span', { class: 'pill naturales' }, '🌿 ' + m.pills[1])),
      el('p', { class: 'story' }, `🎯 ${m.activities.length} desafíos · ${total} respuestas · Insignia: `, el('strong', {}, `${m.badge.icon} ${m.badge.name}`)),
      el('div', { class: 'row' },
        el('button', { class: 'btn btn-gold btn-xl', type: 'button', onclick: renderActivity }, '¡Empezar la misión! 🚀'),
        el('button', { class: 'btn btn-ghost', type: 'button', onclick: renderMap }, 'Volver al mapa')))));
  show('s-intro');
}

/* ---------- Actividad ---------- */
function renderActivity() {
  const m = missionById(S.cur.mission), ai = S.cur.act, a = m.activities[ai];
  BG_MISSION = m.id;
  S.visited[m.id] = true;
  const its = ITEMS_BY_ACT[a.id], area = actArea(a);
  const root = $('#s-actividad'); root.innerHTML = '';
  const workspace = el('div', { class: 'workspace' });
  const textRef = typeof a.text === 'string' ? ACT_BY_ID[a.text].text : a.text;
  const body = el('div', { class: `act-body ${textRef ? 'with-text' : ''}` });
  if (textRef) body.append(el('article', { class: 'reading' }, el('span', { class: 'badge-text' }, '📜 Texto de divulgación'), el('h4', {}, textRef.title), textRef.paras.map(p => el('p', {}, p))));
  if (a.context) workspace.append(el('div', { class: 'card', html: `<p class="q-text" style="margin:0">📌 ${esc(a.context)}</p>` }));
  body.append(workspace);
  const status = el('span', { class: 'act-status' });
  root.append(el('div', { class: `act ${area}` },
    el('div', { class: 'act-head' },
      el('span', { class: `pill ${area}` }, area === 'lengua' ? '📘 Lengua' : area === 'naturales' ? '🌿 Ciencias Naturales' : '📘🌿 Lengua + Naturales'),
      el('span', { class: 'mission-name' }, `${m.icon} Misión ${m.num} · Desafío ${ai + 1} de ${m.activities.length}`), status),
    el('h2', { class: 'act-title' }, a.title),
    el('div', { class: 'consigna' }, el('span', { class: 'avatar-wrap', html: explorerAvatar() }), el('p', { html: fmt(a.consigna) })),
    body,
    el('div', { class: 'act-nav' })));

  const locked = new Set(its.filter(it => isDone(it.id)).map(it => it.id));
  const ctx = { seed: S.sessionId, locked: id => locked.has(id), onChange: saveDraft };
  const ctrl = TYPES[a.type].render(a, workspace, ctx);
  const raw = {};
  its.forEach(it => { const r = S.items[it.id]; if (r && r.locked) raw[it.id] = r.raw; else if (S.drafts[it.id] !== undefined) raw[it.id] = S.drafts[it.id]; });
  ctrl.restore(raw);
  ctrl.lock([...locked]);
  CUR = { m, a, ai, its, ctrl, locked, status };
  renderNav(); updateStatus();
  show('s-actividad');
}
/** Respuestas ya registradas del desafío en pantalla + las que está completando ahora. */
function liveCount() {
  const res = CUR.ctrl.collect();
  return CUR.its.filter(it => CUR.locked.has(it.id) || (res[it.id] && res[it.id].value != null)).length;
}
function updateStatus() {
  const n = liveCount(), t = CUR.its.length, lockedN = CUR.locked.size;
  CUR.status.className = `act-status ${n === t ? 'full' : n ? 'part' : ''}`;
  CUR.status.textContent = lockedN === t ? '🔒 Desafío respondido' : `✏️ ${n} de ${t} respondidas`;
  const dot = $(`.nav-dots .dot[data-i="${CUR.ai}"]`);
  if (dot) dot.className = `dot now ${n === t ? 'full' : n ? 'part' : ''}`;
}
/** Guarda lo que el alumno va marcando (sin bloquear) para no perderlo si se actualiza la página. */
function saveDraft() {
  const res = CUR.ctrl.collect();
  CUR.its.forEach(it => {
    if (CUR.locked.has(it.id)) return;
    const r = res[it.id];
    if (r && r.value != null) S.drafts[it.id] = r.raw; else delete S.drafts[it.id];
  });
  Store.save(); updateStatus();
}
/** Al salir del desafío: lo respondido queda registrado y bloqueado; lo vacío queda pendiente. */
function commitActivity() {
  if (!CUR) return 0;
  const res = CUR.ctrl.collect();
  const now = new Date().toISOString();
  let pending = 0;
  CUR.its.forEach(it => {
    delete S.drafts[it.id];
    if (CUR.locked.has(it.id)) return;
    const r = res[it.id];
    if (!r || r.value == null) { pending++; return; }
    S.items[it.id] = { v: r.value, ok: !!r.correct, raw: r.raw, locked: true, at: now, pts: r.correct ? CONFIG.PUNTOS_POR_CORRECTA : 0 };
    CUR.locked.add(it.id);
  });
  Store.save();
  return pending;
}
function actState(a) {
  const its = ITEMS_BY_ACT[a.id]; const n = its.filter(it => isDone(it.id)).length;
  return n === its.length ? 'full' : n ? 'part' : '';
}
function renderNav() {
  const { m, ai } = CUR;
  const nav = $('#s-actividad .act-nav'); nav.innerHTML = '';
  const last = ai === m.activities.length - 1;
  const dots = el('div', { class: 'nav-dots', role: 'group', 'aria-label': 'Desafíos de la misión' },
    m.activities.map((a, i) => el('button', {
      type: 'button', class: `dot ${i === ai ? 'now' : ''} ${actState(a)}`, dataset: { i: String(i) },
      title: `Desafío ${i + 1}: ${a.title}`, 'aria-label': `Ir al desafío ${i + 1}`, onclick: () => goTo(i)
    }, String(i + 1))));
  nav.append(
    el('div', { class: 'nav-left' },
      el('button', { class: 'btn btn-ghost', type: 'button', disabled: ai === 0, onclick: () => goTo(ai - 1) }, '← Anterior'),
      el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => leaveTo(renderMap) }, '🗺️ Mapa')),
    dots,
    last
      ? el('button', { class: 'btn btn-gold btn-xl', type: 'button', onclick: finishMission }, 'Terminar misión 🏁')
      : el('button', { class: 'btn btn-gold btn-xl', type: 'button', onclick: () => goTo(ai + 1, true) }, 'Siguiente →'));
  nav.append(el('p', { class: 'nav-hint' }, 'Podés cambiar tus respuestas mientras estés en este desafío. Al salir, quedan guardadas y bloqueadas.'));
}
function pendingToast(n) {
  if (n) toast(n === 1 ? 'Quedó 1 respuesta sin responder. Podés volver a completarla.' : `Quedaron ${n} respuestas sin responder. Podés volver a completarlas.`);
}
/** ¿El desafío en pantalla ya estaba completo al entrar? (para no repetir celebraciones) */
const wasComplete = () => CUR.locked.size === CUR.its.length;
function activityFx(pending, already) {
  if (already) return;   // volvió a un desafío ya completo: sin animación
  if (!pending) playFx({ kind: 'ok', title: '¡Lo lograste!', text: 'Completaste esta actividad.' });
  else playFx({ kind: 'pend', title: '¡Podés continuar!', text: 'Esta actividad quedó pendiente. Podés volver más tarde para completarla.' });
}
function goTo(i, viaNext) {
  if (i < 0 || i >= CUR.m.activities.length || i === CUR.ai) return;
  const already = wasComplete();
  const pending = commitActivity();
  S.cur.act = i; Store.save(); sendSoon();
  renderActivity();
  if (viaNext) activityFx(pending, already); else pendingToast(pending);
}
function leaveTo(fn) {
  pendingToast(commitActivity());
  Store.save(); sendSoon(); updateHUD(); fn();
}
function finishMission() {
  const already = wasComplete();
  const pending = commitActivity();
  completeMission(CUR.m, pending, already);
}

/* ---------- Misión completada ---------- */
function completeMission(m, pending = 0, already = false) {
  const first = !S.done[m.id];
  S.done[m.id] = true; if (first) S.doneAt[m.id] = new Date().toISOString();
  S.cur = null; BG_MISSION = m.id;
  if (nextMissionIdx() >= MISSIONS.length && !S.finished) { S.finished = true; S.finishedAt = new Date().toISOString(); }
  Store.save();
  sendNow();   // envío al terminar cada misión (y el último, al terminar todo)
  if (first) MAP_JUST = m.id;
  const st = statsOf(ITEMS_BY_MISSION[m.id]);
  const actsDone = m.activities.filter(a => actState(a) === 'full').length;
  const root = $('#s-fin-mision'); root.innerHTML = '';
  const allDone = nextMissionIdx() >= MISSIONS.length;
  const p = firstPending(m.id);
  root.append(el('div', { class: 'done-wrap' }, el('div', { class: 'done-card' },
    el('div', { class: 'big-badge' }, m.badge.icon),
    el('p', { class: 'kicker' }, `Misión ${m.num} de ${MISSIONS.length} completada`),
    allDone && first ? el('p', { class: 'lead' }, el('strong', {}, `¡Era la última misión! Completaste las ${MISSIONS.length} etapas del recorrido.`)) : null,
    el('h2', {}, '¡Misión cumplida!'),
    el('p', { class: 'lead' }, 'Ganaste la insignia ', el('strong', {}, m.badge.name), ' y recuperaste una pieza del mapa del conocimiento.'),
    el('div', { class: 'stats' },
      el('div', { class: 'stat' }, el('strong', {}, `${actsDone}/${m.activities.length}`), el('span', {}, 'actividades completas')),
      el('div', { class: 'stat' }, el('strong', {}, `${st.answered}/${st.total}`), el('span', {}, 'respuestas dadas'))),
    st.pending ? el('p', { class: 'pend-msg' }, `⏳ Te ${st.pending === 1 ? 'quedó 1 respuesta' : `quedaron ${st.pending} respuestas`} sin responder. Podés completarlas ahora o más tarde desde el mapa.`) : null,
    el('div', { class: 'row', style: 'justify-content:center' },
      p ? el('button', { class: 'btn btn-ghost', type: 'button', onclick: () => { S.cur = { mission: m.id, act: p.act }; Store.save(); renderActivity(); } }, 'Completar lo que falta ✏️') : null,
      allDone && first ? el('button', { class: 'btn btn-gold btn-xl', type: 'button', onclick: () => renderFinal(true) }, '🏆 Completar el mapa')
        : el('button', { class: 'btn btn-gold btn-xl', type: 'button', onclick: renderMap }, 'Volver al mapa 🗺️')))));
  show('s-fin-mision');
  if (first) playFx({ kind: 'mission', badge: m.badge.icon, title: '¡Desafío completado!',
    text: allDone ? '¡Completaste tu misión! Recorriste las cuatro etapas.' : '¡Estás cada vez más cerca de completar tu misión!' });
  else activityFx(pending, already);
}

/* ---------- Pantalla final ---------- */
function renderFinal(celebrate = false) {
  const st = statsOf(ALL_ITEMS);
  const p = firstPending();
  const root = $('#s-final'); root.innerHTML = '';
  root.append(el('div', { class: 'done-wrap' }, el('div', { class: 'done-card', style: 'max-width:56rem' },
    el('div', { class: 'big-badge' }, '🗺️'),
    el('h2', { style: 'font-size:2.6rem' }, '¡Felicitaciones, lo lograste!'),
    el('p', { class: 'lead' }, `${S.nombre}, completaste las 4 misiones y recuperaste todas las piezas del mapa del conocimiento. ¡Terminaste el recorrido!`),
    el('div', { class: 'final-badges' }, MISSIONS.map(m => el('div', { class: 'final-badge' }, el('div', {}, m.badge.icon), m.badge.name))),
    el('div', { class: 'stats' },
      el('div', { class: 'stat' }, el('strong', {}, `${MISSIONS.length}/${MISSIONS.length}`), el('span', {}, 'misiones completadas')),
      el('div', { class: 'stat' }, el('strong', {}, `${st.answered}/${st.total}`), el('span', {}, 'respuestas dadas')),
      el('div', { class: 'stat' }, el('strong', {}, fmtTime(S.activeMs)), el('span', {}, 'tiempo de expedición'))),
    st.pending ? el('p', { class: 'pend-msg' }, `⏳ Todavía ${st.pending === 1 ? 'te queda 1 respuesta' : `te quedan ${st.pending} respuestas`} sin responder.`) : null,
    el('p', { id: 'final-sync', class: 'sync-msg' }),
    el('div', { class: 'row', style: 'justify-content:center' },
      p ? el('button', { class: 'btn btn-gold', type: 'button', onclick: () => { S.cur = { mission: p.mission, act: p.act }; Store.save(); renderActivity(); } }, 'Completar lo que falta ✏️') : null,
      el('button', { class: 'btn btn-ghost', type: 'button', onclick: renderMap }, 'Ver el mapa'),
      el('button', { class: 'btn btn-ink', type: 'button', onclick: finishSession }, 'Terminar y dejar la compu lista 👋')))));
  show('s-final'); updateSyncUI();
  if (celebrate) { confetti(160); sparkles(24); }
}
function finishSession() {
  if (SYNC.timer) sendNow();
  const pending = CONFIG.SHEETS_URL && Outbox.pendingFor(S.sessionId);
  if (pending && !confirm('Tus resultados todavía se están enviando. Quedan guardados en esta compu y se enviarán solos cuando haya conexión. ¿Terminar igual?')) return;
  Store.release(); S = null; CUR = null;
  initWelcome(); show('s-bienvenida');
}

/* =========================================================================
   10. PANEL DOCENTE
   La clave NO está en este archivo: se valida en Google Apps Script
   (Propiedades del script). Sin la clave correcta el servidor no devuelve datos.
   ========================================================================= */
const T = { data: null, key: null, tab: 'resumen', q: '', div: '' };
const n0 = v => Number(v) || 0;
const fmtDate = v => { if (!v) return ''; const d = new Date(v); return isNaN(d) ? String(v) : d.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }); };
const pctOf = (ok, total) => total ? Math.round(ok / total * 100) : 0;
const rowKey = r => `${r.division}|${normTxt(r.apellido)}|${normTxt(r.nombre)}`;
const rowName = r => `${r.apellido}, ${r.nombre}`;
function hbar(label, pct, cls, extra = '') {
  return `<div class="hbar"><span>${esc(label)}</span><div class="track"><div class="fill ${cls}" style="width:${Math.max(0, Math.min(100, pct))}%"></div></div><span>${pct}%${extra}</span></div>`;
}

function renderTeacher() {
  $('#confetti').innerHTML = '';
  const root = $('#s-docente'); root.innerHTML = '';
  show('s-docente');
  if (!T.data) {
    const input = el('input', { type: 'password', placeholder: 'Clave docente', autocomplete: 'current-password', 'aria-label': 'Clave docente' });
    const btn = el('button', { class: 'btn btn-ink', type: 'submit' }, 'Ingresar');
    const form = el('form', { class: 'teacher-login' },
      el('h2', { style: 'font-family:var(--font-title);margin:0' }, '🔐 Panel docente'),
      el('p', { style: 'margin:0;color:var(--ink-2)' }, 'Ingresá la clave que configuraste en Google Apps Script. La clave se verifica en el servidor; no queda guardada en la página.'),
      !CONFIG.SHEETS_URL ? el('div', { class: 'notice' }, '⚠️ Todavía no se configuró la URL de Google Apps Script en script.js (CONFIG.SHEETS_URL). Seguí el README para conectarla.') : null,
      input, btn,
      el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: leaveTeacher }, '← Volver a la aventura'));
    form.onsubmit = async e => {
      e.preventDefault();
      if (!CONFIG.SHEETS_URL) { toast('Primero configurá la URL de Apps Script.'); return; }
      if (!input.value) return;
      btn.disabled = true; btn.textContent = 'Verificando…';
      try {
        const res = await postJSON({ action: 'reporte', clave: input.value }, 45000);
        if (!res.ok) throw new Error(res.error || 'No se pudo ingresar');
        T.key = input.value; T.data = res; renderTeacher();
      } catch (err) { toast('❌ ' + (err.message || 'Error de conexión')); btn.disabled = false; btn.textContent = 'Ingresar'; }
    };
    root.append(form); input.focus();
    return;
  }
  const D = filtered(T.data);
  const divSel = el('select', { class: 'div-filter', 'aria-label': 'Filtrar por división' },
    [['', 'Ambas divisiones'], ['4.º A', '4.º A'], ['4.º B', '4.º B']].map(([v, l]) => el('option', { value: v, selected: T.div === v }, l)));
  divSel.onchange = () => { T.div = divSel.value; renderTeacher(); };
  const top = el('div', { class: 'teacher-top' },
    el('h2', {}, '📊 Panel docente · Misión Ciencia y Palabras'),
    el('span', { style: 'color:var(--muted);font-weight:700' }, `Actualizado: ${fmtDate(T.data.generado)}`),
    el('div', { class: 'row', style: 'margin-left:auto' },
      divSel,
      el('button', { class: 'btn btn-nat btn-sm', type: 'button', onclick: refreshTeacher }, '🔄 Actualizar'),
      el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => { T.data = null; T.key = null; renderTeacher(); } }, 'Cerrar sesión'),
      el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: leaveTeacher }, '← Salir')));
  const tabs = el('div', { class: 'tabs' }, [['resumen', 'Resumen'], ['contenidos', 'Contenidos con más errores'], ['alumnos', 'Alumnos'], ['pendientes', 'Pendientes'], ['nota', 'Conversión a nota']]
    .map(([k, l]) => el('button', { class: `tab ${T.tab === k ? 'active' : ''}`, type: 'button', onclick: () => { T.tab = k; renderTeacher(); } }, l)));
  const content = el('div');
  root.append(el('div', { class: 'teacher' }, top, tabs, content));
  ({ resumen: tResumen, contenidos: tContenidos, alumnos: tAlumnos, pendientes: tPendientes, nota: tNota })[T.tab](content, D);
}
/** Aplica el filtro de división y se queda con la última sesión de cada alumno. */
function filtered(data) {
  const byDiv = r => !T.div || r.division === T.div;
  const map = {};
  data.general.filter(byDiv).forEach(g => { const k = rowKey(g); if (!map[k] || new Date(g.fecha) > new Date(map[k].fecha)) map[k] = g; });
  const general = Object.values(map).sort((a, b) => String(a.division + a.apellido + a.nombre).localeCompare(String(b.division + b.apellido + b.nombre), 'es'));
  const ses = new Set(general.map(g => g.sesion));
  return { general, misiones: data.misiones.filter(r => ses.has(r.sesion)), detalle: data.detalle.filter(r => ses.has(r.sesion)) };
}
async function refreshTeacher() {
  try { const res = await postJSON({ action: 'reporte', clave: T.key }, 45000); if (!res.ok) throw new Error(res.error); T.data = res; renderTeacher(); toast('Datos actualizados'); }
  catch (e) { toast('❌ ' + (e.message || 'Error de conexión')); }
}
function leaveTeacher() {
  history.replaceState(null, '', location.pathname + location.search);
  if (S) (S.finished ? renderFinal() : renderMap()); else { initWelcome(); show('s-bienvenida'); }
}
function tResumen(box, D) {
  const alumnos = D.general;
  const fin = alumnos.filter(g => String(g.estado).startsWith('Finalizado'));
  const prom = alumnos.length ? Math.round(alumnos.reduce((s, g) => s + n0(g.porcentaje), 0) / alumnos.length) : 0;
  const tProm = fin.length ? fmtTime(fin.reduce((s, g) => s + n0(g.tiempoSeg), 0) / fin.length * 1000) : '—';
  const sinResp = alumnos.reduce((s, g) => s + n0(g.sinResponder), 0);
  const agg = (rows, key) => { const o = {}; rows.forEach(r => { const k = r[key]; o[k] = o[k] || { ok: 0, ko: 0, pend: 0 }; o[k].ok += n0(r.correctas); o[k].ko += n0(r.incorrectas); o[k].pend += n0(r.sinResponder); }); return o; };
  const porMision = agg(D.misiones, 'mision'), porArea = agg(D.misiones, 'area');
  const porDiv = {};
  alumnos.forEach(g => { porDiv[g.division] = porDiv[g.division] || []; porDiv[g.division].push(n0(g.porcentaje)); });
  const pctAgg = v => v ? pctOf(v.ok, v.ok + v.ko + v.pend) : 0;
  box.innerHTML = `
    <div class="kpis">
      <div class="kpi"><strong>${alumnos.length}</strong><span>alumnos registrados</span></div>
      <div class="kpi"><strong>${fin.length}</strong><span>terminaron la aventura</span></div>
      <div class="kpi"><strong>${prom}%</strong><span>logro promedio</span></div>
      <div class="kpi"><strong>${sinResp}</strong><span>respuestas sin responder</span></div>
      <div class="kpi"><strong>${tProm}</strong><span>tiempo promedio</span></div>
    </div>
    <div class="panel-grid">
      <div class="panel-card"><h3>Desempeño por misión</h3>
        ${MISSIONS.map(m => { const v = porMision[missionLabel(m)]; return hbar(`${m.icon} M${m.num} · ${m.short}`, pctAgg(v), 'gold', v ? '' : ' (sin datos)'); }).join('')}
      </div>
      <div class="panel-card"><h3>Desempeño por área</h3>
        ${[LEN, NAT].map(a => hbar(a, pctAgg(porArea[a]), a === LEN ? 'lengua' : 'naturales')).join('')}
        ${!T.div ? `<h3 style="margin-top:1rem">Por división</h3>${['4.º A', '4.º B'].map(d => { const v = porDiv[d] || []; return hbar(`${d} (${v.length} alumnos)`, v.length ? Math.round(v.reduce((s, x) => s + x, 0) / v.length) : 0, d === '4.º A' ? 'lengua' : 'naturales'); }).join('')}` : ''}
        <p style="color:var(--muted);font-size:.85rem;margin-top:1rem">Logro = respuestas correctas sobre el total de respuestas (las sin responder cuentan como no logradas).</p>
      </div>
    </div>`;
}
function tContenidos(box, D) {
  const byCont = {}, byItem = {};
  D.detalle.forEach(r => {
    const k = r.contenido; byCont[k] = byCont[k] || { area: r.area, n: 0, ko: 0, pend: 0 };
    const i = r.actividad; byItem[i] = byItem[i] || { consigna: r.consigna, contenido: r.contenido, correcta: r.correcta, n: 0, ko: 0, pend: 0 };
    if (r.estado === 'Sin responder') { byCont[k].pend++; byItem[i].pend++; return; }
    byCont[k].n++; byItem[i].n++;
    if (r.resultado !== 'Correcta') { byCont[k].ko++; byItem[i].ko++; }
  });
  const conts = Object.entries(byCont).map(([k, v]) => ({ k, ...v, pct: pctOf(v.ko, v.n) })).sort((a, b) => b.pct - a.pct);
  const items = Object.entries(byItem).map(([k, v]) => ({ k, ...v, pct: pctOf(v.ko, v.n) })).filter(i => i.n > 0).sort((a, b) => b.pct - a.pct).slice(0, 15);
  box.innerHTML = `
    <div class="panel-card"><h3>Porcentaje de error por contenido</h3>
      ${conts.length ? conts.map(c => hbar(`${c.area === LEN ? '📘' : '🌿'} ${c.k}`, c.pct, 'err', ` · ${c.n}${c.pend ? ` (+${c.pend} s/r)` : ''}`)).join('') : '<p>Todavía no hay respuestas registradas.</p>'}
      <p style="color:var(--muted);font-size:.85rem">% de error sobre las respuestas dadas. El número indica cuántas respuestas se analizaron; «s/r» = sin responder.</p>
    </div>
    <div class="panel-card"><h3>Ítems con más errores</h3><div class="scroll-box">
      <table class="data-table"><thead><tr><th>Ítem</th><th>Consigna</th><th>Contenido</th><th>Respuesta correcta</th><th>% error</th><th>Sin responder</th></tr></thead><tbody>
      ${items.map(i => `<tr><td>${esc(i.k)}</td><td>${esc(i.consigna)}</td><td>${esc(i.contenido)}</td><td>${esc(i.correcta)}</td><td class="tag-ko">${i.pct}%</td><td>${i.pend}</td></tr>`).join('')}
      </tbody></table></div></div>`;
}
function tAlumnos(box, D) {
  const input = el('input', { type: 'search', placeholder: 'Buscar por apellido o nombre', value: T.q });
  const results = el('div');
  const draw = () => {
    const q = normTxt(input.value); T.q = input.value;
    const list = D.general.filter(g => !q || normTxt(`${g.apellido} ${g.nombre} ${g.nombre} ${g.apellido}`).includes(q));
    results.innerHTML = `<div class="panel-card"><h3>Alumnos (${list.length})</h3><div class="scroll-box"><table class="data-table"><thead><tr>
      <th>División</th><th>Apellido y nombre</th><th>% logro</th><th>Equivale a</th><th>Respondidas</th><th>Sin responder</th><th>Puntaje</th><th>Misiones</th><th>Tiempo</th><th>Estado</th><th>Última actualización</th></tr></thead><tbody>
      ${list.map(g => `<tr class="click" data-s="${esc(g.sesion)}"><td>${esc(g.division)}</td><td><strong>${esc(rowName(g))}</strong></td><td>${n0(g.porcentaje)}%</td><td>${n0(g.nota20)}/20</td><td>${n0(g.respondidas)}</td><td>${n0(g.sinResponder) ? `<span class="tag-ko">${n0(g.sinResponder)}</span>` : '0'}</td><td>${n0(g.puntaje)}</td><td>${esc(g.misiones)}</td><td>${esc(g.tiempo)}</td><td>${g.estado === 'Finalizado' ? '<span class="tag-ok">Finalizado</span>' : `<span class="tag-ko">${esc(g.estado)}</span>`}</td><td>${fmtDate(g.fecha)}</td></tr>`).join('')}
      </tbody></table></div><p style="color:var(--muted);font-size:.85rem">Tocá un alumno para ver su detalle.</p></div><div id="t-detail"></div>`;
    $$('tr.click', results).forEach(tr => tr.onclick = () => studentDetail($('#t-detail', results), D, tr.dataset.s));
    if (list.length === 1) studentDetail($('#t-detail', results), D, list[0].sesion);
  };
  input.addEventListener('input', draw);
  box.append(el('div', { class: 'search-row' }, input), results); draw();
}
function studentDetail(box, D, sesion) {
  const g = D.general.find(r => r.sesion === sesion); if (!g) return;
  const mis = D.misiones.filter(r => r.sesion === sesion);
  const det = D.detalle.filter(r => r.sesion === sesion);
  box.innerHTML = `<div class="panel-card"><h3>🧭 ${esc(rowName(g))} · ${esc(g.division)}</h3>
    <div class="kpis">
      <div class="kpi"><strong>${n0(g.porcentaje)}%</strong><span>logro (${n0(g.correctas)} correctas · ${n0(g.incorrectas)} incorrectas)</span></div>
      <div class="kpi"><strong>${n0(g.nota20)}/20</strong><span>equivalencia</span></div>
      <div class="kpi"><strong>${n0(g.sinResponder)}</strong><span>sin responder</span></div>
      <div class="kpi"><strong>${esc(g.tiempo)}</strong><span>tiempo total</span></div>
    </div>
    <h3>Por misión y área</h3>
    ${mis.map(r => hbar(`${String(r.mision).replace(/:.*/, '')} · ${r.area}`, n0(r.porcentaje), r.area === LEN ? 'lengua' : 'naturales', n0(r.sinResponder) ? ` · ${n0(r.sinResponder)} s/r` : '')).join('') || '<p>Todavía no empezó ninguna misión.</p>'}
    <h3 style="margin-top:1rem">Detalle de respuestas</h3>
    <div class="scroll-box"><table class="data-table"><thead><tr><th>Desafío</th><th>Contenido</th><th>Consigna</th><th>Estado</th><th>Respuesta</th><th>Correcta</th><th>Resultado</th></tr></thead><tbody>
    ${det.map(r => `<tr><td>${esc(r.desafio)}</td><td>${esc(r.contenido)}</td><td>${esc(r.consigna)}</td><td>${esc(r.estado)}</td><td>${esc(r.respuesta)}</td><td>${esc(r.correcta)}</td><td class="${r.resultado === 'Correcta' ? 'tag-ok' : 'tag-ko'}">${esc(r.resultado)}</td></tr>`).join('')}
    </tbody></table></div></div>`;
  const sc = $('#s-docente'); sc.scrollTo({ top: box.offsetTop - 10, behavior: 'smooth' });
}
function tPendientes(box, D) {
  const alumnos = D.general.filter(g => g.estado !== 'Finalizado' || n0(g.sinResponder) > 0);
  const rows = alumnos.map(g => {
    const mis = D.misiones.filter(r => r.sesion === g.sesion);
    const faltan = MISSIONS.map(m => {
      const rs = mis.filter(r => r.mision === missionLabel(m));
      if (!rs.length) return `M${m.num} · ${m.short}: sin empezar`;
      const pend = rs.reduce((s, r) => s + n0(r.sinResponder), 0);
      const done = rs.every(r => r.estado === 'Completada');
      return !done ? `M${m.num} · ${m.short}: en curso${pend ? ` (${pend} s/r)` : ''}` : pend ? `M${m.num} · ${m.short}: ${pend} sin responder` : null;
    }).filter(Boolean);
    return `<tr><td>${esc(g.division)}</td><td><strong>${esc(rowName(g))}</strong></td><td>${esc(g.misiones)}</td><td>${n0(g.sinResponder)}</td><td>${faltan.map(esc).join('<br>')}</td><td>${fmtDate(g.fecha)}</td></tr>`;
  }).join('');
  box.innerHTML = `<div class="panel-card"><h3>Alumnos con actividades pendientes (${alumnos.length})</h3>
    ${alumnos.length ? `<div class="scroll-box"><table class="data-table"><thead><tr><th>División</th><th>Alumno</th><th>Misiones terminadas</th><th>Sin responder</th><th>Qué falta</th><th>Última actividad</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p>🎉 No hay pendientes: todos terminaron y respondieron todo.</p>'}
    <p style="color:var(--muted);font-size:.85rem">El alumno puede retomar en la misma computadora escribiendo su división, nombre y apellido: sigue donde quedó y completa lo que dejó sin responder.</p></div>`;
}
function tNota(box) {
  box.innerHTML = `<div class="panel-card"><h3>Conversión a nota (cada respuesta vale lo mismo)</h3>
    <table class="data-table conv-table" style="max-width:30rem"><thead><tr><th>Equivalencia sobre 20</th><th>Porcentaje</th></tr></thead><tbody>
    ${[20, 18, 16, 14, 12, 10].map(n => `<tr><td>${n} correctas</td><td>${n * 5}%</td></tr>`).join('')}</tbody></table>
    <p>La aventura tiene <strong>${ALL_ITEMS.length} respuestas evaluables</strong>. El porcentaje de logro es la cantidad de respuestas correctas sobre ese total; las que quedaron <strong>sin responder</strong> cuentan como no logradas. La equivalencia sobre 20 es el porcentaje ÷ 5.</p></div>`;
}

/* =========================================================================
   11. INICIO
   ========================================================================= */
function route() {
  if (location.hash === '#docente') { renderTeacher(); return true; }
  return false;
}
const APP_VERSION = '3';
function init() {
  if (!$('#in-div')) {   // index.html viejo con script.js nuevo (o al revés)
    const e = $('#load-error'); if (e) e.hidden = false;
    console.error('index.html y script.js son de versiones distintas. Subí los tres archivos juntos y actualizá con Ctrl+F5.');
    return;
  }
  validateContent();
  initWelcome();
  if (!route()) show('s-bienvenida');
  window.addEventListener('hashchange', () => { if (!route() && $('#s-docente').classList.contains('active')) leaveTeacher(); });
  window.MCP_READY = APP_VERSION;
  flush();
}
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
}
