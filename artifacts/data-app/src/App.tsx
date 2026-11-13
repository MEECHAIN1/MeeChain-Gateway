import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { useGetMeechainNetwork, getGetMeechainNetworkQueryKey } from '@workspace/api-client-react';
import { CSVLink } from 'react-csv';
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  Activity, ArrowDownToLine, ArrowRight, Blocks, Check, ChevronDown, CircleAlert,
  Clock3, Database, ExternalLink, Fingerprint, Landmark, Moon, Network,
  Printer, Radio, RefreshCw, ShieldCheck, Sun, WalletCards,
} from 'lucide-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import type { MeeChainBlockMetric, MeeChainNetwork } from '@workspace/api-client-react';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5 * 60 * 1000, refetchOnWindowFocus: false } },
});

const INTERVAL_OPTIONS = [
  { label: 'Every 5 min', ms: 5 * 60 * 1000 },
  { label: 'Every 15 min', ms: 15 * 60 * 1000 },
  { label: 'Every 1 hour', ms: 60 * 60 * 1000 },
  { label: 'Every 24 hours', ms: 24 * 60 * 60 * 1000 },
];

const governance = [
  {
    number: '01', name: 'External Communication Gateway', icon: Radio,
    description: 'A controlled boundary for publishing approved information outward.',
    readiness: 'Not configured',
  },
  {
    number: '02', name: 'T2PRAWANTA Holder Verification', icon: Fingerprint,
    description: 'Token ownership checks require the token contract address.',
    readiness: 'Blocked · contract address needed',
  },
  {
    number: '03', name: 'MeeChain Membership & Eligibility', icon: ShieldCheck,
    description: 'MeeChain rules define who qualifies and who approves membership.',
    readiness: 'Blocked · MeeChain rules needed',
  },
  {
    number: '04', name: 'MCB Exchange Program', icon: WalletCards,
    description: 'Exchange policy, eligibility, and execution remain MeeChain decisions.',
    readiness: 'Not configured',
  },
  {
    number: '05', name: 'Economic Evidence & Treasury Control', icon: Landmark,
    description: 'Evidence standards and treasury authority belong to MeeChain governance.',
    readiness: 'Not configured',
  },
];

function formatDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function shortTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(date);
}

function formatCount(value: number) {
  return new Intl.NumberFormat('en-US').format(value);
}

