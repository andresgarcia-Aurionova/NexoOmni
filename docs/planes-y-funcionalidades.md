# Planes de venta: qué incluye cada uno

Documento interno (no es manual de cliente). Base para calcular costos operativos, precios y comparar contra competidores.

**Fuente de verdad:** el código, no la propuesta comercial. Matriz de permisos en `src/lib/account/entitlements.ts` (`PLAN_FEATURES`), módulos en `src/lib/account/modules.ts`, créditos y tarifas en [tarifas-ia-y-llamadas.md](./tarifas-ia-y-llamadas.md) y [plan-ia-multiproveedor-creditos-asistente.md](./plan-ia-multiproveedor-creditos-asistente.md).

Leyenda: ✅ incluido · ❌ no incluido · 🛠️ decidido comercialmente, **aún no impuesto por el código** (requiere desarrollo).

Estado: decisiones del dueño y socios hasta el **6-nov-2026** aplicadas (incluye cambios de socios: chat web en todos los planes, 1 conexión por plataforma en todos, contrato de 12 meses, IA ×3, colchón de créditos). Fuente adicional de costos: Excel `NexoOmni_planes_costos_y_funcionalidades.xlsx` (aún **no** refleja estos cambios). Las secciones 6 a 9 reúnen precios, contrato, extras y lo pendiente de desarrollo.

## 1. Los 3 planes y su código interno

| Plan | `plan_code` | Resumen |
|---|---|---|
| Plan 1 · Conecta | `basic` | Todo lo que funciona **sin IA**, excepto difusiones; incluye chat web en vivo. 1 conexión por plataforma. 2 usuarios. |
| Plan 2 · Inteligencia | `ai` | Plan 1 + todas las funciones con IA + difusiones. 1 conexión por plataforma. 2 usuarios. Sin telefonía. |
| Plan 3 · Voz y atención | `whatsapp_voice` | Plan 2 + telefonía PSTN (Yeastar), 1 DID y llamadas entrantes de WhatsApp. 1 conexión por plataforma. 2 usuarios con telefonía. |

### Límites de conexiones por plataforma (cambio del 6-nov: igual en todos los planes)

| Plataforma | Plan 1 | Plan 2 | Plan 3 |
|---|:-:|:-:|:-:|
| WhatsApp | 1 | 1 | 1 |
| Facebook | 1 | 1 | 1 |
| Instagram | 1 | 1 | 1 |

Cada conexión adicional se cobra como extra (ver sección 8). 🛠️ Hoy el código no limita cuentas por canal.

### Usuarios incluidos
**2 usuarios por plan.** En el Plan 3 esos 2 usuarios ya incluyen telefonía (extensión) y el DID. 🛠️ El código usa por defecto `seat_limit = 1`; hay que configurar 2 en cada suscripción.

### Uso justo de telefonía (Plan 3, decidido)

**PSTN (Yeastar)**
- **Bolsa de minutos de la cuenta:** cada agente del Plan 3 (los 2 incluidos y los adicionales) aporta 500 min salientes a una **bolsa compartida**: bolsa = 500 × agentes (2 incluidos = 1,000 min; 3 = 1,500). Si uno gasta 600 y otro 200, no hay excedente porque la cuenta usó 800 de 1,000.
- **Agregar agentes a mitad de mes:** los 500 min del agente nuevo se suman a la bolsa **de inmediato**. Quitar agentes: la bolsa del mes en curso no cambia; desde el siguiente mes ya no se cargan los 500 min de ese agente (decidido).
- Solo cuentan las llamadas **salientes**. Las **entrantes PSTN son ilimitadas**.
- **Excedente:** si la cuenta agota la bolsa del mes, los minutos extra **se cobran** por tipo de destino (tarifas en la sección 7) y **se suman a la factura del mes siguiente** (decidido). Aparte se cobra con créditos de IA la transcripción y el resumen (IA ×3).
- **Minutos no usados:** se pierden, no pasan al mes siguiente (confirmado).
- Los minutos de transcripción y resumen de llamadas PSTN se cobran aparte con créditos de IA (ya desarrollado).

