// Servicio Trazabilidad (negocio). Operaciones: registrarEvento, consultarEstado.
// Registra y expone los eventos de estado (documento 7.2). Consume eventos del broker
// (coreografia, pasos 9-10) y ofrece la consulta publica de rastreo (P2). Persiste en SQLite.
import { crearServicio, operacion } from "../shared/service.js";
import { errorNegocio } from "../shared/errors.js";
import { seudonimo, log } from "../shared/logger.js";
import { db } from "../data/db.js";
import { suscribir } from "../shared/broker.js";

function registrar(codigoRastreo, estado, sede, usuario, correlationId) {
  db.trazabilidad
    .prepare("INSERT INTO eventos (codigo_rastreo, estado, sede, usuario, fecha, correlation_id) VALUES (?,?,?,?,?,?)")
    .run(codigoRastreo, estado, sede || null, usuario ? seudonimo(usuario) : null, new Date().toISOString(), correlationId || null);
}

export function crearApp() {
  const app = crearServicio("trazabilidad");

  // Coreografia (documento 5.4, paso 10): consume el evento EstadoDeEnvioCambiado.
  suscribir("EstadoDeEnvioCambiado", "trazabilidad", async (evento) => {
    const { codigoRastreo, estado, sede, usuario } = evento.carga || {};
    registrar(codigoRastreo, estado, sede, usuario, evento.correlationId);
    log({
      correlationId: evento.correlationId,
      servicio: "trazabilidad",
      operacion: "registrarEvento",
      resultado: "exito",
      codigoRastreo,
      detalle: `evento de estado '${estado}' registrado`,
    });
  });

  // registrarEvento directo (p. ej. app del motorizado en la ultima milla).
  app.post(
    "/evento",
    operacion("trazabilidad", "registrarEvento", async (req, res, ctx) => {
      const { codigoRastreo, estado, sede, usuario } = req.body || {};
      if (!codigoRastreo || !estado) throw errorNegocio("EVENTO_INCOMPLETO", "Se requiere codigoRastreo y estado.", { correlationId: ctx.correlationId });
      registrar(codigoRastreo, estado, sede, usuario, ctx.correlationId);
      return { codigoRastreo, estado, _detalle: `evento '${estado}' registrado` };
    })
  );

  // Consulta publica de rastreo (documento 10.4): estado e historial sin datos personales.
  app.get(
    "/estado/:codigo",
    operacion("trazabilidad", "consultarEstado", async (req, res, ctx) => {
      const historial = db.trazabilidad
        .prepare("SELECT estado, sede, fecha FROM eventos WHERE codigo_rastreo = ? ORDER BY id ASC")
        .all(req.params.codigo);
      if (historial.length === 0) {
        throw errorNegocio("RASTREO_NO_ENCONTRADO", "No hay informacion para ese codigo de seguimiento.", { correlationId: ctx.correlationId });
      }
      return {
        codigoRastreo: req.params.codigo,
        estadoActual: historial.at(-1).estado,
        historial,
        _detalle: `rastreo ${req.params.codigo}`,
      };
    })
  );

  // Lista de envios recientes (AYUDA SOLO PARA LA DEMO; en produccion el rastreo publico
  // no listaria envios). Devuelve el ultimo estado de cada codigo.
  app.get(
    "/recientes",
    operacion("trazabilidad", "enviosRecientes", async () => {
      const filas = db.trazabilidad
        .prepare(`SELECT e.codigo_rastreo AS codigoRastreo, e.estado AS estadoActual, e.fecha AS fecha
          FROM eventos e
          JOIN (SELECT codigo_rastreo, MAX(id) AS maxid FROM eventos GROUP BY codigo_rastreo) u
            ON e.id = u.maxid
          ORDER BY e.id DESC LIMIT 15`)
        .all();
      return { recientes: filas };
    })
  );

  return app;
}