function shortenUrl(url: string) {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname === '/' ? '' : parsed.pathname}`;
  } catch {
    return url;
  }
}

function StatusBadge({ status }: { status: MeeChainNetwork['status'] }) {
  const label = status === 'connected' ? 'Connected' : status === 'wrong_network' ? 'Wrong network' : 'Unavailable';
  return <span className={`status-pill status-${status}`}><span className="status-dot" />{label}</span>;
}

function BlockTable({ blocks }: { blocks: MeeChainBlockMetric[] }) {
  if (!blocks.length) {
    return <div className="empty-table"><Blocks size={22} /><p>No recent block records were returned.</p><span>Refresh the inbound network check to try again.</span></div>;
  }
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Block</th><th>Timestamp</th><th>Transactions</th><th>Gas used</th><th>Interval</th></tr></thead>
        <tbody>
          {blocks.map((block, index) => (
            <tr key={`${block.blockNumber}-${index}`} data-testid={`row-block-${index}`}>
              <td className="mono block-number"><span className="block-mark">{String(index + 1).padStart(2, '0')}</span>#{block.blockNumber}</td>
              <td>{formatDate(block.timestamp)}</td>
              <td className="mono">{formatCount(block.transactionCount)}</td>
              <td className="mono">{block.gasUsed}</td>
              <td className="mono">{block.intervalSeconds === null ? '—' : `${block.intervalSeconds}s`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SkeletonBlock() {
  return <div className="skeleton-block" aria-label="Loading network data"><div className="skeleton-line w-32" /><div className="skeleton-line w-full" /><div className="skeleton-line w-3/4" /><div className="skeleton-line w-1/2" /></div>;
}

function Dashboard() {
  const networkQuery = useGetMeechainNetwork();
  const queryClientInstance = useQueryClient();
  const [isDark, setIsDark] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [intervalMs, setIntervalMs] = useState(5 * 60 * 1000);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [isSpinning, setIsSpinning] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const busy = networkQuery.isLoading || networkQuery.isFetching;
  const data = networkQuery.data;
  const blocks = data?.recentBlocks ?? [];
  const chartData = useMemo(
    () => [...blocks].reverse().map((block) => ({
      block: `#${block.blockNumber}`,
      transactions: block.transactionCount,
      time: shortTime(block.timestamp),
    })),
    [blocks],
  );
  const networkLabel = data?.status === 'connected' ? 'Inbound source online' : data ? 'Inbound source needs attention' : 'Awaiting source check';

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    try { localStorage.setItem('meechain-theme', isDark ? 'dark' : 'light'); } catch { /* storage may be disabled */ }
  }, [isDark]);

  useEffect(() => {
    try { setIsDark(localStorage.getItem('meechain-theme') === 'dark'); } catch { /* storage may be disabled */ }
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => {
      void queryClientInstance.invalidateQueries({ queryKey: getGetMeechainNetworkQueryKey() });
    }, Math.max(intervalMs, 5 * 60 * 1000));
    return () => window.clearInterval(timer);
  }, [autoRefresh, intervalMs, queryClientInstance]);

  useEffect(() => {
    function dismiss(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) setDropdownOpen(false);
    }
    document.addEventListener('mousedown', dismiss);
    return () => document.removeEventListener('mousedown', dismiss);
  }, []);

  useEffect(() => {
    let timer: number | undefined;
    if (busy) setIsSpinning(true);
    else timer = window.setTimeout(() => setIsSpinning(false), 600);
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [busy]);

  const refresh = async () => {
    setIsSpinning(true);
    await networkQuery.refetch();
  };

  const lastChecked = data?.checkedAt ? formatDate(data.checkedAt) : null;
  const transactionRows = blocks.map((block) => ({
    blockNumber: block.blockNumber,
    timestamp: block.timestamp,
    transactionCount: block.transactionCount,
    gasUsed: block.gasUsed,
    intervalSeconds: block.intervalSeconds ?? '',
  }));
  const gridColor = isDark ? 'rgba(239,233,219,.11)' : '#e6e0d4';
  const tickColor = isDark ? '#a6b0b1' : '#85867f';

  return (
    <div className="app-shell">
      <aside className="sidebar print:hidden">
        <div className="brand-lockup">
          <div className="brand-mark"><span>M</span><i /></div>
          <div><div className="brand-name">MeeChain</div><div className="brand-caption">OPERATIONS CONSOLE</div></div>
        </div>
        <div className="sidebar-section-label">WORKSPACE</div>
        <nav className="side-nav">
          <a href="#overview" className="nav-item active"><Activity size={17} /><span>Network overview</span><span className="nav-current" /></a>
          <a href="#blocks" className="nav-item"><Blocks size={17} /><span>Block activity</span></a>
          <a href="#boundary" className="nav-item"><Network size={17} /><span>Responsibility boundary</span></a>
          <a href="#governance" className="nav-item"><ShieldCheck size={17} /><span>Governance readiness</span></a>
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note-icon"><Database size={15} /></div>
          <p>Read-only observability</p>
          <span>This console has no chain-write or treasury-control actions.</span>
          <div className="sidebar-footer"><span className="footer-led" />OPERATIONS MODE <span className="version">v1.0</span></div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="crumbs"><span>Workspace</span><span className="crumb-slash">/</span><strong>Operations</strong></div>
          <div className="topbar-right">
            <span className="read-only-label"><span className="lock-glyph">R</span> READ ONLY</span>
            <span className="top-divider" />
            <span className="system-date"><Clock3 size={14} /> {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date())}</span>
          </div>
        </header>
        <div className="page-content">
          <section className="page-heading" id="overview">
            <div>
              <div className="eyebrow"><span className="eyebrow-line" /> SYSTEMS / INBOUND NETWORK</div>
              <h1>Operations <span>overview</span></h1>
              <p className="intro">Observe verified MintMe chain data. MeeChain independently governs membership, eligibility, exchange, and treasury decisions.</p>
              <div className="source-line">
                <span className="source-token"><span className="mintme-glyph">M</span> MintMe inbound</span>
                <span className="source-separator">·</span>
                <span>{networkLabel}</span>
                {lastChecked && <><span className="source-separator">·</span><span>Checked {lastChecked}</span></>}
              </div>
            </div>
            <div className="header-actions print:hidden">
              <div className="split-refresh" ref={dropdownRef}>
                <button className="refresh-main" onClick={refresh} disabled={busy} data-testid="button-refresh">
                  <RefreshCw size={15} className={isSpinning ? 'spin' : ''} /> Refresh
                </button>
                <button className="refresh-caret" onClick={() => setDropdownOpen((open) => !open)} aria-label="Refresh settings" aria-expanded={dropdownOpen} data-testid="button-refresh-options"><ChevronDown size={14} /></button>
                {dropdownOpen && <div className="refresh-menu">
                  <div className="menu-kicker">AUTOMATIC REFRESH</div>
                  <button className="toggle-row" onClick={() => setAutoRefresh((enabled) => !enabled)}>
                    <span><strong>Auto-refresh</strong><small>{autoRefresh ? 'Enabled' : 'Off by default'}</small></span>
                    <span className={`switch ${autoRefresh ? 'switch-on' : ''}`}><i /></span>
                  </button>
                  <div className="menu-kicker interval-heading">INTERVAL</div>
                  {INTERVAL_OPTIONS.map((option) => <button key={option.ms} className="interval-row" onClick={() => { setIntervalMs(option.ms); setDropdownOpen(false); }}>
                    <span>{option.label}</span>{intervalMs === option.ms && <Check size={14} />}
                  </button>)}
                  <div className="menu-footnote">Manual refresh is always available.</div>
                </div>}
              </div>
              <button className="icon-action" onClick={() => window.print()} aria-label="Export as PDF" title="Export as PDF" data-testid="button-export-pdf"><Printer size={16} /></button>
              <button className="icon-action" onClick={() => setIsDark((dark) => !dark)} aria-label="Toggle dark mode" title="Toggle dark mode" data-testid="button-theme">{isDark ? <Sun size={16} /> : <Moon size={16} />}</button>
            </div>
          </section>

          {networkQuery.isError && !data && <div className="error-banner" role="alert">
            <CircleAlert size={19} /><div><strong>Network check could not be completed.</strong><span>{networkQuery.error instanceof Error ? networkQuery.error.message : 'The inbound status endpoint is unavailable.'}</span></div>
            <button onClick={refresh} data-testid="button-retry">Retry check <ArrowRight size={14} /></button>
          </div>}

          <section className="network-panel" aria-label="MintMe inbound network status">
            <div className="network-panel-main">
              <div className="network-overline"><span className="network-icon"><Network size={17} /></span> INBOUND NETWORK HEALTH</div>
              <div className="network-title-row"><h2>MintMe</h2>{data ? <StatusBadge status={data.status} /> : <span className="status-pill status-pending"><span className="status-dot" />{networkQuery.isError ? 'Check failed' : 'Checking source'}</span>}</div>
              <p className="network-description">{data?.message || 'Read-only connection for public chain facts. No signing, membership, or treasury authority is exposed.'}</p>
              <div className="network-endpoint"><span>RPC ENDPOINT</span><code>{data?.rpcUrl ? shortenUrl(data.rpcUrl) : networkQuery.isError ? 'Endpoint check failed' : 'Loading endpoint'}</code>
                {data?.rpcUrl && <a href={data.rpcUrl} target="_blank" rel="noreferrer" aria-label="Open RPC endpoint"><ExternalLink size={13} /></a>}
              </div>
            </div>
            <div className="network-panel-stats">
              <div className="stat-cell chain-stat"><div className="stat-label">EXPECTED CHAIN ID</div><div className="stat-value mono">{data?.expectedChainId ?? '24734'}</div><div className="stat-caption">MintMe network reference</div></div>
              <div className="stat-cell"><div className="stat-label">OBSERVED CHAIN ID</div><div className={`stat-value mono ${data?.observedChainId && data.observedChainId !== data.expectedChainId ? 'text-warn' : ''}`}>{data?.observedChainId ?? '—'}</div><div className="stat-caption">{data?.observedChainId === null || !data ? 'No verified observation' : data.observedChainId === data.expectedChainId ? 'Matches expected network' : 'Does not match expected'}</div></div>
              <div className="stat-cell block-stat"><div className="stat-label">LATEST VERIFIED BLOCK</div>{busy && !data ? <div className="stat-skeleton" /> : <div className="stat-value mono">{data?.latestBlock ? `#${data.latestBlock.blockNumber}` : '—'}</div>}<div className="stat-caption">{data?.latestBlock ? `${formatCount(data.latestBlock.transactionCount)} transactions` : 'No block observation'}</div></div>
            </div>
            <div className="network-rail"><span className="rail-led" /> PUBLIC CHAIN FACTS ONLY</div>
          </section>

          <section className="block-section" id="blocks">
            <div className="section-heading">
              <div><div className="eyebrow"><span className="eyebrow-line" /> VERIFIED CHAIN FACTS</div><h2>Recent block activity</h2><p>Data returned directly by the MintMe read-only network check.</p></div>
              <span className="record-count"><span className="record-dot" />{busy && !data ? 'Loading records' : `${blocks.length} ${blocks.length === 1 ? 'record' : 'records'}`}</span>
            </div>
            <div className="activity-grid">
              <article className="surface chart-surface">
                <div className="surface-heading"><div><span className="micro-label">BLOCK SEQUENCE</span><h3>Transactions per block</h3></div>
                  {!busy && chartData.length > 0 && <CSVLink data={transactionRows} filename="meechain-recent-blocks.csv" className="export-link" aria-label="Export recent block chart data as CSV" data-testid="link-export-chart-csv"><ArrowDownToLine size={14} /> CSV</CSVLink>}
                </div>
                {busy && !data ? <div className="chart-skeleton"><div className="skeleton-line w-32" /><div className="skeleton-chart" /></div>
                  : networkQuery.isError && !data ? <div className="chart-empty"><CircleAlert size={22} /><p>Block activity unavailable</p><span>Retry the network check to load verified blocks.</span></div>
                    : chartData.length ? <div className="chart-wrap">
                      <div className="chart-total"><strong>{data?.latestBlock ? formatCount(data.latestBlock.transactionCount) : '—'}</strong><span>on latest block</span></div>
                      <ResponsiveContainer width="100%" height={220}>
                        <AreaChart data={chartData} margin={{ top: 12, right: 6, left: -14, bottom: 0 }}>
                          <defs><linearGradient id="transactionsFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#c28b3c" stopOpacity={0.28} /><stop offset="100%" stopColor="#c28b3c" stopOpacity={0.015} /></linearGradient></defs>
                          <CartesianGrid vertical={false} strokeDasharray="3 5" stroke={gridColor} />
                          <XAxis dataKey="block" tick={{ fill: tickColor, fontSize: 10, fontFamily: 'DM Mono' }} tickLine={false} axisLine={false} minTickGap={24} />
                          <YAxis tick={{ fill: tickColor, fontSize: 10, fontFamily: 'DM Mono' }} tickLine={false} axisLine={false} allowDecimals={false} width={44} />
                          <Tooltip contentStyle={{ background: isDark ? '#1d2b31' : '#fbf8f1', border: `1px solid ${gridColor}`, borderRadius: 4, color: isDark ? '#efe9db' : '#25333a', fontSize: 12 }} labelStyle={{ fontFamily: 'DM Mono', marginBottom: 4 }} formatter={(value: number) => [formatCount(value), 'Transactions']} />
                          <Area type="monotone" dataKey="transactions" stroke="#b67b30" strokeWidth={2} fill="url(#transactionsFill)" dot={{ r: 2, strokeWidth: 0, fill: '#b67b30' }} activeDot={{ r: 4, fill: '#b67b30', stroke: '#fbf8f1', strokeWidth: 2 }} isAnimationActive={false} />
                        </AreaChart>
                      </ResponsiveContainer>
                      <div className="chart-legend"><span className="legend-mark" />Transactions <span className="legend-note">per verified block</span></div>
                    </div>
                    : <div className="chart-empty"><Blocks size={22} /><p>No block observations</p><span>The endpoint returned no recent block records.</span></div>}
              </article>
              <article className="surface latest-surface">
                <div className="surface-heading"><div><span className="micro-label">LATEST OBSERVATION</span><h3>Block detail</h3></div><span className="verified-tag"><Check size={12} /> API DATA</span></div>
                {busy && !data ? <SkeletonBlock /> : data?.latestBlock ? <div className="detail-stack">
                  <div className="detail-block-number"><span>BLOCK HEIGHT</span><strong>#{data.latestBlock.blockNumber}</strong><small>{formatDate(data.latestBlock.timestamp)}</small></div>
                  <div className="detail-row"><span>Transactions</span><strong className="mono">{formatCount(data.latestBlock.transactionCount)}</strong></div>
                  <div className="detail-row"><span>Gas used</span><strong className="mono">{data.latestBlock.gasUsed}</strong></div>
                  <div className="detail-row"><span>Block interval</span><strong className="mono">{data.latestBlock.intervalSeconds === null ? '—' : `${data.latestBlock.intervalSeconds}s`}</strong></div>
                </div> : <div className="no-latest"><Blocks size={20} /><span>No latest block returned.</span></div>}
              </article>
            </div>
            <article className="surface table-surface">
              <div className="surface-heading table-heading"><div><span className="micro-label">NETWORK RESPONSE</span><h3>Recent blocks</h3></div><span className="table-note">Timestamps shown in local time</span></div>
              {busy && !data ? <div className="table-loading"><div className="skeleton-line w-full" /><div className="skeleton-line w-full" /><div className="skeleton-line w-full" /></div>
                : networkQuery.isError && !data ? <div className="empty-table"><CircleAlert size={22} /><p>Could not load recent blocks.</p><span>Retry the network check to request current data.</span></div>
                  : <BlockTable blocks={blocks} />}
            </article>
          </section>

          <section className="boundary-section" id="boundary">
            <div className="section-heading">
              <div><div className="eyebrow"><span className="eyebrow-line" /> AUTHORITY MODEL</div><h2>One inbound source. Independent governance.</h2><p>MintMe supplies public chain facts; it does not grant or control MeeChain rights.</p></div>
              <span className="boundary-index">02 / RESPONSIBILITY</span>
            </div>
            <div className="boundary-board">
              <div className="boundary-side mintme-side">
                <div className="boundary-overline"><span className="mintme-glyph">M</span> EXTERNAL DATA SOURCE</div>
                <h3>MintMe</h3>
                <p className="boundary-summary">Inbound evidence only</p>
                <ul><li><Check size={14} /> Public RPC network status</li><li><Check size={14} /> Observed chain identifier</li><li><Check size={14} /> Block timestamps, transactions & gas</li></ul>
                <span className="boundary-tag">READ-ONLY INPUT</span>
              </div>
              <div className="boundary-bridge"><div className="bridge-line" /><span><ArrowRight size={16} /></span><small>FACTS FLOW IN</small><div className="bridge-line" /></div>
              <div className="boundary-side meechain-side">
                <div className="boundary-overline"><span className="meechain-glyph">M</span> INDEPENDENT DECISION OWNER</div>
                <h3>MeeChain</h3>
                <p className="boundary-summary">Governance and authority stay here</p>
                <ul><li><Check size={14} /> Membership rules & approvals</li><li><Check size={14} /> Eligibility and exchange policy</li><li><Check size={14} /> Economic evidence & treasury authority</li></ul>
                <span className="boundary-tag">RULES NOT CONFIGURED</span>
              </div>
              <div className="boundary-footnote"><span className="footnote-mark">i</span><span>MintMe token ownership does not automatically create MeeChain membership, eligibility, exchange rights, or treasury access.</span></div>
            </div>
          </section>

          <section className="governance-section" id="governance">
            <div className="section-heading">
              <div><div className="eyebrow"><span className="eyebrow-line" /> READINESS REGISTER</div><h2>Governance areas</h2><p>Explanatory capability map — not live member records, approvals, balances, or treasury metrics.</p></div>
              <span className="readiness-summary"><span className="summary-swatch" /> Configuration required</span>
            </div>
            <div className="governance-list">
              {governance.map((area) => {
                const Icon = area.icon;
                return <article className="governance-row" key={area.number} data-testid={`readiness-${area.number}`}>
                  <span className="governance-number">{area.number}</span>
                  <span className="governance-icon"><Icon size={18} /></span>
                  <div className="governance-copy"><h3>{area.name}</h3><p>{area.description}</p></div>
                  <span className={`readiness-chip ${area.number === '02' || area.number === '03' ? 'blocked' : ''}`}><i />{area.readiness}</span>
                  <ArrowRight className="governance-arrow" size={16} />
                </article>;
              })}
            </div>
            <div className="readiness-callout"><div className="callout-symbol"><CircleAlert size={18} /></div><div><strong>Holder verification and membership approvals are not active.</strong><p>They cannot be evaluated until the T2PRAWANTA token contract address and MeeChain membership and eligibility rules are supplied. MintMe connectivity alone does not activate either process.</p></div></div>
          </section>

          <footer className="page-footer"><div className="footer-brand"><span className="footer-brand-dot" /> MEECHAIN OPERATIONS</div><p>Verified chain facts are read-only observations. Governance readiness is explanatory, not a live control plane.</p><span>PUBLIC DATA · NO WRITE ACCESS</span></footer>
        </div>
      </main>
    </div>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function Router() {
  return <RoutedErrorBoundary><Switch><Route path="/" component={Dashboard} /><Route component={NotFound} /></Switch></RoutedErrorBoundary>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;
