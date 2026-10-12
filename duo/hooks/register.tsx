import { atom, read, update } from 'claude-code'
import type { Hook, Register } from 'claude-code'

import type { DuoEquipo, DuoEstado, DuoEstadoTarea, DuoFicha, DuoMensaje, DuoApex, DuoPlan, DuoReservas, DuoSeguimiento, DuoTipo } from '../types'
import {
  ESTADOS_TAREA, ICONO_TAREA, activo, comandoProhibido, comprobarReserva, desbloqueadas, fusionarPlan, nombreLibre,
  nombreTrabajador, nombresValidos, normalizarTareas, pendientesDe, quitadasEnCurso, rutaReserva, resumenPlan, tareaDeDescripcion, validarPlan,
} from './equipo'

// Modo equipo: el coordinador reparte una tarea en un plan y la ejecuta con
// tantos agentes como tenga sentido (de 1 a N), que se hablan por una pizarra.
// Cada archivo lo edita un solo agente a la vez (reservas).

const PANEL = 'duo'
const SEGUIMIENTO = 'duo-seguimiento'
const pizarra = atom({ plugin: 'duo', key: 'pizarra' } as const, [] as DuoMensaje[])
const equipo = atom({ plugin: 'duo', key: 'equipo' } as const, {} as DuoEquipo)
const plan = atom({ plugin: 'duo', key: 'plan' } as const, [] as DuoPlan)
const reservas = atom({ plugin: 'duo', key: 'reservas' } as const, {} as DuoReservas)
const seguimiento = atom({ plugin: 'duo', key: 'seguimiento' } as const, {} as DuoSeguimiento)
const apex = atom({ plugin: 'duo', key: 'apex' } as const, { pendientes: [], enviadas: [], testerActivo: false } as DuoApex)

type Ctx = Parameters<Hook<'turn.complete'>>[0]

const HERRAMIENTAS_PIZARRA = ['mcp__duo__enviar', 'mcp__duo__leer']
const TIPOS: Record<string, DuoTipo> = {
  'duo:analista': 'analista',
  'duo:implementador': 'implementador',
  'duo:trabajador': 'trabajador',
  'duo:entregas': 'entregas',
}
const HERRAMIENTAS_EDICION = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']

const COMO_HABLAR = `
## Cómo hablar con tus compañeros
Trabajas en equipo y en paralelo con otros agentes. Os comunicáis SOLO con estas herramientas:
- mcp__duo__enviar { para, texto }: deja un mensaje en la pizarra. "para" es el nombre de un compañero del equipo (por ejemplo "analista", "implementador" o el id de una tarea como "T2"), "coordinador", "tester" (el tester de Apex, si está en marcha) o "todos" (a todos los que estén trabajando). El destinatario lo recibe al momento.
- mcp__duo__leer {}: lee la pizarra entera (lo que se han dicho) y, arriba, el resumen del plan.
Lee la pizarra al empezar y cada vez que termines un bloque de trabajo. Mensajes cortos y concretos: rutas de archivo, nombres de clases, decisiones. Si algo bloquea, avisa al "coordinador".`

const PROMPT_ANALISTA = `Eres el ANALISTA de un equipo de agentes. Tu trabajo es entender el código y decir qué hay que cambiar; NO modificas archivos.

1. Explora el repositorio y localiza todo lo afectado por la tarea: clases, triggers, tests, metadatos, configuración, integraciones y dependencias.
2. En cuanto tengas una primera lista útil, envíasela al "implementador" (o a quien vaya a construir el cambio) para que empiece ya; no esperes a tenerlo todo. Después sigue mandando hallazgos por bloques (archivo, qué cambiar y por qué, riesgos).
3. Contesta las preguntas de tus compañeros y revisa lo que te digan que ha cambiado.
4. Al acabar, manda al "coordinador" un resumen: impacto, lista de archivos, riesgos, pruebas recomendadas y, si ves cómo dividir el trabajo, las subtareas posibles (qué archivos toca cada una y cuáles dependen de otras).
${COMO_HABLAR}`

const PROMPT_IMPLEMENTADOR = `Eres el IMPLEMENTADOR de un equipo de agentes. Tu trabajo es construir el cambio.

1. Lee la pizarra: el analista te irá mandando qué archivos y clases tocar. Empieza por lo primero que te llegue, sin esperar al análisis completo.
2. Implementa por bloques pequeños. Tras cada bloque, avisa al "analista" de qué has cambiado (archivos y resumen) para que lo revise, y vuelve a leer la pizarra.
3. Si algo no está claro, pregunta al "analista" antes de inventar.
4. Ejecuta las pruebas o validaciones que haya en el proyecto cuando sea posible.
5. Al acabar, manda al "coordinador" la lista de cambios hechos y lo que queda pendiente.
${COMO_HABLAR}`

const PROMPT_TRABAJADOR = `Eres un TRABAJADOR de un equipo de agentes. Te encargas de UNA subtarea del plan; el coordinador te dice su id, su detalle y los archivos que tocas.

1. Al empezar, lee la pizarra y el plan (mcp__duo__leer).
2. Marca tu tarea en curso: mcp__duo__tarea { id, estado: "en_curso" }.
3. Haz solo lo que pide tu tarea y toca únicamente los archivos de tu tarea. Cada archivo lo edita un solo agente a la vez: si el sistema te dice que otro lo está editando, no insistas; pídeselo por su nombre en la pizarra o espera.
4. Si necesitas algo de otro agente (un dato, un cambio en su parte), pídeselo por su nombre en la pizarra.
5. Ejecuta las pruebas o validaciones que haya cuando sea posible.
6. Al acabar, marca la tarea: mcp__duo__tarea { id, estado: "hecha" }. Si no puedes completarla, usa "fallida" o "bloqueada" con una nota que explique el motivo.
7. Responde con un resumen de lo que has cambiado (archivos y qué).
${COMO_HABLAR}`

