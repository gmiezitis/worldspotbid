'use client';

import { FormEvent, PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PROJECT_CATEGORIES } from '../lib/categories';

type WorldMapData = { viewBox: string; locations: Array<{ id: string; name: string; path: string }> };

type CountrySpot = {
  code: string;
  name: string;
  flag: string;
  currentBid: number;
  companyName?: string;
  companyUrl?: string;
  businessDescription?: string;
  projectCategory?: string;
  logoUrl?: string;
  minimumGuaranteedUntil?: number;
};

type TrendingCountry = { code: string; name: string; clicks24h: number; totalClicks: number };
type LatestActivity = { code: string; countryName: string; amount: number; companyName: string; projectCategory?: string; completedAt: number };

const previewSpots: CountrySpot[] = [
  { code: 'us', name: 'United States', flag: '🇺🇸', currentBid: 4200, companyName: 'NORTHSTAR', businessDescription: 'AI tools for ambitious global teams.' },
  { code: 'gb', name: 'United Kingdom', flag: '🇬🇧', currentBid: 3100, companyName: 'MONO', businessDescription: 'Simple financial planning for founders.' },
  { code: 'jp', name: 'Japan', flag: '🇯🇵', currentBid: 2700, companyName: 'SORA', businessDescription: 'Creative software for modern studios.' },
  { code: 'de', name: 'Germany', flag: '🇩🇪', currentBid: 1900, companyName: 'KERN', businessDescription: 'Industrial design and engineering.' },
  { code: 'br', name: 'Brazil', flag: '🇧🇷', currentBid: 1600, companyName: 'VERDE', businessDescription: 'Sustainable commerce for local brands.' },
  { code: 'fr', name: 'France', flag: '🇫🇷', currentBid: 1200, companyName: 'AVENIR', businessDescription: 'Independent fashion and culture.' },
  { code: 'lv', name: 'Latvia', flag: '🇱🇻', currentBid: 500, companyName: 'RIGA', businessDescription: 'Digital products built in the Baltics.' },
];

const palette = ['#f4bd42', '#e9704e', '#ec6680', '#8b79d9', '#62ad76', '#568bd6', '#9e3943'];
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

function countryFlag(code: string) {
  if (!/^[a-z]{2}$/.test(code)) return '🌐';
  return String.fromCodePoint(...code.toUpperCase().split('').map((char) => 127397 + char.charCodeAt(0)));
}

function availableSpot(code: string, name: string): CountrySpot {
  return { code, name, flag: countryFlag(code), currentBid: 0 };
}

function brandInitials(name?: string) {
  if (!name) return '—';
  return name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
}

function descriptionLines(description?: string) {
  const words = (description ?? '').trim().split(/\s+/).filter(Boolean);
  const lines = ['', ''];
  let line = 0;
  for (const word of words) {
    const candidate = `${lines[line]} ${word}`.trim();
    if (candidate.length <= 28) lines[line] = candidate;
    else if (line === 0) { line = 1; lines[1] = word.slice(0, 28); }
    else break;
  }
  return lines;
}

function timeLabel(until?: number) {
  if (!until) return 'Visible until outbid';
  const minutes = Math.max(0, Math.ceil((Number(until) - Date.now()) / 60_000));
  return minutes > 0 ? `${minutes} min guaranteed` : 'Visible until outbid';
}

