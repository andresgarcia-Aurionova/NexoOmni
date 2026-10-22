export type ReportExportCell = string | number | null | undefined
export type ReportExportSheet = { name: string; rows: ReportExportCell[][] }

function display(value: ReportExportCell) {
  return value === null || value === undefined ? 'Sin datos' : String(value)
}

function safeCell(value: ReportExportCell) {
  const text = display(value)
  return /^[=+\-@]/.test(text.trimStart()) ? `'${text}` : text
}

function escapeCsv(value: ReportExportCell) {
  const text = safeCell(value).replaceAll('"', '""')
  return /[;"\n\r]/.test(text) ? `"${text}"` : text
}

function escapeXml(value: ReportExportCell) {
  return safeCell(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

export function reportSheetsCsv(sheets: ReportExportSheet[]) {
  return `\uFEFF${sheets.flatMap((sheet, index) => [...(index === 0 ? [] : [['']]), [sheet.name], ...sheet.rows]).map((row) => row.map(escapeCsv).join(';')).join('\r\n')}`
}

export function reportSheetsExcelXml(sheets: ReportExportSheet[]) {
  const worksheets = sheets.map((sheet) => {
    const rows = sheet.rows.map((row) => (
      `<Row>${row.map((cell) => `<Cell><Data ss:Type="String">${escapeXml(cell)}</Data></Cell>`).join('')}</Row>`
    )).join('')
    return `<Worksheet ss:Name="${escapeXml(sheet.name)}"><Table>${rows}</Table></Worksheet>`
  }).join('')
  return `<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">${worksheets}</Workbook>`
}

export function reportSheetsPrintHtml(
  sheets: ReportExportSheet[],
  title: string,
  subtitle: string,
  language = 'es',
  documentTitle = title
) {
  const sheetTable = (sheet: ReportExportSheet) => (
    `<section><h2>${escapeXml(sheet.name)}</h2><table><tbody>${sheet.rows.map((row, index) => `<tr>${row.map((cell) => `<${index === 0 ? 'th' : 'td'}>${escapeXml(cell)}</${index === 0 ? 'th' : 'td'}>`).join('')}</tr>`).join('')}</tbody></table></section>`
  )
  return `<!doctype html><html lang="${escapeXml(language)}"><head><meta charset="utf-8"><title>${escapeXml(documentTitle)}</title><style>body{font-family:Arial,sans-serif;color:#172033;margin:36px}h1{font-size:24px;margin:0 0 6px}p{color:#536075;margin:0 0 22px}h2{font-size:16px;margin:26px 0 8px}table{border-collapse:collapse;width:100%;font-size:11px;margin-bottom:14px}th,td{border:1px solid #d8dee9;padding:7px;text-align:left;vertical-align:top}th{background:#f1f4f8;font-weight:700}@media print{body{margin:18px}section{break-inside:avoid}}</style></head><body><h1>${escapeXml(title)}</h1><p>${escapeXml(subtitle)}</p>${sheets.map(sheetTable).join('')}</body></html>`
}
