---
title: 'Administrar créditos de IA'
description: 'Consulta el uso de IA y llamadas, registra recargas y configura Stripe.'
section: 'primeros-pasos'
role: ['super_admin']
plan: ['basico']
updated: '2026-10-21'
---

## ¿Qué es?

El panel de Administración NexoOmni permite consultar los créditos de cada
cliente, revisar el uso de IA registrado durante el mes y dejar constancia
de una recarga o ajuste manual. También permite revisar las llamadas informadas por
WhatsApp y los minutos hablados registrados por Yeastar.

## ¿Para quién es?

Solo para el operador autorizado de la plataforma. Los clientes no pueden
consultar ni modificar este panel.

## Cómo se usa

1. Abre **Administración NexoOmni** y baja hasta **Créditos de IA por cliente**.
2. Selecciona el cliente para consultar su saldo, consumo registrado del mes
   y movimientos recientes. Más abajo, **Consumo de llamadas este mes** muestra
   por separado los registros de WhatsApp y Yeastar.
3. Para acreditar saldo, indica la cantidad de créditos, selecciona
   **Recarga cobrada** o **Ajuste o cortesía**, y agrega un motivo o referencia.
4. Pulsa **Registrar abono**. El saldo y el movimiento se guardan juntos y
   una repetición de la misma solicitud no vuelve a acreditar los créditos.

### Configurar recargas en línea con Stripe

La configuración es central: los clientes comparten las mismas credenciales
Stripe y estas no se copian a los registros de cada cuenta.

1. Confirma que la migración 167 esté aplicada y que la aplicación tenga
   configurada la misma `ENCRYPTION_KEY` que se usa para cifrar los demás
   secretos. Configura también `NEXT_PUBLIC_SITE_URL` o `APP_URL` con la URL
   HTTPS pública de NexoOmni.
2. En **Administración NexoOmni**, abre **Configuración de Stripe** y deja
   seleccionado **Pruebas**. Introduce la clave secreta de prueba y el secreto
   de firma del webhook de Stripe. Los campos vacíos conservan los valores
   previamente guardados; para reemplazar una credencial, pega la nueva.
3. Guarda la configuración y habilita Checkout en modo de prueba para validar
   una compra controlada con los datos de prueba de Stripe. Comprueba el
   Checkout, la firma del webhook y la acreditación idempotente del paquete.
   Después de la prueba, puedes apagar Checkout hasta el lanzamiento.
4. El modo activo inicia en pruebas y Checkout permanece apagado. El modo
   **Activo** procesa pagos reales; antes de usarlo, confirma precios e
   impuestos y completa una revisión operativa. La pantalla solicita una
   confirmación adicional para habilitar Checkout en ese modo.
5. Para retirar credenciales, usa **Quitar credenciales** en el modo
   correspondiente. Si ese modo está activo, Checkout también se apaga.

Las claves API y los secretos webhook se obtienen en el panel de Stripe y no
se deben enviar por correo, chat ni incluir en archivos del repositorio. Las
claves nunca se muestran de nuevo después de guardarse.
Registra en Stripe el endpoint público
`https://<dominio-de-nexo>/api/webhooks/stripe` para los eventos
`checkout.session.completed` y `checkout.session.async_payment_succeeded`;
usa los endpoints y secretos separados de prueba y de pagos reales.

### Tipo de cambio y tarifas de llamadas

En **Administración NexoOmni**, sección **Tipo de cambio y tarifas de
llamadas** (arriba de los créditos):

- Se muestra el tipo de cambio vigente, su fecha y su fuente. Banxico (FIX) se
  consulta automáticamente cada 12 horas al cobrar llamadas.
- **Token de Banxico:** pégalo en el campo **Token de la API de Banxico (SIE)**
  y pulsa **Guardar token**. Se guarda cifrado y no se vuelve a mostrar. Si no
  tienes uno, solicítalo gratis en banxico.org.mx/SieAPIRest. Si prefieres,
  también funciona la variable `BANXICO_API_TOKEN` del servidor (el token del
  panel tiene prioridad).
- **Actualizar desde Banxico** fuerza la consulta (requiere el token).
- **Fijar tipo de cambio** captura un valor manual; se respeta 24 horas y luego
  se vuelve a consultar Banxico.
- Puedes cambiar el **precio por minuto** (MXN) y el **margen objetivo**; el
  cambio aplica a las llamadas que se cobren desde ese momento.
- En **Costo promedio de transcripción Yeastar (USD/min)**, captura la tarifa
  promedio que hayas calculado con el gasto de la central y sus minutos
  transcritos. NexoOmni prorratea ese costo por la duración hablada de cada
  llamada y añade 50 % sobre el costo para calcular el precio en créditos.
  No hay débito automático hasta guardar una tarifa válida. Las llamadas sin
  saldo suficiente quedan pendientes y se reintentan después de una recarga.

