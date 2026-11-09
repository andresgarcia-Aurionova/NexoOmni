---
title: "Flujos"
description: "Construye conversaciones automáticas de varios pasos (menús, botones, listas) con un editor visual, sin código."
section: "automatizaciones-y-flujos"
role: ["admin", "owner"]
plan: ["crecimiento", "premium"]
updated: "2026-09-28"
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
