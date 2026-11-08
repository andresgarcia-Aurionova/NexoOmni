# BINOMIA + NexoOmni: requisitos y validación de la prueba de concepto

**Fecha de análisis:** 6 de noviembre de 2026  
**Destinatarios:** BINOMIA, responsables de los restaurantes, equipo comercial y agente de desarrollo  
**Estado:** propuesta de análisis; ningún requisito se considera aceptado hasta probarlo y obtener la aprobación correspondiente.

## 1. Objetivo y conclusión ejecutiva

Preparar una prueba de concepto (PoC) representativa del centro de atención
centralizado para seis restaurantes, y decidir, requisito por requisito, qué
se puede cubrir con configuración, qué requiere operación manual y qué
necesitaría desarrollo o una integración adicional.

**Conclusión:** NexoOmni aporta una base relevante para mensajería, atención
compartida, seguimiento, telefonía con Yeastar y reportes. **No se ha demostrado
que la configuración por sí sola cubra todo el Excel**. Una PoC puede acercarse
mucho al alcance mediante una combinación de NexoOmni, procesos humanos y
herramientas externas autorizadas. Para operar todo dentro de NexoOmni de
manera automatizada y con controles verificables, existen brechas que
probablemente requieren desarrollo o integración, en particular casos por
establecimiento, encuestas, Google y métricas específicas.

No se han probado las conexiones reales, licencias, permisos, datos,
configuraciones, migraciones ni servicios del cliente. Las afirmaciones de
este documento se basan en la revisión del repositorio, no en una certificación
del ambiente productivo. **Ninguna clasificación sustituye una prueba.**

### Fuentes y precedencia propuesta

1. **Fuente principal:** libro `BINOMIA_Actividades_Externo_Interno_Plantilla.xlsx`
   proporcionado por el cliente, hojas **Externo** e **Interno**. Las referencias
   `E` e `I` en las tablas indican hoja y número de fila real, no número de
   requisito. Incluimos también las actividades comerciales y operativas que
   no son funciones de software.
2. **Contexto visual:** cinco imágenes BINOMIA compartidas: Villa Rica, IA,
   centro de atención, ranking y manejo de crisis. Son propuestas visuales,
   no evidencia de funcionamiento de la plataforma ni datos verificados de
   los restaurantes.
3. **Capacidades de NexoOmni:** código, migraciones, manuales y
   [presentación comercial](./presentacion-nexoomni.html) del repositorio
   revisado; referencia Git `f50f681`, rama `main`. El estado desplegado puede
   diferir.

**Propuesta para resolver diferencias:** tomar el Excel como alcance contractual
provisional y solicitar confirmación del cliente. En particular:

| Tema | Excel | Imágenes | Tratamiento para esta PoC |
|---|---|---|---|
| Horario | Lunes a viernes 09:00–18:00; sábado 09:00–14:00; festivos y domingo sin atención humana. | Una lámina indica lunes a sábado 09:00–18:00. | Usar Excel hasta autorización expresa de otro horario. Confirmar zona horaria y calendario de festivos. |
| Bot e IA | Bienvenida **básica**, máximo tres interacciones: nombre, restaurante y motivo. | Propone IA escrita 24/7, clasificación y voz. | No ampliar a IA autónoma ni a voz IA. Fuera de horario, únicamente mensaje informativo; priorizar transferir a humano. |
| Escalamiento | Cuatro niveles; nivel 4 inmediato **dentro del horario**. | Tres colores y respuesta de queja ≤10 min / crisis ≤5 min. | No prometer esos minutos ni cobertura de crisis 24/7; tiempos y responsables se deben aprobar antes del arranque. |
| Canales | WhatsApp, Facebook, Instagram y Google; telefonía solo saliente. | También aparece X, y algunas imágenes sugieren QR de encuesta. | X está fuera del Excel. QR/enlace debe identificar origen; encuesta por QR y X requieren aprobación como ampliación. |
| Encuestas | Una campaña mensual, máximo dos tipos; las llamadas cuentan entre las 200 marcaciones. | Una lámina menciona hasta dos tipos y WhatsApp/llamada. | Mantener el límite del Excel y confirmar el canal de encuesta y el universo de contactos. |
| Establecimientos | Seis nombres definidos en E6. | Una lámina usa Villa Rica como ejemplo y otra presenta un ranking. | Trabajar los seis de E6. No presentar el ejemplo, estrellas, número de reseñas ni tickets de la imagen como datos actuales verificados. |

### Leyenda de dictamen

- **C — Configuración candidata:** existe una base en NexoOmni; debe probarse
  con el canal y el entorno concretos.
- **M — Manual/operativo:** lo cubren personas o una herramienta aprobada,
  con evidencia y controles; no significa que exista automatización nativa.
