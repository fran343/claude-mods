# claude-mods

Mods personales para Claude Code.

## duo: modo equipo

Reparte una tarea grande entre tantos agentes como tenga sentido (de 1 a N), que trabajan a la vez y se hablan por una **pizarra** compartida. Claude hace de **coordinador**: divide la tarea en un **plan** de subtareas (con dependencias y los archivos de cada una), lanza a los agentes, los supervisa y al final te resume el resultado.

Tipos de agente:

- **analista**: estudia el código y dice qué hay que cambiar. No toca archivos.
- **implementador**: construye el cambio con lo que le pasa el analista.
- **trabajador**: agente genérico; se encarga de una tarea del plan, toca solo sus archivos y la marca como hecha.
- **entregas**: prepara el package.xml, valida en sandbox sin desplegar y deja la rama, los commits y el pull request listos. Nunca toca producción ni fusiona.

Analista más implementador es el caso de dos agentes de siempre.

### Cómo se usa

- Escribe `/duo <tarea>`, por ejemplo:
  `/duo Construye la migración del objeto Placement de SFDC`
- También puedes pedirlo con tus palabras. En tareas grandes, Claude decide por sí mismo usar el modo equipo.
- `/duo-panel` abre un panel con la conversación entre los agentes.
- `/duo-seguimiento` abre un panel con el plan (○ pendiente, ◐ en curso, ⊘ bloqueada, ● hecha, ✕ fallida) y una tarjeta por agente.
- Incluye la skill **modo-duo**: cuando una tarea lo merece, Claude te lo recomienda y te explica por qué antes de lanzarlo.

### El plan y las reservas de archivos

- Las tareas con dependencias esperan a que terminen las anteriores; cuando una se marca como hecha, Claude recibe el aviso de las que quedan libres y las lanza.
- Cada archivo lo edita un solo agente a la vez. Si otro lo intenta, se le deniega y se le dice quién lo tiene; se libera cuando ese agente termina.
- Hay un máximo de agentes trabajando a la vez (`maxAgentes`).
- Los agentes del equipo no pueden hacer push forzado, subir directamente a main, fusionar pull requests ni desplegar fuera de la org de pruebas: solo pueden desplegar en la org que pongas en `/config` → Org de pruebas, nombrándola en el comando (`--target-org`). Sin org de pruebas configurada, solo pueden validar.

### Tester de Apex

En proyectos de Salesforce, cada clase o trigger Apex que se modifica (sin contar las clases de test) se pasa a un tercer agente, el **tester de Apex**, que se lanza solo en segundo plano. Crea y ejecuta los tests hasta que cada clase llega a la cobertura mínima, únicamente en una sandbox o scratch org, y avisa a Claude con el resultado. Aparece como tercera tarjeta en `/duo-seguimiento`.

### Opciones (`/config`)

- `testerApex`: activa o desactiva el tester de Apex (activado por defecto).
- `coberturaMinima`: cobertura que debe alcanzar cada clase (75 % por defecto).
- `orgApex`: alias de la org donde lanzar los tests (vacío: la org por defecto del proyecto).
- `maxAgentes`: cuántos agentes del equipo pueden trabajar a la vez (5 por defecto; no cuenta el tester de Apex).
- `ramaBase`: rama desde la que el agente de entregas crea la suya (vacío: la principal del repositorio).
- `crearPR`: que el agente de entregas abra el pull request (activado por defecto; nunca lo fusiona).
- `modeloAnalista`, `modeloImplementador`, `modeloTrabajador`, `modeloEntregas`, `modeloTester`: modelo de cada agente (`opus`, `sonnet`, `haiku` o `inherit`, que usa el mismo modelo que la conversación). Por defecto: opus para el analista y sonnet para el resto.

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

## pruebas-e2e: pruebas Playwright bajo demanda

Cuando terminas un desarrollo en Salesforce y quieres comprobar que de verdad funciona en pantalla, escribes `/playwright` y un agente aparte se encarga: lee el `package.xml` y el contexto del desarrollo, escribe pruebas de Playwright de lo que ha cambiado y las ejecuta en tu sandbox. Si una prueba falla por culpa de la propia prueba, la corrige y repite. Si falla porque el desarrollo no hace lo que debe, no la toca para que pase: te lo cuenta como hallazgo.

Solo trabaja cuando se lo pides. Claude no lo lanza por su cuenta.

### Cómo se usa

- `/playwright [qué probar]`: lanza el agente. Puedes decirle qué te interesa (por ejemplo, `/playwright el alta de un placement`) o dejarlo vacío para que pruebe lo que cambia en el manifest. Si ya hay unas pruebas en marcha, te avisa y no lanza otras.
- `/playwright-panel`: abre el panel con el avance: en qué fase está, qué pruebas ha escrito, cuántas pasan y cuántas fallan, y qué está haciendo ahora mismo. Al terminar, Claude recibe el resumen y te lo cuenta.

### Requisitos

- Node instalado en tu ordenador (el agente instala Playwright por su cuenta, dentro de su carpeta).
- El CLI de Salesforce (`sf`) con la sandbox ya conectada. El alias de esa sandbox lo pones en la opción `orgPruebas`.

### Solo en local

Por defecto todo lo de Playwright vive en una carpeta, `e2e-local/`, en la raíz de tu proyecto: sus pruebas, su configuración, sus dependencias, la sesión y los informes. Git no la ve, porque el mod la apunta en `.git/info/exclude`, que es una lista de ignorados que solo existe en tu ordenador y nunca se sube. Además, el agente no toca ningún archivo que ya esté en el repositorio (ni el `package.json`, ni el `.gitignore`), y al terminar comprueba con `git status` que no ha aparecido ningún cambio. Así no tienes nada que commitear ni que revisar.

Si prefieres que las pruebas formen parte del repositorio, desactiva `soloLocal`.

### Opciones (`/config`)

- `soloLocal`: todo queda solo en tu ordenador y git no ve nada (activado por defecto).
- `orgPruebas`: alias de la sandbox donde se ejecutan las pruebas (vacío: la org por defecto del proyecto, solo si es sandbox).
- `manifest`: ruta del `package.xml` del desarrollo (`manifest/package.xml` por defecto).
- `carpetaTests`: carpeta donde se guarda todo (`e2e-local` por defecto).
- `ramaBase`: rama con la que se compara para saber qué ha cambiado (vacío: la principal del repositorio).
- `navegador`: `chromium`, `firefox` o `webkit` (`chromium` por defecto).
- `ejecutar`: además de escribir las pruebas, ejecutarlas y corregir las que fallen por sí mismas (activado por defecto). Si lo desactivas, solo las escribe.
- `modelo`: modelo del agente (`opus`, `sonnet`, `haiku` o `inherit`, que usa el mismo que la conversación). `sonnet` por defecto.

### Seguridad

- Solo funciona en una sandbox: antes de empezar comprueba que la org lo es, y si no, se para y te avisa. Nunca prueba contra producción.
- No guarda usuarios, contraseñas ni sesiones en el repositorio. La sesión se abre con el CLI de Salesforce y se queda dentro de la carpeta de pruebas, que git ignora.
- No toca tu código: solo crea y edita archivos dentro de la carpeta de pruebas.
- Los datos de prueba se crean en la propia prueba y se borran al terminar.

### Instalación

En una terminal, abre `claude` y escribe:

```
/plugin install pruebas-e2e@claude-mods
```

Si todavía no has añadido el marketplace, primero `/plugin marketplace add fran343/claude-mods`.

### Desarrollo

```
claude plugin validate pruebas-e2e
claude plugin test pruebas-e2e
```
