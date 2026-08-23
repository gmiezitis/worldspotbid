'use client';
/* eslint-disable @next/next/no-img-element -- user-uploaded brand logos are served dynamically by the marketplace */

import { CSSProperties, FormEvent, PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BID_INCREMENT_DOLLARS, COLOR_BORDER_ADDON_DOLLARS } from '../lib/bidding';
import { PROJECT_CATEGORIES } from '../lib/categories';
import { CHARITY_SHARE_PERCENT } from '../lib/charity';
import { DEMO_NORTHSTAR_LOGO } from '../lib/demo-logo';

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
  colorfulBorder?: boolean;
  logoUrl?: string;
  minimumGuaranteedUntil?: number;
  isDemo?: boolean;
};

type LatestActivity = { code: string; countryName: string; amount: number; companyName: string; projectCategory?: string; completedAt: number };
type CountryOwner = { companyName: string; amount: number; completedAt: number };

const previewSpots: CountrySpot[] = [
  { code: 'us', name: 'United States', flag: '🇺🇸', currentBid: 0, companyName: 'NORTHSTAR', businessDescription: 'AI tools for ambitious global teams.', colorfulBorder: true, logoUrl: DEMO_NORTHSTAR_LOGO, isDemo: true },
  { code: 'gb', name: 'United Kingdom', flag: '🇬🇧', currentBid: 0, companyName: 'MONO', businessDescription: 'Simple financial planning for founders.', isDemo: true },
  { code: 'jp', name: 'Japan', flag: '🇯🇵', currentBid: 0, companyName: 'SORA', businessDescription: 'Creative software for modern studios.', isDemo: true },
  { code: 'de', name: 'Germany', flag: '🇩🇪', currentBid: 0, companyName: 'KERN', businessDescription: 'Industrial design and engineering.', isDemo: true },
  { code: 'br', name: 'Brazil', flag: '🇧🇷', currentBid: 0, companyName: 'VERDE', businessDescription: 'Sustainable commerce for local brands.', isDemo: true },
  { code: 'fr', name: 'France', flag: '🇫🇷', currentBid: 0, companyName: 'AVENIR', businessDescription: 'Independent fashion and culture.', isDemo: true },
  { code: 'lv', name: 'Latvia', flag: '🇱🇻', currentBid: 0, companyName: 'RIGA', businessDescription: 'Digital products built in the Baltics.', isDemo: true },
];

const PREVIEW_HISTORY_NOW = Date.UTC(2026, 7, 22, 18);
const previewOwnerHistory: Record<string, CountryOwner[]> = {
  us: [
    { companyName: 'NORTHSTAR', amount: 250, completedAt: PREVIEW_HISTORY_NOW - 45 * 60_000 },
    { companyName: 'Bright Labs', amount: 200, completedAt: PREVIEW_HISTORY_NOW - 7 * 60 * 60_000 },
    { companyName: 'Atlas Works', amount: 150, completedAt: PREVIEW_HISTORY_NOW - 24 * 60 * 60_000 },
    { companyName: 'Field Notes', amount: 100, completedAt: PREVIEW_HISTORY_NOW - 3 * 24 * 60 * 60_000 },
    { companyName: 'First Light', amount: 50, completedAt: PREVIEW_HISTORY_NOW - 5 * 24 * 60 * 60_000 },
  ],
};

const palette = ['#f4bd42', '#e9704e', '#ec6680', '#8b79d9', '#62ad76', '#568bd6', '#9e3943'];
const MAX_MAP_ZOOM = 6;
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

function countryFlag(code: string) {
  if (!/^[a-z]{2}$/.test(code)) return '🌐';
  return String.fromCodePoint(...code.toUpperCase().split('').map((char) => 127397 + char.charCodeAt(0)));
}

function countryNameFromCode(code: string) {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code.toUpperCase()) ?? code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

function availableSpot(code: string, name: string): CountrySpot {
  return { code, name, flag: countryFlag(code), currentBid: 0 };
}

function brandInitials(name?: string) {
  if (!name) return '—';
  return name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
}

