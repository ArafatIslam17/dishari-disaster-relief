import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import L from 'leaflet';
import { MapContainer, Marker, Popup, TileLayer } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { formatNumber, formatPercent } from '../i18n';
import { pinKind, placeOf, type PinKind, type UpazilaFigure } from './map-places';

/**
 * Live operation map (loaded on demand so Leaflet stays out of the main bundle). Standard
 * OpenStreetMap tiles: no API key; a CSS filter softens them in light mode and darkens them in dark
 * mode (dishari.css). Pins are CSS-only div icons (no inline styles, so the strict CSP holds).
 */
const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const pin = (kind: PinKind) =>
  L.divIcon({
    className: `dsh-pin dsh-pin-${kind}`,
    html: kind === 'active' ? '<span class="dsh-pin-pulse"></span><span class="dsh-pin-dot"></span>' : '<span class="dsh-pin-dot"></span>',
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -12],
  });
const ICONS: Record<PinKind, L.DivIcon> = { active: pin('active'), attention: pin('attention') };

export default function LiveMap({ upazilas }: { upazilas: UpazilaFigure[] }) {
  const { t, i18n } = useTranslation();
  const placed = useMemo(
    () =>
      upazilas.flatMap((u) => {
        const p = placeOf(u.upazila);
        return p ? [{ u, p }] : [];
      }),
    [upazilas],
  );
  const bounds = useMemo(() => (placed.length > 0 ? L.latLngBounds(placed.map((x) => x.p)).pad(0.3) : null), [placed]);
  const name = (u: UpazilaFigure) => (i18n.language === 'bn' && u.upazilaBn ? u.upazilaBn : u.upazila);
  if (!bounds) return <p className="map-empty muted small">{t('map.noPlaces')}</p>;
  return (
    <MapContainer bounds={bounds} scrollWheelZoom={false} className="live-map-canvas">
      <TileLayer url={TILES} attribution={ATTRIBUTION} maxZoom={18} />
      {placed.map(({ u, p }) => {
        const kind = pinKind(u);
        return (
          <Marker key={u.upazila} position={p} icon={ICONS[kind]} title={`${name(u)}: ${t(`map.${kind}`)}`} keyboard>
            <Popup>
              <div className="map-pop">
                <p className="map-pop-title">{name(u)}</p>
                <span className={`map-pop-status is-${kind}`}>{t(`map.${kind}`)}</span>
                <dl>
                  <div>
                    <dt>{t('map.registered')}</dt>
                    <dd>{formatNumber(u.registered)}</dd>
                  </div>
                  <div>
                    <dt>{t('map.served')}</dt>
                    <dd>{formatNumber(u.served)}</dd>
                  </div>
                  <div>
                    <dt>{t('map.status')}</dt>
                    <dd>
                      {t(`coverage.${u.label}`)}
                      {u.servedPercent !== null ? ` · ${formatPercent(u.servedPercent / 100)}` : ''}
                    </dd>
                  </div>
                </dl>
              </div>
            </Popup>
          </Marker>
        );
      })}
    </MapContainer>
  );
}
