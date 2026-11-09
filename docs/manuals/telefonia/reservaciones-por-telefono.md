---
title: "Reservaciones por teléfono con el recepcionista de IA"
description: "Configura Yeastar para que el recepcionista de IA registre reservaciones de restaurantes en tu agenda de NexoOmni."
section: "telefonia"
role: ["admin", "owner"]
plan: ["premium"]
updated: "2026-11-09"
---

## ¿Qué es?

Cuando alguien llama para reservar, el recepcionista de IA reúne los datos,
los valida contra las reglas de cada restaurante y registra la reservación
en la **Agenda** de NexoOmni como *confirmada*. Si no puede resolver algo,
transfiere la llamada a una persona del equipo.

## Reglas incluidas

| Restaurante | Zonas disponibles |
|---|---|
| Restaurante A | Solo piso uno |
| Restaurante B | Piso uno y terraza |
| Restaurante C | Solo terraza |

El sistema rechaza una zona que el restaurante no tiene, una fecha pasada, y
grupos de más de 50 personas. Los horarios son hora de Ciudad de México y cada
reservación dura 90 minutos en la agenda.

> **Importante:** NexoOmni no controla mesas ni cupo. La reservación se
> registra sin comprobar disponibilidad. El recepcionista transfiere a una
> persona los grupos grandes (más de 10) y cualquier petición especial.

## Cómo se configura

### 1. Crear una clave exclusiva

En **Configuración → Claves API** crea `Recepcionista IA - reservaciones` y
activa únicamente el permiso `reservations:write`. Guárdala como secreto en
Yeastar; nunca en el prompt.

### 2. Añadir la herramienta HTTP en Yeastar

Nombre sugerido: **`nexoomni_registrar_reservacion`**.

- Método: **POST**
- URL: `https://nexoomni.aurionova.com/api/v1/telephony/reservations`
- Encabezados: `Authorization: Bearer <clave>` y `Content-Type: application/json`
- Parámetros del cuerpo:
  - `ai_extension`: **constante**, extensión real del recepcionista (por ejemplo `7001`).
  - `restaurant`: `A`, `B` o `C`.
  - `zone`: `piso uno` o `terraza`. Opcional si el restaurante solo tiene una zona.
  - `party_size`: número de personas.
  - `date`: fecha `AAAA-MM-DD`.
  - `time`: hora de 24 h `HH:mm`.
  - `occasion`: opcional, ocasión especial.
  - `customer_name`: nombre de quien reserva.

El teléfono del cliente no se pide a la IA: NexoOmni lo toma de la llamada
activa en el PBX. Si no puede verificarse, la reservación se guarda igual, sin
contacto asociado y con la nota "teléfono no verificado".

Respuesta correcta: `{"data":{"saved":true,"appointment_id":"..."}}`. Si la
llamada se repite con los mismos datos, devuelve `duplicate: true` y no crea
otra reservación. El recepcionista solo debe decir que quedó registrada
cuando recibe `saved = true`.

### 3. Validar

1. Llama a la extensión del recepcionista y reserva en cada restaurante.
2. Pide una zona que no exista y comprueba que la rechaza.
3. Abre **Agenda** y verifica título, notas (restaurante, zona, personas,
   ocasión) y hora.
4. Pide hablar con una persona y comprueba la transferencia.

## Aviso al equipo por WhatsApp

Al registrar una reservación, NexoOmni envía una plantilla de WhatsApp a un
número del equipo. La plantilla (categoría **Utilidad**, sin variables con
saltos de línea) se llama `aviso_reservacion_restaurante` y tiene 3 variables:
restaurante, fecha y hora, y detalle (nombre, personas, zona, ocasión y
teléfono). El número y la plantilla los define quien administra el servidor,
no la IA:

- `RESERVATION_ALERT_PHONE`: número de destino con lada internacional.
- `RESERVATION_ALERT_TEMPLATE`: opcional, por defecto `aviso_reservacion_restaurante`.
- `RESERVATION_ALERT_LANGUAGE`: opcional, por defecto `es_MX`.

La respuesta de la herramienta incluye `notified`. Si el aviso falla, la
reservación queda guardada igualmente (`notified: false`).

## Pendiente

- Control de mesas, cupo y *layout*: fase posterior.

## Ver también

- [Contexto del recepcionista de IA al transferir](/manuales/telefonia/contexto-y-transferencias-ia)
- [Agenda de citas](/manuales/pipelines-y-citas/agenda-de-citas)
