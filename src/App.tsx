import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  buildReportUpload,
  formatReportCoordinates,
  matchesCoordinatePrefix,
  normalizeReportForHash,
  parseSpyReportText,
  type ReportResources,
  type SpyReportRow,
} from './domain/report';
import { isSupabaseConfigured, supabase } from './lib/supabase';

type FilterState = {
  maxAgeDays: number;
  player: string;
  alliance: string;
  coordinates: string;
  ownCoordinates: string;
};

type SortMode = 'newest' | 'nearest' | 'loot-desc' | 'def-asc' | 'def-desc';
type ViewMode = 'browse' | 'upload';
type DropdownId = 'age' | 'sort' | null;

type DefenseSummary = {
  p1: number;
  p2: number;
  p3: number;
};

type ReportViewModel = {
  report: SpyReportRow;
  coordinates: string;
  displayName: string;
  resources: ReportResources;
  lootTotal: number;
  defense: DefenseSummary;
  defenseTotal: number;
  distance: number | null;
  travelTime: string;
  relativeTime: string;
};

const defaultFilters: FilterState = {
  maxAgeDays: 2,
  player: '',
  alliance: '',
  coordinates: '',
  ownCoordinates: '',
};

const storageKeys = {
  maxAgeDays: 'kampfinselReports.maxAgeDays',
  ownCoordinates: 'kampfinselReports.ownCoordinates',
  sortMode: 'kampfinselReports.sortMode',
};

const CALCULATOR_URL = 'https://jinnai.github.io/Kampfinsel-Verlustrechner/';
const TRAVEL_TIME_SECONDS_FACTOR = 1282.62225;
const SPY_SHIP_SPEED = 12;
const DISCORD_WEBHOOK_URL = import.meta.env.VITE_DISCORD_WEBHOOK_URL as string | undefined;

const reportTypeLabels: Record<string, string> = {
  player: 'Spieler',
  'old-empire': 'Altreich',
  'corsair-fortress': 'Korsaren-Festung',
};

const sortModes: SortMode[] = ['newest', 'nearest', 'loot-desc', 'def-asc', 'def-desc'];
const sortOptions = [
  { value: 'newest', label: 'Datum' },
  { value: 'nearest', label: 'Distanz' },
  { value: 'loot-desc', label: 'Beute' },
  { value: 'def-asc', label: '↑ DEF' },
  { value: 'def-desc', label: '↓ DEF' },
];
const ageOptions = [
  { value: '1', label: '1 Tag' },
  { value: '2', label: '2 Tage' },
  { value: '7', label: '7 Tage' },
  { value: '14', label: '14 Tage' },
];

