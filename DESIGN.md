---
name: Panel Ollama
description: Panel web para administrar los modelos de Ollama en un servidor con 4 GPU de 12 GB.
colors:
  ground: "#f2f5f5"
  surface: "#ffffff"
  sunken: "#e7ecec"
  ink: "#10181b"
  ink-2: "#44555b"
  line: "#c9d2d4"
  line-strong: "#10181b"
  rail: "#0e2f38"
  rail-ink: "#e8f1f2"
  rail-ink-2: "#a3bcc1"
  rail-line: "#24505b"
  accent: "#f2c200"
  accent-hover: "#ffd633"
  accent-ink: "#10181b"
  rail-alert: "#ffb4ab"
  focus: "#0e2f38"
  ok: "#17703d"
  warn: "#855600"
  bad: "#b3261e"
  bad-ground: "#fbeceb"
  bar: "#0e2f38"
  bar-track: "#dbe2e3"
  ground-dark: "#0b1316"
  surface-dark: "#111c20"
  sunken-dark: "#0a1114"
  ink-dark: "#e9eff0"
  ink-2-dark: "#a2b3b8"
  line-dark: "#27383d"
  line-strong-dark: "#e9eff0"
  rail-dark: "#0f3540"
  rail-ink-2-dark: "#a9c3c8"
  rail-line-dark: "#22525e"
  focus-dark: "#f2c200"
  ok-dark: "#62d08c"
  warn-dark: "#f0b94a"
  bad-dark: "#ff8f85"
  bad-ground-dark: "#2a1513"
  bar-dark: "#8fb9c2"
  bar-track-dark: "#1d2c31"
typography:
  headline:
    fontFamily: "Barlow Semi Condensed, Barlow, Segoe UI, system-ui, sans-serif"
    fontSize: "1.625rem"
    fontWeight: 600
    lineHeight: 1.15
  title:
    fontFamily: "Barlow Semi Condensed, Barlow, Segoe UI, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.3
  figure:
    fontFamily: "Barlow Semi Condensed, Barlow, Segoe UI, system-ui, sans-serif"
    fontSize: "2.25rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.01em"
    fontFeature: "tnum"
  cell-strong:
    fontFamily: "Barlow Semi Condensed, Barlow, Segoe UI, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.2
    fontFeature: "tnum"
  body:
    fontFamily: "Barlow, Segoe UI, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.45
    fontFeature: "tnum"
  label:
    fontFamily: "Barlow Semi Condensed, Barlow, Segoe UI, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.2
  control:
    fontFamily: "Barlow Semi Condensed, Barlow, Segoe UI, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 500
    lineHeight: 1
  mono:
    fontFamily: "ui-monospace, Cascadia Mono, Consolas, DejaVu Sans Mono, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  hair: "1px"
  seal: "2px"
  base: "3px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  block: "14px 16px"
  lg: "16px"
  xl: "28px"
components:
  button:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.control}"
    rounded: "{rounded.base}"
    padding: "8px 12px"
    height: "34px"
  button-hover:
    backgroundColor: "{colors.sunken}"
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    typography: "{typography.control}"
    rounded: "{rounded.base}"
    padding: "8px 12px"
    height: "34px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-danger:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.bad}"
    rounded: "{rounded.base}"
    padding: "8px 12px"
  button-danger-hover:
    backgroundColor: "{colors.bad-ground}"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.base}"
    padding: "7px 9px"
    height: "34px"
  rail:
    backgroundColor: "{colors.rail}"
    textColor: "{colors.rail-ink}"
    width: "216px"
  rail-link:
    textColor: "{colors.rail-ink-2}"
    typography: "{typography.control}"
    rounded: "{rounded.base}"
    padding: "8px 10px"
  rail-link-hover:
    backgroundColor: "{colors.rail-line}"
    textColor: "{colors.rail-ink}"
  rail-link-current:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
  block:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.base}"
    padding: "{spacing.block}"
  segmented-option:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.control}"
    padding: "7px 12px"
  segmented-option-checked:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
  gpu-option:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.base}"
    padding: "9px 10px"
  fit-seal:
    typography: "{typography.label}"
    rounded: "{rounded.seal}"
    padding: "3px 7px"
  ficha:
    backgroundColor: "{colors.sunken}"
    padding: "14px 16px 18px"
  meter:
    backgroundColor: "{colors.bar-track}"
    rounded: "{rounded.hair}"
    height: "10px"
  dialog:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.base}"
    padding: "20px"
    width: "min(440px, calc(100vw - 32px))"
