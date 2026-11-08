# BINOMIA + NexoOmni: checklist para configurar y presentar la PoC

**Fecha:** 7 de noviembre de 2026  
**Objetivo:** preparar una demostración controlada con un número de WhatsApp
asignado por el equipo de NexoOmni, que muestre la experiencia del comensal y
la construcción de una base de contactos, sin desarrollar funciones nuevas.

**Responsable de configuración:** ______________________________  
**Fecha de demostración:** ______________________________________  
**Número de prueba:** ___________________________________________

Esta lista está pensada para ejecutarse en orden. Marcar cada actividad solo
después de verificarla. Si algo no funciona, anotarlo como pendiente; no
simular una función manual como si fuera automática.

**Estado de este documento:** guía de preparación; no se ha configurado ni
probado el número, la cuenta o los canales del cliente.

## 1. Qué vamos a mostrar y qué no

### Recorrido principal de la demostración

1. El comensal escanea un QR de un restaurante de prueba.
2. Se abre WhatsApp dirigido al número central de la PoC.
3. El comensal **envía** el mensaje y recibe una bienvenida.
4. Se identifica restaurante, nombre y motivo; un asesor toma la conversación.
5. Se registra y consulta el contacto en NexoOmni.
6. El equipo clasifica la solicitud, documenta, da seguimiento y cierra.
7. Se muestra qué información y reportes están disponibles y qué se hizo
   manualmente.

La PoC puede usar **tres restaurantes ficticios identificados como A, B y C**
hasta que se confirmen los tres participantes reales. El alcance del proyecto
completo contempla seis.

### Límites que debemos explicar

- **El QR no crea un contacto por sí solo.** En esta PoC el contacto se
  registra cuando la persona decide enviar un mensaje por WhatsApp y el
  canal lo procesa; escanear y cerrar sin enviar no registra al comensal.
- **No es una base de todos los visitantes:** solo incluye a quienes
  interactúan o se cargan por un procedimiento autorizado. Una familia puede
  compartir número y una persona puede usar más de uno.
- **Portal cautivo:** es una propuesta para una etapa futura, no un
  componente implementado ni parte de esta configuración. Su conexión con el
  Wi-Fi, aviso de privacidad, registro de datos, consentimiento, integración y
  costos requerirían diseño, permisos y validación por separado.
- **Google Reseñas:** Zernio documenta capacidades de reseñas, pero no se ha
  integrado Google al conector actual de NexoOmni. Si se demuestra, hacerlo
  como escenario manual o con material ficticio, claramente identificado.
- Etiquetas y campos permiten organizar contactos; **no prueban por sí solos**
  una base de visitas ni casos independientes por restaurante. No prometer
  atribución automática, aislamiento entre restaurantes, alertas de SLA,
  encuestas integradas o tope automático de llamadas sin pruebas.

## 2. Preparar el entorno antes de tocar la configuración

- [ ] Confirmar persona responsable de la PoC y quién aprobará la demostración.
- [ ] Definir fecha, duración y participantes; elegir tres restaurantes
      autorizados o usar A, B y C como ejemplo.
- [ ] Usar una **cuenta de prueba autorizada y separada** o confirmar que la
      cuenta existente se puede usar sin mezclar datos ni afectar clientes.
- [ ] Confirmar que el número será de prueba, está bajo control del equipo y
      puede recibir el proceso de verificación. **Antes de vincularlo, revisar
      si ya se usa con WhatsApp u otro proveedor y qué efecto tendrá la
      conexión.** No desconectar ni migrar un número activo sin autorización.
- [ ] Verificar disponibilidad del servicio de conexión, plan, capacidad de
      usuarios y costos; no asumir que la cuenta o los proveedores ya están
      habilitados.
- [ ] Preparar al menos dos teléfonos de prueba distintos al número de la
      línea central y con permiso de sus titulares.
- [ ] Usar datos ficticios o voluntarios autorizados. No cargar una base real
      de comensales sin autorización y revisión de privacidad.
- [ ] Aprobar un aviso de privacidad o enlace de prueba y definir quién es el
      responsable del tratamiento, quién puede ver/exportar datos, cuánto se
      conservan y cómo se retiran los datos de prueba. No suponer que un
      mensaje entrante autoriza campañas promocionales.
- [ ] Preparar registro de resultados: actividad, resultado, evidencia,
      responsable y pendiente. No incluir contraseñas ni datos sensibles.

**Manual de referencia:** [Conectar WhatsApp](../manuals/primeros-pasos/conexion-whatsapp.md).

## 3. Conectar el número a NexoOmni

