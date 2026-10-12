import { atom, read, update } from 'claude-code'
import type { Hook, Register } from 'claude-code'

import type { DuoAgente, DuoAgentes, DuoApex, DuoFicha, DuoMensaje, DuoRol, DuoSeguimiento } from '../types'

// Duo: dos agentes en paralelo que se comunican por una pizarra compartida.
// El analista estudia el impacto y las piezas a tocar; el implementador
// construye el cambio. Claude (el coordinador) los lanza y los supervisa.

const PANEL = 'duo'
const SEGUIMIENTO = 'duo-seguimiento'
const pizarra = atom({ plugin: 'duo', key: 'pizarra' } as const, [] as DuoMensaje[])
const agentes = atom({ plugin: 'duo', key: 'agentes' } as const, {} as DuoAgentes)
const seguimiento = atom({ plugin: 'duo', key: 'seguimiento' } as const, {} as DuoSeguimiento)
const apex = atom({ plugin: 'duo', key: 'apex' } as const, { pendientes: [], enviadas: [], testerActivo: false } as DuoApex)

const HERRAMIENTAS_PIZARRA = ['mcp__duo__enviar', 'mcp__duo__leer']

const COMO_HABLAR = `
## Cómo hablar con tu compañero
Trabajas en pareja y en paralelo con otro agente. Os comunicáis SOLO con estas herramientas:
- mcp__duo__enviar { para, texto }: deja un mensaje en la pizarra. "para" es "analista", "implementador", "coordinador" o "tester" (el tester de Apex, si está en marcha). El destinatario lo recibe al momento.
- mcp__duo__leer {}: lee la pizarra entera (lo que te han escrito y lo que se han dicho).
Lee la pizarra al empezar y cada vez que termines un bloque de trabajo. Mensajes cortos y concretos: rutas de archivo, nombres de clases, decisiones. Si algo bloquea, avisa al "coordinador".`

const PROMPT_ANALISTA = `Eres el ANALISTA de un equipo de dos agentes. Tu trabajo es entender el código y decir qué hay que cambiar; NO modificas archivos.

1. Explora el repositorio y localiza todo lo afectado por la tarea: clases, triggers, tests, metadatos, configuración, integraciones y dependencias.
2. En cuanto tengas una primera lista útil, envíasela al "implementador" para que empiece ya; no esperes a tenerlo todo. Después sigue mandando hallazgos por bloques (archivo, qué cambiar y por qué, riesgos).
3. Contesta las preguntas del implementador y revisa lo que te diga que ha cambiado.
4. Al acabar, manda al "coordinador" un resumen: impacto, lista de archivos, riesgos y pruebas recomendadas.
${COMO_HABLAR}`

const PROMPT_IMPLEMENTADOR = `Eres el IMPLEMENTADOR de un equipo de dos agentes. Tu trabajo es construir el cambio.

1. Lee la pizarra: el analista te irá mandando qué archivos y clases tocar. Empieza por lo primero que te llegue, sin esperar al análisis completo.
2. Implementa por bloques pequeños. Tras cada bloque, avisa al "analista" de qué has cambiado (archivos y resumen) para que lo revise, y vuelve a leer la pizarra.
3. Si algo no está claro, pregunta al "analista" antes de inventar.
4. Ejecuta las pruebas o validaciones que haya en el proyecto cuando sea posible.
5. Al acabar, manda al "coordinador" la lista de cambios hechos y lo que queda pendiente.
${COMO_HABLAR}`

const GUIA_COORDINADOR = `# Modo duo (dos agentes que se hablan)
Para tareas grandes que necesitan a la vez analizar impacto e implementar (migraciones, refactors que tocan muchas clases, cambios de modelo de datos), trabaja en modo duo:
1. Lanza A LA VEZ y en segundo plano (run_in_background: true) dos agentes con la herramienta Agent: subagent_type "duo:analista" y subagent_type "duo:implementador", cada uno con la tarea completa y el contexto que tengas.
2. Ellos se comunican entre sí con la pizarra (mcp__duo__enviar / mcp__duo__leer). Tú eres el "coordinador": puedes leer la pizarra y mandarles indicaciones con mcp__duo__enviar.
3. Cuando ambos terminen, revisa el resultado y resume al usuario qué se analizó, qué se cambió y qué queda pendiente.
Para tareas pequeñas no hace falta: hazlas tú directamente.`