**WhatsApp**
- Solo **recibe** llamadas; no hay salientes.
- Las llamadas de WhatsApp **no entran a la bolsa de 500 min y no son ilimitadas: las cobramos nosotros descontando créditos de IA** (ya desarrollado en `record_whatsapp_call_and_debit`, migraciones 157/158/160): conexión (mín. US$0.10) + MXN 0.50 por minuto iniciado + transcripción + resumen. Como solo se reciben llamadas, **Meta no cobra nada** (las entrantes no tienen cargo de Meta); el único cobro al cliente es el nuestro, en créditos. Detalle en [tarifas-ia-y-llamadas.md](./tarifas-ia-y-llamadas.md).

**Ciclo y primer mes (ajuste por consumo, decidido)**
- Los minutos se renuevan el **día 1 de cada mes** (bolsa completa).
- El cliente puede contratar cualquier día y Stripe sigue su ciclo normal de cobro, sin alinear la facturación al día 1 (se mantiene lo más simple posible).
- **Primer mes parcial:** los minutos consumidos entre la contratación y el día 1 se **descuentan de la bolsa del primer mes completo**. Ejemplo: contrata el día 15, consume 150 min; el día 1 recibe 500 − 150 = **350 min** para ese mes. Si pasa de 350, paga excedente. Así no regala minutos de más ni prorratea por días.
- Corolario a definir: si no contrata el día 15 sino en otro día, la regla es la misma (se descuenta lo consumido antes del día 1).
- Cambio de agentes a mitad de mes: agregar suma minutos de inmediato; quitar aplica desde el mes siguiente (ambos decididos).

🛠️ **Hoy el código no mide ni limita estos minutos.** Existen `yeastar_call_transcriptions` con `account_id`, `direction` y `duration_seconds`, que permiten sumar salientes por cuenta y mes. Hace falta: contador mensual con bolsa por cuenta, el descuento del primer mes, y el cobro del excedente. El ciclo de Stripe no se modifica.

`yeastar_voice` existe solo por compatibilidad (telefonía PSTN sin llamadas WhatsApp). No se vende. Las cuentas existentes **no** fueron reasignadas a `basic` (migración 170).

## 2. Matriz de funcionalidades por plan

### 2.1 Controladas por plan en el servidor (`requireEntitlement`)

| Funcionalidad | Entitlement | Plan 1 | Plan 2 | Plan 3 |
|---|---|:-:|:-:|:-:|
| Mensajería social: WhatsApp, Facebook, Instagram (conectar, enviar, recibir) | `social_messaging` | ✅ | ✅ | ✅ |
| Automatizaciones y flujos (crear, activar, plantillas, ejecuciones) | `automation_flows` | ✅ | ✅ | ✅ |
| Asistente IA (chat, acciones, consultas con datos, reportes) | `ai_assistant` | ❌ | ✅ | ✅ |
| Inteligencia de conversaciones (análisis, resúmenes, insights, reportes de llamadas) | `ai_conversation_intelligence` | ❌ | ✅ | ✅ |
| Créditos de IA: pantalla, paquetes mensuales, créditos extra | `ai_credits` | ❌ | ✅ | ✅ |
| Telefonía PSTN Yeastar (softphone, extensiones por agente, contexto de llamada, transferencias IA) | `yeastar_telephony` | ❌ | ❌ | ✅ |
| Supervisión en vivo (escucha), auditoría de supervisión | `yeastar_telephony` | ❌ | ❌ | ✅ |
| Transcripción de llamadas PSTN | `yeastar_telephony` | ❌ | ❌ | ✅ |
| Chat web en vivo (Yeastar Live Chat). **Cambio 6-nov: incluido desde el Plan 1.** Se configura en Yeastar sin costo adicional; la infraestructura la absorben los clientes con telefonía. 🛠️ Hoy el código lo limita a Plan 3 (`PLAN_FEATURES`) | `yeastar_live_chat` | ✅ | ✅ | ✅ |
| Llamadas entrantes por WhatsApp (se cobran con créditos de IA) | `whatsapp_voice_calls` | ❌ | ❌ | ✅ |

### 2.2 Decididas comercialmente, sin restricción en el código hoy 🛠️

Estas funciones **no** pasan por `requireEntitlement`: hoy cualquier plan las tiene. Para cumplir la decisión hay que agregar entitlements nuevos (`broadcasts`, y revisar los que usan IA) con migración, guardas en servidor, RLS, mensajes es/en/ko y manual.