const readStoredNumber = (key: string, fallback: number): number => {
  const value = Number(window.localStorage.getItem(key));
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const readStoredSortMode = (): SortMode => {
  const value = window.localStorage.getItem(storageKeys.sortMode);
  return sortModes.includes(value as SortMode) ? value as SortMode : 'newest';
};

const readInitialFilters = (): FilterState => ({
  ...defaultFilters,
  maxAgeDays: readStoredNumber(storageKeys.maxAgeDays, defaultFilters.maxAgeDays),
  ownCoordinates: window.localStorage.getItem(storageKeys.ownCoordinates) ?? defaultFilters.ownCoordinates,
});

const landUnits = [
  { name: 'Steinwerfer', defense: 8 },
  { name: 'Speerträger', defense: 25 },
  { name: 'Bogenschütze', defense: 10 },
  { name: 'Katapult', defense: 5 },
];

const combatShips = [
  { name: 'Kleines Kriegsschiff', defense: 30 },
  { name: 'Großes Kriegsschiff', defense: 80 },
  { name: 'Kolonisierungsschiff', defense: 50 },
];

const buildingKeys = {
  haupthaus: 'Haupthaus',
  mauer: 'Steinmauer',
  hafen: 'Hafen',
  lagerhaus: 'Lagerhaus',
} as const;

const hashReport = async (rawReport: string): Promise<string> => {
  const payload = new TextEncoder().encode(normalizeReportForHash(rawReport));
  const digest = await crypto.subtle.digest('SHA-256', payload);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

const toBase64Utf8 = (value: string): string =>
  Array.from(new TextEncoder().encode(value))
    .reduce((binary, byte) => `${binary}${String.fromCharCode(byte)}`, '');

const calculatorUrlForReport = (rawReport?: string): string =>
  rawReport
    ? `${CALCULATOR_URL}#report=${encodeURIComponent(btoa(toBase64Utf8(rawReport)))}`
    : CALCULATOR_URL;

const rawReportDisplayHeadings = new Set([
  'Gebäude',
  'Truppen',
  'Schiffe',
  'Ressourcen',
  'Verbündete Verstärkungen',
  'Forschen',
  'Verteidigungsaura',
  'Korsaren-Festung gesichtet',
]);

const formatRawReportForDisplay = (rawReport: string): string => {
  const lines = rawReport
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== '');

  if (lines[0]?.trim() === 'Spähbericht') {
    lines.shift();
  }

  const output: string[] = [];
  const firstLine = lines[0]?.trim();

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    const isTitleSpacer = index === 1 && (firstLine === 'Spähbericht' || firstLine === 'Korsaren-Festung gesichtet');
    const isSectionHeading = index > 0 && rawReportDisplayHeadings.has(trimmed);

    if ((isTitleSpacer || isSectionHeading) && output.length > 0 && output[output.length - 1] !== '') {
      output.push('');
    }

    output.push(line);
  });

  return output.join('\n').trimEnd();
};

const formatPlayerAlliance = (report: SpyReportRow): string => {
  const player = report.target_player || 'Unbekanntes Ziel';
  return report.target_alliance ? `${player} [${report.target_alliance}]` : player;
};

const parseStoredResources = (report: SpyReportRow): ReportResources => {
  const resources = report.parsed_report?.resources;
  if (
    resources
    && typeof resources === 'object'
    && 'gold' in resources
    && 'stone' in resources
    && 'wood' in resources
  ) {
    return {
      gold: Number(resources.gold) || 0,
      stone: Number(resources.stone) || 0,
      wood: Number(resources.wood) || 0,
    };
  }

  return parseSpyReportText(report.raw_report).resources ?? { gold: 0, stone: 0, wood: 0 };
};

const parseOwnCoordinates = (value: string) => {
  const match = value.trim().match(/^(\d{1,2})\s*:\s*(\d{1,2})\s*:\s*(\d{1,2})$/);
  if (!match) return null;

  return {
    ocean: Number(match[1]),
    islandY: Number(match[2]),
    islandX: Number(match[3]),
  };
};

const calculateDistance = (report: SpyReportRow, ownCoordinates: string): number | null => {
  const own = parseOwnCoordinates(ownCoordinates);
  if (!own || report.ocean === null || report.island_y === null || report.island_x === null) return null;

  const deltaX = 50 * (report.ocean - own.ocean) + (report.island_x - own.islandX);
  const deltaY = 5 * (report.island_y - own.islandY);
  return Math.hypot(deltaX, deltaY);
};

