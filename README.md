## Despliegue actual

- URL: https://argon-planner.merch-desk.workers.dev
- Cuenta: jose.yuste@gmail.com (`dd566cdd2698109386a2f97f3e3c1dba`).
- D1: `argon-planner` (`e966db64-875a-46eb-b584-a5fa1f174c34`).
- Workflow: `argon-fichaje`. Cron: cada minuto.
- Modo: simulación. No se ha cargado el token de Argon.
- Contraseña administrativa: la configurada en `.dev.vars` al realizar el primer despliegue. El secreto de sesión de producción es independiente del local.
- Los comandos npm usan `scripts/cloudflare.mjs`: elimina las credenciales de Metech heredadas del entorno y selecciona `gmail-account`.
- Para administrar recursos: `npm run cf -- <comando>`. Para desplegar: `npm run deploy`.
- Si caduca OAuth: `npm run cf -- auth create gmail-account`; verificar después con `npm run cf -- whoami`.
- Para activar Argon: `npm run cf -- secret put ARGON_TOKEN`, cambiar `APP_MODE` a `live` y `npm run deploy`.

---

# Compás · Planificador de Argon

Backoffice en español para Cloudflare Workers + D1 + Workflows. Calendario, horarios semanales, jornada intensiva, excepciones por fecha, vacaciones, pausa e historial. Arranca en **simulación**: no envía fichajes.

## Requisitos

Node.js 22 o superior, npm y una cuenta Cloudflare. No hace falta comprar un dominio. La API de Argon debe ser accesible desde Cloudflare.

## Probar en local

```sh
npm ci
cp .dev.vars.example .dev.vars
```

Edita `.dev.vars` con una contraseña de administración y un secreto aleatorio de al menos 32 caracteres. Puedes generar el secreto con `openssl rand -hex 32`. No subas ese archivo al repositorio.

```sh
npm run db:local
npm run dev -- --test-scheduled
```

Abre http://localhost:8787 e inicia sesión con la contraseña elegida. Para lanzar el programador local:

```sh
curl 'http://localhost:8787/__scheduled?cron=*+*+*+*+*'
```

La base local es independiente de producción. En desarrollo, los Cron no se ejecutan automáticamente; invoca la ruta anterior. Las esperas de Workflows se prueban manteniendo el proceso abierto.

## Desplegar en tu Cloudflare

```sh
npm run cf -- login
npm run cf -- whoami
npm run cf -- d1 create argon-planner
```

Copia el `database_id` devuelto en `wrangler.jsonc`, reemplazando `REPLACE_WITH_D1_ID`. Si tienes varias cuentas, añade el `account_id` de la cuenta deseada. Después:

```sh
npm run db:remote
npm run cf -- secret put ADMIN_PASSWORD
npm run cf -- secret put SESSION_SECRET
npm run deploy
```

Los comandos de secretos solicitan el valor de forma interactiva. Usa credenciales distintas de las de desarrollo. El despliegue devuelve la URL workers.dev del panel. Workers, D1 y Workflows quedan en tu cuenta; no utiliza Sites ni depende de esta conversación.

### Activar las peticiones reales

Primero revisa horarios, festivos y vacaciones en simulación. Crea el token en Security de Argon:

```sh
npm run cf -- secret put ARGON_TOKEN
```

Cambia `APP_MODE` en `wrangler.jsonc` de `simulation` a `live` y ejecuta `npm run deploy`. El modo se muestra en el panel y no puede cambiarse desde el navegador.

**Activa el modo real antes de la siguiente jornada.** Una acción simulada también bloquea repetir esa entrada o salida el mismo día. No hay botón de reenvío para evitar duplicados. Si has simulado una entrada hoy, espera a mañana para validar una jornada real completa.

### Pausa y cambios

Pausar o guardar horarios invalida las acciones pendientes. La reanudación replanifica dentro de los intervalos que aún no hayan terminado. Los fichajes ya enviados no pueden deshacerse. Una carrera con una petición ya en curso puede completarse después de pulsar pausa.

`Resultado incierto` o `Revisar en Argon` exige comprobar la aplicación de Argon manualmente. No cambies esos estados sin verificar que no existe el fichaje. El sistema no reintenta llamadas con resultado incierto. Un HTTP 5xx también se considera incierto.

La versión inicial no envía avisos por correo ni otros canales: los errores están en el panel y en los logs de Cloudflare.

## Verificación

```sh
npm run types
npm run check
npm test
npm run cf -- deploy --dry-run
```

`tests/planner.test.ts` comprueba las reglas y el cambio de hora. El empaquetado no prueba el acceso a Argon ni sustituye la validación real con tu token.

## Arquitectura y operación

- `src/planner.ts`: reglas, validación, aleatoriedad y conversión de horario diurno.
- `src/worker.ts`: API privada, sesiones firmadas, Cron y Workflow.
- `public/`: interfaz sin dependencias ni recursos externos.
- `migrations/`: esquema D1. Guarda configuración y hasta 200 acciones visibles; las filas de historial se conservan hasta que se eliminen administrativamente.
- `PLAN.md`: decisiones y fases de implementación.

El Cron corre cada minuto (unas 43.200 invocaciones al mes) y crea hasta dos Workflows por día laborable, además de las revisiones por cambios. El volumen esperado es pequeño respecto a las cuotas gratuitas; el consumo se comparte con otros proyectos de la cuenta. Consulta las tarifas actuales: https://developers.cloudflare.com/workflows/reference/pricing/ y https://developers.cloudflare.com/d1/platform/pricing/.

Protege la contraseña administrativa; cualquier persona que la conozca puede modificar la planificación. Se limita el acceso por contraseña a diez intentos por IP cada quince minutos, las sesiones caducan en ocho horas y la cookie es Secure sobre HTTPS. Cambiar SESSION_SECRET invalida todas las sesiones. Para exponerlo a más personas, conviene añadir Cloudflare Access y un modelo de usuarios.

Los periodos usan años explícitos y hay que crearlos cada año. No hay importación automática de festivos. Solo se admiten jornadas diurnas, sin cruzar medianoche; evita ventanas durante las horas ambiguas del cambio de hora (02:00–03:00).

## API Argon

- Entrada: `POST https://argon.metech.es/api/v1/work-sessions`, respuesta esperada 201.
- Salida: `PUT https://argon.metech.es/api/v1/work-sessions/active`, respuesta esperada 200.
- Cabeceras Bearer y Accept JSON, sin cuerpo. Timeout 20 segundos, sin seguir redirecciones ni registrar token o respuestas que puedan contener datos personales.
- Contrato: https://argon.metech.es/docs/api.
