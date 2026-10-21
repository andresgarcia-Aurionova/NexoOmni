---
title: "Consultar créditos de IA"
description: "Consulta el saldo, el consumo mensual, las recargas y los movimientos de créditos de IA de tu cuenta."
section: "primeros-pasos"
role: ["supervisor", "admin", "owner"]
plan: ["ai"]
updated: "2026-10-21"
---

## ¿Qué es?

La sección **Créditos de IA** muestra cuántos créditos están disponibles
para las funciones de IA de tu cuenta, permite elegir un paquete de recarga
cuando la compra en línea está habilitada y muestra los movimientos recientes.

## ¿Para quién es?

La pueden consultar el propietario, los administradores y los supervisores
de una cuenta con funciones de IA activas.

## Cómo se usa

1. En el menú lateral, abre **Créditos de IA**.
2. Consulta el saldo disponible y su equivalente aproximado en MXN, calculado
   con la fecha del FIX de Banxico que aparece en pantalla.
3. Revisa el consumo de créditos del mes calendario UTC, agrupado por
   actividad y cantidad de usos. Solo se incluyen débitos confirmados en el
   libro de créditos.
4. Revisa los últimos 50 movimientos: recargas, ajustes, uso, reembolsos o
   vencimientos.
5. Usa **Actualizar** para volver a consultar la información.
6. Cuando las recargas en línea estén habilitadas, elige uno de los paquetes
   disponibles y continúa al Checkout seguro de Stripe. Antes de pagar,
   confirma el total en MXN y el desglose del paquete y el IVA. El costo
   estimado de procesamiento está incluido en el precio del paquete; no se
   agrega como un cargo separado por tarjeta.
7. Al terminar el pago, vuelve a **Créditos de IA**. El saldo se actualiza
   después de que Stripe confirme el pago; si no aparece de inmediato, pulsa
   **Actualizar** en unos segundos.

Los paquetes son Emprendedor (50,000 créditos), Comercial Pro (150,000) y
Corporativo (300,000). El precio se convierte a MXN con el FIX de Banxico
disponible al iniciar el Checkout, por lo que puede cambiar e incluye el costo
estimado de procesamiento del pago. Las tarjetas
internacionales también se aceptan cuando el pago en línea está habilitado.
La pantalla no muestra nombres de proveedores ni modelos de IA.

Si la opción de compra aparece deshabilitada, el equipo de NexoOmni aún no ha
activado las recargas en línea. Si Stripe confirmó un cobro y el saldo no se
actualiza, no repitas el pago: actualiza la pantalla y contacta al equipo para
revisar la operación.

El equivalente en MXN es solo una referencia estimada del saldo disponible,
no es un cobro, factura ni cotización. Se muestra únicamente cuando hay un FIX
reciente disponible.

## Alertas de saldo

El propietario, los administradores y los supervisores activos reciben una
notificación dentro de NexoOmni y un correo cuando el saldo cruza el 10 % y
el 5 % del último paquete pagado. Cada nivel se avisa una sola vez por
recarga; una nueva recarga pagada inicia un nuevo ciclo de alertas. El aviso
del 5 % se resalta como urgente.

Al agotarse el saldo, las nuevas solicitudes de IA se bloquean y las llamadas
de Zernio se pausan. Solicita la recarga antes de llegar a cero para evitar
interrupciones.

## Preguntas frecuentes

**¿Por qué cambió mi saldo?**

Los movimientos indican si el cambio corresponde a uso de IA, una recarga,
un ajuste, un reembolso o créditos vencidos.

**¿Por qué no aparece un movimiento reciente?**

La lista muestra como máximo los últimos 50 movimientos. Pulsa **Actualizar**
para consultar los datos más recientes.

**¿El equivalente en MXN es el importe que debo pagar?**

No. Es una referencia aproximada del valor del saldo disponible, calculada con
el FIX de Banxico indicado. El importe de una recarga se muestra en Checkout
antes de confirmar el pago.

**¿Cuándo vencen los créditos comprados?**

Cada recarga pagada vence 30 días después de acreditarse. El saldo que ya
existía antes del cambio, los ajustes y las cortesías no vencen.

**¿Stripe genera automáticamente una factura?**

No. La generación automática de factura de Stripe está desactivada. Contacta
al equipo de NexoOmni para conocer el proceso de facturación disponible.

## Ver también

- [Administrar créditos de IA](./administrar-creditos-ia.md)
