# Evaluación de modelos de IA

## Línea base de consumo

Aplica primero la migración `150_ai_usage_latency.sql` en Supabase de desarrollo. Después ejecuta [`scripts/sql/ai-usage-baseline.sql`](../scripts/sql/ai-usage-baseline.sql) en su SQL Editor. La consulta usa los últimos 30 días y devuelve solo agregados de `ai_usage_log`; no extrae conversaciones ni datos personales.

La consulta no calcula costos porque todavía no hay una tabla versionada con precios de proveedor. No uses las estimaciones del plan como gasto real.

## Comparación de calidad

Antes de activar candidatos nuevos:

1. Prepara entre 50 y 100 casos representativos de WhatsApp, análisis y llamadas. Elimina nombres, teléfonos, correos, números de pedido, enlaces y cualquier dato que identifique a personas o clientes.
2. Conserva el mismo prompt, contexto y límite de salida para el modelo actual y el candidato.
3. Puntúa cada respuesta a ciegas de 1 a 5 en exactitud, utilidad, español natural, cumplimiento del tono y uso correcto del handoff. Una respuesta inventada en un dato operativo se marca como fallo crítico aunque su promedio sea alto.
4. Registra por caso modelo, tokens de entrada/salida, latencia y resultado de la puntuación. Compara mediana y percentil 95, no solo promedios.
5. No envíes datos reales a un proveedor sin anonimización y autorización. Las llamadas de evaluación generan cargos en las llaves configuradas.

Los identificadores candidatos están centralizados en `src/lib/ai/model-routing.ts`. La selección permanece desactivada salvo que `AI_TASK_ROUTING_ENABLED=true`; deja la variable apagada hasta revisar la línea base y las evaluaciones.

## Límites actuales

- Cada `ai_configs` tiene una sola llave y un solo proveedor. El enrutamiento puede elegir modelos para ese proveedor, pero no cambiar de OpenAI a Anthropic ni ejecutar fallback cruzado sin una segunda credencial y una política de gasto.
- El worker Yeastar almacena transcripción y resumen obtenidos del PBX; no registra el uso de la llave de OpenAI que esté configurada dentro de Yeastar. Para medir ese costo por tenant hay que confirmar el modelo/flujo configurado en la PBX y obtener el consumo de OpenAI separado por proyecto o llave.
- El análisis de llamadas que ejecuta NexoOmni con `call-summary.ts` sí registra tokens en `ai_usage_log` como `call_summary`.
