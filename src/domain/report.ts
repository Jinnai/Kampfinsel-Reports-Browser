export type ReportSource = 'manual' | 'loss-calculator' | 'userscript' | 'api';
export type SpyReportType = 'player' | 'old-empire' | 'corsair-fortress';

export type ReportResources = {
  gold: number;
  stone: number;
  wood: number;
};

export type SpyReportRow = {
  id: string;
  report_hash: string;
  reported_at: string;
  target_player: string | null;
  target_alliance: string | null;
  ocean: number | null;
  island_x: number | null;
  island_y: number | null;
  raw_report: string;
  parsed_report: Record<string, unknown>;
  source: ReportSource;
  created_at: string;
};

export type ParsedSpyReport = {
  reportType: SpyReportType | null;
  reportedAt: string | null;
  targetPlayer: string | null;
  targetAlliance: string | null;
  ocean: number | null;
  islandX: number | null;
  islandY: number | null;
  resources: ReportResources | null;
  validationErrors: string[];
  isValid: boolean;
};

export type SpyReportUpload = Omit<ParsedSpyReport, 'reportedAt' | 'validationErrors' | 'isValid'> & {
  reportedAt: string;
  rawReport: string;
  source: ReportSource;
};

const REQUIRED_PLAYER_SECTIONS = ['Gebäude', 'Truppen', 'Schiffe', 'Ressourcen', 'Forschen'];

