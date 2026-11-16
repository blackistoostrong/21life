'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Download, RefreshCw, Search } from 'lucide-react';
import { useLanguage } from '@/components/language-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { useAdminUsers } from '@/hooks/use-admin-users';
import { adminUserQuery, DEFAULT_ADMIN_USER_FILTERS, type AdminUserFilters } from '@/lib/admin-users-contract';

const selectClass = 'h-11 w-full rounded-xl border border-input bg-card px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="flex min-w-0 flex-col gap-1.5 text-xs font-semibold text-muted-foreground">{label}{children}</label>;
}

export function AdminUsersPanel() {
  const { copy: t, language } = useLanguage();
  const { filters, apply, report, error, loading, refresh } = useAdminUsers();
  const [draft, setDraft] = useState(filters);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const unapplied = JSON.stringify(draft) !== JSON.stringify(filters);
  useEffect(() => { setDraft(filters); setExportError(null); }, [filters]);
  const set = <K extends keyof AdminUserFilters>(key: K, value: AdminUserFilters[K]) => setDraft(current => ({ ...current, [key]: value }));
  const formatDate = (value: string | null) => value ? new Intl.DateTimeFormat(language === 'it' ? 'it-IT' : 'en-GB', {
    dateStyle: 'medium', timeStyle: 'short',
  }).format(new Date(value)) : '—';

  const exportReport = async () => {
    setExporting(true);
    setExportError(null);
    try {
      const query = adminUserQuery(filters);
      query.set('format', 'csv');
      const response = await fetch(`/api/admin/users?${query}`, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
      if (!response.ok) {
        setExportError(response.status === 413
          ? t({ it: 'Report troppo grande: restringi i filtri (massimo 5.000 utenti).', en: 'Report too large: narrow the filters (maximum 5,000 users).' })
          : response.status === 429 ? t({ it: 'Troppi export. Riprova più tardi.', en: 'Too many exports. Try again later.' })
            : t({ it: 'Export non disponibile. Riprova.', en: 'Export unavailable. Please retry.' }));
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = '21life-users.csv';
      document.body.append(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setExportError(t({ it: 'Export non disponibile. Riprova.', en: 'Export unavailable. Please retry.' })); }
    finally { setExporting(false); }
  };
  const pages = report ? Math.max(1, Math.ceil(report.total / filters.pageSize)) : 1;
  const summaryCards = report ? [
    [t({ it: 'Utenti filtrati', en: 'Matching users' }), report.total],
    [t({ it: 'Email confermate', en: 'Confirmed emails' }), report.summary.confirmed],
    [t({ it: 'Nuovi · 7 giorni', en: 'New · 7 days' }), report.summary.new7d],
    [t({ it: 'Attivi · 7 giorni', en: 'Active · 7 days' }), report.summary.active7d],
    [t({ it: 'Attivi · 30 giorni', en: 'Active · 30 days' }), report.summary.active30d],
  ] : [];

  return <div className="space-y-5" data-testid="admin-users-panel">
    <Card><CardContent className="p-4 sm:p-5">
      <form onSubmit={event => { event.preventDefault(); apply({ ...draft, page: 1 }); }} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2"><Field label={t({ it: 'Cerca username, nome o email', en: 'Search username, name or email' })}>
            <Input value={draft.search} maxLength={100} onChange={event => set('search', event.target.value)} type="search" autoComplete="off" />
          </Field></div>
          <Field label={t({ it: 'Conferma email', en: 'Email confirmation' })}><select className={selectClass} value={draft.status} onChange={event => set('status', event.target.value as AdminUserFilters['status'])}>
            <option value="all">{t({ it: 'Tutte', en: 'All' })}</option><option value="confirmed">{t({ it: 'Confermate', en: 'Confirmed' })}</option><option value="unconfirmed">{t({ it: 'Da confermare', en: 'Unconfirmed' })}</option>
          </select></Field>
          <Field label={t({ it: 'Attività registrata', en: 'Logged activity' })}><select className={selectClass} value={draft.activity} onChange={event => set('activity', event.target.value as AdminUserFilters['activity'])}>
            <option value="all">{t({ it: 'Tutta', en: 'All' })}</option><option value="7d">{t({ it: 'Attivi negli ultimi 7 giorni', en: 'Active in the last 7 days' })}</option><option value="30d">{t({ it: 'Attivi negli ultimi 30 giorni', en: 'Active in the last 30 days' })}</option>
            <option value="inactive">{t({ it: 'Nessun log negli ultimi 7 giorni', en: 'No log in the last 7 days' })}</option><option value="no_logs">{t({ it: 'Nessun log disponibile · 30 giorni', en: 'No available log · 30 days' })}</option>
          </select></Field>
          <Field label={t({ it: 'Piattaforma · ultimi 30 giorni', en: 'Platform · last 30 days' })}><select className={selectClass} value={draft.source} onChange={event => set('source', event.target.value as AdminUserFilters['source'])}>
            <option value="all">{t({ it: 'Tutte', en: 'All' })}</option><option value="web">Web</option><option value="app">App</option>
          </select></Field>
          <Field label={t({ it: 'Registrazione dal · UTC', en: 'Registered from · UTC' })}><Input type="date" value={draft.from} max={draft.to || undefined} onChange={event => set('from', event.target.value)} /></Field>
          <Field label={t({ it: 'Registrazione al · UTC', en: 'Registered until · UTC' })}><Input type="date" value={draft.to} min={draft.from || undefined} onChange={event => set('to', event.target.value)} /></Field>
          <Field label={t({ it: 'Ordina', en: 'Sort' })}><select className={selectClass} value={draft.sort} onChange={event => set('sort', event.target.value as AdminUserFilters['sort'])}>
            <option value="newest">{t({ it: 'Registrazione recente', en: 'Newest registration' })}</option><option value="oldest">{t({ it: 'Registrazione meno recente', en: 'Oldest registration' })}</option><option value="active">{t({ it: 'Ultima attività', en: 'Latest activity' })}</option><option value="games">{t({ it: 'Più partite', en: 'Most games' })}</option>
          </select></Field>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit"><Search className="mr-2 h-4 w-4" />{t({ it: 'Applica filtri', en: 'Apply filters' })}</Button>
          <Button type="button" variant="outline" onClick={() => { setDraft(DEFAULT_ADMIN_USER_FILTERS); apply(DEFAULT_ADMIN_USER_FILTERS); }}>{t({ it: 'Azzera', en: 'Reset' })}</Button>
          <Button type="button" variant="ghost" onClick={refresh} disabled={loading}><RefreshCw className="mr-2 h-4 w-4" />{t({ it: 'Aggiorna', en: 'Refresh' })}</Button>
          <Button type="button" variant="outline" onClick={() => void exportReport()} disabled={loading || !report || exporting} className="sm:ml-auto"><Download className="mr-2 h-4 w-4" />{exporting ? t({ it: 'Preparazione…', en: 'Preparing…' }) : t({ it: 'Esporta risultati · CSV', en: 'Export results · CSV' })}</Button>
        </div>
        <p className="text-xs text-muted-foreground">{t({ it: 'Filtri e riepiloghi considerano tutti i risultati, non solo la pagina. Il CSV contiene i dati personali visualizzati: conservalo in modo riservato.', en: 'Filters and summaries cover all matching results, not just this page. The CSV contains the displayed personal data: keep it private.' })}</p>
        {unapplied ? <p role="status" className="text-xs text-amber-400">{t({ it: 'Modifiche non applicate: tabella e CSV usano gli ultimi filtri confermati.', en: 'Unapplied changes: the table and CSV use the last confirmed filters.' })}</p> : null}
      </form>
    </CardContent></Card>
    {exportError ? <p role="alert" className="text-sm text-destructive">{exportError}</p> : null}
    <div aria-live="polite" aria-busy={loading}>
      {loading ? <p className="py-8 text-center text-muted-foreground">{t({ it: 'Caricamento utenti…', en: 'Loading users…' })}</p> : error ? <div role="alert" className="rounded-xl border border-destructive/30 p-5 text-sm">
        {t({ it: 'Report non disponibile. Controlla i filtri o riprova.', en: 'Report unavailable. Check the filters or retry.' })}<Button variant="ghost" className="ml-2" onClick={refresh}>{t({ it: 'Riprova', en: 'Retry' })}</Button>
      </div> : report ? <>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">{summaryCards.map(([label, value]) => <Card key={label}><CardContent className="p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-bold tabular-nums">{value}</p></CardContent></Card>)}</div>
        <p className="my-3 text-xs text-muted-foreground">{t({ it: `${report.total} risultati su ${report.population} utenze registrate · aggiornato ${formatDate(report.asOf)}.`, en: `${report.total} results from ${report.population} registered accounts · updated ${formatDate(report.asOf)}.` })}</p>
        <div className="overflow-x-auto rounded-xl border border-border" tabIndex={0} role="region" aria-label={t({ it: 'Elenco utenti, scorrimento orizzontale', en: 'User list, scroll horizontally' })}>
          <table className="w-full min-w-[960px] text-left text-sm">
            <caption className="sr-only">{t({ it: 'Utenti corrispondenti ai filtri applicati', en: 'Users matching the applied filters' })}</caption>
            <thead className="bg-muted/50 text-xs text-muted-foreground"><tr>{[
              t({ it: 'Utente', en: 'User' }), 'Email', t({ it: 'Registrazione', en: 'Registered' }), t({ it: 'Ultimo log', en: 'Last logged activity' }), t({ it: 'Ultimo login Auth', en: 'Last Auth sign-in' }), t({ it: 'Partite', en: 'Games' }), t({ it: 'Mazzi', en: 'Decks' }), t({ it: 'Gruppi', en: 'Groups' }),
            ].map(label => <th key={label} scope="col" className="px-4 py-3 font-semibold">{label}</th>)}</tr></thead>
            <tbody>{report.users.map(user => <tr key={user.id} className="border-t border-border hover:bg-muted/20">
              <td className="max-w-[220px] break-words px-4 py-3"><span className="font-semibold">{user.username || '—'}</span><span className="block text-xs text-muted-foreground">{user.displayName || t({ it: 'Nome non impostato', en: 'Name not set' })}</span></td>
              <td className="max-w-[240px] break-words px-4 py-3">{user.email || '—'}<span className={`block text-xs ${user.confirmed ? 'text-emerald-400' : 'text-amber-400'}`}>{user.confirmed ? t({ it: 'Confermata', en: 'Confirmed' }) : t({ it: 'Da confermare', en: 'Unconfirmed' })}</span></td>
              <td className="px-4 py-3 text-xs">{formatDate(user.createdAt)}</td>
              <td className="px-4 py-3 text-xs">{formatDate(user.lastActiveAt)}<span className="block text-muted-foreground">{user.source === 'app' ? `App ${user.appVersion || '—'}` : user.source === 'web' ? 'Web' : t({ it: 'Nessun log disponibile', en: 'No log available' })}</span></td>
              <td className="px-4 py-3 text-xs">{formatDate(user.lastSignInAt)}</td>
              <td className="px-4 py-3 tabular-nums">{user.games}</td><td className="px-4 py-3 tabular-nums">{user.decks}</td><td className="px-4 py-3 tabular-nums">{user.groups}</td>
            </tr>)}</tbody>
          </table>
          {report.users.length === 0 ? <p className="p-8 text-muted-foreground">{t({ it: 'Nessun utente corrisponde ai filtri.', en: 'No users match these filters.' })}</p> : null}
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
          <Field label={t({ it: 'Utenti per pagina', en: 'Users per page' })}><select className={selectClass} value={filters.pageSize} onChange={event => apply({ ...filters, page: 1, pageSize: Number(event.target.value) as 25 | 50 | 100 })}>{[25,50,100].map(size => <option key={size} value={size}>{size}</option>)}</select></Field>
          <div className="flex items-center gap-3"><Button variant="outline" disabled={filters.page <= 1} onClick={() => apply({ ...filters, page: filters.page - 1 })}>{t({ it: 'Precedente', en: 'Previous' })}</Button><span className="tabular-nums">{filters.page} / {pages}</span><Button variant="outline" disabled={filters.page >= pages} onClick={() => apply({ ...filters, page: filters.page + 1 })}>{t({ it: 'Successiva', en: 'Next' })}</Button></div>
        </div>
      </> : null}
    </div>
    <p className="text-xs leading-relaxed text-muted-foreground">{t({ it: 'L’attività usa soltanto i log conservati per 30 giorni. Log assenti non dimostrano inattività storica: alcune utenze, inclusi amministratori, possono essere escluse. Il login Auth è distinto dall’attività registrata. Utenze eliminate o anonime escluse; mazzi archiviati inclusi nei conteggi.', en: 'Activity uses only logs retained for 30 days. Missing logs do not prove historical inactivity: some accounts, including admins, may be excluded. Auth sign-in differs from logged activity. Deleted or anonymous accounts are excluded; deck counts include archived decks.' })}</p>
  </div>;
}
