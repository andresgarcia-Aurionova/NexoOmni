---
title: "Flujos"
description: "Construye conversaciones automáticas de varios pasos (menús, botones, listas) con un editor visual, sin código."
section: "automatizaciones-y-flujos"
role: ["admin", "owner"]
plan: ["crecimiento", "premium"]
updated: "2026-11-20"
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

### Interpretar respuestas en un menú con IA

En un paso de botones o lista, activa **Interpretar respuestas con IA** para
que el flujo intente entender una respuesta escrita que no coincida directamente
con una opción. La IA solo puede elegir entre las opciones configuradas. También
puede responder preguntas con un fragmento de la base de conocimiento autorizada;
si no encuentra información suficiente o el cliente solicita atención humana,
la conversación se transfiere al equipo.

Esta opción es solo para WhatsApp y requiere IA activa, créditos y el
mantenimiento periódico de flujos funcionando. Configura y revisa primero la
base de conocimiento y limita el disparador a la línea que corresponda. Se cobra
el uso de IA aunque la respuesta termine en transferencia. La IA puede
interpretar mal una solicitud: prueba cada opción antes de publicar. No crea
reservas ni factura por sí sola; esas acciones siguen los pasos y validaciones
del flujo. No activa la respuesta automática general.

Activa la opción antes de iniciar una conversación nueva. Si llegan mensajes
simultáneos mientras se procesa un turno o este se interrumpe, la conversación
puede transferirse para revisión. El equipo debe comprobar el historial: un
mensaje cuyo envío se interrumpió podría llegar tarde.

También puedes activar **Interpretar respuestas con IA** en **Recopilar
datos**. La IA intenta entender el dato solicitado, por ejemplo una fecha
expresada de otra forma, o responder con información autorizada. Las fechas,
horas y opciones configuradas siguen sujetas a las validaciones del flujo;
revisa siempre los datos y la oferta antes de confirmar una cita. Si una
respuesta es ambigua, el flujo vuelve a preguntar; ante una solicitud de
atención humana o falta de información autorizada puede transferir al equipo.
La interpretación puede equivocarse y consume créditos. No activa la
respuesta automática general ni completa automáticamente otros procesos.

En cada pregunta puedes configurar un mensaje opcional para respuestas
inválidas, por ejemplo «La fecha debe ser de hoy en adelante. Indica otra en
formato DD/MM/AAAA». Si lo dejas vacío, se repite la pregunta original.

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

### Restringir las respuestas a una lista

En **Recopilar datos**, activa **Aceptar solo respuestas de una lista** y
escribe una opción por línea. Incluye las opciones en la pregunta al cliente.
El flujo acepta el nombre completo sin distinguir mayúsculas ni acentos y
guarda la opción configurada; una respuesta desconocida sigue la regla de
reintentos. Mantén la lista actualizada: las opciones que solo difieren en
mayúsculas o acentos no se pueden usar porque serían ambiguas.

### Datos recopilados en una cita

Para ofrecer únicamente horarios de una fecha solicitada, activa la validación
de fecha en la pregunta anterior y, en **Ofrecer horarios**, indica su clave en
**Clave de la fecha solicitada**. Usa la misma zona horaria en la pregunta y la
agenda. La consulta busca solo ese día, incluso si queda más allá de los
próximos días configurados; si no hay horarios, sigue la ruta **Sin
disponibilidad**. Si la fecha falta, es inválida o la agenda tiene zonas
horarias inconsistentes, se transfiere para revisión.

Para priorizar la hora preferida, añade una pregunta que solicite `HH:mm`
(24 horas, por ejemplo `19:30`) y activa **Validar hora en formato de 24
horas**. En **Ofrecer horarios**, indica la clave de esa respuesta y también
la clave de la fecha. Se ofrecen primero los horarios disponibles más
cercanos a la hora solicitada; si hay empate, aparece primero el más temprano.
El cliente debe elegir una opción: pedir una hora no la reserva. Si la hora
falta o es inválida, la conversación se transfiere para revisión.

En el paso **Agendar cita**, el título y las notas internas admiten variables
recopiladas antes en el flujo, por ejemplo `Sede: {{vars.sede}}` y
`Personas: {{vars.personas}}`. Estas notas quedan en la cita vinculada al
contacto y la conversación. La agenda de horarios no controla automáticamente
el cupo de mesas o zonas de un restaurante.

Conecta **Ofrecer horarios** directamente con **Agendar cita** y activa
**Evitar citas duplicadas en este paso** si debe crearse como máximo una cita
por ejecución del flujo y paso de agendamiento. Los horarios se envían como
texto con un código para cada oferta; pide al cliente que responda con el
número y el código, por ejemplo `1 ABC123DEF456`. Un código de una oferta
anterior no acepta una selección nueva. Los reintentos del
mismo horario recuperan la cita anterior; si el horario cambió, la cita se
canceló o ya no existe, la conversación se transfiere para revisión. No uses
esta opción si el mismo paso debe agendar varias citas en una ejecución. Si
una selección y otra respuesta llegan casi al mismo tiempo, una transferencia
no se aplica después de aceptar la selección; si la transferencia ocurre
primero, no se agenda. El cliente podría tener que repetir una selección
descartada. Si se interrumpe el envío de horarios o el procesamiento tras
elegir uno, el mantenimiento periódico puede transferir la conversación
para revisión. Si falla el envío del mensaje posterior a la elección, también
se transfiere para revisión. El equipo debe comprobar la cita y el historial
de mensajes antes de responder: un envío interrumpido podría llegar tarde y
no se garantiza su entrega ni que llegue una sola vez. El mantenimiento debe
estar configurado y funcionando. Activa esta protección antes de iniciar
una conversación nueva; las ejecuciones anteriores requieren revisión.

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
