# Kit

Librerías para TypeScript (Web y Mobile).

## Organización

`base` agrupa la base común en una única versión y sin dependencias de interfaz visual ni de dominio. Sus paquetes conservan responsabilidades independientes:

| Paquete de `base` | Responsabilidad |
| --- | --- |
| `errs` | Clasificación de errores (`AppError`), severidad, detalles y conservación de causas (`wrap`). |
| `env` | Lectura tipada y validación de variables de entorno (isomórfico para Vite, Expo y Node). |
| `httpcli` | Cliente HTTP sobre `fetch` con timeout, interceptores y métricas/trazas automáticas. |
| `telemetry` | Funciones de operaciones sobre OpenTelemetry, exportación OTLP/consola y API previa de logs/eventos compatible. |
| `storage` | Contrato de persistencia clave-valor (`StorageAdapter`) con adaptadores `LocalStorageAdapter` y `MemoryStorageAdapter`. |

Los módulos opcionales dependen únicamente de `base`:

| Módulo | Responsabilidad |
| --- | --- |
| `auth` | Ciclo de vida de tokens JWT, deduplicación de renovaciones concurrentes e interceptor para `httpcli`. |
| `hooks` | Primitivas reactivas agnósticas para React (`useDebounce`, `useInterval`, `useAsync`, `useStorage`). |

Las rutas de importación son `@s-g-m/ts-kit/base/<paquete>`, `@s-g-m/ts-kit/auth` y `@s-g-m/ts-kit/hooks`. Ningún módulo de Kit depende de las aplicaciones consumidoras ni conoce conceptos de negocio. `archtest` en cada proyecto consumidor verifica estos límites.

## Uso

### 1. `errs`

`newError(code, message)` crea un error de tipo `INTERNAL` y nivel `ERROR`. Los métodos de clasificación y severidad modifican y devuelven la misma instancia:

```ts
import { newError } from "@s-g-m/ts-kit/base/errs";

const err = newError("TICKET_NOT_FOUND", "Ticket does not exist").notFound().warn();
```

`.wrap(cause)` adjunta la causa subyacente y devuelve `null` cuando recibe `null` o `undefined`. Los errores `AbortError` y `TimeoutError` reclasifican automáticamente el tipo a `TIMEOUT`.

### 2. `env`

```ts
import { string, int, bool, url, required } from "@s-g-m/ts-kit/base/env";

const apiUrl = url("VITE_API_BASE_URL", "http://localhost:8080", import.meta.env);
const timeout = int("VITE_TIMEOUT_MS", 5000, import.meta.env);
const debugMode = bool("VITE_DEBUG", false, import.meta.env);
```

### 3. `httpcli`

```ts
import { newClient } from "@s-g-m/ts-kit/base/httpcli";

const client = newClient({
  baseUrl: "https://api.example.com",
  timeoutMs: 15_000,
});

const items = await client.get<Item[]>("/items", { query: { active: true } });
await client.post("/items", { name: "New item" });
```

### 4. `telemetry`

Inicializar una vez al arrancar la aplicación. No requiere instrumentar pantallas ni repetir llamadas de telemetría alrededor de `httpcli`.

```ts
import { init, success, fromError, measure } from "@s-g-m/ts-kit/base/telemetry";

const telemetry = init({
  serviceName: "support-web",
  environment: "production",
  endpoint: "https://telemetry.example.com",
});

// Only for operations not already instrumented by httpcli.
const stop = measure("cache.refresh");
try {
  await refreshCache();
  success("CACHE_REFRESHED");
} catch (error) {
  fromError(error);
  throw error;
} finally {
  stop();
}

await telemetry.forceFlush();
// Call shutdown only when permanently disposing the runtime.
await telemetry.shutdown();
```