- **D — Desarrollo o integración:** necesario si se exige que la capacidad o
  el control sea automático/integrado como se describe. Puede haber un
  sustituto manual temporal si el cliente lo acepta.
- **V — Validar/decidir:** faltan evidencia, permiso, definición o prueba para
  concluir. No equivale a “no existe”.
- **Fuera:** no está dentro del alcance del Excel o está expresamente excluido.

Una misma fila puede necesitar varias vías. Los estados de la columna
«Seguimiento» del libro indican **Pendiente** para las actividades; estos
dictámenes no cambian su estado ni afirman que ya se cumplieron.

## 2. Diseño recomendado para la PoC

### 2.1 Alcance y arquitectura de trabajo

- Seis establecimientos: **Cueva de Lobos, Tabgha, Jalapeños Pop, Metz,
  A Dios le Pido y Corazón Partido**. Confirmar nombres comerciales,
  sucursales y responsables antes de cargar información.
- Probar primero **una cuenta NexoOmni compartida** con una línea oficial
  de WhatsApp, agentes de BINOMIA, un catálogo controlado de restaurantes,
  motivos y cuatro niveles. Configurar y probar por separado las conexiones
  de Facebook e Instagram autorizadas de cada establecimiento.
- Registrar un **caso por interacción que requiera seguimiento**, no asumir
  que un contacto o conversación equivale siempre a un restaurante o caso.
  Probar si los campos, etiquetas, notas, tareas y/o pipeline permiten capturar
  cada visita y seguimiento sin sobrescribir datos. Si no, usar temporalmente
  un registro externo controlado; una etiqueta en el contacto no es prueba de
  historial por caso.
- La cuenta compartida facilita una vista central, pero **no demuestra
  aislamiento por restaurante**. Hasta probar permisos y RLS, no dar acceso
  directo a la cuenta a cada restaurante si no debe ver información de los
  demás. Alternativa: cuentas separadas, con consolidación externa y prueba de
  acceso de agentes; no se ha demostrado un tablero nativo entre cuentas.
  El cliente debe decidir el nivel de aislamiento.
- Google se plantea inicialmente como **atención manual en las fichas
  autorizadas**, con registro y resumen en el control de casos. No se encontró
  un conector demostrado de Google Business Profile/reseñas; Calendar no
  equivale a ese producto. Para sincronización, respuesta y medición
  integradas: **D/V**, sujeto a permisos, API y validación de proveedor.
- Para encuestas, usar provisionalmente un cuestionario externo aprobado o
  captura telefónica/manual con identificador de restaurante y consolidación
  verificable. Un flujo conversacional o una difusión no demuestra por sí solo
  un módulo de encuestas ni métricas de satisfacción.
- Telefonía: llamadas **salientes realizadas por personal** con NexPhone y
  Yeastar si están habilitados, más bitácora de intentos. El Excel limita
  **marcaciones**, incluso las no contestadas, no minutos ni llamadas exitosas.
  No se encontró un marcador de campañas telefónicas ni un tope automático
  de 200 intentos para este caso. Bloqueo automático y contador confiable:
  **D/V**. Mientras tanto, control manual aceptado y conciliado.
- Una herramienta externa, una hoja o un procedimiento manual **no son
  nativos**. Su uso requiere responsable, autorización, acceso restringido,
  respaldo, revisión de integridad, manejo de fallos y decisión del cliente
  sobre qué fuentes se aceptan como registro oficial.

### 2.2 Datos mínimos por caso

Definir y validar antes de implementar: identificador único de caso, fecha y
hora de recepción, canal, establecimiento, datos de contacto disponibles,
motivo, nivel 1–4, responsable de BINOMIA, responsable del restaurante,
estatus, comunicación/enlace de escalamiento, respuesta autorizada, fecha y
hora de última actualización y cierre. Registrar intentos de llamada y
resultado cuando corresponda. Para encuesta: campaña, versión de cuestionario,
establecimiento, fecha, respuestas y autorización aplicable.

No exigir teléfono cuando el canal no lo proporcione. No suponer que un mismo
comensal en dos redes está identificado automáticamente: validar identidad y
fusión. Registrar datos de manera proporcional; evitar recopilar datos
sensibles innecesarios. Un incidente de salud o seguridad se escala al
responsable humano conforme al protocolo aprobado, sin diagnóstico ni promesa
de resolución automática. Privacidad, aviso, autorizaciones, conservación,
derechos de los titulares y reglas de contacto requieren revisión y
aprobación del cliente y sus asesores; este documento no sustituye asesoría
legal.

## 3. Trazabilidad completa: hoja Externo

