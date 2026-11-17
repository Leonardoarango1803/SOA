// Idempotencia (documento 9.3): misma clave + misma solicitud -> respuesta original,
// sin repetir el efecto; misma clave + solicitud distinta -> conflicto.
// Se apoya en la tabla `idempotencia` del propio archivo SQLite de cada servicio.
import { createHash } from "node:crypto";
import { errorConflicto, errorNegocio } from "./errors.js";

const resumen = (obj) => createHash("sha256").update(JSON.stringify(obj)).digest("hex").slice(0, 16);

// dbServicio: DatabaseSync del servicio (con tabla idempotencia).
// solicitud: objeto que identifica la peticion. fn: produce la respuesta (efecto real).
export async function conIdempotencia(dbServicio, clave, solicitud, ctx, fn) {
  if (!clave) {
    throw errorNegocio("FALTA_CLAVE_IDEMPOTENCIA", "La operacion requiere una clave de idempotencia.", { correlationId: ctx?.correlationId });
  }
  const huella = resumen(solicitud);
  const previo = dbServicio.prepare("SELECT huella, respuesta_json FROM idempotencia WHERE clave = ?").get(clave);
  if (previo) {
    if (previo.huella === huella) {
      return { ...JSON.parse(previo.respuesta_json), idempotente: true }; // respuesta original, sin duplicar
    }
    throw errorConflicto("CONFLICTO_IDEMPOTENCIA", "La misma clave de idempotencia se uso con una solicitud distinta.", { correlationId: ctx?.correlationId });
  }
  const respuesta = await fn();
  dbServicio.prepare("INSERT INTO idempotencia (clave, huella, respuesta_json, creado_en) VALUES (?,?,?,?)").run(clave, huella, JSON.stringify(respuesta), new Date().toISOString());
  return { ...respuesta, idempotente: false };
}
