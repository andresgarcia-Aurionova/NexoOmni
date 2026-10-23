---
title: "Nexo Asistente"
description: "Consulta cómo usar NexoOmni y revisa datos de tu cuenta desde una conversación de solo lectura."
section: "agentes-ia"
role: ["supervisor", "admin", "owner"]
plan: ["ai", "yeastar_voice", "whatsapp_voice"]
updated: "2026-10-22"
---

## ¿Qué es?

Nexo Asistente responde preguntas sobre las funciones de NexoOmni, consulta
información de la cuenta y prepara reportes personalizados. También puede
proponer tareas, citas, cambios de contacto y mensajes de WhatsApp. Ninguna
acción se ejecuta sin que la persona revise la vista previa y la confirme.

## ¿Para quién es?

Está disponible para supervisores, administradores y propietarios de cuentas
con el módulo de IA habilitado. Cada consulta consume créditos de IA; las
preguntas que requieren consultar fuentes pueden usar más de una operación
facturable.

## Cómo se usa

1. Abre NexoOmni e inicia sesión con un perfil supervisor o superior.
2. Selecciona el botón de Nexo Asistente en la esquina inferior derecha.
3. Escribe una pregunta, por ejemplo, cómo consultar citas o cuántas
   oportunidades tiene la cuenta.
4. Revisa la respuesta y sus fuentes cuando estén disponibles. Para una acción,
   confirma que el contacto y todos los detalles sean correctos antes de elegir
   **Confirmar y ejecutar**.
5. Usa **Nueva conversación** para empezar otro tema. El historial se conserva
   hasta que elimines una conversación desde la lista.

## Qué puede consultar

- Manuales de uso de NexoOmni.
- Información disponible en la base de conocimiento de la propia cuenta.
- Resumen de la cuenta, saldo de créditos, contactos, oportunidades, citas,
  difusiones, carga de conversaciones por agente y transcripciones recientes
  de llamadas Yeastar.
- Reportes agregados de conversaciones, agentes, ventas, citas, AgendaPro,
  difusiones, llamadas, inteligencia, Nexo Memory, contactos, créditos,
  recargas y uso de IA.

## Crear y descargar un reporte

1. Pide el reporte en el chat e indica el periodo; también puedes indicar un
   canal o el nombre exacto de un agente. Si no indicas fechas, se usa el
   periodo más reciente de 30 días. El periodo máximo es de 365 días.
2. Revisa las secciones, los filtros aplicados y los avisos que acompañan al
   resultado. Algunas métricas de cuenta, como saldo, recargas y uso de IA, no
   se pueden separar por canal o agente.
3. Usa **Descargar CSV**, **Descargar Excel** o **Imprimir o guardar PDF**.
   Para obtener un PDF, elige la opción de guardar como PDF en la ventana de
   impresión del navegador.

Los reportes personalizados y sus archivos muestran datos agregados: no
incluyen nombres ni teléfonos de contactos. Los agentes aparecen con una
etiqueta anónima. La facturación de recargas y el detalle de uso de IA solo
están disponibles para administradores y propietarios. Nexo Memory muestra el
estado actual y no un historial del periodo seleccionado.

## Proponer una acción

Puedes pedir que cree un seguimiento, agende una cita, actualice el nombre,
correo o empresa de un contacto, o prepare un mensaje de texto para una
conversación existente de WhatsApp. Las citas requieren que el módulo Agenda
esté habilitado. No se pueden cambiar teléfonos ni enviar mensajes masivos,
multimedia o plantillas desde el asistente.

Antes de ejecutar, el asistente muestra una vista previa con el contacto y los
detalles. Revisa el texto del mensaje, las fechas y los cambios de contacto.
**Confirmar y ejecutar** aplica exactamente esa propuesta; **Cancelar** la
descarta. La propuesta vence en cinco minutos, solo la puede confirmar la misma
persona que la solicitó y no se puede volver a ejecutar después de procesarse.
Si el horario de una cita ya no está libre o el canal no está disponible, se
rechaza y puedes pedir una propuesta nueva.

El historial muestra si la acción quedó completada, cancelada, vencida o no se
pudo completar. Si el resultado de un envío no puede confirmarse, revisa la
conversación de WhatsApp antes de solicitar otro envío. Los eventos de auditoría
no guardan el texto del mensaje; la propuesta se conserva junto al historial
hasta que elimines la conversación.

Nexo Asistente consulta y modifica únicamente datos permitidos de la cuenta
actual. Puede ayudar con el uso técnico de NexoOmni desde sus manuales para
clientes, pero no revela información de otros tenants, costos reales o
ganancias internas de la plataforma, secretos, seguridad interna ni datos
corporativos o de desarrollo. Los reportes personalizados son de solo lectura
y contienen únicamente información agregada permitida de la cuenta.

## Preguntas frecuentes

### ¿Por qué no recibí una respuesta?

La cuenta puede no tener créditos suficientes, el módulo de IA puede no estar
configurado o una consulta puede tardar demasiado. Revisa el saldo y vuelve a
intentarlo cuando el servicio esté disponible.

### ¿Puedo borrar una conversación?

Sí. Selecciona la conversación y usa **Eliminar conversación**. La eliminación
borra el hilo y sus mensajes asociados.

### ¿Nexo Asistente muestra todos los datos de una cuenta?

No. Solo consulta los datos incluidos en sus fuentes permitidas y respeta los
permisos de la cuenta. No puede consultar información de otras cuentas ni
ejecutar consultas SQL arbitrarias.

### ¿Por qué un reporte muestra un aviso o una sección vacía?

Algunos filtros no están disponibles en todos los módulos, una función puede
no estar habilitada para la cuenta o el nombre del agente puede no ser único.
El reporte indica esas limitaciones en vez de presentar datos como si el filtro
se hubiera aplicado.

## Ver también

- [Base de conocimiento de la IA](/manuales/agentes-ia/base-de-conocimiento)
- [Créditos de IA](/manuales/primeros-pasos/consultar-creditos-ia)
