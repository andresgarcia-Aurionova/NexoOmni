# Plan: IA multi-proveedor, bolsa de créditos y Asistente por tenant

Estado: **Fases 0 y 1 implementadas; Fase 2 en preparación local.**
Fecha de la investigación de precios y modelos: 19-oct-2026.

### Estado de ejecución

- Fase 0: línea base agregada y exportaciones de OpenAI recibidas. Falta evaluar 50–100 casos anonimizados; `scripts/sql/ai-quality-sample.sql` prepara una muestra con redacción parcial, que requiere revisión humana antes de compartirla.
- Fase 1: catálogo y enrutamiento por tarea implementados con `AI_TASK_ROUTING_ENABLED=false` por defecto. Los candidatos nuevos no se activan hasta aprobar la evaluación.
- Fase 2: migración `151_ai_credit_wallet.sql`, cálculo entero en nanodólares y pruebas añadidos localmente. Falta aplicar/revisar la migración en desarrollo. `billing_mode` queda en `off`; todavía no se cobra ni se bloquea IA.
- El fallback entre OpenAI y Anthropic queda pendiente: cada `ai_configs` solo contiene una llave/proveedor; no se debe intentar el otro proveedor sin credencial y autorización de gasto.

## 1. Estado actual (leído del código)

| Tema                                     | Hoy                                                                                                                                                                                                                                                |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Proveedor                                | Uno por cuenta (OpenAI **o** Anthropic) en `ai_configs`. Código: `src/lib/ai/generate.ts`, `providers/openai.ts`, `providers/anthropic.ts`.                                                                                                        |
| Llaves                                   | **BYO**: cada cliente pone su llave (cifrada AES-256-GCM). Nosotros no pagamos ni cobramos IA.                                                                                                                                                     |
| Modelos por defecto                      | `gpt-5.4-mini` / `claude-haiku-4-5-20251001` (`src/lib/ai/defaults.ts`). Imagen `gpt-4.1-mini` y voz `gpt-4o-mini-transcribe` están **fijos en código** (`config.ts`, `media-analysis.ts`, worker `ai-analysis-worker/route.ts`, `ai-config.tsx`). |
| Consumo                                  | `ai_usage_log` guarda tokens y modelo, **sin costo ni precio**.                                                                                                                                                                                    |
| Asistente de chat / reportes a la medida | No existen.                                                                                                                                                                                                                                        |
| Facturación                              | `account_subscriptions` + `entitlements.ts` (planes `ai`, `yeastar_voice`, `whatsapp_voice`). No hay cobro por uso.                                                                                                                                |
| Última migración                         | `150_ai_usage_latency.sql` → la siguiente es la **151**.                                                                                                                                                                                           |

## 2. Modelos vigentes y precios oficiales (USD por 1M tokens)

Fuentes: `developers.openai.com/api/docs/pricing` y `/models/*`; `platform.claude.com/docs/en/models/*`.

| Modelo                | ID de API           | Entrada | Salida | Notas verificadas                                                                                                        |
| --------------------- | ------------------- | ------- | ------ | ------------------------------------------------------------------------------------------------------------------------ |
| GPT-6 Luna            | `gpt-6-luna`        | 0.10    | 0.50   | "Más eficiente para alto volumen". Chat Completions ✔, imagen ✔, **sin** audio/embeddings.                               |
| GPT-5.6 Terra         | `gpt-5.6-terra`     | 2.00    | 12.00  | Equivale al nivel "mini" de GPT-5. Chat Completions ✔.                                                                   |
| GPT-5.4 Mini (actual) | `gpt-5.4-mini`      | 0.75    | 4.50   | Es lo que usamos hoy como default.                                                                                       |
| Claude Haiku 5.5      | `claude-haiku-5-5`  | 0.10    | 0.50   | Clasificación, extracción, ruteo. Sube a 0.50/2.50 con prompts >100k tokens. Tokenizador ≈30 % más tokens que Haiku 4.5. |
| Claude Sonnet 5.5     | `claude-sonnet-5-5` | 2.00    | 10.00  | Rápido, 1M contexto. Retiro no antes de 28-sep-2027.                                                                     |
| Claude Opus 5.5       | `claude-opus-5-5`   | 4.00    | 20.00  | Para casos que Sonnet no resuelva.                                                                                       |

