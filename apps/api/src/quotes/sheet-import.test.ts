import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { googleSheetId, normalizeProposal, SheetImportError, sheetToText } from './sheet-import.js';

describe('sheet importer helpers', () => {
  it('turns every tab into "cell: value" rows, using computed values for formulas', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Opción 1');
    ws.addRow(['Concepto', 'Costo']);
    ws.addRow(['Precio neto', 3900]);
    ws.getCell('B3').value = { formula: 'B2*2', result: 7800 };
    wb.addWorksheet('Vacía');
    const text = await sheetToText(Buffer.from(await wb.xlsx.writeBuffer()), 'costos.xlsx');
    expect(text).toContain('=== Pestaña "Opción 1" ===');
    expect(text).toContain('A2: Precio neto | B2: 3900');
    expect(text).toContain('B3: 7800');
    expect(text).toContain('=== Pestaña "Vacía" ===');
  });

  it('rejects other formats and broken files', async () => {
    await expect(sheetToText(Buffer.from('x'), 'costos.pdf')).rejects.toBeInstanceOf(SheetImportError);
    await expect(sheetToText(Buffer.from('not a zip'), 'costos.xlsx')).rejects.toThrow('Excel válido');
    expect(await sheetToText(Buffer.from('a,b\n1,2'), 'c.CSV')).toBe('a,b\n1,2');
  });

  it('accepts only Google Sheets links', () => {
    const id = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
    expect(googleSheetId(`https://docs.google.com/spreadsheets/d/${id}/edit#gid=0`)).toBe(id);
    expect(googleSheetId(`https://docs.google.com/spreadsheets/d/${id}`)).toBe(id);
    expect(googleSheetId(`https://evil.example/spreadsheets/d/${id}`)).toBeNull();
    expect(googleSheetId(`https://docs.google.com.evil.example/spreadsheets/d/${id}`)).toBeNull();
    expect(googleSheetId('https://docs.google.com/document/d/abc')).toBeNull();
  });

  it('keeps only valid lines, normalizes numbers and never trusts the model blindly', () => {
    const p = normalizeProposal({
      summary: 'Una opción en EUR',
      lines: [
        {
          category: 'PER_PARTICIPANT',
          description: ' Precio neto ',
          quantity: 1,
          unitCost: '3,900.50',
          currency: 'EUR',
          internalOnly: false,
        },
        {
          category: 'PER_STAFF',
          description: 'Viáticos',
          quantity: '16',
          unitCost: '50',
          currency: 'EUR',
          internalOnly: false,
          extra: 'x',
        },
        {
          category: 'PER_PARTICIPANT',
          description: 'Comisión escuela',
          quantity: '1',
          unitCost: '100',
          currency: 'EUR',
          internalOnly: true,
        },
        { category: 'OTHER', description: 'Mal', quantity: '1', unitCost: '1', currency: 'EUR' },
        { category: 'PER_GROUP', description: 'Negativo', quantity: '1', unitCost: '-5', currency: 'EUR' },
        { category: 'PER_GROUP', description: 'Moneda rara', quantity: '1', unitCost: '5', currency: 'JPY' },
      ],
      targetMarginRate: '1.5',
      itinerary: [
        { day: 1, title: 'Llegada a Roma' },
        { day: 0, title: 'inválido' },
      ],
      exclusions: ['Vuelos', '', 7],
      warnings: ['Había 3 opciones; se usó la primera'],
    });
    expect(p.lines).toEqual([
      expect.objectContaining({
        description: 'Precio neto',
        quantity: '1',
        unitCost: '3900.50',
        currency: 'EUR',
      }),
      expect.objectContaining({ description: 'Viáticos', quantity: '16', category: 'PER_STAFF' }),
      expect.objectContaining({ description: 'Comisión escuela', internalOnly: true }),
    ]);
    expect(p.targetMarginRate).toBeNull(); // 150% is not a valid commission
    expect(p.itinerary).toEqual([{ day: 1, title: 'Llegada a Roma' }]);
    expect(p.exclusions).toEqual(['Vuelos']);
    expect(p.warnings).toEqual([
      'Había 3 opciones; se usó la primera',
      'Se descartaron 3 conceptos con datos incompletos o inválidos',
    ]);
    expect(normalizeProposal({ lines: [], targetMarginRate: 0.18, warnings: [] }).targetMarginRate).toBe(
      '0.18',
    );
    expect(normalizeProposal(null)).toMatchObject({ lines: [], summary: '' });
  });
});
