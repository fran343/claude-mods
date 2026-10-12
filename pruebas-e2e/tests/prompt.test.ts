import { expect, test } from 'claude-code/testing'

import { encargo, promptPlaywright } from '../hooks/prompt'

const base = { org: 'miSandbox', manifest: 'manifest/package.xml', carpeta: 'e2e-local', ramaBase: 'main', navegador: 'chromium', ejecutar: true }

test('con soloLocal el prompt no manda tocar .gitignore ni el package.json raíz y exige git status', () => {
  const p = promptPlaywright({ ...base, soloLocal: true })
  expect(p).toContain('git status --porcelain')
  expect(p).toContain('cd e2e-local')
  // Solo puede nombrar .gitignore y el package.json raíz para prohibirlos.
  for (const linea of p.split('\n').filter(l => /\.gitignore|package\.json/.test(l))) {
    expect(linea).toMatch(/NUNCA|nunca|No |no |ni |propio|Prohib|prohíb|dentro/)
  }
  expect(p).not.toMatch(/añade[^\n]*\.gitignore/i)
})

test('sin soloLocal el prompt sí menciona .gitignore y no exige git status', () => {
  const p = promptPlaywright({ ...base, soloLocal: false })
  expect(p).toContain('.gitignore')
  expect(p).not.toContain('git status --porcelain')
  expect(p).toContain('sf data query')
  expect(p).toContain('--target-org miSandbox')
})

test('sin ejecutar el prompt prohíbe lanzar las pruebas', () => {
  expect(promptPlaywright({ ...base, soloLocal: true, ejecutar: false })).toContain('NO debes lanzar las pruebas')
})

test('el encargo lleva la petición, el manifest y los componentes', () => {
  const e = encargo({ peticion: 'el alta de placement', manifest: 'manifest/package.xml', hayManifest: true, componentes: 'ApexClass (1): Foo', ramaBase: 'main' })
  expect(e).toContain('el alta de placement')
  expect(e).toContain('manifest/package.xml')
  expect(e).toContain('ApexClass (1): Foo')
  expect(encargo({ peticion: '', manifest: 'm.xml', hayManifest: false, componentes: '', ramaBase: 'main' })).toContain('git diff')
})