const trimValue = (value: string | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

const parseInteger = (value: string | undefined): number | null => {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value.replace(/\./g, ''), 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseReportDate = (rawReport: string): string | null => {
  const match = rawReport.match(
    /(?:datum|zeit|uhrzeit|date|time)\s*:?\s*(\d{1,2})\.(\d{1,2})\.(\d{2,4})(?:,?\s+(\d{1,2}):(\d{2}))?/i,
  );

  if (!match) {
    return null;
  }

  const [, day, month, year, hour = '0', minute = '0'] = match;
  const fullYear = year.length === 2 ? `20${year}` : year;
  const parsed = new Date(
    Number(fullYear),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
  );

  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const hasSection = (rawReport: string, section: string): boolean =>
  new RegExp(`^\\s*${section}\\s*$`, 'im').test(rawReport);

const parseTargetLine = (rawReport: string) => {
  const targetLine = rawReport.match(/^\s*ziel\s*:?\s*(.+)$/im)?.[1];

  if (!targetLine) {
    return {
      player: null,
      alliance: null,
      ocean: null,
      islandX: null,
      islandY: null,
    };
  }

  const wrappedCoords = targetLine.match(/\((\d{1,2})\s*:\s*(\d{1,3})\s*:\s*(\d{1,3})\)/);
  const plainCoords = targetLine.match(/^\s*(\d{1,2})\s*:\s*(\d{1,3})\s*:\s*(\d{1,3})\s*$/);
  const coords = wrappedCoords ?? plainCoords;
  const alliance = trimValue(targetLine.match(/\[([^\]]+)\]/)?.[1]);
  const player = plainCoords
    ? null
    : trimValue(
        targetLine
          .replace(/\[[^\]]+\]/g, '')
          .replace(/\([^)]+\)/g, '')
          .replace(/^[^\p{L}\p{N}_#-]+/u, ''),
      );

  return {
    player,
    alliance,
    ocean: parseInteger(coords?.[1]),
    islandY: parseInteger(coords?.[2]),
    islandX: parseInteger(coords?.[3]),
  };
};

const detectReportType = (rawReport: string): SpyReportType | null => {
  if (/Korsaren-Festung gesichtet/i.test(rawReport)) {
    return 'corsair-fortress';
  }

  if (/Altreich/i.test(rawReport) && /Fanatiker der Alten See/i.test(rawReport)) {
    return 'old-empire';
  }

  if (/^\s*Spähbericht\s*$/im.test(rawReport)) {
    return 'player';
  }

  if (
    /^\s*ziel\s*:/im.test(rawReport)
    && REQUIRED_PLAYER_SECTIONS.every((section) => hasSection(rawReport, section))
  ) {
    return 'player';
  }

  return null;
};

const parseResourceLine = (rawReport: string, label: string): number | null => {
  const match = rawReport.match(new RegExp(`^\\s*${label}\\s+([\\d.]+)\\b`, 'im'));
  return parseInteger(match?.[1]);
};

const parseCorsairResourceLine = (rawReport: string, label: string): number | null => {
  const match = rawReport.match(
    new RegExp(`^\\s*Geschätzte Beute \\(${label}\\)\\s+([\\d.]+)\\b`, 'im'),
  );
  return parseInteger(match?.[1]);
};

const parseResources = (rawReport: string, reportType: SpyReportType | null): ReportResources | null => {
  const gold = reportType === 'corsair-fortress'
    ? parseCorsairResourceLine(rawReport, 'Gold')
    : parseResourceLine(rawReport, 'Gold');
  const stone = reportType === 'corsair-fortress'
    ? parseCorsairResourceLine(rawReport, 'Stein')
    : parseResourceLine(rawReport, 'Stein');
  const wood = reportType === 'corsair-fortress'
    ? parseCorsairResourceLine(rawReport, 'Holz')
    : parseResourceLine(rawReport, 'Holz');

  return gold === null || stone === null || wood === null ? null : { gold, stone, wood };
};

const validateReport = (
  rawReport: string,
  reportType: SpyReportType | null,
  reportedAt: string | null,
  target: ReturnType<typeof parseTargetLine>,
  resources: ReportResources | null,
): string[] => {
  const errors: string[] = [];

  if (!reportType) errors.push('Berichtstyp muss Spieler, Altreich oder Korsaren-Festung sein.');
  if (!reportedAt) errors.push('Datum fehlt oder ist unlesbar.');
  if (target.ocean === null || target.islandY === null || target.islandX === null) {
    errors.push('Ziel-Koordinaten fehlen oder sind unlesbar.');
  }
  if (!resources) errors.push('Ressourcen Gold, Stein und Holz müssen vorhanden sein.');

  if (reportType === 'player') {
    if (!target.player) errors.push('Spielerbericht braucht einen Ziel-Spieler.');
    REQUIRED_PLAYER_SECTIONS.forEach((section) => {
      if (!hasSection(rawReport, section)) errors.push(`Abschnitt ${section} fehlt.`);
    });
  }

  if (reportType === 'old-empire') {
    if (!target.player) errors.push('Altreich-Bericht braucht einen Ziel-Namen.');
    if (!hasSection(rawReport, 'Ressourcen')) errors.push('Altreich-Bericht braucht den Ressourcen-Abschnitt.');
  }

  if (reportType === 'corsair-fortress') {
    if (!/^ziel\s*:?\s*\d{1,2}\s*:\s*\d{1,3}\s*:\s*\d{1,3}\s*$/im.test(rawReport)) {
      errors.push('Korsaren-Festung braucht Ziel-Koordinaten ohne Spielernamen.');
    }
    if (!/^Bastions-Stärke\s+[\d.]+\b/im.test(rawReport)) errors.push('Bastions-Stärke fehlt.');
    if (!/^Errichtet\s+\d{1,2}\.\d{1,2}\.\d{2,4},?\s+\d{1,2}:\d{2}/im.test(rawReport)) {
      errors.push('Errichtet-Zeitpunkt fehlt.');
    }
    if (!/^Verfällt\s+\d{1,2}\.\d{1,2}\.\d{2,4},?\s+\d{1,2}:\d{2}/im.test(rawReport)) {
      errors.push('Verfällt-Zeitpunkt fehlt.');
    }
    if (!/^Status:\s*\S+/im.test(rawReport)) errors.push('Status fehlt.');
  }

  return errors;
};

export const parseSpyReportText = (rawReport: string): ParsedSpyReport => {
  const reportType = detectReportType(rawReport);
  const reportedAt = parseReportDate(rawReport);
  const target = parseTargetLine(rawReport);
  const resources = parseResources(rawReport, reportType);
  const validationErrors = validateReport(rawReport, reportType, reportedAt, target, resources);

  return {
    reportType,
    reportedAt,
    targetPlayer: target.player ?? (reportType === 'corsair-fortress' ? 'Korsaren-Festung' : null),
    targetAlliance: target.alliance,
    ocean: target.ocean,
    islandX: target.islandX,
    islandY: target.islandY,
    resources,
    validationErrors,
    isValid: validationErrors.length === 0,
  };
};

export const sectionBody = (rawReport: string, start: string, endMarkers: string[]): string => {
  const startMatch = new RegExp(`^\\s*${start}\\s*$`, 'im').exec(rawReport);
  if (!startMatch) return '';

  const startIndex = startMatch.index + startMatch[0].length;
  const rest = rawReport.slice(startIndex);
  if (!endMarkers.length) return rest;
  const endPattern = new RegExp(`^\\s*(?:${endMarkers.join('|')})\\s*$`, 'im');
  const endMatch = endPattern.exec(rest);
  return endMatch ? rest.slice(0, endMatch.index) : rest;
};

export const parseSectionEntries = (
  rawReport: string,
  start: string,
  endMarkers: string[],
): Array<{ name: string; count: number }> =>
  sectionBody(rawReport, start, endMarkers)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const match = line.match(/^(.+?)\s+([\d.]+)$/);
      if (!match) return [];
      const count = Number(match[2].replace(/\./g, ''));
      return count > 0 ? [{ name: match[1], count }] : [];
    });

export const normalizeReportForHash = (rawReport: string): string =>
  rawReport.replace(/\s+/g, ' ').trim().toLowerCase();

export const formatReportCoordinates = (
  ocean: number | null | undefined,
  islandY: number | null | undefined,
  islandX: number | null | undefined,
): string => `${ocean ?? '-'}:${islandY ?? '-'}:${islandX ?? '-'}`;

export const matchesCoordinatePrefix = (
  report: Pick<SpyReportRow, 'ocean' | 'island_y' | 'island_x'>,
  query: string,
): boolean => {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return true;

  return formatReportCoordinates(report.ocean, report.island_y, report.island_x)
    .startsWith(normalizedQuery);
};

export const buildReportUpload = (rawReport: string): SpyReportUpload => {
  const parsed = parseSpyReportText(rawReport);

  if (!parsed.isValid || !parsed.reportedAt) {
    throw new Error(`Ungültiger Bericht: ${parsed.validationErrors.join(' ')}`);
  }

  return {
    ...parsed,
    reportType: parsed.reportType,
    resources: parsed.resources,
    reportedAt: parsed.reportedAt,
    rawReport,
    source: 'manual',
  };
};
