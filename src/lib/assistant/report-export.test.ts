import { describe, expect, it } from 'vitest'
import {
  reportSheetsCsv,
  reportSheetsExcelXml,
  reportSheetsPrintHtml,
} from '@/lib/reports/export-utils'

const sheets = [{
  name: 'Metrics',
  rows: [
    ['Value', 'Comment'],
    ['=HYPERLINK("https://example.invalid")', '<script>alert("x")</script>'],
  ],
}]

describe('assistant report exports', () => {
  it('neutralizes spreadsheet formulas in CSV and Excel output', () => {
    expect(reportSheetsCsv(sheets)).toContain("'=HYPERLINK")
    expect(reportSheetsExcelXml(sheets)).toContain('&apos;=HYPERLINK')
  })

  it('escapes report data and headings in printable HTML', () => {
    const html = reportSheetsPrintHtml(sheets, 'Report <script>', 'Period & filter')
    expect(html).toContain('Report &lt;script&gt;')
    expect(html).toContain('Period &amp; filter')
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;')
    expect(html).not.toContain('<script>alert')
  })
})