La demostración puede usar conexión guiada o nativa; elegir **una sola ruta**
según cómo se contratará y conectará el número. No suponer que ambas estén
habilitadas.

### Opción A: conexión guiada con proveedor

1. [ ] Entrar con una cuenta de administrador o propietario.
2. [ ] Ir a **Configuración → Redes sociales → Conectar WhatsApp**.
3. [ ] Seguir el asistente y autorizar únicamente la cuenta y número de prueba.
4. [ ] Confirmar que el número y la conexión aparecen activos en NexoOmni.

### Opción B: conexión nativa con Meta

1. [ ] Entrar como administrador o propietario y abrir **Configuración →
   WhatsApp**.
2. [ ] Configurar el token, Phone Number ID y WABA ID autorizados mediante el
   procedimiento seguro del equipo.
3. [ ] Guardar y usar **Probar conexión**.

### Comprobación obligatoria para cualquiera de las rutas

- [ ] Desde el teléfono de prueba 1 enviar “Hola, soy un contacto de prueba”.
- [ ] Verificar que aparece en **Bandeja de entrada** y que se puede responder.
- [ ] Confirmar en el teléfono del participante que llegó la respuesta.
- [ ] Buscar la ficha en **Contactos** y verificar nombre o identificador y
      teléfono disponibles. Anotar qué se creó realmente.
- [ ] Repetir con el segundo teléfono para comprobar que son dos contactos.
- [ ] Si falla, revisar estado de conexión, permisos y eventos del proveedor;
      no continuar la demostración como si estuviera funcionando.

**Resultado / evidencia:** _________________________________________________

## 4. Preparar usuarios y atención compartida

1. [ ] Identificar quién actuará como **administrador**, **supervisor** y
   **asesor**. Una misma persona puede representar varios papeles si la PoC
   es pequeña, sin presentar eso como prueba de acceso multiusuario.
2. [ ] En **Configuración → Miembros**, revisar usuarios y roles disponibles;
   solicitar al equipo de plataforma cualquier alta necesaria.
3. [ ] Verificar el límite de usuarios y usar solo cuentas autorizadas.
4. [ ] En la bandeja, probar **Sin asignar**, **Tomar conversación** y
   asignación a un asesor. Si hay dos usuarios, transferir la conversación y
   comprobar que el segundo ve el contexto permitido.
5. [ ] Probar que las notas internas se muestran al equipo autorizado y **no**
   se envían al comensal.
6. [ ] No entregar acceso a un restaurante real si necesita aislamiento de
   otros establecimientos: esa separación no está demostrada por etiquetas.

**Manuales:** [Miembros y roles](../manuals/primeros-pasos/invitar-miembros.md),
[Bandeja compartida](../manuals/inbox/bandeja-compartida.md) y
[Notas internas](../manuals/inbox/notas-internas.md).

## 5. Organizar la base de comensales

### 5.1 Crear etiquetas de prueba

1. [ ] Como administrador, crear etiquetas para los tres restaurantes,
   por ejemplo `POC Restaurante A`, `POC Restaurante B` y `POC Restaurante C`.
2. [ ] Crear etiquetas de motivo: `Consulta`, `Reservación`, `Queja`,
   `Sugerencia` y `Felicitación`.
3. [ ] Si facilita la demostración, crear `Nivel 1`, `Nivel 2`, `Nivel 3`,
   `Nivel 4` y `No contactar`; definir una regla operativa para aplicarlas.
4. [ ] Aplicar etiquetas desde el panel de contacto o la ficha y probar el
   filtro en **Contactos**.

**Importante:** una etiqueta pertenece al **contacto**, no necesariamente a
una visita o incidencia. Si el mismo comensal escribe por dos restaurantes,
conservar ambas etiquetas cuando corresponda y registrar cada caso por
separado mediante notas o control manual. No usar etiquetas como mecanismo
de seguridad ni como prueba de conteo exacto de visitas.

### 5.2 Preparar campos mínimos

1. [ ] Ir a **Configuración → Campos personalizados** y crear únicamente los
   campos aprobados que se quieran mostrar, por ejemplo `Restaurante de
   referencia` y `Fecha de visita`, si son útiles para la PoC.
2. [ ] En **Contactos**, abrir la ficha de prueba y capturar manualmente el
   nombre y los datos autorizados. Comprobar qué campos están realmente
   disponibles y se guardan.
3. [ ] Si se quiere registrar autorización de contacto, definir con el
   responsable de privacidad **finalidad, texto, respuesta, fecha y fuente**;
   no marcar aceptación si la persona no la ha otorgado. Un campo o etiqueta
   no sustituye por sí solo el aviso, el consentimiento aplicable o un
   historial auditable.
