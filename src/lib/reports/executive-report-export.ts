import {
  reportSheetsCsv,
  reportSheetsExcelXml,
  reportSheetsPrintHtml,
  type ReportExportSheet,
} from './export-utils'

export type ExecutiveReport = {
  meta: { operating_mode: 'commercial' | 'support' | 'hybrid'; currency: string; range: { from: string; to: string; days: number }; response_metrics_capped: boolean }
  operational: { new_conversations: number; previous_new_conversations: number; open_backlog: number; resolved: number; first_response_minutes: number | null; first_response_samples: number }
  channels: { channel: string; conversations: number; resolved: number; first_response_minutes: number | null }[]
  agents: { id: string; name: string; open_conversations: number; first_response_minutes: number | null; measured_responses: number; average_qa_score: number | null }[]
  intelligence: { analyzed: number; negative: number; negative_rate: number | null; average_sentiment_score: number | null; average_qa_score: number | null }
  commercial: {
    open_pipeline_value: number; open_deals: number; won_deals: number; lost_deals: number; won_value: number
    attributed_deals: number; attributed_won_deals: number; attributed_won_value: number
    source_channels: { channel: string; deals: number; won_deals: number; lost_deals: number; open_deals: number; pipeline_value: number; won_value: number }[]
  }
  funnel: { stage: string; position: number; deals: number; won_deals: number; lost_deals: number; open_deals: number; value: number; won_value: number }[]
  campaigns: { totals: { recipients: number; sent: number; delivered: number; read: number; replied: number; failed: number }; delivery_rate: number | null; read_rate: number | null; reply_rate: number | null; items: { id: string; name: string; template_name: string; status: string; created_at: string; total_recipients: number | null; sent_count: number | null; delivered_count: number | null; read_count: number | null; replied_count: number | null; failed_count: number | null; delivery_rate: number | null; read_rate: number | null; reply_rate: number | null; attributed_deals: number; attributed_won_deals: number; attributed_won_value: number; attributed_pipeline_value: number }[] }
  nexo_memory?: {
    contacts_with_memory: number
    high_risk_count: number
    medium_risk_count: number
    low_risk_count: number
    average_opportunity_score: number | null
    overdue_commitments: number
    top_objections: { objection: string; count: number }[]
  }
  appointments?: {
    total: number
    scheduled: number
    confirmed: number
    completed: number
    cancelled: number
    no_show: number
    confirmation_rate: number | null
    cancellation_rate: number | null
    no_show_rate: number | null
    occupancy_rate: number | null
    conversion_rate: number | null
  }
  agendapro?: {
    total: number
    confirmed: number
    attended: number
    no_show: number
    cancelled: number
    no_show_rate: number | null
    cancellation_rate: number | null
    attendance_rate: number | null
  }
  calls?: {
    total: number
    transcribed: number
    inbound: number
    outbound: number
    internal: number
    average_duration_seconds: number | null
    average_sentiment_score: number | null
    negative: number
    negative_rate: number | null
    sentiment_breakdown: { positive: number; neutral: number; negative: number; mixed: number }
  }
}

export type ExecutiveReportInsight = {
  headline: string
  summary: string
  priorities: Array<{ area: 'operacion' | 'comercial' | 'marketing' | 'experiencia'; priority: 'alta' | 'media' | 'baja'; title: string; recommendation: string; rationale: string }>
  risks: string[]
  opportunities: string[]
  indicators_to_watch: string[]
  data_note: string | null
}

