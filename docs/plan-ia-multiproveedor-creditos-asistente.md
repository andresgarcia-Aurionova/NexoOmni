# Plan: IA multi-proveedor, bolsa de créditos y Asistente por tenant

Estado: **Fases 0, 1, 2 y B1 implementadas. El usuario confirmó en producción la pantalla de saldo/historial y las alertas 10 %/5 %, incluida la migración 164. El resumen mensual y el equivalente estimado en MXN están implementados localmente con la migración 165. El usuario confirmó la migración 166 en la base operativa; la integración de Checkout y el webhook están implementados localmente. Esta actualización agrega la configuración central cifrada test/live con la migración 167, aún no aplicada ni desplegada. Checkout permanece apagado por defecto; falta desplegar, validar modo test y revisar impuestos/precios antes de habilitar cobros reales.**
Fecha de la investigación de precios y modelos: 19-oct-2026.

### Estado de ejecución

- Fase 0: línea base agregada y exportaciones de OpenAI recibidas. Falta evaluar 50–100 casos anonimizados; `scripts/sql/ai-quality-sample.sql` prepara una muestra con redacción parcial, que requiere revisión humana antes de compartirla.
- Fase 1: catálogo y enrutamiento por tarea implementados con `AI_TASK_ROUTING_ENABLED=false` por defecto. Los candidatos nuevos no se activan hasta aprobar la evaluación.
- Fase 2: la migración `151_ai_credit_wallet.sql` y el cálculo entero en nanodólares establecieron la billetera, precios y ledger. La implementación local de `158_enforced_usage_billing.sql` fija `billing_mode = 'enforced'`: el código valida el precio antes de llamar al proveedor y registra uso/débito atómicamente después de recibir los tokens. La migración 160 evita que un débito exceda el saldo; la migración 161 agrega precios faltantes para `gpt-4.1-mini`, los modelos de transcripción, embeddings y `claude-haiku-4-5-20251001`. `gpt-5.6-sol` corresponde a Yeastar/PBX y no se factura como una llamada de modelo desde NexoOmni. Antes de producción hay que revisar los precios y probar las migraciones en una base de desarrollo.
- Cobro real: IA se bloquea antes de nuevas solicitudes cuando el saldo vigente llega a cero. La integración de Zernio desactiva los números que estaban habilitados y los reactiva al acreditarse saldo, sin habilitar números que ya estaban apagados. El worker reintenta las sincronizaciones; las llamadas que ya estaban en curso pueden terminar y el cargo se registra al recibir `call.ended`. El usuario confirmó en producción el portal de saldo, la pausa/reactivación por saldo y el vencimiento por lote con las migraciones relacionadas hasta la 164; la migración 165 de esta actualización aún requiere validación. La prueba de credenciales también consume créditos. Si no se confirma el débito de IA, el resultado no se entrega. La conversión de llamadas usa Banxico SIE serie SF43718; el token se administra cifrado desde el panel de plataforma (migración 159), con `BANXICO_API_TOKEN` como alternativa.
- Fase A de cobertura: se registran los tokens reportados de transcripciones de notas de voz, análisis de imágenes y embeddings, además de las tareas de texto existentes. La transcripción Yeastar de llamadas sigue pendiente.
- Fase B1: el panel interno permite registrar abonos manuales idempotentes y consultar saldos, movimientos y uso mensual por cliente. La migración `154_platform_ai_credit_management.sql` añade la operación SQL segura. Con la migración 158, IA y llamadas de WhatsApp ya generan débitos efectivos. El flujo de Stripe está implementado localmente, pero las recargas manuales siguen disponibles hasta desplegar y validar Checkout.
- Fase B2: el panel interno administra y verifica llaves OpenAI y Anthropic por tenant; el cliente conserva los ajustes de comportamiento, pero no recibe proveedor, modelo ni credenciales. El usuario confirmó en producción que la migración `155_platform_ai_provider_credentials.sql` existe, que los permisos esperados se aplican y que no faltan llaves de chat ni embeddings. El despliegue de la aplicación no está confirmado. Guardar Anthropic no cambia el proveedor activo ni habilita el enrutamiento automático. `AI_TASK_ROUTING_ENABLED` sigue apagado hasta aprobar la evaluación ciega.
- Fase 2c y cobro de llamadas: el panel interno consulta las llamadas Zernio por tenant. `call.ended` registra cada llamada y debita idempotentemente el `billableCostUSD` de Zernio con margen del 50 % (×2), más MXN $0.50 por minuto iniciado de llamadas contestadas. El FIX se obtiene de Banxico; `metaUSD` es informativo y nunca se debita. Las llamadas/minutos de Yeastar siguen visibles como medición; el costo de transcripción que Yeastar obtiene con su propia llave OpenAI no es observable ni se cobra aquí. Las migraciones 156–159 están pendientes de validación/aplicación y el código de despliegue debe validarse.
- Función futura separada de 2c: configurar desde NexoOmni el enrutamiento de llamadas de WhatsApp conectadas por OAuth de Zernio hacia Yeastar. La documentación de Zernio describe `GET/POST/PATCH /v1/phone-numbers/{id}/whatsapp/calling` y los eventos de llamada, pero aún se debe confirmar que los números conectados por OAuth sean elegibles para activar esa API y definir el destino SIP real de Yeastar. No se habilita ni configura el enrutamiento en esta fase.
- El fallback entre OpenAI y Anthropic queda pendiente: cada `ai_configs` solo contiene una llave/proveedor; no se debe intentar el otro proveedor sin credencial y autorización de gasto.

