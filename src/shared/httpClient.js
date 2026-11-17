// Cliente HTTP interno entre componentes (documento 9.2): tiempo de espera (timeout),
// reintentos con espera incremental (backoff) y variacion aleatoria (jitter), interruptor
// de circuito (circuit breaker), y propagacion del correlationId y de la clave de
// idempotencia. Solo se reintentan operaciones idempotentes.
import { RETRY_PROFILES, DEFAULT_PROFILE, CIRCUIT_BREAKER, baseUrl } from "../config.js";
import { ErrorSOA } from "./errors.js";
import * as metrics from "./metrics.js";
import { log } from "./logger.js";

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const conJitter = (ms, j) => Math.round(ms * (1 + (Math.random() * 2 - 1) * j));

// Estado del interruptor de circuito por servicio destino.
const circuitos = new Map(); // destino -> { fallos, abiertoHasta }
const circuito = (d) => {
  if (!circuitos.has(d)) circuitos.set(d, { fallos: 0, abiertoHasta: 0 });
  return circuitos.get(d);
};

export function estadoCircuitos() {
  const out = {};
  for (const [d, c] of circuitos.entries()) {
    out[d] = { fallos: c.fallos, abierto: Date.now() < c.abiertoHasta };
  }
  return out;
}

// Reinicia el estado de los interruptores de circuito (util para dejar escenarios de demo independientes).
export function reiniciarCircuitos() {
  circuitos.clear();
}

async function unaLlamada(destino, path, { method, body, correlationId, idemKey, perfil }, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const headers = { "content-type": "application/json" };
  if (correlationId) headers["x-correlation-id"] = correlationId;
  if (idemKey) headers["x-idempotency-key"] = idemKey;
  if (perfil) headers["x-perfil"] = perfil;
  try {
    const res = await fetch(baseUrl(destino) + path, {
      method: method || "GET",
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const texto = await res.text();
    const data = texto ? JSON.parse(texto) : {};
    return { status: res.status, data };
  } finally {
    clearTimeout(t);
  }
}

// Llama a un servicio destino con todas las politicas de confiabilidad.
export async function llamar(destino, path, opts = {}) {
  const perfilRetry = RETRY_PROFILES[destino] || DEFAULT_PROFILE;
  const c = circuito(destino);

  // Circuit breaker abierto: responder de inmediato, sin invocar (documento 9.2).
  if (Date.now() < c.abiertoHasta) {
    throw new ErrorSOA({
      codigo: "CIRCUITO_ABIERTO",
      mensaje: `Servicio ${destino} con el circuito abierto; no se invoca por ahora.`,
      correlationId: opts.correlationId,
      reintentable: true,
      httpStatus: 503,
      tipo: "tecnico-permanente",
    });
  }

  let ultimoError;
  const totalIntentos = perfilRetry.retries + 1;
  for (let intento = 1; intento <= totalIntentos; intento++) {
    const inicio = Date.now();
    try {
      const { status, data } = await unaLlamada(destino, path, opts, perfilRetry.timeoutMs);
      const dur = Date.now() - inicio;

      if (status >= 200 && status < 300) {
        metrics.registrarLlamada(destino, dur, true);
        c.fallos = 0; // exito: se cierra el circuito
        return data;
      }

      // Error de negocio (4xx distinto de 429): no se reintenta.
      if (status >= 400 && status < 500 && status !== 429) {
        metrics.registrarLlamada(destino, dur, false);
        const e = data?.error || {};
        throw new ErrorSOA({
          codigo: e.codigo || "ERROR_NEGOCIO",
          mensaje: e.mensaje || `Error ${status} de ${destino}.`,
          correlationId: opts.correlationId,
          reintentable: false,
          estado: e.estado || null,
          httpStatus: status,
          tipo: "negocio",
        });
      }

      // 5xx o 429: tecnico transitorio -> reintentable.
      metrics.registrarLlamada(destino, dur, false);
      ultimoError = new ErrorSOA({
        codigo: "ERROR_TECNICO",
        mensaje: `Respuesta ${status} de ${destino}.`,
        correlationId: opts.correlationId,
        reintentable: true,
        httpStatus: 503,
        tipo: "tecnico-transitorio",
      });
    } catch (err) {
      const dur = Date.now() - inicio;
      if (err instanceof ErrorSOA && !err.reintentable) throw err; // negocio: propagar
      metrics.registrarLlamada(destino, dur, false);
      const esTimeout = err?.name === "AbortError";
      ultimoError =
        err instanceof ErrorSOA
          ? err
          : new ErrorSOA({
              codigo: esTimeout ? "TIMEOUT" : "ERROR_RED",
              mensaje: esTimeout ? `Tiempo de espera agotado hacia ${destino}.` : `Fallo de red hacia ${destino}.`,
              correlationId: opts.correlationId,
              reintentable: true,
              httpStatus: 503,
              tipo: "tecnico-transitorio",
            });
    }

    // Registrar el fallo del intento y, si corresponde, reintentar con backoff.
    c.fallos++;
    log({
      correlationId: opts.correlationId,
      servicio: "httpClient",
      operacion: `llamar:${destino}`,
      resultado: "error",
      codigoError: ultimoError.codigo,
      reintentable: true,
      intento,
      duracionMs: null,
      detalle: `intento ${intento}/${totalIntentos} hacia ${destino}`,
    });

    if (c.fallos >= CIRCUIT_BREAKER.threshold) {
      c.abiertoHasta = Date.now() + CIRCUIT_BREAKER.cooldownMs;
      metrics.registrarCircuitoAbierto(destino);
      log({
        correlationId: opts.correlationId,
        servicio: "httpClient",
        operacion: `circuito:${destino}`,
        resultado: "error",
        codigoError: "CIRCUITO_ABIERTO",
        detalle: `Circuito abierto ${CIRCUIT_BREAKER.cooldownMs} ms tras ${c.fallos} fallos`,
      });
    }

    if (intento < totalIntentos) {
      metrics.registrarReintento(destino);
      const base = perfilRetry.backoff[intento - 1] ?? perfilRetry.backoff.at(-1);
      await dormir(conJitter(base, perfilRetry.jitter));
    }
  }
  throw ultimoError;
}
