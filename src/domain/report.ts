export type ReportSource = 'manual' | 'loss-calculator' | 'userscript' | 'api';

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
  reportedAt: string;
  targetPlayer: string | null;
  targetAlliance: string | null;
  ocean: number | null;
  islandX: number | null;
  islandY: number | null;
};

export type SpyReportUpload = ParsedSpyReport & {
  rawReport: string;
  source: ReportSource;
};

const trimValue = (value: string | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

const parseInteger = (value: string | undefined): number | null => {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseReportDate = (rawReport: string): string => {
  const match = rawReport.match(
    /(?:datum|zeit|uhrzeit|date|time)\s*:?\s*(\d{1,2})\.(\d{1,2})\.(\d{2,4})(?:,?\s+(\d{1,2}):(\d{2}))?/i,
  );

  if (!match) {
    return new Date().toISOString();
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

  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
};

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

  const coords = targetLine.match(/\((\d{1,2})\s*:\s*(\d{1,3})\s*:\s*(\d{1,3})\)/);
  const alliance = trimValue(targetLine.match(/\[([^\]]+)\]/)?.[1]);
  const player = trimValue(
    targetLine
      .replace(/\[[^\]]+\]/g, '')
      .replace(/\([^)]+\)/g, '')
      .replace(/^[^\p{L}\p{N}_-]+/u, ''),
  );

  return {
    player,
    alliance,
    ocean: parseInteger(coords?.[1]),
    islandY: parseInteger(coords?.[2]),
    islandX: parseInteger(coords?.[3]),
  };
};

export const parseSpyReportText = (rawReport: string): ParsedSpyReport => {
  const target = parseTargetLine(rawReport);
  const targetPlayer = target.player ?? trimValue(
    rawReport.match(/(?:spieler|player)\s*:?\s*([^\n\r]+)/i)?.[1],
  );
  const targetAlliance = target.alliance ?? trimValue(
    rawReport.match(/(?:allianz|alliance)\s*:?\s*([^\n\r]+)/i)?.[1],
  );
  const ocean =
    target.ocean ?? parseInteger(rawReport.match(/(?:ozean|ocean)\s*:?\s*(\d{1,2})/i)?.[1]);
  const coords =
    rawReport.match(
      /(?:koordinaten|position|insel|island)\s*:?\s*(\d{1,3})\s*[|:\/]\s*(\d{1,3})/i,
    ) ?? rawReport.match(/\b(\d{1,3})\s*\|\s*(\d{1,3})\b/i);

  return {
    reportedAt: parseReportDate(rawReport),
    targetPlayer,
    targetAlliance,
    ocean,
    islandX: target.islandX ?? parseInteger(coords?.[1]),
    islandY: target.islandY ?? parseInteger(coords?.[2]),
  };
};

export const normalizeReportForHash = (rawReport: string): string =>
  rawReport.replace(/\s+/g, ' ').trim().toLowerCase();

export const buildReportUpload = (
  rawReport: string,
  overrides: Partial<ParsedSpyReport> = {},
): SpyReportUpload => {
  const parsed = parseSpyReportText(rawReport);

  return {
    ...parsed,
    ...overrides,
    rawReport,
    source: 'manual',
  };
};
