import { atom, read, update } from 'claude-code'
import type { Hook, Register } from 'claude-code'

import type { E2eEstado, E2eFase } from '../types'
import { describirPaso, duracion, corto, esSpec, hora, parseManifest, resumenComponentes, resultadoPlaywright } from './analisis'
import { dibujarPanel } from './panel'
import { encargo, promptPlaywright } from './prompt'

// Pruebas e2e bajo demanda: /playwright lanza un agente aparte que lee el
// manifest, escribe pruebas Playwright y las ejecuta contra la sandbox.
// El modelo nunca lo lanza por su cuenta.

const PANEL = 'playwright'
const AGENTE = 'pruebas-e2e:playwright'
const MODELOS = ['opus', 'sonnet', 'haiku', 'inherit'] as const

const INICIAL: E2eEstado = { fase: 'inactivo', peticion: '', componentes: [], specs: [], ejecuciones: [], actividad: '', pasos: [] }
const estadoAtom = atom({ plugin: 'pruebas-e2e', key: 'estado' } as const, INICIAL)

type Ctx = Parameters<Hook<'turn.complete'>>[0]

const EN_MARCHA: E2eFase[] = ['preparando', 'escribiendo', 'ejecutando']
const enMarcha = (e: E2eEstado): boolean => EN_MARCHA.includes(e.fase)

function texto(valor: unknown, porDefecto: string): string {
  return typeof valor === 'string' && valor.trim() ? valor.trim() : porDefecto
}

function modelo(valor: unknown): string {
  return typeof valor === 'string' && (MODELOS as readonly string[]).includes(valor) ? valor : 'sonnet'
}

// Avisa a la conversación principal; si está parada, el aviso la despierta.
async function avisar($: Ctx, aviso: string): Promise<void> {
  try {
    await $.session.append({ message: { type: 'user', content: [{ type: 'text', text: aviso }] } })
  } catch {
    try {
      await $.prompt.submit({ text: aviso })
    } catch {
      // El panel y el aviso en pantalla ya informan.
    }
  }
}

// Anota un paso en el estado, solo si lo da el agente de las pruebas.
function conPaso(est: E2eEstado, paso: string, fase?: E2eFase): E2eEstado {
  return { ...est, fase: fase ?? est.fase, actividad: paso, pasos: [...est.pasos, `${hora()} ${paso}`].slice(-8) }
}

// Añade /<carpeta>/ a .git/info/exclude una sola vez. Devuelve un aviso si no se pudo.
async function excluirDeGit($: Ctx, carpeta: string): Promise<string> {
  const regla = `/${carpeta.replace(/^\.?\/+|\/+$/g, '')}/`
  const ruta = '.git/info/exclude'
  let actual = ''
  try {
    const leido = await $.fs.read(ruta)
    if (typeof leido === 'string') actual = leido
  } catch {
    // Puede no existir todavía (o no ser un repositorio): se intenta crear.
  }
  if (actual.split(/\r?\n/).some(l => l.trim() === regla)) return ''
  try {
    const sep = actual === '' || actual.endsWith('\n') ? '' : '\n'
    await $.fs.write(ruta, `${actual}${sep}${regla}\n`)
    return ''
  } catch {
    return ` Aviso: no he podido ocultar ${regla} de git (¿es un repositorio?); revisa que las pruebas no aparezcan como cambios.`
  }
}

