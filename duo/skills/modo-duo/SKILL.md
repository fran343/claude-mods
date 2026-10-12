---
name: modo-duo
description: Recomienda y pone en marcha el modo duo (un agente analista y otro implementador que trabajan a la vez y se hablan por una pizarra). Úsala cuando la tarea sea grande y tenga dos partes claras, entender el impacto y construir el cambio, por ejemplo migraciones de objetos o datos (como el objeto Placement de Salesforce/SFDC), refactors que tocan muchas clases, cambios de modelo de datos, renombrados en todo el proyecto o integraciones nuevas. No la uses para cambios pequeños, preguntas o arreglos de uno o dos archivos.
---

# Modo duo

El mod **duo** está instalado y ofrece dos tipos de agente y una pizarra compartida:

- `duo:analista`: explora el código y decide qué cambiar (clases, triggers, tests, metadatos, dependencias, riesgos). No modifica archivos.
- `duo:implementador`: construye el cambio por bloques siguiendo lo que le pasa el analista, y le avisa de cada bloque para que lo revise.
- La pizarra: `mcp__duo__enviar { para, texto }` y `mcp__duo__leer {}`. Tú eres el **coordinador**.

## Tester de Apex

Si el proyecto es de Salesforce, cada vez que se modifica una clase (`.cls`) o un trigger (`.trigger`) que no es de test, el mod lo apunta y, al acabar el turno, lanza él solo un agente `duo:tester-apex` en segundo plano (o le pasa las clases nuevas si ya está trabajando). Ese agente crea y ejecuta los tests hasta llegar a la cobertura mínima, solo en sandbox o scratch org, y avisa al coordinador con el resultado. No lo lances tú a mano. Se ve en `/duo-seguimiento` y puede escribir y recibir mensajes en la pizarra como `tester`.

Opciones en `/config` (mod duo): `testerApex` (activarlo o no), `coberturaMinima` (75 % por defecto), `orgApex` (alias de la org de pruebas) y el modelo de cada agente: `modeloAnalista` (opus), `modeloImplementador` (sonnet) y `modeloTester` (sonnet); `inherit` usa el mismo modelo que la conversación.

## Cuándo recomendarlo

Valora la tarea antes de empezar. Merece la pena el modo duo si se cumplen **dos o más** de estas condiciones:

1. Afecta a muchos archivos o clases (más de 5, o no sabes cuántos todavía).
2. Hay que averiguar el impacto antes de tocar nada (dependencias, referencias, datos existentes).
3. Es una migración, un cambio de modelo de datos o un refactor transversal.
4. El análisis y la implementación pueden avanzar a la vez: hay piezas que se pueden empezar mientras se sigue investigando.

Si no se cumplen, hazlo tú directamente, sin modo duo: para tareas pequeñas solo añade coste y tiempo.

## Cómo recomendarlo

Antes de lanzarlo, díselo al usuario en una o dos frases, en español: por qué conviene en este caso y qué va a pasar. Por ejemplo:

> Esta migración toca muchas clases y conviene analizar el impacto mientras se implementa. Voy a usar el modo duo: un agente analiza y otro implementa a la vez, y se coordinan entre ellos. ¿Te parece bien?

Si el usuario ya pidió el modo duo o usó `/duo`, no preguntes: ponlo en marcha.

## Cómo ponerlo en marcha

1. Reúne el contexto que ya tengas: la tarea exacta, el repositorio, las restricciones y lo que el usuario haya dicho.
2. Lanza **en el mismo mensaje** dos llamadas a la herramienta Agent, las dos con `run_in_background: true`:
   - `subagent_type: "duo:analista"`, con la tarea completa y el contexto.
   - `subagent_type: "duo:implementador"`, con la misma tarea y el mismo contexto.
3. Dile al usuario que puede ver la conversación entre los dos con `/duo-panel`.
4. Mientras trabajan, lee la pizarra (`mcp__duo__leer`) cuando te llegue un mensaje para el coordinador. Responde con `mcp__duo__enviar` si te preguntan algo o si ves que se desvían.
5. Cuando terminen los dos, revisa los cambios (por ejemplo con `git diff`), ejecuta las pruebas del proyecto si las hay y resume al usuario:
   - qué se analizó (impacto y riesgos),
   - qué se cambió (archivos),
   - qué queda pendiente o conviene revisar a mano.

## Si algo falla

- Si los tipos `duo:analista` o `duo:implementador` no aparecen, el mod no está cargado: dile al usuario que ejecute `/reload-plugins` o que lo instale con `/plugin install duo@claude-mods`.
- Si un agente se bloquea o pregunta algo que solo sabe el usuario, pregúntaselo al usuario y pásale la respuesta por la pizarra.