function countryColor(code: string) {
  const value = code.split('').reduce((total, character) => total + character.charCodeAt(0), 0);
  return palette[value % palette.length];
}

function timeLabel(until?: number) {
  if (!until) return 'Active until replaced';
  const minutes = Math.max(0, Math.ceil((Number(until) - Date.now()) / 60_000));
  return minutes > 0 ? `${minutes} min guaranteed` : 'Active until replaced';
}

function activityTime(timestamp: number) {
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function WorldMarketplace() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [mapData, setMapData] = useState<WorldMapData | null>(null);
  const [mapLoadError, setMapLoadError] = useState(false);
  const [mapLoadAttempt, setMapLoadAttempt] = useState(0);
  const [spots, setSpots] = useState<CountrySpot[]>(previewSpots);
  const [selected, setSelected] = useState<CountrySpot>(previewSpots[0]);
  const [query, setQuery] = useState('');
  const [liveData, setLiveData] = useState(false);
  const [paymentsEnabled, setPaymentsEnabled] = useState(false);
  const [bidOpen, setBidOpen] = useState(false);
  const [mapBidCardOpen, setMapBidCardOpen] = useState(false);
  const [companyName, setCompanyName] = useState('');
  const [companyUrl, setCompanyUrl] = useState('https://');
  const [businessDescription, setBusinessDescription] = useState('');
  const [projectCategory, setProjectCategory] = useState('');
  const [colorfulBorder, setColorfulBorder] = useState(false);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const [mapZoom, setMapZoomState] = useState(1);
  const [mapDragging, setMapDragging] = useState(false);
  const [hoveredCountry, setHoveredCountry] = useState<{ spot?: CountrySpot; name: string; x: number; y: number } | null>(null);
  const [latestActivity, setLatestActivity] = useState<LatestActivity[]>([]);
  const [ownerHistory, setOwnerHistory] = useState<Record<string, CountryOwner[]>>(previewOwnerHistory);
  const [historyLoadingCode, setHistoryLoadingCode] = useState<string | null>(null);
  const mapViewportRef = useRef<HTMLDivElement>(null);
  const mapWrapRef = useRef<HTMLDivElement>(null);
  const mapZoomRef = useRef(1);
  const wheelZoomFrameRef = useRef<number | null>(null);
  const wheelDeltaRef = useRef(0);
  const wheelFocusRef = useRef({ clientX: 0, clientY: 0 });
  const mapDragRef = useRef({ pointerId: -1, startX: 0, startY: 0, scrollLeft: 0, scrollTop: 0, moved: false });

  const spotMap = useMemo(() => new Map(spots.map((spot) => [spot.code, spot])), [spots]);
  const logoPreviewUrl = useMemo(() => logoFile ? URL.createObjectURL(logoFile) : null, [logoFile]);
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
    const controller = new AbortController();

    const loadMap = async () => {
      try {
        const manifestResponse = await fetch('/map/index.json', { signal: controller.signal });
        if (!manifestResponse.ok) throw new Error('Map manifest unavailable');
        const manifest = await manifestResponse.json() as { viewBox: string; chunks: string[] };
        const chunkResponses = await Promise.all(manifest.chunks.map((chunk) => fetch(`/map/${chunk}`, { signal: controller.signal })));
        if (chunkResponses.some((response) => !response.ok)) throw new Error('Map chunk unavailable');
        const chunks = await Promise.all(chunkResponses.map((response) => response.json() as Promise<WorldMapData['locations']>));
        setMapData({ viewBox: manifest.viewBox, locations: chunks.flat().filter((location) => /^[a-z]{2}$/.test(location.id)) });
      } catch {
        if (!controller.signal.aborted) setMapLoadError(true);
      }
    };

    void loadMap();
    return () => controller.abort();
  }, [mapLoadAttempt]);

  useEffect(() => () => { if (logoPreviewUrl) URL.revokeObjectURL(logoPreviewUrl); }, [logoPreviewUrl]);

  const loadMarket = useCallback(async () => {
    try {
      const response = await fetch('/api/countries', { cache: 'no-store' });
      if (!response.ok) return;
      const data = await response.json() as { countries?: Array<Omit<CountrySpot, 'flag'>>; paymentsEnabled?: boolean };
      const next = (data.countries ?? []).map((country) => ({ ...country, flag: countryFlag(country.code) }));
      const nextMap = new Map(next.map((spot) => [spot.code, spot]));
      const visibleSpots = next.length > 0 ? next : previewSpots;
      setSpots(visibleSpots);
      setLiveData(next.length > 0);
      setPaymentsEnabled(Boolean(data.paymentsEnabled));
      setSelected((current) => nextMap.get(current.code) ?? visibleSpots.find((spot) => spot.code === current.code) ?? availableSpot(current.code, current.name));
    } catch { /* retain the clearly labelled preview data */ }
  }, []);

  const loadActivity = useCallback(async () => {
    try {
      const response = await fetch('/api/activity', { cache: 'no-store' });
      if (!response.ok) return;
      const data = await response.json() as { latestActivity?: LatestActivity[] };
      setLatestActivity((data.latestActivity ?? []).map((activity) => ({
        ...activity,
        countryName: countryNameFromCode(activity.code),
      })));
    } catch { /* activity remains empty until the next refresh */ }
  }, []);

  const loadCountryHistory = useCallback(async (code: string, usePreview = false) => {
    if (usePreview && previewOwnerHistory[code]) {
      setOwnerHistory((current) => ({ ...current, [code]: previewOwnerHistory[code] }));
      return;
    }
    setHistoryLoadingCode(code);
    try {
      const response = await fetch(`/api/country-history?country=${encodeURIComponent(code)}`, { cache: 'no-store' });
      if (!response.ok) return;
      const data = await response.json() as { owners?: CountryOwner[] };
      setOwnerHistory((current) => ({ ...current, [code]: data.owners ?? [] }));
    } catch { /* history remains unavailable until the country is selected again */ }
    finally { setHistoryLoadingCode((current) => current === code ? null : current); }
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
          if (order.status === 'payment_failed') { setNotice('The payment could not be completed. No placement was activated.'); return; }
        }
      } catch { /* retry briefly while the webhook arrives */ }
      if (attempts < 10) window.setTimeout(check, 1_500);
      else setNotice('Payment received. We are still confirming your spot.');
    };
    void check();
  }, [loadMarket]);

  const selectCountry = (code: string, name: string, showBidCard = false) => {
    const nextSpot = spotMap.get(code) ?? availableSpot(code, name);
    setSelected(nextSpot);
    if (showBidCard) setMapBidCardOpen(true);
    void loadCountryHistory(code, Boolean(nextSpot.isDemo));
  };
  const showCountryPreview = (event: ReactPointerEvent<SVGPathElement>, spot: CountrySpot | undefined, name: string) => {
    if (event.pointerType === 'touch' || mapDragging) return;
    const bounds = mapWrapRef.current?.getBoundingClientRect();
    if (!bounds) return;
    setHoveredCountry({
      spot,
      name,
      x: Math.min(Math.max(14, bounds.width - 324), Math.max(14, event.clientX - bounds.left + 18)),
      y: Math.min(Math.max(14, bounds.height - 174), Math.max(14, event.clientY - bounds.top + 18)),
    });
  };
  const toggleTheme = () => {
    setTheme((current) => {
      const next = current === 'light' ? 'dark' : 'light';
      document.documentElement.dataset.theme = next;
      try { window.localStorage.setItem('worldspot-theme', next); } catch { /* theme remains active for this visit */ }
      return next;
    });
  };
  const nextBid = selected.currentBid + BID_INCREMENT_DOLLARS;
  const checkoutTotal = nextBid + (colorfulBorder ? COLOR_BORDER_ADDON_DOLLARS : 0);
  const selectedHistory = ownerHistory[selected.code] ?? [];

  const setMapZoom = useCallback((nextZoom: number, focus?: { clientX: number; clientY: number }) => {
    const viewport = mapViewportRef.current;
    const currentZoom = mapZoomRef.current;
    const next = Math.min(MAX_MAP_ZOOM, Math.max(1, nextZoom));
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
    mapDragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, scrollLeft: viewport.scrollLeft, scrollTop: viewport.scrollTop, moved: false };
  };

  const moveMap = (event: ReactPointerEvent<HTMLDivElement>) => {
    const viewport = mapViewportRef.current;
    const drag = mapDragRef.current;
    if (!viewport || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (!drag.moved && Math.abs(deltaX) + Math.abs(deltaY) > 5) {
      drag.moved = true;
      viewport.setPointerCapture(event.pointerId);
      setMapDragging(true);
    }
    if (!drag.moved) return;
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
      let logoUrl: string | null = null;
      if (logoFile) {
        const logoResponse = await fetch('/api/logos', {
          method: 'POST',
          headers: { 'Content-Type': logoFile.type },
          body: logoFile,
        });
        const logo = await logoResponse.json() as { logo_url?: string; error?: string };
        if (!logoResponse.ok || !logo.logo_url) throw new Error(logo.error ?? 'Could not upload the logo.');
        logoUrl = logo.logo_url;
      }
      const checkoutResponse = await fetch('/api/bid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          country_code: selected.code,
          logo_url: logoUrl,
          link_url: companyUrl,
          company_name: companyName,
          business_description: businessDescription,
          project_category: projectCategory,
          colorful_border: colorfulBorder,
        }),
      });
      const checkout = await checkoutResponse.json() as { checkout_url?: string; error?: string };
      if (!checkoutResponse.ok || !checkout.checkout_url) throw new Error(checkout.error ?? 'Could not start checkout.');
      window.location.assign(checkout.checkout_url);
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
        <nav className="nav-links" aria-label="Main navigation"><a href="#market">Market</a><a href="#leaderboard">Leaderboard</a><a href="#charity">Charity</a><a href="#how-it-works">How it works</a><a href="#rules">Rules</a></nav>
        <div className="account-actions"><button className="theme-button" type="button" onClick={toggleTheme} aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`} aria-pressed={theme === 'dark'}><span aria-hidden="true">{theme === 'light' ? '☾' : '☀'}</span><span>{theme === 'light' ? 'Dark' : 'Light'}</span></button><a className="account-button" href="/signin-with-chatgpt?return_to=%2F">Sign in</a></div>
      </header>

      {notice && <div className="notice" role="status"><span>{notice}</span><button type="button" onClick={() => setNotice('')} aria-label="Dismiss">×</button></div>}

      <section className="intro" id="top">
        <div className="intro-heading"><p className="eyebrow"><span /> One country. One spotlight. Your brand.</p><h1><span>Put your brand</span><em>on the world.</em></h1></div>
        <div className="intro-copy"><p>Choose the country that matters to your business. Purchase its featured advertising placement from $50 and remain visible until a later qualifying purchase replaces it.</p><div className="hero-actions"><a className="hero-primary" href="#market">Choose a country <span aria-hidden="true">→</span></a><a className="hero-secondary" href="#how-it-works">How it works</a></div><small>Secure Stripe sandbox checkout · fixed $50 placement steps</small></div>
      </section>

      <section className="activity-ticker" aria-label="Latest activated placements">
        <div className="ticker-label"><i aria-hidden="true" /><span>Live activity</span></div>
        <div className="ticker-window"><div className="ticker-track">{[0, 1].map((group) => <div className="ticker-group" key={group} aria-hidden={group === 1}>{latestActivity.length ? latestActivity.map((activity, index) => <button type="button" tabIndex={group === 1 ? -1 : 0} key={`${group}-${activity.code}-${activity.completedAt}-${index}`} onClick={() => { selectCountry(activity.code, activity.countryName, true); document.getElementById('market')?.scrollIntoView({ behavior: 'smooth' }); }}><span>{countryFlag(activity.code)}</span><strong>{activity.companyName}</strong><span>activated a {money.format(activity.amount)} placement in {activity.countryName}</span><small>{activityTime(activity.completedAt)}</small></button>) : <span className="ticker-empty"><b>Live market</b> The next securely activated country placement will appear here automatically.</span>}</div>)}</div></div>
      </section>

      <section className="market" id="market" aria-label="Live country marketplace">
        <div className="map-panel">
          <div className="panel-heading">
            <div><p className="section-kicker">{liveData ? 'Live market' : 'Market preview'}</p><h2>Select a country</h2></div>
            <label className="search-field"><span className="sr-only">Search countries</span><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search country" /></label>
          </div>

          <div className="map-wrap" ref={mapWrapRef}>
            <div className={`map-viewport ${mapDragging ? 'map-dragging' : ''}`} ref={mapViewportRef} onPointerDown={startMapDrag} onPointerMove={moveMap} onPointerUp={stopMapDrag} onPointerCancel={stopMapDrag}>
              <div className="map-stage" style={{ width: `${mapZoom * 100}%`, height: `${mapZoom * 100}%` }}>
            {mapData ? <svg viewBox={mapData.viewBox} role="img" aria-labelledby="world-map-title">
              <title id="world-map-title">Interactive map of advertising spots by country</title>
              <defs><linearGradient id="colorful-border" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ff5d7d" /><stop offset=".28" stopColor="#ffbf47" /><stop offset=".52" stopColor="#d8ff68" /><stop offset=".76" stopColor="#58b8ff" /><stop offset="1" stopColor="#a878ff" /></linearGradient></defs>
              {mapData.locations.map((location) => {
                const spot = spotMap.get(location.id);
                const isSelected = selected.code === location.id;
                const hiddenBySearch = query.length > 0 && !matchingCodes.has(location.id);
                const countryStyle = spot ? { '--spot-color': countryColor(spot.code), ...(spot.colorfulBorder ? { stroke: 'url(#colorful-border)' } : {}) } as CSSProperties : undefined;
                return <path key={location.id} id={`country-${location.id}`} d={location.path} className={`country ${spot ? 'country-owned' : ''} ${spot?.colorfulBorder ? 'country-colorful-border' : ''} ${isSelected ? 'country-selected' : ''} ${hiddenBySearch ? 'country-muted' : ''}`} style={countryStyle} role="button" tabIndex={0} aria-label={`${location.name}, ${spot?.isDemo ? 'available from $50 with a demo brand preview' : spot ? `${money.format(spot.currentBid)} current value` : 'available from $50'}`} onPointerEnter={(event) => showCountryPreview(event, spot, location.name)} onPointerMove={(event) => showCountryPreview(event, spot, location.name)} onPointerLeave={() => setHoveredCountry(null)} onFocus={(event) => { const wrapBounds = mapWrapRef.current?.getBoundingClientRect(); const countryBounds = event.currentTarget.getBoundingClientRect(); if (wrapBounds) setHoveredCountry({ spot, name: location.name, x: Math.min(Math.max(14, wrapBounds.width - 324), Math.max(14, countryBounds.right - wrapBounds.left + 12)), y: Math.min(Math.max(14, wrapBounds.height - 174), Math.max(14, countryBounds.top - wrapBounds.top)) }); }} onBlur={() => setHoveredCountry(null)} onClick={() => { if (!mapDragRef.current.moved) { setHoveredCountry(null); selectCountry(location.id, location.name, true); } }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setHoveredCountry(null); selectCountry(location.id, location.name, true); } }} />;
              })}
            </svg> : mapLoadError ? <div className="map-loading map-load-error" role="alert"><span>The world map could not load.</span><button type="button" onClick={() => { setMapLoadError(false); setMapLoadAttempt((attempt) => attempt + 1); }}>Try again</button></div> : <div className="map-loading" role="status">Loading the world map…</div>}
              </div>
            </div>
            {hoveredCountry && <div className="map-hover-card" style={{ left: hoveredCountry.x, top: hoveredCountry.y }} aria-hidden="true">
              {hoveredCountry.spot?.logoUrl ? <img src={hoveredCountry.spot.logoUrl} alt="" /> : <span className="hover-brand-mark" style={{ background: hoveredCountry.spot ? countryColor(hoveredCountry.spot.code) : undefined }}>{hoveredCountry.spot ? brandInitials(hoveredCountry.spot.companyName) : hoveredCountry.name.slice(0, 2).toUpperCase()}</span>}
              <div><small>{hoveredCountry.spot ? 'Brand live' : 'Available country'}</small><strong>{hoveredCountry.spot?.companyName ?? hoveredCountry.name}</strong><p>{hoveredCountry.spot?.businessDescription ?? `Claim ${hoveredCountry.name} from $50.`}</p>{hoveredCountry.spot && <b>{hoveredCountry.name} · {hoveredCountry.spot.currentBid ? money.format(hoveredCountry.spot.currentBid) : 'Demo'}</b>}</div>
            </div>}
            <div className="map-controls" aria-label="Map zoom controls" onPointerDown={(event) => event.stopPropagation()}>
              <button type="button" onClick={() => setMapZoom(mapZoom - 0.5)} disabled={mapZoom <= 1} aria-label="Zoom out">−</button>
              <span aria-live="polite">{Math.round(mapZoom * 100)}%</span>
              <button type="button" onClick={() => setMapZoom(mapZoom + 0.5)} disabled={mapZoom >= MAX_MAP_ZOOM} aria-label="Zoom in">+</button>
              {mapZoom > 1 && <button className="map-reset" type="button" onClick={() => setMapZoom(1)}>Reset</button>}
            </div>
            {mapBidCardOpen && <aside className="map-bid-card" aria-label={`Placement details for ${selected.name}`} onPointerDown={(event) => event.stopPropagation()}>
              <button className="map-card-close" type="button" onClick={() => setMapBidCardOpen(false)} aria-label="Close selected country">×</button>
              <div className="map-card-country"><span className="flag" aria-hidden="true">{selected.flag}</span><div><small>Selected country</small><strong>{selected.name}</strong>{selected.companyName && <span className="map-card-brand">{selected.companyName}{selected.isDemo ? ' · Demo preview' : ''}</span>}</div></div>
              {selected.companyName ? <div className="map-card-company map-card-company-profile">{selected.logoUrl ? <img src={selected.logoUrl} alt={`${selected.companyName} logo`} /> : <span className="map-card-logo-fallback" style={{ background: countryColor(selected.code) }}>{brandInitials(selected.companyName)}</span>}<div><small>Current company</small><strong>{selected.companyName}</strong><p>{selected.businessDescription ?? 'No company description was provided.'}</p>{selected.companyUrl && <a href={selected.companyUrl} target="_blank" rel="noopener noreferrer">Visit company ↗</a>}</div></div> : <div className="map-card-company map-card-available"><small>Current company</small><strong>This country is available</strong><p>Be the first brand to claim this spot.</p></div>}
              <div className="map-card-values"><span><small>Current placement</small><strong>{selected.currentBid ? money.format(selected.currentBid) : 'Available'}</strong></span><span><small>Activation price</small><strong>{money.format(nextBid)}</strong></span></div>
              <div className="map-card-history"><div className="map-card-history-title"><strong>Last 5 owners</strong>{selected.isDemo && <small>Example history</small>}</div>{historyLoadingCode === selected.code ? <p className="history-empty">Loading owner history…</p> : selectedHistory.length ? <ol>{selectedHistory.slice(0, 5).map((owner, index) => <li key={`${owner.companyName}-${owner.completedAt}-${index}`}><span><b>{owner.companyName}</b><small>{activityTime(owner.completedAt)}</small></span><strong>{money.format(owner.amount)}</strong></li>)}</ol> : <p className="history-empty">No previous owners yet.</p>}</div>
              <button className="primary-button" type="button" onClick={() => { setFormError(''); setBidOpen(true); }}>Activate placement · {money.format(nextBid)}</button>
            </aside>}
            <div className="map-legend" aria-hidden="true"><span><i className="legend-available" /> Available</span><span><i className="legend-owned" /> Brand live</span></div>
            <p className="map-credit">Map © SVG Maps, CC BY 4.0</p>
          </div>

          <div className="selection-bar" aria-live="polite">
            <div className="selected-country"><span className="flag" aria-hidden="true">{selected.flag}</span><div><small>Selected country</small><strong>{selected.name}</strong>{selected.companyUrl && <a href={selected.companyUrl} target="_blank" rel="noopener noreferrer">{selected.companyName} ↗</a>}{selected.businessDescription && <p className="selected-description">{selected.businessDescription}</p>}</div></div>
            <div className="selection-stat"><small>Current placement</small><strong>{selected.currentBid ? money.format(selected.currentBid) : 'Available'}</strong></div>
            <div className="selection-stat"><small>Activation price</small><strong>{money.format(nextBid)}</strong></div>
            <button className="primary-button" type="button" onClick={() => { setFormError(''); setBidOpen(true); }}>Place your brand</button>
          </div>
        </div>

        <aside className="leaderboard" id="leaderboard" aria-labelledby="leaderboard-title">
          <div className="leaderboard-heading"><div><p className="section-kicker">Leaderboard</p><h2 id="leaderboard-title">Most valued</h2></div><span className="live-pill"><i /> {liveData ? 'Live' : 'Preview'}</span></div>
          {spots.length > 0 ? <div className="leaderboard-list">{spots.slice(0, 6).map((country, index) => (
            <button key={country.code} className="leader-row" onClick={() => setSelected(country)} type="button">
              <span className="rank">{String(index + 1).padStart(2, '0')}</span>
              <span className="company-chip" style={{ background: palette[index % palette.length] }}>{country.logoUrl ? <span className="leader-logo" style={{ backgroundImage: `url(${country.logoUrl})` }} /> : brandInitials(country.companyName)}</span>
              <span className="leader-name"><strong>{country.name}</strong><small>{country.companyName}{country.projectCategory ? ` · ${country.projectCategory}` : ''} · {timeLabel(country.minimumGuaranteedUntil)}</small></span>
              <span className="leader-price">{country.isDemo ? 'Demo' : money.format(country.currentBid)}</span>
            </button>
          ))}</div> : <div className="empty-leaderboard"><span>01</span><h3>Be first on the map</h3><p>Every country opens at $50.</p></div>}
          <div className="leaderboard-note"><span>{spots.length}</span><p><strong>{spots.length === 1 ? 'brand is' : 'brands are'} live</strong><br />across the map right now.</p></div>
        </aside>
      </section>

      <section className="how-it-works" id="how-it-works">
        <p className="section-kicker">A simpler global billboard</p><h2>One transparent rule.<br />The latest qualifying placement stays active.</h2>
        <div className="steps"><article><span>01</span><h3>Choose your market</h3><p>Select any country on the map. Available placements begin at $50.</p></article><article><span>02</span><h3>Purchase securely</h3><p>The placement price advances in fixed $50 steps and checkout is authorized through Stripe.</p></article><article><span>03</span><h3>Activate your brand</h3><p>Your advertising placement is guaranteed for one hour and continues until a later qualifying purchase replaces it.</p></article></div>
      </section>

      <section className="charity-card" id="charity" aria-labelledby="charity-title">
        <div className="charity-percentage-ring" role="img" aria-label={`${CHARITY_SHARE_PERCENT}% of placement income donated by Worldspot`}><span><strong>{CHARITY_SHARE_PERCENT}%</strong><small>of placement<br />income donated</small></span></div><div className="charity-message"><p className="section-kicker">Giving is built in</p><h2 id="charity-title">Every activated placement gives something back.</h2><p>Worldspot allocates 10% of its country-placement income to vetted charities and publishes monthly proof of payment. The percentage is fixed automatically, so purchasers do not need to select or add a separate donation.</p><small>The donation is made by Worldspot and is not a tax-deductible donation by the purchaser.</small></div><span className="charity-mark" aria-hidden="true">♥</span>
      </section>

      <footer id="rules"><div className="brand"><span className="brand-mark">W</span><span>WORLDSPOT</span></div><p>Advertising placement marketplace. Country spots do not represent ownership of land or territory.</p><p>© 2026 Worldspot</p></footer>

      {bidOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !submitting) setBidOpen(false); }}>
        <section className="bid-modal" role="dialog" aria-modal="true" aria-labelledby="bid-title">
          <button className="modal-close" type="button" onClick={() => setBidOpen(false)} disabled={submitting} aria-label="Close">×</button>
          <div className="modal-country"><span className="flag" aria-hidden="true">{selected.flag}</span><div><p className="section-kicker">Temporary advertising placement</p><h2 id="bid-title">Activate {selected.name}</h2></div></div>
          <div className="bid-summary"><span><small>Placement price</small><strong>{money.format(nextBid)}</strong></span><span><small>Color border</small><strong>{colorfulBorder ? `+${money.format(COLOR_BORDER_ADDON_DOLLARS)}` : 'Not added'}</strong></span><span><small>Total</small><strong>{money.format(checkoutTotal)}</strong></span></div>
          {!paymentsEnabled && liveData ? <div className="setup-message"><strong>Secure checkout is not live yet.</strong><p>The marketplace is ready for Stripe test keys before accepting any payment.</p></div> : <form onSubmit={submitBid}>
            <label>Company name<input required minLength={2} maxLength={60} value={companyName} onChange={(event) => setCompanyName(event.target.value)} placeholder="Acme Studio" /></label>
            <label>Company website<input required type="url" value={companyUrl} onChange={(event) => setCompanyUrl(event.target.value)} placeholder="https://example.com" /></label>
            <label>About the business<textarea required minLength={10} maxLength={180} value={businessDescription} onChange={(event) => setBusinessDescription(event.target.value)} placeholder="Describe what your business does in one short sentence." /></label>
            <label>Project category<select required value={projectCategory} onChange={(event) => setProjectCategory(event.target.value)}><option value="" disabled>Choose a category</option>{PROJECT_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
            <label className={`border-addon ${colorfulBorder ? 'border-addon-selected' : ''}`}><input type="checkbox" checked={colorfulBorder} onChange={(event) => setColorfulBorder(event.target.checked)} /><span className="border-addon-swatch" aria-hidden="true" /><span><strong>Add a colorful country border</strong><small>Makes your active country easier to notice on the map.</small></span><b>+{money.format(COLOR_BORDER_ADDON_DOLLARS)}</b></label>
            <p className="checkout-charity"><strong>{CHARITY_SHARE_PERCENT}% gives back.</strong> Worldspot donates 10% of its country-placement income to vetted charities.</p>
            <label>Company logo <small>Optional · appears in the country hover card and leaderboard · PNG, JPG, or WebP · max 750 KB</small>{logoPreviewUrl && <span className="logo-upload-preview"><img src={logoPreviewUrl} alt="Selected company logo preview" /><span><strong>Logo ready</strong><small>This is how your uploaded brand asset will appear.</small></span></span>}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0] ?? null; if (file && (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 750 * 1024)) { setLogoFile(null); setFormError('Choose a PNG, JPG, or WebP logo under 750 KB.'); event.target.value = ''; return; } setFormError(''); setLogoFile(file); }} /></label>
            {formError && <p className="form-error" role="alert">{formError}</p>}
            <button className="checkout-button" disabled={submitting} type="submit">{submitting ? 'Preparing secure checkout…' : `Continue to Stripe · ${money.format(checkoutTotal)}`}</button>
          </form>}
          <p className="bid-terms">This checkout purchases temporary digital advertising placement only. It does not grant land ownership, territorial rights, or exclusivity outside the displayed map placement. Payment is captured only when the placement activates. If another eligible checkout completes first, your authorization is cancelled. The charity allocation is made by Worldspot and is not a tax-deductible donation by the purchaser.</p>
        </section>
      </div>}
    </main>
  );
}
