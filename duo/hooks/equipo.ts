import type { DuoEquipo, DuoMiembro, DuoEstadoTarea, DuoPlan, DuoReservas, DuoTarea } from '../types'

// Lógica pura del modo equipo (sin $), para poder probarla directamente.

export const ESTADOS_TAREA: readonly DuoEstadoTarea[] = ['pendiente', 'en_curso', 'bloqueada', 'hecha', 'fallida']

export const ICONO_TAREA: Record<DuoEstadoTarea, string> = {
  pendiente: '○',
  en_curso: '◐',
  bloqueada: '⊘',
  hecha: '●',
  fallida: '✕',
}

const RESERVADOS = ['coordinador', 'tester', 'todos']

function texto(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function lista(v: unknown): string[] {
  return Array.isArray(v) ? v.map(x => texto(x)).filter(Boolean) : []
}

/** Normaliza lo que manda el modelo a tareas con todos los campos. */
export function normalizarTareas(entrada: unknown): DuoTarea[] {
  if (!Array.isArray(entrada)) return []
  return entrada.map(t => {
    const o = (t ?? {}) as Record<string, unknown>
    const detalle = texto(o.detalle)
    const agente = texto(o.agente)
    return {
      id: texto(o.id),
      titulo: texto(o.titulo) || texto(o.id),
      ...(detalle ? { detalle } : {}),
      dependeDe: lista(o.dependeDe),
      archivos: lista(o.archivos),
      ...(agente ? { agente } : {}),
      estado: 'pendiente' as const,
    }
  })
}

/** Un texto con el problema del plan, o undefined si es válido. */
export function validarPlan(tareas: DuoTarea[]): string | undefined {
  if (tareas.length === 0) return 'El plan está vacío: indica al menos una tarea.'
  const ids = new Set<string>()
  for (const t of tareas) {
    if (!t.id) return 'Hay una tarea sin id.'
    if (ids.has(t.id)) return `El id "${t.id}" está repetido.`
    ids.add(t.id)
  }
  for (const t of tareas) {
    for (const d of t.dependeDe) {
      if (d === t.id) return `La tarea ${t.id} depende de sí misma.`
      if (!ids.has(d)) return `La tarea ${t.id} depende de "${d}", que no existe en el plan.`
    }
  }
  // Ciclos: recorrido en profundidad con marcas.
  const por = new Map(tareas.map(t => [t.id, t]))
  const marca = new Map<string, 1 | 2>()
  const camino: string[] = []
  const visita = (id: string): string | undefined => {
    if (marca.get(id) === 2) return undefined
    if (marca.get(id) === 1) return `Hay un ciclo entre las tareas: ${[...camino.slice(camino.indexOf(id)), id].join(' → ')}.`
    marca.set(id, 1)
    camino.push(id)
    for (const d of por.get(id)?.dependeDe ?? []) {
      const r = visita(d)
      if (r) return r
    }
    camino.pop()
    marca.set(id, 2)
    return undefined
  }
  for (const t of tareas) {
    const r = visita(t.id)
    if (r) return r
  }
  return undefined
}

/** Sustituye el plan conservando estado, nota y agente de los ids que ya existían. */
export function fusionarPlan(anterior: DuoPlan, nuevas: DuoTarea[]): DuoPlan {
  const antes = new Map(anterior.map(t => [t.id, t]))
  return nuevas.map(t => {
    const a = antes.get(t.id)
    if (!a) return t
    return { ...t, estado: a.estado, ...(a.nota ? { nota: a.nota } : {}), ...(t.agente ?? a.agente ? { agente: t.agente ?? a.agente } : {}) }
  })
}

/** Dependencias que aún no están hechas. */
export function pendientesDe(plan: DuoPlan, t: DuoTarea): string[] {
  return t.dependeDe.filter(d => plan.find(x => x.id === d)?.estado !== 'hecha')
}

/** Tareas aún pendientes cuyas dependencias están todas hechas. */
export function desbloqueadas(plan: DuoPlan): DuoTarea[] {
  return plan.filter(t => t.estado === 'pendiente' && pendientesDe(plan, t).length === 0)
}

export function resumenPlan(plan: DuoPlan): string {
  if (plan.length === 0) return ''
  const hechas = plan.filter(t => t.estado === 'hecha').length
  const filas = plan.map(t => {
    const espera = t.estado === 'hecha' ? [] : pendientesDe(plan, t)
    return `${ICONO_TAREA[t.estado]} ${t.id} ${t.titulo}${t.agente ? ` · ${t.agente}` : ''}${espera.length ? ` · espera a ${espera.join(', ')}` : ''}${t.nota ? ` · ${t.nota}` : ''}`
  })
  return `PLAN (${hechas}/${plan.length} hechas)\n${filas.join('\n')}`
}

/** Nombres a los que se puede escribir en la pizarra. */
export function nombresValidos(equipo: DuoEquipo): string[] {
  return [...new Set(['analista', 'implementador', ...Object.keys(equipo), 'tester', 'coordinador', 'todos'])]
}

/** Elige un nombre libre: el pedido (limpio) si nadie lo tiene, si no con sufijo (-2, -3...). */
export function nombreLibre(equipo: DuoEquipo, pedido: string): string {
  const limpio = pedido.replace(/[^\w.-]/g, '-') || 'agente'
  const ocupado = (n: string) => RESERVADOS.includes(n) || n in equipo
  if (!ocupado(limpio)) return limpio
  for (let i = 2; ; i++) if (!ocupado(`${limpio}-${i}`)) return `${limpio}-${i}`
}

export function nombreTrabajador(equipo: DuoEquipo): string {
  for (let i = 1; ; i++) if (!equipo[`trabajador-${i}`]) return `trabajador-${i}`
}

/** La tarea (T1, T2...) con la que empieza una descripción. */
export function tareaDeDescripcion(descripcion: string | undefined): string | undefined {
  return /^\s*(T\d+)\b/i.exec(descripcion ?? '')?.[1]
}

/** Minutos sin actividad a partir de los cuales se da a un agente por colgado. */
export const MINUTOS_COLGADO = 15

/** Un miembro cuenta como trabajando si lo está y no lleva demasiado sin dar señales. */
export function activo(m: DuoMiembro | undefined, ahora: number): boolean {
  if (!m || m.estado !== 'trabajando') return false
  return m.ultimo === undefined || ahora - m.ultimo <= MINUTOS_COLGADO * 60_000
}

/** Si otro miembro que sigue trabajando tiene el archivo reservado, el texto del rechazo. */
export function comprobarReserva(reservas: DuoReservas, equipo: DuoEquipo, archivo: string, yo: string, ahora = Date.now()): string | undefined {
  const dueno = reservas[archivo]
  if (!dueno || dueno === yo || !activo(equipo[dueno], ahora)) return undefined
  const tarea = equipo[dueno]?.tarea
  return `${archivo} lo está editando ${dueno}${tarea ? ` (tarea ${tarea})` : ''}. Pídeselo por la pizarra, espera a que termine o pide al coordinador que lo pare.`
}

/** Ruta normalizada para reservar: barras normales y sin "./". */
export function rutaReserva(ruta: string): string {
  return ruta.replace(/\\/g, '/').replace(/^\.\//, '')
}

/** Comandos que el modo equipo nunca deja ejecutar a sus agentes (el tester de Apex sí puede desplegar en sandbox). */
export function comandoProhibido(cmd: string, ramaBase?: string, opciones: { permitirDeploy?: boolean; orgPruebas?: string } = {}): string | undefined {
  const base = ramaBase?.trim()
  const nombre = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const push = String.raw`\bgit\b(?:\s+(?:-C|-c)\s+\S+)*\s+push\b`
  const dentro = (re: string) => new RegExp(`${push}[^\\n]*${re}`)
  if (dentro(String.raw`(?:\s-[a-zA-Z]*f[a-zA-Z]*(?=\s|$)|--force|--mirror|\s\+\S)`).test(cmd)) return 'hacer push forzado'
  if (dentro(String.raw`(?:--delete|\s-d(?=\s)|\s:\S)`).test(cmd)) return 'borrar ramas remotas'
  if (dentro(String.raw`[\s:/](?:main|master)(?=[\s;&|)]|$)`).test(cmd)) return 'subir directamente a main o master'
  if (base && dentro(String.raw`[\s:/]${nombre(base)}(?=[\s;&|)]|$)`).test(cmd)) return `subir directamente a la rama ${base}`
  if (/\bgh\s+pr\s+merge\b/.test(cmd)) return 'fusionar un pull request'
  if (/\bgh\s+pr\s+review\b[^\n]*--approve/.test(cmd)) return 'aprobar un pull request'
  if (/\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f)/.test(cmd)) return 'borrar cambios sin guardar con git reset --hard o git clean'
  // Desplegar solo en la org de pruebas de /config, nombrada en el propio comando.
  const org = opciones.orgPruebas?.trim()
  const enOrgPruebas = !!org && new RegExp(String.raw`(?:--target-org|-o)(?:\s+|=)["']?${nombre(org)}["']?(?=[\s;&|)]|$)`).test(cmd)
  if (!opciones.permitirDeploy && !enOrgPruebas) {
    if (/\bsf\s+project\s+deploy\s+(start|quick)\b/.test(cmd) || /\bsf\s+deploy\s+metadata\b/.test(cmd)) {
      return org
        ? `desplegar fuera de la org de pruebas (añade --target-org ${org}, o valida con "sf project deploy validate")`
        : 'desplegar sin una org de pruebas configurada (configúrala en /config → Org de pruebas, o valida con "sf project deploy validate")'
    }
    if (/\bsfdx\s+force:(source|mdapi):deploy\b/.test(cmd) && !/(\s-c\b|--checkonly)/.test(cmd)) return 'desplegar (solo se puede validar)'
  }
  return undefined
}

/** Tareas en curso del plan anterior que el nuevo plan ya no tiene. */
export function quitadasEnCurso(anterior: DuoPlan, nuevas: DuoTarea[]): string[] {
  const ids = new Set(nuevas.map(t => t.id))
  return anterior.filter(t => t.estado === 'en_curso' && !ids.has(t.id)).map(t => t.id)
}