function promptTester(cobertura: number, org: string): string {
  const destino = org ? `la org "${org}" (añade --target-org ${org} a cada comando sf)` : 'la org por defecto del proyecto'
  return `Eres el TESTER DE APEX. Trabajas en una conversación aparte, sin que nadie te supervise paso a paso. Tu único objetivo: que cada clase o trigger Apex que te pasen tenga al menos un ${cobertura}% de cobertura de código, con tests que pasen. No pares hasta conseguirlo.

Trabajas contra ${destino}.

## Seguridad, antes de nada
1. Comprueba que la org NO es de producción: \`sf data query -q "SELECT IsSandbox, OrganizationType FROM Organization" --json${org ? ` --target-org ${org}` : ''}\` (IsSandbox debe ser true; una scratch org también vale). ${org ? '' : 'Anota el username de la org por defecto (sf org display --json) y úsalo con --target-org en todos los comandos sf, para que no cambie a mitad. '}Si es producción o no puedes saberlo, NO despliegues nada: avisa al "coordinador" con mcp__duo__enviar y termina.
2. Solo puedes crear o editar CLASES DE TEST (@isTest). Nunca cambies la lógica de las clases o triggers que pruebas. Si una clase no se puede cubrir sin cambiarla (código muerto, dependencia imposible de simular), explícaselo al "coordinador" y sigue con las demás.

## Para cada clase o trigger
1. Busca su clase de test (MiClaseTest, MiClase_Test o la que la referencie con @isTest). Si no existe, créala junto a la clase, con su archivo -meta.xml (misma apiVersion que la clase).
2. Escribe tests reales: casos normales, límites y errores, con datos creados en el propio test (@TestSetup o métodos de fábrica) y asserts que comprueben el resultado, no solo líneas recorridas.
3. Despliega la clase y su test: \`sf project deploy start --source-dir <ruta clase> --source-dir <ruta test> --wait 30\`. Si falla la compilación por tu test, corrígelo y repite.
4. Lanza los tests con cobertura: \`sf apex run test --class-names <Test> --code-coverage --result-format json --wait 30\`. Lee el porcentaje de la clase en "coverage".
5. Si algún test falla o la cobertura es menor del ${cobertura}%: mira qué líneas no se cubren, añade o corrige tests y vuelve al paso 3. Repite hasta llegar.

## Comunicación
- Usa mcp__duo__enviar para avisar al "coordinador" cuando una clase llegue a la cobertura (clase, % y test usado) o si te bloqueas. Si el "implementador" está trabajando y encuentras un error en su código, avísale a él.
- Te pueden llegar nuevas clases mientras trabajas: añádelas a tu lista.
- Al terminar, responde con una tabla: clase, cobertura final, clase de test, estado.`
}

function esApex(ruta: string): boolean {
  return /\.(cls|trigger)$/i.test(ruta)
}

function nombreApex(ruta: string): string {
  return ruta.split(/[\\/]/).pop()?.replace(/\.(cls|trigger)$/i, '') ?? ruta
}

// Una clase de test no se pasa al tester: por el nombre (MiClaseTest,
// MiClase_Test, MiClaseTests) o por la anotación @isTest en su contenido.
function esTestApex(ruta: string, contenido?: string): boolean {
  if (/Tests?$/.test(nombreApex(ruta))) return true
  return contenido !== undefined && /@isTest\b/i.test(contenido)
}

function encargoTester(rutas: string[], cobertura: number): string {
  return `Clases y triggers Apex modificados que necesitan tests (cobertura mínima ${cobertura}%):\n${rutas.map(r => `- ${r}`).join('\n')}\n\nCrea o completa sus clases de test, despliégalas y ejecútalas hasta que cada una llegue al ${cobertura}%. Avisa al coordinador con mcp__duo__enviar de cada resultado.`
}

function hora(): string {
  const d = new Date()
  const dos = (n: number) => String(n).padStart(2, '0')
  return `${dos(d.getHours())}:${dos(d.getMinutes())}`
}

function formatear(lista: DuoMensaje[]): string {
  if (lista.length === 0) return 'La pizarra está vacía.'
  return lista.map(m => `#${m.id} [${m.hora}] ${m.de} → ${m.para}:\n${m.texto}`).join('\n\n')
}


function corto(texto: string, max: number): string {
  const limpio = texto.replace(/\s+/g, ' ').trim()
  return limpio.length > max ? `${limpio.slice(0, max - 1)}…` : limpio
}

function ruta(valor: unknown): string {
  const r = String(valor ?? '')
  const partes = r.split(/[\\/]/).filter(Boolean)
  return partes.length > 3 ? `…/${partes.slice(-3).join('/')}` : r
}

// Qué está haciendo un agente, en palabras, a partir de la herramienta que usa.
function describir(tool: string, a: Record<string, unknown>): { texto: string; archivo?: string } {
  switch (tool) {
    case 'Read':
      return { texto: `Leyendo ${ruta(a.file_path)}` }
    case 'Edit':
    case 'MultiEdit':
      return { texto: `Editando ${ruta(a.file_path)}`, archivo: String(a.file_path ?? '') }
    case 'Write':
      return { texto: `Escribiendo ${ruta(a.file_path)}`, archivo: String(a.file_path ?? '') }
    case 'NotebookEdit':
      return { texto: `Editando ${ruta(a.notebook_path)}`, archivo: String(a.notebook_path ?? '') }
    case 'Grep':
      return { texto: `Buscando "${corto(String(a.pattern ?? ''), 40)}"` }
    case 'Glob':
      return { texto: `Buscando archivos ${corto(String(a.pattern ?? ''), 40)}` }
    case 'Bash':
      return { texto: `Ejecutando ${corto(String(a.description ?? a.command ?? ''), 60)}` }
    case 'WebFetch':
    case 'WebSearch':
      return { texto: `Consultando ${corto(String(a.url ?? a.query ?? 'la web'), 50)}` }
    case 'TodoWrite':
    case 'TaskCreate':
    case 'TaskUpdate':
      return { texto: 'Organizando sus tareas' }
    case 'Agent':
      return { texto: 'Lanzando un ayudante' }
    default:
      return { texto: `Usando ${tool.replace(/^mcp__/, '').replace(/__/g, ' ')}` }
  }
}

function anotar(ficha: DuoFicha | undefined, texto: string, archivo?: string): DuoFicha {
  const base: DuoFicha = ficha ?? { estado: 'trabajando', inicio: Date.now(), herramientas: 0, mensajes: 0, tokens: 0, actividad: '', pasos: [], archivos: [] }
  const archivos = archivo && !base.archivos.includes(archivo) ? [...base.archivos, archivo].slice(-40) : base.archivos
  return {
    ...base,
    estado: 'trabajando',
    fin: undefined,
    herramientas: base.herramientas + 1,
    actividad: texto,
    pasos: [...base.pasos, `${hora()} ${texto}`].slice(-8),
    archivos,
  }
}

