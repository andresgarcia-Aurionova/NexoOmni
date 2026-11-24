---
title: "Google, redes sociales, correo y CRM"
description: "Conecta Google Business, Gmail, correo IMAP, TikTok, X, Threads, Telegram, HubSpot y Salesforce con la bandeja, el análisis y los reportes de NexoOmni."
section: "integraciones"
role: ["admin", "owner", "supervisor", "agent"]
plan: ["crecimiento", "premium"]
updated: "2026-11-24"
---

## ¿Qué es?

NexoOmni puede reunir en una sola bandeja los mensajes, comentarios,
respuestas públicas y reseñas que llegan desde Google Business, Google,
correo electrónico, TikTok, X, Threads y Telegram. También puede
conectar HubSpot o Salesforce para conservar contactos y actividad de
mensajería junto al CRM.

Los mensajes entran al mismo circuito de NexoOmni: historial del contacto,
Nexo Memory, sentimiento, control de calidad, respuesta automática,
automatizaciones, flujos y reportes. Las restricciones de cada proveedor
siguen aplicando; por ejemplo, Threads no ofrece mensajes privados y
TikTok no permite abrir una conversación nueva.

## ¿Para quién es?

- El **propietario o administrador** autoriza las cuentas desde
  **Configuración → Integraciones y canales conectados**, donde aparecen
  todas las integraciones disponibles.
- Los **supervisores y agentes** trabajan los eventos admitidos desde el
  Inbox como cualquier otra conversación.
- El equipo comercial consulta en Reportes el canal de origen de cada
  conversación y puede asignar ese canal a un trato.

## Cómo conectar

1. Ve a **Configuración → Canales e integraciones**.
2. Busca el servicio que quieres conectar y pulsa **Conectar**. Si el
   canal está disponible pero no contratado, NexoOmni muestra un aviso
   para contactar a tu proveedor y habilitar el add-on; la ventana no
   inicia ninguna conexión ni cobro automáticamente.
3. Autoriza la cuenta con el navegador del proveedor. NexoOmni nunca pide
   la contraseña de Google, TikTok, X, Threads, HubSpot o Salesforce.
4. En Telegram, agrega el bot indicado como administrador del grupo o
   canal y envíale el código mostrado junto con el nombre del canal.
5. Al volver, comprueba que el estado aparece como **Conectado**. Puedes
   pausar, reactivar o eliminar la conexión en cualquier momento.

Al conectar una cuenta Google, NexoOmni realiza una carga inicial de los
últimos 90 días de hilos del buzón de entrada, importa los contactos que ya
sincroniza Zernio y carga los eventos de Calendar desde 30 días antes hasta
90 días adelante. Después, Gmail y los cambios de Calendar siguen entrando
por webhook. Los eventos de Google se muestran en **Agenda** como lectura
de calendario; para modificarlos o eliminarlos, usa Google Calendar.

Los add-ons se habilitan por cuenta y por canal desde el panel de
operación de NexoOmni. Esto incluye WhatsApp, Facebook, Instagram,
Google Business, cuenta Google, correo, TikTok, X, Threads, Telegram,
HubSpot y Salesforce. Un canal no habilitado sigue siendo visible, pero
no permite conectarse ni enviar, recibir o analizar eventos nuevos.

Para **correo IMAP / SMTP**, la guía detecta cuentas de Google o
Microsoft y usa su autorización oficial. Otros buzones piden una
contraseña de aplicación y descubren los servidores IMAP/SMTP. Si el
proveedor no permite IMAP, hay que habilitarlo en la cuenta antes de
volver a intentar.

## Qué admite cada integración