function asPercent(value: number | null) { return value === null ? 'Sin datos' : `${value}%` }
function minutes(value: number | null) { return value === null ? 'Sin datos' : value < 60 ? `${value} min` : `${Math.floor(value / 60)} h ${value % 60} min` }
function callDuration(seconds: number | null) { return seconds === null ? 'Sin datos' : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` }
function operatingMode(mode: ExecutiveReport['meta']['operating_mode']) { return mode === 'commercial' ? 'Comercial' : mode === 'support' ? 'Soporte' : 'Híbrido' }

function reportSheets(report: ExecutiveReport, insight?: ExecutiveReportInsight | null): ReportExportSheet[] {
  const sheets: ReportExportSheet[] = [
    { name: 'Resumen', rows: [
      ['Reporte ejecutivo NexoOmni'],
      ['Periodo', `${report.meta.range.from} al ${report.meta.range.to}`],
      ['Perfil operativo', operatingMode(report.meta.operating_mode)],
      ['Moneda', report.meta.currency], [],
      ['Métrica', 'Valor'],
      ['Conversaciones nuevas', report.operational.new_conversations],
      ['Conversaciones nuevas (periodo anterior)', report.operational.previous_new_conversations],
      ['Cola abierta', report.operational.open_backlog], ['Conversaciones cerradas', report.operational.resolved],
      ['Primera respuesta', minutes(report.operational.first_response_minutes)], ['Muestras de primera respuesta', report.operational.first_response_samples],
      ['Análisis IA', report.intelligence.analyzed], ['Análisis negativos', report.intelligence.negative], ['Tasa de análisis negativos', asPercent(report.intelligence.negative_rate)],
      ['Sentimiento promedio', report.intelligence.average_sentiment_score ?? 'Sin datos'], ['QA promedio', report.intelligence.average_qa_score ?? 'Sin datos'],
      ['Valor de pipeline abierto', report.commercial.open_pipeline_value], ['Tratos abiertos', report.commercial.open_deals], ['Tratos ganados', report.commercial.won_deals], ['Valor ganado', report.commercial.won_value],
      ['Tratos atribuidos a campañas', report.commercial.attributed_deals], ['Tratos ganados atribuidos a campañas', report.commercial.attributed_won_deals], ['Valor ganado atribuido a campañas', report.commercial.attributed_won_value],
    ] },
    { name: 'Canales', rows: [['Canal', 'Conversaciones nuevas', 'Cierres', 'Primera respuesta'], ...report.channels.map((channel) => [channel.channel, channel.conversations, channel.resolved, minutes(channel.first_response_minutes)])] },
    { name: 'Atribución por canal', rows: [
      ['Canal confirmado', 'Tratos', 'Abiertos', 'Ganados', 'Perdidos', 'Valor de tratos', 'Valor ganado'],
      ...report.commercial.source_channels.map((channel) => [channel.channel, channel.deals, channel.open_deals, channel.won_deals, channel.lost_deals, channel.pipeline_value, channel.won_value]),
    ] },
    { name: 'Embudo', rows: [
      ['Etapa', 'Tratos', 'Abiertos', 'Ganados', 'Perdidos', 'Valor de tratos', 'Valor ganado'],
      ...report.funnel.map((stage) => [stage.stage, stage.deals, stage.open_deals, stage.won_deals, stage.lost_deals, stage.value, stage.won_value]),
    ] },
    { name: 'Agentes', rows: [['Agente', 'Chats abiertos', 'Primera respuesta', 'Respuestas medidas'], ...report.agents.map((agent) => [agent.name, agent.open_conversations, minutes(agent.first_response_minutes), agent.measured_responses])] },
    { name: 'Campañas', rows: [
      ['Campaña', 'Plantilla', 'Estado', 'Creada', 'Destinatarios', 'Enviados', 'Entregados', 'Entrega', 'Lectura', 'Respuesta', 'Tratos atribuidos', 'Ganados atribuidos', 'Valor ganado atribuido', 'Leídos', 'Respondidos', 'Fallidos'],
      ...report.campaigns.items.map((campaign) => [campaign.name, campaign.template_name, campaign.status, campaign.created_at, campaign.total_recipients, campaign.sent_count, campaign.delivered_count, asPercent(campaign.delivery_rate), asPercent(campaign.read_rate), asPercent(campaign.reply_rate), campaign.attributed_deals, campaign.attributed_won_deals, campaign.attributed_won_value, campaign.read_count, campaign.replied_count, campaign.failed_count]),
      [], ['Totales', '', '', report.campaigns.totals.recipients, report.campaigns.totals.delivered, report.campaigns.totals.read, report.campaigns.totals.replied, report.campaigns.totals.failed],
      ['Tasas', '', '', asPercent(report.campaigns.delivery_rate), asPercent(report.campaigns.read_rate), asPercent(report.campaigns.reply_rate)],
    ] },
  ]
  if (report.nexo_memory) {
    const memory = report.nexo_memory
    sheets.push({ name: 'Nexo Memory', rows: [
      ['Métrica', 'Valor'],
      ['Contactos con memoria', memory.contacts_with_memory],
      ['Riesgo alto', memory.high_risk_count], ['Riesgo medio', memory.medium_risk_count], ['Riesgo bajo', memory.low_risk_count],
      ['Oportunidad promedio', memory.average_opportunity_score ?? 'Sin datos'],
      ['Compromisos vencidos', memory.overdue_commitments], [],
      ['Objeción frecuente', 'Menciones'],
      ...memory.top_objections.map((item) => [item.objection, item.count]),
    ] })
  }
  if (report.appointments) {
    const appointments = report.appointments
    sheets.push({ name: 'Citas', rows: [
      ['Métrica', 'Valor'],
      ['Citas totales', appointments.total], ['Agendadas', appointments.scheduled], ['Confirmadas', appointments.confirmed],
      ['Completadas', appointments.completed], ['Canceladas', appointments.cancelled], ['No-show', appointments.no_show],
      ['Tasa de confirmación', asPercent(appointments.confirmation_rate)], ['Tasa de cancelación', asPercent(appointments.cancellation_rate)],
      ['Tasa de no-show', asPercent(appointments.no_show_rate)], ['Ocupación', asPercent(appointments.occupancy_rate)],
      ['Conversión desde conversación', asPercent(appointments.conversion_rate)],
    ] })
  }
  if (report.agendapro) {
    const agendapro = report.agendapro
    sheets.push({ name: 'AgendaPro', rows: [
      ['Métrica', 'Valor'],
      ['Reservas totales', agendapro.total], ['Confirmadas', agendapro.confirmed], ['Atendidas', agendapro.attended],
      ['No-show', agendapro.no_show], ['Canceladas', agendapro.cancelled],
      ['Tasa de no-show', asPercent(agendapro.no_show_rate)], ['Tasa de cancelación', asPercent(agendapro.cancellation_rate)],
      ['Tasa de atención', asPercent(agendapro.attendance_rate)],
    ] })
  }
  if (report.calls) {
    const calls = report.calls
    sheets.push({ name: 'Llamadas', rows: [
      ['Métrica', 'Valor'],
      ['Llamadas totales', calls.total], ['Con transcripción', calls.transcribed],
      ['Entrantes', calls.inbound], ['Salientes', calls.outbound], ['Internas', calls.internal],
      ['Duración promedio', callDuration(calls.average_duration_seconds)],
      ['Sentimiento promedio', calls.average_sentiment_score ?? 'Sin datos'],
      ['Análisis negativos', calls.negative], ['Tasa de análisis negativos', asPercent(calls.negative_rate)], [],
      ['Sentimiento', 'Llamadas'],
      ['Positivo', calls.sentiment_breakdown.positive], ['Neutral', calls.sentiment_breakdown.neutral],
      ['Negativo', calls.sentiment_breakdown.negative], ['Mixto', calls.sentiment_breakdown.mixed],
    ] })
  }
  if (insight) {
    sheets.push({ name: 'Dictamen IA', rows: [
      ['Dictamen IA para dirección'],
      ['Titular', insight.headline],
      ['Resumen', insight.summary], [],
      ['Prioridad', 'Área', 'Recomendación', 'Base'],
      ...insight.priorities.map((item) => [item.title, `${item.priority} · ${item.area}`, item.recommendation, item.rationale]), [],
      ['Riesgos', ...insight.risks],
      ['Oportunidades', ...insight.opportunities],
      ['Indicadores a vigilar', ...insight.indicators_to_watch],
      ...(insight.data_note ? [['Nota de datos', insight.data_note]] : []),
    ] })
  }
  return sheets
}

export function executiveReportCsv(report: ExecutiveReport, insight?: ExecutiveReportInsight | null) {
  return reportSheetsCsv(reportSheets(report, insight))
}

export function executiveReportExcelXml(report: ExecutiveReport, insight?: ExecutiveReportInsight | null) {
  return reportSheetsExcelXml(reportSheets(report, insight))
}

export function reportExportFilename(report: ExecutiveReport, extension: 'csv' | 'xls') {
  return `nexoomni-reporte-ejecutivo-${report.meta.range.from}-${report.meta.range.to}.${extension}`
}

export function executiveReportPrintHtml(report: ExecutiveReport, insight?: ExecutiveReportInsight | null) {
  return reportSheetsPrintHtml(
    reportSheets(report, insight),
    'Reporte ejecutivo NexoOmni',
    `Periodo: ${report.meta.range.from} al ${report.meta.range.to} · Perfil: ${operatingMode(report.meta.operating_mode)}`,
    'es',
    'NexoOmni - Reporte ejecutivo'
  )
}
