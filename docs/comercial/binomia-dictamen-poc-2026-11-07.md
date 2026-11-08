# BINOMIA + NexoOmni: dictamen de viabilidad de la PoC

**Fecha:** 7 de noviembre de 2026  
**Base:** propuesta de alcance de BINOMIA recibida el 7 de noviembre, Excel
de actividades compartido previamente, documentación y código local de
NexoOmni, y documentación pública de proveedores.  
**Estado:** evaluación técnica preliminar; no es aceptación contractual ni
prueba en el entorno del cliente.

## 1. Decisión ejecutiva

**Sí podemos iniciar la preparación y las pruebas técnicas de la PoC, pero no
conviene iniciar todavía el desarrollo completo ni comprometer un alcance,
fecha o integración definitiva.** La propuesta ya define el recorrido
principal y permite ejecutar pruebas con datos ficticios. Aún faltan decisiones
que afectan al diseño, permisos y aceptación, especialmente la selección de
los tres restaurantes, la operación de Google, la atribución por QR y la
separación de información.

El cliente **no exige necesariamente integración de Google desde el primer
día**: pide demostrar la gestión y explorar si puede responderse desde
NexoOmni; acepta proponer un proceso manual temporal si no está disponible.
Eso no significa que haya aprobado todavía un procedimiento concreto ni que
la integración sea inviable.

**Hallazgo importante:** la documentación oficial de Zernio sí describe
conectar Google Business Profile y consultar y responder reseñas. Sin embargo,
el conector actual de NexoOmni solo declara WhatsApp, Facebook e Instagram;
por tanto, **usar Google desde NexoOmni mediante Zernio requiere integración
adicional y prueba real**. La revisión de documentación pública no equivale
a una confirmación de soporte ni a verificar la cuenta contratada.

**Prioridades del cliente:** Google Reseñas, una línea central de WhatsApp y
QR diferenciados. Para cada una se necesita distinguir lo que anuncia un
proveedor, lo que implementa NexoOmni y lo que se prueba con las cuentas
reales. La documentación pública no confirma que la cuenta contratada,
licencias o accesos actuales estén habilitados.

### Qué podemos iniciar sin esperar

1. Preparar ambiente de prueba autorizado y datos ficticios; no conectar
   cuentas ni enviar mensajes reales sin permiso.
2. Diseñar los escenarios de extremo a extremo y probar en local la captura,
   asignación, seguimiento, permisos y reportes existentes.
3. Preparar una maqueta de operación manual de Google y los registros que
   puedan usarse conforme a las políticas aplicables.
4. Probar dos enlaces/QR de prueba con la misma línea y el bot, una vez se
   tenga un número autorizado. Documentar la atribución real.
5. Solicitar la información y autorizaciones de la sección 5 y, si se quiere
   integración de Google, revisar sus requisitos de acceso y políticas.

**No aprobado todavía:** implementación de un nuevo modelo de casos o
permisos, integración de Google, automatización de límites o diseño definitivo
de indicadores. Requieren las decisiones y pruebas indicadas abajo.

## 2. Alcance acordado y no acordado

