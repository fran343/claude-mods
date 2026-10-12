import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { DuoEquipo } from '../types'
import { comandoProhibido, comprobarReserva, desbloqueadas, fusionarPlan, normalizarTareas, validarPlan } from '../hooks/equipo'

const miembro = (agentId: string, tarea?: string, extra: Partial<DuoEquipo[string]> = {}): DuoEquipo[string] => ({
  agentId, tipo: 'trabajador', estado: 'trabajando', ...(tarea ? { tarea } : {}), ...extra,
})

// Siembra estados del plugin hasta su primera escritura (el kit no deja inventar
// el id de un agente: solo lo pone el motor) y cuenta los envíos a agentes.
function preparar(on: On, semillas: Record<string, unknown> = {}) {
  const envios: string[] = []
  const pendientes = new Set(Object.keys(semillas))
  on('state.get', async ($, e, next) => {
    const r = await next(e)
    if (e.plugin !== 'duo' || !pendientes.has(e.key) || r.deny !== undefined) return r
    return { value: { ...r.value, value: semillas[e.key] } }
  })
  on('state.set', async ($, e, next) => {
    if (e.plugin === 'duo') pendientes.delete(e.key)
    return next(e)
  })
  on('session.send', async ($, e) => {
    envios.push(String(e.to))
    return { isDelivered: true as const }
  })
  on('agent.spawn', async () => ({ model: 'sonnet' }))
  on('ui.toast', async () => ({ value: undefined }))
  return { envios }
}

const tareas = [
  { id: 'T1', titulo: 'Modelo de datos', archivos: ['a.cls'] },
  { id: 'T2', titulo: 'Servicio', dependeDe: ['T1'], archivos: ['b.cls'] },
  { id: 'T3', titulo: 'Tests', dependeDe: ['T1', 'T2'] },
]

test('el plan desbloquea tareas al marcar hecha y avisa al coordinador', async ($, on) => {
  preparar(on)
  const sesion = mock.session(on)
  const creado = await $.tool.call({ tool: 'mcp__duo__plan', tareas })
  expect(String(creado.text ?? JSON.stringify(creado.result))).toContain('Listas para lanzar ahora: T1')

  await $.tool.call({ tool: 'mcp__duo__tarea', id: 'T1', estado: 'en_curso' })
  await $.tool.call({ tool: 'mcp__duo__tarea', id: 'T1', estado: 'hecha', nota: 'listo' })
  const aviso = JSON.stringify(sesion.appended())
  expect(aviso).toContain('Tareas desbloqueadas')
  expect(aviso).toContain('T2')
  expect(aviso).not.toContain('T3 (Tests)')

  const leido = await $.tool.call({ tool: 'mcp__duo__leer' })
  expect(String(leido.result)).toContain('PLAN (1/3 hechas)')
  expect(String(leido.result)).toContain('espera a T2')
})

test('un plan con ciclo, dependencia inexistente o ids repetidos se rechaza', async $ => {
  const ciclo = await $.tool.call({ tool: 'mcp__duo__plan', tareas: [
    { id: 'A', titulo: 'a', dependeDe: ['B'] }, { id: 'B', titulo: 'b', dependeDe: ['A'] },
  ] })
  expect(ciclo.deny ?? ciclo.text ?? '').toContain('ciclo')
  const falta = await $.tool.call({ tool: 'mcp__duo__plan', tareas: [{ id: 'A', titulo: 'a', dependeDe: ['Z'] }] })
  expect(falta.deny ?? falta.text ?? '').toContain('no existe')
  const repetido = await $.tool.call({ tool: 'mcp__duo__plan', tareas: [{ id: 'A', titulo: 'a' }, { id: 'A', titulo: 'b' }] })
  expect(repetido.deny ?? repetido.text ?? '').toContain('repetido')
})

test('validarPlan y fusionarPlan: ciclo largo y estado conservado', () => {
  expect(validarPlan(normalizarTareas([
    { id: 'A', titulo: 'a', dependeDe: ['C'] }, { id: 'B', titulo: 'b', dependeDe: ['A'] }, { id: 'C', titulo: 'c', dependeDe: ['B'] },
  ]))).toContain('ciclo')
  expect(validarPlan(normalizarTareas(tareas))).toBeUndefined()
  const antes = normalizarTareas(tareas).map(t => (t.id === 'T1' ? { ...t, estado: 'hecha' as const, nota: 'ok' } : t))
  const despues = fusionarPlan(antes, normalizarTareas([...tareas, { id: 'T4', titulo: 'Extra' }]))
  expect(despues.find(t => t.id === 'T1')?.estado).toBe('hecha')
  expect(despues.find(t => t.id === 'T4')?.estado).toBe('pendiente')
  expect(desbloqueadas(despues).map(t => t.id)).toEqual(['T2', 'T4'])
})

