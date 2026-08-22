'use client';

import { FormEvent, PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';

type WorldMapData = { viewBox: string; locations: Array<{ id: string; name: string; path: string }> };

type CountrySpot = {
  code: string;
  name: string;
  flag: string;
  currentBid: number;
  companyName?: string;
  companyUrl?: string;
  logoUrl?: string;
  minimumGuaranteedUntil?: number;
};

const previewSpots: CountrySpot[] = [
  { code: 'us', name: 'United States', flag: '🇺🇸', currentBid: 4200, companyName: 'NORTHSTAR' },
  { code: 'gb', name: 'United Kingdom', flag: '🇬🇧', currentBid: 3100, companyName: 'MONO' },
  { code: 'jp', name: 'Japan', flag: '🇯🇵', currentBid: 2700, companyName: 'SORA' },
  { code: 'de', name: 'Germany', flag: '🇩🇪', currentBid: 1900, companyName: 'KERN' },
  { code: 'br', name: 'Brazil', flag: '🇧🇷', currentBid: 1600, companyName: 'VERDE' },
  { code: 'fr', name: 'France', flag: '🇫🇷', currentBid: 1200, companyName: 'AVENIR' },
  { code: 'lv', name: 'Latvia', flag: '🇱🇻', currentBid: 500, companyName: 'RIGA' },
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

function timeLabel(until?: number) {
  if (!until) return 'Visible until outbid';
  const minutes = Math.max(0, Math.ceil((Number(until) - Date.now()) / 60_000));
  return minutes > 0 ? `${minutes} min guaranteed` : 'Visible until outbid';
}

export function WorldMarketplace() {
  const [mapData, setMapData] = useState<WorldMapData | null>(null);
  const [spots, setSpots] = useState<CountrySpot[]>(previewSpots);
  const [selected, setSelected] = useState<CountrySpot>(previewSpots[0]);
  const [query, setQuery] = useState('');
  const [liveData, setLiveData] = useState(false);
  const [paymentsEnabled, setPaymentsEnabled] = useState(false);
  const [bidOpen, setBidOpen] = useState(false);
  const [companyName, setCompanyName] = useState('');
  const [companyUrl, setCompanyUrl] = useState('https://');
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const [mapZoom, setMapZoomState] = useState(1);
  const [mapDragging, setMapDragging] = useState(false);
  const mapViewportRef = useRef<HTMLDivElement>(null);
  const mapDragRef = useRef({ pointerId: -1, startX: 0, startY: 0, scrollLeft: 0, scrollTop: 0, moved: false });

  const spotMap = useMemo(() => new Map(spots.map((spot) => [spot.code, spot])), [spots]);
  const matchingCodes = useMemo(() => {
    const locations = mapData?.locations ?? [];
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return new Set(locations.map((location) => location.id));
    return new Set(locations.filter((location) => location.name.toLowerCase().includes(normalizedQuery)).map((location) => location.id));
  }, [mapData, query]);

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

  useEffect(() => {
    const initial = window.setTimeout(() => void loadMarket(), 0);
    const timer = window.setInterval(() => void loadMarket(), 15_000);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); };
  }, [loadMarket]);

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

  const selectCountry = (code: string, name: string) => setSelected(spotMap.get(code) ?? availableSpot(code, name));
  const nextBid = selected.currentBid === 0 ? 100 : selected.currentBid + 100;

  const setMapZoom = (nextZoom: number) => {
    const viewport = mapViewportRef.current;
    const next = Math.min(3, Math.max(1, nextZoom));
    const centerX = viewport ? (viewport.scrollLeft + viewport.clientWidth / 2) / Math.max(viewport.scrollWidth, 1) : 0.5;
    const centerY = viewport ? (viewport.scrollTop + viewport.clientHeight / 2) / Math.max(viewport.scrollHeight, 1) : 0.5;
    setMapZoomState(next);
    window.requestAnimationFrame(() => {
      const current = mapViewportRef.current;
      if (!current) return;
      current.scrollLeft = centerX * current.scrollWidth - current.clientWidth / 2;
      current.scrollTop = centerY * current.scrollHeight - current.clientHeight / 2;
    });
  };

  const startMapDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    const viewport = mapViewportRef.current;
    if (!viewport) return;
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
    mapDragRef.current.pointerId = -1;
    setMapDragging(false);
  };

  const submitBid = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError('');
    if (!logoFile) { setFormError('Choose your company logo.'); return; }
    setSubmitting(true);
    try {
      const logoBody = new FormData();
      logoBody.append('logo', logoFile);
      const logoResponse = await fetch('/api/logo', { method: 'POST', body: logoBody });
      const logo = await logoResponse.json() as { key?: string; error?: string };
      if (!logoResponse.ok || !logo.key) throw new Error(logo.error ?? 'Could not upload the logo.');
      const checkoutResponse = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ countryCode: selected.code, companyName, companyUrl, logoKey: logo.key }),
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
        <nav className="nav-links" aria-label="Main navigation"><a href="#market">Market</a><a href="#how-it-works">How it works</a><a href="#rules">Rules</a></nav>
        <a className="account-button" href="/signin-with-chatgpt?return_to=%2F">Sign in</a>
      </header>

      {notice && <div className="notice" role="status"><span>{notice}</span><button type="button" onClick={() => setNotice('')} aria-label="Dismiss">×</button></div>}

      <section className="intro" id="top">
        <div><p className="eyebrow"><span /> Global advertising, one country at a time</p><h1>Put your brand<br />on the world.</h1></div>
        <div className="intro-copy"><p>Choose a country, claim its spotlight, and stay visible until another brand raises the bid.</p><a href="#market">Explore the live map <span aria-hidden="true">↓</span></a></div>
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
              <defs>{spots.filter((spot) => spot.logoUrl).map((spot) => <pattern key={spot.code} id={`logo-${spot.code}`} width="1" height="1" patternContentUnits="objectBoundingBox"><rect width="1" height="1" fill="#fff" /><image href={spot.logoUrl} width="1" height="1" preserveAspectRatio="xMidYMid slice" /></pattern>)}</defs>
              {mapData.locations.map((location) => {
                const spot = spotMap.get(location.id);
                const isSelected = selected.code === location.id;
                const hiddenBySearch = query.length > 0 && !matchingCodes.has(location.id);
                const index = spot ? spots.indexOf(spot) : -1;
                const fill = spot?.logoUrl ? `url(#logo-${spot.code})` : spot ? palette[index % palette.length] : undefined;
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
            <div className="selected-country"><span className="flag" aria-hidden="true">{selected.flag}</span><div><small>Selected country</small><strong>{selected.name}</strong>{selected.companyUrl && <a href={selected.companyUrl} target="_blank" rel="noopener noreferrer">{selected.companyName} ↗</a>}</div></div>
            <div className="selection-stat"><small>Current value</small><strong>{selected.currentBid ? money.format(selected.currentBid) : 'Available'}</strong></div>
            <div className="selection-stat"><small>Next bid</small><strong>{money.format(nextBid)}</strong></div>
            <button className="primary-button" type="button" onClick={() => { setFormError(''); setBidOpen(true); }}>Claim {selected.name}</button>
          </div>
        </div>

        <aside className="leaderboard" aria-labelledby="leaderboard-title">
          <div className="leaderboard-heading"><div><p className="section-kicker">Leaderboard</p><h2 id="leaderboard-title">Most valued</h2></div><span className="live-pill"><i /> {liveData ? 'Live' : 'Preview'}</span></div>
          {spots.length > 0 ? <div className="leaderboard-list">{spots.slice(0, 6).map((country, index) => (
            <button key={country.code} className="leader-row" onClick={() => setSelected(country)} type="button">
              <span className="rank">{String(index + 1).padStart(2, '0')}</span>
              <span className="company-chip" style={{ background: palette[index % palette.length] }}>{country.logoUrl ? <span className="leader-logo" style={{ backgroundImage: `url(${country.logoUrl})` }} /> : brandInitials(country.companyName)}</span>
              <span className="leader-name"><strong>{country.name}</strong><small>{country.companyName} · {timeLabel(country.minimumGuaranteedUntil)}</small></span>
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
            <label>Company logo <small>PNG, JPG, or WebP · max 750 KB</small><input required type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setLogoFile(event.target.files?.[0] ?? null)} /></label>
            {formError && <p className="form-error" role="alert">{formError}</p>}
            <button className="checkout-button" disabled={submitting} type="submit">{submitting ? 'Preparing secure checkout…' : `Continue to Stripe · ${money.format(nextBid)}`}</button>
          </form>}
          <p className="bid-terms">This is an advertising placement, not land ownership. Your card is captured only if this bid is accepted. If another completed checkout wins first, the authorization is cancelled.</p>
        </section>
      </div>}
    </main>
  );
}
