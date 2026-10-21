---
title: 'Administrar llaves de IA por cliente'
description: 'Verifica y guarda las credenciales de IA desde Administración NexoOmni.'
section: 'primeros-pasos'
role: ['super_admin']
plan: ['basico']
updated: '2026-10-20'
---

## ¿Qué es?

Es el espacio interno para registrar las llaves de OpenAI y Anthropic que
NexoOmni usa para cada cliente. El cliente conserva el control de las
instrucciones y el comportamiento de su asistente, pero no ve ni modifica
proveedores, modelos o credenciales.

## ¿Para quién es?

Solo para el operador autorizado de la plataforma. Las rutas del servidor
verifican el acceso; ocultar el panel en pantalla no es el único control.

## Cómo se usa

1. Abre **Administración NexoOmni** y localiza **Llaves de IA por cliente**.
2. Selecciona el cliente y revisa el proveedor que está usando actualmente y
   el estado de las llaves registradas.
3. Selecciona OpenAI o Anthropic, pega la llave y pulsa **Verificar y guardar**.
4. NexoOmni envía una solicitud corta de prueba. Si el proveedor la acepta,
   la llave queda cifrada y el panel muestra solo sus últimos cuatro
   caracteres.

## Importante

- La prueba genera una solicitud real: el proveedor puede cobrarla y NexoOmni
  también registra el consumo en los créditos del cliente cuando la base
  confirma el débito. Revisa el panel de créditos después de probar.
- Las llaves no se devuelven completas al navegador ni se escriben en los
  registros de la aplicación.
- Guardar una llave no cambia automáticamente el proveedor activo. Agregar
  Anthropic tampoco activa el enrutamiento entre proveedores.
- La selección automática por tarea sigue desactivada hasta que se complete
  y apruebe la evaluación ciega de calidad.
- Si el cliente no tiene una configuración activa, guardar una llave de
  OpenAI crea una configuración inicial apagada. El operador debe coordinar
  la habilitación del asistente antes de que el cliente lo use.

## Preguntas frecuentes

**¿Por qué la llave aparece guardada pero no activa?**

La llave puede estar disponible como credencial adicional, mientras el
proveedor seleccionado para el cliente permanece igual. No se cambia de
proveedor hasta validar los modelos y las tareas que dependen de ellos.

**¿Qué hago si la prueba falla?**

Confirma que la llave sea correcta y que la cuenta del proveedor permita el
modelo de prueba configurado por NexoOmni. La llave no se guarda cuando la
verificación falla.

**¿El cliente puede ver el proveedor o el modelo?**

No. La configuración del cliente muestra instrucciones y opciones de
comportamiento, mientras que el panel interno y los reportes del operador
conservan los detalles técnicos.

## Ver también

- [Administrar créditos de IA](./administrar-creditos-ia.md)
- [Configuración de respuesta automática](../agentes-ia/respuesta-automatica.md)