---

# Design System: Panel Ollama

## Overview

**Creative North Star: "La caja de la tarjeta gráfica"**

El panel se lee como la tabla de especificaciones impresa en la caja de una GPU: pares clave y valor separados por filetes de 1 px, cifras grandes en semicondensada con la unidad en pequeño, un riel petróleo a toda altura y un único amarillo de etiqueta. La información más valiosa (qué ocupa cada tarjeta y si un modelo cabe en 4 x 12 GB) se presenta como dato técnico, no como gráfico decorativo.

La densidad es de herramienta de trabajo: bloques blancos planos sobre un fondo gris frío, cada uno coronado por un filete de tinta de 2 px, tablas que no esconden columnas y estados que se nombran con palabras. El sistema funciona en claro y en oscuro; el tema sigue al sistema operativo y se puede fijar a mano.

Se rechaza el panel de tarjetas de métricas con gráfico decorativo. Cuando no hay dato, el panel lo dice con una frase que explica por qué y qué hacer; nunca rellena con cifras de ejemplo.

**Key Characteristics:**
- Riel de navegación petróleo de 216 px a toda altura.
- Superficies planas con filete superior de tinta; radio de 3 px en todo.
- Amarillo de etiqueta reservado a la acción primaria y a la selección.
- Cifras tabulares en Barlow Semi Condensed con la unidad pequeña y atenuada.
- Veredicto de cabida como sello con una celda por GPU.

## Colors

Una paleta fría casi monocroma de petróleo y tinta, con un solo acento amarillo y tres colores de estado.

### Primary
- **Amarillo de etiqueta** (accent): fondo de la acción primaria de cada formulario, del enlace activo del riel, de la opción marcada del selector segmentado, del botón "Cerrar ficha" con la ficha abierta y de `::selection`. Siempre con tinta casi negra encima (accent-ink). Al pasar el puntero sube a un amarillo más claro (accent-hover). En oscuro es el mismo valor y además es el color del anillo de foco.

### Secondary
- **Petróleo profundo** (rail): fondo del riel, relleno de las barras de memoria (bar) y anillo de foco en claro. En oscuro el riel se aclara un punto (rail-dark) y la barra pasa a un petróleo lavado (bar-dark) para leerse sobre fondo negro.

### Tertiary
- **Verde de cabida** (ok): sello "Cabe en 1 GPU" y operaciones terminadas.
- **Ámbar de reparto** (warn): sello "Repartido en N GPU" y barra de memoria por encima del 90 %.
- **Rojo de no cabe** (bad, sobre bad-ground): sello "No cabe, usará RAM", avisos de error, operaciones fallidas y botones destructivos.

### Neutral
- **Gris frío de fondo** (ground): lienzo de la página.
- **Blanco de bloque** (surface): bloques, controles, diálogo.
- **Gris hundido** (sunken): ficha a sangre, `pre`, `code`, mensaje del usuario en el chat y hover de botones.
- **Tinta** (ink) y **tinta segunda** (ink-2): texto principal y texto de etiquetas, unidades, notas y `placeholder`.
- **Filete** (line) y **filete fuerte** (line-strong): separadores de filas y bordes de campos; el fuerte es tinta y marca la cabecera de los bloques, la cabecera de tabla, el borde de botones y la selección del selector de GPU.

