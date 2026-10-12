import { expect, test } from 'claude-code/testing'

import { describirPaso, esSpec, parseManifest, resultadoPlaywright, resumenComponentes } from '../hooks/analisis'

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
  <!-- clases -->
  <types>
    <members>PlacementService</members>
    <members> PlacementController </members>
    <name>ApexClass</name>
  </types>
  <types>
    <members>*</members>
    <name>LightningComponentBundle</name>
  </types>
  <types><members>Account.Fecha__c</members><name>CustomField</name></types>
  <version>60.0</version>
</Package>`

test('parseManifest lee varios tipos, recorta espacios y conserva el comodín', () => {
  expect(parseManifest(XML)).toEqual([
    { tipo: 'ApexClass', miembros: ['PlacementService', 'PlacementController'] },
    { tipo: 'LightningComponentBundle', miembros: ['*'] },
    { tipo: 'CustomField', miembros: ['Account.Fecha__c'] },
  ])
})

test('parseManifest ignora comentarios con tipos y tolera un manifest vacío', () => {
  expect(parseManifest('<Package><!-- <types><members>X</members><name>Y</name></types> --></Package>')).toEqual([])
  expect(parseManifest('')).toEqual([])
})

test('resumenComponentes nombra los miembros y respeta el máximo', () => {
  const r = resumenComponentes(parseManifest(XML))
  expect(r).toContain('ApexClass (2): PlacementService, PlacementController')
  expect(r).toContain('LightningComponentBundle (1): *')
  expect(resumenComponentes([])).toBe('')
  expect(resumenComponentes([{ tipo: 'ApexClass', miembros: ['A', 'B', 'C', 'D'] }], 2)).toContain('+2')
})

test('resultadoPlaywright entiende el reporter line y list', () => {
  expect(resultadoPlaywright('Running 5 tests using 1 worker\n  1 failed\n  4 passed (12.3s)')).toEqual({ pasan: 4, fallan: 1, omitidas: 0 })
  expect(resultadoPlaywright('  2 skipped\n  3 passed (4s)')).toEqual({ pasan: 3, fallan: 0, omitidas: 2 })
})

test('resultadoPlaywright cuenta los flaky como pasan y quita los colores', () => {
  expect(resultadoPlaywright('  1 flaky\n  3 passed (4s)')).toEqual({ pasan: 4, fallan: 0, omitidas: 0 })
  expect(resultadoPlaywright('\u001b[31m  2 failed\u001b[39m\n\u001b[32m  1 passed\u001b[39m (3s)')).toEqual({ pasan: 1, fallan: 2, omitidas: 0 })
})

test('resultadoPlaywright devuelve undefined sin resumen', () => {
  expect(resultadoPlaywright('')).toBeUndefined()
  expect(resultadoPlaywright('Error: no se encuentra playwright.config.ts')).toBeUndefined()
})

test('esSpec reconoce las pruebas en cualquier carpeta', () => {
  expect(esSpec('e2e-local/placement.spec.ts')).toBe(true)
  expect(esSpec('/p/e2e-local/pages/a.spec.js')).toBe(true)
  expect(esSpec('a.test.ts')).toBe(true)
  expect(esSpec('e2e-local/pages/PlacementPage.ts')).toBe(false)
  expect(esSpec('playwright.config.ts')).toBe(false)
  expect(esSpec('x.spec.ts.bak')).toBe(false)
})

test('describirPaso habla en español', () => {
  expect(describirPaso('Bash', { command: 'cd e2e-local && npx playwright test' })).toBe('Ejecutando las pruebas')
  expect(describirPaso('Bash', { command: 'sf data query -q x' })).toBe('Consultando la org')
  expect(describirPaso('Write', { file_path: '/p/e2e-local/a.spec.ts' })).toContain('Escribiendo prueba')
  expect(describirPaso('Read', { file_path: 'a.cls' })).toContain('Leyendo')
})
