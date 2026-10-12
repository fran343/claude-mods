# Diseño: mod pruebas-e2e 0.1 (Playwright bajo demanda)

Objetivo: con `/playwright [qué probar]` (y solo entonces), un agente aparte lee el manifest (package.xml) y el
contexto del desarrollo, escribe pruebas Playwright de extremo a extremo de lo implementado y las ejecuta contra la
SANDBOX de Salesforce hasta que pasen o hasta encontrar un fallo real del desarrollo. Nunca contra producción.

Carpeta: `/home/user/claude-mods/pruebas-e2e`. Ya existen `.claude-plugin/plugin.json` (userConfig: orgPruebas,
manifest, carpetaTests, ramaBase, navegador, ejecutar, modelo), `hooks/hooks.json` y `types/index.d.ts` (estado
`E2eEstado` en el atom `{ plugin: 'pruebas-e2e', key: 'estado' }`). NO cambies esos contratos sin avisar al
coordinador.

API de mods: `/tmp/claude-0/bundled-skills/2.1.296/3f50f45bb632f75484bc9e8e80d7b4e0/plugin-authoring/types/claude-code.d.ts`
(enorme, busca por nombre) y `.../plugin-authoring/reference.md`. Como modelo de estilo, mira el mod duo en
`/home/user/claude-mods/duo` (register.tsx, equipo.ts, tests). Textos en español de España, cercanos y sin tecnicismos
innecesarios en lo que ve el usuario.

## Reparto en archivos (cada tarea es dueña de los suyos)

### T1. `hooks/register.tsx`: el cableado (depende del contrato de T2 y T3, no de su código)
- `session.start`: `$.agent.register({ name: 'playwright', description, prompt: promptPlaywright(opciones), model, tools
  sin restringir })`; comandos `/playwright` (argumentHint `[qué probar]`) y `/playwright-panel`.
- `agent.offer` para `pruebas-e2e:playwright` → `{ isOffered: false }`: el modelo NO lo lanza por su cuenta; solo el
  comando (requisito: "no siempre, solo cuando se lo pida").
- `command.run` `/playwright`: si ya hay una ejecución en marcha, decirlo y no lanzar otra. Si no: leer el manifest con
  `$.fs.read(opciones.manifest)` (si no existe, seguir: el agente lo deducirá del diff), `parseManifest`, guardar el
  estado (fase 'preparando', componentes, peticion = args), abrir el panel y `$.agent.spawn({ subagentType:
  'pruebas-e2e:playwright', description: 'Pruebas Playwright', prompt: encargo({...}) })`. Guardar agentId.
  Responder con un texto corto (cuántos componentes ha visto y que el panel muestra el avance).
- `tool.call` sin matcher (UNO solo, validate no admite dos): si `e.agentId` es el del agente, anotar actividad
  (`describirPaso`) antes de `next`; después de `next`: si es Write/Edit de un archivo `esSpec`, añadirlo a `specs`
  y fase 'escribiendo'; si es Bash con `npx playwright test` (o `playwright test`), fase 'ejecutando' antes y, tras
  `next`, `resultadoPlaywright(r.text)` → añadir a `ejecuciones`. `.catch(($, e, next) => next(e))`.
- `turn.complete` del agente: fase terminado/interrumpido/error, `fin`, `resultado` (answer recortada); avisar a la
  conversación principal con `$.session.append` (y `$.prompt.submit` si falla) + `$.ui.toast`.
- Panel: `$.ui.open({ id: 'playwright', title: 'Playwright' })`; `ui.render` Pane `requestId: 'playwright'` →
  `return dibujarPanel($.ui.resolve(e), estado, ancho)` con ancho de `e.props.bodyColumns ?? e.viewport?.columns ?? 60`.
  Refrescar el tiempo con `$.clock.every(5000, ...)` + `$.ui.invalidate('ui.render')` mientras trabaje.

