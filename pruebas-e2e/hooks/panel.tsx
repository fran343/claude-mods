import type { Elements, RenderSurface } from 'claude-code'

import type { E2eEstado, E2eFase } from '../types'
import { corto, duracion } from './analisis'

// Dibujo del panel "Playwright". Solo usa Box y Text, que tienen todas las
// superficies; `ui` es lo que devuelve `$.ui.resolve(e)`.
type Tabla = Elements[RenderSurface]

const TITULO: Record<E2eFase, string> = {
  inactivo: 'En reposo',
  preparando: 'Preparando',
  escribiendo: 'Escribiendo pruebas',
  ejecutando: 'Ejecutando pruebas',
  terminado: 'Terminado',
  interrumpido: 'Interrumpido',
  error: 'Con error',
}

const COLOR: Record<E2eFase, 'gray' | 'yellow' | 'green' | 'red'> = {
  inactivo: 'gray',
  preparando: 'yellow',
  escribiendo: 'yellow',
  ejecutando: 'yellow',
  terminado: 'green',
  interrumpido: 'gray',
  error: 'red',
}

function nombreArchivo(ruta: string): string {
  const partes = ruta.split(/[\\/]/).filter(Boolean)
  return partes[partes.length - 1] ?? ruta
}

export function dibujarPanel(ui: Tabla, estado: E2eEstado, ancho: number) {
  const { Box, Text } = ui
  const w = Math.max(20, ancho - 2)
  const compacto = ancho < 60
  const trabajando = estado.fase === 'preparando' || estado.fase === 'escribiendo' || estado.fase === 'ejecutando'

  if (estado.fase === 'inactivo') {
    return (
      <Box flexDirection="column">
        <Text bold>Playwright</Text>
        <Text dimColor>Escribe /playwright [qué probar] para que un agente cree y ejecute pruebas en la sandbox.</Text>
      </Box>
    )
  }

  const tiempo = estado.inicio !== undefined ? duracion((estado.fin ?? Date.now()) - estado.inicio) : ''
  const totalMiembros = estado.componentes.reduce((n, c) => n + c.miembros.length, 0)
  const ultima = estado.ejecuciones[estado.ejecuciones.length - 1]
  const anteriores = estado.ejecuciones.slice(-4, -1).reverse()
  const maxPasos = compacto ? 3 : 6
  const maxSpecs = compacto ? 3 : 6
  const maxTipos = compacto ? 4 : 8

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" marginBottom={compacto ? 0 : 1}>
        <Text>
          <Text color={COLOR[estado.fase]} bold>● {TITULO[estado.fase]}</Text>
          {tiempo ? <Text dimColor> · {tiempo}</Text> : null}
        </Text>
        {estado.peticion ? (
          <Text>
            <Text bold>Petición: </Text>{corto(estado.peticion, w * (compacto ? 2 : 3))}
          </Text>
        ) : null}
      </Box>

      <Box flexDirection="column" marginBottom={compacto ? 0 : 1}>
        <Text bold>
          Componentes <Text dimColor>({estado.componentes.length > 0 ? `${totalMiembros} en ${estado.componentes.length} tipos` : 'sin manifest'})</Text>
        </Text>
        {estado.componentes.length === 0 ? (
          <Text dimColor>  El agente los deducirá de los cambios.</Text>
        ) : (
          estado.componentes.slice(0, maxTipos).map(c => (
            <Text key={`c-${c.tipo}`} dimColor>  {corto(`${c.tipo} (${c.miembros.length})${compacto ? '' : ': ' + c.miembros.join(', ')}`, w - 2)}</Text>
          ))
        )}
        {estado.componentes.length > maxTipos && <Text dimColor>  … y {estado.componentes.length - maxTipos} tipos más</Text>}
      </Box>

      <Box flexDirection="column" marginBottom={compacto ? 0 : 1}>
        <Text bold>Pruebas escritas <Text dimColor>({estado.specs.length})</Text></Text>
        {estado.specs.length === 0 && <Text dimColor>  Aún ninguna.</Text>}
        {estado.specs.slice(-maxSpecs).map(s => (
          <Text key={`s-${s}`}>  {corto(compacto ? nombreArchivo(s) : s, w - 2)}</Text>
        ))}
        {estado.specs.length > maxSpecs && <Text dimColor>  … y {estado.specs.length - maxSpecs} más</Text>}
      </Box>

      {ultima && (
        <Box flexDirection="column" marginBottom={compacto ? 0 : 1}>
          <Text bold>Última ejecución <Text dimColor>{ultima.hora}</Text></Text>
          <Text>
            {'  '}<Text color="green">✓ {ultima.pasan} pasan</Text>
            <Text dimColor> · </Text>
            <Text color={ultima.fallan > 0 ? 'red' : 'gray'}>✗ {ultima.fallan} fallan</Text>
            {ultima.omitidas > 0 ? <Text dimColor> · {ultima.omitidas} omitidas</Text> : null}
          </Text>
          {!compacto && anteriores.map((x, i) => (
            <Text key={`h-${i}-${x.hora}`} dimColor>  {x.hora}  ✓ {x.pasan} · ✗ {x.fallan}{x.omitidas > 0 ? ` · ${x.omitidas} omitidas` : ''}</Text>
          ))}
        </Box>
      )}

      {estado.actividad ? (
        <Box flexDirection="column" marginBottom={compacto ? 0 : 1}>
          <Text>
            <Text bold>{trabajando ? 'Ahora: ' : 'Último: '}</Text>{corto(estado.actividad, w - 8)}
          </Text>
          {estado.pasos.slice(-maxPasos).map((p, i) => (
            <Text key={`p-${i}`} dimColor>  {corto(p, w - 2)}</Text>
          ))}
        </Box>
      ) : null}

      {estado.resultado ? (
        <Box flexDirection="column">
          <Text bold>Resultado</Text>
          <Text>{corto(estado.resultado, w * (compacto ? 6 : 8))}</Text>
        </Box>
      ) : null}
    </Box>
  )
}