Reglas de precio que afectan el cálculo: caché de entrada a 10 % (OpenAI) / 5–10 % (Claude); Batch/Flex al 50 %; en OpenAI, prompts >272K tokens cuestan 2× entrada y 1.5× salida.

**Hallazgo principal:** con los modelos nuevos, lo que hoy gasta `gpt-5.4-mini` baja entre **72 % y 88 %** sin salir de la gama "mini" (ver §4). Es decir, se puede subir de generación y _bajar_ costo.

## 3. Propuesta de enrutamiento por tarea

Criterio acordado: **calidad + precisión + precio razonable**, no "lo más barato". Por eso la propuesta es una _lista de candidatos_ que se confirma con una evaluación (ver Fase 0); no se fija por intuición.

| Tarea                                                | Candidato principal                   | Alternativa / respaldo | Motivo                                                     |
| ---------------------------------------------------- | ------------------------------------- | ---------------------- | ---------------------------------------------------------- |
| Borrador y auto-respuesta (cara al cliente, español) | `gpt-6-luna`                          | `claude-haiku-5-5`     | Alto volumen, tono y seguridad del handoff. Evaluar ambos. |
| Análisis de conversación, sentimiento, QA, memoria   | `claude-haiku-5-5`                    | `gpt-6-luna`           | Extracción estructurada.                                   |
| Resumen de llamada (transcripción larga)             | `claude-haiku-5-5`                    | `gpt-5.6-terra`        | Entradas largas, salida estructurada.                      |
| Descripción de imagen                                | `gpt-6-luna`                          | `gpt-4.1-mini`         | Luna acepta imagen; ≈72 % más barato.                      |
| Transcripción de voz                                 | `gpt-4o-mini-transcribe` (sin cambio) | `gpt-4o-transcribe`    | Luna/Terra **no** soportan `/audio/transcriptions`.        |
| Embeddings (base de conocimiento)                    | sin cambio                            | —                      | Luna/Terra no soportan embeddings.                         |
| Asistente: preguntas simples y ruteo                 | `gpt-6-luna` / `claude-haiku-5-5`     | —                      | Barato; decide si escala.                                  |
| Asistente: datos, reportes, acciones                 | `claude-sonnet-5-5`                   | `gpt-5.6-terra`        | Razonamiento + uso de herramientas; precisión en cifras.   |

El enrutamiento actual selecciona un modelo para el proveedor ya configurado. No hay fallback automático al otro proveedor: la configuración actual solo contiene una llave y un cambio tras un timeout podría generar una segunda llamada facturable.

**Puntos a verificar en la evaluación (no asumidos):**

1. `gpt-6-luna` tiene razonamiento (esfuerzo por defecto `medium`); en Chat Completions los tokens de razonamiento cuentan dentro de `max_completion_tokens`. Nuestro `MAX_OUTPUT_TOKENS = 1024` podría truncar o encarecer respuestas → probar con esfuerzo `low`/`none`.
2. Calidad real en español de WhatsApp (tono, handoff correcto) — comparar con 50–100 conversaciones reales anonimizadas, medidas contra el modelo actual.
3. Precio de transcripción por minuto: **no pude confirmarlo** en la página consultada; hay que leerlo antes de fijar créditos de voz.

## 4. Costo por actividad (estimado) y precio al cliente

Supuestos de tokens (entrada/salida, incluye razonamiento): **estimaciones mías** que se reemplazan en Fase 0 con las medianas reales de `ai_usage_log`. Haiku 5.5 con +30 % de tokens.

| Actividad                          | Tokens (in/out) | Modelo            | Costo real USD | Hoy (gpt-5.4-mini) | Precio ×2 USD | Precio ×2 MXN* |
| ---------------------------------- | --------------- | ----------------- | -------------- | ------------------ | ------------- | -------------- |
| Auto-respuesta / borrador          | 4,000 / 600     | luna              | 0.00070        | 0.00570            | 0.00140       | 0.026          |
| Análisis de conversación           | 3,000 / 700     | haiku 5.5         | 0.00085        | 0.00540            | 0.00170       | 0.031          |
| Resumen de llamada                 | 8,000 / 800     | haiku 5.5         | 0.00156        | 0.00960            | 0.00312       | 0.057          |
| Imagen                             | 1,500 / 300     | luna              | 0.00030        | 0.00108            | 0.00060       | 0.011          |
| Asistente, pregunta simple         | 8,000 / 400     | luna              | 0.00100        | —                  | 0.00200       | 0.037          |
| Asistente, consulta con datos      | 20,000 / 1,200  | sonnet 5.5        | 0.05200        | —                  | 0.10400       | 1.92           |
| Reporte a la medida                | 30,000 / 3,000  | sonnet 5.5        | 0.09000        | —                  | 0.18000       | 3.32           |
| Transcripción Yeastar (por minuto) | Por medir       | gpt-4o-transcribe | No confirmado  | —                  | No confirmado | —              |