function promptTester(cobertura: number, org: string): string {
  const destino = org ? `la org "${org}" (añade --target-org ${org} a cada comando sf)` : 'la org por defecto del proyecto'
  return `Eres el TESTER DE APEX. Trabajas en una conversación aparte, sin que nadie te supervise paso a paso. Tu único objetivo: que cada clase o trigger Apex que te pasen tenga al menos un ${cobertura}% de cobertura de código, con tests que pasen. No pares hasta conseguirlo.

Trabajas contra ${destino}.

## Seguridad, antes de nada
1. Ejecuta \`sf org display --json\`${org ? ` --target-org ${org}` : ''} y comprueba que la org NO es de producción (debe ser sandbox o scratch org: "isSandbox": true, o un alias de scratch). Si es producción o no puedes saberlo, NO despliegues nada: avisa al "coordinador" con mcp__duo__enviar y termina.
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

const DESTINOS = ['analista', 'implementador', 'coordinador', 'tester'] as const

function hora(): string {
  const d = new Date()
  const dos = (n: number) => String(n).padStart(2, '0')
  return `${dos(d.getHours())}:${dos(d.getMinutes())}`
}

function quienEs(ids: DuoAgentes, agentId?: string, testerId?: string): DuoRol {
  if (agentId && agentId === ids.analista) return 'analista'
  if (agentId && agentId === ids.implementador) return 'implementador'
  if (agentId && agentId === testerId) return 'tester'
  return 'coordinador'
}

function formatear(lista: DuoMensaje[]): string {
  if (lista.length === 0) return 'La pizarra está vacía.'
  return lista.map(m => `#${m.id} [${m.hora}] ${m.de} → ${m.para}:\n${m.texto}`).join('\n\n')
}


