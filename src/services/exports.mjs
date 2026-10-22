import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { existsSync } from 'node:fs';
import { fail } from '../errors.mjs';

function cell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return typeof value === 'string' ? value : String(value);
}
function csvCell(value) {
  const normalized = cell(value);
  let text = String(normalized);
  if (typeof normalized === 'string' && /^[\s]*[=+\-@]/.test(text)) text = "'" + text;
  return /[",\r\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
}
function wrap(document, value, width) {
  const lines = [];
  for (const paragraph of String(cell(value)).split(/\r?\n/)) {
    let line = '';
    for (const character of paragraph) {
      if (line && document.widthOfString(line + character) > width) {
        lines.push(line);
        line = '';
      }
      line += character;
    }
    lines.push(line);
  }
  return lines;
}
async function pdf(report) {
  const document = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margin: 30,
    compress: false,
    info: {
      Title: report.title,
      Author: 'Smart Trolley Management System',
      Subject: report.metric || '',
    },
  });
  const chunks = [];
  const completed = new Promise((resolve, reject) => {
    document.on('data', (chunk) => chunks.push(chunk));
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', reject);
  });
  const font = [
    process.env.WINDIR && `${process.env.WINDIR}\\Fonts\\arial.ttf`,
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/Library/Fonts/Arial.ttf',
  ].find((path) => path && existsSync(path));
  if (font) document.font(font);
  const left = 30,
    bottom = document.page.height - 30,
    width = document.page.width - 60;
  const columnWidth = width / Math.max(report.columns.length, 1),
    fontSize = report.columns.length > 10 ? 6 : 8,
    lineHeight = fontSize * 1.4;
  document.fontSize(16).text(report.title, left, 30, { width });
  document
    .fontSize(8)
    .text(
      `${report.rows.length} rows | Generated ${new Date(report.generatedAt || Date.now()).toISOString()} | ${report.timezone || 'UTC'}`,
      left,
      document.y + 6,
      { width },
    );
  if (report.metric) document.fontSize(8).text(report.metric, left, document.y + 4, { width });
  let y = document.y + 12;
  const drawLines = (columns, start, count, fill) => {
    const height = count * lineHeight + 8;
    if (fill) document.save().rect(left, y, width, height).fill('#e8eef2').restore();
    document.fontSize(fontSize).fillColor('#15232c');
    columns.forEach((lines, index) => {
      document.text(
        lines.slice(start, start + count).join('\n'),
        left + index * columnWidth + 4,
        y + 4,
        { width: columnWidth - 8, lineGap: fontSize * 0.2 },
      );
    });
    document
      .save()
      .strokeColor('#d0d7de')
      .moveTo(left, y + height)
      .lineTo(left + width, y + height)
      .stroke()
      .restore();
    y += height;
  };
  document.fontSize(fontSize);
  const headings = report.columns.map((value) => wrap(document, value, columnWidth - 8));
  const headingLines = Math.max(...headings.map((lines) => lines.length), 1);
  const header = () => drawLines(headings, 0, headingLines, true);
  const nextPage = () => {
    document.addPage();
    y = 30;
    header();
  };
  header();
  for (const row of report.rows) {
    document.fontSize(fontSize);
    const columns = report.columns.map((_, index) => wrap(document, row[index], columnWidth - 8));
    const lineCount = Math.max(...columns.map((lines) => lines.length), 1);
    let start = 0;
    while (start < lineCount) {
      let available = Math.floor((bottom - y - 8) / lineHeight);
      if (available < 1) {
        nextPage();
        available = Math.floor((bottom - y - 8) / lineHeight);
      }
      const count = Math.min(lineCount - start, available);
      drawLines(columns, start, count, false);
      start += count;
      if (start < lineCount) nextPage();
    }
  }
  if (!report.rows.length)
    document.fontSize(10).text('No records match the selected filters.', left, y + 12);
  document.end();
  return completed;
}

export const exportService = {
  async toBuffer(report, requestedFormat) {
    const format = String(requestedFormat || '').toLowerCase();
    const filename = String(report.type || 'trolley-report').replace(/[^a-z0-9_-]/gi, '-');
    if (format === 'csv') {
      const rows = [report.columns, ...report.rows];
      return {
        buffer: Buffer.from(
          '\uFEFF' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n',
          'utf8',
        ),
        contentType: 'text/csv; charset=utf-8',
        filename: `${filename}.csv`,
      };
    }
    if (format === 'xlsx' || format === 'excel') {
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'Smart Trolley Management System';
      workbook.created = new Date(report.generatedAt || Date.now());
      const worksheet = workbook.addWorksheet('Report');
      worksheet.addRow(report.columns);
      worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      worksheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF233847' },
      };
      for (const row of report.rows)
        worksheet.addRow(report.columns.map((_, index) => cell(row[index])));
      worksheet.columns.forEach((column, index) => {
        column.width = Math.min(50, Math.max(16, String(report.columns[index]).length + 2));
      });
      worksheet.views = [{ state: 'frozen', ySplit: 1 }];
      worksheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: Math.max(1, report.rows.length + 1), column: report.columns.length },
      };
      return {
        buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        filename: `${filename}.xlsx`,
      };
    }
    if (format === 'pdf')
      return {
        buffer: await pdf(report),
        contentType: 'application/pdf',
        filename: `${filename}.pdf`,
      };
    fail(400, 'Unsupported export format; choose csv, xlsx or pdf');
  },
};
