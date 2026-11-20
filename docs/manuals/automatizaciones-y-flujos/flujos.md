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

Opcionalmente, en un flujo de reserva protegida el menú puede aprovechar una
fecha que el cliente mencione al elegir una opción. Funciona cuando esa opción
lleva directamente a una pregunta de fecha con IA y validación de fechas
futuras. Si la fecha es ambigua o
inválida, se pregunta normalmente. Comprueba el resultado antes de confirmar.

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

En **Formato que debe cumplir la respuesta** puedes validar una fecha real en
formato `DD/MM/AAAA`, correo, forma de RFC mexicano, código postal de cinco
dígitos o monto positivo con hasta dos decimales. Estas comprobaciones son de
formato: no verifican RFC, régimen fiscal, uso de CFDI ni obligaciones ante el
SAT. Una pregunta también puede aceptar una imagen de WhatsApp; la imagen queda
en la conversación para que la revise el equipo y no se analiza automáticamente.
No combines la captura de imagen o un formato con una lista de respuestas.

### Clasificar un comentario antes de continuar

En una pregunta de WhatsApp con IA, activa **Clasificar el sentimiento de un
comentario** e indica una clave distinta de la que guarda la respuesta. El
flujo guarda `positive`, `neutral` o `negative` en esa clave antes de continuar.
Conecta condiciones para decidir qué hacer con cada resultado y utiliza
únicamente respuestas aprobadas. Se pide a la IA tratar como negativo un comentario mixto;
si hay duda, se pide atención humana o falla la IA, se transfiere al equipo.

Esta clasificación consume créditos y puede equivocarse; pruébala antes de
publicar. No sustituye el análisis completo de conversación ni crea una
respuesta aprobada por sí sola. No se puede combinar en la misma pregunta con
listas, fechas, horas o notas de contacto. Actívala antes de iniciar la
conversación y confirma que el equipo puede atender las transferencias.

Al transferir una ejecución, si el análisis de conversaciones está habilitado
y la política de análisis al transferir está activa, el flujo pone el análisis
en la cola sin los dos minutos de espera de los mensajes normales. El worker
procesa la cola periódicamente; por eso el resultado no necesariamente aparece
antes de que una persona abra la conversación.

En el nodo **Transferir a un agente**, puedes guardar la nota interna como nota
privada de la conversación. Admite variables como `{{vars.sede}}`; solo el
equipo la ve, nunca se envía al cliente y admite hasta 2000 caracteres. Úsala
para entregar un resumen breve. La nota aparece con la identidad propietaria
del flujo; evita recopilar datos reales sensibles en demostraciones.

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

### Elegir horarios con IA

En **Ofrecer horarios**, activa **Interpretar selección de horario con IA**
solo para WhatsApp y conecta directamente una cita con protección contra
duplicados. Configura también la clave de fecha solicitada, para usar una zona
horaria inequívoca de la agenda. La IA interpreta una elección como «la primera opción» y después
pide confirmar la fecha y hora. Configura el mensaje de confirmación con
`{{vars.offer_date}}` y `{{vars.offer_time}}`, por ejemplo: «Elegiste
{{vars.offer_date}} a las {{vars.offer_time}}. Para confirmar, responde:
Confirmo {{vars.offer_date}} {{vars.offer_time}}».

La respuesta debe contener la fecha completa `DD/MM/AAAA` y la hora `HH:mm`,
por ejemplo «Confirmo 21/11/2026 19:30». Un simple «sí» no agenda. Comprueba
siempre el horario antes de confirmar: la IA puede interpretar una opción
incorrectamente. La disponibilidad se comprueba al agendar y el uso de IA
consume créditos. La protección evita citas duplicadas, pero una confirmación
antigua con la misma fecha y hora podría coincidir con una oferta nueva.
Esta opción no comprueba cupos reales por sede, zona o mesa.

Opcionalmente, **Aceptar confirmación breve** permite responder «sí» o
«confirmado gracias» después de mostrar la fecha y hora. Esto reduce la
protección frente a mensajes antiguos o retrasados, que podrían confirmar otra
oferta pendiente; actívalo solo si aceptas ese riesgo. La disponibilidad y la
protección contra duplicados siguen comprobándose al agendar.

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
