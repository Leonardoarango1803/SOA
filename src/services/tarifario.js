// Servicio Tarifario (negocio). Operacion: cotizarEnvio.
// Calcula el precio por peso, volumen, destino y modalidad (documento 7.2).
import { crearServicio, operacion } from "../shared/service.js";
import { errorNegocio } from "../shared/errors.js";
import { TARIFAS } from "../data/seed.js";
import { COBERTURA } from "../config.js";

export function crearApp() {
  const app = crearServicio("tarifario");

  app.post(
    "/cotizar",
    operacion("tarifario", "cotizarEnvio", async (req, res, ctx) => {
      const { destino, peso = 0, volumen = 0, modalidad = "agencia", tipoCliente = "normal" } = req.body || {};

      // RN-01: solo destinos con cobertura.
      if (!COBERTURA.includes(destino)) {
        throw errorNegocio("DESTINO_SIN_COBERTURA", `El destino ${destino} esta fuera de la cobertura (${COBERTURA.join(", ")}).`, {
          correlationId: ctx.correlationId,
        });
      }

      let precio =
        TARIFAS.base +
        TARIFAS.porKg * Number(peso) +
        TARIFAS.porVolumen * Number(volumen) +
        (TARIFAS.porDestino[destino] ?? 0) +
        (modalidad === "domicilio" ? TARIFAS.recargoDomicilio : 0);

      let descuento = 0;
      if (tipoCliente === "b2b") {
        descuento = precio * TARIFAS.descuentoB2B;
        precio -= descuento;
      }
      precio = Math.round(precio * 100) / 100;

      const vence = new Date(Date.now() + TARIFAS.vigenciaDias * 86400000).toISOString().slice(0, 10);
      return {
        tarifa: precio,
        moneda: "PEN",
        desglose: {
          base: TARIFAS.base,
          peso: TARIFAS.porKg * Number(peso),
          volumen: TARIFAS.porVolumen * Number(volumen),
          destino: TARIFAS.porDestino[destino] ?? 0,
          domicilio: modalidad === "domicilio" ? TARIFAS.recargoDomicilio : 0,
          descuentoB2B: Math.round(descuento * 100) / 100,
        },
        vigenciaHasta: vence,
        _detalle: `tarifa ${precio} PEN para ${destino}`,
      };
    })
  );

  return app;
}