function duracion(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min ${s % 60} s`
  return `${Math.floor(m / 60)} h ${m % 60} min`
}

function miles(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n)
}

// Pasa al tester las clases Apex pendientes: lo lanza si no está en marcha
// o le manda las nuevas si ya trabaja. Solo mueve a "enviadas" lo entregado.
let entregando = false
async function entregarApex($: Parameters<Hook<'turn.complete'>>[0], cobertura: number): Promise<void> {
  if (entregando) return
  entregando = true
  try {
    const ap = await read($, apex)
    const ahora = [...ap.pendientes]
    if (ahora.length === 0) return
    let entregado = false
    if (ap.testerActivo && ap.testerId) {
      try {
        const sent = await $.session.send({
          to: { agentId: ap.testerId },
          text: `[duo] Nuevas clases Apex modificadas: añádelas a tu lista.\n${encargoTester(ahora, cobertura)}`,
        })
        entregado = sent.isDelivered
      } catch {
        entregado = false
      }
    }
    if (!entregado) {
      const r = await $.agent.spawn({ subagentType: 'duo:tester-apex', description: 'Tests Apex', prompt: encargoTester(ahora, cobertura) })
      if (r.deny !== undefined || !r.agentId) {
        $.ui.toast(`duo: no se pudo lanzar el tester de Apex${r.deny ? ` (${corto(r.deny, 60)})` : ''}`)
        return
      }
      const id = r.agentId
      await update($, apex, a => ({ ...a, testerId: id, testerActivo: true }))
      await update($, seguimiento, f => (f.tester?.estado === 'trabajando' ? f : {
        ...f,
        tester: {
          estado: 'trabajando' as const, inicio: Date.now(), modelo: r.model, herramientas: 0, mensajes: 0, tokens: 0,
          actividad: 'Empezando', pasos: [`${hora()} Empieza con ${ahora.length} clase(s)`], archivos: [],
        },
      }))
    }
    await update($, apex, a => ({
      ...a,
      pendientes: a.pendientes.filter(p => !ahora.includes(p)),
      enviadas: [...new Set([...a.enviadas, ...ahora])],
    }))
    $.ui.toast(`duo: ${ahora.length} clase(s) Apex al tester`)
  } finally {
    entregando = false
  }
}

const MODELOS = ['opus', 'sonnet', 'haiku', 'inherit'] as const

// El modelo elegido en /config, o el de por defecto si no es uno válido.
function modelo(valor: unknown, porDefecto: (typeof MODELOS)[number]): string {
  return typeof valor === 'string' && (MODELOS as readonly string[]).includes(valor) ? valor : porDefecto
}


function promptEntregas(cobertura: number, org: string, ramaBase: string, crearPR: boolean): string {
  const destino = org ? `la org "${org}" (añade --target-org ${org} a cada comando sf)` : 'la org por defecto del proyecto (anota su username una sola vez y úsalo con --target-org en TODOS los comandos sf; no cambies la org por defecto)'
  const base = ramaBase ? `la rama "${ramaBase}"` : 'la rama principal del repositorio (averíguala con `git symbolic-ref --short refs/remotes/origin/HEAD`)'
  return `Eres el agente de ENTREGAS de un equipo de agentes. Preparas el paquete a entregar y todo lo de GitHub, SIEMPRE contra una sandbox. Nunca despliegas en producción, nunca fusionas el PR, nunca haces push directo a la rama principal ni force-push.

Trabajas contra ${destino}. La rama base es ${base}.

## Reglas que no se rompen
- Org: comprueba con \`sf data query -q "SELECT IsSandbox, OrganizationType FROM Organization" --json\` (con --target-org) que IsSandbox es true (o que es una scratch org). Si es producción o no puedes saberlo, avisa al "coordinador" con mcp__duo__enviar y termina.
- Solo \`sf project deploy validate\` (y \`deploy report\` o \`resume\` de esa validación). PROHIBIDO \`sf project deploy start\`, \`deploy quick\`, \`sf org login\` y cambiar la org por defecto.
- Git: PROHIBIDO --force, -f, --force-with-lease, refspec con "+", push a la rama base, main o master, \`gh pr merge\`, \`gh pr review --approve\`, \`git reset --hard\`, \`git clean\`, \`git checkout -- .\`, \`git restore\`, \`git stash\`, borrar ramas y reescribir historia ya subida. Haz siempre \`git push -u origin <rama>\` con la rama explícita.
- \`git add\` solo de rutas concretas de la lista de componentes, nunca -A ni ".". Antes de commitear comprueba que no van secretos (.env, .sf/, .sfdx/, authUrl, claves).
- Otros agentes trabajan en la MISMA carpeta: no cambies de rama mientras haya tareas del plan sin terminar (les cambiarías los archivos). La rama nueva se crea en la pasada final, cuando el resto del plan esté hecho. Su nombre nunca puede ser igual al de la rama base.
- Si la validación falla, como mucho 3 intentos; después avisa al coordinador y para.

## Pasos
1. Mientras el resto trabaja puedes ir preparando el manifest con lo que ya esté hecho; la pasada final es cuando las demás tareas del plan estén hechas (lee el plan con mcp__duo__leer). Tu tarea del plan depende de todas las demás.
2. Componentes cambiados: \`git status\` y \`git diff --name-only <rama base>...HEAD\`, dentro de los directorios del proyecto (sfdx-project.json, packageDirectories). Incluye las clases de test que haya creado el tester.
3. Manifest: \`sf project generate manifest --source-dir <rutas cambiadas> --output-dir manifest --name package\`. Si hay componentes borrados, genera también destructiveChanges.xml (solo genéralo; en el PR pide revisión manual obligatoria). Revisa que no falte ni sobre nada.
4. Validación sin desplegar: \`sf project deploy validate --manifest manifest/package.xml --test-level RunSpecifiedTests --tests <tests de las clases tocadas> --wait 60\`. Si falla, avisa por la pizarra al agente responsable (o al coordinador) con el error, espera a que lo arreglen y repite.
5. GitHub: rama nueva \`feature/<resumen-corto>\` desde la rama base (\`git switch -c\`); commits en español que expliquen el cambio; \`git push -u origin <rama>\`.${crearPR ? ' Después `gh pr create` con: resumen, lista de componentes, tests y cobertura (lo que diga el tester; mínimo ' + cobertura + '%), id de la validación en sandbox y pasos manuales si los hay. Sin fusionar.' : ' No crees el pull request: la opción crearPR está desactivada; deja la rama subida.'}
6. Responde al coordinador con ${crearPR ? 'el enlace del PR, ' : ''}la rama y el resultado de la validación.
${COMO_HABLAR}`
}

function guiaCoordinador(max: number): string {
  return `# Modo equipo (varios agentes que se hablan)
Para tareas grandes (migraciones, refactors que tocan muchas clases, cambios de modelo de datos), trabaja en modo equipo: tú eres el "coordinador" y repartes el trabajo entre tantos agentes como tenga sentido (de 1 a N, como máximo ${max} a la vez).
1. Tarea pequeña: hazla tú, sin equipo.
2. Tarea grande: divídela en subtareas con mcp__duo__plan { tareas: [{ id, titulo, detalle, dependeDe, archivos }] }. Pon como independientes las que se puedan hacer a la vez; las que tocan los mismos archivos, en secuencia (con dependeDe). Cada archivo solo lo puede editar un agente a la vez.
3. Si primero hay que entender el impacto, empieza con un duo:analista (o una tarea de análisis) y crea el plan con lo que encuentre. El analista no modifica archivos.
4. Lanza un duo:trabajador por cada tarea sin dependencias pendientes, a la vez y en segundo plano (run_in_background: true), con name = id de la tarea (T1, T2...) y la descripción empezando por ese id. Pásale en el prompt el id, el detalle y los archivos. Si ya hay ${max} agentes trabajando, el lanzamiento se rechaza: espera a que termine alguno.
5. Los agentes marcan sus tareas con mcp__duo__tarea. Cuando te avisen de tareas desbloqueadas, lánzalas. Si una falla o se bloquea, decide: reintentar, reasignar o preguntar al usuario. Te hablan por la pizarra (mcp__duo__enviar / mcp__duo__leer) y tú puedes escribirles con el nombre del agente o "todos".
6. En tareas de Salesforce con entrega (paquete, validación y pull request), añade al plan una tarea final que dependa de todas las demás y lánzala con duo:entregas. Solo valida en sandbox: nunca despliega en producción ni fusiona.
7. Al final: revisa el conjunto (diff y pruebas) y resume al usuario qué se hizo, qué se cambió y qué queda pendiente.
Los papeles fijos duo:analista y duo:implementador siguen existiendo: un caso particular con dos agentes.`
}

