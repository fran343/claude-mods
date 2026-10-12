export type DuoRol = 'analista' | 'implementador' | 'coordinador'

export type DuoMensaje = {
  id: number
  de: DuoRol
  para: DuoRol
  texto: string
  hora: string
}

export type DuoAgentes = { analista?: string; implementador?: string }

declare module 'claude-code' {
  interface PluginState {
    duo: { pizarra: DuoMensaje[]; agentes: DuoAgentes }
  }
}
