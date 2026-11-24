---
title: "Casos críticos N2 y N3"
description: "Clasifica automáticamente los casos graves y avisa al instante al equipo por NexoOmni, WhatsApp y correo."
section: "supervision-y-reportes"
role: ["supervisor", "admin", "owner"]
plan: ["premium"]
updated: "2026-11-20"
---

## ¿Qué es?

NexoOmni revisa cada conversación entrante y le asigna un nivel de caso:

- **N1**: consulta o queja leve que el equipo puede atender en el flujo normal.
- **N2**: queja seria que necesita atención prioritaria, por ejemplo un pedido equivocado, una demora importante o un cliente muy molesto.
- **N3**: caso grave o urgente, por ejemplo un problema de salud, de seguridad, un riesgo legal o una amenaza de exhibición pública.

Todo caso **N2 o N3 se marca como crítico** y dispara una alerta inmediata, las 24 horas del día y todos los días de la semana. Los casos N1 nunca generan alerta.

Para incidentes de salud, la clasificación usa una regla adicional: síntomas,
posible intoxicación o que se haya enfermado un grupo/familia después de comer
se elevan a N3 aunque el modelo proponga un nivel menor. También se reconocen
nombres parciales de sedes, por ejemplo “Lobos” como **Cueva de Lobos**.

## ¿Para quién es?

- **Supervisores**: ven los casos críticos, filtran la bandeja y corrigen el nivel cuando la clasificación no es correcta.
- **Administradores y propietarios**: activan la función y configuran las sedes, los teléfonos y la plantilla de WhatsApp.

## Cómo se configura

1. Ve a **Configuración → Asignación → Alertas de casos críticos**.
2. Escribe el **nombre de la plantilla de WhatsApp** y su idioma. Los valores sugeridos son `alerta_caso_critico` y `es_MX`.
3. Agrega los **teléfonos predeterminados**. Reciben las alertas cuando no se identifica la sede del cliente.
4. Agrega cada **sede** con sus propios teléfonos. Puedes registrar hasta 50 sedes, y sus nombres no se pueden repetir.
5. Activa **Alertas de casos críticos** y guarda.

### Plantilla de WhatsApp

Antes de activar la función, la plantilla debe estar **aprobada por Meta** con la categoría *Utilidad* y el idioma *es_MX*. Usa este texto:

> ⚠️ Caso crítico {{1}} — Cliente: {{2}} — Detalle: {{3}}. Atiéndelo de inmediato en NexoOmni.

NexoOmni llena las variables de la plantilla así:

- `{{1}}` recibe el nivel y la sede, por ejemplo "Nivel N3 – Sede Polanco".
- `{{2}}` recibe el nombre o el teléfono del cliente.
- `{{3}}` recibe un resumen breve del motivo.

## Qué pasa cuando llega un caso crítico

- En NexoOmni aparece un **aviso rojo** y una notificación del navegador o de la aplicación instalada.
- La conversación muestra la etiqueta **Crítico N2** o **Crítico N3**. En la bandeja puedes filtrar para ver solo los casos críticos.
- Si la IA debe pasar la conversación a una persona, primero envía al cliente
  un acuse breve y empático; no ofrece diagnósticos, no admite responsabilidad
  y no promete compensaciones.
- Se envía un **WhatsApp** a los teléfonos de la sede del cliente, o a los teléfonos predeterminados cuando la sede no se identifica.
- Se envía un **correo** a los supervisores, administradores y propietarios activos de la cuenta, y al agente asignado a la conversación, si lo hay.
- Cada caso genera **una sola alerta**. Si la IA eleva un caso de N2 a N3, se avisa de nuevo. Si el nivel baja a N1, el caso vuelve a quedar listo para alertar en el futuro.

## Corregir el nivel

En la parte superior de la conversación, un supervisor puede cambiar el nivel a N1, N2 o N3. Esa decisión manual prevalece: la IA ya no vuelve a cambiar el nivel de esa conversación.

## Preguntas frecuentes

**¿La IA puede bajar el nivel de un caso?**
No. La IA solo puede subir el nivel. Para bajarlo, un supervisor debe corregirlo manualmente.

**¿Consume créditos de IA?**
Sí. Clasificar cada mensaje entrante consume una pequeña cantidad de créditos de IA.

**No me llegó el WhatsApp de alerta. ¿Qué reviso?**
Revisa tres cosas:

- Que la plantilla esté aprobada por Meta.
- Que el nombre y el idioma configurados coincidan exactamente con los de la plantilla.
- Que los teléfonos estén escritos en formato internacional, por ejemplo +5215512345678.

## Ver también

- [Supervisión en vivo](./supervision-en-vivo.md)
- [Reportes ejecutivos](./reportes-ejecutivos.md)
