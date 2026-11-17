// Los cuatro identificadores del documento (seccion 11.3), cada uno con un proposito distinto.
import { randomUUID, randomBytes } from "node:crypto";

// Identificador tecnico de una operacion de punta a punta (para reconstruir).
export const nuevoCorrelationId = () => "corr-" + randomUUID();

// Intencion de operacion del usuario (para evitar duplicados).
export const nuevaClaveIdempotencia = () => "idem-" + randomUUID();

// Identificador de un evento publicado (para descartar repetidos).
export const nuevoIdEvento = () => "evt-" + randomUUID();

// Identificador de negocio del envio. No predecible (documento 10.2): base32 sin
// caracteres ambiguos, con prefijo SLE (Senor de Luren Express).
const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function nuevoCodigoRastreo() {
  const bytes = randomBytes(10);
  let s = "";
  for (const b of bytes) s += ALFABETO[b % ALFABETO.length];
  return `SLE-${s.slice(0, 5)}-${s.slice(5, 10)}`;
}
