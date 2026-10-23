# Tarifas de IA y llamadas: costo real, precio y margen

Actualizado: 22-oct-2026. Documento interno (no es manual de cliente). Regla vigente: **precio = costo real × 2** (margen 50 % sobre el precio). 1 crédito = US$0.001 de precio = US$0.0005 de costo.

Tipo de cambio de referencia: **MXN 18.43 por USD** (valor de ejemplo; el sistema usa el FIX de Banxico configurado). Todos los precios son **sin IVA**.

## Qué está confirmado y qué no

| Dato | Estado | Fuente |
|---|---|---|
| Precio por millón de tokens de cada modelo | Confirmado | Migraciones 152 y 161 (consulta a páginas oficiales el 20-oct-2026) |
| Tokens por tarea (entrada/salida) | **Estimado**, no medido | `docs/plan-ia-multiproveedor-creditos-asistente.md` §4 |
| Costo de transcripción `gpt-4o-transcribe` | ≈ US$0.006/min según sitios de terceros; OpenAI solo publica tokens de audio (US$2.50 entrada / US$10 salida por 1M) | [OpenAI](https://developers.openai.com/api/docs/models/gpt-4o-transcribe). **Validar con tu gasto real ÷ minutos.** |
| Costo de `gpt-4o-mini-transcribe` | ≈ US$0.003/min (terceros), US$1.25 / US$5 por 1M tokens de audio (OpenAI) | Mismo criterio |
| Llamada WhatsApp entrante, Meta | **Sin cargo** | [Zernio: tarifas WhatsApp](https://docs.zernio.com/pricing/whatsapp) |
| Llamada WhatsApp entrante, Zernio | Cobra el tramo de operadora solo si la llamada se enruta a un teléfono (PSTN). **Un destino SIP/WebSocket no tiene tramo PSTN ni cargo.** Grabación opcional: US$0.004/min | Zernio. Sus páginas de precios y de llamadas se contradicen sobre entrantes; **confirmar con `call_usage_log`** |
| Meta, llamada saliente a México | US$0.0094/min, se factura directo al WABA del cliente | Zernio |
| Consumo real de tu cuenta | **Medido** (30 días, ver sección siguiente). El costo por minuto de transcripción sigue sin medirse | `scripts/sql/ai-cost-by-task.sql` y facturas de Zernio del 22-oct-2026 |

## Datos reales medidos (22-oct-2026)

**Tokens y costo por tarea, últimos 30 días** (solo las llamadas que ya tenían costo registrado):

| Tarea | Llamadas | Tokens prom. entrada / salida | Costo real por llamada | Modelo usado |
|---|---|---|---|---|
| Resumen de llamada | 496 | 678 / 289 | US$0.0018 | gpt-5.4-mini |
| Análisis de conversación | 1,248 | 1,076 / 577 | US$0.0037 | gpt-5.4-mini |
| Borrador / auto-respuesta | 76 | ≈ 2,700–4,000 / 27–32 | US$0.002–0.003 | gpt-5.4-mini (1 borrador ya en gpt-6-luna) |
| Reporte | 13 | 4,770 / 1,190 (gpt-5.4-mini); 10,613 / 5,142 (Sonnet 5.5) | US$0.0098 / US$0.0726 | gpt-5.4-mini y Sonnet 5.5 |

- **Costo total estimado de los 30 días: ≈ US$6.0 (≈ MXN 110)** con los modelos que realmente se usaron. Es una proyección: 1,212 de los 1,248 análisis y 118 de los 496 resúmenes no tenían costo registrado (anteriores al cobro) y los valoré al promedio de los que sí lo tenían.
- **Con el enrutamiento previsto (Luna/Haiku) el mismo uso costaría ≈ US$0.88 (≈ MXN 16)**, unas 7 veces menos.
- **Probable causa de que no se aplique:** el análisis y el resumen de llamada toman primero el modelo guardado en `ai_configs.analysis_model` (`src/lib/ai/model-routing.ts`); si ese campo dice `gpt-5.4-mini`, el enrutamiento se ignora. Falta confirmarlo en la base.
- **Mis estimaciones de tokens estaban muy altas para resúmenes** (supuse 8,000 / 800; real 678 / 289). Un resumen real en Haiku 5.5 cuesta ≈ US$0.0002 (una llamada de 5 min ≈ US$0.0005).

**Llamadas de WhatsApp (Zernio):**

- El costo de llamadas es prácticamente cero: en octubre Zernio facturó **US$0.06** por llamadas, y las llamadas del 12 al 22 de octubre (destino SIP, sin grabación) salen en **US$0.00**.
- Los cargos pequeños (US$0.001 a US$0.031) son de pruebas del 19-sep al 14-oct. Coinciden con la grabación (US$0.004/min: 4m34s = US$0.0184) y con enrutamiento a un teléfono (no confirmado por modelo).
- **El gasto real de Zernio es el costo fijo por cuenta conectada**: US$73.55 − US$16.44 de crédito = **US$57.11 al mes** (cuentas y números). Según su tarifa gradual, cada cuenta conectada adicional (WhatsApp, Instagram, Facebook, cada una cuenta) cuesta **US$3/mes** entre la 11 y la 100 y US$1 después de la 100; una cuenta de 3 a 10 cuesta US$6.
- Por eso la renta mensual de cada tenant debe cubrir al menos 1 cuenta por canal conectado (≥ US$3 de costo, ≥ US$6 de precio con la regla ×2), no solo las llamadas.

**Transcripción de llamadas PSTN (Yeastar):** 82 llamadas y **158.3 minutos** transcritos en 30 días (promedio 1.9 min). Costo estimado a US$0.006/min ≈ US$0.95 (≈ MXN 17.5). Los 640 requests de `gpt-4o-transcribe` del export de OpenAI contra 82 llamadas sugieren troceado de audio o reintentos; hay que revisarlo porque multiplicaría el costo.

**Resúmenes vs transcripciones:** hay 496 resúmenes contra 82 llamadas transcritas. Puede haber reanálisis o duplicados; conviene revisarlo antes de definir un precio fijo por resumen.

## Decisión del propietario (22-oct-2026)

- **Llamada por WhatsApp (Zernio):** se cobra el minuto, la conexión, la transcripción y el resumen.
- **Llamada PSTN:** se cobra solo la transcripción y el resumen.
- Esta decisión **reemplaza** la nota del plan que decía que Meta/Zernio iban incluidos en la renta del Plan 3.
- Meta sigue cobrando directo al cliente y no entra a créditos.

## Tarifa recomendada

| Concepto | Costo real | Precio recomendado (créditos) | Precio MXN | Margen |
|---|---|---|---|---|
| Transcripción, por minuto (`gpt-4o-transcribe`) | ≈ US$0.006 = MXN 0.11 | **15 créditos/min** | 0.28 | 60 % (colchón sobre el 50 %) |
| Transcripción, por minuto, si migras a `gpt-4o-mini-transcribe` | ≈ US$0.003 = MXN 0.055 | 8 créditos/min | 0.15 | 62 % |
| Resumen de llamada (medido: 678 in / 289 out; Haiku 5.5 ≈ US$0.0002, 5 min ≈ US$0.0005) | US$0.0002–0.0005 | **2 créditos** por llamada (el sistema cobra costo × 2 redondeado a 1 crédito mínimo) | 0.037 | ≈ 75–90 % |
| Minuto de llamada WhatsApp (Zernio) | **≈ US$0 medido** (destino SIP, sin grabación); ≈ US$0.004/min con grabación | **MXN 0.50 por minuto iniciado** (ya configurado) | 0.50 | ≈ 100 % (es cargo de servicio) |
| Cuenta/canal conectado (Zernio) | US$3/mes marginal (US$6 entre las cuentas 3 y 10) | Incluir en la renta mensual del plan, ×2 | ≈ MXN 110/mes por canal | 50 % |
| Conexión Zernio | Costo real facturado por Zernio | **Costo × 2** (ya implementado) | Variable | 50 % |

Por qué 15 y no 12 créditos de transcripción: 12 deja exactamente 50 % si el costo es US$0.006, y cualquier desviación de tokens de audio lo vuelve pérdida. Hoy Yeastar cobra costo × 1.5 (33 % de margen), por debajo de tu regla.

## Ejemplos por llamada de 5 minutos

| Caso | Cobro al cliente | Costo estimado | Ganancia |
|---|---|---|---|
| **PSTN** (transcripción + resumen) | 79 créditos = US$0.079 = **MXN 1.46** | MXN 0.58 | MXN 0.88 |
| **WhatsApp a destino SIP** (minuto + transcripción + resumen) | 215 créditos = US$0.215 = **MXN 3.96** | MXN 0.58 + Zernio por medir | ≈ MXN 3.38 si Zernio = 0 |

Tu uso de ~30 minutos transcritos este mes cuesta ≈ US$0.18 (MXN 3.3): irrelevante para calibrar; conviene medir con una cuenta cliente activa.

## ¿Para qué alcanza una recarga de US$50?

Son **50,000 créditos** (costo máximo US$25). Todo en créditos enteros, redondeado hacia arriba por solicitud.

### Tabla por actividad (modelos vigentes desde 22-oct-2026)

Precio = costo × 2 (1 crédito = US$0.001). MXN a 18.43, sin IVA. Tokens: medidos en llamadas, análisis y reporte; **supuestos** en respuesta, imagen y asistente.

| Actividad | Modelo | Tokens ent / sal | Costo US$ | Créditos | Precio MXN | Costo con modelo económico anterior |
|---|---|---|---|---|---|---|
| Auto-respuesta / borrador (supuesto) | claude-sonnet-5-5 (resp. terra) | 3,300 / 150 | 0.0081 | 17 | 0.30 | 0.0004 (Luna) |
| Análisis de conversación (medido) | claude-haiku-5-5 | 1,400 / 750 | 0.0005 | 2 | 0.02 | igual |
| Resumen llamada corta ~2 min (medido) | claude-sonnet-5-5 | 678 / 289 | 0.0043 | 9 | 0.16 | 0.0002 |
| Resumen llamada 5 min (estimado) | claude-sonnet-5-5 | 1,900 / 450 | 0.0083 | 17 | 0.31 | 0.0004 |
| Descripción de imagen (supuesto) | gpt-6-luna | 1,500 / 300 | 0.0003 | 1 | 0.01 | igual |
| Asistente simple (supuesto) | gpt-6-luna | 8,000 / 400 | 0.0010 | 2 | 0.04 | igual |
| Asistente con datos (supuesto) | claude-sonnet-5-5 | 20,000 / 1,200 | 0.052 | 104 | 1.92 | igual |
| Reporte (medido) | claude-sonnet-5-5 | 10,613 / 5,142 | 0.0727 | 146 | 2.68 | igual |
| Minuto transcripción (provisional) | gpt-4o-transcribe (Yeastar) | audio | ≈ 0.006 | 15 | 0.28 | igual |

Nota: auto-respuesta y resumen suben ~20× de costo por pasar a la gama premium; la rentabilidad (≈ 50 % de margen) se mantiene porque el precio sube igual.

Perfiles de ejemplo (supuestos, no medidos; incluyen 5 min por llamada):

| Perfil | Uso mensual | Costo real | Créditos/mes (precio) | Margen | US$50 duran | US$150 duran |
|---|---|---|---|---|---|---|
| **Pequeño** | 1,500 resp., 500 análisis, 100 imágenes, 100 asistente simple, 10 consultas con datos, 20 llamadas | US$13.8 (MXN 255) | ≈ 29,700 (US$29.7) | 53 % | ≈ 1.7 meses | ≈ 5 meses |
| **Mediano** | 3,000 resp., 1,500 análisis, 300 imágenes, 150 simples, 50 con datos, 10 reportes, 100 llamadas | US$32.5 (MXN 598) | ≈ 70,500 (US$70.5) | 54 % | ≈ 0.7 meses | ≈ 2 meses |
| **Grande** | 10,000 resp., 5,000 análisis, 1,000 imágenes, 500 simples, 200 con datos, 40 reportes, 400 llamadas | US$113 (MXN 2,083) | ≈ 245,000 (US$245) | 54 % | ≈ 6 días | ≈ 18 días |

Con la gama premium la recarga de US$50 ya no dura 7 meses: un negocio pequeño la consume en ~1.7 meses y los demás compran varias veces al mes, lo que da el consumo recurrente que busca el negocio. La caducidad de 30 días (migración 163) refuerza esto.

Mensaje corto para clientes: *"Con US$50 un negocio pequeño cubre unas 7 semanas de IA; uno mediano, unas 3; las empresas grandes, unos días. Depende de cuántos mensajes y llamadas atiendas."*

Pendiente de validar: calidad real de Sonnet en respuestas (evaluación ciega de Fase 0) y tokens reales de respuesta tras unos días en producción.

## Dónde puedes perder dinero

1. **Costo de Zernio por minuto:** desconocido hasta correr la consulta 2 de `ai-cost-by-task.sql`. Si el destino es un teléfono (no SIP), el costo sube.
2. **Transcripción Yeastar a ×1.5:** margen del 33 %, no del 50 %. Además, la PBX comparte una sola llave de OpenAI y no reporta tokens por cliente.
3. **`gpt-4o-transcribe` se retira el 26-feb-2027** (según el plan). Coordinar con Yeastar.
4. **Consulta con datos y reportes (Sonnet 5.5):** son la tarea más cara por uso; sus tokens son estimados.
5. **Llamada que excede el saldo:** queda sin cobrar y el costo lo absorbes.
6. **Tipo de cambio e IVA:** los créditos están en USD; el precio del paquete en MXN ya incluye el costo estimado de Stripe.

## Competitividad en México

Referencia encontrada: los agentes de voz con IA completos (no solo transcripción) cuestan entre US$0.05 y US$0.25 por minuto; un proveedor local lista el minuto extra de asistente de voz en MXN 2.80 ([MessageMind](https://messagemind.ai/es/blog/ai-voice-agent-pricing), [CallBeat](https://callbeat.mx/planes-asistente-de-voz-con-ia/)). **No son equivalentes** a transcribir y resumir: no encontré precios comparables solo de transcripción en un CRM, así que no puedo afirmar que tu tarifa sea la más baja. Como referencia, una llamada WhatsApp de 5 min con transcripción y resumen sale en MXN 3.96, contra MXN 14 que costaría a MXN 2.80/min un asistente de voz completo.

## Siguiente verificación

Hecho el 22-oct-2026: modelos unificados y sin override por cuenta (migración 173), respaldo automático entre proveedores y tope de 5 intentos con espera creciente en el análisis de llamadas. De los 1,661 registros de llamadas, solo 3 estaban en `failed`, así que el bucle de reintentos **no explica por sí solo** los 496 resúmenes; la causa sigue sin confirmar (ver punto 2).

1. Con el gasto de la llave/proyecto de OpenAI de Yeastar y los 158.3 minutos, calcular el costo real por minuto de transcripción y ajustar la tarifa de 15 créditos.
2. Averiguar por qué hay 496 resúmenes para 82 llamadas: contar en `ai_usage_log` los registros `call_summary` agrupados por día y cuenta.
3. Decidir cuántas cuentas conectadas por tenant incluye cada plan, partiendo de US$3/mes de costo por cuenta.

## Medición de 30 días (revisar el 22-nov-2026)

Objetivo: reemplazar los tokens supuestos (respuesta, imagen, asistente) por medidos con los modelos nuevos.

1. Desde el 22-oct (ya con modelos unificados) deja correr 30 días sin cambiar modelos.
2. El 22-nov ejecuta [scripts/sql/ai-cost-by-task.sql](../scripts/sql/ai-cost-by-task.sql) en Supabase, filtrando desde el 23-oct, y pega los resultados en el chat.
3. Con eso se recalculan: tokens y costo reales por actividad, créditos por perfil de cliente, cuánto dura una recarga de US$50 y el margen real.
4. Revisar también `ai_usage_log` por modelo: cuánto consumió el respaldo (si aparece OpenAI en tareas de Claude, hubo caídas).

Nota: no existe un programador que me avise solo; pídeme el análisis ese día en una sesión nueva y comparto estos pasos.
