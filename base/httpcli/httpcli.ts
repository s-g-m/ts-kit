// Package httpcli creates reusable HTTP clients with timeout cancellation, interceptors and errs integration.

import { newError, AppError, ErrorTypes, type ErrorType } from "../errs/errs.ts";

export const CodeHttpClientTimeout = "HTTP_CLIENT_TIMEOUT";
export const CodeHttpClientNetworkError = "HTTP_CLIENT_NETWORK_ERROR";
export const CodeHttpClientHttpError = "HTTP_CLIENT_HTTP_ERROR";

export const DEFAULT_HTTP_TIMEOUT_MS = 30_000;

const HEADER_ACCEPT = "Accept";
const HEADER_CONTENT_TYPE = "Content-Type";
const MIME_JSON = "application/json";

const HTTP_STATUS_NO_CONTENT = 204;
const HTTP_STATUS_BAD_REQUEST = 400;
const HTTP_STATUS_UNAUTHORIZED = 401;
const HTTP_STATUS_FORBIDDEN = 403;
const HTTP_STATUS_NOT_FOUND = 404;
const HTTP_STATUS_REQUEST_TIMEOUT = 408;
const HTTP_STATUS_CONFLICT = 409;
const HTTP_STATUS_UNPROCESSABLE = 422;
const HTTP_STATUS_SERVICE_UNAVAILABLE = 503;
const HTTP_STATUS_GATEWAY_TIMEOUT = 504;

export type RequestInterceptor = (
  url: string,
  init: RequestInit
) => Promise<{ url: string; init: RequestInit }> | { url: string; init: RequestInit };

export type ResponseInterceptor = <T>(response: Response, data: T) => Promise<T> | T;
export type ErrorInterceptor = (error: AppError) => Promise<never> | never;

export interface HttpClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
  headers?: Record<string, string>;
  interceptors?: {
    request?: RequestInterceptor[];
    response?: ResponseInterceptor[];
    error?: ErrorInterceptor[];
  };
}

export interface RequestOptions extends Omit<RequestInit, "body"> {
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  timeoutMs?: number;
}

export class HttpClient {
  private baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;
  private readonly defaultHeaders: Record<string, string>;
  private readonly requestInterceptors: RequestInterceptor[];
  private readonly responseInterceptors: ResponseInterceptor[];
  private readonly errorInterceptors: ErrorInterceptor[];

  constructor(options?: HttpClientOptions) {
    this.baseUrl = stripTrailingSlashes(options?.baseUrl ?? "");
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS;
    this.fetchFn =
      options?.fetchFn ??
      (typeof fetch !== "undefined" ? fetch.bind(globalThis) : (fetch as typeof fetch));
    this.defaultHeaders = {
      [HEADER_ACCEPT]: MIME_JSON,
      ...(options?.headers ?? {}),
    };
    this.requestInterceptors = [...(options?.interceptors?.request ?? [])];
    this.responseInterceptors = [...(options?.interceptors?.response ?? [])];
    this.errorInterceptors = [...(options?.interceptors?.error ?? [])];
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  public setBaseUrl(url: string): void {
    this.baseUrl = stripTrailingSlashes(url);
  }

  public useRequestInterceptor(interceptor: RequestInterceptor): void {
    this.requestInterceptors.push(interceptor);
  }

  public useResponseInterceptor(interceptor: ResponseInterceptor): void {
    this.responseInterceptors.push(interceptor);
  }

  public useErrorInterceptor(interceptor: ErrorInterceptor): void {
    this.errorInterceptors.push(interceptor);
  }

  public async request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
    const { query, body, timeoutMs = this.timeoutMs, headers, ...restInit } = options;
    const initialUrl = buildUrl(this.baseUrl, endpoint, query);
    const mergedHeaders = mergeHeaders(this.defaultHeaders, headers);
    const processedBody = serializeRequestBody(body, mergedHeaders);

    const { url: targetUrl, init: targetInit } = await this.applyRequestInterceptors(initialUrl, {
      ...restInit,
      headers: mergedHeaders,
      body: processedBody,
    });

    const response = await this.executeFetch(endpoint, targetUrl, targetInit, timeoutMs);
    if (!response.ok) {
      const httpError = await buildHttpError(response);
      return this.handleError(httpError);
    }

    return this.parseSuccessResponse<T>(response);
  }

  public get<T>(endpoint: string, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: "GET" });
  }

  public post<T>(endpoint: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: "POST", body });
  }

  public put<T>(endpoint: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: "PUT", body });
  }

  public patch<T>(endpoint: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: "PATCH", body });
  }

  public delete<T>(endpoint: string, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: "DELETE" });
  }

  private async applyRequestInterceptors(
    url: string,
    init: RequestInit
  ): Promise<{ url: string; init: RequestInit }> {
    let currentUrl = url;
    let currentInit = init;

    for (const interceptor of this.requestInterceptors) {
      const intercepted = await interceptor(currentUrl, currentInit);
      currentUrl = intercepted.url;
      currentInit = intercepted.init;
    }

    return { url: currentUrl, init: currentInit };
  }

  private async executeFetch(
    endpoint: string,
    url: string,
    init: RequestInit,
    timeoutMs: number
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId =
      timeoutMs > 0
        ? setTimeout(() => {
            controller.abort(new Error(`Request timed out after ${timeoutMs}ms`));
          }, timeoutMs)
        : undefined;

    if (init.signal) {
      init.signal.addEventListener("abort", () => controller.abort(init.signal?.reason));
    }

    try {
      return await this.fetchFn(url, { ...init, signal: controller.signal });
    } catch (err: unknown) {
      const appError = classifyTransportError(endpoint, controller.signal.aborted, err);
      return this.handleError(appError);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  private async parseSuccessResponse<T>(response: Response): Promise<T> {
    if (response.status === HTTP_STATUS_NO_CONTENT) {
      return {} as T;
    }

    const contentType = response.headers?.get?.("content-type") ?? "";
    let result: T =
      !contentType || contentType.includes(MIME_JSON)
        ? ((await response.json()) as T)
        : ((await response.text()) as unknown as T);

    for (const interceptor of this.responseInterceptors) {
      result = await interceptor(response, result);
    }

    return result;
  }

  private handleError(err: AppError): never {
    for (const interceptor of this.errorInterceptors) {
      interceptor(err);
    }
    throw err;
  }
}

export function newClient(options?: HttpClientOptions): HttpClient {
  return new HttpClient(options);
}

function stripTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, "");
}

