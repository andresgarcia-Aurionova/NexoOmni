---
title: "Recepcionista virtual por voz"
description: "Conecta una extensión de Yeastar con un agente de voz, contexto de NexoOmni, transferencia humana y transcripción."
section: "telefonia"
role: ["admin", "owner", "supervisor"]
plan: ["premium"]
updated: "2026-11-26"
---

## ¿Qué es?

La recepcionista virtual atiende llamadas dirigidas desde Yeastar a una
extensión virtual. ElevenLabs procesa audio y voz; NexoOmni agrega el
contexto del negocio, el contacto, Nexo Memory, las herramientas, la
transcripción, los reportes y la transferencia a una persona.

La elección del modelo está gestionada internamente por NexoOmni y puede
usar un respaldo automático. Los clientes administran la voz, el guion, el
destino humano, los límites y las herramientas autorizadas; no eligiendo
proveedores ni nombres de modelos.

## Antes de comenzar

Necesitas:

- Telefonía Yeastar activa.
- Una extensión o destino de Yeastar disponible para el recepcionista.
- Una cuenta ElevenLabs con ElevenAgents y SIP Trunking.
- Una llave ElevenLabs para gestionar el agente.
- Una conexión SIP TLS compatible. En producción no uses UDP.
- Una ruta humana de respaldo y un IVR o extensión de emergencia.
- Una llave OpenAI en la cuenta de NexoOmni para el modo de transcripción
  por turnos en vivo.
- ElevenLabs Enterprise solo si necesitas palabras tentativas mientras la
  persona todavía está hablando. El modo estándar guarda cada frase
  confirmada durante la llamada sin Enterprise.

## Arquitectura

`Cliente → Yeastar → ElevenLabs por SIP → herramientas NexoOmni`

En el modo recomendado, ElevenLabs entrega cada turno de voz confirmado al
LLM personalizado de NexoOmni. NexoOmni lo guarda inmediatamente y transmite
la respuesta generada a ElevenLabs por SSE. Esto ocurre durante la llamada
y no requiere Enterprise.

Cuando termina la llamada, ElevenLabs envía además un webhook firmado con la
transcripción y el análisis; funciona como respaldo y reconciliación final.
El WebSocket Enterprise queda disponible como opción, pero no es necesario.
Next.js nunca transporta el audio de la llamada.

## 1. Configurar Yeastar

1. Crea una troncal SIP hacia ElevenLabs usando el endpoint TLS indicado por
   la consola de ElevenLabs.
2. La URI de destino debe incluir un identificador, por ejemplo:
   `sip:+5255XXXXXXXX@sip.rtc.elevenlabs.io:5061`.
3. Asigna el número o identificador importado al agente en ElevenLabs.
4. Crea una ruta de Yeastar a esa troncal.
5. Configura una extensión virtual o ruta entrante hacia la troncal.
6. Configura un destino alterno si Yeastar recibe falla SIP, ocupado,
   no disponible o timeout. Esta contingencia debe llevar a una persona o IVR;
   una instrucción del agente no sirve si ElevenLabs completo está caído.
7. Prueba SIP/TLS, SRTP, G.711/G.722, audio en ambos sentidos y transferencia
   a la extensión o cola elegida.

Para colas o extensiones internas de Yeastar, usa **API de Yeastar**. Esta
modalidad identifica el canal activo con la extensión y el número del cliente,
guarda el contexto y después solicita a Yeastar la transferencia ciega del
miembro entrante. No depende de `SIP REFER` ni crea una segunda ruta entrante.

Para destinos que no son controlables por Yeastar, conserva **SIP desde
ElevenLabs** y valida REFER o conferencia. Si una transferencia falla, corrige
la ruta o usa la ruta humana configurada en Yeastar.

## 2. Configurar NexoOmni

En **Configuración → Telefonía → Recepcionista virtual por voz**:

1. Registra el nombre y la extensión virtual.
2. Pega la llave ElevenLabs.
3. Define saludo, idioma, zona horaria, reglas del negocio y cuándo debe
   escalar.
4. Mantén activa la base de conocimiento de NexoOmni para usar los
   documentos vigentes.
5. Selecciona la voz después de guardar la llave.
6. Registra el método y el destino humano. Para una cola interna, selecciona
   **API de Yeastar** y usa el número de la cola o extensión, por ejemplo
   `6401`. También puedes mantener un número alterno.
7. Elige **Por turnos confirmados — recomendado**.
8. Guarda y sincroniza el agente. NexoOmni crea el webhook HMAC, los secretos,
   el LLM personalizado y asocia todo al agente automáticamente.

La llave y los secretos se cifran en el servidor y no se devuelven al
navegador.

## 3. Configurar los webhooks en ElevenLabs

NexoOmni configura automáticamente las URL al sincronizar el agente. En el
panel se muestran para diagnóstico:

- **Inicio de conversación**: personaliza al cliente y entrega a ElevenLabs
  un token efímero de la conversación para llamar al LLM personalizado.
- **Post-llamada**: recibe la transcripción final y la verificación HMAC.
- **LLM personalizado**: recibe cada turno confirmado por SSE sin transportar
  el audio a NexoOmni.

