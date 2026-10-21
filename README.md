# Kit

Librerías para TypeScript (Web y Mobile).

## Organización

`base` agrupa la base común en una única versión y sin dependencias de interfaz visual ni de dominio. Sus paquetes conservan responsabilidades independientes:

| Paquete de `base` | Responsabilidad |
| --- | --- |
| `errs` | Clasificación de errores (`AppError`), severidad, detalles y conservación de causas (`wrap`). |
| `env` | Lectura tipada y validación de variables de entorno (isomórfico para Vite, Expo y Node). |
| `httpcli` | Cliente HTTP sobre `fetch` con cancelación por timeout (`AbortController`), tipado e interceptores. |
| `telemetry` | Logger estructurado (`debug`, `info`, `warn`, `error`) y sinks desacoplados para eventos y métricas. |
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

### 4. `storage` y `telemetry`

```ts
import { TypedStorage, LocalStorageAdapter } from "@s-g-m/ts-kit/base/storage";
import { Logger, defaultTelemetry } from "@s-g-m/ts-kit/base/telemetry";

const storage = new TypedStorage({ adapter: new LocalStorageAdapter(), prefix: "app" });
storage.set("theme", "dark");

const logger = new Logger({ minLevel: "INFO" }).withNamespace("Support");
logger.info("Session initialized");
defaultTelemetry.trackEvent("app_loaded");
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