| Funcionalidad | Manual | Plan 1 | Plan 2 | Plan 3 |
|---|---|:-:|:-:|:-:|
| Bandeja compartida, notas internas, reacciones/respuestas, plantillas y botones | `inbox/` | ✅ | ✅ | ✅ |
| Contactos: etiquetas y campos, importar CSV, fusionar | `contactos/` | ✅ | ✅ | ✅ |
| Pipeline de ventas | `pipelines-y-citas/` | ✅ | ✅ | ✅ |
| Agenda de citas (módulo `appointments`) | `pipelines-y-citas/` | ✅ | ✅ | ✅ |
| Integración AgendaPro (módulo `agendapro`) | `integraciones/` | ✅ | ✅ | ✅ |
| Notificaciones | `notificaciones/` | ✅ | ✅ | ✅ |
| API pública, claves API, webhooks, servidor MCP | `integraciones/` | ✅ | ✅ | ✅ |
| Tareas y recordatorios manuales | `nexo-memory/` | ✅ | ✅ | ✅ |
| **Difusiones** (audiencias, exclusiones, envío masivo) | `difusiones/` | ❌ | ✅ | ✅ |
| Respuesta automática por IA y base de conocimiento | `agentes-ia/` | ❌ | ✅ | ✅ |
| Nexo Memory (memoria de contacto y seguimientos generados por IA) | `nexo-memory/` | ❌ | ✅ | ✅ |
| Miembros del equipo (límite por `seat_limit` de cada suscripción) | `primeros-pasos/` | por cuenta | por cuenta | por cuenta |

Notas:
- Los módulos `pipelines`, `appointments` y `agendapro` se activan por cuenta (`accounts.enabled_modules`, por defecto solo `pipelines`), no por plan.
- **Confirmado por el dueño (5-nov-2026):** clasifiqué como IA (Plan 2+) la respuesta automática, base de conocimiento y Nexo Memory porque se alimentan de modelos de IA (`src/lib/ai/memory.ts`). En Nexo Memory, las tareas y recordatorios manuales los dejé en Plan 1. Si prefieres otro corte, dímelo.
- Las funciones de IA ya dependen de `ai_credits`, que hoy solo está activo en Planes 2 y 3, pero no verifiqué ruta por ruta que la respuesta automática quede apagada en Plan 1.
- Los entitlements se pueden sobrescribir por cuenta con `feature_overrides` (útil para excepciones comerciales).

## 3. Lo que hoy NO tiene límite en el código (necesario para vender extras)

| Concepto | Estado actual |
|---|---|
| Cuentas conectadas por canal (nº de WhatsApp, Facebook, Instagram) | **Sin tope en el código.** Decidido: 1 por plataforma en todos los planes; lo adicional es extra de pago. Falta imponerlo (servidor + RLS). |
| Usuarios (asientos) | Sí hay tope: `account_subscriptions.seat_limit` (default 1), aplicado por trigger en base de datos. Decidido: 2 incluidos por plan; hay que cambiar el valor inicial y ligarlo al plan. |
| Tienda de extras (comprar conexión, DID, usuarios, etc.) | **No existe.** Hay compra de créditos IA con Stripe (paquetes mensuales y créditos extra), pero no un catálogo de complementos. **La mensualidad de los planes tampoco se cobra desde Stripe en el código actual** (solo créditos IA). |
| Contrato de 12 meses, meses gratis, baja con aviso | **No existe** en el código. |
| Avisos de saldo bajo de créditos IA | **No existen.** Solo hay bloqueo de débitos al llegar a cero (migración 160). |
| Números DID / telefonía | Se administran fuera de la plataforma (Yeastar). No hay compra ni asignación desde NexoOmni. |

Para construir la tienda hace falta: (1) tabla de límites por plan y por cuenta (cuentas por canal, DID, asientos), (2) catálogo de extras con precio, (3) validación en servidor **y** RLS al conectar un canal, (4) cobro de extras sumado al cobro del plan, (5) contrato y fechas de vigencia, (6) manual y changelog.

## 4. Planes de crédito IA (Planes 2 y 3)

Del documento de tarifas vigente (23-oct-2026), precios en USD sin IVA; Stripe cobra en MXN con el FIX del día:

| Paquete mensual | Precio | Créditos |
|---|---|---|
| Inicio | US$25 | 25,000 |
| Emprendedor | US$50 | 50,000 |
| Comercial Pro | US$150 | 150,000 |
| Corporativo | US$300 | 300,000 |

