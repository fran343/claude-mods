# Diseño: duo 0.4 "modo equipo"

Objetivo: el coordinador (la conversación principal) reparte una tarea en subtareas y la ejecuta con
TANTOS agentes como tenga sentido (de 1 a N), coordinándolos. Los papeles fijos analista/implementador
siguen existiendo como un caso particular.

## 1. Tipos de agente
- Se mantienen `duo:analista`, `duo:implementador` y `duo:tester-apex` (sin cambios de comportamiento).
- Nuevo `duo:trabajador`: genérico, todas las herramientas, modelo `modeloTrabajador` (userConfig, opciones
  opus/sonnet/haiku/inherit, por defecto sonnet). Su prompt: se encarga de UNA subtarea del plan; al empezar lee
  la pizarra y el plan (mcp__duo__leer); marca su tarea en curso (mcp__duo__tarea); solo toca los archivos de su
  tarea; si necesita algo de otro agente se lo pide por su nombre en la pizarra; al acabar marca la tarea como hecha
  (o fallida/bloqueada con una nota) y responde con un resumen de lo que ha cambiado.
- Nueva opción userConfig `maxAgentes` (number, por defecto 5): máximo de agentes del equipo trabajando a la vez.

## 2. Identidad por nombre
- Atom `equipo`: `Record<nombre, { agentId, tipo, tarea?: string, estado: DuoEstado }>`.
- Hook `agent.spawn`: para todo `subagentType` que empiece por `duo:` (el tester sigue con su lógica), tras `next`
  registra al agente con nombre = `e.name` si viene; si no, analista/implementador usan su rol y un trabajador usa
  la tarea (`T1`, …) que aparezca al principio de `e.description`, o `trabajador-N`. Nombres únicos.
- Si ya hay `maxAgentes` agentes del equipo trabajando, el spawn se rechaza con `{ deny }` explicando que espere a
  que termine alguno (no cuenta el tester de Apex).
- `turn.complete` de un miembro actualiza su estado (terminado/interrumpido/error) y libera sus archivos (punto 5).

## 3. Pizarra
- `mcp__duo__enviar.para`: un nombre del equipo, "coordinador", "tester" o "todos" (a todos los miembros
  activos). Si el nombre no existe: deny con la lista de nombres válidos. Ya no es un enum cerrado.
- `quienEs` devuelve el nombre del miembro (o "coordinador"/"tester").

## 4. Plan de tareas
- Atom `plan`: lista de `{ id, titulo, detalle?, dependeDe: string[], archivos: string[], agente?: string,
  estado: 'pendiente'|'en_curso'|'bloqueada'|'hecha'|'fallida', nota?: string }`.
- Herramienta `mcp__duo__plan` `{ tareas: [...] }`: crea o sustituye el plan (conserva el estado de los ids que ya
  existían). Valida ids únicos y dependencias que existan, sin ciclos.
- Herramienta `mcp__duo__tarea` `{ id, estado, nota? }`: cambia el estado. Al pasar a `hecha`, avisa al
  coordinador (append, o prompt.submit si falla, igual que enviar) con las tareas que han quedado desbloqueadas
  (todas sus dependencias hechas y aún pendientes). Al pasar a `fallida` o `bloqueada`, avisa al coordinador con la
  nota.
- `mcp__duo__leer` incluye arriba un resumen del plan.

## 5. Archivos reservados (evitar que dos agentes pisen el mismo archivo)
- `tool.call` Edit/Write/MultiEdit/NotebookEdit hecho por un miembro del equipo: si el archivo lo tiene reservado
  OTRO miembro que sigue trabajando → `{ deny: "<archivo> lo está editando <nombre> (tarea X). Pídeselo por la
  pizarra o espera a que termine." }`. Si no, se reserva para este miembro.
- Las reservas se liberan cuando el miembro termina (turn.complete). La conversación principal nunca se bloquea.
- Hay que integrarlo en el hook genérico de tool.call que ya existe (validate no admite dos sin matcher).