4. [ ] Verificar que buscar por nombre o teléfono y filtrar por etiquetas
   produce los contactos de prueba esperados.
5. [ ] Mostrar cómo se actualiza un contacto existente sin crear otro
   deliberadamente; no fusionar contactos de distintas personas. La fusión
   manual documentada no se puede deshacer.
6. [ ] Si se necesita presentar extracción de datos, verificar primero la
   opción real disponible para la cuenta y los permisos. **No prometer una
   exportación de contactos o de campos que no se haya probado.**

**Manual:** [Etiquetas y campos personalizados](../manuals/contactos/etiquetas-y-campos.md).
La [importación CSV](../manuals/contactos/importar-csv.md) es opcional, solo
con datos ficticios o autorizados; requiere teléfono y no demuestra captura
automática de visitantes.

## 6. Crear los QR y probar el origen

### 6.1 Preparar un enlace distinto por restaurante

1. [ ] Sustituir `NUMERO` por el número central de prueba en formato
   internacional, con código de país y **solo dígitos**, sin `+`, espacios ni
   guiones. Los ejemplos no son enlaces reales hasta reemplazarlo.
2. [ ] Crear un enlace por restaurante. Ejemplos:

   - A: `https://wa.me/NUMERO?text=Hola%2C%20quiero%20atenci%C3%B3n%20del%20Restaurante%20A`
   - B: `https://wa.me/NUMERO?text=Hola%2C%20quiero%20atenci%C3%B3n%20del%20Restaurante%20B`
   - C: `https://wa.me/NUMERO?text=Hola%2C%20quiero%20atenci%C3%B3n%20del%20Restaurante%20C`

3. [ ] Abrir cada enlace y verificar que muestra el número y el texto
   esperado. La persona deberá revisar y enviar el mensaje.
4. [ ] Con una herramienta de QR confiable aprobada, generar un QR para cada
   enlace. No subir números de clientes ni listas de contactos a generadores
   externos. Identificar visualmente cada QR como **material de prueba**.
5. [ ] Escanear cada código con un teléfono diferente al del negocio, enviar
   el mensaje y comprobar lo que llega a la bandeja.

### 6.2 Atribuir sin prometer automatización

6. [ ] Verificar si el primer mensaje muestra el restaurante correcto y si el
   flujo realmente puede usarlo para evitar preguntar otra vez. **No se ha
   demostrado que el mensaje prellenado se convierta automáticamente en un
   campo de restaurante.**
7. [ ] Si no se atribuye de forma comprobable, el asesor lee y confirma el
   restaurante, aplica la etiqueta correspondiente y registra el caso. Si
   falta o es dudoso, lo pregunta; explicar que esta parte es manual.
8. [ ] Probar mensaje editado, mensaje enviado sin texto prellenado y el
   mismo teléfono escaneando el QR de otro restaurante. Revisar que no se
   sobrescriba ni se asigne un restaurante incorrecto.

El mensaje prellenado puede ser modificado y no es una prueba autenticada de
ubicación o visita. El QR solo da contexto cuando el mensaje se envía y se
procesa correctamente.

## 7. Configurar el bot básico

**Meta del cliente:** máximo tres preguntas —nombre, restaurante y motivo— y
transferencia a asesor. La identificación por QR solo evita la pregunta de
restaurante si la prueba confirma que el flujo la reconoce correctamente.

1. [ ] Aprobar el texto de bienvenida, aviso de privacidad y preguntas. No
   pedir información sensible ni prometer promociones o compensaciones.
2. [ ] Ir a **Flujos → Nuevo flujo** y crear uno identificado como `PoC
   BINOMIA`. Seleccionar el canal de WhatsApp que corresponda a la conexión
   y un disparador adecuado, por ejemplo primer mensaje, sujeto a prueba.
3. [ ] Agregar una bienvenida breve y preguntas de **nombre**, **restaurante**
   y **motivo**, con un máximo de tres. Como texto de ejemplo:

   > Hola, gracias por contactarnos. Soy el asistente de prueba de BINOMIA.
   > Te ayudaremos con tu consulta. Aviso de privacidad: [enlace aprobado].
   > ¿Cuál es tu nombre?
   >
   > ¿De qué restaurante nos escribes: A, B o C?
   >
   > ¿En qué podemos ayudarte?

4. [ ] Agregar el paso de **transferencia a un agente**; si procede, asignar
   un asesor de prueba. Probar con dos teléfonos antes de publicar para la
   demostración.
