export type DuoRol = 'analista' | 'implementador' | 'coordinador' | 'tester'

/** Agentes con ficha en el panel de seguimiento. */
export type DuoAgente = 'analista' | 'implementador' | 'tester'

export type DuoMensaje = {
  id: number
  de: DuoRol
  para: DuoRol
  texto: string
  hora: string
}

export type DuoAgentes = { analista?: string; implementador?: string }

export type DuoEstado = 'trabajando' | 'terminado' | 'interrumpido' | 'error'

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

export type DuoSeguimiento = { analista?: DuoFicha; implementador?: DuoFicha; tester?: DuoFicha }

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
    duo: { pizarra: DuoMensaje[]; agentes: DuoAgentes; seguimiento: DuoSeguimiento; apex: DuoApex }
  }
}