## 6. Panel Seguimiento
- Una tarjeta por miembro del equipo (dinámico) más la del tester; en pantallas estrechas, tarjetas compactas.
- Sección "Plan" arriba: cada tarea con icono de estado (○ pendiente, ◐ en curso, ⊘ bloqueada, ● hecha,
  ✕ fallida), agente y dependencias pendientes.

## 7. Cómo decide el coordinador (GUIA_COORDINADOR en prompt.compose y skill modo-duo)
1. Tarea pequeña → hazla tú.
2. Tarea grande → divídela en subtareas con `mcp__duo__plan`: independientes donde se pueda; las que tocan los
   mismos archivos, en secuencia (dependencias).
3. Si primero hay que entender el impacto, empieza con un `duo:analista` (o una tarea de análisis) y crea el plan
   con lo que encuentre.
4. Lanza un `duo:trabajador` por cada tarea sin dependencias pendientes, en paralelo, en segundo plano, con
   `name` = id de la tarea, hasta `maxAgentes`. Pásale en el prompt el id, el detalle y los archivos.
5. Cuando te avisen de tareas desbloqueadas, lánzalas. Si una falla, decide: reintentar, reasignar o preguntar al
   usuario.
6. Al final: revisa el conjunto (diff y pruebas) y resume al usuario.
- `/duo <tarea>` pasa a decir "trabaja esta tarea en modo equipo" con estas reglas.

## 8. Pruebas
Mantener las 10 actuales en verde y añadir: plan con dependencias y desbloqueo al marcar hecha; ciclo rechazado;
reserva de archivo (segundo agente denegado, se libera al terminar); enviar a un nombre inexistente → deny con
la lista; "todos"; panel con la sección Plan; maxAgentes.

## 9. Agente de entregas (`duo:entregas`)
Prepara el paquete y todo lo de GitHub, SIEMPRE contra sandbox. Nunca despliega en producción, nunca fusiona el PR,
nunca hace push directo a la rama principal ni force-push.
- Tipo `duo:entregas`, todas las herramientas, modelo `modeloEntregas` (userConfig, por defecto sonnet).
- userConfig nuevas: `ramaBase` (string, vacío = la rama principal del repositorio) y `crearPR` (boolean, por
  defecto true).
- Su prompt, en orden:
  1. Seguridad: igual que el tester (`sf org display --json`, solo sandbox o scratch; usa `orgApex` si está
     configurada). Si no es sandbox, avisa al coordinador y para.
  2. Componentes cambiados: `git status` y `git diff --name-only <ramaBase>...HEAD` dentro de los directorios del
     proyecto (sfdx-project.json → packageDirectories). Incluye las clases de test que haya creado el tester.
  3. Manifest: `sf project generate manifest --source-dir <rutas cambiadas> --output-dir manifest --name package`
     (y `destructiveChanges.xml` si hay componentes borrados). Revisa que no falte ni sobre nada.
  4. Validación sin desplegar: `sf project deploy validate --manifest manifest/package.xml --test-level
     RunSpecifiedTests --tests <tests de las clases tocadas> --wait 60` contra la sandbox. Si falla, avisa por la
     pizarra al agente responsable (o al coordinador) con el error, espera a que lo arreglen y repite.
  5. GitHub: rama nueva `feature/<resumen-corto>` desde `ramaBase`; commits en español que expliquen el cambio;
     `git push -u origin <rama>`; si `crearPR`, `gh pr create` con: resumen, lista de componentes, tests y
     cobertura (lo que diga el tester), id de la validación en sandbox y pasos manuales si los hay. Sin fusionar.
  6. Responde al coordinador con el enlace del PR, la rama y el resultado de la validación.
- Puede trabajar desde el principio en paralelo (ir preparando el manifest con lo que ya esté hecho y
  actualizándolo) y hacer la pasada final cuando el resto de tareas estén hechas. En el plan, la tarea de entrega
  depende de todas las demás.
- La GUIA_COORDINADOR y la skill deben decir: en tareas de Salesforce con entrega, añade al plan una tarea final
  de entregas y lánzala con `duo:entregas`.
- Pruebas: el agente se registra con el modelo de /config y aparece en Seguimiento como un miembro más.