const formatTravelTime = (distance: number | null): string => {
  if (distance === null) return '-';
  const minutes = Math.max(1, Math.round((distance / SPY_SHIP_SPEED) * TRAVEL_TIME_SECONDS_FACTOR / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes ? `${hours} h ${restMinutes} min` : `${hours} h`;
};

const formatRelativeTime = (value: string): string => {
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60000);
  if (!Number.isFinite(minutes)) return '-';
  if (minutes < 1) return 'gerade eben';
  if (minutes < 60) return `vor ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `vor ${hours} h`;
  const days = Math.round(hours / 24);
  return `vor ${days} Tagen`;
};

const numberFormatter = new Intl.NumberFormat('en-US');

const formatCompactNumber = (value: number): string => {
  if (value >= 1000) return `${numberFormatter.format(Math.round(value / 100) / 10)}k`;
  return numberFormatter.format(value);
};

const sectionBody = (rawReport: string, start: string, endMarkers: string[]): string => {
  const startMatch = new RegExp(`^\\s*${start}\\s*$`, 'im').exec(rawReport);
  if (!startMatch) return '';

  const startIndex = startMatch.index + startMatch[0].length;
  const rest = rawReport.slice(startIndex);
  if (!endMarkers.length) return rest;
  const endPattern = new RegExp(`^\\s*(?:${endMarkers.join('|')})\\s*$`, 'im');
  const endMatch = endPattern.exec(rest);
  return endMatch ? rest.slice(0, endMatch.index) : rest;
};

const quantityForName = (sections: string[], name: string): number => {
  const pattern = new RegExp(`^\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+([\\d.]+)\\s*$`, 'gim');

  return sections.reduce((total, section) => {
    let sectionTotal = 0;
    for (const match of section.matchAll(pattern)) {
      sectionTotal += Number(match[1].replace(/\./g, '')) || 0;
    }
    return total + sectionTotal;
  }, 0);
};

const parseBuildingLevels = (rawReport: string) => {
  const levels = {
    haupthaus: 0,
    mauer: 0,
    hafen: 0,
    lagerhaus: 0,
    totalLevels: 0,
  };

  const buildingsSection = sectionBody(rawReport, 'Gebäude', ['Truppen', 'Schiffe', 'Ressourcen', 'Verbündete Verstärkungen', 'Forschen']);
  buildingsSection.split(/\r?\n/).forEach((line) => {
    const match = line.trim().match(/^(.+?)\s+(\d+)$/);
    if (!match) return;

    const level = Number(match[2]) || 0;
    levels.totalLevels += level;
    if (match[1] === buildingKeys.haupthaus) levels.haupthaus = level;
    if (match[1] === buildingKeys.mauer) levels.mauer = level;
    if (match[1] === buildingKeys.hafen) levels.hafen = level;
    if (match[1] === buildingKeys.lagerhaus) levels.lagerhaus = level;
  });

  return levels;
};

const calculateObservedBaseDefense = (buildings: ReturnType<typeof parseBuildingLevels>): number => {
  if (!buildings.haupthaus) {
    const legacyBaseLevels = buildings.totalLevels - buildings.hafen;
    return Math.max(5, Math.floor(legacyBaseLevels / 2) + 2);
  }

  return Math.max(5, Math.floor(buildings.totalLevels / 2.45 + buildings.haupthaus * 0.57));
};

const calculateBaseDefense = (buildings: ReturnType<typeof parseBuildingLevels>): number => {
  if (!buildings.haupthaus) return calculateObservedBaseDefense(buildings);
  const adjustedHaupthaus = buildings.haupthaus < 10 ? buildings.haupthaus + 1 : buildings.haupthaus;
  return calculateObservedBaseDefense({
    ...buildings,
    haupthaus: adjustedHaupthaus,
    totalLevels: buildings.totalLevels + 1,
  });
};

const parseShieldResearch = (rawReport: string): number => {
  const match = rawReport.match(/^\s*Schild\s+(\d+)/im);
  return match ? Number(match[1]) || 0 : 0;
};

const parseCorsairDefense = (rawReport: string): number => {
  const match = rawReport.match(/^Bastions-Stärke\s+([\d.]+)\b/im);
  return match ? Number(match[1].replace(/\./g, '')) || 0 : 0;
};

const parseDefenseSummary = (rawReport: string): DefenseSummary => {
  if (/Korsaren-Festung gesichtet/i.test(rawReport)) {
    return { p1: 0, p2: 0, p3: parseCorsairDefense(rawReport) };
  }

  if (/Altreich/i.test(rawReport) && /Fanatiker der Alten See/i.test(rawReport)) {
    return { p1: 0, p2: 0, p3: 500 };
  }

  const buildings = parseBuildingLevels(rawReport);
  const shieldResearch = parseShieldResearch(rawReport);
  const troops = sectionBody(rawReport, 'Truppen', ['Schiffe', 'Ressourcen', 'Verbündete Verstärkungen', 'Forschen']);
  const ships = sectionBody(rawReport, 'Schiffe', ['Ressourcen', 'Verbündete Verstärkungen', 'Forschen']);
  const reinforcements = sectionBody(rawReport, 'Verbündete Verstärkungen', ['Forschen']);
  const troopSections = [troops, reinforcements];
  const shipSections = [ships, reinforcements];
  const troopDefense = landUnits.reduce(
    (total, unit) => total + quantityForName(troopSections, unit.name) * (unit.defense + shieldResearch * 2),
    0,
  );
  const shipDefense = combatShips.reduce(
    (total, ship) => total + quantityForName(shipSections, ship.name) * ship.defense,
    0,
  );

  return {
    p1: shipDefense,
    p2: buildings.hafen * 10,
    p3: buildings.mauer * 100 + calculateBaseDefense(buildings) + troopDefense,
  };
};

const toViewModel = (report: SpyReportRow, ownCoordinates: string): ReportViewModel => {
  const resources = parseStoredResources(report);
  const defense = parseDefenseSummary(report.raw_report);
  const distance = calculateDistance(report, ownCoordinates);
  const coordinates = formatReportCoordinates(report.ocean, report.island_y, report.island_x);

  return {
    report,
    coordinates,
    displayName: formatPlayerAlliance(report),
    resources,
    lootTotal: resources.gold + resources.stone + resources.wood,
    defense,
    defenseTotal: defense.p1 + defense.p2 + defense.p3,
    distance,
    travelTime: formatTravelTime(distance),
    relativeTime: formatRelativeTime(report.reported_at),
  };
};

const sortReports = (reports: ReportViewModel[], sortMode: SortMode): ReportViewModel[] => {
  const sorted = [...reports];

  sorted.sort((a, b) => {
    if (sortMode === 'nearest') return (a.distance ?? Number.POSITIVE_INFINITY) - (b.distance ?? Number.POSITIVE_INFINITY);
    if (sortMode === 'loot-desc') return b.lootTotal - a.lootTotal;
    if (sortMode === 'def-asc') return a.defenseTotal - b.defenseTotal;
    if (sortMode === 'def-desc') return b.defenseTotal - a.defenseTotal;
    return new Date(b.report.reported_at).getTime() - new Date(a.report.reported_at).getTime();
  });

  return sorted;
};

const parseSectionField = (rawReport: string, start: string, endMarkers: string[]): string => {
  const body = sectionBody(rawReport, start, endMarkers);
  const lines = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const match = line.match(/^(.+?)\s+([\d.]+)$/);
      if (!match) return [];
      const count = Number(match[2].replace(/\./g, ''));
      return count > 0 ? [`${match[1]}: ${numberFormatter.format(count)}`] : [];
    });
  const value = lines.join('\n');
  return value.length ? (value.length > 1024 ? `${value.slice(0, 1021)}...` : value) : '-';
};

const sendDiscordWebhook = async (
  upload: ReturnType<typeof buildReportUpload>,
): Promise<void> => {
  if (!DISCORD_WEBHOOK_URL) return;

  const partialRow: SpyReportRow = {
    id: '',
    report_hash: '',
    reported_at: upload.reportedAt,
    target_player: upload.targetPlayer ?? null,
    target_alliance: upload.targetAlliance ?? null,
    ocean: upload.ocean,
    island_x: upload.islandX,
    island_y: upload.islandY,
    raw_report: upload.rawReport,
    parsed_report: { resources: upload.resources },
    source: upload.source,
    created_at: new Date().toISOString(),
  };

  const vm = toViewModel(partialRow, '');
  const reportTypeLabel = reportTypeLabels[upload.reportType ?? ''] ?? upload.reportType ?? 'Unbekannt';
  const absoluteDate = new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(vm.report.reported_at),
  );

  const raw = upload.rawReport;
  const allSections = ['Gebäude', 'Truppen', 'Schiffe', 'Ressourcen', 'Verbündete Verstärkungen', 'Forschen'];

  const embed = {
    title: vm.displayName,
    description: `📍 **${vm.coordinates}** · ${absoluteDate}`,
    color: 0x5865F2,
    fields: [
      {
        name: 'Gebäude',
        value: parseSectionField(raw, 'Gebäude', allSections.slice(1)),
        inline: true,
      },
      {
        name: 'Forschen',
        value: parseSectionField(raw, 'Forschen', []),
        inline: true,
      },
      { name: '​', value: '​', inline: true },
      {
        name: 'Truppen',
        value: parseSectionField(raw, 'Truppen', ['Schiffe', 'Ressourcen', 'Verbündete Verstärkungen', 'Forschen']),
        inline: true,
      },
      {
        name: 'Schiffe',
        value: parseSectionField(raw, 'Schiffe', ['Ressourcen', 'Verbündete Verstärkungen', 'Forschen']),
        inline: true,
      },
      { name: '​', value: '​', inline: true },
      {
        name: 'Ressourcen',
        value: `⚜ ${numberFormatter.format(vm.resources.gold)}\n🪨 ${numberFormatter.format(vm.resources.stone)}\n🪵 ${numberFormatter.format(vm.resources.wood)}\n**Beute: ${formatCompactNumber(vm.lootTotal)}**`,
        inline: false,
      },
    ],
    timestamp: vm.report.reported_at,
    footer: { text: 'BIER Intelligence Office' },
  };

  await fetch(DISCORD_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'BIER Intelligence Office', embeds: [embed] }),
  });
};

type CustomSelectProps = {
  id: Exclude<DropdownId, null>;
  label: string;
  onChange: (value: string) => void;
  onOpenChange: (id: DropdownId) => void;
  openDropdown: DropdownId;
  options: Array<{ value: string; label: string }>;
  value: string;
};

const CustomSelect = ({
  id,
  label,
  onChange,
  onOpenChange,
  openDropdown,
  options,
  value,
}: CustomSelectProps) => {
  const selected = options.find((option) => option.value === value) ?? options[0];
  const isOpen = openDropdown === id;

  return (
    <div className="custom-select">
      <span className="custom-select-label">{label}</span>
      <button
        className="custom-select-button"
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => onOpenChange(isOpen ? null : id)}
      >
        <span>{selected.label}</span>
        <span className="material-symbols-outlined" aria-hidden="true">expand_more</span>
      </button>
      {isOpen && (
        <div className="custom-select-menu" role="listbox">
          {options.map((option) => (
            <button
              className={option.value === value ? 'custom-select-option active' : 'custom-select-option'}
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              onClick={() => {
                onChange(option.value);
                onOpenChange(null);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export const App = () => {
  const [filters, setFilters] = useState<FilterState>(readInitialFilters);
  const [reports, setReports] = useState<SpyReportRow[]>([]);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [rawReport, setRawReport] = useState('');
  const [copiedReportId, setCopiedReportId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('browse');
  const [sortMode, setSortMode] = useState<SortMode>(readStoredSortMode);
  const [openDropdown, setOpenDropdown] = useState<DropdownId>(null);
  const [isDetailClosed, setIsDetailClosed] = useState(false);
  const parsedPreview = useMemo(() => parseSpyReportText(rawReport), [rawReport]);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const filteredReports = useMemo(() => {
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - filters.maxAgeDays);
    const player = filters.player.trim().toLowerCase();
    const alliance = filters.alliance.trim().toLowerCase();

    const filtered = reports.filter((report) => {
      if (new Date(report.reported_at) < fromDate) return false;
      if (player && !String(report.target_player ?? '').toLowerCase().includes(player)) return false;
      if (alliance && !String(report.target_alliance ?? '').toLowerCase().includes(alliance)) return false;
      if (!matchesCoordinatePrefix(report, filters.coordinates)) return false;
      return true;
    });

    return sortReports(filtered.map((report) => toViewModel(report, filters.ownCoordinates)), sortMode);
  }, [filters, reports, sortMode]);

  const selectedReport = useMemo(
    () => {
      if (isDetailClosed) return null;
      return filteredReports.find((report) => report.report.id === selectedReportId) ?? filteredReports[0] ?? null;
    },
    [filteredReports, isDetailClosed, selectedReportId],
  );

  useEffect(() => {
    if (!filteredReports.length) {
      setSelectedReportId(null);
      return;
    }

    if (!isDetailClosed && (!selectedReportId || !filteredReports.some((report) => report.report.id === selectedReportId))) {
      setSelectedReportId(filteredReports[0].report.id);
    }
  }, [filteredReports, isDetailClosed, selectedReportId]);

  const loadReports = async () => {
    if (!supabase) {
      return;
    }

    setIsLoading(true);
    setMessage(null);

    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - 180);

    const { data, error } = await supabase
      .from('spy_reports')
      .select('*')
      .gte('reported_at', fromDate.toISOString())
      .order('reported_at', { ascending: false })
      .limit(200);
    setIsLoading(false);

    if (error) {
      setMessage(error.message);
      return;
    }

    setReports(data ?? []);
  };

  useEffect(() => {
    void loadReports();
  }, []);

  useEffect(() => {
    window.localStorage.setItem(storageKeys.maxAgeDays, String(filters.maxAgeDays));
  }, [filters.maxAgeDays]);

  useEffect(() => {
    window.localStorage.setItem(storageKeys.ownCoordinates, filters.ownCoordinates);
  }, [filters.ownCoordinates]);

  useEffect(() => {
    window.localStorage.setItem(storageKeys.sortMode, sortMode);
  }, [sortMode]);

  const uploadReport = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!supabase || !rawReport.trim()) {
      return;
    }

    setIsLoading(true);
    setMessage(null);

    let upload;
    try {
      upload = buildReportUpload(rawReport);
    } catch (error) {
      setIsLoading(false);
      setMessage(error instanceof Error ? error.message : 'Ungültiger Bericht.');
      return;
    }

    const reportHash = await hashReport(upload.rawReport);
    const { error } = await supabase.from('spy_reports').insert(
      {
        report_hash: reportHash,
        reported_at: upload.reportedAt,
        target_player: upload.targetPlayer,
        target_alliance: upload.targetAlliance,
        ocean: upload.ocean,
        island_x: upload.islandX,
        island_y: upload.islandY,
        raw_report: upload.rawReport,
        parsed_report: {
          reportType: upload.reportType,
          reportedAt: upload.reportedAt,
          targetPlayer: upload.targetPlayer,
          targetAlliance: upload.targetAlliance,
          ocean: upload.ocean,
          islandX: upload.islandX,
          islandY: upload.islandY,
          resources: upload.resources,
        },
        source: upload.source,
      },
    );

    setIsLoading(false);

    if (error && error.code !== '23505') {
      setMessage(error.message);
      return;
    }

    setRawReport('');
    setMessage(error?.code === '23505' ? 'Bericht war bereits vorhanden.' : 'Bericht gespeichert.');
    setViewMode('browse');
    if (!error) void sendDiscordWebhook(upload).catch(() => undefined);
    await loadReports();
  };

  const copyRawReport = async (report: SpyReportRow) => {
    await navigator.clipboard.writeText(report.raw_report);
    setCopiedReportId(report.id);
    window.setTimeout(() => setCopiedReportId((current) => (current === report.id ? null : current)), 1500);
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="material-symbols-outlined brand-mark" aria-hidden="true">strategy</span>
          <div>
            <h1>BIER Intelligence Office</h1>
          </div>
        </div>
        <nav className="topnav" aria-label="Hauptnavigation">
          <button
            className={viewMode === 'browse' ? 'nav-item active' : 'nav-item'}
            type="button"
            onClick={() => setViewMode('browse')}
          >
            Browse
          </button>
          <button
            className={viewMode === 'upload' ? 'nav-item active' : 'nav-item'}
            type="button"
            onClick={() => setViewMode('upload')}
          >
            Upload
          </button>
        </nav>
      </header>

      {!isSupabaseConfigured && (
        <section className="notice">
          Supabase ist noch nicht konfiguriert. Trage `VITE_SUPABASE_URL` und
          `VITE_SUPABASE_ANON_KEY` in `.env.local` ein.
        </section>
      )}

      {message && <section className="notice">{message}</section>}

      {viewMode === 'browse' ? (
        <section className={selectedReport ? 'ledger-layout detail-open' : 'ledger-layout'}>
          <aside className="quick-filter-pane">
            <div>
              <p className="eyebrow">Quick Filters</p>
            </div>

            <div className="filter-stack">
              <CustomSelect
                id="age"
                label="Alter"
                value={String(filters.maxAgeDays)}
                options={ageOptions}
                openDropdown={openDropdown}
                onOpenChange={setOpenDropdown}
                onChange={(value) =>
                  setFilters((current) => ({ ...current, maxAgeDays: Number(value) }))
                }
              />
              <label>
                Spieler
                <input
                  value={filters.player}
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, player: event.target.value }))
                  }
                  placeholder="zhero"
                />
              </label>
              <label>
                Allianz
                <input
                  value={filters.alliance}
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, alliance: event.target.value }))
                  }
                  placeholder="INT"
                />
              </label>
              <label>
                Koordinate
                <input
                  value={filters.coordinates}
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, coordinates: event.target.value }))
                  }
                  placeholder="15:"
                />
              </label>
            </div>

            <label className="own-coordinate-field">
              Startkoordinate
              <input
                value={filters.ownCoordinates}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, ownCoordinates: event.target.value }))
                }
                placeholder="15:1:13"
              />
              <span>Basis für Fahrtzeit (max. Forschung)</span>
            </label>
          </aside>

          <section className="report-browser-pane">
            <div className="pane-header">
              <div>
                <h2>Spähberichte</h2>
                <span className="hit-count">
                  {filteredReports.length} / {reports.length} Treffer
                </span>
              </div>
              <div className="toolbar">
                <button className="icon-button" type="button" onClick={loadReports} disabled={isLoading || !isSupabaseConfigured}>
                  <span className="material-symbols-outlined" aria-hidden="true">refresh</span>
                </button>
                <CustomSelect
                  id="sort"
                  label="Sortierung"
                  value={sortMode}
                  options={sortOptions}
                  openDropdown={openDropdown}
                  onOpenChange={setOpenDropdown}
                  onChange={(value) => setSortMode(value as SortMode)}
                />
              </div>
            </div>

            <div className="report-list">
              {filteredReports.map((item) => (
                <button
                  className={selectedReport?.report.id === item.report.id ? 'report-card selected' : 'report-card'}
                  key={item.report.id}
                  type="button"
                  onClick={() => {
                    setSelectedReportId(item.report.id);
                    setIsDetailClosed(false);
                  }}
                >
                  <div className="card-coordinate">
                    <span>Coords</span>
                    <strong>{item.coordinates}</strong>
                    <em>
                      <span className="material-symbols-outlined" aria-hidden="true">sailing</span>
                      {item.travelTime}
                    </em>
                  </div>
                  <div className="card-body">
                    <div className="card-title-line">
                      <strong>{item.displayName}</strong>
                      <time dateTime={item.report.reported_at}>{item.relativeTime}</time>
                    </div>
                    <div className="card-ledger" aria-label="Verteidigungswerte und Ressourcen">
                      <div className="defense-row">
                        <span className="material-symbols-outlined defense-icon" aria-hidden="true">shield</span>
                        <span className="defense-values">
                          <span>P1: {formatCompactNumber(item.defense.p1)}</span>
                          <span>P2: {formatCompactNumber(item.defense.p2)}</span>
                          <span>P3: {formatCompactNumber(item.defense.p3)}</span>
                        </span>
                      </div>
                      <div className="resource-row">
                        <span>⚜ {formatCompactNumber(item.resources.gold)}</span>
                        <span>🪨 {formatCompactNumber(item.resources.stone)}</span>
                        <span>🪵 {formatCompactNumber(item.resources.wood)}</span>
                      </div>
                    </div>
                  </div>
                </button>
              ))}
              {!filteredReports.length && <p className="empty">Keine Berichte für diese Filter.</p>}
            </div>
          </section>

          <aside className="detail-pane">
            {selectedReport ? (
              <>
                <div className="detail-header">
                  <div>
                    <h2>{selectedReport.displayName}</h2>
                    <span className="detail-date">
                      <span className="material-symbols-outlined" aria-hidden="true">calendar_today</span>
                      {new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(selectedReport.report.reported_at))}
                    </span>
                  </div>
                  <div className="detail-actions">
                    <a
                      className="calculator-link external-link"
                      href={calculatorUrlForReport(selectedReport.report.raw_report)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <span>Verlustrechner</span>
                      <span className="material-symbols-outlined" aria-hidden="true">open_in_new</span>
                    </a>
                    <button
                      className="detail-close-button"
                      type="button"
                      aria-label="Detailansicht schließen"
                      onClick={() => {
                        setIsDetailClosed(true);
                        setSelectedReportId(null);
                      }}
                    >
                      <span className="material-symbols-outlined" aria-hidden="true">close</span>
                    </button>
                  </div>
                </div>
                <div className="raw-report-wrap">
                  <button
                    className="copy-report-button"
                    type="button"
                    onClick={() => void copyRawReport(selectedReport.report)}
                  >
                    {copiedReportId === selectedReport.report.id ? (
                      '✓'
                    ) : (
                      <span className="material-symbols-outlined" aria-hidden="true">content_copy</span>
                    )}
                  </button>
                  <pre className="raw-report">{formatRawReportForDisplay(selectedReport.report.raw_report)}</pre>
                </div>
              </>
            ) : (
              <div className="detail-empty">
                <p className="empty">Wähle einen Bericht aus.</p>
              </div>
            )}
          </aside>
        </section>
      ) : (
        <section className="upload-view">
          <form className="upload-panel" onSubmit={uploadReport}>
            <div className="pane-header">
              <div>
                <h2>Upload</h2>
                <span className="upload-subtitle">Neuer Bericht</span>
              </div>
              <button
                type="submit"
                disabled={isLoading || !isSupabaseConfigured || !rawReport.trim() || !parsedPreview.isValid}
              >
                Speichern
              </button>
            </div>
            <textarea
              value={rawReport}
              onChange={(event) => setRawReport(event.target.value)}
              placeholder="Spähbericht hier einfügen..."
              rows={18}
            />
            <div className="metadata-grid">
              <div>
                Typ
                <strong>{parsedPreview.reportType ? reportTypeLabels[parsedPreview.reportType] : '-'}</strong>
              </div>
              <div>
                Zeitpunkt
                <strong>
                  {parsedPreview.reportedAt
                    ? new Intl.DateTimeFormat('de-DE', {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      }).format(new Date(parsedPreview.reportedAt))
                    : '-'}
                </strong>
              </div>
              <div>
                Ziel
                <strong>
                  {parsedPreview.targetPlayer
                    ? `${parsedPreview.targetPlayer}${parsedPreview.targetAlliance ? ` [${parsedPreview.targetAlliance}]` : ''}`
                    : '-'}
                </strong>
              </div>
              <div>
                Koordinaten
                <strong>
                  {parsedPreview.ocean ?? '-'}:{parsedPreview.islandY ?? '-'}:
                  {parsedPreview.islandX ?? '-'}
                </strong>
              </div>
              <div>
                Ressourcen
                <strong>
                  {parsedPreview.resources
                    ? `${numberFormatter.format(parsedPreview.resources.gold)} / ${numberFormatter.format(parsedPreview.resources.stone)} / ${numberFormatter.format(parsedPreview.resources.wood)}`
                    : '-'}
                </strong>
              </div>
            </div>
            {rawReport.trim() && !parsedPreview.isValid && (
              <div className="validation-errors">
                {parsedPreview.validationErrors.map((error) => (
                  <div key={error}>{error}</div>
                ))}
              </div>
            )}
            {rawReport.trim() && parsedPreview.isValid && (
              <div className="validation-ok">Gültig.</div>
            )}
          </form>
        </section>
      )}
    </main>
  );
};