function activityTime(timestamp: number) {
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function visitorId() {
  const key = 'worldspot-visitor-id';
  try {
    const current = window.localStorage.getItem(key);
    if (current && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(current)) return current;
    const created = crypto.randomUUID();
    window.localStorage.setItem(key, created);
    return created;
  } catch {
    return crypto.randomUUID();
  }
}

export function WorldMarketplace() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [mapData, setMapData] = useState<WorldMapData | null>(null);
  const [spots, setSpots] = useState<CountrySpot[]>(previewSpots);
  const [selected, setSelected] = useState<CountrySpot>(previewSpots[0]);
  const [query, setQuery] = useState('');
  const [liveData, setLiveData] = useState(false);
  const [paymentsEnabled, setPaymentsEnabled] = useState(false);
  const [bidOpen, setBidOpen] = useState(false);
  const [companyName, setCompanyName] = useState('');
  const [companyUrl, setCompanyUrl] = useState('https://');
  const [businessDescription, setBusinessDescription] = useState('');
  const [projectCategory, setProjectCategory] = useState('');
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const [mapZoom, setMapZoomState] = useState(1);
  const [mapDragging, setMapDragging] = useState(false);
  const [trending, setTrending] = useState<TrendingCountry[]>([]);
  const [latestActivity, setLatestActivity] = useState<LatestActivity[]>([]);
  const [clickCounts, setClickCounts] = useState<Record<string, number>>({});
  const mapViewportRef = useRef<HTMLDivElement>(null);
  const mapZoomRef = useRef(1);
  const wheelZoomFrameRef = useRef<number | null>(null);
  const wheelDeltaRef = useRef(0);
  const wheelFocusRef = useRef({ clientX: 0, clientY: 0 });
  const mapDragRef = useRef({ pointerId: -1, startX: 0, startY: 0, scrollLeft: 0, scrollTop: 0, moved: false });

  const spotMap = useMemo(() => new Map(spots.map((spot) => [spot.code, spot])), [spots]);
  const matchingCodes = useMemo(() => {
    const locations = mapData?.locations ?? [];
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return new Set(locations.map((location) => location.id));
    return new Set(locations.filter((location) => location.name.toLowerCase().includes(normalizedQuery)).map((location) => location.id));
  }, [mapData, query]);

  useEffect(() => {
    let stored: string | null = null;
    try { stored = window.localStorage.getItem('worldspot-theme'); } catch { /* use the system preference */ }
    const initial = stored === 'dark' || stored === 'light' ? stored : window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    document.documentElement.dataset.theme = initial;
    const timer = window.setTimeout(() => setTheme(initial), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    void import('@svg-maps/world').then(({ default: map }) => {
      setMapData({ ...map, locations: map.locations.filter((location: WorldMapData['locations'][number]) => /^[a-z]{2}$/.test(location.id)) });
    });
  }, []);

  const loadMarket = useCallback(async () => {
    try {
      const response = await fetch('/api/countries', { cache: 'no-store' });
      if (!response.ok) return;
      const data = await response.json() as { countries?: Array<Omit<CountrySpot, 'flag'>>; paymentsEnabled?: boolean };
      const next = (data.countries ?? []).map((country) => ({ ...country, flag: countryFlag(country.code) }));
      const nextMap = new Map(next.map((spot) => [spot.code, spot]));
      setSpots(next);
      setLiveData(true);
      setPaymentsEnabled(Boolean(data.paymentsEnabled));
      setSelected((current) => nextMap.get(current.code) ?? availableSpot(current.code, current.name));
    } catch { /* retain the clearly labelled preview data */ }
  }, []);

  const loadActivity = useCallback(async () => {
    try {
      const response = await fetch('/api/activity', { cache: 'no-store' });
      if (!response.ok) return;
      const data = await response.json() as { trending?: TrendingCountry[]; latestActivity?: LatestActivity[]; clickCounts?: Record<string, number> };
      setTrending(data.trending ?? []);
      setLatestActivity(data.latestActivity ?? []);
      setClickCounts(data.clickCounts ?? {});
    } catch { /* activity remains empty until the next refresh */ }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void loadMarket(), 0);
    const timer = window.setInterval(() => void loadMarket(), 15_000);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); };
  }, [loadMarket]);

  useEffect(() => {
    const initial = window.setTimeout(() => void loadActivity(), 0);
    const timer = window.setInterval(() => void loadActivity(), 15_000);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); };
  }, [loadActivity]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('payment') === 'cancelled') window.setTimeout(() => setNotice('Checkout was cancelled. No charge was made.'), 0);
    const sessionId = params.get('session_id');
    if (params.get('payment') !== 'processing' || !sessionId) return;
    let attempts = 0;
    const check = async () => {
      attempts += 1;
      try {
        const response = await fetch(`/api/order-status?session_id=${encodeURIComponent(sessionId)}`, { cache: 'no-store' });
        if (response.ok) {
          const order = await response.json() as { status: string; countryName: string };
          if (order.status === 'accepted') { setNotice(`Your ${order.countryName} spot is live.`); void loadMarket(); return; }
          if (order.status === 'stale') { setNotice('Another brand claimed this spot first. Your card authorization was cancelled.'); return; }
          if (order.status === 'payment_failed') { setNotice('The payment could not be completed. No bid was placed.'); return; }
        }
      } catch { /* retry briefly while the webhook arrives */ }
      if (attempts < 10) window.setTimeout(check, 1_500);
      else setNotice('Payment received. We are still confirming your spot.');
    };
    void check();
  }, [loadMarket]);

  const selectCountry = (code: string, name: string) => {
    setSelected(spotMap.get(code) ?? availableSpot(code, name));
    setClickCounts((current) => ({ ...current, [code]: (current[code] ?? 0) + 1 }));
    void fetch('/api/activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ countryCode: code, visitorId: visitorId() }),
      keepalive: true,
    }).then((response) => { if (response.ok) void loadActivity(); }).catch(() => undefined);
  };
  const toggleTheme = () => {
    setTheme((current) => {
      const next = current === 'light' ? 'dark' : 'light';
      document.documentElement.dataset.theme = next;
      try { window.localStorage.setItem('worldspot-theme', next); } catch { /* theme remains active for this visit */ }
      return next;
    });
  };
  const nextBid = selected.currentBid === 0 ? 100 : selected.currentBid + 100;

  const setMapZoom = useCallback((nextZoom: number, focus?: { clientX: number; clientY: number }) => {
    const viewport = mapViewportRef.current;
    const currentZoom = mapZoomRef.current;
    const next = Math.min(3, Math.max(1, nextZoom));
    if (!viewport || next === currentZoom) return;

    const bounds = viewport.getBoundingClientRect();
    const offsetX = focus ? focus.clientX - bounds.left : viewport.clientWidth / 2;
    const offsetY = focus ? focus.clientY - bounds.top : viewport.clientHeight / 2;
    const contentX = viewport.scrollLeft + offsetX;
    const contentY = viewport.scrollTop + offsetY;
    const scale = next / currentZoom;

    mapZoomRef.current = next;
    setMapZoomState(next);
    window.requestAnimationFrame(() => {
      const current = mapViewportRef.current;
      if (!current) return;
      current.scrollLeft = contentX * scale - offsetX;
      current.scrollTop = contentY * scale - offsetY;
    });
  }, []);

  useEffect(() => {
    const viewport = mapViewportRef.current;
    if (!viewport) return;
    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY === 0) return;
      event.preventDefault();
      const deltaScale = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? viewport.clientHeight : 1;
      wheelDeltaRef.current += event.deltaY * deltaScale;
      wheelFocusRef.current = { clientX: event.clientX, clientY: event.clientY };
      if (wheelZoomFrameRef.current !== null) return;
      wheelZoomFrameRef.current = window.requestAnimationFrame(() => {
        wheelZoomFrameRef.current = null;
        const delta = wheelDeltaRef.current;
        wheelDeltaRef.current = 0;
        const zoomChange = Math.max(-0.18, Math.min(0.18, -delta * 0.0015));
        setMapZoom(mapZoomRef.current + zoomChange, wheelFocusRef.current);
      });
    };
    viewport.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      viewport.removeEventListener('wheel', handleWheel);
      if (wheelZoomFrameRef.current !== null) window.cancelAnimationFrame(wheelZoomFrameRef.current);
    };
  }, [setMapZoom]);

  const startMapDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const viewport = mapViewportRef.current;
    if (!viewport) return;
    event.preventDefault();
    mapDragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, scrollLeft: viewport.scrollLeft, scrollTop: viewport.scrollTop, moved: false };
    viewport.setPointerCapture(event.pointerId);
    setMapDragging(true);
  };

  const moveMap = (event: ReactPointerEvent<HTMLDivElement>) => {
    const viewport = mapViewportRef.current;
    const drag = mapDragRef.current;
    if (!viewport || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (Math.abs(deltaX) + Math.abs(deltaY) > 5) drag.moved = true;
    viewport.scrollLeft = drag.scrollLeft - deltaX;
    viewport.scrollTop = drag.scrollTop - deltaY;
  };

  const stopMapDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (mapDragRef.current.pointerId !== event.pointerId) return;
    const viewport = mapViewportRef.current;
    if (viewport?.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
    mapDragRef.current.pointerId = -1;
    setMapDragging(false);
  };

  const submitBid = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError('');
    setSubmitting(true);
    try {
      let logoKey = '';
      if (logoFile) {
        const logoBody = new FormData();
        logoBody.append('logo', logoFile);
        const logoResponse = await fetch('/api/logo', { method: 'POST', body: logoBody });
        const logo = await logoResponse.json() as { key?: string; error?: string };
        if (!logoResponse.ok || !logo.key) throw new Error(logo.error ?? 'Could not upload the logo.');
        logoKey = logo.key;
      }
      const checkoutResponse = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ countryCode: selected.code, companyName, companyUrl, businessDescription, projectCategory, logoKey }),
      });
      const checkout = await checkoutResponse.json() as { url?: string; error?: string };
      if (!checkoutResponse.ok || !checkout.url) throw new Error(checkout.error ?? 'Could not start checkout.');
      window.location.assign(checkout.url);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not start checkout.';
      if (message.toLowerCase().includes('sign in')) setFormError('Please sign in first, then open this country again.');
      else setFormError(message);
      setSubmitting(false);
    }
  };

  return (
    <main className="site-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Worldspot home"><span className="brand-mark">W</span><span>WORLDSPOT</span></a>
        <nav className="nav-links" aria-label="Main navigation"><a href="#market">Market</a><a href="#leaderboard">Leaderboard</a><a href="#how-it-works">How it works</a><a href="#rules">Rules</a></nav>
        <div className="account-actions"><button className="theme-button" type="button" onClick={toggleTheme} aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`} aria-pressed={theme === 'dark'}><span aria-hidden="true">{theme === 'light' ? '☾' : '☀'}</span><span>{theme === 'light' ? 'Dark' : 'Light'}</span></button><a className="account-button" href="/signin-with-chatgpt?return_to=%2F">Sign in</a></div>
      </header>

      {notice && <div className="notice" role="status"><span>{notice}</span><button type="button" onClick={() => setNotice('')} aria-label="Dismiss">×</button></div>}

      <section className="intro" id="top">
        <div><p className="eyebrow"><span /> Global advertising, one country at a time</p><h1>Put your brand<br />on the world.</h1></div>
        <div className="intro-copy"><p>Choose a country, claim its spotlight, and stay visible until another brand raises the bid.</p><a href="#market">Explore the live map <span aria-hidden="true">↓</span></a></div>
      </section>

      <section className="market-pulse" aria-labelledby="market-pulse-title">
        <div className="pulse-heading"><div><p className="section-kicker">Live attention</p><h2 id="market-pulse-title">Marketplace pulse</h2></div><p>Country clicks update continuously. Bid activity appears after a payment is securely accepted.</p></div>
        <div className="pulse-grid">
          <article className="pulse-card">
            <div className="pulse-card-heading"><div><span className="pulse-dot" /> Trending now</div><small>Last 24 hours</small></div>
            {trending.length ? <div className="trending-list">{trending.map((country, index) => <button type="button" key={country.code} onClick={() => selectCountry(country.code, country.name)}><span className="trend-rank">{String(index + 1).padStart(2, '0')}</span><span className="trend-flag">{countryFlag(country.code)}</span><span className="trend-country"><strong>{country.name}</strong><small>{country.totalClicks.toLocaleString()} total clicks</small></span><span className="trend-clicks">{country.clicks24h.toLocaleString()}<small>clicks</small></span></button>)}</div> : <div className="pulse-empty"><strong>No clicks yet</strong><span>Select a country to start the trend.</span></div>}
          </article>
          <article className="pulse-card">
            <div className="pulse-card-heading"><div><span className="activity-mark">↗</span> Latest activity</div><small>Accepted bids</small></div>
            {latestActivity.length ? <div className="activity-list">{latestActivity.map((activity, index) => <button type="button" key={`${activity.code}-${activity.completedAt}-${index}`} onClick={() => selectCountry(activity.code, activity.countryName)}><span className="trend-flag">{countryFlag(activity.code)}</span><span className="trend-country"><strong>{activity.companyName} claimed {activity.countryName}</strong><small>{activity.projectCategory ?? 'Brand placement'} · {activityTime(activity.completedAt)}</small></span><span className="activity-price">{money.format(activity.amount)}</span></button>)}</div> : <div className="pulse-empty"><strong>No accepted bids yet</strong><span>The newest successful claim will appear here.</span></div>}
          </article>
        </div>
      </section>

      <section className="market" id="market" aria-label="Live country marketplace">
        <div className="map-panel">
          <div className="panel-heading">
            <div><p className="section-kicker">{liveData ? 'Live market' : 'Market preview'}</p><h2>Select a country</h2></div>
            <label className="search-field"><span className="sr-only">Search countries</span><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search country" /></label>
          </div>

          <div className="map-wrap">
            <div className={`map-viewport ${mapDragging ? 'map-dragging' : ''}`} ref={mapViewportRef} onPointerDown={startMapDrag} onPointerMove={moveMap} onPointerUp={stopMapDrag} onPointerCancel={stopMapDrag}>
              <div className="map-stage" style={{ width: `${mapZoom * 100}%`, height: `${mapZoom * 100}%` }}>
            {mapData ? <svg viewBox={mapData.viewBox} role="img" aria-labelledby="world-map-title">
              <title id="world-map-title">Interactive map of advertising spots by country</title>
              <defs>{spots.map((spot, index) => {
                if (spot.logoUrl) return <pattern key={spot.code} id={`logo-${spot.code}`} width="1" height="1" patternContentUnits="objectBoundingBox"><rect width="1" height="1" fill="#fff" /><image href={spot.logoUrl} width="1" height="1" preserveAspectRatio="xMidYMid slice" /></pattern>;
                const lines = descriptionLines(spot.businessDescription);
                return <pattern key={spot.code} id={`brand-${spot.code}`} width="1" height="1" patternContentUnits="objectBoundingBox"><rect width="1" height="1" fill={palette[index % palette.length]} /><text x=".5" y=".4" textAnchor="middle" fill="#17231f" fontSize=".1" fontWeight="900">{spot.companyName?.slice(0, 18)}</text><text x=".5" y=".54" textAnchor="middle" fill="#263a33" fontSize=".055" fontWeight="700">{lines[0]}</text><text x=".5" y=".63" textAnchor="middle" fill="#263a33" fontSize=".055" fontWeight="700">{lines[1]}</text></pattern>;
              })}</defs>
              {mapData.locations.map((location) => {
                const spot = spotMap.get(location.id);
                const isSelected = selected.code === location.id;
                const hiddenBySearch = query.length > 0 && !matchingCodes.has(location.id);
                const fill = spot?.logoUrl ? `url(#logo-${spot.code})` : spot ? `url(#brand-${spot.code})` : undefined;
                return <path key={location.id} id={`country-${location.id}`} d={location.path} className={`country ${spot ? 'country-owned' : ''} ${isSelected ? 'country-selected' : ''} ${hiddenBySearch ? 'country-muted' : ''}`} style={fill ? { fill } : undefined} role="button" tabIndex={0} aria-label={`${location.name}, ${spot ? `${money.format(spot.currentBid)} current value` : 'available from $100'}`} onClick={() => { if (!mapDragRef.current.moved) selectCountry(location.id, location.name); }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectCountry(location.id, location.name); } }} />;
              })}
            </svg> : <div className="map-loading" role="status">Loading the world map…</div>}
              </div>
            </div>
            <div className="map-controls" aria-label="Map zoom controls" onPointerDown={(event) => event.stopPropagation()}>
              <button type="button" onClick={() => setMapZoom(mapZoom - 0.5)} disabled={mapZoom <= 1} aria-label="Zoom out">−</button>
              <span aria-live="polite">{Math.round(mapZoom * 100)}%</span>
              <button type="button" onClick={() => setMapZoom(mapZoom + 0.5)} disabled={mapZoom >= 3} aria-label="Zoom in">+</button>
              {mapZoom > 1 && <button className="map-reset" type="button" onClick={() => setMapZoom(1)}>Reset</button>}
            </div>
            <div className="map-legend" aria-hidden="true"><span><i className="legend-available" /> Available</span><span><i className="legend-owned" /> Brand live</span></div>
            <p className="map-credit">Map © SVG Maps, CC BY 4.0</p>
          </div>

          <div className="selection-bar" aria-live="polite">
            <div className="selected-country"><span className="flag" aria-hidden="true">{selected.flag}</span><div><small>Selected country</small><strong>{selected.name}</strong>{selected.companyUrl && <a href={selected.companyUrl} target="_blank" rel="noopener noreferrer">{selected.companyName} ↗</a>}{selected.businessDescription && <p className="selected-description">{selected.businessDescription}</p>}</div></div>
            <div className="selection-stat"><small>Current value</small><strong>{selected.currentBid ? money.format(selected.currentBid) : 'Available'}</strong></div>
            <div className="selection-stat"><small>Next bid</small><strong>{money.format(nextBid)}</strong></div>
            <div className="selection-stat"><small>Country clicks</small><strong>{(clickCounts[selected.code] ?? 0).toLocaleString()}</strong></div>
            <button className="primary-button" type="button" onClick={() => { setFormError(''); setBidOpen(true); }}>Claim {selected.name}</button>
          </div>
        </div>

        <aside className="leaderboard" id="leaderboard" aria-labelledby="leaderboard-title">
          <div className="leaderboard-heading"><div><p className="section-kicker">Leaderboard</p><h2 id="leaderboard-title">Most valued</h2></div><span className="live-pill"><i /> {liveData ? 'Live' : 'Preview'}</span></div>
          {spots.length > 0 ? <div className="leaderboard-list">{spots.slice(0, 6).map((country, index) => (
            <button key={country.code} className="leader-row" onClick={() => setSelected(country)} type="button">
              <span className="rank">{String(index + 1).padStart(2, '0')}</span>
              <span className="company-chip" style={{ background: palette[index % palette.length] }}>{country.logoUrl ? <span className="leader-logo" style={{ backgroundImage: `url(${country.logoUrl})` }} /> : brandInitials(country.companyName)}</span>
              <span className="leader-name"><strong>{country.name}</strong><small>{country.companyName}{country.projectCategory ? ` · ${country.projectCategory}` : ''} · {timeLabel(country.minimumGuaranteedUntil)}</small></span>
              <span className="leader-price">{money.format(country.currentBid)}</span>
            </button>
          ))}</div> : <div className="empty-leaderboard"><span>01</span><h3>Be first on the map</h3><p>Every country opens at $100.</p></div>}
          <div className="leaderboard-note"><span>{spots.length}</span><p><strong>{spots.length === 1 ? 'brand is' : 'brands are'} live</strong><br />across the map right now.</p></div>
        </aside>
      </section>

      <section className="how-it-works" id="how-it-works">
        <p className="section-kicker">A simpler global billboard</p><h2>One clear rule.<br />The highest bid stays.</h2>
        <div className="steps"><article><span>01</span><h3>Pick your market</h3><p>Select any country on the map. Empty spots begin at $100.</p></article><article><span>02</span><h3>Bid securely</h3><p>Every new bid is exactly $100 higher and is authorized through Stripe.</p></article><article><span>03</span><h3>Own the spotlight</h3><p>Your brand appears for at least one hour, then stays until it is outbid.</p></article></div>
      </section>

      <footer id="rules"><div className="brand"><span className="brand-mark">W</span><span>WORLDSPOT</span></div><p>Advertising placement marketplace. Country spots do not represent ownership of land or territory.</p><p>© 2026 Worldspot</p></footer>

      {bidOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !submitting) setBidOpen(false); }}>
        <section className="bid-modal" role="dialog" aria-modal="true" aria-labelledby="bid-title">
          <button className="modal-close" type="button" onClick={() => setBidOpen(false)} disabled={submitting} aria-label="Close">×</button>
          <div className="modal-country"><span className="flag" aria-hidden="true">{selected.flag}</span><div><p className="section-kicker">Exclusive country spot</p><h2 id="bid-title">Claim {selected.name}</h2></div></div>
          <div className="bid-summary"><span><small>Your bid</small><strong>{money.format(nextBid)}</strong></span><span><small>Guaranteed</small><strong>At least 1 hour</strong></span></div>
          {!paymentsEnabled && liveData ? <div className="setup-message"><strong>Secure checkout is not live yet.</strong><p>The marketplace is ready for Stripe test keys before accepting any payment.</p></div> : <form onSubmit={submitBid}>
            <label>Company name<input required minLength={2} maxLength={60} value={companyName} onChange={(event) => setCompanyName(event.target.value)} placeholder="Acme Studio" /></label>
            <label>Company website<input required type="url" value={companyUrl} onChange={(event) => setCompanyUrl(event.target.value)} placeholder="https://example.com" /></label>
            <label>About the business<textarea required minLength={10} maxLength={180} value={businessDescription} onChange={(event) => setBusinessDescription(event.target.value)} placeholder="Describe what your business does in one short sentence." /></label>
            <label>Project category<select required value={projectCategory} onChange={(event) => setProjectCategory(event.target.value)}><option value="" disabled>Choose a category</option>{PROJECT_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
            <label>Company logo <small>Optional · PNG, JPG, or WebP · max 750 KB</small><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setLogoFile(event.target.files?.[0] ?? null)} /></label>
            {formError && <p className="form-error" role="alert">{formError}</p>}
            <button className="checkout-button" disabled={submitting} type="submit">{submitting ? 'Preparing secure checkout…' : `Continue to Stripe · ${money.format(nextBid)}`}</button>
          </form>}
          <p className="bid-terms">This is an advertising placement, not land ownership. Your card is captured only if this bid is accepted. If another completed checkout wins first, the authorization is cancelled.</p>
        </section>
      </div>}
    </main>
  );
}