Las filas de título se identifican junto con sus actividades. Cada renglón
agrupado conserva todos los puntos indicados del libro; no se presume que
las categorías o ejemplos de la presentación amplíen el contrato.

| Excel | Requisito o necesidad a comprobar | Vía | Validación / brecha |
|---|---|---|---|
| E5–6 | Ficha y seis establecimientos nombrados. | M/C | Cliente confirma catálogo, nombres, responsables y datos; cargar y probar cada uno. |
| E7 | WhatsApp Business, Facebook, Instagram y Google. | C/M/D | Probar cada conexión autorizada; Google manual o integración por validar. |
| E8–9 | Horario del Excel y atención centralizada con recursos compartidos. | M/C/V | Configurar agentes, turnos y mensaje fuera de horario; validar calendario, festivos y cobertura. |
| E10 | Telefonía solo saliente; hasta 200 marcaciones mensuales. | C/M/D | Probar llamadas y bitácora de **todos los intentos**; límite conjunto o por restaurante pendiente de confirmar. Tope automático no demostrado. |
| E11 | Bot de bienvenida estrictamente básico. | C/V | Probar el flujo exacto en línea compartida; no habilitar respuestas autónomas adicionales. |
| E12 | Cuatro niveles de atención y canalización. | M/C/D | Catálogo, responsables y procedimiento; temporizadores y control integral por caso no demostrados. |
| E13 | Una campaña mensual; máximo dos tipos de cuestionario. | M/D | Controlar campaña, versiones y resultados manualmente o integrar encuestas. |
| E14 | Control operativo, seguimiento semanal e informe mensual. | C/M/D | Comparar reportes existentes con dimensiones de E152–169; complementar datos faltantes. |
| E15 | Inicio previsto el 1 de diciembre de 2026. | M | Es objetivo, no compromiso confirmado; sujeto a liberación. |
| E16–17 | Objetivo: centralizar atención de los seis. | C/M/V | Demostrar una operación compartida y la identificación correcta de cada establecimiento. |
| E18 | Recibir consultas, reservaciones, quejas, sugerencias y felicitaciones. | C/M | Probar cada motivo en cada canal habilitado y documentar recepción. |
| E19–20 | Identificar restaurante y motivo; clasificar y registrar interacciones. | C/M/D | Probar captura por **caso**, catálogos y consistencia; complementar si campos de contacto no preservan historial. |
| E21–23 | Atención inicial con información autorizada, canalización y datos de experiencia. | M/C/D | Aprobar scripts y probar respuesta, envío a responsable y reporte de motivos. |
| E24–27 | Una línea oficial compartida de WhatsApp para consultas, quejas, reservaciones y comentarios. | C/V | Probar línea única y los cuatro motivos para los seis restaurantes. |
| E28–30 | Bot máximo tres interacciones: nombre, restaurante, motivo; pasar a asesor en horario; mensaje informativo fuera de horario. | C/V | Verificar número real de interacciones, captura, transferencia y comportamiento fuera de horario/festivos; no asumir soporte de calendarios sin prueba. |
| E31–35 | Facebook e Instagram: mensajes y comentarios, scripts, establecimiento y canalización con registro. | C/M/V | Probar mensajes **y comentarios** por cuenta/publicación y permisos; respuesta humana y registro por caso. |
| E36–41 | Google: responder básicamente reseñas/comentarios de fichas con respuestas autorizadas; canalizar y resumir mensualmente; sin monitoreo permanente ni garantía de estrellas. | M/D/V | Validar permisos de cada ficha; registrar fecha, referencia, respuesta y escalamiento. Integración automática no demostrada. |
| E42–46 | Llamadas solo salientes para aclaración, seguimiento y encuestas; máximo 200 marcaciones incluidos intentos sin contacto; registrar resultado; sin llamadas entrantes. | C/M/D | Prueba de llamada y bitácora; no habilitar atención entrante como parte de esta PoC. Bloqueo automático del límite no demostrado. |
| E47–51 | Línea única, QR o enlaces diferenciados, identificación de establecimiento por bot/asesor y registro de canal/restaurante. | C/M/V | Generar los QR/enlaces con herramienta aprobada; probar cada uno extremo a extremo. No suponer que el parámetro del enlace se conserva en NexoOmni: si falla, preguntar y registrar manualmente. |
| E52–54 | Cliente promueve canales; BINOMIA no hace publicidad, marketing ni difusión; volumen depende de comunicación del cliente. | M/Fuera | Dejar responsables y exclusiones explícitos; campañas de encuesta no equivalen a campaña publicitaria. |
| E55–63 | Recomendar QR/enlace en entrada, mesas, menús, tickets, redes y espera; personal orienta al comensal. | M | Cliente decide ubicación, materiales y entrenamiento; comprobar una muestra por establecimiento. |
| E64–67 | Son recomendaciones; cliente define, produce, coloca y difunde; BINOMIA no garantiza contactos. | M/Fuera | Evidenciar aceptación y entregables del cliente; no prometer volumen. |
| E68–76 | Lun–vie 09:00–18:00, sábado 09:00–14:00, domingo/festivos sin humano; recursos compartidos y protocolos; fuera de horario solo aviso y atención en siguiente jornada; escalaciones humanas dentro del horario. | C/M/V | Probar límites, festivo, cola y siguiente jornada; no asumir automatización del calendario ni atención crítica fuera de horario. |
| E77–85 | Recibir, identificar, clasificar, atender, registrar, canalizar, seguir y cerrar. | C/M/D | Ejecutar flujo completo y auditar fechas, asignaciones, cambios y cierre por caso. |
| E86–94 | Catálogo: quejas/inconformidades, consultas y reservaciones, alimentos y bebidas, atención y servicio, música/ambiente, cobros, seguimientos y otros. | C/M/V | Acordar catálogo controlado y prueba por motivo. E88 y E91 aparecen como encabezados en el libro: confirmar jerarquía sin omitir sus textos. |
| E95–100 | Nivel 1: consultas, felicitaciones y comentarios sencillos; BINOMIA responde con información autorizada, registra y cierra; sin intervención individual del restaurante ni seguimiento. | M/C | Probar registro, respuesta y cierre sin generar escalamiento innecesario. |
| E101–105 | Nivel 2: quejas menores/sugerencias; comunicar al responsable el siguiente día hábil; restaurante investiga y actualiza en ciclo semanal acordado; BINOMIA registra respuesta y pendientes. | M/C/D | Aprobar calendario y ciclo; probar fecha límite, entrega, actualización y pendientes. Automatización de plazo no demostrada. |
| E106–110 | Nivel 3: incidencia relevante; notificación prioritaria durante jornada, investigación y solución del restaurante, actualización por BINOMIA. | M/C/D | Probar contacto correcto, acuse, seguimiento y fecha; definir plazo cuantificado antes de medir. |
| E111–115 | Nivel 4: riesgo para seguridad, reputación o estabilidad económica; notificación inmediata dentro del horario, protocolo del restaurante y registro de respuestas. | M/C/D | Probar aviso y acuse humano; definir «inmediata», respaldo y contingencia. No prometer ≤5 min ni atención fuera de horario sin acuerdo. |
| E116–119 | BINOMIA clasifica, comunica y documenta; restaurante investiga y resuelve; definir tiempos y responsables antes del arranque. | M | Matriz firmada con titulares, suplentes, canales, tiempos y escalamiento ante falta de respuesta. |
| E120–128 | Registro: fecha/hora, canal, establecimiento, datos disponibles, motivo, nivel, responsable, estatus, respuesta y actualización/cierre. | C/M/D | Demostrar cada campo por caso y reporte; complementar con registro externo o desarrollar si se exige estructura nativa. |
| E129–136 | Recibir, clasificar y canalizar incidencias/reservaciones; comunicar respuestas autorizadas; confirmar reservas solo con facultades aprobadas; compensaciones/cortesías/correcciones las decide restaurante; documentar. | M/C/V | Probar aprobación explícita antes de confirmar u ofrecer algo; no asumir conexión a agenda o disponibilidad de mesas. |
| E137–143 | Seguimiento prioritario por WhatsApp, actualizado por nivel y respuestas; comunicar al comensal, llamar dentro del límite y cerrar administrativamente. | C/M/D | Probar comunicación, tarea, bitácora y cierre; validar reglas del canal y tope acumulado. |
| E144–150 | Una campaña mensual, máximo dos cuestionarios; evaluar alimentos, bebidas, servicio, ambiente y experiencia; aplicar a contactos con permisos; consolidar por establecimiento; llamadas cuentan en las 200. | M/D/V | Aprobar cuestionarios y permisos, capturar respuestas por establecimiento, controlar campaña/versiones y conciliar llamadas. Motor y reporte de encuestas nativos no demostrados. |
| E151–158 | Indicadores: volumen por establecimiento/canal, motivos, niveles, pendientes/resueltos y resultados de encuestas. | C/M/D | Definir unidad y fuentes; comparar contra exportación real. Dimensiones de restaurante, nivel y encuesta no demostradas de forma nativa. |
| E159–162 | Control diario de interacciones/estatus y reporte semanal consolidado de contactos, incidencias, escalaciones y pendientes. | C/M/D | Producir muestra verificable, reconciliar contra registro y aprobar destinatarios. |
| E163–169 | Informe ejecutivo mensual: resultados por establecimiento, canales, motivos, comentarios Google atendidos, encuestas y mejoras. | C/M/D | Entregar muestra con fuentes y filtros; Google y encuestas pueden requerir consolidación externa. |
| E170–176 | BINOMIA recibe, clasifica, atiende, registra y canaliza; restaurante investiga y resuelve; cliente promueve; sin garantía de estrellas; recursos/horarios acordados; ampliar alcance mediante revisión comercial. | M/Fuera | Recoger responsabilidades, exclusiones y cambios aprobados por escrito. |
| E177–188 | Confirmar restaurantes/responsables y alcance; diseñar flujos; aprobar scripts y matriz; configurar canales; capacitar; probar técnica, operación y estrés; validar métricas; liberar por área; objetivo 1-dic-2026. | M/C/V | Usar entregables y puertas de salida de secciones 4 y 7; la fecha no sustituye aceptación. |

