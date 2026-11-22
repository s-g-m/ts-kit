# Kit

Librerías para TypeScript (Web y Mobile).

## Organización

`base` agrupa la base común en una única versión y sin dependencias de interfaz visual ni de dominio. Sus paquetes conservan responsabilidades independientes:

| Paquete de `base` | Responsabilidad                                                                                                                                          |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `errs`            | Clasificación de errores (`AppError`), severidad, detalles, conservación de causas (`wrap`) y resolución de mensajes para el usuario (`resolveMessage`). |
| `env`             | Lectura tipada y validación de variables de entorno (isomórfico para Vite, Expo y Node) y `resolveHostUrl` para el emulador Android.                     |
| `httpcli`         | Cliente HTTP sobre `fetch` con timeout, interceptores (`bearerInterceptor`) y métricas/trazas automáticas.                                               |
| `ids`             | Identificadores UUIDv7 (`uuidv7`).                                                                                                                       |
| `telemetry`       | Funciones de operaciones sobre OpenTelemetry, exportación OTLP/consola y API previa de logs/eventos compatible.                                          |
| `storage`         | Contrato de persistencia clave-valor (`StorageAdapter`) con adaptadores `LocalStorageAdapter` y `MemoryStorageAdapter`.                                  |

Los módulos opcionales dependen únicamente de `base` (y `firebase/*` también de `auth`):

