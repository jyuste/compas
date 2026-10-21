# Plan de implementación — Compás

Aplicación personal para configurar y ejecutar los horarios de Argon desde Cloudflare. Una cuenta administradora y zona horaria fija Europe/Madrid.

## 1. Modelo y reglas

- Semana de siete días; días activables e intervalos de entrada/salida con minutos finales completos.
- Prioridad: pausa global; vacaciones/festivos; excepción de un día; periodo especial; semana habitual.
- Periodos especiales con fechas explícitas y su propia semana. Se rechazan periodos horarios solapados, salvo las excepciones de un día. No se importan festivos automáticamente.
- Horarios iniciales: L–V 08:25:00–08:36:59, salida L–J 17:28:00–17:40:59 y V 14:55:00–15:03:59.
- No se admiten jornadas nocturnas. La conversión de hora está diseñada para horarios diurnos en Madrid.

## 2. Persistencia y programación

- D1: configuración versionada, acciones e intentos de autenticación.
- Cron cada minuto: asegura la planificación del día actual; recupera fallos de creación sin cambiar las horas elegidas.
- Un Workflow por acción y versión, con espera persistente hasta un segundo aleatorio.
- Cada cambio de configuración invalida las acciones pendientes y vuelve a planificar. Si el intervalo ya ha comenzado, la nueva hora puede caer en el pasado y ejecutarse de inmediato dentro de la ventana. Si ha finalizado, no se recupera.
- Antes de enviar: comprobar versión, exclusiones, fecha, límite y reclamar la acción de forma atómica en D1. La pausa afecta a acciones pendientes; una petición ya enviada no puede cancelarse.
- Sin reintentos de peticiones a Argon. Los resultados inciertos y acciones en envío bloquean otra ejecución del mismo día/acción. No existe garantía de exactamente una vez entre D1 y una API externa sin idempotencia; ante un fallo se prioriza no duplicar.

## 3. Panel

- Acceso por contraseña, sesión firmada HttpOnly de ocho horas, control de origen y límite de intentos.
- Vista general con horas y estados, calendario mensual navegable, semana editable, CRUD de periodos y ausencias, pausa e historial de 200 acciones.
- Configuración con control de concurrencia: si otra sesión ha guardado cambios se exige recargar.
- El token no llega al navegador. El modo real solo se activa en la configuración del servidor.

## 4. Validación y entrega

- Pruebas de prioridad, segundos incluidos, fechas inválidas y horario de verano/invierno.
- Compilación TypeScript y empaquetado de Wrangler sin despliegue.
- Prueba local de acceso, persistencia, revisión concurrente, exclusiones y simulación.
- Entrega de código, lockfile, migración y guía de despliegue en la cuenta Cloudflare del propietario.

## 5. Puesta en producción

1. Crear D1 en la cuenta Cloudflare y configurar su identificador.
2. Aplicar migración y configurar secretos de administración y sesión.
3. Desplegar en simulación; comprobar calendario y acciones.
4. Añadir el token de Argon y cambiar APP_MODE a live cuando se quiera activar.
5. Validar una entrada y salida reales contra Argon y revisar el historial.

La ejecución puede tener retrasos; no se promete precisión al segundo. Las notificaciones externas, calendario de festivos automático, usuarios múltiples y exportación son ampliaciones fuera de esta primera versión.
