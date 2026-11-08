import { useEffect, useMemo, useRef, useState } from 'react';
import { Icons, PageHero, Reveal, SectionHead, hl } from '../components/ui';
import { useContent } from '../content/ContentContext';
import {
  IRAN_MAP_VIEWBOX,
  IRAN_PROVINCE_SHAPES,
  projectIranCoordinate,
} from '../data/iranMap';
import {
  IRAN_PROVINCES,
  normalizePersianLocation,
  normalizeSalesRepresentatives,
  representativePhoneHref,
} from '../../shared/salesRepresentatives.js';

const searchable = (value) => normalizePersianLocation(value).toLocaleLowerCase('fa');
const clusterKey = (item) => `${item.province}\u0000${item.city}\u0000${item.latitude}\u0000${item.longitude}`;
const MAP_CENTER = Object.freeze({ x: IRAN_MAP_VIEWBOX.width / 2, y: IRAN_MAP_VIEWBOX.height / 2 });
const CITY_FOCUS_SCALE = 1.34;

function RepresentativeCard({ representative, t }) {
  const phoneHref = representativePhoneHref(representative.phone);
  return (
    <article className="sales-reps__card" id={representative.id}>
      <div className="sales-reps__card-head">
        <span className="sales-reps__card-pin" aria-hidden="true"><Icons.pin size={18} /></span>
        <div>
          <p>{representative.city}، استان {representative.province}</p>
          <h3>{representative.name}</h3>
        </div>
      </div>
      {representative.brands && (
        <p className="sales-reps__brands">
          <span>{t('salesReps.brands')}</span>
          <strong>{representative.brands}</strong>
        </p>
      )}
      {phoneHref ? (
        <a className="sales-reps__phone" href={phoneHref}>
          <Icons.phone size={17} />
          <span>{t('salesReps.phone')}</span>
          <bdi dir="ltr">{representative.phone}</bdi>
        </a>
      ) : (
        <p className="sales-reps__phone sales-reps__phone--empty">
          <Icons.phone size={17} />
          شماره تماس در حال تکمیل است
        </p>
      )}
    </article>
  );
}