\* FX usado: **18.4253 MXN/USD** (FIX de Banxico del 19-oct-2026, tomado de una búsqueda web; **no verificado contra Banxico** — el sistema debe leer el tipo de cambio de una tabla/ajuste, no del código).

Ejemplo mensual de una cuenta mediana (3,000 auto-respuestas, 1,500 análisis, 200 resúmenes de llamada, 300 imágenes, 150 consultas simples, 50 con datos, 10 reportes): **costo ≈ US$7.42; precio ×2 ≈ US$14.84 (14,840 créditos) ≈ MXN 273.43 (≈ MXN 317.17 con IVA)**. Lo que hoy cuesta solo la parte existente de ese mismo uso con `gpt-5.4-mini` es ≈ US$27.44 vs ≈ US$3.77 con el enrutamiento nuevo.

### Regla de ganancia (DECIDIDA): margen del 50 % sobre el precio

> De cada US$2 que paga el cliente, US$1 es costo real del proveedor y US$1 es ganancia.

```
precio al cliente = costo real / (1 − 0.50) = costo real × 2
```

Esto aplica a **todo** consumo (IA, minutos de llamada, transcripción): **el multiplicador vigente es ×2**; se guarda en `ai_billing_settings` (no en código).

**Unidad de crédito (interpretación del ejemplo del cliente):** US$1 de compra = **1,000 créditos**; por tanto **1 crédito = US$0.001 de precio = US$0.0005 de costo real**. El crédito es una unidad de _dinero_, no de tokens: los tokens valen distinto en cada modelo, así que "1,000 tokens por dólar" no puede ser fijo.

**Precisión contable de Fase 2:** los importes por llamada se guardan en nanodólares enteros; el costo, el precio y los créditos se redondean hacia arriba. Así se evitan errores de coma flotante y subcobros por fracciones de centavo. Los precios por modelo no se inicializan hasta validar tarifas oficiales vigentes.

**Exportaciones de OpenAI compartidas el 19-oct-2026:** el reporte de costos suma **US$5.60164045** en el periodo exportado. El reporte de uso registra 2,288 solicitudes: 1,548 `gpt-5.4-mini`, 58 `gpt-4.1-mini`, 41 `gpt-5.6-sol`, 640 `gpt-4o-transcribe` y 1 `gpt-4o-mini-transcribe`. Esto incluye tráfico que la consulta de `ai_usage_log` no cubría; por eso el estimado anterior de US$4.97 no representa el gasto total de la cuenta. El export de costos no separa importes por modelo/llave y el de transcripción no informa minutos facturables, así que no se fija aún costo por minuto. Yeastar confirma en la captura `gpt-4o-transcribe` para transcribir y `gpt-5.6-sol` para su LLM.

**Ejemplo exacto — compra de US$50:**

| Concepto                          | Valor                                            |
| --------------------------------- | ------------------------------------------------ |
| Créditos acreditados              | 50 × 1,000 = **50,000**                          |
| Presupuesto de costo real (50 %)  | **US$25.00**                                     |
| Ganancia bruta si se consume todo | **US$25.00**                                     |
| Alerta del 10 %                   | al quedar **5,000** créditos (US$5.00 de precio) |
| En MXN (FIX 18.4253, referencia)  | MXN 921.26; con IVA 16 % → MXN 1,068.67          |

**Cuántos tokens da 1 crédito** (1 crédito = US$0.0005 de costo):

| Modelo                           | Tokens de entrada | Tokens de salida | Precio al cliente por 1M entrada / salida |
| -------------------------------- | ----------------- | ---------------- | ----------------------------------------- |
| gpt-6-luna, claude-haiku-5-5     | 5,000             | 1,000            | 200 / 1,000 créditos                      |
| claude-sonnet-5-5                | 250               | 50               | 4,000 / 20,000 créditos                   |
| gpt-5.6-terra                    | 250               | 42               | 4,000 / 24,000 créditos                   |
| gpt-5.4-mini (referencia actual) | 667               | 111              | 1,500 / 9,000 créditos                    |

