import { useEffect, useMemo, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { GeoJSONSource, MapLayerMouseEvent, MapMouseEvent, StyleSpecification } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { cellColor } from './globeColors'
import { fmtNum, shortVarName, tUnit, type Lang } from './i18n'

export type GlobeVariable = {
  label: string
  unit: string
  cells: number
  fdr_threshold: number
  fdr_significant: number
  slope_p98: number
}

// ojo con el orden: [pendiente por década, p de Mann-Kendall, veredicto 2/1/0, media, pasa FDR 1/0]
type CellValue = [number, number, number, number, number]
export type GlobeCell = { lat: number; lon: number } & Record<string, CellValue | number>
export type GlobeData = {
  generated: string
  period: [number, number]
  cell_deg: number
  fdr_q: number
  variables: Record<string, GlobeVariable>
  cells: GlobeCell[]
}

export type CameraCmd = { kind: 'global' | 'center' | 'zone'; seq: number }

const VERDICT_TIP: Record<Lang, [string, string, string]> = {
  es: ['Sin tendencia clara', 'Todavía no significativa', 'Tendencia significativa'],
  en: ['No clear trend', 'Not yet significant', 'Confirmed trend'],
}

const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best'

const STYLE: StyleSpecification = {
  version: 8,
  projection: { type: 'globe' },
  sky: { 'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 7, 0] },
  sources: {
    day: {
      type: 'raster',
      tileSize: 256,
      maxzoom: 8,
      tiles: [`${GIBS}/BlueMarble_NextGeneration/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg`],
      attribution: 'NASA GIBS · Blue Marble',
    },
    detail: {
      type: 'raster',
      tileSize: 256,
      maxzoom: 18,
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      attribution: 'Esri World Imagery',
    },
    night: {
      type: 'raster',
      tileSize: 256,
      maxzoom: 8,
      tiles: [`${GIBS}/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png`],
      attribution: 'NASA GIBS · VIIRS Black Marble',
    },
  },
  layers: [
    { id: 'day', type: 'raster', source: 'day' },
    {
      id: 'detail',
      type: 'raster',
      source: 'detail',
      minzoom: 3.5,
      paint: { 'raster-opacity': ['interpolate', ['linear'], ['zoom'], 3.5, 0, 5.8, 1] },
    },
    { id: 'night', type: 'raster', source: 'night', layout: { visibility: 'none' } },
  ],
}

type SpotPin = { lat: number; lon: number; label?: string }
type GeoFeatureCollection = Extract<Parameters<GeoJSONSource['setData']>[0], { type: 'FeatureCollection' }>
type GeoFeature = GeoFeatureCollection['features'][number]

const TELECONNECTIONS: GeoFeatureCollection = {
  type: 'FeatureCollection',
  features: [

    { type: 'Feature', properties: { name: 'ENSO → Corredor Seco' }, geometry: { type: 'LineString', coordinates: [[-140, 0], [-112, 8], [-86.6, 13.5]] } },

    { type: 'Feature', properties: { name: 'ENSO → Amazonía' }, geometry: { type: 'LineString', coordinates: [[-140, 0], [-100, -4], [-60, -3.1]] } },

    { type: 'Feature', properties: { name: 'ENSO → Sudeste Asiático' }, geometry: { type: 'LineString', coordinates: [[-140, 0], [-178, 2], [150, 2], [110, 1]] } },

    { type: 'Feature', properties: { name: 'Sahel / Atlántico → Caribe' }, geometry: { type: 'LineString', coordinates: [[10, 15], [-35, 16], [-83.8, 12]] } },

    { type: 'Feature', properties: { name: 'Ártico → Latitudes medias' }, geometry: { type: 'LineString', coordinates: [[15.6, 78.2], [-20, 62], [-75, 42]] } },
  ],
}

type Props = {
  data: GlobeData
  variable: string
  onlySignificant: boolean
  night: boolean
  showTeleconnections?: boolean
  lang: Lang
  onPick: (lat: number, lon: number) => void
  focus?: SpotPin | null
  second?: SpotPin | null
  cameraCmd?: CameraCmd | null
  spinEnabled?: boolean
}

export function Globe3D({
  data,
  variable,
  onlySignificant,
  night,
  showTeleconnections = false,
  lang,
  onPick,
  focus,
  second,
  cameraCmd,
  spinEnabled = true,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)

  const spotsGeojson = useMemo<GeoFeatureCollection>(() => {
    const features: GeoFeature[] = []
    if (focus) {
      features.push({
        type: 'Feature',
        id: 'spot-a',
        properties: { color: '#56e1e8', role: 'A' },
        geometry: { type: 'Point', coordinates: [focus.lon, focus.lat] },
      })
    }
    if (second) {
      features.push({
        type: 'Feature',
        id: 'spot-b',
        properties: { color: '#f59e42', role: 'B' },
        geometry: { type: 'Point', coordinates: [second.lon, second.lat] },
      })
    }
    return { type: 'FeatureCollection', features }
  }, [focus, second])

  const geojson = useMemo<GeoFeatureCollection>(() => {
    const half = data.cell_deg / 2
    const scale = data.variables[variable]?.slope_p98 ?? 1
    const clampLat = (x: number) => Math.max(-85, Math.min(85, x))
    return {
      type: 'FeatureCollection',
      features: data.cells.flatMap((c, i) => {
        const v = c[variable] as CellValue | undefined
        if (!v || (onlySignificant && !v[4])) return []
        const [w, e, s, n] = [c.lon - half, c.lon + half, clampLat(c.lat - half), clampLat(c.lat + half)]
        return [{
          type: 'Feature' as const,
          id: i,
          properties: {
            lat: c.lat,
            lon: c.lon,
            slope: v[0],
            verdict: v[2],
            fdr: v[4],
            color: cellColor(variable, v[0], scale, v[4] ? 0.22 + 0.54 * Math.min(1, Math.abs(v[0] / scale)) : 0.06),
          },
          geometry: { type: 'Polygon' as const, coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] },
        }]
      }),
    }
  }, [data, variable, onlySignificant])

  const live = useRef({
    onPick,
    spinEnabled,
    lang,
    variable,
    meta: data.variables[variable],
    geojson,
    spotsGeojson,
  })
  useEffect(() => {
    Object.assign(live.current, {
      onPick,
      spinEnabled,
      lang,
      variable,
      meta: data.variables[variable],
      geojson,
      spotsGeojson,
    })
  })

  useEffect(() => {
    const map = new maplibregl.Map({
      container: wrapRef.current!,
      style: STYLE,
      center: [focus?.lon ?? -60, focus?.lat ?? 12],
      zoom: 1.95,
      maxZoom: 12,
      attributionControl: { compact: true },
    })
    mapRef.current = map
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left')
    const popup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      className: 'globe-popup',
      offset: 10,
    })

    let interacting = false
    const spin = () => {
      if (interacting || !live.current.spinEnabled || map.getZoom() > 2.6) return
      const c = map.getCenter()
      map.easeTo({ center: [c.lng - 3.2, c.lat], duration: 1000, easing: (t: number) => t })
    }
    const stop = () => {
      interacting = true
      map.stop()
    }
    const resume = () => {
      interacting = false
      spin()
    }
    map.on('mousedown', stop)
    map.on('touchstart', stop)
    map.on('wheel', stop)
    map.on('mouseup', resume)
    map.on('touchend', resume)
    map.on('dragend', resume)
    map.on('moveend', spin)

    let hovered: number | string | undefined
    map.on('load', () => {
      map.addSource('cells', { type: 'geojson', data: live.current.geojson })
      map.addLayer({
        id: 'cells',
        type: 'fill',
        source: 'cells',
        paint: {
          'fill-color': ['to-color', ['get', 'color']],
          'fill-antialias': false,

          'fill-opacity': ['interpolate', ['linear'], ['zoom'], 2, 1, 4.2, 0.72, 6.2, 0.22, 8.5, 0.08],
        },
      })
      map.addLayer({
        id: 'cells-grid',
        type: 'line',
        source: 'cells',
        paint: {
          'line-color': 'rgba(255,255,255,0.08)',
          'line-width': 0.5,
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 2, 0.4, 5.5, 0.7, 9, 0.3],
        },
      })
      map.addLayer({
        id: 'cells-hover',
        type: 'line',
        source: 'cells',
        paint: {
          'line-color': '#ffffff',
          'line-width': 2,
          'line-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 1, 0],
        },
      })

      map.addSource('teleconnections', { type: 'geojson', data: TELECONNECTIONS })
      map.addLayer({
        id: 'teleconnections',
        type: 'line',
        source: 'teleconnections',
        layout: { visibility: showTeleconnections ? 'visible' : 'none' },
        paint: {
          'line-color': '#a78bfa',
          'line-width': 2.2,
          'line-dasharray': [2, 2],
          'line-opacity': 0.85,
        },
      })

      map.addSource('selected-spots', { type: 'geojson', data: live.current.spotsGeojson })
      map.addLayer({
        id: 'spot-halo',
        type: 'circle',
        source: 'selected-spots',
        paint: {
          'circle-radius': 14,
          'circle-color': ['get', 'color'],
          'circle-opacity': 0.25,
          'circle-stroke-width': 2,
          'circle-stroke-color': ['get', 'color'],
        },
      })
      map.addLayer({
        id: 'spot-dot',
        type: 'circle',
        source: 'selected-spots',
        paint: {
          'circle-radius': 5.5,
          'circle-color': ['get', 'color'],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#00023d',
        },
      })

      spin()
    })

    map.on('mousemove', 'cells', (e: MapLayerMouseEvent) => {
      const f = e.features?.[0]
      if (!f) return
      map.getCanvas().style.cursor = 'pointer'
      if (hovered !== undefined) map.setFeatureState({ source: 'cells', id: hovered }, { hover: false })
      hovered = f.id
      map.setFeatureState({ source: 'cells', id: hovered! }, { hover: true })
      const p = f.properties as { lat: number; lon: number; slope: number; verdict: number; fdr: number }
      const meta = live.current.meta
      const curLang = live.current.lang
      const vName = shortVarName(live.current.variable, curLang, meta.label)
      const unitLabel = tUnit(meta.unit, curLang)
      const perDec = curLang === 'es' ? '/década' : '/decade'
      const fdrLabel = p.fdr ? (curLang === 'es' ? ' · pasa FDR' : ' · passes FDR') : ''
      const tipHint = curLang === 'es'
        ? 'Clic para marcar esta zona'
        : 'Click to select this spot'
      popup
        .setLngLat(e.lngLat)
        .setHTML(
          `<div class="globe-tip"><b>${vName}</b><br/>` +
          `${p.lat.toFixed(1)}°, ${p.lon.toFixed(1)}°<br/>` +
          `<span class="num">${p.slope > 0 ? '+' : ''}${fmtNum(p.slope, curLang)} ${unitLabel}${perDec}</span><br/>` +
          `${VERDICT_TIP[curLang][p.verdict]}${fdrLabel}<br/>` +
          `<i>${tipHint}</i></div>`,
        )
        .addTo(map)
    })

    map.on('mouseleave', 'cells', () => {
      map.getCanvas().style.cursor = 'crosshair'
      if (hovered !== undefined) map.setFeatureState({ source: 'cells', id: hovered }, { hover: false })
      hovered = undefined
      popup.remove()
    })

    map.on('click', (e: MapMouseEvent) => {
      const z = map.getZoom()
      if (z < 3.6) {
        const hit = map.queryRenderedFeatures(e.point, { layers: ['cells'] })[0]
        const props = hit?.properties as { lat?: number; lon?: number } | undefined
        if (props?.lat !== undefined && props?.lon !== undefined) {
          live.current.onPick(props.lat, props.lon)
          return
        }
      }
      const normLon = ((e.lngLat.lng + 540) % 360) - 180
      live.current.onPick(+e.lngLat.lat.toFixed(4), +normLon.toFixed(4))
    })

    return () => {
      popup.remove()
      map.remove()
      mapRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    live.current.geojson = geojson
    ;(mapRef.current?.getSource('cells') as GeoJSONSource | undefined)?.setData(geojson)
  }, [geojson])

  useEffect(() => {
    live.current.spotsGeojson = spotsGeojson
    ;(mapRef.current?.getSource('selected-spots') as GeoJSONSource | undefined)?.setData(spotsGeojson)
  }, [spotsGeojson])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const apply = () => {
      map.setLayoutProperty('night', 'visibility', night ? 'visible' : 'none')
      for (const id of ['day', 'detail']) map.setLayoutProperty(id, 'visibility', night ? 'none' : 'visible')
    }
    if (map.isStyleLoaded()) apply()
    else map.once('load', apply)
  }, [night])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const apply = () => {
      if (map.getLayer('teleconnections')) {
        map.setLayoutProperty('teleconnections', 'visibility', showTeleconnections ? 'visible' : 'none')
      }
    }
    if (map.isStyleLoaded()) apply()
    else map.once('load', apply)
  }, [showTeleconnections])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !cameraCmd) return
    if (cameraCmd.kind === 'global') {
      map.flyTo({ center: [focus?.lon ?? -60, focus?.lat ?? 12], zoom: 1.9, duration: 1100 })
    } else if (cameraCmd.kind === 'zone' && focus) {
      map.flyTo({ center: [focus.lon, focus.lat], zoom: 6.8, duration: 1300 })
    } else if (cameraCmd.kind === 'center' && focus) {
      map.flyTo({ center: [focus.lon, focus.lat], zoom: Math.max(map.getZoom(), 4.2), duration: 1000 })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraCmd?.seq])

  return <div ref={wrapRef} className="globe-wrap" />
}