### T2. `hooks/prompt.ts`: lo que sabe el agente (sin `$`, solo texto)
- `export type OpcionesE2e = { org: string; manifest: string; carpeta: string; ramaBase: string; navegador: string; ejecutar: boolean }`
- `export function promptPlaywright(o: OpcionesE2e): string`: el prompt de sistema del agente. Debe cubrir:
  1. Seguridad: comprobar que la org es sandbox (`sf data query -q "SELECT IsSandbox FROM Organization" --target-org
     <org> --json`); si no, parar y avisar. `--target-org` en todos los comandos `sf`. No tocar código de producción
     del proyecto: solo crea/edita archivos dentro de la carpeta de pruebas y la config de Playwright. Nunca guardar
     credenciales ni sesiones en el repositorio (storageState en `.auth/` y en `.gitignore`).
  2. Contexto: leer el manifest; si no existe, `git diff --name-only <ramaBase>...HEAD` en los packageDirectories
     de sfdx-project.json. Leer el código de lo que ha cambiado (LWC, Aura, FlexiPages, Layouts, campos, objetos,
     Flows de pantalla, Apex que da servicio a la UI, permisos) y el contexto de la petición del usuario, el PR o los
     commits, para entender QUÉ debe poder hacer un usuario.
  3. Qué probar: casos de uso del usuario, no cada metadato. Mapa orientativo: CustomField/Layout → crear y editar el
     registro viendo y rellenando el campo; LWC/Aura → la pantalla donde está colocado y su interacción; Flow de
     pantalla → recorrerlo; ValidationRule → que bloquea con el mensaje correcto; PermissionSet → visible para quien
     debe; ApexClass/Trigger sin UI → efecto visible en registro o no hacer prueba e2e (lo cubren los tests Apex).
  4. Montaje Playwright (solo si falta): `@playwright/test` como devDependency, `playwright.config.ts` con
     `testDir` = carpeta, navegador elegido, `globalSetup` que abre sesión con `sf org open --url-only --json
     --target-org <org>` (frontdoor) y guarda `storageState` en `.auth/`. No instalar otros paquetes sin motivo.
  5. Buenas prácticas en Salesforce Lightning: localizadores por rol/etiqueta (`getByRole`, `getByLabel`) que
     atraviesan el shadow DOM; esperar a que la página Lightning termine de cargar; nada de esperas fijas; datos de
     prueba creados en la propia prueba (o con `sf data create record`) y borrados al final; nombres únicos con fecha;
     un archivo `<funcionalidad>.spec.ts` por caso de uso y page objects en `<carpeta>/pages/`.
  6. Si `ejecutar`: `npx playwright test <carpeta> --project=<navegador> --reporter=line`; si falla, distinguir: fallo
     de la PRUEBA (localizador, espera) → corregir y repetir (máx. 5 vueltas por prueba); fallo del DESARROLLO (la
     funcionalidad no hace lo que debe) → no "arreglar" la prueba para que pase: anotarlo como hallazgo.
  7. Respuesta final: tabla con prueba, qué comprueba y resultado; hallazgos del desarrollo; cómo ejecutarlas a mano.
- `export function encargo(o: { peticion: string; manifest: string; hayManifest: boolean; componentes: string;
  ramaBase: string }): string`: el primer mensaje del agente (lo que pidió el usuario con /playwright, ruta del
  manifest, resumen de componentes ya leído o la instrucción de deducirlos del diff).

### T3. `hooks/analisis.ts` (lógica pura, sin `$`) y `hooks/panel.tsx` (dibujo)
- `analisis.ts`:
  - `parseManifest(xml: string): E2eComponente[]` (tipos `<types><members>…</members><name>…</name></types>`,
    ignora `*` como comodín pero lo conserva como miembro "*", tolera espacios y comentarios).
  - `resumenComponentes(c: E2eComponente[], max = 40): string` (texto para el encargo: "ApexClass (3): A, B, C…").
  - `resultadoPlaywright(salida: string): { pasan: number; fallan: number; omitidas: number } | undefined` (reconoce
    "N passed", "N failed", "N skipped", "N flaky" (cuenta como pasan) del reporter line/list; undefined si no hay
    resumen).
  - `esSpec(ruta: string): boolean` (`.spec.ts`, `.spec.js`, `.test.ts` dentro de cualquier carpeta).
  - `describirPaso(tool: string, input: Record<string, unknown>): string` (en español: "Leyendo …", "Escribiendo
    prueba …", "Ejecutando las pruebas", "Consultando la org"…).
  - `duracion(ms)`, `hora()`, `corto(texto, max)` (como en duo).
- `panel.tsx`: `export function dibujarPanel(ui: <tabla de elementos>, estado: E2eEstado, ancho: number)` que
  devuelve el árbol JSX (usa `const { Box, Text } = ui`; el tipo de `ui` sácalo de la API, p. ej. el de retorno de
  `$.ui.resolve`). Muestra: fase con color y tiempo; petición; componentes (resumen por tipo, compacto); pruebas
  escritas; última ejecución "✓ N pasan · ✗ M fallan · K omitidas" e historial corto; actividad actual y últimos
  pasos; resultado al terminar. Usable a 40 columnas (compacto) y a 120.

### T4. `tests/*.test.ts(x)` y documentación (depende de T1, T2 y T3)
- Pruebas con `claude-code/testing`: parseManifest (varios tipos, comodín, vacío); resultadoPlaywright (line/list,
  con flaky, sin resumen); esSpec; el comando `/playwright` lanza el agente con el manifest en el encargo (stub de
  `fs.read` y `agent.spawn` como en duo/tests/apex.test.ts); segundo `/playwright` con uno en marcha no lanza otro;
  `agent.offer` oculta el agente; el panel se dibuja en terminal y desktop con y sin ejecuciones.
- README.md raíz: sección "pruebas-e2e" (qué hace, `/playwright`, requisitos: Node y Playwright en el proyecto, sf
  CLI con la sandbox; opciones de /config; seguridad) e instalación `/plugin install pruebas-e2e@claude-mods`.

## Comprobación (todas las tareas)
- `claude plugin validate /home/user/claude-mods/pruebas-e2e`
- `claude plugin test /home/user/claude-mods/pruebas-e2e`
- `tsc -p /tmp/claude-0/-home-user/c70e4e83-b27d-5706-85d1-e2c81279f9bf/scratchpad/tc-e2e/tsconfig.json`