### Named Rules
**La regla del amarillo único.** El amarillo solo marca la acción primaria y la selección actual. Nunca decora, nunca es un estado ni un dato. Un formulario lleva como mucho un botón amarillo.

**La regla del estado con palabras.** Verde, ámbar y rojo siempre van con texto que nombra el estado ("Cabe en 1 GPU", "Repartido en 3 GPU", "No cabe, usará RAM"); el color refuerza, no informa solo.

## Typography

**Display Font:** Barlow Semi Condensed (con Barlow, Segoe UI, system-ui)
**Body Font:** Barlow (con Segoe UI, system-ui)
**Label/Mono Font:** Barlow Semi Condensed para etiquetas; ui-monospace / Cascadia Mono / Consolas para registros y Modelfiles.

**Character:** La semicondensada pone voz de hoja técnica a títulos, etiquetas, controles y cifras; la Barlow normal mantiene el texto corrido legible. Ambas autoalojadas en `static/fonts`, sin dependencias externas. Toda la página usa cifras tabulares.

### Hierarchy
- **Headline** (600, 1.625rem, 1.15): título de cada sección, con `text-wrap: balance`.
- **Title** (600, 1.125rem, 1.3): título de bloque y subtítulos.
- **Figure** (600, 2.25rem, 1, -0.01em): memoria usada de cada GPU; la unidad va en `small` a 0.8125rem, 500, tinta segunda.
- **Cell strong** (600, 1rem, 1.2): nombre de modelo y cifras de tabla, títulos de operación y `h4`.
- **Body** (400, 0.9375rem, 1.45): texto y campos; párrafos limitados a 72ch, mensajes del chat a 78ch.
- **Label** (500, 0.875rem, 1.2-1.35): `label`, `dt`, cabeceras de tabla, leyendas, nombre de GPU y sello de veredicto; siempre en caja normal, sin versalitas ni espaciado.
- **Mono** (400, 0.8125rem, 1.5): `pre`, `code`, campos `.code`.

### Named Rules
**La regla de la unidad pequeña.** Toda cifra con unidad se escribe como número grande y unidad aparte, en semicondensada 500 a 0.75em y tinta segunda ("4.7 GB", "8 K", "7.6 B"). El número es el dato; la unidad lo acompaña.

## Layout

Rejilla de dos columnas en escritorio: riel fijo de 216 px y contenido `minmax(0, 1fr)` con relleno 22px 28px 64px y ancho máximo de 1280 px. Los bloques se apilan con 14 px entre sí; el relleno interior es 14px 16px. Los formularios son filas flexibles (`flex: 1 1 240px`, separación 12px 16px) alineadas abajo; las acciones van en una fila con 8 px y la acción destructiva se separa al extremo derecho. La ficha técnica (`dl`) se reparte en columnas de mínimo 300 px con 28 px de calle. La memoria de vídeo usa columnas iguales de mínimo 170 px separadas por filetes verticales.

Por debajo de 820 px el cuerpo pasa a una columna, el riel se pliega tras un botón "Menú", el relleno baja a 16px, todos los controles suben a 44 px de alto, los filetes verticales entre GPU se vuelven horizontales y las tablas `stack` se apilan (ver Components).

## Elevation & Depth

Sistema plano. La jerarquía se construye con tono (ground, surface, sunken) y con filetes, no con sombras. Bloques, controles y tablas no llevan sombra en ningún estado; el botón al pulsarse baja 1 px.

### Shadow Vocabulary
- **Diálogo modal** (`box-shadow: 0 12px 32px rgb(0 0 0 / 0.28)` y fondo `rgb(8 16 19 / 0.55)`): única sombra del sistema, solo para el diálogo de confirmación sobre su telón.