## 1. Estado actual (leído del código)

| Tema                                     | Hoy                                                                                                                                                                                                                                                |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Proveedor                                | Uno por cuenta (OpenAI **o** Anthropic) en `ai_configs`. Código: `src/lib/ai/generate.ts`, `providers/openai.ts`, `providers/anthropic.ts`.                                                                                                        |
| Llaves                                   | La aplicación conserva compatibilidad con las llaves cifradas anteriores. Las nuevas llaves se administran desde el panel interno y se guardan cifradas por tenant en `ai_provider_credentials`; el navegador del cliente no puede leer ni escribir secretos. |
| Modelos por defecto                      | `gpt-5.4-mini` / `claude-haiku-4-5-20251001` (`src/lib/ai/defaults.ts`). Imagen `gpt-4.1-mini` y voz `gpt-4o-mini-transcribe` están **fijos en código** (`config.ts`, `media-analysis.ts`, worker `ai-analysis-worker/route.ts`, `ai-config.tsx`). |
| Consumo                                  | IA: `ai_usage_log` conserva tokens, costo y precio; `ai_credit_ledger` confirma el débito atómico. Llamadas WhatsApp: `call_usage_log` y el mismo ledger.                                                                                           |
| Asistente de chat / reportes a la medida | No existen.                                                                                                                                                                                                                                        |
| Facturación                              | Las recargas siguen siendo manuales. El usuario confirmó el portal de saldo/historial y las alertas 10 %/5 % en producción. Checkout con acreditación firmada e idempotente está implementado localmente; aún debe desplegarse y probarse en modo test. |
| Migración                                | El usuario confirmó en producción los cambios hasta la migración **166**. La migración **167** crea la configuración Stripe central; requiere revisión y aplicación antes de desplegar la pantalla y probar Checkout. |

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

En IA y en el costo de conexión Zernio, el objetivo de margen del 50 % equivale a ×2 y se guarda en `ai_billing_settings`. Los minutos WhatsApp usan la tarifa fija configurada de MXN $0.50 por minuto iniciado; no se les vuelve a aplicar ×2. La transcripción generada por una llave externa configurada en Yeastar no se cobra porque NexoOmni no recibe su uso/costo.

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

