import type { E2eComponente } from '../types'

// Lógica pura del mod pruebas-e2e (sin `$`): lectura del manifest, resumen de
// resultados de Playwright y textos de actividad.

function sinComentarios(xml: string): string {
  return xml.replace(/<!--[\s\S]*?-->/g, '')
}

// Lee los <types> de un package.xml. El comodín "*" se conserva como miembro.
export function parseManifest(xml: string): E2eComponente[] {
  const limpio = sinComentarios(xml)
  const salida: E2eComponente[] = []
  const bloques = limpio.matchAll(/<types>([\s\S]*?)<\/types>/g)
  for (const b of bloques) {
    const cuerpo = b[1] ?? ''
    const nombre = /<name>\s*([^<]*?)\s*<\/name>/.exec(cuerpo)?.[1]
    if (!nombre) continue
    const miembros: string[] = []
    for (const m of cuerpo.matchAll(/<members>\s*([^<]*?)\s*<\/members>/g)) {
      const v = m[1]
      if (v) miembros.push(v)
    }
    const existente = salida.find(c => c.tipo === nombre)
    if (existente) {
      for (const m of miembros) if (!existente.miembros.includes(m)) existente.miembros.push(m)
    } else {
      salida.push({ tipo: nombre, miembros })
    }
  }
  return salida
}

// "ApexClass (3): A, B, C…" para el encargo del agente. `max` limita los
// miembros que se nombran en total.
export function resumenComponentes(c: E2eComponente[], max = 40): string {
  if (c.length === 0) return ''
  let restante = max
  return c
    .map(t => {
      const n = t.miembros.length
      const nombres = t.miembros.slice(0, Math.max(0, restante))
      restante -= nombres.length
      const resto = n - nombres.length
      const lista = nombres.join(', ') + (resto > 0 ? (nombres.length > 0 ? `… (+${resto})` : `(+${resto} más)`) : '')
      return `${t.tipo} (${n})${lista ? `: ${lista}` : ''}`
    })
    .join('\n')
}

// Resumen del reporter line/list de Playwright. undefined si no hay resumen.
export function resultadoPlaywright(salida: string): { pasan: number; fallan: number; omitidas: number } | undefined {
  const texto = salida.replace(/\u001b\[[0-9;]*m/g, '')
  const cuenta = (palabra: string): number | undefined => {
    const regs = [...texto.matchAll(new RegExp(`(?:^|[\\s,(])(\\d+)\\s+${palabra}\\b`, 'gm'))]
    const ultimo = regs[regs.length - 1]
    return ultimo ? Number(ultimo[1]) : undefined
  }
  const passed = cuenta('passed')
  const failed = cuenta('failed')
  const skipped = cuenta('skipped')
  const flaky = cuenta('flaky')
  if (passed === undefined && failed === undefined && skipped === undefined && flaky === undefined) return undefined
  return { pasan: (passed ?? 0) + (flaky ?? 0), fallan: failed ?? 0, omitidas: skipped ?? 0 }
}

export function esSpec(ruta: string): boolean {
  return /(^|[\\/])[^\\/]+\.(spec\.(ts|js)|test\.ts)$/.test(ruta)
}

function ruta(valor: unknown): string {
  const r = String(valor ?? '')
  const partes = r.split(/[\\/]/).filter(Boolean)
  return partes.length > 3 ? `…/${partes.slice(-3).join('/')}` : r
}

export function corto(texto: string, max: number): string {
  const limpio = texto.replace(/\s+/g, ' ').trim()
  return limpio.length > max ? `${limpio.slice(0, Math.max(1, max - 1))}…` : limpio
}

// Qué hace el agente, en palabras, a partir de la herramienta que usa.
export function describirPaso(tool: string, input: Record<string, unknown>): string {
  const a = input ?? {}
  switch (tool) {
    case 'Read':
      return `Leyendo ${ruta(a.file_path)}`
    case 'Write': {
      const f = String(a.file_path ?? '')
      return esSpec(f) ? `Escribiendo prueba ${ruta(f)}` : `Escribiendo ${ruta(f)}`
    }
    case 'Edit':
    case 'MultiEdit': {
      const f = String(a.file_path ?? '')
      return esSpec(f) ? `Corrigiendo prueba ${ruta(f)}` : `Editando ${ruta(f)}`
    }
    case 'Grep':
      return `Buscando "${corto(String(a.pattern ?? ''), 40)}"`
    case 'Glob':
      return `Buscando archivos ${corto(String(a.pattern ?? ''), 40)}`
    case 'Bash': {
      const cmd = String(a.command ?? '')
      if (/\bplaywright\s+test\b/.test(cmd)) return 'Ejecutando las pruebas'
      if (/\bplaywright\s+install\b/.test(cmd)) return 'Instalando el navegador de pruebas'
      if (/\bnpm\s+(i|install)\b/.test(cmd)) return 'Instalando dependencias'
      if (/\bsf\s+org\s+open\b/.test(cmd)) return 'Abriendo sesión en la org'
      if (/\bsf\s+data\b/.test(cmd)) return 'Consultando la org'
      if (/\bsf\b/.test(cmd)) return 'Usando la org de pruebas'
      if (/\bgit\s+(diff|log|status)\b/.test(cmd)) return 'Mirando los cambios del desarrollo'
      return `Ejecutando ${corto(String(a.description ?? cmd), 60)}`
    }
    case 'WebFetch':
    case 'WebSearch':
      return `Consultando ${corto(String(a.url ?? a.query ?? 'la web'), 50)}`
    case 'TodoWrite':
    case 'TaskCreate':
    case 'TaskUpdate':
      return 'Organizando sus tareas'
    case 'Agent':
      return 'Lanzando un ayudante'
    default:
      return `Usando ${tool.replace(/^mcp__/, '').replace(/__/g, ' ')}`
  }
}

export function duracion(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min ${s % 60} s`
  return `${Math.floor(m / 60)} h ${m % 60} min`
}

export function hora(): string {
  const d = new Date()
  const dos = (n: number) => String(n).padStart(2, '0')
  return `${dos(d.getHours())}:${dos(d.getMinutes())}`
}