### Named Rules
**La regla del filete.** La profundidad se dice con líneas: 1 px de filete entre filas y campos, 2 px de tinta en la cabecera de cada bloque, 1 px de tinta bajo la cabecera de tabla. La sombra está reservada al modal.

## Shapes

Esquinas apenas suavizadas: 3 px en bloques, botones, campos, enlaces del riel, selector de GPU, `pre` y diálogo; 2 px en el sello de veredicto, el `code` y los esqueletos de carga; 1 px en barras de memoria y celdas del sello. Los selectores segmentados solo redondean sus extremos y solapan sus bordes 1 px. La caja de los controles es rectangular y la línea manda sobre el relleno.

## Components

### Buttons
Rectangulares, firmes, con borde de tinta.
- **Shape:** esquinas de 3 px, alto mínimo 34 px (44 px en móvil), relleno 8px 12px, semicondensada 500 a 0.9375rem.
- **Base:** fondo blanco, tinta, borde de 1 px de tinta; hover a gris hundido; pulsado baja 1 px; deshabilitado al 55 % de opacidad.
- **Primary:** amarillo de etiqueta con tinta y borde de tinta; hover al amarillo claro. Uno por formulario.
- **Quiet:** como el base pero con borde de filete claro; para acciones secundarias ("Ficha", "Cancelar", "Descargar todos de memoria").
- **Danger:** texto y borde rojos, hover sobre fondo rojo pálido; en las filas se separa 18 px de las demás acciones.

### Inputs / Fields
- **Style:** fondo blanco, filete de 1 px, radio de 3 px, relleno 7px 9px, alto 34 px; etiqueta encima en semicondensada 500 a 0.875rem, tinta segunda.
- **Hover / Focus:** el borde pasa a tinta segunda; foco con contorno de 2 px a 2 px de separación (petróleo en claro, amarillo en oscuro y dentro del riel).
- **Variantes:** `textarea` de 84 px redimensionable en vertical; campos `.code` en monoespaciada; botón de archivo con el mismo aspecto que un botón base; casillas de 16 px teñidas de petróleo.

### Navigation
Riel petróleo a toda altura, pegajoso, con filete derecho. Marca "Panel Ollama" en semicondensada 600 a 1.25rem. Enlaces en semicondensada 500 a 1rem, tinta de riel atenuada, con contador a la derecha; hover sobre el petróleo de filete; la sección actual (`aria-current="page"`) en amarillo de etiqueta con tinta. Pie con el estado del servidor y el botón de tema con bordes de riel. En móvil el riel es estático y se despliega con "Menú" (44 px); los enlaces crecen a 13 px de relleno vertical.

### Bloques
Contenedor de cada grupo: fondo blanco, filete de 1 px, cabecera de 2 px de tinta, radio de 3 px, relleno 14px 16px. Su título empieza pegado arriba. Una barra de herramientas opcional pone título, buscador y conmutadores en la misma fila.

### Tablas apiladas en móvil
Cabecera en etiqueta con filete de tinta debajo; filas separadas por filete claro. Nombre de modelo y cifras en semicondensada 600; cifras alineadas a la derecha con la unidad pequeña. Las cabeceras ordenables son botones sin aspecto que muestran un triángulo enmascarado. Por debajo de 820 px la tabla `stack` oculta su cabecera (sigue para lectores de pantalla), cada fila es un bloque separado por filete de tinta y cada celda es una línea etiqueta (de `data-label`) / valor; las acciones de fila se reparten y "Borrar" se va al extremo.

### Sello de veredicto
Recuadro de 1 px en el color del estado (`currentColor`), radio de 2 px, relleno 3px 7px, etiqueta semicondensada 600 a 0.875rem. Delante, una celda de 8 x 13 px por cada GPU disponible; se rellenan las que el modelo necesita. Verde si cabe en una, ámbar si se reparte, rojo si no cabe. El `title` explica la cifra y si es medida por Ollama o estimada. Sin datos de GPU, el sello se sustituye por la nota "Sin datos de GPU".