## Importante

- Las solicitudes de IA con precio configurado descuentan créditos cuando el
  proveedor devuelve el uso y la base confirma el cobro. Los créditos se
  redondean hacia arriba a unidades enteras; una solicitud pequeña puede
  consumir un crédito completo. Los débitos no reducen el saldo por debajo de
  cero.
- Al llegar a cero, las nuevas solicitudes de IA se bloquean. Los números de
  WhatsApp que estaban habilitados para llamadas se pausan y se
  reactivan al registrar saldo positivo. La llamada ya iniciada puede terminar;
  el sistema registra su consumo al recibir el evento de fin de llamada.
- Si una llamada ya terminada cuesta más que el saldo restante, el débito no
  deja la billetera en negativo: queda identificada sin cobrar y las llamadas
  de WhatsApp se pausan hasta registrar otra recarga.
- La regla comercial acordada es que cada recarga dure 30 días desde su
  acreditación. Una vez desplegada esta actualización, el saldo existente se
  conservará sin vencimiento; las nuevas recargas pagadas vencerán 30 días
  después de acreditarse. Ajustes y cortesías no vencen. Primero se consumen
  los créditos con fecha de vencimiento más próxima.
- Si el proveedor/modelo no tiene precio vigente, NexoOmni bloquea la
  solicitud antes de enviarla. La prueba de una llave desde el panel también
  es una solicitud real y descuenta créditos.
- En llamadas de WhatsApp conectadas se cobra el costo de conexión
  reportado por el proveedor con el margen configurado (actualmente 50 %, equivalente
  a ×2), más MXN $0.50 por cada minuto iniciado de una llamada contestada. El
  costo de Meta se muestra solo como información y no se descuenta del saldo.
- Yeastar permite consultar llamadas y minutos hablados, pero el costo de la
  transcripción generada por una llave de OpenAI configurada en la PBX no se
  calcula ni se cobra aquí. El análisis posterior que NexoOmni ejecute con IA
  sí se cobra como uso de IA.
- La conversión de minutos a créditos depende del FIX de Banxico. El token se
  puede guardar cifrado desde el panel o configurarse como `BANXICO_API_TOKEN`
  en el servidor; no lo compartas en el chat ni lo guardes en el repositorio.
- Checkout con Stripe se validó en modo de prueba, incluida la acreditación
  mediante webhook. Los pagos reales requieren que el operador active el modo
  correspondiente después de revisar precios, impuestos y cumplimiento. Los
  ajustes y cortesías siguen registrándose manualmente desde este panel.
- Las llamadas de WhatsApp se agrupan por número y se vinculan a un cliente solo cuando
  su perfil permite identificarlo sin ambigüedad. Las llamadas que no se pueden
  asignar aparecen aparte y no se suman a un cliente. El resumen mensual usa
  el calendario UTC.
- El cargo del proveedor de conexión se usa para calcular el débito de conexión. El importe
  informativo de Meta se mantiene separado; no se descuenta de los créditos.
- Yeastar muestra llamadas, minutos hablados y llamadas con transcripción.
  Como la central no entrega los tokens de cada tenant, el costo se estima por
  duración hablada usando la tarifa promedio configurada. El reporte separa
  costo estimado, precio cargado, ganancia estimada y créditos debitados. Para
  cada transcripción se conserva la tarifa usada en ese momento.

## Preguntas frecuentes

**¿Por qué cambia el saldo cuando se usa IA?**

Cada uso de IA cuyo proveedor devuelve tokens y tiene precio configurado se
registra y debita de forma atómica. El historial de movimientos permite
consultar el débito correspondiente.

**¿El débito coincide exactamente con la factura de OpenAI o Anthropic?**

El débito se calcula con los tokens reportados y el precio vigente configurado
para el modelo. La conciliación automática con la factura del proveedor aún no
está disponible; compara los datos con el panel de OpenAI o Anthropic.

**¿El cargo por transcripción Yeastar es exacto?**

No. Yeastar no comparte con NexoOmni los tokens usados por la central para
cada cliente. El cargo es una estimación por duración hablada y tarifa promedio,
con un 50 % añadido al costo. Debes revisar esa tarifa con los reportes de uso
de la central y ajustarla cuando cambie el costo promedio.

**¿El sistema bloquea la IA y las llamadas cuando el saldo llega a cero?**

Sí. La IA deja de aceptar solicitudes nuevas y NexoOmni pausa los números de
WhatsApp que estaban habilitados. Al acreditar saldo positivo, reactiva solo los
números que NexoOmni había pausado. Si el proveedor no responde, el panel indica que
la reactivación está pendiente y el worker vuelve a intentarlo.

**¿Puede un cliente ver qué proveedor o modelo se utilizó?**

No desde este panel; los detalles de proveedor y modelo son información interna
de la plataforma.