function nombreDe(eq: DuoEquipo, agentId?: string): string | undefined {
  if (!agentId) return undefined
  return Object.entries(eq).find(([, m]) => m.agentId === agentId)?.[0]
}

/** Quién es: el nombre del miembro, "tester" o undefined (la conversación principal). */
function rolDe(eq: DuoEquipo, agentId?: string, testerId?: string): string | undefined {
  return nombreDe(eq, agentId) ?? (agentId && agentId === testerId ? 'tester' : undefined)
}

function quienEs(eq: DuoEquipo, agentId?: string, testerId?: string): string {
  return rolDe(eq, agentId, testerId) ?? 'coordinador'
}

// Avisa a la conversación principal; si está parada, el aviso la despierta.
async function avisarCoordinador($: Ctx, aviso: string): Promise<boolean> {
  try {
    await $.session.append({ message: { type: 'user', content: [{ type: 'text', text: aviso }] } })
    return true
  } catch {
    try {
      await $.prompt.submit({ text: aviso })
      return true
    } catch {
      return false
    }
  }
}

const PALETA = ['blue', 'cyan', 'green', 'white', 'gray']
function colorDe(nombre: string): string {
  const fijos: Record<string, string> = { analista: 'cyan', implementador: 'green', coordinador: 'yellow', tester: 'magenta', entregas: 'blue' }
  if (fijos[nombre]) return fijos[nombre]
  let h = 0
  for (const c of nombre) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return PALETA[h % PALETA.length] ?? 'white'
}

function tipoDe(e: unknown): string {
  const x = e as { subagentType?: string; subagent_type?: string }
  return x.subagentType ?? x.subagent_type ?? ''
}

function archivoEditado(e: unknown): string {
  const x = e as { file_path?: unknown; notebook_path?: unknown }
  return String(x.file_path ?? x.notebook_path ?? '')
}

// Agentes lanzándose ahora mismo (varios Agent en el mismo mensaje).
let lanzando = 0

