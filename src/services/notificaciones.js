// Servicio Notificaciones (infraestructura). Operacion: enviarNotificacion.
// Avisos al remitente y destinatario (documento 7.2). Consume eventos del broker
// (coreografia, paso 11). El canal (WhatsApp/SMS/correo) esta SIMULADO. Persiste en SQLite.
import { crearServicio, operacion } from "../shared/service.js";
import { log } from "../shared/logger.js";
import { db } from "../data/db.js";
import { suscribir } from "../shared/broker.js";

function enviar(aviso) {
  // SIMULADO: no se envia nada real; se registra el aviso.
  db.notificaciones
    .prepare("INSERT INTO avisos (canal, destinatario, mensaje, codigo_rastreo, correlation_id, estado, enviado_en) VALUES (?,?,?,?,?,?,?)")
    .run(aviso.canal, aviso.destinatario || null, aviso.mensaje || null, aviso.codigoRastreo || null, aviso.correlationId || null, "enviado(simulado)", new Date().toISOString());
}

export function crearApp() {
  const app = crearServicio("notificaciones");

  // Coreografia (documento 5.4, paso 11): consume el evento EstadoDeEnvioCambiado.
  suscribir("EstadoDeEnvioCambiado", "notificaciones", async (evento) => {
    const { codigoRastreo, estado } = evento.carga || {};
    const aviso = {
      canal: "whatsapp(simulado)",
      codigoRastreo,
      mensaje: `Su envio ${codigoRastreo} ahora esta: ${estado}. Consulte el detalle con su codigo de seguimiento.`,
      correlationId: evento.correlationId,
    };
    enviar(aviso);
    log({
      correlationId: evento.correlationId,
      servicio: "notificaciones",
      operacion: "enviarNotificacion",
      resultado: "exito",
      codigoRastreo,
      detalle: `aviso simulado enviado por ${aviso.canal}`,
    });
  });

  // Envio directo (uso general).
  app.post(
    "/enviar",
    operacion("notificaciones", "enviarNotificacion", async (req, res, ctx) => {
      const { canal = "whatsapp(simulado)", destinatario, mensaje, codigoRastreo } = req.body || {};
      enviar({ canal, destinatario, mensaje, codigoRastreo, correlationId: ctx.correlationId });
      return { estado: "enviado(simulado)", canal, _detalle: "aviso simulado" };
    })
  );

  return app;
}
