---
name: modo-duo
description: Recomienda y pone en marcha el modo equipo (el coordinador reparte una tarea grande en un plan y la ejecuta con varios agentes que trabajan a la vez y se hablan por una pizarra; el caso de dos agentes, analista e implementador, sigue existiendo). Úsala cuando la tarea sea grande y se pueda dividir, por ejemplo migraciones de objetos o datos (como el objeto Placement de Salesforce/SFDC), refactors que tocan muchas clases, cambios de modelo de datos, renombrados en todo el proyecto o integraciones nuevas. No la uses para cambios pequeños, preguntas o arreglos de uno o dos archivos.
---

# Modo equipo (duo)

El mod **duo** está instalado y ofrece estos tipos de agente, una pizarra compartida y un plan de tareas. Tú eres el **coordinador**:

- `duo:analista`: explora el código y decide qué cambiar. No modifica archivos.
- `duo:implementador`: construye el cambio siguiendo lo que le pasa el analista.
- `duo:trabajador`: agente genérico que se encarga de UNA tarea del plan, toca solo sus archivos y la marca como hecha.
- `duo:entregas`: prepara el paquete (package.xml), valida en sandbox sin desplegar y deja la rama, los commits y el pull request listos. Nunca toca producción ni fusiona.
- La pizarra: `mcp__duo__enviar { para, texto }` (para = nombre de un agente, `coordinador`, `tester` o `todos`) y `mcp__duo__leer {}` (con el resumen del plan arriba).
- El plan: `mcp__duo__plan { tareas }` y `mcp__duo__tarea { id, estado, nota? }`.

## Cómo decidir

1. Tarea pequeña: hazla tú, sin equipo.
2. Tarea grande: divídela en subtareas con `mcp__duo__plan` (cada una con `id`, `titulo`, `detalle`, `dependeDe` y `archivos`). Las independientes van a la vez; las que tocan los mismos archivos, en secuencia con `dependeDe`. El plan rechaza ids repetidos, dependencias que no existen y ciclos.
3. Si primero hay que entender el impacto, empieza con un `duo:analista` (o una tarea de análisis) y crea el plan con lo que encuentre.
4. Lanza un `duo:trabajador` por cada tarea sin dependencias pendientes, a la vez y en segundo plano (`run_in_background: true`), con `name` igual al id de la tarea y la descripción empezando por ese id. Pásale en el prompt el id, el detalle y los archivos. Hay un máximo de agentes a la vez (opción `maxAgentes`, 5 por defecto): pasado ese límite el lanzamiento se rechaza hasta que termine alguno.
5. Los agentes marcan sus tareas; cuando una termina se te avisa de las que quedan desbloqueadas: lánzalas. Si una falla o se bloquea, decide: reintentar, reasignar o preguntar al usuario.
6. En tareas de Salesforce con entrega, añade al plan una tarea final que dependa de todas las demás y lánzala con `duo:entregas`.
7. Al final revisa el conjunto (`git diff` y pruebas) y resume al usuario qué se hizo y qué queda pendiente.

## Reservas de archivos

Cada archivo lo edita un solo agente a la vez: si otro intenta editar uno que ya está en uso, se le deniega y se le dice quién lo tiene. Se liberan cuando el agente termina (o si lleva 1 hora sin dar señales). Tú nunca te bloqueas. Por seguridad, los agentes del equipo no pueden hacer push forzado, subir a main, fusionar pull requests ni desplegar fuera de la org de pruebas: un `sf project deploy start` solo pasa si lleva `--target-org <orgApex>` (la org de pruebas de /config); sin ella configurada, solo `sf project deploy validate`. Pásales siempre el alias de la sandbox en el encargo.

## Tester de Apex

Si el proyecto es de Salesforce, cada vez que se modifica una clase (`.cls`) o un trigger (`.trigger`) que no es de test, el mod lo apunta y, al acabar el turno, lanza él solo un agente `duo:tester-apex` en segundo plano (o le pasa las clases nuevas si ya está trabajando). Ese agente crea y ejecuta los tests hasta llegar a la cobertura mínima, solo en sandbox o scratch org, y avisa al coordinador con el resultado. No lo lances tú a mano. Se ve en `/duo-seguimiento` y puede escribir y recibir mensajes en la pizarra como `tester`.

Opciones en `/config` (mod duo): `testerApex` (activarlo o no), `coberturaMinima` (75 % por defecto), `orgApex` (alias de la org de pruebas), `maxAgentes` (5), `ramaBase` (rama desde la que entregas crea la suya; vacío = la principal), `crearPR` (que entregas abra el pull request; sí por defecto) y el modelo de cada agente: `modeloAnalista` (opus), `modeloImplementador`, `modeloTrabajador`, `modeloEntregas` y `modeloTester` (sonnet); `inherit` usa el mismo modelo que la conversación.

## Cuándo recomendarlo

Merece la pena el modo equipo si se cumplen **dos o más** de estas condiciones:

1. Afecta a muchos archivos o clases (más de 5, o no sabes cuántos todavía).
2. Se puede dividir en partes que avanzan a la vez sin pisarse los archivos.
3. Es una migración, un cambio de modelo de datos o un refactor transversal.
4. Hay que averiguar el impacto antes de tocar nada, y mientras se sigue investigando ya se pueden empezar piezas.

Si no se cumplen, hazlo tú directamente: para tareas pequeñas solo añade coste y tiempo. Con dos partes claras (entender e implementar) basta el caso de dos agentes: `duo:analista` y `duo:implementador`.

## Cómo recomendarlo

Antes de lanzarlo, díselo al usuario en una o dos frases, en español: por qué conviene y qué va a pasar. Por ejemplo:

> Esta migración toca muchas clases que se pueden repartir. Voy a usar el modo equipo: la divido en un plan y varios agentes trabajan a la vez, coordinados entre ellos. ¿Te parece bien?

Si el usuario ya pidió el modo equipo o usó `/duo`, no preguntes: ponlo en marcha. Con `/duo-panel` ve la conversación y con `/duo-seguimiento` el plan y lo que hace cada agente.

## Si algo falla

- Si los tipos `duo:*` no aparecen, el mod no está cargado: dile al usuario que ejecute `/reload-plugins` o que lo instale con `/plugin install duo@claude-mods`.
- Si un agente se bloquea o pregunta algo que solo sabe el usuario, pregúntaselo y pásale la respuesta por la pizarra.
- Si un archivo está reservado por un agente que no responde, pídele que lo suelte por la pizarra o párale el agente.