Ejemplo: una auto-respuesta de 4,000 tokens de entrada y 600 de salida en Luna cuesta US$0.0007, se cobra US$0.0014 = **1.4 créditos**; con US$50 alcanzan ≈ **35,714** respuestas.

**Aritmética sin margen de error (implementación):**

- Todo en **enteros**, nunca `float`: precios del proveedor en **micro-USD por millón de tokens** (Luna: 100,000 entrada / 500,000 salida).
- `costo_micro = CEIL((tokens_in × precio_in + tokens_out × precio_out) / 1,000,000)` — se redondea **hacia arriba**, a favor de la plataforma, una sola vez por llamada.
- `precio_micro = costo_micro × 2`; `créditos = precio_micro / 1,000` (se guarda en micro-USD; la pantalla muestra créditos con 3 decimales).
- Se guarda por llamada: tokens, precio unitario usado, versión de precios, tipo de cambio y ambos importes, para poder auditar cualquier cobro.
- Pruebas unitarias con casos fijos (el ejemplo de arriba: 4,000/600 en Luna ⇒ costo 700, precio 1,400 micro-USD).

**Lo que la regla ×2 NO incluye** (hay que decidir si se traslada al cliente): comisión de la pasarela (f), IVA, pérdida por tipo de cambio y costos fijos. Si la pasarela cobra f, el margen neto sobre lo que realmente recibes baja: con f = 4 %, un paquete de US$50 deja 50 − 2 − 25 = **US$23** (no 25). Para conservar US$25 netos el paquete debe costar `2 × costo / (1 − f)` = **US$52.08** por los mismos 50,000 créditos. Y como el cliente paga en MXN, el precio del paquete en pesos debe calcularse con el FIX del día más un colchón (p. ej. 2 %) para no perder por variación cambiaria. Los créditos quedan fijos en USD; solo el precio en pesos se recalcula.

## 5. Diseño de la bolsa de créditos

**Principios:** el saldo nunca se calcula con floats; el cobro es atómico e idempotente; si falta saldo, el sistema degrada de forma segura.

### 5.1 Unidad

- Contabilidad interna en **micro-USD** (`bigint`, 1 = US$0.000001) → exacto, sin redondeos acumulados.
- Se muestra al cliente en **créditos**: propuesta **1 crédito = US$0.001 de precio al cliente** (una auto-respuesta ≈ 1 crédito; una consulta con datos ≈ 78; un reporte ≈ 135). Equivalente en MXN al tipo de cambio de la compra.
- Paquetes de ejemplo (a confirmar): 5,000 / 20,000 / 100,000 créditos.

### 5.2 Tablas (migraciones nuevas ≥ 150, una por cambio)

- `ai_model_pricing`: modelo, proveedor, `input_per_mtok`, `output_per_mtok`, `cached_input_per_mtok`, vigencia, versión. Los precios cambian: **no van en código**.
- `ai_billing_settings`: multiplicador, tipo de cambio USD→MXN (con fecha/fuente), margen de seguridad.
- `ai_credit_wallets`: `account_id` PK, saldo en micro-USD, umbral de aviso, modo (`byo` | `credits`).
- `ai_credit_ledger` (solo inserción): compra, consumo, reembolso, ajuste, regalo, vencimiento; `idempotency_key` único; `balance_after`.
- `ai_credit_packs`: catálogo de paquetes.
- Extender `ai_usage_log` (el `CHECK` de `mode` se redefinió en las migraciones 039, 071 y 087: partir de la **087**, la más reciente, y agregar los modos nuevos como `assistant` sin perder los existentes): agregar `task`, `cost_micro`, `price_micro`, `fx_rate`, `pricing_version`, `billed`. La migración 150 agrega `latency_ms` para la línea base de rendimiento.
- Función SQL `ai_credit_debit(...)` `SECURITY DEFINER` con bloqueo de fila: valida saldo y descuenta en una sola transacción. Para llamadas largas (asistente/reportes): **reservar** el máximo estimado y **liquidar** con el uso real.
- RLS: wallet y ledger legibles para `supervisor+` de la cuenta; **escritura solo con service role** (se documenta con comentario en la migración para que no parezca un olvido).

### 5.3 Flujo de cada llamada de IA