- Créditos mensuales vencen al terminar el mes pagado (+2 días de gracia) y no se acumulan.
- Créditos extra (pago único, vencen a 30 días): 10,000 por US$12 · 25,000 por US$30.
- **Margen de IA ×3 (cambio 6-nov):** precio = costo × 3. Los **paquetes no cambian** (US$25 = 25,000 créditos, etc.) y 1 crédito sigue valiendo US$0.001 de precio; el costo que se reconoce por crédito baja a US$0.000333, por lo que **cada tarea consume 1.5 veces más créditos** que con ×2 (margen bruto 66.7 % en lugar de 50 %). Ejemplo: tarea con costo real US$0.0083 → antes 17 créditos, ahora 25.
- 🛠️ Hay que cambiar el margen global (`target_margin_basis_points` de 5000 a 6667 en `ai_billing_settings`, editable desde el panel de plataforma) y **revisar las tarifas fijas**, que hoy se calcularon con ×2: transcripción 15 créditos/min, resumen 2 créditos, conexión WhatsApp mín. US$0.10. Las tablas de [tarifas-ia-y-llamadas.md](./tarifas-ia-y-llamadas.md) quedan obsoletas al aplicarlo.
- La transcripción PSTN de Yeastar también pasa a **×3** (decidido 6-nov; hoy usa costo × 1.5). 🛠️ Cambiar el multiplicador de esa tarifa.
- **Colchón de sobreconsumo (decidido):** si el cliente se queda sin créditos, puede seguir usando IA hasta un **5 % de los créditos del paquete mensual contratado** (ej. paquete de 25,000 → 1,250), **una sola vez por ciclo**, y esos créditos **se restan de la siguiente recarga**. Antes se le envían **2 avisos: al 20 % y al 5 % de saldo restante**. 🛠️ Hoy no existen avisos y el sistema bloquea el débito al llegar a cero; hay que agregar: tipo de notificación nuevo (en es/en/ko), umbrales, saldo permitido negativo con tope, y descuento en la siguiente recarga.
- Llamada WhatsApp: se cobra conexión (mín. US$0.10) + MXN 0.50 por minuto + transcripción + resumen. Llamada PSTN: solo transcripción + resumen.
- Llamadas de WhatsApp (solo entrantes): sin cargo de Meta; las cobramos nosotros en créditos.

## 5. Datos de costo ya medidos, para tu cálculo operativo

| Concepto | Costo | Fuente |
|---|---|---|
| Zernio, cuenta conectada (WhatsApp/Instagram/Facebook) | US$3/mes marginal entre la cuenta 11 y 100; US$6 entre la 3 y 10; US$1 después de la 100 | tarifas-ia-y-llamadas.md |
| Gasto real de Zernio (oct-2026) | US$57.11/mes (US$73.55 − US$16.44 de crédito) | tarifas-ia-y-llamadas.md |
| Regla de precio | Precio = costo × 2. Una cuenta conectada ≈ ≥ US$6 / MXN 110 al mes | tarifas-ia-y-llamadas.md |
| IA medida (30 días de una cuenta) | ≈ US$6 con modelos usados; ≈ US$0.88 con enrutamiento previsto | tarifas-ia-y-llamadas.md |
| Transcripción PSTN | ≈ US$0.006/min (provisional, sin validar) | tarifas-ia-y-llamadas.md |
| Llamada WhatsApp a destino SIP | ≈ US$0 en Zernio (sin grabación); grabación US$0.004/min | tarifas-ia-y-llamadas.md |
| Meta, llamada saliente a México | US$0.0094/min, factura directo al cliente | tarifas-ia-y-llamadas.md |

**Costos de telefonía y operación (del Excel del 5-nov, corregidos con lo que indicaste el 6-nov):**

| Concepto | Valor MXN | Nota |
|---|---|---|
| Extensión Yeastar | 300/mes | Del Excel; periodicidad por confirmar |
| DID | 200/mes | Del Excel; periodicidad por confirmar |
| Troncal | 3,000/mes | 30 % PBX Newgate / 70 % NexoOmni |
| Licencia Yeastar | 15,000/año (1,250/mes de reserva) | 50 % PBX / 50 % NexoOmni |
| Zernio por conexión | ≈ US$4/mes (≈ MXN 74.86 al FIX 18.7147) | Estimado; conciliar con factura. Mínimo observado de US$9 con 3 conexiones |
| Stripe | 3.6 % + $3 por cobro | Publicado; verificar |
| Infraestructura por cliente | **Sin medir** | Pendiente |