export const register: Register = (on, options) => {
  const testerApex = options.testerApex !== false
  const cobertura = typeof options.coberturaMinima === 'number' ? options.coberturaMinima : 75
  const orgApex = typeof options.orgApex === 'string' ? options.orgApex.trim() : ''
  const maxAgentes = typeof options.maxAgentes === 'number' && Number.isFinite(options.maxAgentes) ? Math.max(1, Math.floor(options.maxAgentes)) : 5
  const ramaBase = typeof options.ramaBase === 'string' ? options.ramaBase.trim() : ''
  const crearPR = options.crearPR !== false
  const modeloAnalista = modelo(options.modeloAnalista, 'opus')
  const modeloImplementador = modelo(options.modeloImplementador, 'sonnet')
  const modeloTester = modelo(options.modeloTester, 'sonnet')
  const modeloTrabajador = modelo(options.modeloTrabajador, 'sonnet')
  const modeloEntregas = modelo(options.modeloEntregas, 'sonnet')

  on('session.start', async ($, e, next) => {
    await $.agent.register({
      name: 'analista',
      description:
        'Modo equipo: analiza el impacto de una tarea grande (clases, dependencias, riesgos) sin tocar archivos y se lo va contando al resto por la pizarra. Lánzalo a la vez que duo:implementador.',
      prompt: PROMPT_ANALISTA,
      tools: ['Read', 'Grep', 'Glob', 'Bash', 'WebFetch', 'WebSearch', ...HERRAMIENTAS_PIZARRA, 'mcp__duo__tarea'],
      disallowedTools: ['Edit', 'Write', 'NotebookEdit'],
      model: modeloAnalista,
    })
    await $.agent.register({
      name: 'implementador',
      description:
        'Modo equipo: implementa una tarea grande siguiendo lo que le va pasando duo:analista por la pizarra, y le avisa de cada cambio. Lánzalo a la vez que duo:analista.',
      prompt: PROMPT_IMPLEMENTADOR,
      model: modeloImplementador,
    })
    await $.agent.register({
      name: 'trabajador',
      description:
        'Modo equipo: agente genérico que se encarga de UNA subtarea del plan (la que le indiques con su id), toca solo los archivos de esa tarea y la marca como hecha. Lanza uno por tarea, con name = id de la tarea.',
      prompt: PROMPT_TRABAJADOR,
      model: modeloTrabajador,
    })
    await $.agent.register({
      name: 'entregas',
      description:
        'Modo equipo (Salesforce): prepara el manifest (package.xml), valida en sandbox sin desplegar y prepara la rama, los commits y el pull request. Nunca toca producción ni fusiona. Lánzalo cuando el resto del plan esté hecho.',
      prompt: promptEntregas(cobertura, orgApex, ramaBase, crearPR),
      model: modeloEntregas,
    })
    await $.agent.register({
      name: 'tester-apex',
      description:
        'Crea y ejecuta tests Apex hasta que cada clase modificada llegue a la cobertura mínima. Lo lanza el mod duo solo; no hace falta lanzarlo a mano.',
      prompt: promptTester(cobertura, orgApex),
      model: modeloTester,
      background: true,
    })

    await $.tool.register({
      name: 'enviar',
      description:
        'Modo equipo: deja un mensaje en la pizarra compartida para un agente del equipo (por su nombre, p. ej. "analista" o "T2"), "coordinador", "tester" (el tester de Apex) o "todos" (los que estén trabajando). El destinatario lo recibe al momento.',
      inputSchema: {
        type: 'object',
        properties: {
          para: { type: 'string', description: 'Nombre de un agente del equipo, "coordinador", "tester" o "todos".' },
          texto: { type: 'string', description: 'El mensaje, corto y concreto.' },
        },
        required: ['para', 'texto'],
      },
      isDeferred: false,
    })
    await $.tool.register({
      name: 'leer',
      description: 'Modo equipo: lee la pizarra compartida y, arriba, el resumen del plan de tareas.',
      inputSchema: { type: 'object', properties: {} },
      isDeferred: false,
    })
    await $.tool.register({
      name: 'plan',
      description:
        'Modo equipo: crea o sustituye el plan de tareas. Cada tarea: id (T1, T2...), titulo, detalle, dependeDe (ids que deben estar hechas antes), archivos (los que toca) y agente (opcional). Conserva el estado de los ids que ya existían. Rechaza ids repetidos, dependencias que no existen y ciclos.',
      inputSchema: {
        type: 'object',
        properties: {
          tareas: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                titulo: { type: 'string' },
                detalle: { type: 'string' },
                dependeDe: { type: 'array', items: { type: 'string' } },
                archivos: { type: 'array', items: { type: 'string' } },
                agente: { type: 'string' },
              },
              required: ['id', 'titulo'],
            },
          },
        },
        required: ['tareas'],
      },
      isDeferred: false,
    })
    await $.tool.register({
      name: 'tarea',
      description:
        'Modo equipo: cambia el estado de una tarea del plan (pendiente, en_curso, bloqueada, hecha o fallida), con una nota opcional. Al marcarla hecha se avisa al coordinador de las tareas que quedan desbloqueadas; al marcarla fallida o bloqueada, con la nota.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          estado: { type: 'string', enum: [...ESTADOS_TAREA] },
          nota: { type: 'string' },
        },
        required: ['id', 'estado'],
      },
      isDeferred: false,
    })

    await $.command.register({
      name: 'duo',
      description: 'Trabaja una tarea en modo equipo: la reparte en un plan y la ejecuta con varios agentes que se hablan',
      argumentHint: '<tarea>',
    })
    await $.command.register({
      name: 'duo-panel',
      description: 'Abre el panel con la conversación entre los agentes del modo equipo',
    })
    await $.command.register({
      name: 'duo-seguimiento',
      description: 'Abre el panel de seguimiento: el plan y qué está haciendo cada agente del modo equipo',
    })

    // Refresca los tiempos del panel de seguimiento mientras algún agente trabaja.
    $.clock.every(5000, () => {
      void read($, seguimiento).then(f => {
        if (Object.values(f).some(x => x?.estado === 'trabajando')) $.ui.invalidate('ui.render')
      })
    })

    return next(e)
  })

  // El tester de Apex lo lanza el mod solo: no se le ofrece al modelo.
  on('agent.offer', { agent: 'duo:tester-apex' }, async () => ({ isOffered: false }))

  // Claude decide solo cuándo usar el modo equipo.
  on('prompt.compose', async ($, e, next) => {
    const { sections } = await next(e)
    return { sections: [...sections, { id: 'duo:guia', text: guiaCoordinador(maxAgentes), scope: 'session' as const }] }
  })

  // Apunta quién es cada agente (por nombre) y limita cuántos trabajan a la vez.
  on('agent.spawn', async ($, e, next) => {
    const tipoSub = tipoDe(e)
    const tipo = TIPOS[tipoSub]
    if (tipo) {
      const ahora = Date.now()
      const trabajando = Object.values(await read($, equipo)).filter(m => activo(m, ahora)).length
      // Sin await entre la comprobación y el contador: varios lanzamientos a la vez no se cuelan.
      if (trabajando + lanzando >= maxAgentes) {
        return { deny: `Ya hay ${maxAgentes} agentes del equipo trabajando (el máximo). Espera a que termine alguno y vuelve a lanzarlo.` }
      }
      lanzando++
      try {
        const r = await next(e)
        if (r.agentId) {
          const id = r.agentId
          const crudo = e as unknown as { name?: string; description?: string }
          const descripcion = crudo.description ?? ''
          const planActual = await read($, plan)
          const pedido = crudo.name?.trim() || (tipo === 'trabajador' ? tareaDeDescripcion(descripcion) : undefined)
          let nombre = ''
          await update($, equipo, eq => {
            nombre = nombreLibre(eq, pedido || (tipo === 'trabajador' ? nombreTrabajador(eq) : tipo))
            const idTarea = planActual.some(t => t.id === nombre) ? nombre : tipo === 'trabajador' ? tareaDeDescripcion(descripcion) : undefined
            return { ...eq, [nombre]: { agentId: id, tipo, ...(idTarea ? { tarea: idTarea } : {}), estado: 'trabajando' as const, ultimo: Date.now() } }
          })
          await update($, reservas, r2 => Object.fromEntries(Object.entries(r2).filter(([, d]) => d !== nombre)))
          const ficha: DuoFicha = {
            estado: 'trabajando', inicio: Date.now(), modelo: r.model, herramientas: 0, mensajes: 0,
            tokens: 0, actividad: 'Empezando', pasos: [`${hora()} Empieza: ${corto(descripcion || e.prompt, 60)}`], archivos: [],
          }
          await update($, seguimiento, f => ({ ...f, [nombre]: ficha }))
          $.ui.open({ id: PANEL, title: 'Duo' }).catch(() => {})
          $.ui.open({ id: SEGUIMIENTO, title: 'Seguimiento' }).catch(() => {})
          $.ui.status(`duo: ${nombre} en marcha`)
        }
        return r
      } finally {
        lanzando--
      }
    }
    const r = await next(e)
    if (r.agentId && tipoSub === 'duo:tester-apex') {
      const id = r.agentId
      await update($, apex, a => ({ ...a, testerId: id, testerActivo: true }))
      const ficha: DuoFicha = {
        estado: 'trabajando', inicio: Date.now(), modelo: r.model, herramientas: 0, mensajes: 0,
        tokens: 0, actividad: 'Empezando', pasos: [`${hora()} Empieza: ${corto(e.description || e.prompt, 60)}`], archivos: [],
      }
      await update($, seguimiento, f => ({ ...f, tester: ficha }))
      $.ui.open({ id: SEGUIMIENTO, title: 'Seguimiento' }).catch(() => {})
      $.ui.status('duo: tester de Apex en marcha')
    }
    return r
  })

  on('tool.call', { tool: 'mcp__duo__enviar' }, async ($, e) => {
    const { para, texto } = e as unknown as { para: string; texto: string }
    const eq = await read($, equipo)
    const { testerId, testerActivo } = await read($, apex)
    const validos = nombresValidos(eq)
    if (typeof para !== 'string' || !validos.includes(para)) {
      return { deny: `No hay nadie llamado "${String(para)}". Nombres válidos: ${validos.join(', ')}.` }
    }
    if (!texto?.trim()) return { deny: 'Escribe un "texto" para el mensaje.' }
    const de = quienEs(eq, e.agentId, testerId)
    const lista = await update($, pizarra, l => {
      const id = (l.at(-1)?.id ?? 0) + 1
      return [...l, { id, de, para, texto: texto.trim(), hora: hora() }].slice(-300)
    })
    const msg = lista.at(-1)!
    const yo = rolDe(eq, e.agentId, testerId)
    if (yo) {
      await update($, seguimiento, f => {
        const ficha = anotar(f[yo], `Escribe a ${para}: ${corto(msg.texto, 50)}`)
        return { ...f, [yo]: { ...ficha, mensajes: ficha.mensajes + 1 } }
      })
    }

    let entrega = 'Queda en la pizarra.'
    const aviso = `[pizarra duo] Mensaje #${msg.id} de ${de}:\n${msg.texto}\n\n(Contesta con mcp__duo__enviar.)`
    const mandar = async (id: string): Promise<boolean> => {
      try {
        return (await $.session.send({ to: { agentId: id }, text: aviso })).isDelivered
      } catch {
        return false
      }
    }
    if (para === 'coordinador') {
      entrega = (await avisarCoordinador($, aviso)) ? 'Entregado al coordinador.' : 'Queda en la pizarra; el coordinador lo leerá con mcp__duo__leer.'
      $.ui.toast(`duo: ${de} → coordinador`)
    } else if (para === 'todos') {
      const destinos: [string, string][] = Object.entries(eq)
        .filter(([n, m]) => activo(m, Date.now()) && n !== de)
        .map(([n, m]) => [n, m.agentId])
      if (testerActivo && testerId && de !== 'tester') destinos.push(['tester', testerId])
      if (destinos.length === 0) {
        entrega = 'No hay nadie más trabajando; queda en la pizarra.'
      } else {
        const ok = await Promise.all(destinos.map(async ([n, id]) => ((await mandar(id)) ? n : undefined)))
        const entregados = ok.filter((n): n is string => !!n)
        entrega = `Entregado a ${entregados.length} (${entregados.join(', ') || 'nadie'}); el resto lo leerá en la pizarra.`
      }
    } else {
      const destino = para === 'tester' ? testerId : eq[para]?.agentId
      if (destino && destino !== e.agentId) {
        try {
          const sent = await $.session.send({ to: { agentId: destino }, text: aviso })
          entrega = sent.isDelivered ? `Entregado a ${para}.` : `Queda en la pizarra (${sent.reason ?? 'no entregado'}).`
        } catch {
          entrega = `Queda en la pizarra; ${para} lo leerá con mcp__duo__leer.`
        }
      } else if (!destino) {
        entrega = para === 'tester' ? 'El tester aún no está en marcha; queda en la pizarra.' : `${para} aún no está en marcha; lo leerá en la pizarra al empezar.`
      }
    }
    return { result: `Mensaje #${msg.id} enviado. ${entrega}` }
  }).catch(($, e, next) =>
    next.called ? next(e) : { deny: 'La pizarra no ha podido guardar el mensaje ahora mismo. Vuelve a intentarlo en unos segundos.' },
  )

  on('tool.call', { tool: 'mcp__duo__leer' }, async ($, e) => {
    const yo = rolDe(await read($, equipo), e.agentId, (await read($, apex)).testerId)
    if (yo) await update($, seguimiento, f => ({ ...f, [yo]: anotar(f[yo], 'Lee la pizarra') }))
    const resumen = resumenPlan(await read($, plan))
    const lista = await read($, pizarra)
    return { result: `${resumen ? `${resumen}\n\n` : ''}${formatear(lista.slice(-60))}` }
  }).catch(($, e, next) =>
    next.called ? next(e) : { deny: 'No se ha podido leer la pizarra ahora mismo. Vuelve a intentarlo en unos segundos.' },
  )

  on('tool.call', { tool: 'mcp__duo__plan' }, async ($, e) => {
    const nuevas = normalizarTareas((e as unknown as { tareas?: unknown }).tareas)
    const problema = validarPlan(nuevas)
    if (problema) return { deny: `Plan rechazado: ${problema}` }
    let quitadas: string[] = []
    const resultado = await update($, plan, anterior => {
      quitadas = quitadasEnCurso(anterior, nuevas)
      return fusionarPlan(anterior, nuevas)
    })
    $.ui.open({ id: SEGUIMIENTO, title: 'Seguimiento' }).catch(() => {})
    $.ui.invalidate('ui.render')
    const libres = desbloqueadas(resultado).map(t => t.id)
    return { result: `Plan guardado: ${resultado.length} tareas. Listas para lanzar ahora: ${libres.join(', ') || 'ninguna'}.${quitadas.length ? ` Ojo: ${quitadas.join(', ')} estaba${quitadas.length > 1 ? 'n' : ''} en curso y ya no está${quitadas.length > 1 ? 'n' : ''} en el plan.` : ''}\n\n${resumenPlan(resultado)}` }
  }).catch(($, e, next) =>
    next.called ? next(e) : { deny: 'No se ha podido guardar el plan ahora mismo. Vuelve a intentarlo en unos segundos.' },
  )

  on('tool.call', { tool: 'mcp__duo__tarea' }, async ($, e) => {
    const { id, estado, nota } = e as unknown as { id: string; estado: string; nota?: string }
    const eq = await read($, equipo)
    const yo = rolDe(eq, e.agentId, (await read($, apex)).testerId)
    if (!ESTADOS_TAREA.includes(estado as DuoEstadoTarea)) {
      return { deny: `Estado "${String(estado)}" no válido. Usa: ${ESTADOS_TAREA.join(', ')}.` }
    }
    const actual = await read($, plan)
    if (!actual.some(t => t.id === id)) {
      return { deny: `No existe la tarea "${String(id)}". Tareas del plan: ${actual.map(t => t.id).join(', ') || '(plan vacío)'}.` }
    }
    const nuevoEstado = estado as DuoEstadoTarea
    const yaHecha = actual.find(t => t.id === id)?.estado === 'hecha'
    const notaLimpia = typeof nota === 'string' && nota.trim() ? nota.trim() : undefined
    const nuevo = await update($, plan, p =>
      p.map(t => (t.id !== id ? t : {
        ...t,
        estado: nuevoEstado,
        ...(notaLimpia ? { nota: notaLimpia } : {}),
        ...(yo && yo !== 'tester' && !t.agente ? { agente: yo } : {}),
      })),
    )
    if (yo && eq[yo] && nuevoEstado === 'en_curso') {
      await update($, equipo, q => (q[yo] ? { ...q, [yo]: { ...q[yo], tarea: id } } : q))
    }
    $.ui.invalidate('ui.render')
    const t = nuevo.find(x => x.id === id)!
    const quien = yo ? ` por ${yo}` : ''
    if (nuevoEstado === 'hecha') {
      if (!yaHecha) {
        const libres = desbloqueadas(nuevo)
        const nuevas = libres.filter(x => x.dependeDe.includes(id))
        const otras = libres.filter(x => !x.dependeDe.includes(id))
        const todas = nuevo.every(x => x.estado === 'hecha')
        const lista = (l: typeof libres) => l.map(x => `${x.id} (${x.titulo})`).join(', ')
        const aviso = `[duo] Tarea ${id} (${t.titulo}) hecha${quien}${notaLimpia ? `: ${notaLimpia}` : ''}.\n` +
          (nuevas.length > 0
            ? `Tareas desbloqueadas, listas para lanzar: ${lista(nuevas)}.`
            : todas ? 'El plan está completo: revisa el conjunto (diff y pruebas) y resume al usuario.' : 'No se ha desbloqueado ninguna tarea nueva.') +
          (otras.length > 0 ? `\nSiguen sin lanzar: ${lista(otras)}.` : '')
        await avisarCoordinador($, aviso)
      }
    } else if (nuevoEstado === 'fallida' || nuevoEstado === 'bloqueada') {
      if (yo && yo !== 'tester') await update($, reservas, r2 => Object.fromEntries(Object.entries(r2).filter(([, d]) => d !== yo)))
      await avisarCoordinador($, `[duo] Tarea ${id} (${t.titulo}) ${nuevoEstado === 'fallida' ? 'fallida' : 'bloqueada'}${quien}: ${notaLimpia ?? 'sin nota'}`)
    }
    return { result: `Tarea ${id} → ${nuevoEstado}.` }
  }).catch(($, e, next) =>
    next.called ? next(e) : { deny: 'No se ha podido actualizar la tarea ahora mismo. Vuelve a intentarlo en unos segundos.' },
  )

  // Hook genérico de tool.call (validate no admite dos sin matcher): reglas del equipo
  // antes de la herramienta (comandos prohibidos, reservas de archivos), seguimiento y,
  // para el tester de Apex, apunte de cada clase o trigger modificado (no los tests, ni
  // lo que edita el propio tester). Lo de Apex no bloquea nunca la herramienta.
  on('tool.call', async ($, e, next) => {
    const eq = await read($, equipo)
    const { testerId } = await read($, apex)
    const yo = rolDe(eq, e.agentId, testerId)
    const tool = String(e.tool)
    if (yo) {
      if (tool === 'Bash') {
        const prohibido = comandoProhibido(String((e as unknown as { command?: unknown }).command ?? ''), ramaBase, { permitirDeploy: yo === 'tester', orgPruebas: orgApex })
        if (prohibido) return { deny: `El modo equipo no permite ${prohibido}.` }
      }
      if (yo !== 'tester' && HERRAMIENTAS_EDICION.includes(tool)) {
        const archivo = rutaReserva(archivoEditado(e))
        if (archivo) {
          const ahora = Date.now()
          const res = await update($, reservas, r => (comprobarReserva(r, eq, archivo, yo, ahora) ? r : { ...r, [archivo]: yo }))
          const choque = comprobarReserva(res, eq, archivo, yo, ahora)
          if (choque) return { deny: choque }
        }
      }
      if (yo !== 'tester' && eq[yo]) {
        await update($, equipo, q => (q[yo] ? { ...q, [yo]: { ...q[yo], estado: 'trabajando' as const, ultimo: Date.now() } } : q))
      }
      const { texto, archivo } = describir(tool, e as unknown as Record<string, unknown>)
      await update($, seguimiento, f => ({ ...f, [yo]: anotar(f[yo], texto, archivo) }))
    }
    const r = await next(e)
    if (!testerApex) return r
    if (tool !== 'Edit' && tool !== 'Write' && tool !== 'MultiEdit') return r
    if (r.deny !== undefined || r.isError) return r
    const archivo = archivoEditado(e)
    if (!esApex(archivo) || (e.agentId && e.agentId === testerId)) return r
    try {
      let contenido: string | undefined
      if (!/\.trigger$/i.test(archivo)) {
        try {
          const leido = await $.fs.read(archivo)
          contenido = typeof leido === 'string' ? leido : undefined
        } catch {
          contenido = undefined
        }
      }
      if (!esTestApex(archivo, contenido)) {
        await update($, apex, a => (a.pendientes.includes(archivo) ? a : { ...a, pendientes: [...a.pendientes, archivo] }))
      }
    } catch {
      // Apuntar la clase es secundario: la edición ya está hecha.
    }
    return r
  }).catch(($, e, next) => next(e))

  // Seguimiento: cuando un agente acaba (o se interrumpe).
  on('turn.complete', async ($, e, next) => {
    const eq = await read($, equipo)
    const yo = rolDe(eq, e.agentId, (await read($, apex)).testerId)
    if (yo) {
      const estado: DuoEstado = e.reason === 'answer' ? 'terminado' : e.reason === 'aborted' ? 'interrumpido' : 'error'
      const gastado = (e.usage?.input_tokens ?? 0) + (e.usage?.output_tokens ?? 0)
      await update($, seguimiento, f => {
        const base = f[yo]
        if (!base) return f
        const texto = estado === 'terminado' ? 'Ha terminado' : estado === 'interrumpido' ? 'Interrumpido' : 'Se ha parado por un error'
        return {
          ...f,
          [yo]: {
            ...base, estado, fin: Date.now(), tokens: base.tokens + gastado, actividad: texto,
            pasos: [...base.pasos, `${hora()} ${texto}`].slice(-8),
            resultado: e.answer ? corto(e.answer, 400) : base.resultado,
          },
        }
      })
      if (yo !== 'tester') {
        // Un miembro que acaba libera sus archivos.
        await update($, equipo, q => (q[yo] ? { ...q, [yo]: { ...q[yo], estado } } : q))
        await update($, reservas, r => Object.fromEntries(Object.entries(r).filter(([, d]) => d !== yo)))
        const tarea = eq[yo]?.tarea
        const enCurso = tarea ? (await read($, plan)).find(t => t.id === tarea)?.estado === 'en_curso' : false
        if (enCurso && estado === 'terminado') {
          await avisarCoordinador($, `[duo] ${yo} ha terminado sin marcar la tarea ${tarea} como hecha. Revisa su trabajo y márcala tú o pídele que lo haga.`)
        }
        $.ui.toast(`duo: ${yo} ${estado === 'terminado' ? 'ha terminado' : estado === 'interrumpido' ? 'se ha interrumpido' : 'se ha parado por un error'}`)
      }
    }

    if (yo === 'tester') {
      // El tester ha acabado: se avisa al coordinador con su respuesta.
      await update($, apex, a => ({ ...a, testerActivo: false }))
      const resumen = e.answer?.trim() || (e.isAborted ? 'Se ha interrumpido sin respuesta.' : 'Ha terminado sin respuesta.')
      await $.session.append({
        message: { type: 'user', content: [{ type: 'text', text: `[duo] El tester de Apex ha terminado:\n${resumen}` }] },
      })
      $.ui.toast('duo: el tester de Apex ha terminado')
      // Si llegaron clases mientras terminaba, se relanza con ellas.
      if (testerApex && (await read($, apex)).pendientes.length > 0) {
        try {
          await entregarApex($, cobertura)
        } catch {
          // Quedan pendientes para el próximo turno.
        }
      }
    } else if (testerApex && !e.isAborted && (!e.agentId || yo)) {
      try {
        await entregarApex($, cobertura)
      } catch {
        // Si no se puede lanzar, las clases siguen pendientes para el próximo turno.
      }
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'duo' }, async ($, e) => {
    const tarea = e.args.trim()
    if (!tarea) return { text: 'Uso: /duo <tarea>. Ejemplo: /duo Construye la migración del objeto Placement de SFDC' }
    await update($, pizarra, () => [])
    // Los agentes que siguen trabajando se conservan para seguir reconociéndolos y respetar sus reservas.
    await update($, equipo, eq => Object.fromEntries(Object.entries(eq).filter(([, m]) => m.estado === 'trabajando')))
    await update($, plan, () => [])
    await update($, reservas, () => ({}))
    await update($, seguimiento, f => Object.fromEntries(Object.entries(f).filter(([, x]) => x.estado === 'trabajando')))
    // Un tester que siga trabajando conserva su id para seguir reconociéndolo.
    await update($, apex, a => ({ pendientes: [], enviadas: [], testerActivo: a.testerActivo, testerId: a.testerActivo ? a.testerId : undefined }))
    await $.ui.open({ id: PANEL, title: 'Duo' })
    await $.ui.open({ id: SEGUIMIENTO, title: 'Seguimiento' })
    await $.prompt.submit({
      text: `Trabaja esta tarea en modo equipo, siguiendo la guía del modo equipo: si es pequeña, hazla tú; si es grande, divídela en un plan con mcp__duo__plan y lanza en segundo plano un duo:trabajador por cada tarea sin dependencias pendientes (hasta ${maxAgentes} a la vez), con name igual al id de la tarea. Si primero hay que entender el impacto, empieza con un duo:analista. Coordínalos por la pizarra y revisa el conjunto al final.\n\nTarea: ${tarea}`,
      asUser: true,
    })
    return { text: 'Modo equipo en marcha: Claude repartirá la tarea en un plan y lanzará a los agentes necesarios.' }
  })

  on('command.run', { command: 'duo-panel' }, async $ => {
    await $.ui.open({ id: PANEL, title: 'Duo' })
    return { text: 'Panel duo abierto.' }
  })

  on('command.run', { command: 'duo-seguimiento' }, async $ => {
    await $.ui.open({ id: SEGUIMIENTO, title: 'Seguimiento' })
    return { text: 'Panel de seguimiento abierto.' }
  })

  on('ui.render', { component: 'Pane', requestId: SEGUIMIENTO }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const fichas = await read($, seguimiento)
    const tareas = await read($, plan)
    const eq = await read($, equipo)
    const columnas = e.props.bodyColumns ?? e.viewport?.columns ?? 60
    const ancho = Math.max(20, columnas - 2)
    const compacto = columnas < 60 || Object.keys(fichas).length > 3
    const ahora = Date.now()
    const colorEstado = { trabajando: 'yellow', terminado: 'green', interrumpido: 'gray', error: 'red' } as const
    const colorTarea = { pendiente: 'gray', en_curso: 'yellow', bloqueada: 'red', hecha: 'green', fallida: 'red' } as const

    const tarjeta = (nombre: string) => {
      const f = fichas[nombre]
      const titulo = nombre === 'tester' ? 'Tester Apex' : nombre.charAt(0).toUpperCase() + nombre.slice(1)
      const tareaId = eq[nombre]?.tarea
      if (!f) {
        return (
          <Box key={nombre} flexDirection="column" marginBottom={1}>
            <Text color={colorDe(nombre)} bold>{titulo}</Text>
            <Text dimColor>{nombre === 'tester' ? 'Se lanza solo cuando cambia una clase o trigger Apex.' : 'Aún no está en marcha.'}</Text>
          </Box>
        )
      }
      const tiempo = duracion((f.fin ?? ahora) - f.inicio)
      return (
        <Box key={nombre} flexDirection="column" marginBottom={compacto ? 0 : 1}>
          <Text>
            <Text color={colorDe(nombre)} bold>{titulo}</Text>{tareaId && tareaId !== nombre ? <Text dimColor> ({tareaId})</Text> : null}{' '}
            <Text color={colorEstado[f.estado]}>● {f.estado}</Text>
            <Text dimColor> · {tiempo}</Text>
          </Text>
          {!compacto && (
            <Text dimColor>
              {f.herramientas} pasos · {f.mensajes} mensajes{f.tokens ? ` · ${miles(f.tokens)} tokens` : ''}{f.modelo ? ` · ${f.modelo}` : ''}
            </Text>
          )}
          <Text>
            <Text bold>{f.estado === 'trabajando' ? 'Ahora: ' : 'Último: '}</Text>{corto(f.actividad, ancho - 8)}
          </Text>
          {!compacto && f.pasos.slice(-5, -1).map((p, i) => (
            <Text key={`${nombre}-p${i}`} dimColor>  {corto(p, ancho - 2)}</Text>
          ))}
          {!compacto && f.archivos.length > 0 && (
            <Text>
              <Text bold>Archivos cambiados ({f.archivos.length}): </Text>
              <Text dimColor>{corto(f.archivos.map(a => ruta(a)).join(', '), ancho * 2)}</Text>
            </Text>
          )}
          {f.estado !== 'trabajando' && f.resultado && (
            <Text>
              <Text bold>Resultado: </Text>{corto(f.resultado, ancho * (compacto ? 1 : 3))}
            </Text>
          )}
        </Box>
      )
    }

    const miembros = Object.keys(fichas).filter(n => n !== 'tester')
    const hechas = tareas.filter(t => t.estado === 'hecha').length

    return (
      <Box flexDirection="column">
        {tareas.length > 0 && (
          <Box flexDirection="column" marginBottom={1}>
            <Text bold>Plan <Text dimColor>({hechas}/{tareas.length} hechas)</Text></Text>
            {[...tareas].sort((x, y) => Number(['hecha', 'pendiente'].includes(x.estado)) - Number(['hecha', 'pendiente'].includes(y.estado))).slice(0, 8).map(t => {
              const espera = t.estado === 'hecha' ? [] : pendientesDe(tareas, t)
              return (
                <Text key={`t-${t.id}`}>
                  <Text color={colorTarea[t.estado]}>{ICONO_TAREA[t.estado]}</Text> {t.id} {corto(t.titulo, ancho - 12)}
                  {t.agente ? <Text dimColor> · {t.agente}</Text> : null}
                  {espera.length > 0 ? <Text dimColor> · espera a {espera.join(', ')}</Text> : null}
                </Text>
              )
            })}
            {tareas.length > 8 && <Text dimColor>… y {tareas.length - 8} más</Text>}
          </Box>
        )}
        {miembros.map(n => tarjeta(n))}
        {(testerApex || fichas.tester) && tarjeta('tester')}
        {miembros.length === 0 && !fichas.tester && tareas.length === 0 && <Text dimColor>Lanza una tarea con /duo &lt;tarea&gt; para ver aquí el plan y a cada agente.</Text>}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANEL }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const lista = await read($, pizarra)
    const eq = await read($, equipo)
    const ap = await read($, apex)
    const cabe = Math.max(3, Math.floor(((e.viewport?.rows ?? 24) - 4) / 3))
    const estados = Object.entries(eq).map(([n, m]) => `${n}: ${m.estado === 'trabajando' ? 'en marcha' : m.estado}`)

    return (
      <Box flexDirection="column">
        <Text dimColor>
          equipo: {estados.length > 0 ? estados.join(' · ') : '—'}
          {testerApex ? ` · tester: ${ap.testerActivo ? 'en marcha' : ap.testerId ? 'terminado' : '—'}` : ''}
        </Text>
        {lista.length === 0 && <Text dimColor>Aún no hay mensajes. Prueba /duo &lt;tarea&gt;.</Text>}
        {lista.slice(-cabe).map(m => (
          <Box key={`m${m.id}`} flexDirection="column" marginTop={1}>
            <Text color={colorDe(m.de)} bold>
              {m.de} → {m.para} <Text dimColor>{m.hora}</Text>
            </Text>
            <Text>{m.texto}</Text>
          </Box>
        ))}
      </Box>
    )
  })
}
