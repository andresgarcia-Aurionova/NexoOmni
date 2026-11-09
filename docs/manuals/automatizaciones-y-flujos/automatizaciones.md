---
title: "Automatizaciones"
description: "Respuestas y acciones automáticas por palabra clave, sin código: enviar plantilla, etiquetar, mover de etapa, y más."
section: "automatizaciones-y-flujos"
role: ["admin", "owner"]
plan: ["crecimiento", "premium"]
updated: "2026-09-28"
---

## ¿Qué es?

Reglas simples tipo "si pasa esto, haz esto" sobre tus conversaciones
de WhatsApp — por ejemplo, si un mensaje entrante contiene la palabra
"precio", enviar automáticamente una plantilla con la lista de
precios.

## ¿Para quién es?

Un administrador las crea y activa; una vez activas, corren solas.

## Cómo se usa

1. Ve a **Automatizaciones → Nueva automatización**.
2. Elige el disparador: palabra clave, primer mensaje entrante, o
   manual.
3. Agrega una o más acciones: enviar mensaje/plantilla, agregar
   etiqueta, mover un trato de etapa, notificar a alguien del equipo.
4. Actívala.

## Aviso fuera de horario para WhatsApp conectado

Un administrador puede configurar un aviso por cada número conectado mediante
la conexión guiada desde **Automatizaciones → Horario de atención de WhatsApp
conectado**. Selecciona el número, la zona horaria IANA, los días y horas
de apertura, las fechas cerradas y el texto; después activa y guarda.

Las fechas cerradas se introducen manualmente, una por línea en formato
`AAAA-MM-DD`: el sistema no importa festivos. El inicio está incluido y la
hora de cierre queda fuera del horario. Cada periodo cerrado continuo incluye
los domingos y festivos consecutivos; durante él se intenta enviar el aviso
una vez por conversación. Si un flujo ya estaba en marcha, puede continuar;
si no, no se inicia uno nuevo ni se ejecutan las respuestas automáticas del
mensaje entrante. Cuando una conversación nueva recibió primero el aviso, el
cliente puede volver a escribir en horario para iniciar el flujo de bienvenida.

Los envíos programados por otros módulos y las respuestas humanas no se
detienen con esta configuración. El horario solo se aplica al WhatsApp de
conexión guiada seleccionado, no al WhatsApp directo ni a otros canales.
Si el proveedor rechaza un envío o el resultado queda sin confirmar, el aviso
no se reintenta automáticamente para evitar duplicados. Revisa las alertas
en esta sección y verifica si llegó antes de responder manualmente.

Prueba el horario con un número autorizado: un mensaje fuera de horario,
otro en el mismo periodo, un mensaje al abrir y un flujo iniciado antes del
cierre. Comprueba los resultados en el teléfono y en la bandeja.

## Preguntas frecuentes

**¿Funcionan en Facebook/Instagram y Chat web también?**
Las automatizaciones generales también pueden ejecutarse en canales
conectados. El horario descrito arriba, en cambio, solo controla el
WhatsApp conectado mediante la conexión guiada.

**¿Puedo tener varias automatizaciones con la misma palabra clave?**
Sí, todas las que apliquen se ejecutan.

## Ver también

- [Flujos](./flujos.md)
