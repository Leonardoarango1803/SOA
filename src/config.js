// Configuracion central del prototipo SOA.
// Los valores de confiabilidad (timeouts, reintentos, backoff) replican la seccion 9.2
// del documento final; el circuit breaker, la seccion 9.2 (interruptor de circuito).

export const HOST = "127.0.0.1";

// Puerto unico de entrada (Gateway): sirve la UI y expone /api/*.
// En la nube (Render, Railway, etc.) la plataforma inyecta el puerto en process.env.PORT;
// solo el gateway se expone al exterior. Cada servicio escucha en su propio puerto local
// para que las llamadas entre componentes sean HTTP real y se vean en los logs.
export const PORTS = {
  gateway: Number(process.env.PORT) || 4000,
  orchestrator: 4001,
  tarifario: 4002,
  clientes: 4003,
  encomiendas: 4004,
  cobros: 4005,
  facturacion: 4006,
  trazabilidad: 4007,
  notificaciones: 4008,
  recojo: 4009,
};

export const baseUrl = (name) => `http://${HOST}:${PORTS[name]}`;

// Factor para acelerar/ralentizar las esperas en la demo en vivo.
// 1 = valores reales del documento. Subelo (p. ej. 4) para una demo mas agil.
export const SPEED = Number(process.env.SOA_SPEED || 1);
const esc = (ms) => Math.round(ms / SPEED);

// Perfiles de confiabilidad por servicio destino (documento 9.2).
export const RETRY_PROFILES = {
  clientes: { timeoutMs: esc(3000), retries: 3, backoff: [500, 1000, 2000], jitter: 0.2 },
  tarifario: { timeoutMs: esc(3000), retries: 3, backoff: [500, 1000, 2000], jitter: 0.2 },
  encomiendas: { timeoutMs: esc(5000), retries: 3, backoff: [500, 1000, 2000], jitter: 0.2 },
  cobros: { timeoutMs: esc(5000), retries: 3, backoff: [500, 1000, 2000], jitter: 0.2 },
  facturacion: { timeoutMs: esc(10000), retries: 3, backoff: [2000, 4000, 8000], jitter: 0.2 },
};

// Perfil por defecto para destinos sin perfil propio.
export const DEFAULT_PROFILE = { timeoutMs: esc(3000), retries: 2, backoff: [500, 1000], jitter: 0.2 };

// Publicacion de eventos y entrega de avisos (documento 9.2).
export const EVENT_RETRIES = 5;
export const AVISO_RETRIES = 5;

// Presupuesto total de la operacion del counter (documento 9.2).
export const COUNTER_BUDGET_MS = esc(15000);

// Interruptor de circuito (documento 9.2): 5 fallos consecutivos -> 30 s abierto.
export const CIRCUIT_BREAKER = { threshold: 5, cooldownMs: esc(30000) };

// Seguridad (documento 10.2): token firmado de vida corta con perfil y sede.
export const SECURITY = {
  tokenSecret: "demo-secreto-no-usar-en-produccion",
  tokenTtlMs: esc(15 * 60 * 1000), // 15 minutos
  rateLimit: { windowMs: 10000, max: 60 }, // limite de uso por consumidor (demo)
  rastreoRateLimit: { windowMs: 10000, max: 20 }, // consulta publica
};

// Cobertura permitida (documento RN-01).
export const COBERTURA = ["Lima", "Ica", "Palpa", "Nazca", "Chimbote"];

// Interruptores de falla para la demo. Se cambian en caliente desde la UI de monitoreo
// o con POST /api/monitor/flags. TODO lo que simulan se declara como simulado.
export const flags = {
  failCobros: false, // fuerza que registrarCobro falle (demo de compensacion 7C)
  failSunat: false, // fuerza que SUNAT/OSE no responda (demo de diferimiento 8D)
  slowCobros: false, // agrega demora para disparar timeouts/backoff
};

export const SIM = {
  nota: "SUNAT/OSE, el canal de mensajeria (WhatsApp/SMS/correo) y el monitoreo GPS estan SIMULADOS.",
};
