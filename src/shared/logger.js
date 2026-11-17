// Logs estructurados (documento 11.2): un registro por linea, en JSON, con los mismos
// campos en todos los componentes, para poder buscarlos y cruzarlos por correlationId
// o por codigo de rastreo (reconstruccion de una operacion, documento 11.4).
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";

const BUFFER_MAX = 5000;
const buffer = []; // anillo en memoria para la reconstruccion y la UI de monitoreo

// Bus de eventos para transmitir cada registro en vivo (linea de tiempo por SSE).
export const bus = new EventEmitter();
bus.setMaxListeners(0);

// Seudonimiza al usuario: nunca se guarda en claro (documento 11.2).
export function seudonimo(usuario) {
  if (!usuario) return null;
  return "u-" + createHash("sha256").update(String(usuario)).digest("hex").slice(0, 8);
}

export function log(entry) {
  const registro = {
    ts: new Date().toISOString(),
    correlationId: entry.correlationId || null,
    servicio: entry.servicio || null,
    operacion: entry.operacion || null,
    sede: entry.sede || null,
    usuario: entry.usuario ? seudonimo(entry.usuario) : null,
    resultado: entry.resultado || "info", // "exito" | "error" | "info"
    codigoError: entry.codigoError || null,
    reintentable: entry.reintentable ?? null,
    duracionMs: entry.duracionMs ?? null,
    intento: entry.intento ?? null,
    idemKey: entry.idemKey || null,
    codigoRastreo: entry.codigoRastreo || null,
    detalle: entry.detalle || null, // texto corto, sin datos personales
  };
  buffer.push(registro);
  if (buffer.length > BUFFER_MAX) buffer.shift();
  // Salida a consola en una sola linea JSON.
  process.stdout.write(JSON.stringify(registro) + "\n");
  // Transmitir en vivo a los suscriptores (SSE).
  if (registro.correlationId) bus.emit("log", registro);
  return registro;
}

// Recupera los registros de una operacion, ordenados por tiempo (documento 11.4).
export function reconstruir({ correlationId, codigoRastreo }) {
  return buffer
    .filter(
      (r) =>
        (correlationId && r.correlationId === correlationId) ||
        (codigoRastreo && r.codigoRastreo === codigoRastreo)
    )
    .sort((a, b) => a.ts.localeCompare(b.ts));
}

export function ultimosLogs(n = 200) {
  return buffer.slice(-n);
}
