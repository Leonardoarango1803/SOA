// Seguridad: autenticacion con token firmado (documento 10.2) y autorizacion por
// perfil y sede (documento 10.3). Se usa HMAC con el modulo nativo crypto; no hay
// libreria de JWT para mantener una sola dependencia. El token lleva perfil y sede,
// y tiene vida corta.
import { createHmac, timingSafeEqual } from "node:crypto";
import { SECURITY } from "../config.js";

const b64url = (buf) => Buffer.from(buf).toString("base64url");

function firmar(payloadB64) {
  return createHmac("sha256", SECURITY.tokenSecret).update(payloadB64).digest("base64url");
}

export function emitirToken({ sub, nombre, perfil, sede }) {
  const payload = { sub, nombre, perfil, sede, exp: Date.now() + SECURITY.tokenTtlMs };
  const payloadB64 = b64url(JSON.stringify(payload));
  return `${payloadB64}.${firmar(payloadB64)}`;
}

export function verificarToken(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [payloadB64, firma] = token.split(".");
  const esperada = firmar(payloadB64);
  try {
    const a = Buffer.from(firma);
    const b = Buffer.from(esperada);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!payload.exp || payload.exp < Date.now()) return null; // token vencido
  return payload;
}

// Matriz de autorizacion (documento 10.3). Valores:
//  "si"  = permitido          "no" = no permitido
//  "sede" = solo su propia sede (token.sede === recurso.sede)
//  "red"  = toda la red        "codigo" = publico, solo con codigo de rastreo
//  "asignados"/"envios" = permitido en el prototipo (se validaria el propietario del recurso)
const MATRIZ = {
  cotizarEnvio: { counter: "si", jefe_agencia: "si", motorizado: "no", admin_central: "si", b2b: "si", publico: "si" },
  crearEncomienda: { counter: "sede", jefe_agencia: "sede", motorizado: "no", admin_central: "no", b2b: "envios", publico: "no" },
  registrarCobro: { counter: "sede", jefe_agencia: "sede", motorizado: "no", admin_central: "no", b2b: "no", publico: "no" },
  cerrarCaja: { counter: "no", jefe_agencia: "sede", motorizado: "no", admin_central: "red", b2b: "no", publico: "no" },
  anularEncomienda: { counter: "no", jefe_agencia: "sede", motorizado: "no", admin_central: "red", b2b: "no", publico: "no" },
  registrarEvento: { counter: "sede", jefe_agencia: "sede", motorizado: "asignados", admin_central: "no", b2b: "no", publico: "no" },
  consultarEstado: { counter: "sede", jefe_agencia: "sede", motorizado: "asignados", admin_central: "red", b2b: "envios", publico: "codigo" },
  solicitarRecojo: { counter: "si", jefe_agencia: "si", motorizado: "no", admin_central: "no", b2b: "si", publico: "si" },
};

// Decide si un perfil puede ejecutar una operacion. ctx: { tokenSede, recursoSede }.
export function autorizar(perfil, operacion, ctx = {}) {
  const regla = MATRIZ[operacion]?.[perfil] ?? "no";
  switch (regla) {
    case "si":
    case "red":
    case "envios":
    case "asignados":
      return { ok: true, regla };
    case "no":
      return { ok: false, regla, motivo: `El perfil ${perfil} no puede ejecutar ${operacion}.` };
    case "sede":
      if (ctx.recursoSede && ctx.tokenSede !== ctx.recursoSede) {
        return { ok: false, regla, motivo: `Acceso de otra sede: el usuario opera en ${ctx.tokenSede} y el recurso es de ${ctx.recursoSede}.` };
      }
      return { ok: true, regla };
    case "codigo":
      return { ok: true, regla }; // consulta publica: basta el codigo de rastreo
    default:
      return { ok: false, regla: "no", motivo: "Operacion no reconocida." };
  }
}
