import { useState } from 'react';
import { Icons, Reveal, useNum } from './ui';
import { useContent } from '../content/ContentContext';
import {
  WORLD_MAP_ACTIVE_PATH,
  WORLD_MAP_INACTIVE_PATH,
  WORLD_MAP_VIEWBOX,
} from '../data/worldMap';

const MAP_POINTS = [
  { x: 76.45, y: 35.38, route: 'M635 186 Q704 108 765 177' },
  { x: 54.63, y: 24.98, route: 'M635 186 Q603 91 546 125' },
  { x: 55.88, y: 54.66, route: 'M635 186 Q574 213 559 273' },
  { x: 34.11, y: 66.44, route: 'M635 186 Q449 174 341 332' },
];

export default function ExportWorldMap({ regions = [] }) {
  const { t } = useContent();
  const num = useNum();
  const mappedRegions = regions.slice(0, MAP_POINTS.length);
  const [selected, setSelected] = useState(0);
  const activeIndex = Math.min(selected, Math.max(mappedRegions.length - 1, 0));
  const activeRegion = mappedRegions[activeIndex];

  if (!activeRegion) return null;

  return (
    <Reveal className="export-map">
      <div className="export-map__meta">
        <span className="export-map__badge">
          <Icons.globe size={18} />
          {t('export.map.badge')}
        </span>
        <span className="export-map__coverage">
          <strong>{num(mappedRegions.length)}</strong>
          {t('export.map.coverage')}
        </span>
      </div>

      <div className="export-map__layout">
        <div
          className="export-map__stage"
          role="group"
          aria-label={t('export.map.ariaLabel')}
        >
          <svg
            className="export-map__art"
            viewBox={WORLD_MAP_VIEWBOX}
            role="img"
            aria-labelledby="export-map-title export-map-description"
            preserveAspectRatio="xMidYMid meet"
          >
            <title id="export-map-title">{t('export.map.ariaLabel')}</title>
            <desc id="export-map-description">{t('export.map.description')}</desc>
            <defs>
              <linearGradient id="export-map-active-land" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="var(--crimson)" stopOpacity="0.92" />
                <stop offset="1" stopColor="var(--crimson-ink)" stopOpacity="0.72" />
              </linearGradient>
              <radialGradient id="export-map-origin-glow">
                <stop offset="0" stopColor="var(--gold)" stopOpacity="0.85" />
                <stop offset="1" stopColor="var(--gold)" stopOpacity="0" />
              </radialGradient>
            </defs>

            <g className="export-map__graticule" aria-hidden="true">
              <ellipse cx="500" cy="250" rx="455" ry="205" />
              <path d="M55 185 Q500 120 945 185" />
              <path d="M45 250 Q500 205 955 250" />
              <path d="M55 315 Q500 380 945 315" />
              <path d="M255 58 Q355 250 255 442" />
              <path d="M385 48 Q430 250 385 452" />
              <path d="M615 48 Q570 250 615 452" />
              <path d="M745 58 Q645 250 745 442" />
            </g>

            <path className="export-map__land export-map__land--other" d={WORLD_MAP_INACTIVE_PATH} />
            <path className="export-map__land export-map__land--active" d={WORLD_MAP_ACTIVE_PATH} />

            <g className="export-map__routes" aria-hidden="true">
              {mappedRegions.map((region, index) => (
                <path
                  key={region.title}
                  d={MAP_POINTS[index].route}
                  className={`export-map__route${activeIndex === index ? ' is-active' : ''}`}
                  pathLength="1"
                />
              ))}
            </g>

            <g className="export-map__origin" aria-hidden="true">
              <circle className="export-map__origin-glow" cx="635" cy="186" r="34" />
              <circle className="export-map__origin-ring" cx="635" cy="186" r="10" />
              <circle className="export-map__origin-core" cx="635" cy="186" r="4" />
            </g>
          </svg>

          {mappedRegions.map((region, index) => {
            const point = MAP_POINTS[index];
            const isActive = activeIndex === index;
            return (
              <button
                key={region.title}
                type="button"
                className={`export-map__marker${isActive ? ' is-active' : ''}`}
                style={{ '--map-x': `${point.x}%`, '--map-y': `${point.y}%` }}
                aria-pressed={isActive}
                aria-controls="export-map-detail"
                onPointerEnter={() => setSelected(index)}
                onFocus={() => setSelected(index)}
                onClick={() => setSelected(index)}
              >
                <span className="export-map__marker-pin" aria-hidden="true">
                  <span />
                </span>
                <span className="export-map__marker-label">{region.title}</span>
              </button>
            );
          })}
        </div>

        <aside
          id="export-map-detail"
          className="export-map__detail"
          aria-live="polite"
          aria-atomic="true"
        >
          <div className="export-map__detail-top">
            <span>{t('export.map.selected')}</span>
            <bdi dir="ltr">{num(activeIndex + 1)} / {num(mappedRegions.length)}</bdi>
          </div>
          <div className="export-map__detail-icon" aria-hidden="true">
            <Icons.globe size={28} />
          </div>
          <h3>{activeRegion.title}</h3>
          <p>{activeRegion.text}</p>

          <div className="export-map__legend" aria-hidden="true">
            <span><i className="is-active" />{t('export.map.activeLegend')}</span>
            <span><i />{t('export.map.otherLegend')}</span>
          </div>
          <p className="export-map__hint">
            <Icons.pin size={16} />
            {t('export.map.hint')}
          </p>
        </aside>
      </div>
    </Reveal>
  );
}