function IranRepresentativesMap({ representatives, selectedProvince, selectedCluster, onProvince, onCluster, t }) {
  const [hoveredProvince, setHoveredProvince] = useState('');
  const [hoveredCluster, setHoveredCluster] = useState('');
  const [focusedCluster, setFocusedCluster] = useState('');
  const lastFocusPoint = useRef(MAP_CENTER);
  const clusters = useMemo(() => {
    const grouped = new Map();
    for (const representative of representatives) {
      const key = clusterKey(representative);
      const current = grouped.get(key);
      if (current) current.items.push(representative);
      else {
        const point = projectIranCoordinate(representative.longitude, representative.latitude);
        if (point) grouped.set(key, { key, point, items: [representative] });
      }
    }
    return [...grouped.values()];
  }, [representatives]);
  const provinceCounts = useMemo(() => {
    const counts = new Map();
    for (const representative of representatives) {
      counts.set(representative.province, (counts.get(representative.province) || 0) + 1);
    }
    return counts;
  }, [representatives]);
  const clusterKeys = useMemo(() => new Set(clusters.map((cluster) => cluster.key)), [clusters]);
  useEffect(() => {
    if (hoveredCluster && !clusterKeys.has(hoveredCluster)) setHoveredCluster('');
    if (focusedCluster && !clusterKeys.has(focusedCluster)) setFocusedCluster('');
  }, [clusterKeys, focusedCluster, hoveredCluster]);

  const hovered = IRAN_PROVINCE_SHAPES.find((shape) => shape.fa === hoveredProvince);
  const activeClusterKey = hoveredCluster || focusedCluster;
  const activeCluster = clusters.find((cluster) => cluster.key === activeClusterKey);
  /* Zoom around the pin itself rather than panning it toward the centre. The
     target therefore stays under the pointer, while retaining the last pivot
     makes the return to the full map feel continuous. */
  if (activeCluster) lastFocusPoint.current = activeCluster.point;
  const focusPoint = lastFocusPoint.current;
  const focusScale = activeCluster ? CITY_FOCUS_SCALE : 1;
  const cameraTransform = [
    `translate(${focusPoint.x.toFixed(2)}px, ${focusPoint.y.toFixed(2)}px)`,
    `scale(${focusScale})`,
    `translate(${(-focusPoint.x).toFixed(2)}px, ${(-focusPoint.y).toFixed(2)}px)`,
  ].join(' ');

  const activateProvince = (province) => {
    onProvince(selectedProvince === province ? '' : province);
  };

  return (
    <div className="sales-map">
      <div className="sales-map__summary" aria-live="polite">
        <span><Icons.pin size={16} /> {representatives.length.toLocaleString('fa-IR')} {t('salesReps.results')}</span>
        {activeCluster ? (
          <strong key={activeCluster.key}>
            {activeCluster.items[0].city} · {activeCluster.items.length.toLocaleString('fa-IR')} {t('salesReps.results')}
          </strong>
        ) : hovered && (
          <strong key={hovered.id}>
            {hovered.fa}{provinceCounts.get(hovered.fa) ? ` · ${provinceCounts.get(hovered.fa).toLocaleString('fa-IR')}` : ''}
          </strong>
        )}
      </div>
      <svg
        className="sales-map__svg"
        viewBox={`0 0 ${IRAN_MAP_VIEWBOX.width} ${IRAN_MAP_VIEWBOX.height}`}
        role="group"
        aria-labelledby="sales-map-title sales-map-description"
        preserveAspectRatio="xMidYMid meet"
      >
        <title id="sales-map-title">{t('salesReps.mapLabel')}</title>
        <desc id="sales-map-description">{t('salesReps.mapDescription')}</desc>
        <defs>
          <linearGradient id="sales-map-land" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--sales-map-land-start)" />
            <stop offset="1" stopColor="var(--sales-map-land-end)" />
          </linearGradient>
          <filter id="sales-map-pin-shadow" x="-100%" y="-100%" width="300%" height="300%">
            <feDropShadow dx="0" dy="4" stdDeviation="4" floodOpacity=".28" />
          </filter>
        </defs>
        <g
          className={`sales-map__viewport${activeCluster ? ' is-city-focused' : ''}`}
          style={{ transform: cameraTransform }}
        >
          <g className="sales-map__provinces">
            {IRAN_PROVINCE_SHAPES.map((province) => {
              const count = provinceCounts.get(province.fa) || 0;
              const selected = selectedProvince === province.fa;
              return (
                <path
                  key={province.id}
                  d={province.d}
                  className={`${count ? 'has-representatives' : ''}${selected ? ' is-selected' : ''}`.trim()}
                  role="button"
                  tabIndex="0"
                  aria-label={`${province.fa}${count ? `، ${count.toLocaleString('fa-IR')} نماینده` : '، بدون نماینده فعال'}`}
                  aria-pressed={selected}
                  onPointerEnter={() => setHoveredProvince(province.fa)}
                  onPointerLeave={() => setHoveredProvince('')}
                  onFocus={() => setHoveredProvince(province.fa)}
                  onBlur={() => setHoveredProvince('')}
                  onClick={() => activateProvince(province.fa)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    activateProvince(province.fa);
                  }}
                />
              );
            })}
          </g>
          <g className="sales-map__markers" aria-hidden="true">
            {clusters.map((cluster) => {
              const selected = selectedCluster === cluster.key;
              const active = activeClusterKey === cluster.key;
              return (
                <g
                  key={cluster.key}
                  className={`sales-map__marker${selected ? ' is-selected' : ''}${active ? ' is-active' : ''}`}
                  transform={`translate(${cluster.point.x.toFixed(2)} ${cluster.point.y.toFixed(2)})`}
                >
                  <circle className="sales-map__marker-focus" r="34" />
                  <circle className="sales-map__marker-pulse" r="26" />
                  <g className="sales-map__marker-glyph">
                    <path className="sales-map__marker-pin" d="M0 16C-5 9-15-1-15-11a15 15 0 1 1 30 0C15-1 5 9 0 16Z" filter="url(#sales-map-pin-shadow)" />
                    <circle className="sales-map__marker-core" cy="-11" r="5" />
                    {cluster.items.length > 1 && (
                      <g className="sales-map__marker-count" transform="translate(13 -22)">
                        <circle r="10" />
                        <text textAnchor="middle" dominantBaseline="central">{cluster.items.length.toLocaleString('fa-IR')}</text>
                      </g>
                    )}
                  </g>
                </g>
              );
            })}
          </g>
        </g>
        {/* Stable hit targets keep the city under the pointer while the visual
            map scales, avoiding hover feedback loops in dense marker areas. */}
        <g className="sales-map__marker-hits">
          {clusters.map((cluster) => {
            const selected = selectedCluster === cluster.key;
            const city = cluster.items[0].city;
            const province = cluster.items[0].province;
            return (
              <g
                key={cluster.key}
                className="sales-map__marker-hit"
                transform={`translate(${cluster.point.x.toFixed(2)} ${cluster.point.y.toFixed(2)})`}
                role="button"
                tabIndex="0"
                aria-label={`${city}، استان ${province}، ${cluster.items.length.toLocaleString('fa-IR')} نماینده`}
                aria-pressed={selected}
                onPointerEnter={(event) => {
                  if (event.pointerType !== 'touch') setHoveredCluster(cluster.key);
                }}
                onPointerLeave={() => setHoveredCluster((current) => (current === cluster.key ? '' : current))}
                onFocus={(event) => {
                  if (event.currentTarget.matches(':focus-visible')) setFocusedCluster(cluster.key);
                }}
                onBlur={() => setFocusedCluster((current) => (current === cluster.key ? '' : current))}
                onClick={(event) => { event.stopPropagation(); onCluster(selected ? '' : cluster.key); }}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return;
                  event.preventDefault();
                  onCluster(selected ? '' : cluster.key);
                }}
              >
                <circle r="28" />
                <title>{city}، استان {province}</title>
              </g>
            );
          })}
        </g>
      </svg>
      <p className="sales-map__hint"><Icons.pin size={16} /> {t('salesReps.mapHint')}</p>
      <a className="sales-map__attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">
        © OpenStreetMap contributors
      </a>
    </div>
  );
}

