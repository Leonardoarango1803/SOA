# Guion de demostracion (5-7 minutos)

Prototipo ejecutable SOA - Señor de Luren Express (APF3). Este guion recorre el prototipo
y, al mismo tiempo, responde las seis preguntas orientadoras de la sustentacion (documento §12.5).

## Preparacion (antes de empezar)

1. En una terminal: `npm install` (solo la primera vez) y luego `npm start`.
2. Abrir en el navegador: `http://127.0.0.1:4000` (pestañas Counter, Rastreo, Monitoreo).
3. Dejar la pestaña **Monitoreo** abierta en una segunda ventana para verla en paralelo.
4. (Opcional) Para una demo mas agil: `SOA_SPEED=4 npm start` acorta las esperas de backoff.
5. (Opcional) Para empezar con datos limpios: boton **"Reiniciar datos de la demo"** en Monitoreo,
   o `SOA_RESET=1 npm start`.

Reparte los roles: una persona opera el Counter, otra narra el Monitoreo, otra responde preguntas.

---

## Paso 1 - El proceso de registro atraviesa los servicios (BPM-SOA)

1. En **Counter**, elegir "Counter Ica" e **Iniciar sesion** (se emite un token con perfil y sede).
2. Registrar una encomienda (destino Nazca, domicilio). Mientras se procesa, la **linea de tiempo en
   vivo** (abajo) muestra cada paso conforme ocurre: gateway -> clientes -> tarifario -> encomiendas ->
   cobros -> facturacion -> broker -> trazabilidad -> notificaciones. Resultado: estado **Facturada**,
   con **codigo de rastreo** y **correlationId**.
3. (Opcional) En **Monitoreo**, pegar el codigo o el correlationId en "Reconstruir una operacion":
   se ven los mismos pasos 1-11 ordenados por tiempo, tambien despues de ocurrir.

> **Pregunta 1 (¿que proceso depende de los servicios SOA?)**: el registro de una encomienda en
> agencia; usa 7 de los 8 servicios y es donde nacen los silos.

> **Pregunta 2 (¿orquestacion o coreografia?)**: pasos 3-8 por **orquestacion** (dependientes, exigen
> consistencia y compensacion); pasos 9-11 (evento y aviso) por **coreografia** (efectos independientes).
> Se ve en la traza: `orquestador` invoca servicios y luego el `broker` publica el evento a 2 suscriptores.

## Paso 2 - Idempotencia (no duplicar)

1. En **Counter**, SIN cambiar la clave de idempotencia, volver a pulsar **Registrar encomienda**.
2. El resultado trae el **mismo codigo de rastreo** y la marca "idempotente: respuesta original".

> **Pregunta 4 (¿como evitan duplicados?)**: clave de idempotencia por operacion; cada servicio con
> efectos guarda la clave y devuelve la respuesta original si se repite (documento §9.3).

## Paso 3 - Un servicio deja de responder: compensacion (confiabilidad)

1. En **Monitoreo**, activar el interruptor **"Cobros no disponible -> compensacion (7C)"**.
2. En **Counter**, registrar otra encomienda. Resultado: estado **Anulada**.
3. En **Monitoreo**, reconstruir por el correlationId: se ven los reintentos, el estado
   "Pendiente de pago" y la **compensacion** (anular la orden).
4. Apagar el interruptor.

> **Pregunta 3 (¿que pasa si un servicio deja de responder?)**: timeout, reintentos con espera
> incremental e interruptor de circuito; si persiste, se compensa (anular) o se difiere, y el counter
> recibe un estado claro (documento §9.2, §9.6).

## Paso 4 - SUNAT/OSE no responde: diferimiento (confiabilidad)

1. En **Monitoreo**, activar **"SUNAT/OSE no responde -> diferimiento (8D)"**.
2. En **Counter**, registrar. Resultado: estado **Comprobante pendiente** (el envio NO se pierde).
3. Apagar el interruptor.

## Paso 5 - Seguridad (autorizacion por perfil y sede)

1. En **Counter**, con la sesion de "Counter Ica", cambiar manualmente **Sede de origen** a "Lima" y registrar.
2. Resultado: **ACCESO_DENEGADO**. En **Monitoreo** queda auditado el intento.

> **Pregunta 6 (¿que protege la informacion y restringe el acceso?)**: token con perfil y sede,
> autorizacion verificada en el gateway y en cada servicio, y auditoria del acceso denegado (documento §10).

## Paso 6 - Trazabilidad y rastreo

1. En **Rastreo**, elegir el envio del Paso 1 en la lista de **"Envios recientes"** (o pegar su codigo)
   y pulsar **Ver**: se ve el estado actual y el **historial** (Recibida en origen -> Cobrada ->
   Facturada), sin datos personales.
2. En **Monitoreo**, mostrar **/metrics** (latencia, tasa de errores, reintentos, colas, DLQ) y la salud.

> **Pregunta 5 (¿como reconstruyen una operacion que cruza varios servicios?)**: con el **correlationId**
> presente en todos los logs; la pantalla de Monitoreo ordena los pasos por tiempo (documento §11.4).

---

## Cierre

Todo lo mostrado es un **prototipo** que demuestra el diseño; **SUNAT/OSE, el canal de mensajeria y el
GPS estan simulados**, y los valores de tiempos/umbrales son de partida. El objetivo es evidenciar la
coherencia: problema -> proceso BPM -> servicios SOA -> confiabilidad, seguridad y trazabilidad.