## 4. Trazabilidad completa: hoja Interno

Los nombres son los consignados en la **primera fila de cada bloque** del
Excel; se proponen como responsables del bloque, pero debe confirmarse su
responsabilidad por cada entregable. No se interpreta una celda vacía como
entregable terminado.

| Excel / responsable consignado | Entregables a completar y evidencia mínima | Vía |
|---|---|---|
| I5–6 / por asignar | Objetivo interno: establecer entregables y controles para implementación sin omisiones; aprobar esta matriz y un tablero de seguimiento. | M |
| I7–14 / Pablo Corona | Propuesta aprobada; alcance/condiciones validados; NDA formalizado; contrato firmado; facturación acordada; autorización comercial; entrega formal a Operaciones. Evidencia: documentos y acta de traspaso. | M |
| I15–23 / Juan Carlos Hernández | Workflow; procedimientos por canal; matriz de cuatro niveles; catálogo de motivos; criterios de registro/seguimiento/cierre; responsables; procedimiento de reservas e incidencias; validación integral. Evidencia: versiones aprobadas y pruebas. | M/C |
| I24–31 / Juan Carlos Hernández | Recopilar información de seis establecimientos; elaborar scripts y respuestas tipo para WhatsApp, Facebook, Instagram y Google; materiales y guías; capacitar en procesos/escalamiento; evaluar conocimientos y liberar personal. Evidencia: aprobaciones, asistencia y evaluación. | M |
| I32–40 / Juan Carlos Hernández | Criterios de calidad, formato de monitoreo, validación de scripts, clasificación y escalamiento, retroalimentación, pruebas de atención y aprobación previa al arranque. Evidencia: checklist y resultados. | M |
| I41–50 / Gerardo Gálvez | Configurar WhatsApp y bot; habilitar accesos FB/IG/Google; telefonía saliente; registro básico; pruebas técnicas/funcionales y de estrés/capacidad; estabilidad; liberación técnica. Google puede ser acceso manual; no afirmar integración. | C/M/D/V |
| I51–57 / Juan Carlos Hernández | Estimar volumen, dimensionar recursos compartidos, definir cobertura y horarios, distribuir carga, validar capacidad y contingencias/desviaciones. Evidencia: supuestos, dotación y resultado de pruebas. | M |
| I58–65 / Juan Carlos Hernández | Definir indicadores y captura; configurar reporte operativo; diseñar semanal y mensual; segmentar por establecimiento/canal; probar consistencia e integridad. Evidencia: muestras conciliadas con fuente. | C/M/D |
| I66–75 / Alejandro Palmer | Entregar información/políticas y responsables de seis restaurantes; accesos; aprobar scripts, protocolos y matriz; definir reservas y compensaciones; preparar QR/materiales; informar personal; validar servicio. Evidencia: permisos, actas y muestras. | M/C |
| I76–85 / Alejandro Palmer, Pablo Corona, Juan Carlos Hernández y Gerardo Gálvez | Cronograma, responsable y fecha por entrega, seguimiento, pruebas integrales, validación de críticos y autorización de producción; objetivo 1-dic-2026. Liberar solo después de cerrar y autorizar entregables críticos de Comercial, Operaciones, Capacitación, Calidad, Tecnología, WFM, Reporting y Cliente. Identificar firmantes por área. | M |

