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
- `/duo-seguimiento` abre un panel con lo que está haciendo cada agente.
- Incluye la skill **modo-duo**: cuando una tarea lo merece (migraciones, refactors grandes, cambios de modelo de datos), Claude te recomienda usar el modo duo y te explica por qué antes de lanzarlo.

### Tester de Apex

En proyectos de Salesforce, cada clase o trigger Apex que se modifica (sin contar las clases de test) se pasa a un tercer agente, el **tester de Apex**, que se lanza solo en segundo plano. Crea y ejecuta los tests hasta que cada clase llega a la cobertura mínima, únicamente en una sandbox o scratch org, y avisa a Claude con el resultado. Aparece como tercera tarjeta en `/duo-seguimiento`.

### Opciones (`/config`)

- `testerApex`: activa o desactiva el tester de Apex (activado por defecto).
- `coberturaMinima`: cobertura que debe alcanzar cada clase (75 % por defecto).
- `orgApex`: alias de la org donde lanzar los tests (vacío: la org por defecto del proyecto).
- `modeloAnalista`, `modeloImplementador`, `modeloTester`: modelo de cada agente (`opus`, `sonnet`, `haiku` o `inherit`, que usa el mismo modelo que la conversación). Por defecto: opus, sonnet y sonnet.

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