### Selector segmentado
Radios reales ocultos con aspecto de bloque: opciones contiguas de 1 px de filete solapado, semicondensada 500, extremos con radio de 3 px. Hover a gris hundido; la opción marcada en amarillo de etiqueta con borde de tinta; foco con el contorno estándar. En móvil cada opción crece a 12px 14px.

### Selector de GPU
Rejilla de casillas tarjeta (mínimo 180 px, 8 px de separación): fondo blanco, filete, radio de 3 px, relleno 9px 10px, casilla real a la izquierda, nombre y memoria libre en texto de 0.8125rem debajo. Seleccionada, el borde pasa a tinta con un segundo filete interior de 1 px; no usa amarillo, porque es una selección múltiple dentro de un formulario cuya acción primaria ya es amarilla.

### Ficha a sangre
Al abrir "Ficha", la fila de la tabla se cierra y debajo aparece una fila de detalle que ocupa todas las columnas a sangre: fondo gris hundido entre dos filetes de tinta, relleno 14px 16px 18px. Dentro, ficha técnica a la izquierda (1.4fr) y panel de carga a la derecha (mínimo 280 px) separado por un filete vertical; en móvil se apilan con filete horizontal.

### Bandeja de operaciones
Bloque fijo al principio del contenido, visible solo con operaciones activas. Cada operación es una fila: título en semicondensada 600, estado en 0.875rem tinta segunda (verde al terminar, rojo al fallar), barra de progreso de 10 px y botón a la derecha a toda altura. Si el progreso es desconocido, la barra se desliza (1.4 s); con movimiento reducido queda fija al 50 % de opacidad.

### Medidor de memoria
Pista de 10 px en bar-track con radio de 1 px; relleno petróleo que anima su ancho en 250 ms con `cubic-bezier(.16,1,.3,1)`; por encima del 90 % pasa a ámbar.

### Diálogo de confirmación
`dialog` nativo de 440 px como máximo: fondo blanco, borde de tinta, radio de 3 px, relleno 20 px, la única sombra del sistema. Título, texto y acciones: "Cancelar" (quiet) a la izquierda con el foco inicial, para que Enter no confirme por accidente, y la acción destructiva en rojo al extremo derecho.

### Avisos
Franja pegajosa encima del contenido: blanco con borde de tinta; en error, rojo sobre rojo pálido con `role="alert"`. Siempre con botón "Cerrar".

## Do's and Don'ts

### Do:
- **Do** reservar el amarillo de etiqueta a la acción primaria, la sección actual y la opción marcada.
- **Do** escribir cada cifra con la unidad aparte, pequeña y en tinta segunda, y alinear las columnas numéricas a la derecha con cifras tabulares.
- **Do** mostrar solo datos reales del servidor; si faltan, un párrafo `empty` que dice por qué y qué hacer ("Ningún modelo de Ollama en memoria. Pulsa Cargar...").
- **Do** usar esqueletos grises de 14 px mientras llega el dato, nunca cifras provisionales.
- **Do** separar con filetes de 1 px y coronar cada bloque con 2 px de tinta.
- **Do** nombrar cada estado con palabras además del color.
- **Do** pedir confirmación en un diálogo con el foco en "Cancelar" antes de cualquier borrado.
- **Do** subir todos los controles a 44 px por debajo de 820 px.

### Don't:
- **Don't** usar el amarillo para estados, datos, decoración o fondos de bloque.
- **Don't** inventar cifras, modelos de ejemplo ni gráficos de relleno cuando no hay datos.
- **Don't** construir tarjetas de métricas con gráfico decorativo; la memoria y la cabida se dan como ficha técnica.
- **Don't** poner sombras en bloques, botones o tablas; la sombra es solo del modal.
- **Don't** redondear por encima de 3 px.
- **Don't** escribir la unidad al mismo tamaño y peso que la cifra.