export default function SalesRepresentatives() {
  const { t, m, col } = useContent();
  const representativeSource = col('salesRepresentatives');
  const representatives = useMemo(
    () => normalizeSalesRepresentatives(representativeSource).filter((item) => item.active),
    [representativeSource],
  );
  const [query, setQuery] = useState('');
  const [province, setProvince] = useState('');
  const [selectedCluster, setSelectedCluster] = useState('');

  const filtered = useMemo(() => {
    const needle = searchable(query);
    return representatives.filter((item) => {
      if (province && item.province !== province) return false;
      if (!needle) return true;
      return searchable(`${item.name} ${item.city} ${item.province} ${item.brands} ${item.phone}`).includes(needle);
    });
  }, [representatives, province, query]);
  const availableClusterKeys = useMemo(() => new Set(filtered.map(clusterKey)), [filtered]);
  useEffect(() => {
    if (selectedCluster && !availableClusterKeys.has(selectedCluster)) setSelectedCluster('');
  }, [availableClusterKeys, selectedCluster]);

  const shown = selectedCluster ? filtered.filter((item) => clusterKey(item) === selectedCluster) : filtered;
  const clear = () => {
    setQuery('');
    setProvince('');
    setSelectedCluster('');
  };

  return (
    <>
      <PageHero
        className="sales-reps-hero"
        title={t('salesReps.hero.title')}
        sub={t('salesReps.hero.sub')}
        image={m('salesReps.hero.img')}
      />
      <section className="section section--airy sales-reps">
        <div className="container">
          <SectionHead
            overline={t('salesReps.overline')}
            title={hl(t('salesReps.title'))}
            sub={t('salesReps.intro')}
          />

          <Reveal className="sales-reps__finder">
            <div className="sales-reps__controls" role="search">
              <label className="sales-reps__search">
                <span className="sr-only">{t('salesReps.search')}</span>
                <Icons.search size={19} />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => { setQuery(event.target.value); setSelectedCluster(''); }}
                  placeholder={t('salesReps.search')}
                  autoComplete="off"
                />
              </label>
              <label className="sales-reps__province">
                <span className="sr-only">انتخاب استان</span>
                <select
                  value={province}
                  onChange={(event) => { setProvince(event.target.value); setSelectedCluster(''); }}
                >
                  <option value="">{t('salesReps.allProvinces')}</option>
                  {IRAN_PROVINCES.map((item) => (
                    <option key={item.code} value={item.name}>{item.name}</option>
                  ))}
                </select>
                <Icons.chevron size={17} aria-hidden="true" />
              </label>
              {(query || province || selectedCluster) && (
                <button type="button" className="sales-reps__clear" onClick={clear}>
                  {t('salesReps.clear')}
                </button>
              )}
            </div>

            <div className="sales-reps__layout">
              <IranRepresentativesMap
                representatives={filtered}
                selectedProvince={province}
                selectedCluster={selectedCluster}
                onProvince={(next) => { setProvince(next); setSelectedCluster(''); }}
                onCluster={setSelectedCluster}
                t={t}
              />
              <aside className="sales-reps__results" aria-live="polite" aria-atomic="false">
                <div className="sales-reps__results-head">
                  <div>
                    <span>{t('salesReps.selected')}</span>
                    <strong>{shown.length.toLocaleString('fa-IR')} {t('salesReps.results')}</strong>
                  </div>
                  <Icons.users size={24} aria-hidden="true" />
                </div>
                {shown.length ? (
                  <div className="sales-reps__list">
                    {shown.map((item) => <RepresentativeCard key={item.id} representative={item} t={t} />)}
                  </div>
                ) : (
                  <div className="sales-reps__empty">
                    <Icons.search size={31} />
                    <h3>{t('salesReps.emptyTitle')}</h3>
                    <p>{t('salesReps.emptyText')}</p>
                    <button type="button" onClick={clear}>{t('salesReps.clear')}</button>
                  </div>
                )}
              </aside>
            </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}
