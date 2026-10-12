import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { DuoAgentes, DuoMensaje, DuoRol } from '../types'

// Duo: dos agentes en paralelo que se comunican por una pizarra compartida.
// El analista estudia el impacto y las piezas a tocar; el implementador
// construye el cambio. Claude (el coordinador) los lanza y los supervisa.

const PANEL = 'duo'
const pizarra = atom({ plugin: 'duo', key: 'pizarra' } as const, [] as DuoMensaje[])
const agentes = atom({ plugin: 'duo', key: 'agentes' } as const, {} as DuoAgentes)

const HERRAMIENTAS_PIZARRA = ['mcp__duo__enviar', 'mcp__duo__leer']

const COMO_HABLAR = `
## Cómo hablar con tu compañero
Trabajas en pareja y en paralelo con otro agente. Os comunicáis SOLO con estas herramientas:
- mcp__duo__enviar { para, texto }: deja un mensaje en la pizarra. "para" es "analista", "implementador" o "coordinador". El destinatario lo recibe al momento.
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

const DESTINOS = ['analista', 'implementador', 'coordinador'] as const

function hora(): string {
  const d = new Date()
  const dos = (n: number) => String(n).padStart(2, '0')
  return `${dos(d.getHours())}:${dos(d.getMinutes())}`
}

function quienEs(ids: DuoAgentes, agentId?: string): DuoRol {
  if (agentId && agentId === ids.analista) return 'analista'
  if (agentId && agentId === ids.implementador) return 'implementador'
  return 'coordinador'
}

function formatear(lista: DuoMensaje[]): string {
  if (lista.length === 0) return 'La pizarra está vacía.'
  return lista.map(m => `#${m.id} [${m.hora}] ${m.de} → ${m.para}:\n${m.texto}`).join('\n\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.agent.register({
      name: 'analista',
      description:
        'Modo duo: analiza el impacto de una tarea grande (clases, dependencias, riesgos) sin tocar archivos y se lo va contando al implementador por la pizarra. Lánzalo a la vez que duo:implementador.',
      prompt: PROMPT_ANALISTA,
      tools: ['Read', 'Grep', 'Glob', 'Bash', 'WebFetch', 'WebSearch', ...HERRAMIENTAS_PIZARRA],
      disallowedTools: ['Edit', 'Write', 'NotebookEdit'],
      model: 'inherit',
    })
    await $.agent.register({
      name: 'implementador',
      description:
        'Modo duo: implementa una tarea grande siguiendo lo que le va pasando duo:analista por la pizarra, y le avisa de cada cambio. Lánzalo a la vez que duo:analista.',
      prompt: PROMPT_IMPLEMENTADOR,
      model: 'inherit',
    })

    await $.tool.register({
      name: 'enviar',
      description:
        'Modo duo: deja un mensaje en la pizarra compartida para "analista", "implementador" o "coordinador". El destinatario lo recibe al momento.',
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

    return next(e)
  })

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
      void $.ui.open({ id: PANEL, title: 'Duo' })
      $.ui.status(`duo: ${rol} en marcha`)
    }
    return r
  })

  on('tool.call', { tool: 'mcp__duo__enviar' }, async ($, e) => {
    const { para, texto } = e as unknown as { para: string; texto: string }
    if (!DESTINOS.includes(para as DuoRol) || !texto?.trim()) {
      return { deny: 'Indica "para" (analista, implementador o coordinador) y un "texto".' }
    }
    const ids = await read($, agentes)
    const de = quienEs(ids, e.agentId)
    const lista = await update($, pizarra, l => {
      const id = (l.at(-1)?.id ?? 0) + 1
      return [...l, { id, de, para: para as DuoRol, texto: texto.trim(), hora: hora() }].slice(-300)
    })
    const msg = lista.at(-1)!

    let entrega = 'Queda en la pizarra.'
    const aviso = `[pizarra duo] Mensaje #${msg.id} de ${de}:\n${msg.texto}\n\n(Contesta con mcp__duo__enviar.)`
    if (para === 'coordinador') {
      await $.session.append({ message: { type: 'user', content: [{ type: 'text', text: aviso }] } })
      $.ui.toast(`duo: ${de} → coordinador`)
      entrega = 'Entregado al coordinador.'
    } else {
      const destino = ids[para as 'analista' | 'implementador']
      if (destino && destino !== e.agentId) {
        try {
          const sent = await $.session.send({ to: { agentId: destino }, text: aviso })
          entrega = sent.isDelivered ? `Entregado al ${para}.` : `Queda en la pizarra (${sent.reason ?? 'no entregado'}).`
        } catch {
          entrega = `Queda en la pizarra; el ${para} lo leerá con mcp__duo__leer.`
        }
      } else if (!destino) {
        entrega = `El ${para} aún no está en marcha; lo leerá en la pizarra al empezar.`
      }
    }
    return { result: `Mensaje #${msg.id} enviado. ${entrega}` }
  })

  on('tool.call', { tool: 'mcp__duo__leer' }, async $ => {
    const lista = await read($, pizarra)
    return { result: formatear(lista.slice(-60)) }
  })

  on('command.run', { command: 'duo' }, async ($, e) => {
    const tarea = e.args.trim()
    if (!tarea) return { text: 'Uso: /duo <tarea>. Ejemplo: /duo Construye la migración del objeto Placement de SFDC' }
    await update($, pizarra, () => [])
    await update($, agentes, () => ({}))
    await $.ui.open({ id: PANEL, title: 'Duo' })
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

  on('ui.render', { component: 'Pane', requestId: PANEL }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const lista = await read($, pizarra)
    const ids = await read($, agentes)
    const color: Record<DuoRol, string> = { analista: 'cyan', implementador: 'green', coordinador: 'yellow' }
    const cabe = Math.max(3, Math.floor(((e.viewport?.rows ?? 24) - 4) / 3))

    return (
      <Box flexDirection="column">
        <Text dimColor>
          analista: {ids.analista ? 'en marcha' : '—'} · implementador: {ids.implementador ? 'en marcha' : '—'}
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