1. `generateForTask(task, ctx)` resuelve el candidato del catálogo para el proveedor y la llave configurados actualmente. Las llaves administradas por la plataforma corresponden a una fase posterior; nunca se exponen con `NEXT_PUBLIC_*`.
2. Revisa saldo → llama al proveedor → calcula costo real con tokens reportados → debita → registra en `ai_usage_log` y ledger.
3. Sin saldo: auto-respuesta **entrega a un humano** (comportamiento seguro ya existente), análisis se pone en pausa/cola, asistente avisa y ofrece recargar. Nunca falla en silencio.
4. Avisos de saldo bajo (80 % / 95 % / 0 %) vía el sistema de notificaciones (agregar el tipo nuevo hará fallar `tsc` en los `Record<NotificationType, …>` hasta completarlos — es la red de seguridad).

### 5.4 Compra y cobro

- **Pasarela: sin definir.** El diseño es independiente de la pasarela: una interfaz `PaymentProvider` y un solo punto de entrada (`credit_purchase`) que acredita por `idempotency_key`. Mientras no haya pasarela, la acreditación puede hacerla el super administrador a mano (transferencia/SPEI) desde el panel de plataforma, con bitácora. Candidatas a evaluar con tu contador: Stripe, Mercado Pago, Conekta/Openpay.
- **Vencimiento: mensual.** Interpretación a confirmar: los créditos se acreditan por periodo mensual y **los no usados vencen al cierre del mes** (sin acumulación). Implicaciones: el ledger registra un asiento `expiration` al cierre; la pantalla debe mostrar claramente fecha de vencimiento _antes_ de comprar; y el vencimiento de saldo prepagado en México puede tener implicaciones de la Ley Federal de Protección al Consumidor → **validar con asesoría legal antes de lanzar**. La alerta del 10 % se mide contra los créditos del periodo vigente.
- La acreditación solo ocurre desde el webhook verificado de la pasarela (o la acción manual auditada), con `idempotency_key` = id del pago.

### 5.5 Migración de clientes existentes (DECIDIDO: migran todos)

- **Todos** los clientes pasan a llaves de la plataforma y créditos; se elimina el modo BYO. Consecuencias que hay que planear: (a) cada cliente necesita saldo inicial antes del corte o su IA se detiene; (b) las llaves BYO guardadas (`ai_configs.api_key`) dejan de usarse — se conservan cifradas unos días como respaldo y luego se borran de forma auditada; (c) comunicación previa al cliente, con fecha de corte.
- Modo **sombra** 2 semanas antes del corte: se calcula y registra costo/precio sin debitar, para validar supuestos y mostrar al cliente su consumo estimado.
- **Datos (DECIDIDO: aprobado):** los datos pasan por cuentas de Aurionova. Acciones: actualizar aviso de privacidad y términos, y revisar la retención/entrenamiento de datos de cada proveedor (solo lo documentado por ellos; no se asume).

## 6. Asistente por tenant ("Nexo Asistente")

### 6.1 Alcance

- Responde dudas de la plataforma y de la operación del cliente; genera **reportes a la medida** con sus datos; propone **acciones con confirmación**.
- **Supervisor, administrador y owner** (`requireRole('supervisor')`; `owner` accede por jerarquía). Nunca comparar strings de rol.
- Nuevo entitlement `ai_assistant` en `entitlements.ts` (el mapa `PLAN_FEATURES` es exhaustivo: `tsc` marcará cada lugar).
- Aislamiento por tenant: **todas las herramientas usan el cliente Supabase con RLS del usuario**, nunca service role, y `account_id` jamás viene de la entrada del modelo. Aunque el modelo se equivoque o sea manipulado, RLS bloquea datos de otra cuenta.

### 6.2 Herramientas (el modelo no escribe SQL)

- **Lectura:** KPIs del dashboard, rendimiento de agentes (supervisión), pipelines/ventas, difusiones, llamadas, citas, contactos (con límite), consumo y saldo de créditos.
- **Reportes:** una herramienta `build_report` que recibe una especificación validada con zod (métrica, dimensión, filtros, rango de fechas, límite de filas) de una **lista cerrada**; devuelve tabla/gráfica y permite exportar con el módulo existente de reportes ejecutivos. Se pueden guardar reportes.
- **Ayuda:** búsqueda sobre `docs/manuals/` (base global de la plataforma, solo lectura) y la base de conocimiento propia del tenant.
- **Acciones (v1):** crear tarea, agregar/quitar etiqueta, agregar nota, reasignar conversación. **Fuera de la v1:** enviar mensajes, difusiones, borrar datos.
- **Confirmación obligatoria:** el modelo solo _propone_ la acción; se guarda en `assistant_pending_actions` (con vencimiento, ligada al usuario y a un hash de parámetros). La UI muestra una tarjeta "Confirmar/Cancelar"; al confirmar, el **servidor** la ejecuta con los permisos del usuario y su rol mínimo propio. El modelo no puede confirmar. Todo queda en una bitácora de auditoría.

