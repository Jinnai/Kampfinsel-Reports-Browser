import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  buildReportUpload,
  formatReportCoordinates,
  matchesCoordinatePrefix,
  normalizeReportForHash,
  parseSpyReportText,
  type SpyReportRow,
} from './domain/report';
import { isSupabaseConfigured, supabase } from './lib/supabase';

type FilterState = {
  maxAgeDays: number;
  player: string;
  alliance: string;
  coordinates: string;
};

const defaultFilters: FilterState = {
  maxAgeDays: 2,
  player: '',
  alliance: '',
  coordinates: '',
};

const CALCULATOR_URL = 'https://jinnai.github.io/Kampfinsel-Verlustrechner/';

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

const calculatorUrlForReport = (rawReport: string): string =>
  `${CALCULATOR_URL}#report=${encodeURIComponent(btoa(toBase64Utf8(rawReport)))}`;

const formatPlayerAlliance = (report: SpyReportRow): string => {
  const player = report.target_player || 'Unbekannter Spieler';
  return report.target_alliance ? `${player} [${report.target_alliance}]` : player;
};

export const App = () => {
  const [filters, setFilters] = useState<FilterState>(defaultFilters);
  const [reports, setReports] = useState<SpyReportRow[]>([]);
  const [rawReport, setRawReport] = useState('');
  const [copiedReportId, setCopiedReportId] = useState<string | null>(null);
  const parsedPreview = useMemo(() => parseSpyReportText(rawReport), [rawReport]);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const filteredReports = useMemo(() => {
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - filters.maxAgeDays);
    const player = filters.player.trim().toLowerCase();
    const alliance = filters.alliance.trim().toLowerCase();

    return reports.filter((report) => {
      if (new Date(report.reported_at) < fromDate) return false;
      if (player && !String(report.target_player ?? '').toLowerCase().includes(player)) return false;
      if (alliance && !String(report.target_alliance ?? '').toLowerCase().includes(alliance)) return false;
      if (!matchesCoordinatePrefix(report, filters.coordinates)) return false;
      return true;
    });
  }, [filters, reports]);

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
      setMessage(error instanceof Error ? error.message : 'Ungueltiger Bericht.');
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
        <div>
          <h1>Kampfinsel Berichte</h1>
        </div>
        <button type="button" onClick={loadReports} disabled={isLoading || !isSupabaseConfigured}>
          Aktualisieren
        </button>
      </header>

      {!isSupabaseConfigured && (
        <section className="notice">
          Supabase ist noch nicht konfiguriert. Trage `VITE_SUPABASE_URL` und
          `VITE_SUPABASE_ANON_KEY` in `.env.local` ein.
        </section>
      )}

      {message && <section className="notice">{message}</section>}

      <section className="layout">
        <form className="panel upload-panel" onSubmit={uploadReport}>
          <h2>Bericht hochladen</h2>
          <textarea
            value={rawReport}
            onChange={(event) => setRawReport(event.target.value)}
            placeholder="Spahbericht hier einfugen..."
            rows={14}
          />
          <div className="metadata-grid">
            <div>
              Typ
              <strong>{parsedPreview.reportType ?? '-'}</strong>
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
              Spieler
              <strong>{parsedPreview.targetPlayer ?? '-'}</strong>
            </div>
            <div>
              Allianz
              <strong>{parsedPreview.targetAlliance ?? '-'}</strong>
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
                  ? `${parsedPreview.resources.gold}/${parsedPreview.resources.stone}/${parsedPreview.resources.wood}`
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
            <div className="validation-ok">Bericht ist gueltig und kann gespeichert werden.</div>
          )}
          <button
            type="submit"
            disabled={isLoading || !isSupabaseConfigured || !rawReport.trim() || !parsedPreview.isValid}
          >
            Speichern
          </button>
        </form>

        <section className="panel browse-panel">
          <div className="panel-header">
            <h2>Berichte browsen</h2>
            <span>
              {filteredReports.length} / {reports.length} Treffer
            </span>
          </div>
          <div className="filters">
            <label>
              Max. Alter
              <select
                value={filters.maxAgeDays}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, maxAgeDays: Number(event.target.value) }))
                }
              >
                <option value={1}>1 Tage</option>
                <option value={2}>2 Tage</option>
                <option value={7}>7 Tage</option>
                <option value={30}>30 Tage</option>
              </select>
            </label>
            <label>
              Spieler
              <input
                value={filters.player}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, player: event.target.value }))
                }
              />
            </label>
            <label>
              Allianz
              <input
                value={filters.alliance}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, alliance: event.target.value }))
                }
              />
            </label>
            <label>
              Koordinaten
              <input
                value={filters.coordinates}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, coordinates: event.target.value }))
                }
              />
            </label>
          </div>

          <div className="report-list">
            {filteredReports.map((report) => (
              <article className="report-row" key={report.id}>
                <div className="report-main">
                  <div>
                    <strong>{formatPlayerAlliance(report)}</strong>
                    <span>{formatReportCoordinates(report.ocean, report.island_y, report.island_x)}</span>
                  </div>
                </div>
                <div className="report-actions">
                  <time dateTime={report.reported_at}>
                    {new Intl.DateTimeFormat('de-DE', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    }).format(new Date(report.reported_at))}
                  </time>
                </div>
                <details className="report-details">
                  <summary>
                    <span className="report-summary-label">
                      <span className="report-summary-arrow">▸</span>
                      Rohbericht
                    </span>
                    <span className="report-detail-actions">
                      <button
                        className="copy-report-button"
                        type="button"
                        title="Rohbericht kopieren"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          void copyRawReport(report);
                        }}
                      >
                        {copiedReportId === report.id ? '✓' : '📋'}
                      </button>
                      <a
                        className="calculator-link"
                        href={calculatorUrlForReport(report.raw_report)}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(event) => event.stopPropagation()}
                      >
                        Verlustrechner
                      </a>
                    </span>
                  </summary>
                  <pre>{report.raw_report}</pre>
                </details>
              </article>
            ))}
            {!filteredReports.length && <p className="empty">Keine Berichte fur diese Filter.</p>}
          </div>
        </section>
      </section>
    </main>
  );
};
