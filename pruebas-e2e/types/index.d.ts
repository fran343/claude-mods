/** Un tipo de metadato del package.xml y sus miembros (ApexClass: [Foo, Bar]). */
export type E2eComponente = { tipo: string; miembros: string[] }

/** Resultado de una ejecución de Playwright. */
export type E2eEjecucion = { hora: string; pasan: number; fallan: number; omitidas: number }

export type E2eFase = 'inactivo' | 'preparando' | 'escribiendo' | 'ejecutando' | 'terminado' | 'interrumpido' | 'error'

export type E2eEstado = {
  fase: E2eFase
  peticion: string
  agentId?: string
  inicio?: number
  fin?: number
  manifest?: string
  componentes: E2eComponente[]
  specs: string[]
  ejecuciones: E2eEjecucion[]
  actividad: string
  pasos: string[]
  resultado?: string
}

declare module 'claude-code' {
  interface PluginState {
    'pruebas-e2e': { estado: E2eEstado }
  }
}