La columna **Status** del libro está vacía; la columna **Seguimiento**
contiene «Pendiente» y sus listas de validación se superponen con nombres
distintos de estados. Acordar un único catálogo de estados, responsables y
fechas sin modificar el original hasta que el dueño lo autorice.

## 5. Qué existe y qué falta comprobar

| Capacidad | Evidencia actual | Implicación para BINOMIA |
|---|---|---|
| Bandeja compartida | [Manual de bandeja](../manuals/inbox/bandeja-compartida.md), [modelo de conversación](../../supabase/migrations/001_initial_schema.sql), [asignaciones e historial](../../supabase/migrations/110_conversation_assignment_history.sql). | Base para atención y asignación; estados de conversación no equivalen automáticamente a un sistema completo de casos. |
| Datos y seguimiento | [Etiquetas y campos](../manuals/contactos/etiquetas-y-campos.md), [seguimientos](../manuals/nexo-memory/seguimientos-nexo.md), [pipeline](../manuals/pipelines-y-citas/pipeline-de-ventas.md). | Evaluar trazabilidad por interacción/restaurante, duplicados, historial y filtros; una etiqueta de contacto puede ser insuficiente para visitas múltiples. |
| Automatizaciones | [Flujos](../manuals/automatizaciones-y-flujos/flujos.md), [automatizaciones](../manuals/automatizaciones-y-flujos/automatizaciones.md), [presentación comercial](./presentacion-nexoomni.html). | Hay base para guiones, pero debe probarse el bot limitado y los horarios en la integración WhatsApp elegida. La documentación comercial acota las automatizaciones a WhatsApp nativo. |
| Facebook e Instagram | [Conexión y restricciones](../manuals/primeros-pasos/conexion-facebook-instagram.md); [conectores](../../supabase/migrations/061_omnichannel_connectors_foundation.sql). | Verificar cuentas, permisos y eventos de comentarios por establecimiento; conectar mensajes no garantiza que funcionen comentarios. |
| Google y X | Calendar existe para citas; no se encontró evidencia suficiente de Google Business/reseñas ni X en el alcance revisado. | Google manual o integración por validar; X no es requisito del Excel. No presentar ninguno como conexión nativa ya confirmada. |
| Telefonía | [NexPhone](../manuals/telefonia/nexphone-softphone.md) y [extensiones](../manuals/telefonia/extensiones-por-agente.md). | Requiere Yeastar, extensiones y permisos habilitados. Llamadas salientes manuales no demuestran campaña automática ni control de 200 marcaciones. |
| Campañas y encuestas | [Difusiones](../manuals/difusiones/crear-una-difusion.md), [audiencias](../manuals/difusiones/audiencias-y-exclusiones.md). | Las difusiones WhatsApp no prueban motor de encuestas ni consolidación por restaurante. Respetar plantillas, permisos y reglas del canal. |
| Reportes | [Reportes ejecutivos](../manuals/supervision-y-reportes/reportes-ejecutivos.md), [exportación](../../src/lib/reports/executive-report-export.ts). | Hay reportes/exportaciones generales; demostrar cada dimensión, frecuencia y fuente exigida; no asumir envío o consolidación entre cuentas. |
| Integración externa | [API pública](../public-api.md), [worker de webhooks](../../src/lib/webhooks/delivery-worker.ts). | Una integración puede ayudar, pero debe construirse/configurarse y probarse. El código contempla reintentos limitados y fallos definitivos; la documentación pública describe una versión distinta. Verificar versión desplegada y reconciliar eventos: no prometer entrega infalible. |
| Seguridad | [Políticas de acceso a conversaciones](../../supabase/migrations/123_conversation_role_scoped_access.sql), [guía de desarrollo](../development-practices.md). | El aislamiento comprobable es por cuenta; no se ha demostrado aislamiento completo por restaurante dentro de una cuenta. Revisar roles, API y RLS con usuarios reales antes de dar acceso a terceros. |