Ejemplo: una auto-respuesta de 4,000 tokens de entrada y 600 de salida en Luna cuesta aproximadamente US$0.0007. El precio calculado es US$0.0014; como el sistema factura créditos enteros redondeando hacia arriba, se debitan **2 créditos**. El número de respuestas por paquete debe estimarse con ese redondeo por solicitud.

**Aritmética sin margen de error (implementación):**

- Todo en **enteros**, nunca `float`: el código calcula costo/precio en nanodólares usando los precios por millón de tokens configurados.
- El costo de tokens y el precio se redondean hacia arriba. Los créditos se calculan con la equivalencia configurada (por defecto, 1 crédito = US$0.001 de precio) y también se redondean hacia arriba a créditos enteros.
- Se guarda por llamada el uso reportado, modo, proveedor/modelo, costo/precio calculado y débito asociado en el ledger; la conciliación automática contra reportes de OpenAI/Anthropic aún no está implementada.

**Lo que la regla ×2 NO incluye** (hay que decidir si se traslada al cliente): comisión de la pasarela (f), IVA, pérdida por tipo de cambio y costos fijos. Si la pasarela cobra f, el margen neto sobre lo que realmente recibes baja: con f = 4 %, un paquete de US$50 deja 50 − 2 − 25 = **US$23** (no 25). Para conservar US$25 netos el paquete debe costar `2 × costo / (1 − f)` = **US$52.08** por los mismos 50,000 créditos. Y como el cliente paga en MXN, el precio del paquete en pesos debe calcularse con el FIX del día más un colchón (p. ej. 2 %) para no perder por variación cambiaria. Los créditos quedan fijos en USD; solo el precio en pesos se recalcula.

## 5. Diseño de la bolsa de créditos

**Principios:** el saldo nunca se calcula con floats; el cobro es atómico e idempotente; si falta saldo, el sistema degrada de forma segura.

### 5.1 Unidad

- Contabilidad de costos en nanodólares enteros (`bigint`); los saldos son créditos enteros. La configuración vigente por defecto equivale a **1 crédito = US$0.001 de precio al cliente**. La interfaz de consumo todavía es interna para el operador de plataforma.
- Paquetes de ejemplo (a confirmar): 5,000 / 20,000 / 100,000 créditos.

### 5.2 Tablas (migraciones nuevas ≥ 150, una por cambio)

- `ai_model_prices`: modelo/proveedor, precio de entrada y salida, fecha de vigencia. Los precios cambian: **no van en código**.
- `ai_billing_settings`: modo de cobro, margen, equivalencia de crédito y FIX de Banxico (con fecha/fuente).
- `ai_credit_wallets`: saldo no negativo de créditos por cuenta, protegido por la migración 160; desde la migración 163 se reconcilia con lotes de créditos y vencimientos.
- `ai_credit_ledger` (solo inserción): compra, consumo, reembolso, ajuste, regalo, vencimiento; `idempotency_key` único; `balance_after`.
- `ai_credit_packs`: catálogo de paquetes.
- `ai_usage_log` registra costo/precio y la clave de idempotencia; `call_usage_log` conserva costo de conexión, minutos y estado del débito de cada llamada WhatsApp.
- Funciones SQL `SECURITY DEFINER` restringidas a `service_role` registran uso y débito en una transacción idempotente. No se reserva saldo antes de IA: el costo real se conoce con los tokens devueltos por el proveedor.
- RLS: wallet y ledger legibles para `supervisor+` de la cuenta; **escritura solo con service role** (se documenta con comentario en la migración para que no parezca un olvido).

### 5.3 Flujo de cada llamada de IA