| Módulo            | Responsabilidad                                                                                                                                           |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth`            | Ciclo de vida de tokens JWT, deduplicación de renovaciones concurrentes, interceptor para `httpcli` y contrato `AuthGateway` de proveedores de identidad. |
| `hooks`           | Primitivas reactivas agnósticas para React (`useDebounce`, `useInterval`, `useAsync`, `useStorage`).                                                      |
| `firebase/web`    | `AuthGateway` sobre Firebase Auth para navegador (`createFirebaseWebAuth`).                                                                               |
| `firebase/native` | `AuthGateway` sobre `@react-native-firebase/auth` (`createFirebaseNativeAuth`).                                                                           |
| `expo/network`    | Conectividad del dispositivo con `expo-network` (`subscribeOnline`, `useOnline`).                                                                         |
| `expo/sqlite`     | Contrato `SqliteDatabase` y apertura diferida de almacenes con `expo-sqlite` (`lazyStore`).                                                               |

Las rutas de importación son `@s-g-m/ts-kit/base/<paquete>` y `@s-g-m/ts-kit/<módulo>`. Ningún módulo de Kit depende de las aplicaciones consumidoras ni conoce conceptos de negocio. `archtest` en cada proyecto consumidor verifica estos límites y prohíbe importar los SDK de proveedor fuera de Kit.

Los SDK de proveedor y de plataforma (`react`, `firebase`, `@react-native-firebase/*`, `expo-network`, `expo-sqlite`) son `peerDependencies` opcionales: la aplicación instala solo los que usa y cada módulo vive en su propia ruta, así la web no arrastra React Native. Kit los instala como dependencias de desarrollo solo para compilar y probar.

### Consumo desde un checkout local

Mientras Kit evoluciona, los proyectos lo instalan con `file:` apuntando al checkout local. Como el enlace es simbólico, los bundlers deben resolver los paquetes compartidos desde la aplicación y no desde `node_modules` de Kit, o cargarían dos copias: en Vite con `resolve.dedupe` (`react`, `react-dom`, `firebase`) y `server.fs.allow` con la ruta de Kit; en Metro agregando Kit a `watchFolders` y redirigiendo en `resolver.resolveRequest` los paquetes compartidos importados desde Kit.

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

Una respuesta no exitosa se lanza como `AppError` con el tipo del status (incluidos `GONE` 410, `PRECONDITION_FAILED` 412, `PRECONDITION_REQUIRED` 428 y `TOO_MANY_REQUESTS` 429). Si el cuerpo es el sobre de error de go-kit (`{ "error": { "code", "message", "details" } }`), el código del servidor pasa a ser el código del `AppError` y `details` conserva solo los detalles internos, así `resolveMessage` resuelve textos por código; con otros cuerpos el código es `CodeHttpClientHttpError`.

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

| Función                          | Resultado                                                                                                                                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `success(code)`                  | Incrementa `operation.count` con `status=success` y `code`.                                                                                                                                                  |
| `failure(code, type)`            | Incrementa `operation.count` con `status=error`, `code` y `type`.                                                                                                                                            |
| `fromError(error)`               | Usa código/tipo de `AppError`; los errores ordinarios se clasifican como `TELEMETRY_OPERATION_FAILED/INTERNAL`. Con `null` o `undefined` no registra nada.                                                   |
| `measure(operation)`             | Devuelve una función que registra una sola duración en segundos en `operation.duration`.                                                                                                                     |
| `trace(name, callback, parent?)` | Ejecuta una operación dentro de una traza, registra su clasificación de error y conserva el resultado o error original. El callback recibe el contexto para pasarlo explícitamente a operaciones asíncronas. |
| `recordError(span, error)`       | Añade código, tipo y severidad al span y lo marca como fallido, sin exportar mensajes ni detalles.                                                                                                           |

Cada llamada a `httpcli` genera un span cliente `httpcli.request`, un resultado y una duración que incluye lectura del cuerpo e interceptores. Registra método y estado HTTP en la traza. Cuenta errores HTTP, de red, timeout, deserialización e interceptores. No registra URLs, consultas, cabeceras, cuerpos ni textos de errores. Los errores se siguen devolviendo al llamador. El timeout existente limita la espera de las cabeceras; no impone un plazo adicional al consumo del cuerpo.

La propagación de contexto HTTP está desactivada por defecto. `propagationOrigins: ["https://api.example.com"]` permite `traceparent`/`tracestate` únicamente para esos orígenes exactos, después de aplicar los interceptores. Antes de activarla en web, el servidor debe admitir esas cabeceras en CORS. Para conectar una operación manual con una solicitud, pasar el contexto del callback: `trace("save", (context) => client.post("/items", data, { context }))`. No se instala un gestor global de contexto asíncrono ni se instrumenta `fetch` globalmente; las exportaciones OTLP no se contabilizan como solicitudes de negocio.

El Collector web debe admitir CORS y recibir datos mediante un endpoint público controlado; las credenciales privadas del Collector no pertenecen al bundle. `forceFlush` al pasar a segundo plano reduce pérdidas, pero no garantiza entrega cuando el navegador o sistema termina el proceso abruptamente. Esta base no incorpora captura global de crashes, Web Vitals, FPS ni reproducción de sesiones.

`Logger`, `Telemetry`, `defaultTelemetry` y sus sinks se conservan por compatibilidad y mantienen su comportamiento previo; no exportan automáticamente por OTLP. Para métricas de operaciones usar las funciones anteriores. `metricReader` y `spanExporter` aceptan componentes estándar de OpenTelemetry para pruebas o integración avanzada, sin adaptadores propios.

`newClient({ interceptors: { request: [bearerInterceptor(getToken)] } })` agrega `Authorization: Bearer <token>` cuando `getToken` devuelve un token. Los fallos de red se clasifican como `SERVICE_UNAVAILABLE` (`HTTP_CLIENT_NETWORK_ERROR`), igual que un servidor caído; los timeouts como `TIMEOUT`.

### Mensajes para el usuario

Kit resuelve el mensaje; la aplicación define los textos y su idioma:

```ts
import { ErrorTypes, resolveMessage } from "@s-g-m/ts-kit/base/errs";

const text = resolveMessage(error, {
  byCode: { AUTH_SIGN_IN_CANCELLED: "Cancelaste el inicio de sesión." },
  byType: { [ErrorTypes.ServiceUnavailable]: "No hay conexión." },
  fallback: "Algo salió mal.",
});
```

Busca primero por código de `AppError`, luego por tipo y por último usa `fallback`; un error que no es `AppError` recibe `fallback`.

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

### 6. Firebase

`createFirebaseWebAuth({ projectId, apiKey, authDomain, emulatorUrl })` y `createFirebaseNativeAuth({ emulatorUrl })` devuelven un `AuthGateway` (`onUserChanged`, `signIn("google" | "apple")`, `signOut`, `getIdToken`). El SDK persiste y renueva la sesión. `signIn` rechaza con `AUTH_SIGN_IN_CANCELLED` (ventana cerrada por el usuario, nivel `WARN`), `AUTH_SIGN_IN_UNAVAILABLE` o `AUTH_SIGN_IN_FAILED`, con la causa original en `cause`. En nativo, el login de Google y Apple todavía no está integrado: solo funciona con el emulador de Auth, que acepta tokens de proveedor sin firmar (`emulatorCredential`).

### 7. Expo

`useOnline()` devuelve la conectividad (`undefined` hasta la primera lectura); `subscribeOnline(listener)` la notifica fuera de React. `lazyStore(name, open)` abre el archivo `expo-sqlite` y construye el almacén en el primer uso, y reintenta si la apertura falla; los almacenes reciben `SqliteDatabase`, que las pruebas pueden implementar con otro motor. `uuidv7` necesita en React Native un polyfill de `crypto.getRandomValues`, como `react-native-get-random-values`.

## Estilo de pruebas

Todos los tests de `ts-kit` mantienen un único archivo `<paquete>.test.ts` por módulo:
- Constantes de prueba al inicio del archivo y helpers al final.
- Casos equivalentes agrupados en tablas `tests` con nombres descriptivos.
- Aserciones explícitas verificando código (`code`), categoría (`type`) y severidad (`level`) en errores de `errs`.

## Verificación

Biome formatea y revisa el código con la misma configuración que los frontends que consumen Kit; la regla de hooks de React se desactiva en `base/` y `auth/`, donde métodos como `useRequestInterceptor` no son hooks.

```bash
npm run format                # formatea y aplica correcciones seguras
npm run lint && npm test      # Biome, typecheck y pruebas
```