## 6. Backlog para el agente de desarrollo

No iniciar un desarrollo como si fuera indispensable sin probar primero el
flujo existente y acordar si se acepta el sustituto manual. Cada punto debe
salir con evidencia, decisión, esfuerzo y pruebas; no se incluyen estimaciones
sin investigación.

| ID / prioridad propuesta | Necesidad y condición para desarrollar | Prueba / resultado de aceptación |
|---|---|---|
| B1 / P0 | **Modelo de restaurante y caso:** si configuración no registra múltiples casos y restaurantes por contacto, con historial y filtros, diseñar entidades/relaciones, estados, motivo, nivel, responsables y auditoría. | Un mismo contacto crea casos distintos para dos restaurantes; no se pierde historial; cada caso figura correctamente en reportes. |
| B2 / P0 | **Permisos y aislamiento:** si restaurantes acceden directamente, definir separación de datos por establecimiento o usar cuentas aisladas con una alternativa de consolidación. | Usuarios de un restaurante no pueden leer ni modificar casos, contactos o reportes de otro, por interfaz, API y RLS; supervisión autorizada sí puede. Probar también usuarios sin acceso. |
| B3 / P0 | **Control de escalamiento y horario:** si no basta el proceso humano, desarrollar calendario/festivos, niveles, responsables, registro de avisos/acuses y seguimiento vencido conforme a tiempos aprobados. | Pruebas dentro/fuera de horario, sábado, festivo y fallo de notificación. Nivel 2 vence el siguiente día hábil; nivel 4 alerta según tiempo definido, sin inferir SLA 24/7. |
| B4 / P0 | **Bot y origen QR:** probar primero flujo de tres interacciones y enlaces. Si no se preserva el restaurante o los datos por caso, corregir/diseñar captura y atribución; no prometer parámetros del proveedor sin evidencia. | Seis enlaces/QR llegan al flujo y producen restaurante correcto o una pregunta explícita; máximo tres interacciones solicitadas; sin datos perdidos ni doble asignación. |
| B5 / P0 | **Control de 200 marcaciones:** si se requiere enforcement automático, diseñar registro y contador por periodo y alcance aprobado, cubriendo intentos no atendidos y encuestas, fallos y concurrencia. No confundir con minutos. | Tras 199 intentos, el 200.º se registra; el 201.º se bloquea o requiere autorización explícita definida. Conciliar contra origen de llamadas; reinicio y zona horaria aprobados. |
| B6 / P1 | **Encuestas:** si cuestionario externo/manual no se acepta, incorporar o integrar campaña mensual, hasta dos versiones, respuestas estructuradas, permisos y consolidación por restaurante. | Una campaña, dos versiones y cinco dimensiones; tercera versión/campaña fuera de política se rechaza o requiere autorización según decisión; resultados cuadran con respuestas y no exponen datos no autorizados. |
| B7 / P1 | **Google:** si acceso manual no basta, investigar integración oficial, permisos de fichas y comportamiento documentado antes de diseñar lectura, respuesta, canalización y auditoría. | Para una ficha autorizada: leer comentario, responder con aprobación, conservar trazabilidad y conciliar el reporte; tratar revocación y fallos explícitamente. No prometer monitoreo permanente. |
| B8 / P1 | **Reportes:** si no se pueden obtener las dimensiones y periodos del Excel, agregar captura, filtros y exportación o integrar BI. | Generar diario, semanal y mensual; reconciliar totales por restaurante, canal, motivo, nivel, estado, Google y encuesta; reportar faltantes de datos. |
| B9 / P1 | **Notificación y trazabilidad externa:** si se usa API/webhook o un sistema adicional, verificar su cobertura real, permisos, eventos, entrega, reintentos y conciliación. | Simular caída y duplicado; observar fallo, reintento y conciliación sin duplicar caso. No dar por operativa una integración solo porque exista un endpoint. |