1. Antes de llamar al proveedor se confirma que la facturación esté en `enforced` y exista un precio vigente para el proveedor/modelo; si falta cualquiera, se bloquea la solicitud.
2. Tras la respuesta del proveedor, se exige el uso de tokens y se registra el costo/precio y el débito en una operación atómica e idempotente. La respuesta no se entrega si la base no confirma el registro/cobro.
3. La migración 160 impide nuevos débitos que excedan el saldo y el código bloquea nuevas solicitudes de IA cuando no hay créditos vigentes. La migración 162 pausa las llamadas de Zernio al agotarse el saldo y la 163 implementa lotes, vencimiento y consumo por fecha más próxima. El usuario confirmó en producción el portal de saldo/historial, las alertas 10 %/5 % y sus cambios de base hasta la migración 164. Esta actualización agrega localmente el resumen mensual con la migración 165; falta validarla y desplegarla.
4. La prueba de credenciales también es facturable. Si falla la base después de una solicitud externa, la salida se bloquea, aunque el proveedor pudo haber cobrado su llamada.

### 5.4 Compra y cobro

- **Pasarela: Stripe (decidido).** Checkout de pago único, webhook firmado, registro service-role-only y acreditación idempotente por PaymentIntent están implementados localmente. Mientras Checkout esté apagado, el operador conserva la recarga manual desde el panel de plataforma.
- **Vencimiento: 30 días por recarga (decidido 2026-10-20).** Cada recarga pagada inicia su propio periodo de 30 días desde que se acredita; no es cierre de mes ni 60 días. La migración 163 implementa lotes, expiración auditable y consumo por vencimiento más próximo. La pantalla interna informa la fecha de expiración; falta mostrarla antes de comprar cuando exista Checkout. Validar la política con asesoría legal antes de lanzar.
- La acreditación solo ocurre desde el webhook verificado de la pasarela (o la acción manual auditada), con `idempotency_key` = id del pago.

### 5.5 Migración de clientes existentes (DECIDIDO: migran todos)

- **Todos** los clientes pasan a llaves de la plataforma y créditos; se elimina el modo BYO. Consecuencias que hay que planear: (a) cada cliente necesita saldo inicial antes del corte o su IA se detiene; (b) las llaves BYO guardadas (`ai_configs.api_key`) dejan de usarse — se conservan cifradas unos días como respaldo y luego se borran de forma auditada; (c) comunicación previa al cliente, con fecha de corte.
- No habrá un periodo de modo sombra para este lanzamiento: la facturación queda en `enforced`. Los precios/modelos deben validarse antes del uso y las migraciones deben probarse en desarrollo antes de producción.
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

- **Cliente (supervisor/admin/owner):** saldo en créditos, últimos 50 movimientos y alertas 10 %/5 % confirmados por el usuario en producción. Esta actualización implementa localmente el consumo del mes por actividad y el equivalente MXN estimado con un FIX reciente, sin exponer proveedor ni modelo; la migración 165 y el despliegue siguen pendientes. El historial con información ampliada de recargas continúa pendiente.
- **Alertas**: se definieron avisos al **10 %** y al **5 %** del último paquete pagado, con reinicio por cada recarga pagada nueva. Se implementan como notificación dentro de NexoOmni y correo para propietarios, administradores y supervisores activos; el 5 % se resalta como urgente. El usuario confirmó en producción la migración 164 y los cambios de alertas. El envío SMTP se procesa en segundo plano con reintentos; no hay en esta nota una verificación independiente de entrega de extremo a extremo.
- **Super administrador (panel de plataforma):** consumo por tenant, margen real (precio cobrado − costo real conciliado), diferencias contra proveedores, llaves por tenant, tipo de cambio y precios vigentes, alta manual de créditos.
- Conversión a pesos: tabla `ai_billing_settings` guarda el FIX, su fecha y el token SIE cifrado; el código consulta Banxico al procesar llamadas. El token puede configurarse desde el panel de plataforma o, como alternativa, en `BANXICO_API_TOKEN`.

## 7. Fases (un PR pequeño por fase)

