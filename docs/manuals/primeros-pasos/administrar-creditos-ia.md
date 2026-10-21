---
title: 'Administrar créditos de IA'
description: 'Consulta el uso de IA y llamadas, y registra recargas manuales por cliente.'
section: 'primeros-pasos'
role: ['super_admin']
plan: ['basico']
updated: '2026-10-20'
---

## ¿Qué es?

El panel de Administración NexoOmni permite consultar los créditos de cada
cliente, revisar el uso de IA registrado durante el mes y dejar constancia
de una recarga o ajuste manual. También permite revisar las llamadas informadas por
Zernio y los minutos hablados registrados por Yeastar.

## ¿Para quién es?

Solo para el operador autorizado de la plataforma. Los clientes no pueden
consultar ni modificar este panel.

## Cómo se usa

1. Abre **Administración NexoOmni** y baja hasta **Créditos de IA por cliente**.
2. Selecciona el cliente para consultar su saldo, consumo registrado del mes
   y movimientos recientes. Más abajo, **Consumo de llamadas este mes** muestra
   por separado los registros de Zernio y Yeastar.
3. Para acreditar saldo, indica la cantidad de créditos, selecciona
   **Recarga cobrada** o **Ajuste o cortesía**, y agrega un motivo o referencia.
4. Pulsa **Registrar abono**. El saldo y el movimiento se guardan juntos y
   una repetición de la misma solicitud no vuelve a acreditar los créditos.

### Tipo de cambio y tarifas de llamadas

En **Administración NexoOmni**, sección **Tipo de cambio y tarifas de
llamadas** (arriba de los créditos):

- Se muestra el tipo de cambio vigente, su fecha y su fuente. Banxico (FIX) se
  consulta automáticamente cada 12 horas al cobrar llamadas.
- **Actualizar desde Banxico** fuerza la consulta (requiere
  `BANXICO_API_TOKEN` en el servidor).
- **Fijar tipo de cambio** captura un valor manual; se respeta 24 horas y luego
  se vuelve a consultar Banxico.
- Puedes cambiar el **precio por minuto** (MXN) y el **margen objetivo**; el
  cambio aplica a las llamadas que se cobren desde ese momento.

## Importante

- Las solicitudes de IA con precio configurado descuentan créditos cuando el
  proveedor devuelve el uso y la base confirma el cobro. Los créditos se
  redondean hacia arriba a unidades enteras; una solicitud pequeña puede
  consumir un crédito completo.
- El saldo puede quedar negativo hasta que se registre una recarga. Llegar a
  cero no detiene automáticamente el uso de IA.
- Si el proveedor/modelo no tiene precio vigente, NexoOmni bloquea la
  solicitud antes de enviarla. La prueba de una llave desde el panel también
  es una solicitud real y descuenta créditos.
- En llamadas de WhatsApp conectadas con Zernio se cobra el costo de conexión
  reportado por Zernio con el margen configurado (actualmente 50 %, equivalente
  a ×2), más MXN $0.50 por cada minuto iniciado de una llamada contestada. El
  costo de Meta se muestra solo como información y no se descuenta del saldo.
- Yeastar permite consultar llamadas y minutos hablados, pero el costo de la
  transcripción generada por una llave de OpenAI configurada en la PBX no se
  calcula ni se cobra aquí. El análisis posterior que NexoOmni ejecute con IA
  sí se cobra como uso de IA.
- La conversión de minutos a créditos depende del FIX de Banxico. La
  aplicación requiere `BANXICO_API_TOKEN` configurado como variable de entorno
  en el servidor; no lo compartas en el chat ni lo guardes en el repositorio.
- Las recargas se registran manualmente. El cobro automático con Stripe aún
  no está conectado.
- Zernio agrupa las llamadas por número y las vincula a un cliente solo cuando
  su perfil permite identificarlo sin ambigüedad. Las llamadas que no se pueden
  asignar aparecen aparte y no se suman a un cliente. El resumen mensual usa
  el calendario UTC.
- El cargo de Zernio se usa para calcular el débito de conexión. El importe
  informativo de Meta se mantiene separado; no se descuenta de los créditos.
- Yeastar muestra llamadas, minutos hablados y llamadas con transcripción.
  El costo de transcripción todavía no está conciliado, por lo que no se
  calcula ni se cobra.

## Preguntas frecuentes

**¿Por qué cambia el saldo cuando se usa IA?**

Cada uso de IA cuyo proveedor devuelve tokens y tiene precio configurado se
registra y debita de forma atómica. El historial de movimientos permite
consultar el débito correspondiente.

**¿El débito coincide exactamente con la factura de OpenAI o Anthropic?**

El débito se calcula con los tokens reportados y el precio vigente configurado
para el modelo. La conciliación automática con la factura del proveedor aún no
está disponible; compara los datos con el panel de OpenAI o Anthropic.

**¿El sistema bloquea la IA cuando el saldo llega a cero?**

No. El saldo puede quedar negativo hasta que se registre una recarga.

**¿Puede un cliente ver qué proveedor o modelo se utilizó?**

No desde este panel; los detalles de proveedor y modelo son información interna
de la plataforma.
