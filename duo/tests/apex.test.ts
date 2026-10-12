import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { DuoApex } from '../types'

const CLASES = '/proyecto/force-app/main/default/classes'

// Debajo del plugin: la edición sale bien, cada archivo tiene el contenido
// indicado y los lanzamientos, los envíos al tester y el último valor del
// estado apex quedan apuntados.
// `semilla` hace que el plugin lea ese estado apex hasta su primera escritura
// (el kit no deja inventar el id de un agente lanzado: solo lo pone el motor).
function preparar(on: On, contenidos: Record<string, string> = {}, semilla?: DuoApex) {
  const spawns: { subagentType?: string; prompt: string }[] = []
  const envios: { to: string; text: string }[] = []
  const estado: { apex: DuoApex } = { apex: { pendientes: [], enviadas: [], testerActivo: false } }
  let inicial = semilla
  on('state.get', async ($, e, next) => {
    const r = await next(e)
    if (!inicial || e.plugin !== 'duo' || e.key !== 'apex' || r.deny !== undefined) return r
    return { value: { ...r.value, value: inicial } }
  })
  on('state.set', async ($, e, next) => {
    if (e.plugin === 'duo' && e.key === 'apex') {
      estado.apex = e.value
      inicial = undefined
    }
    return next(e)
  })
  on('turn.complete', async ($, e) => ({ text: e.answer }))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.status', async () => ({ value: undefined }))
  on('tool.call', { tool: 'Edit' }, async ($, e) =>
    String(e.file_path).includes('Roto') ? { isError: true as const, result: 'old_string no encontrado' } : { result: {} as never })
  on('tool.call', { tool: 'Write' }, async () => ({ result: {} as never }))
  on('fs.read', async ($, e) => ({ value: contenidos[e.path] ?? 'public class Algo {}' }))
  on('agent.spawn', async ($, e) => {
    // El kit entrega la llamada con la forma de la herramienta Agent (subagent_type).
    const crudo = e as unknown as { subagent_type?: string }
    spawns.push({ subagentType: e.subagentType ?? crudo.subagent_type, prompt: e.prompt })
    return { model: 'sonnet', agentId: 'tester-1' }
  })
  on('session.send', async ($, e) => {
    envios.push({ to: String(e.to), text: e.text })
    return { isDelivered: true as const }
  })
  return { spawns, envios, estado }
}

const fin = { answer: 'Hecho', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as const

test('editar una clase Apex la deja pendiente y un *Test.cls no', async ($, on) => {
  const { estado } = preparar(on)
  await $.tool.call({ tool: 'Edit', file_path: `${CLASES}/PlacementService.cls`, old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Edit', file_path: `${CLASES}/PlacementServiceTest.cls`, old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Edit', file_path: `${CLASES}/PlacementService.cls`, old_string: 'b', new_string: 'c' })
  expect(estado.apex.pendientes).toEqual([`${CLASES}/PlacementService.cls`])
})

test('una clase con @isTest, un archivo que no es Apex o una edición fallida no se apuntan', async ($, on) => {
  const { estado } = preparar(on, { [`${CLASES}/Fabrica.cls`]: '@isTest\npublic class Fabrica {}' })
  await $.tool.call({ tool: 'Edit', file_path: `${CLASES}/Fabrica.cls`, old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Write', file_path: '/proyecto/README.md', content: 'hola' })
  await $.tool.call({ tool: 'Edit', file_path: `${CLASES}/Roto.cls`, old_string: 'a', new_string: 'b' })
  expect(estado.apex.pendientes).toEqual([])
})

test('al acabar el turno se pide lanzar el tester con las clases pendientes', async ($, on) => {
  const { spawns } = preparar(on)
  await $.tool.call({ tool: 'Edit', file_path: `${CLASES}/Foo.cls`, old_string: 'a', new_string: 'b' })
  await $.turn.complete(fin)
  expect(spawns.length).toBe(1)
  expect(spawns[0]?.subagentType).toBe('duo:tester-apex')
  expect(spawns[0]?.prompt).toContain('Foo.cls')
})

test('con el tester en marcha, las clases nuevas se le mandan sin lanzar otro', async ($, on) => {
  const { spawns, envios, estado } = preparar(on, {}, {
    pendientes: [], enviadas: [`${CLASES}/Foo.cls`], testerId: 'tester-1', testerActivo: true,
  })
  await $.tool.call({ tool: 'Write', file_path: `${CLASES}/Bar.trigger`, content: 'trigger Bar on Account (before insert) {}' })
  await $.turn.complete(fin)
  expect(spawns.length).toBe(0)
  expect(envios.length).toBe(1)
  expect(envios[0]?.to).toContain('tester-1')
  expect(envios[0]?.text).toContain('Bar.trigger')
  expect(estado.apex.pendientes).toEqual([])
  expect(estado.apex.enviadas).toEqual([`${CLASES}/Foo.cls`, `${CLASES}/Bar.trigger`])
})

test('cuando el tester termina queda inactivo y se avisa al coordinador', async ($, on) => {
  const { estado } = preparar(on, {}, { pendientes: [], enviadas: [`${CLASES}/Foo.cls`], testerId: 'tester-1', testerActivo: true })
  const sesion = mock.session(on)
  await $.turn.complete({ ...fin, agentId: 'tester-1', answer: 'Foo 92%' })
  expect(estado.apex.testerActivo).toBe(false)
  expect(JSON.stringify(sesion.appended())).toContain('Foo 92%')
})

test('con el tester desactivado no se apunta nada', { options: { testerApex: false } }, async ($, on) => {
  const { spawns, estado } = preparar(on)
  await $.tool.call({ tool: 'Edit', file_path: `${CLASES}/Foo.cls`, old_string: 'a', new_string: 'b' })
  await $.turn.complete(fin)
  expect(estado.apex.pendientes).toEqual([])
  expect(spawns.length).toBe(0)
})

test('el panel de seguimiento muestra la tarjeta del tester de Apex', async ($, on) => {
  const { spawns } = preparar(on)
  await $.tool.call({ tool: 'Edit', file_path: `${CLASES}/Foo.cls`, old_string: 'a', new_string: 'b' })
  await $.turn.complete(fin)
  expect(spawns.length).toBe(1)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'duo', surface, component: 'Pane', requestId: 'duo-seguimiento', props: {} as never })
    expect(await ui.find({ type: 'Text', text: /Tester Apex/ })).toBeDefined()
    await ui.unmount()
  }
})
