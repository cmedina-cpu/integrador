# 🧭 Misión Ciencia y Palabras: Exploradores del conocimiento

Integrador gamificado de **Lengua** y **Ciencias Naturales** para 4.º grado.
Los alumnos entran con su **grado y división (4A o 4B), nombre y apellido**, recorren 4 misiones, ganan insignias y completan el mapa del conocimiento. Los resultados se guardan solos en una **planilla de Google Sheets**, **separados por división**, y la docente los consulta en un **panel protegido**.

| Archivo | Para qué sirve |
|---|---|
| `index.html` | Estructura de la aplicación |
| `styles.css` | Diseño visual (16:9, colores por área) |
| `script.js` | Actividades, corrección, puntaje, guardado y panel docente |
| `google-apps-script.gs` | Servicio que recibe los resultados en Google Sheets |
| `README.md` | Este instructivo |

---

## 1. Crear la planilla y el servicio de Google (≈10 minutos)

1. Entrá a [sheets.new](https://sheets.new) con tu cuenta de Google y llamá a la planilla, por ejemplo, **Resultados Misión Ciencia**.
2. Menú **Extensiones → Apps Script**.
3. Borrá todo lo que aparece en `Código.gs` y **pegá el contenido completo de `google-apps-script.gs`**. Guardá (💾).
4. Volvé a la planilla y **recargá la página**. Aparece el menú **🧭 Misión Ciencia**:
   - **1. Preparar las hojas (4.º A y 4.º B)** → crea seis hojas, tres por división (pestañas azules para 4.º A y verdes para 4.º B):
     `4.º A · Resultados generales`, `4.º A · Por misión`, `4.º A · Detalle` y las mismas para `4.º B`. La primera vez Google pide autorización: elegí tu cuenta → *Configuración avanzada* → *Ir a…* → *Permitir*.
   - **2. Establecer clave docente** → escribí una clave (mínimo 6 caracteres). Es la que vas a usar en el panel docente. Queda guardada en el servidor de Google, **no** en la página.

## 2. Publicar el servicio web

1. En Apps Script: **Implementar → Nueva implementación**.
2. Tipo (ícono ⚙️): **Aplicación web**.
3. Completá:
   - *Ejecutar como*: **Yo**
   - *Quién tiene acceso*: **Cualquier usuario** (necesario para que las compus de los alumnos puedan enviar resultados sin iniciar sesión).
4. **Implementar** y copiá la **URL de la aplicación web** (termina en `/exec`).
5. Para comprobar, abrí esa URL en el navegador: debe decir `"El servicio está activo."`.

> Si más adelante cambiás el código de Apps Script: **Implementar → Administrar implementaciones → ✏️ → Versión: Nueva versión → Implementar**. Así la URL no cambia.

## 3. Pegar la URL en la aplicación

Abrí `script.js` y, al principio, en `CONFIG`, pegá la URL entre las comillas:

```js
SHEETS_URL: 'https://script.google.com/macros/s/XXXXXXXX/exec',
```

## 4. Publicar en GitHub Pages

1. Creá una cuenta en [github.com](https://github.com) (si no tenés).
2. **New repository** → nombre: `mision-ciencia` → *Public* → **Create repository**.
3. **Add file → Upload files** → arrastrá `index.html`, `styles.css`, `script.js`, `README.md` (el `.gs` es opcional) → **Commit changes**.
4. **Settings → Pages** → *Source*: **Deploy from a branch** → *Branch*: `main` / `(root)` → **Save**.
5. En 1–2 minutos queda publicada en `https://TU-USUARIO.github.io/mision-ciencia/`.

## 5. Probar el registro de resultados

1. Abrí la página publicada, escribí `4a`, nombre `Prueba` y apellido `Docente`, y empezá.
2. Volvé a la planilla: en `4.º A · Resultados generales` aparece la fila con estado **En curso** (en las hojas de 4.º B no aparece nada).
3. Avanzá algunos desafíos (respondé algunos y dejá otros vacíos). En unos segundos se completan `4.º A · Por misión` y `4.º A · Detalle`, con cada ítem marcado como **Respondida** o **Sin responder**. Arriba a la derecha de la app se ve **☁️ Resultados guardados**.
4. Entrá al panel: enlace **Acceso docente** (abajo a la derecha de la bienvenida) o agregá `#docente` al final de la dirección. Escribí tu clave.
5. Borrá las filas de prueba antes de usarla con el grupo.

---

## Cómo funciona

### Las 4 misiones (181 respuestas evaluables, 2 módulos aprox.)

| Misión | Lengua | Ciencias Naturales | Formatos |
|---|---|---|---|
| 1 · Animales de Mendoza | Sustantivos (propios/comunes, concretos/abstractos, individuales/colectivos), adjetivos calificativos, verbos | Ambientes aeroterrestre y acuático, adaptaciones del cóndor, guanaco, puma y zorro | Seleccionar palabras, arrastrar y clasificar, unir con flechas, opción múltiple |
| 2 · Cuerpo en acción | Artículos definidos e indefinidos, pronombres personales, género y número | Huesos, articulaciones, ligamentos, músculos, funciones, prevención | Completar, esqueleto con zonas, ficha de análisis, situaciones problemáticas |
| 3 · Un imán gigante | Bimembres/unimembres, sujeto y predicado, NS y NV, clases de palabras, género y número | Tierra como imán, brújula, fenómenos electrostáticos | Verdadero/falso, ordenar secuencia, análisis sintáctico, texto informativo |
| 4 · Detectives (última misión) | Gentilicios, numerales cardinales/ordinales/partitivos, artículos, pronombres, análisis | Animales, cuerpo humano y Tierra (3 textos de divulgación) | Clasificación avanzada, análisis en contexto |

**Numerales sin ambigüedad:** “cuarto” solo aparece **dentro de una oración** que define su función (“en *cuarto* lugar” = ordinal; “un *cuarto* de la torta” = partitivo). En las listas sueltas se usan ejemplos que tienen un solo significado.

### Ingreso
- **Grado y división**: solo se acepta 4A o 4B (en mayúscula o minúscula). **Nombre** y **apellido** son obligatorios.
- Si el alumno vuelve a la misma compu y escribe los mismos datos, **sigue donde quedó**. Cada alumno tiene su propia partida guardada, así que varios pueden usar la misma computadora en días distintos.

### Navegación y respuestas
- No hay botón «Comprobar». El alumno avanza con **Siguiente →**, vuelve con **← Anterior** o salta a cualquier desafío tocando los números de abajo.
- Puede **avanzar sin responder**. Mientras está en un desafío puede cambiar sus respuestas; **al salir, lo que respondió queda guardado y bloqueado**. Lo que dejó vacío queda pendiente y puede volver a completarlo cuando quiera.
- Los números de abajo muestran el estado: verde = todo respondido, amarillo = a medias, blanco = sin empezar.
- Si se recarga la página, también se conserva lo que estaba marcando en el desafío abierto.
- Una misión se termina con **Terminar misión 🏁** (aunque falten respuestas). Desde el mapa se puede volver a una misión terminada para completar lo pendiente (⏳).

### Lo que ve el alumno
- Estética de videojuego: ilustraciones con volumen para cada misión (cordillera, laboratorio, la Tierra en el espacio y el escritorio de detectives), un explorador que acompaña cada consigna y un mapa-isla 3D.
- Al tocar **Siguiente**:
  - si completó la actividad, aparece una lluvia de papel picado y estrellas con «¡Lo lograste! Completaste esta actividad», y pasa sola a la siguiente;
  - si la dejó sin completar, aparece «¡Podés continuar! Esta actividad quedó pendiente…», sin confeti.
- Al terminar una misión: celebración especial con «¡Desafío completado! ¡Estás cada vez más cerca de completar tu misión!», y el mapa la marca como completada (✔ y bandera).
- Las animaciones duran pocos segundos y se saltean con un toque. No se repiten al volver a una actividad ya completa ni al actualizar la página.
- **El alumno no ve puntajes, estrellas por desempeño, notas ni respuestas correctas.** Solo ve cuántas actividades completó y cuántas respuestas dio.

### Puntaje y nota (solo para la docente)
- Se registran **10 puntos** por respuesta correcta en la planilla y en el panel docente.
- **% de logro = correctas ÷ total de respuestas de la aventura.** Las que quedan sin responder cuentan como no logradas.

### Conversión a nota
`Equivalencia sobre 20 = porcentaje ÷ 5` → 100 % = 20 · 90 % = 18 · 80 % = 16 · 70 % = 14 · 60 % = 12 · 50 % = 10.

### Guardado seguro
- Los resultados se envían al empezar, mientras el alumno navega (unos segundos después de cada cambio de desafío), al terminar cada misión y al terminar la aventura.
- Los envíos son acumulativos y quedan en cola si no hay internet; se reintentan cada 30 segundos y al volver la conexión.
- Cada fila tiene una **clave única**: si un envío llega varias veces (al avanzar, retroceder o actualizar), **se actualiza la fila en vez de duplicarse**.
- Cada alumno se guarda **solo en las hojas de su división**.
- Al terminar, **“Terminar y dejar la compu lista”** deja la pantalla lista para el próximo alumno (los envíos pendientes se conservan hasta llegar).

### Panel docente (`#docente`)
Filtro por división (4.º A, 4.º B o ambas) · resumen por misión, área y división · porcentaje de error por contenido · ítems con más errores · búsqueda por apellido o nombre con el detalle de cada respuesta (respondida o sin responder) · alumnos con actividades pendientes · tabla de conversión a nota.
La clave se verifica **en el servidor de Google**; sin ella no se entregan datos. Tras 8 claves incorrectas, el acceso se bloquea 10 minutos.

### Privacidad
Se pide solo grado y división, nombre y apellido. La URL del servicio solo permite **agregar** resultados; para leerlos hace falta la clave docente.

### Si ya habías instalado la versión anterior
1. En Apps Script, reemplazá todo el código por el nuevo `google-apps-script.gs` y guardá.
2. En la planilla, ejecutá **🧭 Misión Ciencia → 1. Preparar las hojas**.
3. **Implementar → Administrar implementaciones → ✏️ → Versión: Nueva versión → Implementar** (la URL no cambia).
4. Subí a GitHub los nuevos `index.html`, `styles.css` y `script.js`. Las hojas viejas (`RESULTADOS GENERALES`, etc.) ya no se usan y se pueden borrar.

### Personalizar
Todas las consignas, opciones, respuestas y explicaciones están en `script.js`, sección **4. MISIONES Y ACTIVIDADES**. Al abrir la página, un control de calidad automático revisa el banco (abrí la consola del navegador con F12 para ver el resultado).

## Problemas frecuentes
| Situación | Solución |
|---|---|
| Arriba dice “💾 Guardado en esta compu” | Falta pegar la URL en `script.js` (paso 3). |
| Dice “Pendiente: se reintentará” | Revisá que la implementación tenga acceso **Cualquier usuario** y que la URL termine en `/exec`. |
| La app dice “Solo se acepta 4A o 4B” | Escribir el número y la letra juntos: `4A`, `4a`, `4B` o `4b`. |
| El panel dice “Falta establecer la clave docente” | Menú 🧭 Misión Ciencia → 2 en la planilla. |
| Cambié el `.gs` y no se nota | Publicá una **Nueva versión** de la implementación existente. |
| GitHub Pages muestra error 404 | Esperá 2 minutos y verificá que `index.html` esté en la raíz del repositorio. |