### 6.3 Seguridad (puntos críticos)

- Contenido de clientes (mensajes, notas, nombres) = **dato no confiable**: va marcado como tal en el prompt y las herramientas de acción exigen confirmación humana, así una inyección de prompt no puede ejecutar nada sola.
- Límites por turno (máx. iteraciones de herramientas, máx. filas, máx. tokens) y tope mensual de créditos configurable por la cuenta.
- Respuestas de error genéricas al usuario (`toErrorResponse`), sin filtrar mensajes del proveedor.
- Rate limit por usuario (`checkRateLimit`).

### 6.4 Datos y UI

- `assistant_threads`, `assistant_messages` (RLS por cuenta + usuario), `assistant_pending_actions`, `assistant_audit`. Todas con RLS y política explícita.
- Panel flotante en el dashboard, con streaming; visible solo si el rol y el entitlement lo permiten.
- Textos en `messages/{es,en,ko}.json`; manual nuevo `docs/manuals/agentes-ia/asistente.md` y entrada en `docs/manuals/changelog/2026-10.md`.

## 6bis. Tarificador de consumo (créditos vs costo en pesos, con conciliación)

Objetivo: que cada tenant vea su consumo (IA, llamadas, transcripción) en créditos y en pesos, reciba alertas, y que **tú** puedas comparar lo que calculamos contra lo que facturan los proveedores.

### Dos capas (importante para no cobrar de más ni de menos)

1. **Cobro en línea (fuente de verdad del saldo):** se calcula por llamada con los tokens que devuelve el proveedor (§4). Es inmediato y no depende de APIs de reporte.
2. **Conciliación diaria (control):** un job compara nuestro ledger con el consumo real que reportan los proveedores por tenant. Si la diferencia pasa de un umbral (p. ej. 2 %), alerta al super administrador. No modifica saldos automáticamente.

### Una llave por tenant, administrada solo por el super administrador

El cliente **nunca** ve ni captura llaves. Verificado en documentación oficial:

- **OpenAI:** `GET /v1/organization/usage/completions` (y la API de costos) acepta `project_ids` y `api_key_ids` y agrupa por `project_id`; requiere una **Admin Key** de la organización. → un **proyecto + llave por tenant**.
- **Anthropic:** `GET /v1/organizations/usage_report/messages` filtra por `api_key_ids` y `workspace_ids` y agrupa por modelo/workspace; requiere **Admin API key** (`sk-ant-admin…`) y una organización (no cuenta individual). → un **workspace o llave por tenant**.
- Las llaves por tenant se guardan **cifradas** (mismo mecanismo AES-256-GCM) en una tabla solo-service-role (`tenant_provider_keys`: tenant, proveedor, id de proyecto/workspace, id de llave, estado), administrada desde el panel de plataforma; se pueden revocar por tenant (corte instantáneo si se agota el saldo o hay abuso). Las Admin Keys viven solo en variables de entorno del servidor.
- Beneficio extra: aislamiento de consumo y de límites de tasa por cliente.
- **Por verificar antes de programar:** latencia de los reportes de uso (no confirmada en la documentación revisada), automatización de la creación de proyectos/llaves por API (hoy asumo alta manual desde el panel de cada proveedor) y límites del número de proyectos/workspaces.

### Llamadas de WhatsApp (Zernio)

Verificado en `docs.zernio.com`:

