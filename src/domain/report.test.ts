import { describe, expect, it } from 'vitest';
import { matchesCoordinatePrefix, normalizeReportForHash, parseSpyReportText } from './report';

const playerReport = `
Spähbericht

Datum: 20.05.2026, 04:18
Aufgenommen am: 20.05.2026, 04:18
Spion: 👑 kaba [BIER] (17:7:8)
Ziel: ⚓ ler12167 [BnH] (17:2:20)

Gebäude
Gebäude\tStufe
Haupthaus\t11

Truppen
Einheit\tAnzahl
Steinwerfer\t18

Schiffe
Schiff\tAnzahl
Kleines Kriegsschiff\t5

Ressourcen
Ressource\tMenge
Gold\t1699
Stein\t1195
Holz\t2366

Forschen
Technologie\tStufe
Segel\t4
`;

const oldEmpireReport = `
Spähbericht

Datum: 31.05.2026, 18:57
Spion: 👑 kaba [BIER] (15:1:13)
Ziel: 🪵 Altreich #31588511 (15:7:11)

Verteidigungsaura
Fanatiker der Alten See

Ressourcen
Ressource\tMenge
Gold\t777
Stein\t389
Holz\t443
`;

const corsairReport = `
Korsaren-Festung gesichtet

Datum: 31.05.2026, 16:17
Spion: 👑 kaba [BIER] (15:1:13)
Ziel: 15:1:12

Korsaren-Festung gesichtet
Bastions-Stärke\t60000
Geschätzte Beute (Gold)\t16666
Geschätzte Beute (Stein)\t16666
Geschätzte Beute (Holz)\t16666
Errichtet\t30.05.2026, 18:07
Verfällt\t06.06.2026, 18:07
Status: Aktiv
`;

describe('parseSpyReportText', () => {
  it('accepts player spy reports with required sections and resources', () => {
    const parsed = parseSpyReportText(playerReport);

    expect(parsed.isValid).toBe(true);
    expect(parsed.reportType).toBe('player');
    expect(parsed.targetPlayer).toBe('ler12167');
    expect(parsed.targetAlliance).toBe('BnH');
    expect(parsed.ocean).toBe(17);
    expect(parsed.islandY).toBe(2);
    expect(parsed.islandX).toBe(20);
    expect(parsed.resources).toEqual({ gold: 1699, stone: 1195, wood: 2366 });
  });

  it('accepts manually copied player reports without the title line', () => {
    const parsed = parseSpyReportText(`
Datum: 01.06.2026, 05:47
Aufgenommen am: 01.06.2026, 05:47
Spion: 👑 kaba [BIER] (17:7:8)
Ziel: ⚔ schwabe [BnH] (17:8:18)
Gebäude
Gebäude\tStufe
Haupthaus\t6
Truppen

Keine Truppen stationiert.
Schiffe

Keine Schiffe im Hafen.
Ressourcen
Ressource\tMenge
Gold\t2416
Stein\t611
Holz\t2041
Forschen
Technologie\tStufe
Schild\t10
`);

    expect(parsed.isValid).toBe(true);
    expect(parsed.reportType).toBe('player');
    expect(parsed.targetPlayer).toBe('schwabe');
    expect(parsed.targetAlliance).toBe('BnH');
    expect(parsed.ocean).toBe(17);
    expect(parsed.islandY).toBe(8);
    expect(parsed.islandX).toBe(18);
    expect(parsed.resources).toEqual({ gold: 2416, stone: 611, wood: 2041 });
  });

  it('accepts old empire reports with coordinates and resources', () => {
    const parsed = parseSpyReportText(oldEmpireReport);

    expect(parsed.isValid).toBe(true);
    expect(parsed.reportType).toBe('old-empire');
    expect(parsed.targetPlayer).toBe('Altreich #31588511');
    expect(parsed.ocean).toBe(15);
    expect(parsed.islandY).toBe(7);
    expect(parsed.islandX).toBe(11);
    expect(parsed.resources).toEqual({ gold: 777, stone: 389, wood: 443 });
  });

  it('accepts corsair fortress reports with bastion, loot, dates, and status', () => {
    const parsed = parseSpyReportText(corsairReport);

    expect(parsed.isValid).toBe(true);
    expect(parsed.reportType).toBe('corsair-fortress');
    expect(parsed.targetPlayer).toBe('Korsaren-Festung');
    expect(parsed.ocean).toBe(15);
    expect(parsed.islandY).toBe(1);
    expect(parsed.islandX).toBe(12);
    expect(parsed.resources).toEqual({ gold: 16666, stone: 16666, wood: 16666 });
  });

  it('rejects malformed reports before upload', () => {
    const parsed = parseSpyReportText('Spähbericht\n\nZiel: irgendwas');

    expect(parsed.isValid).toBe(false);
    expect(parsed.validationErrors).toContain('Datum fehlt oder ist unlesbar.');
    expect(parsed.validationErrors).toContain('Ziel-Koordinaten fehlen oder sind unlesbar.');
    expect(parsed.validationErrors).toContain('Ressourcen Gold, Stein und Holz müssen vorhanden sein.');
  });
});

describe('normalizeReportForHash', () => {
  it('keeps duplicate detection stable across whitespace and casing', () => {
    expect(normalizeReportForHash(' Spieler: Test\n\nOzean: 12 ')).toBe(
      normalizeReportForHash('spieler: test ozean: 12'),
    );
  });
});

describe('matchesCoordinatePrefix', () => {
  const report = { ocean: 16, island_y: 4, island_x: 12 };

  it('matches coordinate prefixes from the start', () => {
    expect(matchesCoordinatePrefix(report, '16')).toBe(true);
    expect(matchesCoordinatePrefix(report, '16:4:')).toBe(true);
    expect(matchesCoordinatePrefix(report, '16:4:1')).toBe(true);
  });

  it('does not match coordinate fragments outside the start', () => {
    expect(matchesCoordinatePrefix(report, '4:12')).toBe(false);
    expect(matchesCoordinatePrefix({ ocean: 12, island_y: 3, island_x: 19 }, '19')).toBe(false);
  });
});
