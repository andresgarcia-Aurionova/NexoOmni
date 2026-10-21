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

## Importante

- El consumo y el costo mostrados son estimaciones calculadas a partir de los
  tokens reportados y de los precios configurados. No equivalen a la factura
  real de OpenAI o Anthropic.
- Las llamadas sin precio configurado o sin cálculo de cobro se indican como
  **Sin estimación**; no se deben interpretar como gratuitas.
- Los abonos todavía no se descuentan automáticamente por el uso de IA.
  El débito real se habilitará en una fase posterior, después de validar las
  mediciones en modo sombra.
- Las recargas se registran manualmente. El cobro automático con Stripe aún
  no está conectado.
- Zernio agrupa las llamadas por número y las vincula a un cliente solo cuando
  su perfil permite identificarlo sin ambigüedad. Las llamadas que no se pueden
  asignar aparecen aparte y no se suman a un cliente. El resumen mensual usa
  el calendario UTC.
- El cargo de Zernio y el cargo informativo de Meta se muestran en columnas
  separadas; el segundo no es un cargo que Zernio facture. Estos importes son
  informativos y no se descuentan de los créditos.
- Yeastar muestra llamadas, minutos hablados y llamadas con transcripción.
  El costo de transcripción todavía no está conciliado, por lo que no se
  calcula ni se cobra.

## Preguntas frecuentes

**¿Por qué el saldo no cambia cuando el cliente usa IA?**

El sistema registra estimaciones, pero todavía no realiza débitos reales.
El panel lo indica para evitar confundir saldo acreditado con saldo disponible
después del consumo.

**¿El costo mostrado coincide exactamente con OpenAI o Anthropic?**

No necesariamente. Es un cálculo interno con el uso registrado y los precios
configurados. Para conciliar el gasto real, compara estos datos con la factura
del proveedor y asegúrate de que todos los modelos tengan precio configurado.

**¿Puede un cliente ver qué proveedor o modelo se utilizó?**

No desde este panel; los detalles de proveedor y modelo son información interna
de la plataforma.