export const register: Register = (on, options) => {
  const opciones = {
    org: texto(options.orgPruebas, ''),
    manifest: texto(options.manifest, 'manifest/package.xml'),
    carpeta: texto(options.carpetaTests, 'e2e-local'),
    ramaBase: texto(options.ramaBase, ''),
    navegador: texto(options.navegador, 'chromium'),
    ejecutar: options.ejecutar !== false,
    soloLocal: options.soloLocal !== false,
  }

  on('session.start', async ($, e, next) => {
    await $.agent.register({
      name: 'playwright',
      description:
        'Escribe y ejecuta pruebas Playwright de extremo a extremo de lo desarrollado, contra la sandbox de Salesforce. Solo lo lanza el usuario con /playwright; no lo lances por tu cuenta.',
      prompt: promptPlaywright(opciones),
      model: modelo(options.modelo),
    })
    await $.command.register({
      name: 'playwright',
      description: 'Escribe y ejecuta pruebas Playwright de lo que has desarrollado, contra la sandbox',
      argumentHint: '[qué probar]',
    })
    await $.command.register({
      name: 'playwright-panel',
      description: 'Abre el panel con el avance de las pruebas Playwright',
    })

    // Refresca el tiempo del panel mientras el agente trabaja.
    $.clock.every(5000, () => {
      void read($, estadoAtom).then(est => {
        if (enMarcha(est)) $.ui.invalidate('ui.render')
      })
    })

    return next(e)
  })

  // Solo el comando lanza el agente: no se le ofrece al modelo.
  on('agent.offer', { agent: AGENTE }, async () => ({ isOffered: false }))

  on('command.run', { command: 'playwright' }, async ($, e) => {
    const actual = await read($, estadoAtom)
    if (enMarcha(actual)) {
      $.ui.open({ id: PANEL, title: 'Playwright' }).catch(() => {})
      return { text: 'Ya hay unas pruebas Playwright en marcha. Mira el panel para ver cómo van; cuando acaben puedes lanzar otras.' }
    }

    // Solo en local: la carpeta de pruebas no debe aparecer nunca en git.
    let avisoLocal = ''
    if (opciones.soloLocal) avisoLocal = await excluirDeGit($, opciones.carpeta)

    let hayManifest = false
    let componentes: ReturnType<typeof parseManifest> = []
    try {
      const leido = await $.fs.read(opciones.manifest)
      if (typeof leido === 'string') {
        componentes = parseManifest(leido)
        hayManifest = true
      }
    } catch {
      // Sin manifest, el agente deducirá los cambios del diff.
    }

    const peticion = e.args.trim()
    await update($, estadoAtom, () => ({
      ...INICIAL,
      fase: 'preparando' as const,
      peticion,
      inicio: Date.now(),
      manifest: hayManifest ? opciones.manifest : undefined,
      componentes,
      actividad: 'Preparando',
      pasos: [`${hora()} Preparando`],
    }))
    await $.ui.open({ id: PANEL, title: 'Playwright' })

    const r = await $.agent.spawn({
      subagentType: AGENTE,
      description: 'Pruebas Playwright',
      prompt: encargo({
        peticion,
        manifest: opciones.manifest,
        hayManifest,
        componentes: resumenComponentes(componentes),
        ramaBase: opciones.ramaBase,
      }),
    })
    if (r.deny !== undefined || !r.agentId) {
      const motivo = r.deny ? corto(r.deny, 80) : 'sin motivo'
      await update($, estadoAtom, est => ({ ...est, fase: 'error' as const, fin: Date.now(), actividad: 'No se ha podido lanzar', resultado: motivo }))
      return { text: `No se han podido lanzar las pruebas Playwright (${motivo}).` }
    }
    const id = r.agentId
    await update($, estadoAtom, est => ({ ...est, agentId: id }))

    const vistos = hayManifest
      ? `He visto ${componentes.length} tipo(s) de componente en ${opciones.manifest}`
      : 'No he encontrado el manifest: el agente deducirá los cambios del diff'
    return { text: `Pruebas Playwright en marcha. ${vistos}. El panel muestra el avance.${avisoLocal}` }
  })

  on('command.run', { command: 'playwright-panel' }, async $ => {
    await $.ui.open({ id: PANEL, title: 'Playwright' })
    return { text: 'Panel Playwright abierto.' }
  })

  // Un solo hook de tool.call (validate no admite dos sin matcher).
  on('tool.call', async ($, e, next) => {
    const est = await read($, estadoAtom)
    const mio = !!e.agentId && e.agentId === est.agentId && enMarcha(est)
    if (!mio) return next(e)

    const tool = String(e.tool)
    const args = e as unknown as Record<string, unknown>
    const archivo = String(args.file_path ?? '')
    const comando = String(args.command ?? '')
    const lanzaTests = tool === 'Bash' && /\b(npx\s+)?playwright\s+test\b/.test(comando)

    await update($, estadoAtom, s => conPaso(s, describirPaso(tool, args), lanzaTests ? 'ejecutando' : undefined))
    $.ui.invalidate('ui.render')

    const r = await next(e)
    if (r.deny !== undefined || r.isError) return r

    try {
      if ((tool === 'Write' || tool === 'Edit' || tool === 'MultiEdit') && esSpec(archivo)) {
        await update($, estadoAtom, s => ({
          ...s,
          fase: 'escribiendo' as const,
          specs: s.specs.includes(archivo) ? s.specs : [...s.specs, archivo],
        }))
      } else if (lanzaTests) {
        const salida = resultadoPlaywright(r.text ?? '')
        await update($, estadoAtom, s => ({
          ...s,
          fase: 'escribiendo' as const,
          ejecuciones: salida ? [...s.ejecuciones, { hora: hora(), ...salida }].slice(-10) : s.ejecuciones,
        }))
      }
      $.ui.invalidate('ui.render')
    } catch {
      // Anotar es secundario: la herramienta ya se ha ejecutado.
    }
    return r
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const est = await read($, estadoAtom)
    if (!e.agentId || e.agentId !== est.agentId || !enMarcha(est)) return next(e)

    const fase: E2eFase = e.reason === 'answer' ? 'terminado' : e.reason === 'aborted' ? 'interrumpido' : 'error'
    const resumen = e.answer?.trim()
    const paso = fase === 'terminado' ? 'Ha terminado' : fase === 'interrumpido' ? 'Interrumpido' : 'Se ha parado por un error'
    await update($, estadoAtom, s => ({
      ...conPaso(s, paso, fase),
      fin: Date.now(),
      resultado: resumen ? corto(resumen, 600) : s.resultado,
    }))
    $.ui.invalidate('ui.render')

    const dur = est.inicio ? ` en ${duracion(Date.now() - est.inicio)}` : ''
    if (fase === 'terminado') {
      $.ui.toast('Playwright: pruebas terminadas')
      await avisar($, `[pruebas-e2e] El agente de Playwright ha terminado${dur}:\n${resumen || 'Sin respuesta.'}`)
    } else {
      $.ui.toast(fase === 'interrumpido' ? 'Playwright: interrumpido' : 'Playwright: se ha parado por un error')
      await avisar($, `[pruebas-e2e] El agente de Playwright ${fase === 'interrumpido' ? 'se ha interrumpido' : 'se ha parado por un error'}${dur}.${resumen ? `\n${resumen}` : ''}`)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANEL }, async ($, e) => {
    const estado = await read($, estadoAtom)
    const ancho = e.props.bodyColumns ?? e.viewport?.columns ?? 60
    return dibujarPanel($.ui.resolve(e), estado, ancho)
  })
}
