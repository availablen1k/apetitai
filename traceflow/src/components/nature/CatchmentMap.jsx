import { useEffect, useMemo } from 'react';
import { GeoJSON, MapContainer, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useI18n } from '@/lib/i18n';

// Ecological status of the receiving water (supplied indicative class).
export const STATUS_COLOR = { high: '#2E7099', good: '#5B9BC4', moderate: '#D9A441', poor: '#C1773F', bad: '#9E3B2C' };
export const STATUS_LABEL = {
  fi: { high: 'Erinomainen', good: 'Hyvä', moderate: 'Tyydyttävä', poor: 'Välttävä', bad: 'Huono' },
  en: { high: 'High', good: 'Good', moderate: 'Moderate', poor: 'Poor', bad: 'Bad' },
};

// Tooltips are HTML strings; values from imported files are escaped.
export const esc = (v) => String(v ?? '—').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function FitBounds({ data, focus }) {
  const map = useMap();
  useEffect(() => {
    const layer = L.geoJSON(focus?.features?.length ? focus : data);
    const bounds = layer.getBounds();
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [12, 12] });
  }, [map, data, focus]);
  return null;
}

// No basemap tiles: the geometry is synthetic and the map works offline.
export default function CatchmentMap({ catchments, parcels = undefined, selected = undefined, onSelect = undefined, parcelStyle = undefined, parcelTooltip = undefined, height = 420 }) {
  const { lang } = useI18n();
  const fi = lang === 'fi';
  const drawable = useMemo(() => ({ ...catchments, features: (catchments?.features || []).filter((f) => f.geometry) }), [catchments]);
  const focus = useMemo(() => (selected ? { type: 'FeatureCollection', features: drawable.features.filter((f) => f.id === selected) } : null), [drawable, selected]);
  if (!drawable.features.length) return null;

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-[#F4F7F9] dark:bg-[#132029]" style={{ height }}>
      <MapContainer center={[61, 22.5]} zoom={8} style={{ height: '100%', width: '100%', background: 'transparent' }} attributionControl={false} scrollWheelZoom={false}>
        <FitBounds data={drawable} focus={focus} />
        <GeoJSON
          key={`c-${selected || 'all'}`}
          data={drawable}
          style={(f) => ({ color: f.id === selected ? '#10324A' : '#5F7584', weight: f.id === selected ? 2.5 : 1, fillColor: STATUS_COLOR[f.properties.ecological_status_class] || '#9AA9B3', fillOpacity: parcels ? 0.15 : 0.55 })}
          onEachFeature={(f, layer) => {
            const p = f.properties;
            layer.bindTooltip(`<strong>${esc(f.id)}</strong> · ${esc(p.region)}<br/>${fi ? 'Tila' : 'Status'}: ${esc(STATUS_LABEL[lang]?.[p.ecological_status_class] || p.ecological_status_class)}${p.latest_year ? `<br/>P ${esc(Math.round(p.latest_p_load_kg))} kg · N ${esc(Math.round(p.latest_n_load_kg))} kg (${esc(p.latest_year)})` : `<br/>${fi ? 'Ei seurantaa' : 'Not monitored'}`}`, { sticky: true });
            layer.on('click', () => onSelect?.(f.id));
          }}
        />
        {parcels?.features?.length > 0 && (
          <GeoJSON
            key={`p-${parcels.catchment_id}-${parcels.year}-${parcels.features.length}-${parcelStyle?.key || ''}`}
            data={parcels}
            style={(f) => parcelStyle?.fn?.(f) || { color: '#1B4968', weight: 0.6, fillColor: f.properties.is_contract_crop_provisional ? '#1B4968' : '#B8C4CC', fillOpacity: 0.7 }}
            onEachFeature={(f, layer) => layer.bindTooltip(parcelTooltip ? parcelTooltip(f) : `${esc(f.id)} · ${esc(f.properties.crop)} · ${esc(f.properties.area_ha)} ha`, { sticky: true })}
          />
        )}
      </MapContainer>
    </div>
  );
}