NexoOmni suscribe automáticamente:

- Transcripción.
- Falla al iniciar la llamada.

No actives audio completo si no existe una finalidad, consentimiento,
retención y protección definidos. NexoOmni trabaja con transcripción, no
necesita el archivo de audio para operar.

## 4. Personalización y herramientas

En el inicio de una llamada, NexoOmni entrega al agente:

- Nombre del negocio.
- Nombre y teléfono del contacto, si ya existe.
- Último resumen de Nexo Memory.
- Acción recomendada y compromisos pendientes.
- Documentos de la base de conocimiento.
- Extensión virtual, destino humano y zona horaria.

No coloques pagos, contraseñas, tokens ni datos sensibles en el prompt o en
las variables. Si una acción es sensible, se debe confirmar y autorizar en
NexoOmni.

Las herramientas disponibles pueden usar:

- Reservaciones (`reservations:write`).
- Contexto antes de transferir (`call-context:write`).
- Lectura/escritura de contactos, citas y tratos según la clave y scopes.

Cada herramienta debe usar una clave API exclusiva, revocable y con el
menor permiso necesario.

## 5. Transferencia y contexto

El agente debe guardar el contexto **antes** de transferir. En modo API de
Yeastar, la herramienta realiza las dos acciones como una sola operación y
solo debe darla por correcta si NexoOmni responde:

```json
{"data":{"saved":true,"transferred":true}}
```

NexoOmni verifica en tiempo real el `call_id` y `channel_id` mediante la API de
Yeastar. Si existen dos llamadas compatibles, o no se recibe un canal entrante
único, no transfiere ninguna para evitar mover una llamada equivocada.

En modo API, el contexto queda guardado aunque Yeastar rechace la transferencia;
el agente informa el fallo y no afirma que la persona ya está conectada. El
modo SIP conserva el traspaso del proveedor de voz y devuelve
`transferred: false` porque ElevenLabs completa esa segunda etapa después.

## 6. Validar

Realiza como mínimo estas pruebas:

1. Llamada normal con una pregunta respondida por la base de conocimiento.
2. Contacto nuevo y contacto existente.
3. Interrupción del agente.
4. Ruido de fondo y números deletreados.
5. Solicitud explícita de hablar con una persona.
6. Destino ocupado.
7. Datos que la IA no conoce.
8. ElevenLabs sin respuesta.
9. Herramienta NexoOmni rechazada o con timeout.
10. Dos llamadas simultáneas.
11. Audio entrante y saliente.
12. La frase del cliente aparece durante la llamada y la respuesta final se
    reconcilia al colgar.
13. En modo API de Yeastar, la cola interna recibe la llamada sin cortar al
    cliente, y el contexto aparece al agente que responde.
14. Si hay dos llamadas simultáneas del mismo número, ninguna transferencia se
    ejecuta hasta que exista una coincidencia única.

Solo activa la recepcionista después de aprobar estas pruebas.

## Respaldo

NexoOmni mantiene tres capas:

1. **Modelo**: ElevenLabs cambia automáticamente a un modelo de respaldo.
2. **Voz/agente**: si una herramienta falla, el agente explica el problema
   y transfiere; nunca inventa el resultado.
3. **Telefonía**: Yeastar debe mantener una ruta humana si ElevenLabs o SIP
   no responden. Esta tercera capa es obligatoria.

Si el LLM personalizado de NexoOmni deja de responder, ElevenLabs intenta su
cascada de respaldo. La transcripción final firmada sigue funcionando. Si
ElevenLabs o la troncal SIP fallan, Yeastar debe enrutar a una persona o IVR.

## Preguntas frecuentes

**¿Se usa ChatGPT, Claude o ElevenLabs?**

ElevenLabs procesa voz, turnos y texto a voz. NexoOmni mantiene un modelo
principal gestionado internamente y el fallback configurado en ElevenLabs,
que incluye proveedores alternativos. La identidad del modelo no se muestra
al cliente final.

**¿La transcripción en vivo funciona sin ElevenLabs Enterprise?**

Sí, en modo por turnos confirmados. El texto aparece durante la llamada, una
vez que ElevenLabs confirma que terminó la frase. La visualización de palabras
tentativas mientras la persona sigue hablando requiere Enterprise.

**¿Por qué usar la API de Yeastar para transferir?**

Evita depender de que el PBX acepte una solicitud `REFER` iniciada por
ElevenLabs. Yeastar controla directamente su propio canal activo, mientras
NexoOmni correlaciona primero la extensión virtual con el número del cliente.

**¿Qué pasa si ElevenLabs no responde?**

El respaldo completo debe configurarse en Yeastar con failover a una persona
o IVR. NexoOmni no puede recuperar audio si la conexión SIP falla antes de
establecerse.

## Ver también

- [Contexto y transferencias de IA](./contexto-y-transferencias-ia.md)
- [Reservaciones por teléfono](./reservaciones-por-telefono.md)
- [Transcripción y análisis de llamadas](../supervision-y-reportes/transcripcion-de-llamadas.md)
- [Base de conocimiento](../agentes-ia/base-de-conocimiento.md)
- [Claves API](../integraciones/claves-api.md)
