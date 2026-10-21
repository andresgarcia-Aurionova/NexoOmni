---
title: "Consultar créditos de IA"
description: "Consulta el saldo, el consumo mensual y los movimientos de créditos de tu cuenta."
section: "primeros-pasos"
role: ["supervisor", "admin", "owner"]
plan: ["ai"]
updated: "2026-10-21"
---

## ¿Qué es?

La sección **Créditos de IA** muestra cuántos créditos están disponibles
para las funciones de IA de tu cuenta y los movimientos más recientes que
afectan ese saldo.

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

La pantalla no muestra nombres de proveedores ni modelos de IA. Las recargas
se registran manualmente por ahora; contacta al equipo de NexoOmni para
solicitar una.

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
el FIX de Banxico indicado. Las recargas siguen gestionándose manualmente.

## Ver también

- [Administrar créditos de IA](./administrar-creditos-ia.md)