- `GET /v1/usage/calls` devuelve llamadas, contestadas, **minutos**, `billableUSD` (lo que cobra Zernio) y `metaUSD` (cargo por minuto de Meta, solo informativo; "se factura directo a tu WABA"). Filtra por `number` y agrupa por día/número/canal; coincide con la factura.
- `GET /v1/usage` con `range`/`groupBy=profile|account` da gasto facturado por perfil o cuenta (prorrateado para que cuadre exacto con la factura); ya existe `zernio_profiles(account_id → profile_id)` en el repo.
- `GET /v1/calls` lista cada llamada para el detalle por cliente.
- **Atribución:** número de WhatsApp ↔ tenant (ya guardado en la conexión del canal) y perfil ↔ tenant (`zernio_profiles`).
- **Pendiente de decidir:** `metaUSD` solo es costo tuyo si el WABA es de Aurionova; si el WABA es del cliente, Meta se lo cobra a él y **no debe entrar al crédito**. Cobrar al cliente `billableUSD × 2` (+ `metaUSD × 2` solo si el WABA es tuyo).
- No hay un endpoint documentado de "saldo restante por tenant" en Zernio: el saldo por cliente es nuestro (ledger); Zernio aporta el costo real para comparar.

### Transcripción de llamadas (Yeastar compartida)

Lo que ya existe en el repo y resuelve la atribución **sin depender de la clave**:

- `yeastar_monitoring_configs.extension_filter` (migración 149) declara qué extensiones pertenecen a cada tenant en la central compartida, y las llamadas/transcripciones solo se aceptan para ese rango.
- `yeastar_call_transcriptions` ya guarda `account_id`, `started_at`, `duration_seconds`, `direction`, `transcription_status`. Por tanto **llamadas y minutos por tenant ya se pueden sumar** con `SUM(duration_seconds)` por mes y cuenta.
- `fetchCdrDetail` ya lee del CDR de Yeastar `call_duration`, `talk_duration`, `ring_duration`, etc. → se puede facturar sobre `talk_duration` (tiempo hablado) en vez de la duración total.
- Conciliación contra el CDR de Yeastar (consulta de CDR de su OpenAPI): total de llamadas/minutos de la central vs suma de los tenants; la diferencia = llamadas sin tenant (fuera de todos los rangos) → alerta.

**Costo de transcripción — actualización del dueño del producto:** Yeastar no cobra por usar la transcripción; la PBX utiliza una llave de OpenAI configurada para generar el texto. La captura confirma `gpt-4o-transcribe`. El reporte compartido registra solicitudes y tokens de audio, pero no minutos ni costo por modelo; por eso aún no se puede deducir una tarifa exacta por minuto. NexoOmni ingiere después el resultado desde Yeastar, pero no observa la llamada a OpenAI ni registra sus tokens. Si todos los tenants comparten una sola llave, OpenAI no separa el gasto por tenant y el costo individual será una estimación prorrateada por duración hasta habilitar credenciales o proyectos separados. El estimado previo US$0.003/min queda retirado y no debe cobrarse como exacto.

### Pantallas y alertas

- **Cliente (supervisor/admin/owner):** saldo en créditos y en MXN estimado, consumo del mes por actividad (respuestas, análisis, llamadas, transcripción, asistente), proyección de agotamiento, historial de recargas.
- **Alertas** (notificaciones del sistema + correo): **10 % restante** (la solicitada), y recomendadas 25 % y 0 %. Al llegar a 0: auto-respuesta se transfiere a humano, análisis en pausa y el asistente avisa; nunca falla en silencio.
- **Super administrador (panel de plataforma):** consumo por tenant, margen real (precio cobrado − costo real conciliado), diferencias contra proveedores, llaves por tenant, tipo de cambio y precios vigentes, alta manual de créditos.
- Conversión a pesos: tabla `ai_billing_settings` con FIX y fecha de captura (la fuente debe ser Banxico; **definir cómo se actualiza**: manual diario o API de Banxico con token).

## 7. Fases (un PR pequeño por fase)