| Fase | Entrega                                                                                                                                                                                                                                              | Validación                                                                              |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 0    | Línea base: medianas/p95 de tokens y latencia por modo/modelo desde `ai_usage_log`; evaluación ciega de 50–100 casos anonimizados; conciliación de la transcripción de Yeastar con el uso real de OpenAI y confirmación de FX.                       | Ejecutar SQL en Supabase de desarrollo, informe de calidad/costo y decisión de modelos. |
| 1    | Catálogo de modelos y `generateForTask`; rutas por tarea; salida registra proveedor, modelo y latencia; candidatos opt-in con `AI_TASK_ROUTING_ENABLED`. Fallback cruzado se aplaza hasta guardar/proveer ambas llaves.                              | Pruebas unitarias, `tsc`, `lint`; activar solo tras aprobar Fase 0.                     |
| 2    | Precios, wallet, ledger, débito atómico e idempotente, y aritmética entera. La migración 158 fuerza `enforced`; las migraciones 160–161 bloquean saldos negativos y completan precios de modelos faltantes. | Pruebas + aplicación y validación manual de RLS en base de desarrollo.                  |
| 2b   | Administración de llaves por tenant (panel de plataforma y `ai_provider_credentials`; migración 155). La conciliación diaria con OpenAI/Anthropic sigue pendiente.                                                                                   | Revisión humana (secretos/RLS); aplicación de migración en base de desarrollo.           |
| 2c   | Resumen interno de llamadas Zernio/Yeastar por tenant y débito de WhatsApp: costo de conexión Zernio ×2 más MXN $0.50 por minuto iniciado contestado. Meta es informativo; no se factura al crédito. La transcripción externa de Yeastar no es cobrable con la telemetría actual. | Aplicar 156–158 en orden en desarrollo; cotejar Zernio con su reporte y Yeastar con CDR; probar duplicados de webhook y FIX. |
| 3    | Vencimiento auditable por lote (migración 163), portal de saldo/movimientos y alertas 10 %/5 % (migración 164) confirmados por el usuario en producción. Resumen mensual/estimado MXN (migración 165), Checkout con webhook firmado/idempotente (166) y configuración central cifrada test/live (167) están implementados localmente. | Aplicar y verificar migración 167; desplegar; configurar Stripe test y comprobar Checkout/webhook/acreditación. Revisión humana de RLS, impuestos, precios y conciliación antes de habilitar cobros reales. |
| 3b   | Corte de clientes BYO → créditos: saldo inicial, aviso previo, retiro de llaves BYO.                                                                                                                                                                 | Plan de salida revisado con el cliente.                                                 |
| 4    | Asistente v1 solo lectura + ayuda de plataforma.                                                                                                                                                                                                     | Pruebas de aislamiento entre tenants.                                                   |
| 5    | Reportes a la medida y exportación.                                                                                                                                                                                                                  | Cifras verificadas contra consultas conocidas.                                          |
| 6    | Acciones con confirmación + auditoría.                                                                                                                                                                                                               | Pruebas de inyección de prompt.                                                         |

Cada fase cierra con `npx tsc --noEmit`, `npm run lint`, `npm test`, manual y changelog. Las fases 2, 3 y 6 requieren **revisión humana** (RLS, facturación, datos de producción), según la guía de desarrollo §5.5.

## 8. Decisiones pendientes

**Decidido (19-oct-2026):** margen del 50 % (×2); 1 US$ = 1,000 créditos; todos los clientes migran a créditos con llaves de la plataforma; `owner` puede usar el asistente; datos por cuentas de Aurionova aprobado; vencimiento mensual; una llave/proyecto por tenant administrada por el super administrador.

**Decidido (turno 2):**