**Reglas para cualquier desarrollo:** leer la guía de prácticas; respetar
roles por jerarquía, autorización de servidor **y** RLS; nuevas migraciones
numeradas, traducciones `es/en/ko`, manuales y changelog de cliente si hay
función nueva. Probar en ambiente autorizado y correr `npx tsc --noEmit`,
`npm run lint` y pruebas específicas. Confirmar documentación de proveedores
antes de comprometer integraciones; no inferir que están activos.

## 7. Guion de PoC y criterios de aceptación

**Preparación:** usar datos ficticios o autorizados, seis responsables de
prueba y un catálogo aprobado. Registrar hora, resultado, evidencia, responsable
y aprobación para cada prueba. No enviar mensajes reales ni llamar a
comensales sin autorización.

| Prueba | Pasos y resultado esperado |
|---|---|
| P01 — Seis orígenes | Abrir cada QR/enlace y enviar un contacto de prueba; verificar que llega a la línea compartida, se identifica el restaurante correcto y queda registrado el canal. Si no se atribuye automáticamente, el asesor lo captura. |
| P02 — Bot en horario | Capturar nombre, restaurante y motivo en máximo tres interacciones; transferir a un asesor. Verificar que la información llegue y no se agreguen pasos no autorizados. |
| P03 — Fuera de horario | Probar antes/después de jornada, sábado después de 14:00, domingo y festivo configurado: únicamente mensaje informativo; no prometer atención inmediata; solicitud disponible para próxima jornada. Si la plataforma no distingue festivos, ejecutar y documentar procedimiento manual. |
| P04 — Canales | En WhatsApp, Facebook e Instagram probar recepción y respuesta; en FB/IG probar además comentario público autorizado. En Google atender manualmente una reseña de prueba o ambiente autorizado y documentarla. Marcar cada canal como aprobado o bloqueado. |
| P05 — Cuatro niveles | Simular un caso por nivel, con titular/suplente y acuse: nivel 1 resuelto; nivel 2 comunicado siguiente día hábil y con ciclo semanal; nivel 3 prioritario en jornada; nivel 4 inmediato en jornada según definición aprobada. Probar ausencia del responsable y contingencia. |
| P06 — Reservación y compensación | Registrar solicitud; no confirmar sin facultades aprobadas. Simular autorización/rechazo del restaurante y comunicar respuesta; no ofrecer compensación por cuenta de BINOMIA. |
| P07 — Llamadas | Registrar intento contestado, no contestado y encuesta telefónica; los tres suman al contador. Ensayar 199/200/201 con datos de prueba y demostrar el control manual o el bloqueo automático, según solución aprobada. |
| P08 — Encuestas | Ejecutar una campaña de prueba con hasta dos cuestionarios que cubran alimentos, bebidas, servicio, ambiente y experiencia; capturar permisos y consolidar resultados por los seis restaurantes, incluidos cero datos. |
| P09 — Reportes | Generar control diario, semanal y mensual con las dimensiones E153–169; cotejar caso a caso contra registro, llamadas, reseñas y encuestas. Identificar datos ausentes y su fuente. |
| P10 — Privacidad y acceso | Probar roles autorizados y no autorizados, incluyendo interfaz, API y RLS cuando corresponda. Ningún restaurante ve datos ajenos si se acordó aislamiento. Registrar autorización de prueba. |
| P11 — Continuidad y carga | Definir con WFM volumen, simultaneidad, duración y umbrales de aprobación; ejecutar estrés técnico y operativo y simular fallo de canal/notificación. Documentar recuperación y pendientes. El Excel no aporta cifras suficientes para inventar un umbral. |
| P12 — Aceptación | Comercial, Operaciones, Capacitación, Calidad, Tecnología, WFM, Reporting y Cliente firman entregables críticos y excepciones. El arranque del 1-dic es objetivo sujeto a esta liberación. |

