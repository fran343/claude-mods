# claude-mods

Mods personales para Claude Code.

## duo: dos agentes que se hablan

Reparte una tarea grande entre dos agentes que trabajan a la vez:

- **analista**: estudia el código y dice qué hay que cambiar (clases, dependencias, riesgos). No toca archivos.
- **implementador**: va construyendo el cambio con lo que le pasa el analista y le avisa de cada paso para que lo revise.

Se comunican por una **pizarra** compartida. Claude hace de **coordinador**: los lanza, puede escribirles y al final te resume el resultado.

### Cómo se usa

- Escribe `/duo <tarea>`, por ejemplo:
  `/duo Construye la migración del objeto Placement de SFDC`
- También puedes pedirlo con tus palabras. En tareas grandes, Claude decide por sí mismo usar el modo duo.
- `/duo-panel` abre un panel con la conversación entre los dos agentes.
- Incluye la skill **modo-duo**: cuando una tarea lo merece (migraciones, refactors grandes, cambios de modelo de datos), Claude te recomienda usar el modo duo y te explica por qué antes de lanzarlo.

### Instalación

En una terminal, abre `claude` y escribe:

```
/plugin install duo --marketplace fran343/claude-mods
```

Responde `y` para añadir el marketplace y elige el ámbito **user** (el primero), para que funcione en todos tus proyectos. Desde ese momento se carga en todas las sesiones de Claude Code de tu ordenador: en la terminal, en la extensión de VS Code y en la app de escritorio.

Como el repositorio es privado, tu ordenador tiene que poder clonarlo (por ejemplo, con `gh auth login` hecho).

Para actualizarlo: `claude plugin update duo`, y después `/reload-plugins` dentro de la sesión.

### Probarlo sin instalar

```
git clone https://github.com/fran343/claude-mods
claude --plugin-dir claude-mods/duo
```

### Desarrollo

```
claude plugin validate duo
claude plugin test duo
```
