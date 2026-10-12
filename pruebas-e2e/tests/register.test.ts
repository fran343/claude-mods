import { expect, test } from 'claude-code/testing'
import type { E2eEstado } from '../types'
import type { On } from 'claude-code'

const CMD = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as const
const MANIFEST = '<Package><types><members>PlacementService</members><members>Otra</members><name>ApexClass</name></types></Package>'

// Debajo del plugin: archivos simulados, escrituras y lanzamientos apuntados.
const EN_MARCHA: E2eEstado = {
  fase: 'ejecutando', peticion: 'x', agentId: 'pw-1', inicio: 1, componentes: [], specs: [], ejecuciones: [], actividad: '', pasos: [],
}

// El kit no deja inventar el id de un agente lanzado (lo pone el motor): para
// probar un agente ya en marcha se siembra el estado hasta su primera escritura.
// Las rutas se casan por su final: el motor las resuelve contra la carpeta.
function preparar(on: On, archivos: Record<string, string> = {}, semilla?: E2eEstado) {
  const buscar = (ruta: string) => Object.keys(archivos).find(k => ruta === k || ruta.endsWith(`/${k}`))
  let inicial = semilla
  on('state.get', async ($, e, next) => {
    const r = await next(e)
    if (!inicial || e.plugin !== 'pruebas-e2e' || e.key !== 'estado' || r.deny !== undefined) return r
    return { value: { ...r.value, value: inicial } }
  })
  on('state.set', async ($, e, next) => {
    if (e.plugin === 'pruebas-e2e' && e.key === 'estado') inicial = undefined
    return next(e)
  })
  on('tool.call', { tool: 'Bash' }, async () => ({ result: {} as never, text: '  1 failed\n  4 passed (5s)' }))
  const spawns: { subagentType?: string; prompt: string }[] = []
  const escrituras: { path: string; text: string }[] = []
  on('fs.read', async ($, e) => {
    const k = buscar(e.path)
    const v = escrituras.filter(w => w.path.endsWith('.git/info/exclude') && e.path.endsWith('.git/info/exclude')).pop()?.text ?? (k ? archivos[k] : undefined)
    if (v === undefined) return { deny: 'no existe' }
    return { value: v }
  })
  on('fs.write', async ($, e) => {
    escrituras.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('agent.spawn', async ($, e) => {
    const crudo = e as unknown as { subagent_type?: string }
    spawns.push({ subagentType: e.subagentType ?? crudo.subagent_type, prompt: e.prompt })
    return { model: 'sonnet', agentId: 'pw-1' }
  })
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('ui.toast', async () => ({ value: undefined }))
  return { spawns, escrituras }
}

test('/playwright lanza el agente con el manifest en el encargo', async ($, on) => {
  const { spawns } = preparar(on, { 'manifest/package.xml': MANIFEST, '.git/info/exclude': '' })
  await $.command.run({ ...CMD, command: 'playwright', args: 'el alta' })
  expect(spawns.length).toBe(1)
  expect(spawns[0]?.subagentType).toBe('pruebas-e2e:playwright')
  expect(spawns[0]?.prompt).toContain('el alta')
  expect(spawns[0]?.prompt).toContain('PlacementService')
})

test('sin manifest el agente se lanza igualmente y lo deduce del diff', async ($, on) => {
  const { spawns } = preparar(on)
  await $.command.run({ ...CMD, command: 'playwright', args: '' })
  expect(spawns.length).toBe(1)
  expect(spawns[0]?.prompt).toContain('No hay manifest')
  expect(spawns[0]?.prompt).toContain('git diff')
})

test('un segundo /playwright con uno en marcha no lanza otro', async ($, on) => {
  const { spawns } = preparar(on, { 'manifest/package.xml': MANIFEST }, EN_MARCHA)
  const r = await $.command.run({ ...CMD, command: 'playwright', args: 'b' })
  expect(spawns.length).toBe(0)
  expect(String(r.text)).toContain('Ya hay')
})

test('agent.offer oculta el agente al modelo', async ($, on) => {
  preparar(on)
  const r = await $.agent.offer({ agent: 'pruebas-e2e:playwright', description: 'x', source: 'plugin' } as never)
  expect(r.isOffered).toBe(false)
})

test('/playwright añade la carpeta a .git/info/exclude una sola vez', async ($, on) => {
  const { escrituras } = preparar(on, { '.git/info/exclude': '# reglas\n*.log' })
  await $.command.run({ ...CMD, command: 'playwright', args: '' })
  expect(escrituras.length).toBe(1)
  expect(escrituras[0]?.path.endsWith('.git/info/exclude')).toBe(true)
  expect(escrituras[0]?.text).toBe('# reglas\n*.log\n/e2e-local/\n')
})

test('si la carpeta ya estaba excluida no se escribe nada', async ($, on) => {
  const { escrituras } = preparar(on, { '.git/info/exclude': '/e2e-local/\n' })
  await $.command.run({ ...CMD, command: 'playwright', args: '' })
  expect(escrituras.length).toBe(0)
})

test('con soloLocal desactivado no se toca .git/info/exclude', { options: { soloLocal: false } }, async ($, on) => {
  const { escrituras, spawns } = preparar(on)
  await $.command.run({ ...CMD, command: 'playwright', args: '' })
  expect(escrituras.length).toBe(0)
  expect(spawns.length).toBe(1)
})

test('el panel se dibuja en terminal y desktop, antes y después de lanzar', async ($, on) => {
  preparar(on, { 'manifest/package.xml': MANIFEST })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'pruebas-e2e', surface, component: 'Pane', requestId: 'playwright', props: {} as never })
    expect(await ui.find({ type: 'Text', text: /Playwright/ })).toBeDefined()
    await ui.unmount()
  }
  await $.command.run({ ...CMD, command: 'playwright', args: 'el alta' })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'pruebas-e2e', surface, component: 'Pane', requestId: 'playwright', props: {} as never })
    expect(await ui.find({ type: 'Text', text: /el alta/ })).toBeDefined()
    await ui.unmount()
  }
})

test('las ejecuciones de Playwright del agente salen en el panel', async ($, on) => {
  preparar(on, {}, EN_MARCHA)
  await $.tool.call({ tool: 'Bash', command: 'cd e2e-local && npx playwright test', agentId: 'pw-1' } as never)
  const ui = await $.ui.mount({ plugin: 'pruebas-e2e', surface: 'terminal', component: 'Pane', requestId: 'playwright', props: {} as never })
  expect(await ui.find({ type: 'Text', text: /4 pasan/ })).toBeDefined()
  await ui.unmount()
})