| Tema | La respuesta del cliente indica | Sigue abierto |
|---|---|---|
| Restaurantes | PoC inicial con tres de seis, con perfiles operativos distintos; selección con Carlos. | Nombres, fichas, responsables y secuencia para llegar a seis. |
| Canales | WhatsApp, mensajes y comentarios de Facebook/Instagram y Google; Google es prioritario. | Accesos, activos y eventos disponibles por cada restaurante; validación en cuentas reales. |
| WhatsApp y QR | Una línea para seis, enlaces diferenciados, evitar preguntar de nuevo si ya se identificó el origen. | Si la atribución automática es obligatoria o si aceptarían preguntar ante falta de origen; reglas para visitas repetidas o errores. |
| Bot | Hasta tres preguntas: nombre, restaurante y motivo; sin IA de voz ni automatizaciones complejas. | Guion, captura por caso, excepción cuando origen ya es conocido y comportamiento cuando se abandona el flujo. |
| Horarios | Lun–vie 09:00–18:00; sábado 09:00–14:00; domingos/festivos sin atención humana. | Cliente debe confirmar horario, zona horaria, festivos y protocolo para críticos fuera de horario. |
| Escalamiento | Cuatro niveles, responsable, aviso, acuse, segundo escalamiento cuando aplique, registro y cierre. | Tiempos, destinatarios, suplentes, canal de aviso, reglas de segundo escalamiento y cobertura. |
| Teléfono | 200 **marcaciones mensuales para los seis**, incluidas no contestadas; solo salientes. | Si hay bloqueo obligatorio, fecha de corte, excepciones y fuente confiable de todos los intentos. |
| Encuestas | Una campaña mensual, máximo dos cuestionarios y resultados por restaurante. | Canal, preguntas, permisos, universo, definición de campaña y automatización necesaria. |
| Reportes | Control, semanal y mensual, por restaurante y consolidado; se identificará qué es directo y qué es manual. | Métricas exactas, unidad de conteo, fórmulas, fuentes, muestras y aceptación de consolidación manual. |
| Aceptación | Evidencia del recorrido, limitaciones y ajustes, con énfasis en Google, WhatsApp y QR. | Casos mínimos, resultados medibles, aprobadores, duración de PoC y excepciones permitidas. |
| Fecha | Objetivo 1 de diciembre de 2026 sujeto a validación. | Si corresponde al inicio de PoC o al arranque del servicio y qué debe estar listo ese día. |

## 3. Revisión de NexoOmni y brechas por requisito

**Leyenda:** existente = hay evidencia de código/manual, no de producción;
configuración = requiere prueba; manual = alternativa humana pendiente de
aprobación; desarrollo = necesario para el comportamiento indicado si no se
acepta otra alternativa; por validar = evidencia insuficiente.

| Requisito | Evaluación | Evidencia y siguiente paso |
|---|---|---|
| WhatsApp centralizado | **Existente/configuración.** Hay conexión guiada y nativa y bandeja. | [Conexión WhatsApp](../manuals/primeros-pasos/conexion-whatsapp.md). Validar propiedad y número, compatibilidad del alta, credenciales, envío, recepción, plantillas y permisos en el ambiente autorizado. |
| Bot por Zernio | **Base existente; comportamiento exacto por validar.** | El [webhook de Zernio](../../src/app/api/omnichannel/zernio/webhook/route.ts) despacha eventos a flujos y automatizaciones y el [editor](../../src/components/flows/flow-builder.tsx) ofrece `zernio_whatsapp`. El código es evidencia más reciente que la afirmación de la presentación de que los flujos son solo nativos. Probar preguntas, transferencia y mensajes en cuenta real. |
| Datos capturados por el bot | **Parcial/por validar.** | El [motor](../../src/lib/flows/engine.ts) guarda entradas en variables de ejecución; esto no demuestra que queden como campos de un caso, que el asesor los vea donde necesita o que sirvan para informes. Probar y desarrollar si hace falta. |
| QR de restaurante | **Por validar; desarrollo posible.** | Un QR puede apuntar a un enlace, pero no se ha demostrado una atribución estructurada y confiable del restaurante. Ensayar mensaje prellenado por enlace y su recepción; el usuario puede modificarlo o no enviarlo. No tratar ese texto como identidad autenticada. Confirmar fallback y cambio de restaurante. |
| Fuera de horario | **Parcial/por validar.** | Existe plantilla de automatización y [condición `time_of_day`](../../src/lib/automations/engine.ts) basada en la hora del proceso; por sí sola no demuestra calendario por días, zona horaria del negocio ni festivos. El bot corre antes que automatizaciones en el webhook, por lo que se debe comprobar que fuera de horario solo salga el aviso aprobado. Si configuración no cumple, requiere corrección o control manual aprobado. |
| Facebook e Instagram | **Existente/configuración.** | [Manual de canales](../manuals/primeros-pasos/conexion-facebook-instagram.md); el webhook procesa `comment.received` y [envío Zernio](../../src/app/api/omnichannel/zernio/send/route.ts) responde comentarios. Depende de permisos, eventos, IDs y cuentas; probar mensajes y comentarios por canal. |
| Google Reseñas | **Zernio documenta lectura y respuesta; NexoOmni aún no las integra.** Manual temporal o desarrollo mediante Zernio, sujetos a aprobación y prueba. | Google Calendar no es Google Business Profile. [Canales Zernio de NexoOmni](../../src/lib/zernio/server.ts) declara solo WhatsApp, Facebook e Instagram. No asegurar respuesta desde NexoOmni hasta probar una integración concreta. |
| Casos por restaurante e historial | **Parcial/por validar; desarrollo posible.** | Hay conversaciones, notas, asignación, tareas y campos de contacto; no se ha demostrado un caso independiente por interacción y restaurante. Probar un mismo comensal con dos restaurantes y varias incidencias sin sobrescritura. |
| Clasificación, acuse y segundo escalamiento | **Operación manual posible; automatización completa no demostrada.** | Definir catálogo, responsables, acuse, tiempos, sucesión y contingencia. Una asignación o nota no demuestra escalamiento temporizado ni acuse externo. |
| Permisos por restaurante | **Bloqueador de acceso directo si se exige separación estricta.** | El aislamiento por cuenta está respaldado por [políticas de conversaciones](../../supabase/migrations/123_conversation_role_scoped_access.sql); no se ha demostrado aislamiento completo por restaurante dentro de una cuenta. Probar UI, API y RLS; hasta entonces no conceder acceso a datos ajenos. |
| Telefonía y 200 marcaciones | **Llamadas por Yeastar existentes si está habilitado; contador específico no demostrado.** | [NexPhone](../manuals/telefonia/nexphone-softphone.md). Registrar contestadas y no contestadas, incluyendo encuestas; decidir control manual o desarrollo de contador/bloqueo. No confundir intentos con minutos. |
| Encuestas | **No se ha demostrado módulo estructurado específico.** | Una difusión o flujo no garantiza consolidación por restaurante. Probar alternativa manual o externa autorizada; si se requiere integración, definir alcance antes de construirla. |
| Reportes | **Parciales y sujetos a conciliación.** | [Reporte ejecutivo](../manuals/supervision-y-reportes/reportes-ejecutivos.md) tiene métricas generales; dimensiones de casos, reseñas y encuestas por restaurante no están demostradas. Sus métricas de llamadas se refieren a llamadas con transcripción: no deben usarse como total de marcaciones. |
| Cambios de asesor | **Asignación e historial existentes; probar continuidad.** | [Historial de asignación](../../supabase/migrations/110_conversation_assignment_history.sql). Probar continuidad de contexto, tareas, respuesta del restaurante y permisos al cambiar de agente. |