| Fase | Entrega                                                                                                                                                                                                                                              | Validación                                                                              |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 0    | Línea base: medianas/p95 de tokens y latencia por modo/modelo desde `ai_usage_log`; evaluación ciega de 50–100 casos anonimizados; conciliación de la transcripción de Yeastar con el uso real de OpenAI y confirmación de FX.                       | Ejecutar SQL en Supabase de desarrollo, informe de calidad/costo y decisión de modelos. |
| 1    | Catálogo de modelos y `generateForTask`; rutas por tarea; salida registra proveedor, modelo y latencia; candidatos opt-in con `AI_TASK_ROUTING_ENABLED`. Fallback cruzado se aplaza hasta guardar/proveer ambas llaves.                              | Pruebas unitarias, `tsc`, `lint`; activar solo tras aprobar Fase 0.                     |
| 2    | Precios, ajustes, wallet a saldo cero, ledger, débito atómico e idempotente, extensión de `ai_usage_log` y aritmética entera. La base admite `off` / `shadow` / `enforced`, con modo `off` por defecto hasta completar recargas y llaves por tenant. | Pruebas + aplicación y validación manual de RLS en base de desarrollo.                  |
| 2b   | Llaves por tenant (`tenant_provider_keys`, panel de plataforma) y **conciliación diaria** con OpenAI/Anthropic.                                                                                                                                      | Revisión humana (secretos/RLS); cuadre contra un mes real.                              |
| 2c   | Consumo de llamadas: Zernio (`/v1/usage/calls`) y Yeastar (minutos por tenant desde `yeastar_call_transcriptions`/CDR); costo de transcripción cuando se confirme el contrato.                                                                       | Cuadre contra la factura de Zernio y el CDR.                                            |
| 3    | Paquetes, compra (manual o pasarela), vencimiento mensual, pantalla de saldo/consumo, alertas 25/10/0 %, corte seguro sin saldo; manual.                                                                                                             | Revisión humana (facturación/RLS/legal).                                                |
| 3b   | Corte de clientes BYO → créditos: saldo inicial, aviso previo, retiro de llaves BYO.                                                                                                                                                                 | Plan de salida revisado con el cliente.                                                 |
| 4    | Asistente v1 solo lectura + ayuda de plataforma.                                                                                                                                                                                                     | Pruebas de aislamiento entre tenants.                                                   |
| 5    | Reportes a la medida y exportación.                                                                                                                                                                                                                  | Cifras verificadas contra consultas conocidas.                                          |
| 6    | Acciones con confirmación + auditoría.                                                                                                                                                                                                               | Pruebas de inyección de prompt.                                                         |

Cada fase cierra con `npx tsc --noEmit`, `npm run lint`, `npm test`, manual y changelog. Las fases 2, 3 y 6 requieren **revisión humana** (RLS, facturación, datos de producción), según la guía de desarrollo §5.5.

## 8. Decisiones pendientes

**Decidido (19-oct-2026):** margen del 50 % (×2); 1 US$ = 1,000 créditos; todos los clientes migran a créditos con llaves de la plataforma; `owner` puede usar el asistente; datos por cuentas de Aurionova aprobado; vencimiento mensual; una llave/proyecto por tenant administrada por el super administrador.

**Decidido (turno 2):**

- La comisión de la pasarela **se traslada al cliente**: precio de pago = precio del paquete / (1 − f).
- Planes: **Plan 1** sin IA ni créditos; **Plan 2** = Plan 1 + IA con créditos; **Plan 3** = Plan 2 + llamadas PSTN y de WhatsApp. El costo de Meta/Zernio de las llamadas va incluido en la renta mensual: **no se debita de créditos** (Zernio/Meta solo se leen para medir el margen real). Entitlement nuevo `ai_credits` (planes 2 y 3).
- Transcripción de llamadas Yeastar: Yeastar no cobra; el costo es el de la llave OpenAI configurada en la central. La PBX usa `gpt-4o-transcribe`, pero su costo real por minuto y su atribución por tenant siguen pendientes de conciliación. El estimado anterior de US$0.003/min y 6 créditos/min queda retirado; no se configura ni se cobra hasta contar con minutos facturables y costos conciliados. Minutos por tenant: `yeastar_call_transcriptions` (extension_filter de la migración 149).
- Tipo de cambio **automático** vía API SIE de Banxico (serie SF43718, token gratuito, cron diario); sin captura manual.

**Abiertas:**

1. Comisión real de Stripe México: no pude leerla en su sitio. Se calcula con la fórmula `cobro = (precio_paquete + fijo) / (1 − porcentaje)` y ambos valores viven en `ai_billing_settings`; confirmar contra el Dashboard de Stripe (la comisión + IVA sobre la comisión). Cobro en MXN con FIX de Banxico del día.
2. Confirmar que los créditos no usados vencen al cierre del mes (validar con asesoría legal).
3. ¿Se incluye en la v1 el escalamiento a soporte humano desde el asistente?

**Decidido (turno 3):** pasarela **Stripe** (Checkout + webhook firmado, acreditación idempotente); paquetes sin bonos: Inicio US$10 / 10,000, Crecimiento US$25 / 25,000, Pro US$50 / 50,000, Empresa US$100 / 100,000 créditos; token de Banxico disponible (va en variable de entorno del servidor, nunca en el repo).