**Minuto PSTN saliente** (corrección del 6-nov; el Excel usaba como costo lo que en realidad es precio al cliente):

| Destino | Costo NexoOmni | Precio al cliente (excedente) |
|---|---|---|
| Fijo nacional | $0.17 | $0.22 |
| Móvil nacional | $0.31 | $0.40 |
| LDI EEUU/CAN | $0.41 | $0.53 |

Con estos valores el precio es ≈ 1.3 × el costo (margen ≈ 23 %), no ×2 ni ×3. Es decisión tuya; solo lo dejo anotado.

**No tengo en el repo** (no los invento): costo de infraestructura por cliente, Supabase/almacenamiento, soporte, ni precios de competidores.

## 6. Precios de los planes (en revisión)

Mensualidad por plan, MXN, sin IVA. **Precios de trabajo, aún no aprobados** (vienen del Excel y de lo que indicaste):

| Concepto | Plan 1 | Plan 2 | Plan 3 |
|---|---:|---:|---:|
| Precio mensual | $1,490 | $2,490 | **$3,090** (confirmado 6-nov; el Excel dice $3,990 y está desactualizado) |
| Usuarios incluidos | 2 | 2 | 2 (con telefonía, 1 DID y 500 min c/u) |
| Usuario adicional / mes | $700 | $1,200 | $1,500 (con telefonía y +500 min a la bolsa; no agrega DID) |
| Implementación (única vez, propuesta del Excel) | $3,000 | $5,000 | $8,000 |

Estimación de lo que queda de la mensualidad por cuenta antes de infraestructura, soporte, impuestos y tu remuneración. Supuestos: 3 conexiones Zernio (US$12), Stripe 3.6 % + $3, comisión comercial 18 %. Plan 3: costo fijo telefónico asignado $545 (reparto entre 5 cuentas, supuesto), 2 extensiones $600, 1 DID $200 y 1,000 min con el costo nuevo de troncal (fijo $170, móvil $310, LDI $410):

| | Plan 1 | Plan 2 | Plan 3 (fijo / móvil / LDI) |
|---|---:|---:|---:|
| Resto | ≈ $941 | ≈ $1,725 | ≈ $680 / $540 / $440 |

Estos números son cálculo preliminar mío con datos del Excel; **no incluyen** infraestructura por cliente (sin medir), IVA ni soporte. El Plan 3 a $3,090 con 100 % de minutos a LDI deja menos de $450 antes de esos costos.

## 7. Contrato y facturación

- **Contratación mínima de 12 meses, con contrato, en todos los planes.**
- **Pago anticipado total** (decidido): el precio mensual **no baja**; en lugar de descuento por anualidad se regalan meses:

| Paga | Recibe | Meses gratis |
|---|---|---|
| 12 meses | 13 | 1 |
| 24 meses | 26 | 2 |
| 36 meses | 42 | 6 |

- **Extras** (DID, conexiones, usuarios adicionales): **fijos**, se suman al cobro del plan (no son por consumo como IA y minutos). Si se contratan a mitad del año, la obligación **termina con el contrato vigente** y se pagan solo los meses que falten.
- **Baja de extras:** con aviso de **15 días antes del vencimiento del año**. Si cancelan antes, **pagan el remanente de los meses faltantes**. Motivo: el proveedor del DID (Convergia) no da de baja el número, así que NexoOmni se queda pagándolo.
- **Excedente de minutos PSTN:** se suma a la factura de la mensualidad del mes siguiente (decidido).
- IA: paquetes mensuales y créditos extra siguen como en la sección 4 (cobro aparte).

**Mecanismo de cobro (decidido 6-nov):** todo se cobra por **factura**. Al contratar se genera una factura por los meses contratados (12/24/36, con los meses gratis). Cualquier adicional contratado después (en meses o años posteriores) se cobra con **una factura nueva** por los meses que falten del contrato vigente, y **la misma regla aplica al cancelar** (se paga el remanente). El excedente de minutos va en la factura del mes siguiente.

🛠️ Hoy no existe este esquema de facturas en el código. Falta definir en el desarrollo: cómo se generan y cobran (Stripe Invoices u otro medio), cuándo se emiten las facturas de excedente y de paquetes IA con un plan prepagado, y el tratamiento fiscal (CFDI), que no he revisado.

## 8. Catálogo de extras (tienda)

Precios MXN de trabajo, sin IVA. Los de usuario y conexión ya fueron indicados; el resto vienen del Excel y están **por aprobar**:

