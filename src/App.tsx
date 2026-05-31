import { FormEvent, useEffect, useMemo, useState } from 'react';
import { buildReportUpload, normalizeReportForHash, parseSpyReportText, type SpyReportRow } from './domain/report';
import { isSupabaseConfigured, supabase } from './lib/supabase';

type FilterState = {
  maxAgeDays: number;
  player: string;
  alliance: string;
  ocean: string;
};

const defaultFilters: FilterState = {
  maxAgeDays: 2,
  player: '',
  alliance: '',
  ocean: '',
};

const hashReport = async (rawReport: string): Promise<string> => {
  const payload = new TextEncoder().encode(normalizeReportForHash(rawReport));
  const digest = await crypto.subtle.digest('SHA-256', payload);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

export const App = () => {
  const [filters, setFilters] = useState<FilterState>(defaultFilters);
  const [reports, setReports] = useState<SpyReportRow[]>([]);
  const [rawReport, setRawReport] = useState('');
  const parsedPreview = useMemo(() => parseSpyReportText(rawReport), [rawReport]);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const loadReports = async () => {
    if (!supabase) {
      return;
    }

    setIsLoading(true);
    setMessage(null);

    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - filters.maxAgeDays);

    let query = supabase
      .from('spy_reports')
      .select('*')
      .gte('reported_at', fromDate.toISOString())
      .order('reported_at', { ascending: false })
      .limit(200);

    if (filters.player.trim()) {
      query = query.ilike('target_player', `%${filters.player.trim()}%`);
    }

    if (filters.alliance.trim()) {
      query = query.ilike('target_alliance', `%${filters.alliance.trim()}%`);
    }

    if (filters.ocean.trim()) {
      query = query.eq('ocean', Number(filters.ocean));
    }

    const { data, error } = await query;
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
            <span>{reports.length} Treffer</span>
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
              Ozean
              <input
                inputMode="numeric"
                value={filters.ocean}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, ocean: event.target.value }))
                }
              />
            </label>
            <button type="button" onClick={loadReports} disabled={isLoading || !isSupabaseConfigured}>
              Filtern
            </button>
          </div>

          <div className="report-list">
            {reports.map((report) => (
              <article className="report-row" key={report.id}>
                <div>
                  <strong>{report.target_player || 'Unbekannter Spieler'}</strong>
                  <span>{report.target_alliance || 'Keine Allianz'}</span>
                </div>
                <div>
                  <span>
                    {report.ocean ?? '-'}:{report.island_y ?? '-'}:{report.island_x ?? '-'}
                  </span>
                </div>
                <time dateTime={report.reported_at}>
                  {new Intl.DateTimeFormat('de-DE', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  }).format(new Date(report.reported_at))}
                </time>
                <details>
                  <summary>Rohbericht</summary>
                  <pre>{report.raw_report}</pre>
                </details>
              </article>
            ))}
            {!reports.length && <p className="empty">Keine Berichte fur diese Filter.</p>}
          </div>
        </section>
      </section>
    </main>
  );
};
