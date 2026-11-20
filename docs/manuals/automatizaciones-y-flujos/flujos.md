---
title: "Flujos"
description: "Construye conversaciones automáticas de varios pasos (menús, botones, listas) con un editor visual, sin código."
section: "automatizaciones-y-flujos"
role: ["admin", "owner"]
plan: ["crecimiento", "premium"]
updated: "2026-09-28"
---

## ¿Qué es?

Un editor visual de tipo diagrama de flujo para construir
conversaciones automáticas de varios pasos: menús con botones o
listas, mensajes condicionales, envío de plantilla, espera de
respuesta, y más — sin escribir código.

## ¿Para quién es?

Un administrador diseña y publica los flujos.

## Cómo se usa

1. Ve a **Flujos → Nuevo flujo**.
2. Elige el disparador (palabra clave o primer mensaje).
3. Arrastra bloques al lienzo: mensaje, pregunta, condición, botones,
   lista, plantilla, esperar respuesta, etc. Conéctalos en el orden
   que quieras que ocurran.
4. Pruébalo antes de publicar.
5. Publica — solo entonces empieza a correr con clientes reales.

Si una misma persona escribe por varias líneas conectadas, cada conversación
mantiene su propio flujo. Una respuesta o intervención del equipo en una línea
no detiene el flujo de otra. Los datos guardados en la ficha de contacto, como
etiquetas y notas, siguen siendo compartidos.

Para limitar los nuevos inicios a una sola línea de WhatsApp conectado, elige
esa línea en el disparador del flujo y comprueba también los canales elegidos.
Sin línea seleccionada, el flujo puede iniciarse en todos los canales elegidos.
Las ejecuciones ya iniciadas no se detienen al cambiar esta selección. Esta
opción limita el inicio del flujo, no la respuesta automática general de IA.

### Guardar una respuesta en las notas del contacto

En un paso **Recopilar datos**, activa **Guardar la respuesta en Notas del
contacto** y escribe una etiqueta descriptiva, por ejemplo `Motivo (flujo
automático)`. La respuesta se guarda junto a la etiqueta como nota ordinaria
de la ficha, no como nota interna de supervisión ni como mensaje al cliente.
El registro usa el autor del flujo como referencia técnica; la etiqueta debe
dejar claro que el texto fue generado por el flujo. No solicites datos
sensibles. Prueba el flujo y confirma la nota en la ficha antes de publicarlo.

Si no se puede guardar la nota, la ejecución se detiene y la conversación
queda pendiente de revisión; comprueba el historial y registra el motivo
manualmente. No se crean notas retroactivamente para respuestas anteriores.

### Evitar fechas anteriores a hoy

En **Recopilar datos**, activa **Aceptar solo fechas de hoy en adelante** y
escribe la zona horaria IANA del negocio, por ejemplo `America/Mexico_City`.
En la pregunta pide una fecha en formato `DD/MM/AAAA`. Las fechas inválidas o
pasadas no se guardan y se aplica la regla de reintentos del flujo.

Esta opción permite el día actual: no comprueba la hora ni la disponibilidad.
Las preguntas existentes no cambian hasta activar esta opción.

### Datos recopilados en una cita

Para ofrecer únicamente horarios de una fecha solicitada, activa la validación
de fecha en la pregunta anterior y, en **Ofrecer horarios**, indica su clave en
**Clave de la fecha solicitada**. Usa la misma zona horaria en la pregunta y la
agenda. La consulta busca solo ese día, incluso si queda más allá de los
próximos días configurados; si no hay horarios, sigue la ruta **Sin
disponibilidad**. Si la fecha falta, es inválida o la agenda tiene zonas
horarias inconsistentes, se transfiere para revisión. La hora preferida aún no
filtra ni ordena las opciones: el cliente debe elegir un horario ofrecido.

En el paso **Agendar cita**, el título y las notas internas admiten variables
recopiladas antes en el flujo, por ejemplo `Sede: {{vars.sede}}` y
`Personas: {{vars.personas}}`. Estas notas quedan en la cita vinculada al
contacto y la conversación. La agenda de horarios no controla automáticamente
el cupo de mesas o zonas de un restaurante.

Para mostrar la referencia de una cita, escribe por ejemplo `referencia_cita`
en **Clave para guardar la referencia de la cita**. Un mensaje posterior puede
incluir `{{vars.referencia_cita}}`. La referencia identifica la cita en
NexoOmni; no reemplaza un folio comercial con formato acordado.

## Preguntas frecuentes

**¿Un flujo puede reemplazar completamente a un agente humano?**
Puede resolver casos comunes (horarios, ubicación, menú de opciones),
pero siempre puedes incluir un paso de "transferir a un agente" para
los casos que lo requieran.

**¿Qué pasa si edito un flujo que ya está en uso?**
Los cambios se guardan como borrador hasta que los publicas — las
conversaciones en curso siguen la versión publicada más reciente en
ese momento.

## Ver también

- [Automatizaciones](./automatizaciones.md)