5. [ ] Verificar cada respuesta y el traspaso. Confirmar si el asesor las ve
   en la conversación y si el nombre/restaurante/motivo pasan a la ficha.
   **Las respuestas del flujo pueden quedar como variables de ejecución; no
   asumir que llenan campos de contacto o reportes automáticamente.**
6. [ ] Si no se actualiza la ficha, pedir al asesor que capture los datos
   aprobados y aplique etiquetas manualmente; demostrarlo como tal.
7. [ ] Probar respuesta incompleta, abandono, nuevo mensaje y transferencia.
   El motor captura texto no vacío; no asumir que valida formatos o interpreta
   correctamente cualquier respuesta.
8. [ ] Desactivar para la PoC respuestas automáticas adicionales que puedan
   duplicar mensajes o contradecir el alcance. **No apagar configuraciones de
   otras cuentas o servicios.**

**Manuales:** [Flujos](../manuals/automatizaciones-y-flujos/flujos.md) y
[Automatizaciones](../manuals/automatizaciones-y-flujos/automatizaciones.md).
El código revisado despacha mensajes del conector guiado a flujos, pero debe
probarse con la conexión elegida; algunos manuales describen un alcance de
canales más restrictivo.

### Horario y mensaje fuera de jornada

- [ ] Confirmar horario con el cliente. La propuesta vigente indica lunes a
      viernes 09:00–18:00, sábado 09:00–14:00, sin atención humana domingos y
      festivos.
- [ ] Preparar mensaje: “Gracias por escribirnos. En este momento estamos
      fuera de horario; atenderemos tu solicitud en la siguiente jornada”.
- [ ] Probar el comportamiento fuera de horario, sábado, domingo y festivo.
      La condición de hora existente no demuestra por sí sola calendario de
      días, zona horaria o festivos; además, los flujos se procesan antes que
      las automatizaciones del conector guiado.
- [ ] Si no se puede garantizar **solo el mensaje informativo** fuera de
      horario, no prometerlo ni dejar el bot activo como solución productiva.
      Acordar un control manual temporal para la prueba o registrar el
      desarrollo pendiente. No afirmar atención humana 24/7.

## 8. Preparar la operación de casos y seguimiento

1. [ ] Tener un guion breve para consulta, reservación, felicitación y queja.
   No confirmar una reservación ni ofrecer compensación sin autorización.
2. [ ] Definir una tabla de demostración con responsable y suplente de cada
   restaurante. Usar nombres ficticios si todavía no se han designado.
3. [ ] Clasificar manualmente el caso en uno de los cuatro niveles acordados:
   atención directa, diferida, prioritaria o crítica.
4. [ ] Tomar la conversación y registrar en **Notas internas**, por ejemplo:
   `Caso de prueba POC-001 | Restaurante A | Queja | Nivel 2 | Responsable:
   asesor | Escalado a: gerente de prueba | Pendiente de respuesta`.
5. [ ] Si se requiere seguimiento, ir a **Seguimientos → + Nueva tarea**,
   seleccionar el contacto, escribir la acción y asignar fecha/hora. Probar
   que la tarea aparece al usuario que la atenderá.
6. [ ] Simular la notificación al responsable por el medio autorizado;
   registrar hora, respuesta y acuse. Explicar claramente si se hizo fuera de
   NexoOmni y no asegurar que existe escalamiento automático.
7. [ ] Comunicar la resolución autorizada y cerrar la conversación; comprobar
   que el historial sigue visible para el usuario autorizado.
8. [ ] Repetir con una incidencia del mismo contacto para otro restaurante;
   verificar que el proceso manual no confunda ambos casos.

**Manuales:** [Notas internas](../manuals/inbox/notas-internas.md) y
[Tareas y recordatorios](../manuals/nexo-memory/tareas-y-recordatorios.md).
El proceso anterior es una **demostración operativa**, no un sistema de casos
independientes o de SLA certificado.

## 9. Capacidades adicionales: solo si están disponibles y autorizadas

### Facebook e Instagram

- [ ] Conectar cuentas de prueba autorizadas desde **Configuración → Redes
      sociales**, si ya se dispone de ellas.
- [ ] Probar mensaje y comentario en cada canal, así como una respuesta al
      comentario público. Verificar permisos y eventos antes de mostrarlo.
- [ ] Explicar que un contacto de Instagram o Facebook no necesariamente
      comparte el teléfono con WhatsApp y no se une automáticamente.

Referencia: [Conectar Facebook e Instagram](../manuals/primeros-pasos/conexion-facebook-instagram.md).

### Google Reseñas

