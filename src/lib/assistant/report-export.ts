import {
  reportSheetsCsv,
  reportSheetsExcelXml,
  reportSheetsPrintHtml,
  type ReportExportSheet,
} from '@/lib/reports/export-utils'
import type {
  AssistantReportChannel,
  AssistantReportData,
  AssistantReportSectionKey,
} from './report-types'

type AssistantReportWarning = AssistantReportData['warnings'][number]

export interface AssistantReportExportLabels {
  language: string
  title: string
  period: string
  channel: string
  agent: string
  agentFiltered: string
  filterNone: string
  warningsTitle: string
  sectionTitles: Record<AssistantReportSectionKey, string>
  channelTitles: Record<AssistantReportChannel, string>
  columnTitles: Record<string, string>
  warningTitles: Record<AssistantReportWarning, string>
  valueTitles: Record<string, string>
}

export function assistantReportSheets(
  report: AssistantReportData,
  labels: AssistantReportExportLabels
): ReportExportSheet[] {
  const summaryRows = [
    [labels.period, `${report.from} - ${report.to}`],
    [labels.channel, report.filters.channel ? labels.channelTitles[report.filters.channel] : labels.filterNone],
    [labels.agent, report.filters.agent_selected ? labels.agentFiltered : labels.filterNone],
  ]
  if (report.warnings.length > 0) {
    summaryRows.push([labels.warningsTitle])
    summaryRows.push(...report.warnings.map((warning) => [labels.warningTitles[warning]]))
  }

  const sections: ReportExportSheet[] = [
    { name: labels.title.slice(0, 31), rows: summaryRows },
    ...report.sections.map((item) => ({
      name: labels.sectionTitles[item.key].slice(0, 31),
      rows: [
        item.columns.map((column) => labels.columnTitles[column] ?? column),
        ...item.rows.map((row) => row.map((cell) =>
          typeof cell === 'string' ? labels.valueTitles[cell] ?? cell : cell
        )),
      ],
    })),
  ]
  return sections
}

export function assistantReportCsv(
  report: AssistantReportData,
  labels: AssistantReportExportLabels
) {
  return reportSheetsCsv(assistantReportSheets(report, labels))
}

export function assistantReportExcelXml(
  report: AssistantReportData,
  labels: AssistantReportExportLabels
) {
  return reportSheetsExcelXml(assistantReportSheets(report, labels))
}

export function assistantReportPrintHtml(
  report: AssistantReportData,
  labels: AssistantReportExportLabels
) {
  return reportSheetsPrintHtml(
    assistantReportSheets(report, labels),
    labels.title,
    `${labels.period}: ${report.from} - ${report.to}`,
    labels.language
  )
}

export function assistantReportFilename(
  report: AssistantReportData,
  extension: 'csv' | 'xls'
) {
  return `nexoomni-reporte-${report.from}-${report.to}.${extension}`
}