**Resultado de la PoC:** cada prueba se clasifica como aprobada, bloqueada o
no aprobada, con evidencia y responsable. Un éxito con registro externo se
identifica como **proceso manual**, no como funcionalidad nativa. No se
considera cumplido el 100 % hasta que todas las filas relevantes y
excepciones estén aprobadas por las partes.

## 8. Preguntas y decisiones para el cliente

1. ¿Confirman que el Excel prevalece sobre las imágenes en horario, bot,
   canales y niveles? ¿Cuál es la zona horaria y el calendario exacto de
   festivos?
2. ¿Las 200 marcaciones son una bolsa conjunta para los seis? ¿Qué cuenta
   como intento, qué fecha reinicia el contador, quién puede autorizar
   excedentes y cómo se actúa al llegar al límite?
3. ¿Es aceptable atención manual de Google, encuestas y consolidación de
   reportes durante la PoC? ¿Qué debe estar integrado y automatizado desde el
   arranque?
4. ¿Qué información puede ver cada restaurante? ¿Los seis comparten una
   misma entidad y consentimiento para datos, o se necesita separación
   estricta y/o cuentas independientes?
5. ¿Quién es titular y suplente de cada nivel por restaurante? ¿Qué plazos
   medibles, acuses y canales aplican en niveles 3 y 4? ¿Qué hacer ante
   emergencias o reportes fuera de horario sin prometer cobertura humana?
6. ¿Cuáles son los horarios, menús, disponibilidad, políticas y facultades
   aprobadas para reservas, cancelaciones y cortesías en cada establecimiento?
7. ¿Qué cuentas, fichas, números y permisos estarán disponibles? ¿Son seis
   perfiles sociales distintos y hay autorización para responder comentarios
   y reseñas en cada uno?
8. ¿Cómo se realizarán las encuestas, a quiénes, con qué autorización y qué
   representa exactamente una «campaña» y un «tipo»? ¿Qué definición de
   satisfacción se espera en el reporte?
9. ¿Qué datos de origen y periodos deben tener los indicadores? ¿Quién recibe
   reportes diarios/semanales/mensuales y quién valida su conciliación?
10. ¿Cuáles son el volumen esperado, concurrencia, capacidad de agentes,
    presupuesto, ambiente de prueba y criterios de estrés? ¿Quién firma cada
    entrega y las excepciones antes del 1 de diciembre?

## 9. Próximo paso recomendado

Reunir a Comercial, Operaciones, TI, Reporting y Cliente para resolver las
preguntas 1–5, aprobar el uso o no de controles manuales y asignar
responsables y fechas. Después ejecutar P01–P12 en un entorno autorizado y
entregar esta matriz al agente de desarrollo para que determine, con pruebas
del sistema real, cuáles de B1–B9 requieren construcción y cuáles se
resuelven por configuración o proceso.