| Integración | Qué entra a NexoOmni | Respuesta desde NexoOmni |
|---|---|---|
| Google Business | Reseñas nuevas de una ubicación | Una respuesta por reseña; responde de nuevo solo si se pretende sustituir la respuesta anterior |
| Cuenta Google | Conversaciones de Gmail; contactos sincronizados; eventos de Calendar | Respuestas y nuevos mensajes dentro del hilo permitido |
| Correo IMAP / SMTP | Hilos de correo del buzón conectado | Respuesta por el mismo hilo o envío SMTP cuando el proveedor lo admite |
| TikTok | DMs y comentarios de cuentas Business admitidas | Solo responder después de que el cliente escriba; máximo vigente del proveedor |
| X | DMs y respuestas o menciones | Respuesta donde la cuenta y el plan de X lo permitan |
| Threads | Respuestas y comentarios públicos | Respuesta pública; no hay DMs |
| Telegram | Mensajes en grupos o canales autorizados | Mensajes del bot en ese grupo o canal; no DMs privadas |
| HubSpot | Contactos y actividad de conversaciones sincronizados con el portal | La conexión mantiene contactos y línea de tiempo según los permisos aprobados |
| Salesforce | Contactos, Leads y actividad de conversaciones en la organización | Respuestas por los canales originales; el CRM recibe la actividad |

### Límites de los proveedores

- **TikTok:** requiere cuenta Business con DMs habilitados. La región
  debe estar admitida; el proveedor no permite iniciar la conversación
  y limita el número de respuestas después del último mensaje.
- **Threads:** no tiene API de mensajes directos.
- **Telegram:** la conexión guiada usa el bot del integrador. Es útil
  para grupos y canales, no para conversaciones privadas con otra marca.
- **Google Business:** Google eliminó el chat de Business Profile; aquí
  se admiten reseñas, no DMs.
- **X:** la lectura y escritura de DMs dependen del acceso API y del
  cobro contratado en la cuenta de X.
- **HubSpot y Salesforce:** la conversación se sigue escribiendo en su
  canal original. El CRM conserva contacto y actividad. Para mapear
  etapas comerciales personalizadas entre tratos/oportunidades hace
  falta definir el mapa de etapas por empresa; NexoOmni no inventa ese
  mapa.
- **Calendar, Drive y Contacts:** al conectar Google se solicitan esos
  permisos cuando están disponibles. Las aplicaciones externas deben
  pasar las verificaciones de Google; NexoOmni no almacena el token en
  el navegador.

## Reportes, análisis y memoria

Los nuevos eventos se guardan con su nombre comercial —por ejemplo, “X”
o “Gmail”—, no con el nombre técnico de la plataforma que transporta la
conexión. El reporte ejecutivo suma conversaciones y mensajes por
canal, y Nexo Memory conserva la línea de tiempo y el análisis de cada
contacto.

Para Google Business se muestra el evento como reseña y no como chat. En
TikTok, X y Threads, los comentarios públicos se distinguen de los DMs
privados. En correo, la conversación se presenta como un hilo.

## Preguntas frecuentes

**¿Por qué algunas conversaciones no permiten iniciar un mensaje nuevo?**
Algunos proveedores solo dejan responder después de que el cliente
escriba. NexoOmni intenta el envío y muestra el rechazo real del
proveedor si la ventana ya terminó.

**¿La conexión muestra el nombre de NexoOmni?**
Sí, la pantalla de bienvenida usa la marca configurada. La autorización
oficial del proveedor todavía puede abrirse temporalmente en el dominio
del integrador. Zernio conserva su insignia “Secured by Zernio” y la página
oficial del proveedor puede mencionar la app de Zernio; ese comportamiento
no se puede eliminar con el flujo oficial de marca blanca. NexoOmni ya usa
`GET /api/v1/connect/{platform}?profileId=PROFILE_ID` y Zernio aplica la
pantalla de bienvenida guardada a todos sus enlaces.

**¿Se sincronizan tratos y oportunidades automáticamente?**
Las conversaciones y contactos vinculados se sincronizan con el CRM
conectado. El movimiento de tratos entre sistemas necesita una tabla de
correspondencia de etapas y permisos de escritura por empresa. Si no
existe, NexoOmni conserva el origen comercial sin adivinar una etapa.

## Ver también

- [Bandeja compartida](../inbox/bandeja-compartida.md)
- [Respuesta automática con IA](../agentes-ia/respuesta-automatica.md)
- [Reportes ejecutivos](../supervision-y-reportes/reportes-ejecutivos.md)