- La comisión de la pasarela se considera en el costo del paquete. Para Stripe, la decisión histórica de trasladarla con `precio / (1 − f)` quedó sustituida el 21-oct-2026 por el cálculo de costo estimado incluido en el precio, sin mostrar un recargo separado (ver decisión de Stripe abajo).
- Planes: **Plan 1** sin IA ni créditos; **Plan 2** = Plan 1 + IA con créditos; **Plan 3** = Plan 2 + llamadas PSTN y de WhatsApp. El costo de Meta/Zernio de las llamadas va incluido en la renta mensual: **no se debita de créditos** (Zernio/Meta solo se leen para medir el margen real). Entitlement nuevo `ai_credits` (planes 2 y 3).
- Transcripción de llamadas Yeastar: Yeastar no cobra; el costo es el de la llave OpenAI configurada en la central. La PBX usa `gpt-4o-transcribe`, pero su costo real por minuto y su atribución por tenant siguen pendientes de conciliación. El estimado anterior de US$0.003/min y 6 créditos/min queda retirado; no se configura ni se cobra hasta contar con minutos facturables y costos conciliados. Minutos por tenant: `yeastar_call_transcriptions` (extension_filter de la migración 149).
- El usuario confirmó que más adelante quiere configurar en NexoOmni el reenvío de llamadas de WhatsApp hacia Yeastar desde las conexiones Zernio existentes. Mantenerlo separado de la medición 2c: antes de implementarlo, validar elegibilidad de conexiones OAuth en los endpoints oficiales de Zernio y obtener el URI SIP/datos de conexión exactos del PBX Yeastar. El registro del uso por `profileId` no depende de habilitar ese enrutamiento.
- Tipo de cambio automático vía API SIE de Banxico (serie SF43718). El código actual consulta al recibir llamadas y renueva su caché cada 12 horas; acepta como respaldo una tasa de hasta cinco días. El token se captura cifrado en el panel de plataforma (migración 159); `BANXICO_API_TOKEN` en EasyPanel es una alternativa, nunca debe guardarse en el repositorio.

**Abiertas:**