test('reservas de archivos: otro agente es denegado y se libera al terminar o quedar colgado', () => {
  const eq: DuoEquipo = { T1: miembro('a1', 'T1'), T2: miembro('a2', 'T2') }
  const res = { '/p/Foo.cls': 'T1' }
  expect(comprobarReserva(res, eq, '/p/Foo.cls', 'T2')).toContain('lo está editando T1 (tarea T1)')
  expect(comprobarReserva(res, eq, '/p/Foo.cls', 'T1')).toBeUndefined()
  expect(comprobarReserva(res, eq, '/p/Otro.cls', 'T2')).toBeUndefined()
  expect(comprobarReserva(res, { ...eq, T1: miembro('a1', 'T1', { estado: 'terminado' }) }, '/p/Foo.cls', 'T2')).toBeUndefined()
  const ahora = Date.now()
  // Un comando largo (deploy con --wait 60) no lo da por colgado; pasada la hora, sí.
  expect(comprobarReserva(res, { ...eq, T1: miembro('a1', 'T1', { ultimo: ahora - 20 * 60_000 }) }, '/p/Foo.cls', 'T2', ahora)).toBeDefined()
  expect(comprobarReserva(res, { ...eq, T1: miembro('a1', 'T1', { ultimo: ahora - 70 * 60_000 }) }, '/p/Foo.cls', 'T2', ahora)).toBeUndefined()
})

test('comandoProhibido corta lo peligroso y deja pasar lo normal', () => {
  for (const c of ['git push --force origin x', 'git push -uf origin x', 'git -C d push origin +x', 'git push origin main', 'git push origin HEAD:refs/heads/master',
    'git push origin :rama', 'gh pr merge 3', 'sf project deploy start --manifest m.xml', 'git reset --hard']) {
    expect(comandoProhibido(c, 'develop')).toBeDefined()
  }
  expect(comandoProhibido('git push origin develop', 'develop')).toBeDefined()
  for (const c of ['git push -u origin feature/main-fix', 'sf project deploy validate --manifest m.xml', 'gh pr create --title x', 'git status']) {
    expect(comandoProhibido(c, 'develop')).toBeUndefined()
  }
  expect(comandoProhibido('sf project deploy start --source-dir x', '', { permitirDeploy: true })).toBeUndefined()
})

test('enviar a un nombre que no existe se rechaza con la lista de nombres válidos', async ($, on) => {
  preparar(on, { equipo: { T1: miembro('a1', 'T1') } })
  const r = await $.tool.call({ tool: 'mcp__duo__enviar', para: 'nadie', texto: 'hola' })
  const texto = String(r.deny ?? r.text ?? JSON.stringify(r.result))
  expect(r.deny !== undefined || r.isError === true).toBe(true)
  for (const n of ['T1', 'analista', 'implementador', 'tester', 'coordinador', 'todos']) expect(texto).toContain(n)
})

test('enviar a "todos" llega a los miembros que están trabajando', async ($, on) => {
  const reloj = mock.clock(on, { now: Date.now() })
  const { envios } = preparar(on, { equipo: { T1: miembro('a1', 'T1'), T2: miembro('a2', 'T2'), T3: miembro('a3', 'T3', { estado: 'terminado' }) } })
  const r = await $.tool.call({ tool: 'mcp__duo__enviar', para: 'todos', texto: 'Cambio de plan' })
  expect(String(r.text ?? JSON.stringify(r.result))).toContain('Enviado a 2')
  // La entrega sale de un temporizador, fuera de la llamada.
  expect(envios.length).toBe(0)
  await reloj.advance(1)
  expect(envios.length).toBe(2)
  expect(envios.join(' ')).toContain('a1')
  expect(envios.join(' ')).toContain('a2')
  expect(envios.join(' ')).not.toContain('a3')
})

test('maxAgentes: con el cupo lleno se rechaza el lanzamiento', { options: { maxAgentes: 2 } }, async ($, on) => {
  preparar(on, { equipo: { T1: miembro('a1', 'T1'), T2: miembro('a2', 'T2') } })
  const r = await $.agent.spawn({ subagentType: 'duo:trabajador', prompt: 'x', name: 'T3' } as never)
  expect(r.deny).toContain('máximo')
  const apex = await $.agent.spawn({ subagentType: 'general-purpose', prompt: 'x' } as never)
  expect(apex.deny).toBeUndefined()
})

