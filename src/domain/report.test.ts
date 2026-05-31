import { describe, expect, it } from 'vitest';
import { normalizeReportForHash, parseSpyReportText } from './report';

describe('parseSpyReportText', () => {
  it('extracts common report metadata', () => {
    const parsed = parseSpyReportText(`
      Datum: 31.05.2026 15:30
      Spieler: Testspieler
      Allianz: TEST
      Ozean: 12
      Insel: 345|678
    `);

    expect(parsed.targetPlayer).toBe('Testspieler');
    expect(parsed.targetAlliance).toBe('TEST');
    expect(parsed.ocean).toBe(12);
    expect(parsed.islandX).toBe(345);
    expect(parsed.islandY).toBe(678);
  });

  it('extracts target metadata from Kampfinsel spy reports', () => {
    const parsed = parseSpyReportText(`
      Spähbericht

      Datum: 31.05.2026, 03:03

      Spion: 👑 kaba [BIER] (18:6:13)

      Ziel: 🏴‍☠️ dukolek [BEST] (19:2:20)
    `);

    expect(parsed.targetPlayer).toBe('dukolek');
    expect(parsed.targetAlliance).toBe('BEST');
    expect(parsed.ocean).toBe(19);
    expect(parsed.islandX).toBe(2);
    expect(parsed.islandY).toBe(20);
    expect(new Date(parsed.reportedAt).getHours()).toBe(3);
    expect(new Date(parsed.reportedAt).getMinutes()).toBe(3);
  });
});

describe('normalizeReportForHash', () => {
  it('keeps duplicate detection stable across whitespace and casing', () => {
    expect(normalizeReportForHash(' Spieler: Test\n\nOzean: 12 ')).toBe(
      normalizeReportForHash('spieler: test ozean: 12'),
    );
  });
});
