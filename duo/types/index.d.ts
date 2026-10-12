/** Quién habla en la pizarra: el nombre de un miembro del equipo, "coordinador" o "tester". */
export type DuoRol = string

export type DuoMensaje = {
  id: number
  de: DuoRol
  para: DuoRol
  texto: string
  hora: string
}

export type DuoEstado = 'trabajando' | 'terminado' | 'interrumpido' | 'error'

export type DuoTipo = 'analista' | 'implementador' | 'trabajador' | 'entregas'

/** Un agente del equipo (el tester de Apex va aparte, en DuoApex). */
export type DuoMiembro = {
  agentId: string
  tipo: DuoTipo
  tarea?: string
  estado: DuoEstado
  /** Última vez que hizo algo (ms); sirve para dar por colgado a quien lleva mucho sin dar señales. */
  ultimo?: number
}

/** Los agentes del equipo por nombre ("analista", "implementador", "T1"...). */
export type DuoEquipo = Record<string, DuoMiembro>

export type DuoEstadoTarea = 'pendiente' | 'en_curso' | 'bloqueada' | 'hecha' | 'fallida'

export type DuoTarea = {
  id: string
  titulo: string
  detalle?: string
  dependeDe: string[]
  archivos: string[]
  agente?: string
  estado: DuoEstadoTarea
  nota?: string
}

export type DuoPlan = DuoTarea[]

/** Archivo reservado → nombre del miembro que lo está editando. */
export type DuoReservas = Record<string, string>

export type DuoFicha = {
  estado: DuoEstado
  inicio: number
  fin?: number
  modelo?: string
  herramientas: number
  mensajes: number
  tokens: number
  actividad: string
  pasos: string[]
  archivos: string[]
  resultado?: string
}

/** Una ficha por nombre de miembro, más "tester" para el tester de Apex. */
export type DuoSeguimiento = Record<string, DuoFicha>

export type DuoApex = {
  /** Clases y triggers modificados que aún no se han pasado al tester. */
  pendientes: string[]
  /** Todo lo que se ha pasado al tester en esta sesión. */
  enviadas: string[]
  testerId?: string
  testerActivo: boolean
}

declare module 'claude-code' {
  interface PluginState {
    duo: {
      pizarra: DuoMensaje[]
      equipo: DuoEquipo
      plan: DuoPlan
      reservas: DuoReservas
      seguimiento: DuoSeguimiento
      apex: DuoApex
    }
  }
}
