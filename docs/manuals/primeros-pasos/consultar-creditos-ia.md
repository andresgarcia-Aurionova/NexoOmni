---
title: "Consultar créditos de IA"
description: "Consulta el saldo, el consumo mensual, las recargas y los movimientos de créditos de IA de tu cuenta."
section: "primeros-pasos"
role: ["supervisor", "admin", "owner"]
plan: ["ai", "yeastar_voice", "whatsapp_voice"]
updated: "2026-10-23"
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
   Si tu cuenta usa transcripciones Yeastar, sus créditos pueden aparecer
   como **Transcripción Yeastar (estimada)**. El cálculo se basa en la duración
   hablada y en una tarifa promedio; no representa los tokens exactos usados
   por la central.
4. Revisa los últimos 50 movimientos: recargas, ajustes, uso, reembolsos o
   vencimientos.
5. Usa **Actualizar** para volver a consultar la información.
6. En **Paquete mensual de créditos de IA**, contrata Inicio, Emprendedor,
   Comercial Pro o Corporativo. El paquete se cobra cada mes y sus créditos se
   renuevan automáticamente. Si necesitas más, sube de paquete: se cobra la
   diferencia de inmediato y empieza un nuevo mes. Al bajar de paquete, el
   cambio aplica en tu siguiente renovación. Con **Cancelar renovación**
   conservas tus créditos hasta el final del mes pagado.
7. Si te quedas sin créditos antes de la renovación, puedes comprar **créditos
   extra** (pago único). Cuestan 20 % más por crédito que tu paquete, por lo
   que normalmente conviene más cambiar a un paquete superior.
8. Antes de pagar, confirma el total en MXN. El costo estimado de
   procesamiento y el IVA están incluidos en el monto.
9. Al terminar el pago, vuelve a **Créditos de IA**. El saldo se actualiza
   después de que Stripe confirme el pago; si no aparece de inmediato, pulsa
   **Actualizar** en unos segundos.

Los paquetes mensuales son Inicio (25,000 créditos, US$25), Emprendedor
(50,000, US$50), Comercial Pro (150,000, US$150) y Corporativo (300,000,
US$300). Los créditos del mes que no uses **no se acumulan**. Los créditos
extra son de 10,000 (US$12) y 25,000 (US$30) y vencen 30 días después de
acreditarse. El monto en MXN se calcula con el FIX de Banxico del día de cada
cobro: el paquete siempre vale lo mismo en dólares y el monto en pesos se
ajusta cada mes. Las tarjetas internacionales también se aceptan.
La pantalla no muestra nombres de proveedores ni modelos de IA.

Las llamadas de WhatsApp descuentan créditos: una conexión por llamada
(mínimo US$0.10) más un cargo por minuto contestado (MXN 0.50 por minuto
iniciado). Las transcripciones Yeastar se cobran solo cuando NexoOmni tiene configurada
una tarifa promedio y el saldo alcanza. El precio estimado incluye un 50 %
adicional sobre ese costo. Si no hay créditos suficientes, el cargo queda
pendiente y puede procesarse después de una recarga.

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
de WhatsApp se pausan. Solicita la recarga antes de llegar a cero para evitar
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

Los créditos del paquete mensual vencen al terminar el mes pagado y no se
acumulan. Cada compra de créditos extra vence 30 días después de acreditarse.
El saldo que ya existía antes del cambio, los ajustes y las cortesías no
vencen.

**¿Stripe genera automáticamente una factura?**

No. La generación automática de factura de Stripe está desactivada. Contacta
al equipo de NexoOmni para conocer el proceso de facturación disponible.

## Ver también

- [Administrar créditos de IA](./administrar-creditos-ia.md)