function buildUrl(
  baseUrl: string,
  endpoint: string,
  query?: Record<string, string | number | boolean | undefined | null>
): string {
  const isAbsolute = /^https?:\/\//i.test(endpoint);
  const normalizedEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  const basePath = isAbsolute ? endpoint : `${baseUrl}${normalizedEndpoint}`;

  if (!query) {
    return basePath;
  }

  const params = new URLSearchParams();
  for (const [key, val] of Object.entries(query)) {
    if (val !== undefined && val !== null) {
      params.append(key, String(val));
    }
  }

  const queryString = params.toString();
  if (!queryString) {
    return basePath;
  }

  const separator = basePath.includes("?") ? "&" : "?";
  return `${basePath}${separator}${queryString}`;
}

function mergeHeaders(
  defaultHeaders: Record<string, string>,
  customHeaders?: HeadersInit
): Record<string, string> {
  return {
    ...defaultHeaders,
    ...((customHeaders as Record<string, string>) ?? {}),
  };
}

function isRawBodyInit(body: unknown): body is BodyInit {
  if (typeof body === "string") {
    return true;
  }
  if (typeof FormData !== "undefined" && body instanceof FormData) {
    return true;
  }
  if (typeof Blob !== "undefined" && body instanceof Blob) {
    return true;
  }
  return false;
}

function serializeRequestBody(
  body: unknown,
  headers: Record<string, string>
): BodyInit | undefined {
  if (body === undefined || body === null) {
    return undefined;
  }
  if (isRawBodyInit(body)) {
    return body;
  }
  if (!headers[HEADER_CONTENT_TYPE]) {
    headers[HEADER_CONTENT_TYPE] = MIME_JSON;
  }
  return JSON.stringify(body);
}

function classifyTransportError(endpoint: string, aborted: boolean, err: unknown): AppError {
  const isTimeout =
    aborted ||
    (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError"));

  const appError = isTimeout
    ? newError(CodeHttpClientTimeout, `Request to ${endpoint} timed out`).timeout()
    : newError(
        CodeHttpClientNetworkError,
        `Network request failed: ${err instanceof Error ? err.message : String(err)}`
      ).internal();

  appError.wrap(err);
  return appError;
}

async function buildHttpError(response: Response): Promise<AppError> {
  const { message, details } = await extractErrorPayload(response);
  const errType = mapHttpStatusToErrorType(response.status);
  const httpError = newError(CodeHttpClientHttpError, message).withType(errType);

  if (details && typeof details === "object") {
    httpError.withDetails(details as Record<string, unknown>);
  }

  return httpError;
}

async function extractErrorPayload(
  response: Response
): Promise<{ message: string; details?: unknown }> {
  const fallbackMessage = `HTTP ${response.status}: ${response.statusText}`;

  try {
    const parsed = (await response.json()) as Record<string, unknown> | null;
    if (parsed && typeof parsed.message === "string") {
      return { message: parsed.message, details: parsed };
    }
    if (parsed && typeof parsed.error === "string") {
      return { message: parsed.error, details: parsed };
    }
    return { message: fallbackMessage, details: parsed ?? undefined };
  } catch {
    try {
      const text = await response.text();
      return { message: text || fallbackMessage };
    } catch {
      return { message: fallbackMessage };
    }
  }
}

const HTTP_STATUS_ERROR_TYPES: Record<number, ErrorType> = {
  [HTTP_STATUS_BAD_REQUEST]: ErrorTypes.BadRequest,
  [HTTP_STATUS_UNAUTHORIZED]: ErrorTypes.Unauthorized,
  [HTTP_STATUS_FORBIDDEN]: ErrorTypes.Forbidden,
  [HTTP_STATUS_NOT_FOUND]: ErrorTypes.NotFound,
  [HTTP_STATUS_CONFLICT]: ErrorTypes.Conflict,
  [HTTP_STATUS_UNPROCESSABLE]: ErrorTypes.Validation,
  [HTTP_STATUS_REQUEST_TIMEOUT]: ErrorTypes.Timeout,
  [HTTP_STATUS_GATEWAY_TIMEOUT]: ErrorTypes.Timeout,
  [HTTP_STATUS_SERVICE_UNAVAILABLE]: ErrorTypes.ServiceUnavailable,
};

function mapHttpStatusToErrorType(status: number): ErrorType {
  return HTTP_STATUS_ERROR_TYPES[status] ?? ErrorTypes.Internal;
}