- [ ] Mostrar con datos ficticios la reseña positiva, negativa y una queja
      escalada; si hay acceso real autorizado, responder solo mediante el
      procedimiento aprobado por el titular de la ficha.
- [ ] Explicar que la gestión en fichas de Google o el registro de seguimiento
      es manual durante esta demostración; **no mostrarla como integración
      directa de NexoOmni**.

Referencia: [Dictamen de viabilidad](./binomia-dictamen-poc-2026-11-07.md).

### Llamadas, encuestas y reportes

- [ ] Si Yeastar está habilitado y autorizado, probar una llamada **saliente**
      con un participante voluntario. Si no, mostrar el escenario sin afirmar
      que ya se encuentra conectado.
- [ ] Para el proyecto completo, recordar que las **200 marcaciones
      mensuales son compartidas entre seis restaurantes**, incluyen intentos
      no contestados y encuestas; el contador/bloqueo automático no se ha
      demostrado. Llevar un registro manual si se acuerda.
- [ ] Presentar una encuesta ficticia y su resultado consolidado manual si no
      existe herramienta de encuesta aprobada; no indicar que NexoOmni tiene un
      módulo de encuestas que no se haya probado.
- [ ] Abrir **Reportes** y comprobar los indicadores disponibles en la cuenta.
      Preparar una tabla manual de muestra para restaurante, motivo, estado,
      reseñas o encuestas que no estén disponibles. Identificar datos
      ficticios y fuentes. Las llamadas con transcripción no equivalen a todas
      las marcaciones.

Referencia: [Reportes ejecutivos](../manuals/supervision-y-reportes/reportes-ejecutivos.md).

## 10. Ensayo de la demostración

| Prueba | Acción | Resultado esperado | Resultado / evidencia |
|---|---|---|---|
| 1. Registro | Teléfono 1 escanea QR A y envía el mensaje. | Llega a la línea y aparece contacto; identificar restaurante manualmente si hace falta. | |
| 2. Experiencia | Seguir bot y solicitar ayuda. | Máximo tres preguntas y transferencia; asesor ve información necesaria. | |
| 3. Base de comensales | Completar ficha y etiqueta A. | Se localiza el contacto y los datos autorizados guardados. | |
| 4. Otro restaurante | Teléfono 2 escanea QR B. | Mensaje y contacto diferenciados; etiqueta B correcta. | |
| 5. Visita repetida | Teléfono 1 usa QR C. | Se conserva contacto; no se confunden la nueva solicitud y restaurante. | |
| 6. Sin atribución | Editar o borrar el texto del enlace. | El asesor pregunta y registra origen; no se inventa. | |
| 7. Incidencia | Simular queja, asignación, nota y tarea. | Hay responsable, seguimiento y cierre; pasos manuales identificados. | |
| 8. Privacidad | Consultar aviso y revisar permisos de los usuarios de prueba. | Datos ficticios o autorizados; sin acceso indebido ni promesa de aislamiento no probado. | |
| 9. Horario | Ensayar mensaje y registro fuera de horario. | Solo aviso si realmente está configurado; si no, declarar limitación y control temporal. | |
| 10. Reporte | Mostrar reporte existente y tabla manual si hace falta. | Se distinguen cifras reales, ficticias y datos no disponibles. | |

- [ ] Ensayar todo el recorrido antes de la reunión, desde el teléfono del
      comensal hasta la vista del asesor.
- [ ] Preparar capturas o videos con datos ficticios por si falla el canal;
      presentar la grabación como respaldo, no como funcionamiento en vivo.
- [ ] Hacer una demostración final con el socio comercial y registrar qué
      requiere cambios, integración o confirmación.

## 11. Después de la PoC

- [ ] Registrar observaciones del cliente sobre facilidad de acceso, número
      de preguntas, tiempos y claridad de la atención.
- [ ] Anotar qué datos de la base son indispensables, cómo se recopilarán y
      para qué se utilizarán, incluyendo autorización aplicable.
- [ ] Decidir con el cliente si se necesitará un portal cautivo y qué debe
      ocurrir cuando alguien no use WhatsApp o no quiera proporcionar datos.
- [ ] Documentar brechas de Google, atribución por QR, historial de visitas,
      permisos, encuestas, horarios y reportes para que desarrollo estime el
      trabajo únicamente después de definir el alcance.
- [ ] Pausar la configuración de prueba si ya no se usará y retirar accesos
      temporales y datos de prueba según lo autorizado; no borrar datos ajenos.
- [ ] Entregar resultados, evidencia y próximos pasos al socio comercial.
