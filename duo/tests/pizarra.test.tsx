import { expect, test } from 'claude-code/testing'

test('un mensaje enviado aparece al leer la pizarra y en el panel', async $ => {
  const enviado = await $.tool.call({ tool: 'mcp__duo__enviar', para: 'implementador', texto: 'Toca la clase PlacementService' })
  expect(enviado.text ?? JSON.stringify(enviado.result)).toContain('Mensaje #1')

  const leido = await $.tool.call({ tool: 'mcp__duo__leer' })
  expect(String(leido.result)).toContain('coordinador → implementador')
  expect(String(leido.result)).toContain('PlacementService')

  for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
    const ui = await $.ui.mount({ plugin: 'duo', surface, component: 'Pane', requestId: 'duo', props: {} as never })
    expect(await ui.find({ type: 'Text', text: /PlacementService/ })).toBeDefined()
    await ui.unmount()
  }
})

test('un destino que no existe se rechaza', async $ => {
  const r = await $.tool.call({ tool: 'mcp__duo__enviar', para: 'nadie', texto: 'hola' })
  expect(r.isError === true || r.deny !== undefined).toBe(true)
})