1. **Stripe México y recargas (decidido 2026-10-21):** paquetes Emprendedor US$50/50,000 créditos, Comercial Pro US$150/150,000 y Corporativo US$300/300,000. El FIX Banxico SF43718 vigente se convierte a centavos MXN al abrir cada Checkout. El IVA de 16 % se aplica sobre el precio del paquete, que incluye el costo estimado de procesamiento; no se muestra ni se agrega un recargo separado por tarjeta. Para estimar ese costo incluido en todos los pagos con tarjeta se usa conservadoramente **4.1 % + MXN $3.00** (3.6 % de tarjeta nacional + 0.5 % internacional) y el 16 % de IVA que Stripe aplica a sus comisiones. En centavos, se busca el menor costo incluido `C` que cubra `F(T) = ceil(T × 4.1 %) + $3.00 + ceil((ceil(T × 4.1 %) + $3.00) × 16 %)`; `T` es el precio del paquete convertido más `C` y el IVA sobre ese total. Se liquida en MXN y la creación automática de factura de Stripe queda desactivada. Con FIX **18.4200** de ejemplo, Emprendedor queda en aproximadamente **$1,135.03 MXN** (base del paquete $921.00, costo incluido $57.47, IVA $156.56); Comercial Pro **$3,396.51** y Corporativo **$6,788.74**. Los montos reales se calculan con el FIX disponible al iniciar el Checkout.
   - Referencias: [precios Stripe México](https://stripe.com/mx/pricing), [IVA de las comisiones Stripe en México](https://support.stripe.com/questions/taxes-on-stripe-fees-for-mexico-based-businesses?locale=es-419) y [disponibilidad de recargos de Stripe](https://docs.stripe.com/payments/cards/surcharge). La documentación de Stripe lista su función de recargo solo para EE. UU., Canadá y Nueva Zelanda; por ello no se implementa un cargo separado de procesamiento en MXN.
   - Checkout/webhook requieren credenciales centrales configuradas por el operador en el panel de plataforma, `NEXT_PUBLIC_SITE_URL` o `APP_URL` y la migración 167. No se leen claves desde el chat ni se guardan en el repositorio. Checkout queda apagado por defecto. El endpoint a registrar en Stripe es `/api/webhooks/stripe` para `checkout.session.completed` y `checkout.session.async_payment_succeeded`.
   - El webhook valida firma, modo test/live, sesión, moneda, importe y paquete contra el registro local antes de acreditar. El lote de créditos vence 30 días tras acreditarse. La activación de cobros reales sigue pendiente de aplicar la migración 167, desplegar, probar en modo test y revisar precios, impuestos y conciliación.
2. Confirmar que los créditos no usados vencen al cierre del mes (validar con asesoría legal).
3. ¿Se incluye en la v1 el escalamiento a soporte humano desde el asistente?

**Decidido (turno 3; reemplazado por turno 4):** pasarela Stripe. La lista anterior de paquetes Inicio/Crecimiento/Pro/Empresa US$10–100 queda sustituida por los paquetes del brochure descritos abajo.

**Decidido (turno 4, 20-oct-2026) — modelo de recargas; reemplaza las decisiones anteriores que lo contradigan (paquetes de US$10–100, vencimiento al cierre del mes o 60 días, saldo negativo permitido):**

- Paquetes del brochure: Emprendedor US$50 / 50,000 créditos (margen 50 %), Comercial Pro US$150 / 150,000 (margen ≈47 %), Corporativo US$300 / 300,000 (margen ≈44 %). El descuento se aplica reduciendo el margen sobre el costo real, no con una tarifa fija.
- Cobro de IA: costo real por tokens × (1 + margen), como está implementado. No se usa la tabla de tarifas fijas por interacción ni el colchón del 30 % de la memoria de cálculo.
- Vigencia: cada recarga pagada vence **30 días después de acreditarse**, incluso si cruza un fin de mes. El saldo existente al desplegar queda sin vencimiento; ajustes y cortesías tampoco vencen. El consumo descuenta primero el lote con vencimiento más próximo. La implementación auditable está en la migración 163, pendiente de validar en desarrollo y revisión legal antes de activarse. El brochure dice 60 días y debe corregirse antes de publicarlo.
- Saldo cero: la implementación local bloquea nuevas solicitudes de IA y pausa los números de llamadas de Zernio; una recarga positiva los reactiva únicamente si NexoOmni los había pausado. La puesta en producción depende de aplicar y probar las migraciones 160–163 y desplegar el código.
- Si una llamada finalizada excede el saldo positivo restante, no se genera débito negativo: queda como no cobrada y se pausan las llamadas hasta una nueva recarga. La llamada externa ya ocurrió, por lo que esa diferencia puede ser costo absorbido por la plataforma; queda pendiente definir un umbral o reserva mínima para reducir ese riesgo.
- Meta lo paga el cliente directo; no entra al crédito.
- Pendiente de resolver: cobrar la IA de voz en tiempo real y las llamadas PSTN (la memoria las cotiza; el código solo cobra conexión Zernio + MXN $0.50/min); validar en desarrollo la pausa/reactivación real de Zernio y los vencimientos.
- Bug de transcripciones Yeastar reportado el 2026-10-20: corregido en API y UI. La lista ordena por fecha de inicio descendente, luego fecha de fin, creación e ID; la UI muestra primero la fecha de inicio para coincidir. Si falta el inicio, usa la fecha de fin y deja el registro después de los que sí tienen inicio.
- Vencimiento por lote implementado localmente en migración 163: saldo existente sin vencimiento; nuevas compras vencen a 30 días; ajustes/cortesías no vencen; los débitos consumen primero los créditos con vencimiento más próximo; la expiración genera un movimiento de ledger ligado al lote.
- Decisión de activación (2026-10-21): conservar sin vencimiento el saldo presente al desplegar; solo las recargas pagadas futuras vencen 30 días después de acreditarse; ajustes/cortesías no vencen; consumo por vencimiento más próximo.
- Siguiente sesión: validar las migraciones 160–163 en una base de desarrollo aislada y comprobar lotes, saldo, idempotencia y vencimientos; revisar precios, cumplimiento legal y despliegue. No aplicar cambios a producción sin aprobación explícita.