test('maxAgentes: con hueco libre se lanza', { options: { maxAgentes: 2 } }, async ($, on) => {
  preparar(on, { equipo: { T1: miembro('a1', 'T1') } })
  const r = await $.agent.spawn({ subagentType: 'duo:trabajador', prompt: 'x', name: 'T2' } as never)
  expect(r.deny).toBeUndefined()
})

test('el panel de seguimiento muestra la sección Plan', async ($, on) => {
  preparar(on)
  await $.tool.call({ tool: 'mcp__duo__plan', tareas })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'duo', surface, component: 'Pane', requestId: 'duo-seguimiento', props: {} as never })
    expect(await ui.find({ type: 'Text', text: /Plan/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Servicio/ })).toBeDefined()
    await ui.unmount()
  }
})

test('con otro modelo para el trabajador y las entregas el plugin carga', { options: { modeloTrabajador: 'haiku', modeloEntregas: 'opus', crearPR: false } }, async $ => {
  const r = await $.tool.call({ tool: 'mcp__duo__enviar', para: 'T1', texto: 'hola' })
  expect(r.deny !== undefined || r.isError === true).toBe(true)
})

test('se puede desplegar solo en la org de pruebas nombrada en el comando', () => {
  const org = { orgPruebas: 'mi-sandbox' }
  expect(comandoProhibido('sf project deploy start --source-dir force-app --target-org mi-sandbox', '', org)).toBeUndefined()
  expect(comandoProhibido('sf project deploy start -o mi-sandbox -d force-app', '', org)).toBeUndefined()
  expect(comandoProhibido('sf project deploy start --target-org=mi-sandbox', '', org)).toBeUndefined()
  expect(comandoProhibido('sf project deploy start --source-dir force-app', '', org)).toContain('--target-org mi-sandbox')
  expect(comandoProhibido('sf project deploy start --target-org produccion', '', org)).toBeDefined()
  expect(comandoProhibido('sf project deploy start --target-org mi-sandbox-prod', '', org)).toBeDefined()
  expect(comandoProhibido('sf project deploy start --source-dir force-app', '')).toContain('/config')
})

test('la barrera no se salta con dos orgs, con git -C ni desde entregas', () => {
  const org = { orgPruebas: 'mi-sandbox' }
  expect(comandoProhibido('sf project deploy start --target-org mi-sandbox --target-org produccion', '', org)).toBeDefined()
  expect(comandoProhibido('sf project deploy start --target-org produccion -o mi-sandbox', '', org)).toBeDefined()
  expect(comandoProhibido('git -C repo reset --hard HEAD~1', '')).toBeDefined()
  expect(comandoProhibido('git -C repo clean -fd', '')).toBeDefined()
  expect(comandoProhibido('git -C repo status', '')).toBeUndefined()
  expect(comandoProhibido('sf project deploy start --target-org mi-sandbox', '', { ...org, soloValidar: true })).toContain('solo valida')
  expect(comandoProhibido('sf project deploy validate --target-org mi-sandbox', '', { ...org, soloValidar: true })).toBeUndefined()
})

test('el tester solo despliega en la org de pruebas si hay una configurada', () => {
  const tester = { permitirDeploy: true, orgPruebas: 'mi-sandbox' }
  expect(comandoProhibido('sf project deploy start --target-org mi-sandbox', '', tester)).toBeUndefined()
  expect(comandoProhibido('sf project deploy start --target-org otra', '', tester)).toBeDefined()
  expect(comandoProhibido('sf project deploy start', '', { permitirDeploy: true })).toBeUndefined()
})

test('a un agente que ya ha terminado no se le despierta: el mensaje queda en la pizarra', async ($, on) => {
  const reloj = mock.clock(on, { now: Date.now() })
  const { envios } = preparar(on, { equipo: { T1: miembro('a1', 'T1', { estado: 'terminado' }), T2: miembro('a2', 'T2') } })
  const r = await $.tool.call({ tool: 'mcp__duo__enviar', para: 'T1', texto: 'una cosa más' })
  expect(String(r.text ?? JSON.stringify(r.result))).toContain('ya ha terminado')
  const vivo = await $.tool.call({ tool: 'mcp__duo__enviar', para: 'T2', texto: 'sigue' })
  expect(String(vivo.text ?? JSON.stringify(vivo.result))).toContain('Enviado a T2')
  await reloj.advance(1)
  expect(envios.join(' ')).toContain('a2')
  expect(envios.join(' ')).not.toContain('a1')
  const leido = await $.tool.call({ tool: 'mcp__duo__leer' })
  expect(String(leido.text ?? leido.result)).toContain('una cosa más')
})