`init` devuelve la misma instancia hasta `shutdown`; `shutdown` y el cierre de `measure` son idempotentes. Antes de inicializar o con `disabled: true`, las operaciones no generan telemetría. Sin `endpoint`, la exportación utiliza consola; con endpoint utiliza OTLP/HTTP JSON y añade `/v1/metrics` y `/v1/traces`. Las métricas se exportan cada 60 segundos por defecto (`exportIntervalMs`); las trazas se agrupan en lotes. La identidad usa `service.name`, `deployment.environment.name` y, opcionalmente, `service.version`. El SDK es compartido por web y React Native y no depende de React ni del DOM; la exportación móvil debe verificarse en una compilación nativa real.

| Función | Resultado |
| --- | --- |
| `success(code)` | Incrementa `operation.count` con `status=success` y `code`. |
| `failure(code, type)` | Incrementa `operation.count` con `status=error`, `code` y `type`. |
| `fromError(error)` | Usa código/tipo de `AppError`; los errores ordinarios se clasifican como `TELEMETRY_OPERATION_FAILED/INTERNAL`. Con `null` o `undefined` no registra nada. |
| `measure(operation)` | Devuelve una función que registra una sola duración en segundos en `operation.duration`. |
| `trace(name, callback, parent?)` | Ejecuta una operación dentro de una traza, registra su clasificación de error y conserva el resultado o error original. El callback recibe el contexto para pasarlo explícitamente a operaciones asíncronas. |
| `recordError(span, error)` | Añade código, tipo y severidad al span y lo marca como fallido, sin exportar mensajes ni detalles. |

Cada llamada a `httpcli` genera un span cliente `httpcli.request`, un resultado y una duración que incluye lectura del cuerpo e interceptores. Registra método y estado HTTP en la traza. Cuenta errores HTTP, de red, timeout, deserialización e interceptores. No registra URLs, consultas, cabeceras, cuerpos ni textos de errores. Los errores se siguen devolviendo al llamador. El timeout existente limita la espera de las cabeceras; no impone un plazo adicional al consumo del cuerpo.

La propagación de contexto HTTP está desactivada por defecto. `propagationOrigins: ["https://api.example.com"]` permite `traceparent`/`tracestate` únicamente para esos orígenes exactos, después de aplicar los interceptores. Antes de activarla en web, el servidor debe admitir esas cabeceras en CORS. Para conectar una operación manual con una solicitud, pasar el contexto del callback: `trace("save", (context) => client.post("/items", data, { context }))`. No se instala un gestor global de contexto asíncrono ni se instrumenta `fetch` globalmente; las exportaciones OTLP no se contabilizan como solicitudes de negocio.

El Collector web debe admitir CORS y recibir datos mediante un endpoint público controlado; las credenciales privadas del Collector no pertenecen al bundle. `forceFlush` al pasar a segundo plano reduce pérdidas, pero no garantiza entrega cuando el navegador o sistema termina el proceso abruptamente. Esta base no incorpora captura global de crashes, Web Vitals, FPS ni reproducción de sesiones.

`Logger`, `Telemetry`, `defaultTelemetry` y sus sinks se conservan por compatibilidad y mantienen su comportamiento previo; no exportan automáticamente por OTLP. Para métricas de operaciones usar las funciones anteriores. `metricReader` y `spanExporter` aceptan componentes estándar de OpenTelemetry para pruebas o integración avanzada, sin adaptadores propios.

### `storage`

```ts
import { TypedStorage, LocalStorageAdapter } from "@s-g-m/ts-kit/base/storage";

const storage = new TypedStorage({ adapter: new LocalStorageAdapter(), prefix: "app" });
storage.set("theme", "dark");
```

### 5. `auth` y `hooks`

```ts
import { AuthManager } from "@s-g-m/ts-kit/auth";
import { useDebounce, useAsync, useStorage } from "@s-g-m/ts-kit/hooks";
```

## Estilo de pruebas

Todos los tests de `ts-kit` mantienen un único archivo `<paquete>.test.ts` por módulo:

- Constantes de prueba al inicio del archivo y helpers al final.
- Casos equivalentes agrupados en tablas `tests` con nombres descriptivos.
- Aserciones explícitas verificando código (`code`), categoría (`type`) y severidad (`level`) en errores de `errs`.

## Verificación

```bash
npm test && npm run typecheck
```