function rolDe(ids: DuoAgentes, agentId?: string, testerId?: string): DuoAgente | undefined {
  if (!agentId) return undefined
  if (agentId === ids.analista) return 'analista'
  if (agentId === ids.implementador) return 'implementador'
  if (agentId === testerId) return 'tester'
  return undefined
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

export const register: Register = (on, options) => {
  const testerApex = options.testerApex !== false
  const cobertura = typeof options.coberturaMinima === 'number' ? options.coberturaMinima : 75
  const orgApex = typeof options.orgApex === 'string' ? options.orgApex.trim() : ''
  const modeloAnalista = modelo(options.modeloAnalista, 'opus')
  const modeloImplementador = modelo(options.modeloImplementador, 'sonnet')
  const modeloTester = modelo(options.modeloTester, 'sonnet')

  on('session.start', async ($, e, next) => {
    await $.agent.register({
      name: 'analista',
      description:
        'Modo duo: analiza el impacto de una tarea grande (clases, dependencias, riesgos) sin tocar archivos y se lo va contando al implementador por la pizarra. Lánzalo a la vez que duo:implementador.',
      prompt: PROMPT_ANALISTA,
      tools: ['Read', 'Grep', 'Glob', 'Bash', 'WebFetch', 'WebSearch', ...HERRAMIENTAS_PIZARRA],
      disallowedTools: ['Edit', 'Write', 'NotebookEdit'],
      model: modeloAnalista,
    })
    await $.agent.register({
      name: 'implementador',
      description:
        'Modo duo: implementa una tarea grande siguiendo lo que le va pasando duo:analista por la pizarra, y le avisa de cada cambio. Lánzalo a la vez que duo:analista.',
      prompt: PROMPT_IMPLEMENTADOR,
      model: modeloImplementador,
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
        'Modo duo: deja un mensaje en la pizarra compartida para "analista", "implementador", "coordinador" o "tester" (el tester de Apex). El destinatario lo recibe al momento.',
      inputSchema: {
        type: 'object',
        properties: {
          para: { type: 'string', enum: [...DESTINOS] },
          texto: { type: 'string', description: 'El mensaje, corto y concreto.' },
        },
        required: ['para', 'texto'],
      },
      isDeferred: false,
    })
    await $.tool.register({
      name: 'leer',
      description: 'Modo duo: lee la pizarra compartida entre el analista, el implementador y el coordinador.',
      inputSchema: { type: 'object', properties: {} },
      isDeferred: false,
    })

    await $.command.register({
      name: 'duo',
      description: 'Reparte una tarea entre un agente analista y otro implementador que se hablan',
      argumentHint: '<tarea>',
    })
    await $.command.register({
      name: 'duo-panel',
      description: 'Abre el panel con la conversación entre los agentes del modo duo',
    })
    await $.command.register({
      name: 'duo-seguimiento',
      description: 'Abre el panel de seguimiento: qué está haciendo cada agente del modo duo',
    })

    // Refresca los tiempos del panel de seguimiento mientras algún agente trabaja.
    $.clock.every(5000, () => {
      void read($, seguimiento).then(f => {
        if (f.analista?.estado === 'trabajando' || f.implementador?.estado === 'trabajando' || f.tester?.estado === 'trabajando') $.ui.invalidate('ui.render')
      })
    })

    return next(e)
  })

  // El tester de Apex lo lanza el mod solo: no se le ofrece al modelo.
  on('agent.offer', { agent: 'duo:tester-apex' }, async () => ({ isOffered: false }))

  // Claude decide solo cuándo usar el modo duo.
  on('prompt.compose', async ($, e, next) => {
    const { sections } = await next(e)
    return { sections: [...sections, { id: 'duo:guia', text: GUIA_COORDINADOR, scope: 'session' as const }] }
  })

  // Apunta qué agente es cada rol, para saber quién escribe y a quién entregar.
  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    if (r.agentId && (e.subagentType === 'duo:analista' || e.subagentType === 'duo:implementador')) {
      const rol = e.subagentType === 'duo:analista' ? 'analista' : 'implementador'
      const id = r.agentId
      await update($, agentes, a => ({ ...a, [rol]: id }))
      const ficha: DuoFicha = {
        estado: 'trabajando', inicio: Date.now(), modelo: r.model, herramientas: 0, mensajes: 0,
        tokens: 0, actividad: 'Empezando', pasos: [`${hora()} Empieza: ${corto(e.description || e.prompt, 60)}`], archivos: [],
      }
      await update($, seguimiento, f => ({ ...f, [rol]: ficha }))
      void $.ui.open({ id: PANEL, title: 'Duo' })
      void $.ui.open({ id: SEGUIMIENTO, title: 'Seguimiento' })
      $.ui.status(`duo: ${rol} en marcha`)
    } else if (r.agentId && e.subagentType === 'duo:tester-apex') {
      const id = r.agentId
      await update($, apex, a => ({ ...a, testerId: id, testerActivo: true }))
      const ficha: DuoFicha = {
        estado: 'trabajando', inicio: Date.now(), modelo: r.model, herramientas: 0, mensajes: 0,
        tokens: 0, actividad: 'Empezando', pasos: [`${hora()} Empieza: ${corto(e.description || e.prompt, 60)}`], archivos: [],
      }
      await update($, seguimiento, f => ({ ...f, tester: ficha }))
      void $.ui.open({ id: SEGUIMIENTO, title: 'Seguimiento' })
      $.ui.status('duo: tester de Apex en marcha')
    }
    return r
  })

  on('tool.call', { tool: 'mcp__duo__enviar' }, async ($, e) => {
    const { para, texto } = e as unknown as { para: string; texto: string }
    if (!DESTINOS.includes(para as DuoRol) || !texto?.trim()) {
      return { deny: 'Indica "para" (analista, implementador, coordinador o tester) y un "texto".' }
    }
    const ids = await read($, agentes)
    const { testerId } = await read($, apex)
    const de = quienEs(ids, e.agentId, testerId)
    const lista = await update($, pizarra, l => {
      const id = (l.at(-1)?.id ?? 0) + 1
      return [...l, { id, de, para: para as DuoRol, texto: texto.trim(), hora: hora() }].slice(-300)
    })
    const msg = lista.at(-1)!
    const yo = rolDe(ids, e.agentId, testerId)
    if (yo) {
      await update($, seguimiento, f => {
        const ficha = anotar(f[yo], `Escribe al ${para}: ${corto(msg.texto, 50)}`)
        return { ...f, [yo]: { ...ficha, mensajes: ficha.mensajes + 1 } }
      })
    }

    let entrega = 'Queda en la pizarra.'
    const aviso = `[pizarra duo] Mensaje #${msg.id} de ${de}:\n${msg.texto}\n\n(Contesta con mcp__duo__enviar.)`
    if (para === 'coordinador') {
      try {
        await $.session.append({ message: { type: 'user', content: [{ type: 'text', text: aviso }] } })
        entrega = 'Entregado al coordinador.'
      } catch {
        // La conversación principal está parada: el mensaje la despierta.
        try {
          await $.prompt.submit({ text: aviso })
          entrega = 'Entregado al coordinador.'
        } catch {
          entrega = 'Queda en la pizarra; el coordinador lo leerá con mcp__duo__leer.'
        }
      }
      $.ui.toast(`duo: ${de} → coordinador`)
    } else {
      const destino = para === 'tester' ? testerId : ids[para as 'analista' | 'implementador']
      if (destino && destino !== e.agentId) {
        try {
          const sent = await $.session.send({ to: { agentId: destino }, text: aviso })
          entrega = sent.isDelivered ? `Entregado al ${para}.` : `Queda en la pizarra (${sent.reason ?? 'no entregado'}).`
        } catch {
          entrega = `Queda en la pizarra; el ${para} lo leerá con mcp__duo__leer.`
        }
      } else if (!destino) {
        entrega = para === 'tester' ? 'El tester aún no está en marcha; queda en la pizarra.' : `El ${para} aún no está en marcha; lo leerá en la pizarra al empezar.`
      }
    }
    return { result: `Mensaje #${msg.id} enviado. ${entrega}` }
  }).catch(($, e, next) =>
    next.called ? next(e) : { deny: 'La pizarra no ha podido guardar el mensaje ahora mismo. Vuelve a intentarlo en unos segundos.' },
  )

  on('tool.call', { tool: 'mcp__duo__leer' }, async ($, e) => {
    const yo = rolDe(await read($, agentes), e.agentId, (await read($, apex)).testerId)
    if (yo) await update($, seguimiento, f => ({ ...f, [yo]: anotar(f[yo], 'Lee la pizarra') }))
    const lista = await read($, pizarra)
    return { result: formatear(lista.slice(-60)) }
  }).catch(($, e, next) =>
    next.called ? next(e) : { deny: 'No se ha podido leer la pizarra ahora mismo. Vuelve a intentarlo en unos segundos.' },
  )

  // Seguimiento de cada herramienta que usa un agente del duo y, para el tester
  // de Apex, apunte de cada clase o trigger modificado (no los tests, ni lo que
  // edita el propio tester). Lo de Apex no bloquea nunca la herramienta.
  on('tool.call', async ($, e, next) => {
    const { testerId } = await read($, apex)
    const yo = rolDe(await read($, agentes), e.agentId, testerId)
    if (yo) {
      const { texto, archivo } = describir(String(e.tool), e as unknown as Record<string, unknown>)
      await update($, seguimiento, f => ({ ...f, [yo]: anotar(f[yo], texto, archivo) }))
    }
    const r = await next(e)
    if (!testerApex) return r
    const tool = String(e.tool)
    if (tool !== 'Edit' && tool !== 'Write' && tool !== 'MultiEdit') return r
    if (r.deny !== undefined || r.isError) return r
    const archivo = String((e as unknown as { file_path?: unknown }).file_path ?? '')
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
    const yo = rolDe(await read($, agentes), e.agentId, (await read($, apex)).testerId)
    if (yo) {
      const estado = e.reason === 'answer' ? 'terminado' : e.reason === 'aborted' ? 'interrumpido' : 'error'
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
        $.ui.toast(`duo: el ${yo} ${estado === 'terminado' ? 'ha terminado' : estado === 'interrumpido' ? 'se ha interrumpido' : 'se ha parado por un error'}`)
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
    } else if (testerApex && !e.isAborted && (!e.agentId || yo === 'analista' || yo === 'implementador')) {
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
    await update($, agentes, () => ({}))
    await update($, seguimiento, () => ({}))
    // Un tester que siga trabajando conserva su id para seguir reconociéndolo.
    await update($, apex, a => ({ pendientes: [], enviadas: [], testerActivo: a.testerActivo, testerId: a.testerActivo ? a.testerId : undefined }))
    await $.ui.open({ id: PANEL, title: 'Duo' })
    await $.ui.open({ id: SEGUIMIENTO, title: 'Seguimiento' })
    await $.prompt.submit({
      text: `Trabaja esta tarea en modo duo: lanza a la vez y en segundo plano un agente duo:analista y otro duo:implementador, pásales la tarea completa y coordínalos por la pizarra hasta terminar.\n\nTarea: ${tarea}`,
      asUser: true,
    })
    return { text: 'Modo duo en marcha: analista e implementador trabajarán en paralelo.' }
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
    const ancho = Math.max(20, (e.props.bodyColumns ?? e.viewport?.columns ?? 60) - 2)
    const ahora = Date.now()
    const colorEstado = { trabajando: 'yellow', terminado: 'green', interrumpido: 'gray', error: 'red' } as const
    const palabraEstado = { trabajando: 'trabajando', terminado: 'terminado', interrumpido: 'interrumpido', error: 'error' } as const
    const titulo: Record<DuoAgente, string> = { analista: 'Analista', implementador: 'Implementador', tester: 'Tester Apex' }
    const colorRol: Record<DuoAgente, string> = { analista: 'cyan', implementador: 'green', tester: 'magenta' }

    const tarjeta = (rol: DuoAgente) => {
      const f = fichas[rol]
      if (!f) {
        return (
          <Box key={rol} flexDirection="column" marginBottom={1}>
            <Text color={colorRol[rol]} bold>{titulo[rol]}</Text>
            <Text dimColor>{rol === 'tester' ? 'Se lanza solo cuando cambia una clase o trigger Apex.' : 'Aún no está en marcha.'}</Text>
          </Box>
        )
      }
      const tiempo = duracion((f.fin ?? ahora) - f.inicio)
      return (
        <Box key={rol} flexDirection="column" marginBottom={1}>
          <Text>
            <Text color={colorRol[rol]} bold>{titulo[rol]}</Text>{' '}
            <Text color={colorEstado[f.estado]}>● {palabraEstado[f.estado]}</Text>
            <Text dimColor> · {tiempo}</Text>
          </Text>
          <Text dimColor>
            {f.herramientas} pasos · {f.mensajes} mensajes{f.tokens ? ` · ${miles(f.tokens)} tokens` : ''}{f.modelo ? ` · ${f.modelo}` : ''}
          </Text>
          <Text>
            <Text bold>{f.estado === 'trabajando' ? 'Ahora: ' : 'Último: '}</Text>{corto(f.actividad, ancho - 8)}
          </Text>
          {f.pasos.slice(-5, -1).map((p, i) => (
            <Text key={`${rol}-p${i}`} dimColor>  {corto(p, ancho - 2)}</Text>
          ))}
          {f.archivos.length > 0 && (
            <Text>
              <Text bold>Archivos cambiados ({f.archivos.length}): </Text>
              <Text dimColor>{corto(f.archivos.map(a => ruta(a)).join(', '), ancho * 2)}</Text>
            </Text>
          )}
          {f.estado !== 'trabajando' && f.resultado && (
            <Text>
              <Text bold>Resultado: </Text>{corto(f.resultado, ancho * 3)}
            </Text>
          )}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {tarjeta('analista')}
        {tarjeta('implementador')}
        {(testerApex || fichas.tester) && tarjeta('tester')}
        {!fichas.analista && !fichas.implementador && !fichas.tester && <Text dimColor>Lanza una tarea con /duo &lt;tarea&gt; para ver aquí a cada agente.</Text>}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANEL }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const lista = await read($, pizarra)
    const ids = await read($, agentes)
    const ap = await read($, apex)
    const color: Record<DuoRol, string> = { analista: 'cyan', implementador: 'green', coordinador: 'yellow', tester: 'magenta' }
    const cabe = Math.max(3, Math.floor(((e.viewport?.rows ?? 24) - 4) / 3))

    return (
      <Box flexDirection="column">
        <Text dimColor>
          analista: {ids.analista ? 'en marcha' : '—'} · implementador: {ids.implementador ? 'en marcha' : '—'}
          {testerApex ? ` · tester: ${ap.testerActivo ? 'en marcha' : ap.testerId ? 'terminado' : '—'}` : ''}
        </Text>
        {lista.length === 0 && <Text dimColor>Aún no hay mensajes. Prueba /duo &lt;tarea&gt;.</Text>}
        {lista.slice(-cabe).map(m => (
          <Box key={`m${m.id}`} flexDirection="column" marginTop={1}>
            <Text color={color[m.de]} bold>
              {m.de} → {m.para} <Text dimColor>{m.hora}</Text>
            </Text>
            <Text>{m.texto}</Text>
          </Box>
        ))}
      </Box>
    )
  })
}