**Restricción WhatsApp en el código:** el [envío Zernio](../../src/app/api/omnichannel/zernio/send/route.ts) comprueba la ventana para texto libre de WhatsApp y valida plantillas. Para seguimientos fuera de ventana, confirmar y probar una plantilla aprobada aplicable; no prometer que cualquier mensaje libre se puede enviar en cualquier momento.

## 4. Zernio y Google: posibilidades y restricciones

### 4.1 Zernio: contraste de proveedor frente a NexoOmni

| Capacidad | Documentación pública de Zernio | NexoOmni y validación pendiente |
|---|---|---|
| WhatsApp | [Comparativa de plataformas](https://docs.zernio.com/platforms/compare): mensajes y uso de plantillas fuera de ventana. | Hay conector y despacho a flujos; comprobar número, permisos, plantillas y prueba de envío/recepción. |
| Facebook e Instagram | [Comparativa](https://docs.zernio.com/platforms/compare) y [eventos de inbox](https://docs.zernio.com/webhooks/inbox) documentan mensajes y comentarios. | Hay recepción de eventos y respuesta a comentarios; comprobar mensajes y comentarios reales de cada cuenta, permisos y contenido permitido. |
| Google Business Profile | [Guía de Google de Zernio](https://docs.zernio.com/platforms/google-business) documenta conexión OAuth, selección de ubicación y cuenta conectada por ubicación. | El conector de NexoOmni no admite `googlebusiness` en su lista actual. Ampliar conexión y asociación a restaurante exige desarrollo y pruebas. |
| Consulta y respuesta de reseñas | [Guía de reseñas de Zernio](https://docs.zernio.com/platforms/google-business/inbox) describe listado, filtros, respuesta y reseñas de varias ubicaciones. | No hay interfaz ni rutas de reseñas de Google demostradas en NexoOmni. Implementar consulta/respuesta autorizada, gestión de errores y seguimiento, sujeto a políticas y aprobación. |
| Eventos de reseñas | Zernio documenta `review.new`, `review.updated`, `review.deleted` y `review.restored` en su [inbox](https://docs.zernio.com/webhooks/inbox). | El webhook actual no demuestra procesamiento de estos eventos; sería necesario adaptarlo y probar reentregas, cambios, eliminaciones y conciliación. No inferir disponibilidad en la cuenta contratada. |
| Plan y disponibilidad | Zernio indica que reseñas y eventos asociados requieren acceso a inbox en sus [eventos](https://docs.zernio.com/webhooks/inbox). | Confirmar plan contratado, habilitación, límites y precio para tres y seis ubicaciones; no se consultaron credenciales, facturación ni soporte. |

El [listado de reseñas de Zernio](https://docs.zernio.com/reviews/list-inbox-reviews)
advierte de un presupuesto de 20 segundos por solicitud, posibles resultados
truncados en cuentas grandes y caché de hasta 60 segundos. Diseñar pruebas de
paginación, completitud y conciliación; no asumir monitoreo inmediato ni
integridad perfecta solo por tener un webhook.

Para las redes, la [guía de Instagram de Zernio](https://docs.zernio.com/platforms/instagram/inbox)
documenta que la carpeta de solicitudes de mensajes no se puede listar por su
API. Confirmar con el proveedor cómo operará BINOMIA ese tipo de mensajes y
no garantizar que todas las solicitudes aparecerán en la bandeja. La
[documentación de WhatsApp](https://docs.zernio.com/platforms/whatsapp)
exige una cuenta de WhatsApp Business y describe distintas condiciones de
alta; confirmar con el titular del número cuál aplica antes de conectarlo.

**Alcance de esta validación:** se consultaron fuentes públicas; no se
contactó al soporte de Zernio, no se verificó la suscripción actual ni se
conectaron fichas. Para confirmación comercial/técnica solicitar a Zernio:
(1) acceso real a Google y al inbox; (2) conexión de las tres o seis ubicaciones y
tarifas; (3) permiso de respuesta y eventos en el plan contratado; (4)
requisitos de permisos y limitaciones para agencias y cuentas de distintos
propietarios; (5) comportamiento de paginación, reconciliación y eventos; y
(6) aplicación de las políticas de Google al almacenamiento y reportes;
(7) tratamiento de solicitudes de Instagram no listables.
La documentación no resuelve estas condiciones de la cuenta concreta.

### 4.2 Google: API oficial y políticas

La [documentación oficial de Google](https://developers.google.com/my-business/content/review-data)
describe consultas por ubicación y respuestas a reseñas mediante su API.
Esto confirma una **posibilidad técnica de la API de Google**, no que
NexoOmni ya esté integrado ni que se tenga acceso aprobado.

Google exige, entre otros requisitos, proyecto y solicitud de acceso; su
[guía de prerrequisitos](https://developers.google.com/my-business/content/prereqs)
indica un perfil verificado y activo por al menos 60 días y un sitio web
del negocio para el solicitante. Hay que comprobar elegibilidad, aprobación,
propiedad y permisos de las tres fichas. Para avisos de nuevas reseñas,
Google documenta [notificaciones mediante Cloud Pub/Sub](https://developers.google.com/my-business/content/notification-setup);
no se presupone que sean necesarias para una PoC manual.

**Punto crítico antes de diseñar el almacenamiento y tablero:** las
[políticas de Google Business Profile](https://developers.google.com/my-business/content/policies)
exigen autorización para responder en nombre del cliente y establecen
restricciones para uso automatizado y almacenamiento de contenido obtenido
por la API, incluyendo condiciones de temporalidad y prohibición de
manipular o agregar contenido almacenado bajo esas condiciones. Revisar la
aplicación exacta a textos de reseñas, históricos, analítica y reportes con
el responsable de cumplimiento y Google **antes de prometer persistencia o
agregación**. No asumir que una integración de tercero elimina estas reglas.

| Alternativa | Qué demuestra | Decisión pendiente |
|---|---|---|
| A. Fichas oficiales + registro operativo manual | Una persona autorizada consulta y responde en Google; registra seguimiento y elabora evidencia conforme a políticas. | Cliente confirma que acepta esta demostración, frecuencia de revisión, responsables y contenido que puede registrarse. |
| B. Integración mediante Zernio | Zernio documenta conexión, listado, respuesta y eventos de reseñas; NexoOmni tendría que integrar esas capacidades. | Verificar permisos reales de cada ficha, plan, costos, políticas y desarrollar conexión, interfaz, eventos y seguimiento. |
| C. Integración directa Google–NexoOmni | Podría permitir consultar y responder desde NexoOmni tras desarrollo, autorización y pruebas. | Confirmar elegibilidad y acceso API, autorización del titular, políticas, arquitectura, costos y plazo. |

## 5. Preguntas pendientes antes de comprometer desarrollo

### Decisiones que afectan directamente al diseño

1. **¿Cuáles son los tres restaurantes elegidos y quién autoriza y administra
   sus cuentas de WhatsApp, Facebook, Instagram y fichas de Google?** ¿Hay
   cuentas de prueba o se autoriza usar activos reales?
2. **¿Aceptan formalmente la opción A de Google para la PoC?** Si no, ¿es
   indispensable consultar y responder desde NexoOmni desde el primer día?
   ¿Qué evidencia y qué reporte consideran suficientes?
3. **Si el QR no identifica el restaurante con certeza, aceptan que el bot o
   asesor lo pregunte?** ¿Qué sucede si el comensal edita el mensaje, ya
   tiene una conversación abierta o visita después otro restaurante?
4. **¿Los restaurantes tendrán acceso directo a NexoOmni?** ¿Deben ver
   únicamente sus propios casos y contactos, o solo BINOMIA tendrá acceso y
   compartirá reportes? Definir responsables de autorización.
5. **¿Cómo se reconocen y relacionan varios casos del mismo comensal para
   distintos restaurantes?** ¿Cada visita, queja o reseña debe tener un
   identificador e historial independiente?
6. **¿Cuáles son los tiempos de cada nivel, quién recibe, quién confirma el
   acuse, cuándo procede un segundo escalamiento y por qué medio?** ¿Qué
   ocurre ante falta de respuesta y fuera de horario?
7. **¿Aceptan un control manual de las 200 marcaciones durante la PoC?** Si
   no, ¿se bloquea el intento 201, quién autoriza excepciones y cuál es la
   fuente que registra intentos no completados?
8. **¿Qué encuestas, canales y permisos se usarán?** ¿Aceptan captura o
   consolidación externa temporal y quién autoriza la herramienta?
9. **¿Qué métricas y fórmulas se requieren por restaurante y consolidado?**
   Precisar qué cuenta como interacción/caso, inicio y fin de tiempos,
   estados, fuentes, muestras y si se acepta consolidación manual.
10. **¿Cuáles son las pruebas mínimas para aprobar la PoC, quién firma, cuándo
    inicia y cuánto dura?** ¿Qué significa el objetivo de 1 de diciembre?

### Datos necesarios para configurar

- Horario confirmado, zona horaria, festivos, guiones y políticas de
  reservaciones/compensaciones de cada restaurante.
- Responsables y suplentes por establecimiento, turnos y medios de contacto.
- Autorización de titulares para conexiones y respuestas; aviso de privacidad,
  permisos de contacto, ambiente, datos de prueba y reglas de conservación.
- Número de agentes, volúmenes estimados y concurrencia; responsable de
  costos de canales, telefonía e integraciones.
- Accesos entregados por un medio seguro, sin contraseñas en este documento.

## 6. Pruebas de viabilidad y puertas de salida

| Prueba | Resultado mínimo a observar | Bloqueo si falla |
|---|---|---|
| WhatsApp y QR | Dos QR/enlaces dirigen a la misma línea; para cada uno registrar mensaje recibido y establecimiento correcto, sin pedirlo de nuevo cuando se identificó con certeza. Repetir con mensaje editado y mismo contacto en otra sucursal. | Acordar fallback o diseñar atribución; no prometer automatización. |
| Bot y horarios | Máximo tres preguntas; transferencia y datos visibles en horario; solo aviso fuera de horario; sábado, domingo y festivo; pendientes recuperables. | Definir corrección o procedimiento temporal y aprobarlo. |
| FB/IG | Mensaje y comentario por canal y cuenta: recepción, respuesta pública correcta, trazabilidad y error visible. | Corregir permisos/eventos o aplicar proceso manual aceptado. |
| Google | Cuatro escenarios propuestos por cliente: positiva, negativa, incidencia relevante y seguimiento; respuesta autorizada, responsable, estado y reporte por restaurante, usando fuente permitida. | Acordar operación manual o acceso/integración antes de prometer funcionalidad. |
| Caso y cambio de asesor | Dos incidencias para el mismo contacto y distintos restaurantes, escalamiento, acuse, transferencia, resolución e historial correcto. | Definir modelo de caso y permisos antes de construir. |
| Seguridad | Usuarios no autorizados no acceden a datos ajenos; probar interfaz, servidor y RLS con los roles acordados. | No habilitar acceso directo hasta cumplir. |
| Llamadas y encuestas | Contar intentos exitosos y fallidos de todos los restaurantes, incluyendo encuesta; demostrar 199/200/201 según política aprobada. Consolidar dos cuestionarios como máximo. | Aprobar control manual o desarrollar y validar contador/encuesta. |
| Informes | Conciliar una muestra de control, semanal y mensual contra los casos, llamadas, reseñas y encuestas permitidas; indicar fuente y trabajo manual. | Ajustar modelo o reporte y no declarar cobertura total. |

**Puerta de inicio de desarrollo:** decisiones 1–10 resueltas o explícitamente
acotadas; acceso autorizado; responsable funcional; criterios de aceptación
y tratamiento de datos aprobados. Se puede adelantar investigación y pruebas
sin convertir supuestos en compromisos.

## 7. Propuesta de trabajo para el equipo de desarrollo

No ejecutar estos cambios como alcance aprobado sin resolver las decisiones
anteriores; el orden sirve para estimar y evitar trabajo especulativo.

1. **Demostración técnica inicial:** configurar cuenta autorizada y revisar
   los flujos existentes, recepción/respuesta de WhatsApp, FB/IG y atribución
   de QR. Registrar fallas y evidencias antes de escribir cambios.
2. **Caso y restaurante:** tras confirmar privacidad, decidir estructura de
   caso independiente, vínculo al restaurante y canal, estados, clasificación,
   responsables e historial; validar que soporte un comensal con distintos
   restaurantes. Diseñar autorizaciones de servidor y RLS para el nivel de
   separación acordado, además de migraciones nuevas y pruebas negativas.
3. **Google con Zernio, solo si se elige integración:** ampliar conexión por
   ubicación, asociarla con el restaurante correcto, consultar y responder
   reseñas con autorización, manejar eventos de creación/cambio/eliminación
   y reconciliación; construir la interfaz y seguimiento acordados. Antes de
   almacenar texto o agregar información revisar límites de política y
   retención; probar errores de acceso, revocación, duplicados y paginación.
4. **Escalamiento y horario:** validar si la configuración puede cumplir;
   solo si no, diseñar calendario de negocio, festivos, prioridades, acuses y
   escalamiento sucesivo conforme a los tiempos aprobados. Probar también el
   orden entre bot y automatizaciones.
5. **Llamadas, encuestas e informes:** decidir qué queda manual, qué requiere
   integración y qué es nativo; diseñar control de intentos y cálculo de
   métricas solo después de conocer las fuentes y reglas aprobadas.

Todo desarrollo deberá seguir la [guía de prácticas](../development-practices.md):
roles jerárquicos, controles de servidor y RLS, migraciones nuevas, textos
localizados, manuales y pruebas. Ninguna estimación o fecha de entrega se ha
validado en este dictamen.

## 8. Fuentes internas

- [Requisitos y validación de la PoC original](./poc-binomia-restaurantes-requerimientos.md).
- [Preguntas para la reunión](./reunion-binomia-preguntas-poc.md).
- [Guía de desarrollo](../development-practices.md).

La información del cliente recibida el 7 de noviembre se utilizó para este
dictamen y no se compartió con los proveedores durante la investigación de
documentación pública.
