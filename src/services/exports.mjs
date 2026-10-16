import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { fail } from '../errors.mjs';

export async function exportReport(report, format) {
  const filename = report.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  if (format === 'xlsx') {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Smart Trolley Management';
    const sheet = workbook.addWorksheet('Report');
    sheet.addRow(report.columns);
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF125FA7' } };
    for (const row of report.rows) sheet.addRow(row.map((value) => value ?? ''));
    sheet.columns.forEach((column, index) => {
      column.width = Math.min(45, Math.max(18, report.columns[index].length + 3));
    });
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: report.columns.length },
    };
    return {
      filename: filename + '.xlsx',
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
    };
  }
  if (format !== 'pdf') fail(400, 'Choose xlsx or pdf');
  const document = new PDFDocument({
    size: 'A3',
    layout: 'landscape',
    margin: 32,
    autoFirstPage: true,
  });
  const chunks = [];
  const finished = new Promise((resolve, reject) => {
    document.on('data', (chunk) => chunks.push(chunk));
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', reject);
  });
  const width = (document.page.width - 64) / report.columns.length;
  const row = (values, heading = false) => {
    document.font(heading ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
    const height = Math.max(
      22,
      ...values.map(
        (value) => document.heightOfString(String(value ?? ''), { width: width - 10 }) + 12,
      ),
    );
    if (document.y + height > document.page.height - 38) {
      document.addPage();
      row(report.columns, true);
    }
    const y = document.y;
    values.forEach((value, index) => {
      if (heading) document.rect(32 + index * width, y, width, height).fill('#e8f1fb');
      document
        .fillColor('#172b40')
        .text(String(value ?? ''), 37 + index * width, y + 5, { width: width - 10 });
    });
    document
      .moveTo(32, y + height)
      .lineTo(document.page.width - 32, y + height)
      .strokeColor('#d8e2ec')
      .stroke();
    document.x = 32;
    document.y = y + height;
  };
  document.fontSize(20).text(report.title);
  document
    .fontSize(9)
    .text(
      `${report.rows.length} records · Generated ${new Date(report.generatedAt).toISOString()} · UTC`,
    );
  document.moveDown();
  row(report.columns, true);
  report.rows.forEach((values) => row(values));
  document.end();
  return { filename: filename + '.pdf', type: 'application/pdf', buffer: await finished };
}