| Extra | Costo | Precio | Frecuencia | Estado |
|---|---:|---:|---|---|
| Conexión adicional de canal (WhatsApp, Facebook o Instagram) | ≈ $74.86 | $150 | Mensual | Confirmado el 6-nov |
| Configuración de conexión extra | $375 | $750 | Una vez | Confirmado el 6-nov |
| Usuario adicional Plan 1 / 2 / 3 | — | $700 / $1,200 / $1,500 | Mensual | Confirmado el 6-nov |
| DID adicional | $200 | $400 | Mensual | Del Excel, por aprobar |
| Extensión adicional (usuario PBX administrativo, sin usuario NexoOmni) | $300 | $600 | Mensual | Del Excel, por aprobar |
| Canal SIP adicional | Pendiente | $200 por canal | Mensual | Precio confirmado, sin IVA; cantidad según lo contratado |
| Troncal SIP adicional | Pendiente | $200 por troncal | Mensual | Precio confirmado, sin IVA; cantidad según lo contratado |
| Conexión a infraestructura del cliente | Pendiente | $200 por conexión | Una vez | Precio confirmado, sin IVA |
| Minuto PSTN excedente fijo / móvil / LDI | $0.17 / $0.31 / $0.41 | $0.22 / $0.40 / $0.53 | Por consumo | Confirmado el 6-nov |
| Capacitación adicional (2 h) | $750 | $1,500 | Una vez | Del Excel, por aprobar |
| Desarrollo o integración especial | $375/h | $750/h | Por hora | Del Excel, por aprobar |

Los precios de $200 contemplan una ganancia del 20 % según lo indicado por el dueño; queda pendiente precisar si se calcula sobre el costo o sobre el precio final. Por eso no se establece todavía un costo ni un margen para estos conceptos. El costo de infraestructura por cliente de NexoOmni sigue sin medirse y es distinto del cobro único por conexión a infraestructura del cliente.

## 9. Pendientes de desarrollo (nada de esto existe hoy)

Orden sugerido y dependencias; todo con migración nueva, guardas en servidor **y** RLS, textos en es/en/ko, manual y changelog:

1. **Cambios de plan en código:** `yeastar_live_chat` activo en `basic`/`ai`; asientos incluidos = 2; entitlement `broadcasts` (Plan 2+); auditar rutas de IA (respuesta automática, base de conocimiento, Nexo Memory) para que queden apagadas en Plan 1.
2. **Límite de 1 conexión por plataforma** con validación al conectar y RLS, y su excedente comprable.
3. **IA ×3:** cambiar margen global y revisar tarifas fijas (sección 4).
4. **Colchón de 5 % + 2 avisos (20 % y 5 %)**; agotado el colchón, la IA se desactiva con mensaje de recarga; solo para clientes con paquete mensual.
5. **Bolsa de minutos PSTN:** contador mensual por cuenta con 500 × agentes, suma inmediata al agregar agente, descuento de minutos usados antes del primer día 1, y excedente por tipo de destino (la clasificación por prefijo de marcación está por verificar contra el CDR de Yeastar).
6. **Contratos y tienda de extras:** vigencia de 12/24/36 meses con meses gratis, baja con 15 días de aviso, cobro del remanente, catálogo de extras, cobro de la mensualidad (hoy fuera de Stripe en el código).

## 10. Preguntas abiertas

1. **Clasificación de destino PSTN (fijo/móvil/LDI):** el plan de marcación permite distinguir (por ejemplo, el prefijo 00 marca EEUU/Canadá y los demás por número o código). Pendiente verificar y definir contigo si el CDR de Yeastar entrega el número marcado completo para clasificar cada llamada.
2. **Costos aún sin definir:** costo para NexoOmni de canales y troncales SIP adicionales, de conexión a infraestructura del cliente y de infraestructura por cliente; precisar además la base de cálculo de la ganancia del 20 % sobre los conceptos de $200.
3. **Colchón de IA (decidido):** al agotarse se **desactivan las funciones de IA** y, al intentar usarlas, se muestra el mensaje "sin créditos de IA, favor de recargar". Aplica a los clientes con paquete mensual de 25, 50, 150 o 300 (US$). Quien solo compre créditos extra, sin paquete, no tiene colchón.
4. Cobro con facturas: definir mecanismo técnico y fiscal (ver sección 7).
