import { useEffect, useMemo, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { FilterSpecification, GeoJSONSourceSpecification, StyleSpecification } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { loadCity, type CityIndexEntry, type CityPayload, type DriverRow } from './cities'
import { DataTable, type Column } from './DataTable'
import { CITY, fmtNum, verdictLabel, type Lang } from './i18n'
import { Button, Disclosure, Kpi, Switch } from './ui'

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services'
const TERRAIN = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
const STYLE: StyleSpecification = {
  version: 8,
  sources: {
    base: {
      type: 'raster', tileSize: 256, maxzoom: 16,
      tiles: [`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`],
      attribution: 'Esri, Maxar, Earthstar Geographics, © OpenStreetMap contributors · Impact Observatory/Esri LULC · Copernicus DEM · GHSL (JRC) · Mapzen/AWS Terrain Tiles',
    },
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#050a3a' } },
    // imagen satelital muy atenuada y desaturada: da contexto sin competir con los volúmenes
    { id: 'base', type: 'raster', source: 'base', paint: { 'raster-opacity': 0.5, 'raster-saturation': -0.75, 'raster-brightness-max': 0.55, 'raster-contrast': 0.15 } },
  ],
}

// Rampa de altura (m) de lo existente: azul profundo (bajo) → cian claro (alto)
const HEIGHT_STOPS: [number, string][] = [
  [3, '#2a3cc4'], [6, '#3c63ea'], [10, '#4f93f5'], [16, '#6fc3f7'], [24, '#a8ecff'],
]
const PROJ_NEAR = '#56e1e8'
const PROJ_PULSE = '#f4ffff'
const VERT_COLOR = '#ffffff'
const NEVER = 9999 // año "infinito": la celda no se añade en ese escenario

type Scenario = 'integrated' | 'population_only'

function decode(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

type CellFeature = {
  type: 'Feature'
  properties: { k: number; y: number; yb: number; h0: number; core: number }
  geometry: { type: 'Polygon'; coordinates: number[][][] }
}
type CellCollection = { type: 'FeatureCollection'; features: CellFeature[] }

/** Una celda = un polígono. k=0: construido en el año base; k=1: añadido por algún escenario.
 *  y = año en que la añade el escenario integrado; yb = año en que la añade el de solo población.
 *  h0 = altura real de partida (m) si k=0, o altura de una celda nueva (m) si k=1.
 *  core = peso de centralidad (0–1): el crecimiento vertical se concentra en el núcleo denso. */
function buildFeatures(city: CityPayload): CellCollection {
  const { cols, rows, west, south, east, north } = city.grid
  const dlon = (east - west) / cols
  const dlat = (north - south) / rows
  const dens = decode(city.density)
  const addedI = decode(city.added)
  const addedP = city.added_base ? decode(city.added_base) : addedI
  const water = decode(city.water)
  const hBase = city.height ? decode(city.height) : null
  const hNew = city.height_new ? decode(city.height_new) : null
  const coreG = city.core ? decode(city.core) : null
  const inset = 0.12 // manzanas separadas por 'calles'
  const feats: CellFeature[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      const d = dens[i]
      const a = addedI[i]
      const ab = addedP[i]
      if (d === 0 && a === 0 && ab === 0) continue
      if (water[i] && a === 0 && ab === 0) continue
      const w = west + (c + inset) * dlon
      const e = west + (c + 1 - inset) * dlon
      const n = north - (r + inset) * dlat
      const s = north - (r + 1 - inset) * dlat
      const projected = d === 0
      const h0 = projected
        ? Math.max(3, hNew ? hNew[i] : 5)
        : Math.max(3, hBase ? hBase[i] : 3 + (d / 100) * 12)
      feats.push({
        type: 'Feature',
        properties: {
          k: projected ? 1 : 0,
          y: projected ? (a > 0 ? city.years[a] : NEVER) : city.base_year,
          yb: projected ? (ab > 0 ? city.years[ab] : NEVER) : city.base_year,
          h0,
          core: coreG ? coreG[i] / 100 : 0,
        },
        geometry: { type: 'Polygon', coordinates: [[[w, n], [e, n], [e, s], [w, s], [w, n]]] },
      })
    }
  }
  return { type: 'FeatureCollection', features: feats }
}

const prop = (s: Scenario) => (s === 'integrated' ? 'y' : 'yb')

/** Color de lo proyectado: cian; las celdas añadidas EN el paso del año seleccionado resaltan (cian casi blanco). */
function colorExpr(s: Scenario, year: number) {
  return ['case', ['==', ['get', prop(s)], year], PROJ_PULSE, PROJ_NEAR]
}
const baseColorExpr = () => ['interpolate', ['linear'], ['get', 'h0'], ...HEIGHT_STOPS.flat()] as never

/** Altura de una celda en el año t: h0 · (1 + (m − 1) · core). m = multiplicador de altura del año (1 sin crecimiento vertical). */
const grownHeight = (m: number, exag: number, p = 1) =>
  ['*', ['get', 'h0'], ['+', 1, ['*', m - 1, ['get', 'core']]], exag * p] as never
const baseHeight = (exag: number, p = 1) => ['*', ['get', 'h0'], exag * p] as never
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)
const reducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches

function sensValue(map: Record<string, number>, key: string): number | undefined {
  return map[key]
}

export function CityGrowth3D({ entry, lang }: { entry: CityIndexEntry; lang: Lang }) {
  const T = CITY[lang]
  const [city, setCity] = useState<CityPayload | null>(null)
  const [error, setError] = useState(false)
  const [yearIdx, setYearIdx] = useState(0)
  const [onlyProjected, setOnlyProjected] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [scenario, setScenario] = useState<Scenario>('integrated')
  const [exag, setExag] = useState(6)
  const [rotating, setRotating] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const readyRef = useRef(false)
  const live = useRef({ yearIdx: 0, onlyProjected: false, scenario: 'integrated' as Scenario, exag: 6 })
  const progRef = useRef(1) // 0 → las alturas están en el suelo; 1 → alturas completas
  const rafRef = useRef(0)
  const risenRef = useRef(false)
  const ioRef = useRef<IntersectionObserver | null>(null)

  useEffect(() => {
    let alive = true
    setCity(null)
    setError(false)
    setYearIdx(0)
    setPlaying(false)
    loadCity(entry)
      .then((c) => {
        if (!alive) return
        setScenario(c.scenarios?.default === 'population_only' ? 'population_only' : 'integrated')
        setCity(c)
      })
      .catch(() => alive && setError(true))
    return () => {
      alive = false
    }
  }, [entry])

  const features = useMemo(() => (city ? buildFeatures(city) : null), [city])
  const years = city?.years ?? []
  const year = years[yearIdx] ?? 0
  const hasBase = !!city?.added_base

  function multiplierFor(sc: Scenario, y: number): number {
    if (sc !== 'integrated' || !city?.vertical) return 1
    return city.vertical.multiplier[String(y)] ?? 1
  }

  function applyState(map: maplibregl.Map) {
    if (!city) return
    const { yearIdx: yi, onlyProjected: op, scenario: sc, exag: ex } = live.current
    const y = city.years[yi]
    const m = multiplierFor(sc, y)
    const p = progRef.current
    if (map.getLayer('city-proj')) {
      map.setFilter('city-proj', ['all', ['==', ['get', 'k'], 1], ['<=', ['get', prop(sc)], y]] as FilterSpecification)
      map.setPaintProperty('city-proj', 'fill-extrusion-color', colorExpr(sc, y) as never)
      map.setPaintProperty('city-proj', 'fill-extrusion-height', grownHeight(m, ex, p))
      map.setPaintProperty('city-proj', 'fill-extrusion-opacity', op ? 0.95 : 0.92)
    }
    if (map.getLayer('city-glow')) {
      // halo luminoso en el suelo alrededor de lo nuevo
      map.setFilter('city-glow', ['all', ['==', ['get', 'k'], 1], ['<=', ['get', prop(sc)], y]] as FilterSpecification)
      map.setPaintProperty('city-glow', 'line-opacity', p < 1 ? 0.15 * p : 0.5)
    }
    if (map.getLayer('city-base')) {
      map.setPaintProperty('city-base', 'fill-extrusion-opacity', op ? 0.12 : 0.95)
      map.setPaintProperty('city-base', 'fill-extrusion-height', baseHeight(ex, p))
    }
    if (map.getLayer('city-vert')) {
      // corona translúcida: los pisos que se suman encima de lo existente (solo en el escenario integrado y después del año base)
      map.setLayoutProperty('city-vert', 'visibility', m > 1 ? 'visible' : 'none')
      map.setPaintProperty('city-vert', 'fill-extrusion-base', baseHeight(ex, p))
      map.setPaintProperty('city-vert', 'fill-extrusion-height', grownHeight(m, ex, p))
      map.setPaintProperty('city-vert', 'fill-extrusion-opacity', op ? 0.12 : 0.6)
    }
  }

  /** Animación "crece desde el suelo": sube el factor de progreso con easing (sin animar si el usuario prefiere menos movimiento). */
  function rise(from = 0, ms = 1200) {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    cancelAnimationFrame(rafRef.current)
    if (reducedMotion()) {
      progRef.current = 1
      applyState(map)
      return
    }
    const t0 = performance.now()
    let last = 0
    const tick = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - t0) / ms))
      progRef.current = from + (1 - from) * easeOut(t)
      if (now - last > 55 || t >= 1) {
        last = now
        applyState(map)
      }
      if (t < 1) rafRef.current = requestAnimationFrame(tick)
    }
    progRef.current = from
    applyState(map)
    rafRef.current = requestAnimationFrame(tick)
  }

  // El mapa se crea una vez por ciudad; el GeoJSON se construye una vez y año y escenario solo cambian el filtro.
  useEffect(() => {
    if (!city || !features || !wrapRef.current) return
    readyRef.current = false
    const box = wrapRef.current
    const side = Math.max(280, Math.min(box.clientWidth || 900, (box.clientHeight || 520) * 1.55))
    const spanKm = ((city.grid.east - city.grid.west) * 111.32 * Math.cos((city.lat * Math.PI) / 180)) * 0.92
    const mpp = (spanKm * 1000) / side // metros por píxel para que la ciudad llene el recuadro
    const zoom = Math.min(13.2, Math.max(10.2, Math.log2((156543.03 * Math.cos((city.lat * Math.PI) / 180)) / mpp) - 0.25))
    const map = new maplibregl.Map({
      container: box,
      style: STYLE,
      center: [city.lon, city.lat],
      zoom,
      pitch: 58,
      bearing: -18,
      maxPitch: 80,
      attributionControl: { compact: true },
    })
    mapRef.current = map
    const ro = new ResizeObserver(() => map.resize())
    ro.observe(box)
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true, showZoom: true }), 'top-right')
    risenRef.current = false
    map.on('load', () => {
      try {
        map.setLight({ anchor: 'viewport', color: '#ffffff', intensity: 0.45, position: [1.6, 215, 42] })
      } catch { /* sin luz personalizada: se ve igual, solo menos sombreado */ }
      try {
        // relieve real: la ciudad se asienta sobre el terreno; si no hay red o falla, se ve sobre el plano
        map.addSource('terrain', {
          type: 'raster-dem', encoding: 'terrarium', tileSize: 256, maxzoom: 15, tiles: [TERRAIN],
        })
        map.setTerrain({ source: 'terrain', exaggeration: 1.4 })
      } catch { /* sin relieve */ }
      map.addSource('city', { type: 'geojson', data: features as unknown as GeoJSONSourceSpecification['data'] })
      // halo luminoso (en el suelo) de las celdas nuevas
      map.addLayer({
        id: 'city-glow', type: 'line', source: 'city',
        filter: ['all', ['==', ['get', 'k'], 1], ['<=', ['get', 'y'], city.base_year]] as FilterSpecification,
        paint: { 'line-color': PROJ_NEAR, 'line-width': 5, 'line-blur': 6, 'line-opacity': 0.5 },
      })
      map.addLayer({
        id: 'city-base', type: 'fill-extrusion', source: 'city',
        filter: ['==', ['get', 'k'], 0],
        paint: {
          'fill-extrusion-color': baseColorExpr(),
          'fill-extrusion-height': baseHeight(live.current.exag),
          'fill-extrusion-base': 0,
          'fill-extrusion-opacity': 0.95,
          'fill-extrusion-vertical-gradient': true,
        },
      })
      map.addLayer({
        id: 'city-vert', type: 'fill-extrusion', source: 'city',
        filter: ['==', ['get', 'k'], 0],
        layout: { visibility: 'none' },
        paint: {
          'fill-extrusion-color': VERT_COLOR,
          'fill-extrusion-height': baseHeight(live.current.exag),
          'fill-extrusion-base': baseHeight(live.current.exag),
          'fill-extrusion-opacity': 0.82,
          'fill-extrusion-vertical-gradient': true,
        },
      })
      map.addLayer({
        id: 'city-proj', type: 'fill-extrusion', source: 'city',
        filter: ['all', ['==', ['get', 'k'], 1], ['<=', ['get', 'y'], city.base_year]] as FilterSpecification,
        paint: {
          'fill-extrusion-color': colorExpr(live.current.scenario, city.base_year) as never,
          'fill-extrusion-height': grownHeight(1, live.current.exag),
          'fill-extrusion-base': 0,
          'fill-extrusion-opacity': 0.92,
          'fill-extrusion-vertical-gradient': true,
        },
      })
      readyRef.current = true
      progRef.current = reducedMotion() ? 1 : 0
      applyState(map)
      // "crece desde el suelo" la primera vez que la sección entra en pantalla
      const startRise = () => {
        if (risenRef.current) return
        risenRef.current = true
        rise(0, 1300)
      }
      if (typeof IntersectionObserver === 'undefined') {
        startRise()
      } else {
        const io = new IntersectionObserver((entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            startRise()
            io.disconnect()
          }
        }, { threshold: 0.35 })
        io.observe(box)
        ioRef.current = io
      }
    })
    return () => {
      ioRef.current?.disconnect()
      cancelAnimationFrame(rafRef.current)
      ro.disconnect()
      readyRef.current = false
      map.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city, features])

  // Conteo de celdas visibles (para el panel y como comprobación en pruebas).
  const visible = useMemo(() => {
    if (!features || !city) return null
    const pk = prop(scenario)
    const y = city.years[yearIdx] ?? 0
    let n = 0
    for (const f of features.features) {
      const p = f.properties
      if (p.k === 0 ? !onlyProjected : (pk === 'y' ? p.y : p.yb) <= y) n++
    }
    return n
  }, [features, city, scenario, yearIdx, onlyProjected])

  useEffect(() => {
    live.current = { yearIdx, onlyProjected, scenario, exag }
    const map = mapRef.current
    if (map && readyRef.current) applyState(map)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yearIdx, onlyProjected, scenario, exag, city, features])

  // Giro automático opcional (se detiene al desmontar o al desactivarlo).
  useEffect(() => {
    if (!rotating) return
    const id = window.setInterval(() => {
      const map = mapRef.current
      if (map && readyRef.current) map.setBearing(map.getBearing() + 0.6)
    }, 40)
    return () => window.clearInterval(id)
  }, [rotating])

  useEffect(() => {
    if (!playing || !city) return
    const id = window.setInterval(() => {
      setYearIdx((i) => {
        if (i >= city.years.length - 1) {
          setPlaying(false)
          return i
        }
        return i + 1
      })
    }, 1100)
    return () => window.clearInterval(id)
  }, [playing, city])

  if (error) return <p className="error" role="alert">{T.error}</p>
  if (!city) return <p className="muted">{T.loading}</p>

  const key = String(year)
  const areaI = city.stats.built_km2
  const areaP = city.stats.built_km2_population_only ?? city.stats.built_km2
  const area = scenario === 'integrated' ? areaI : areaP
  const km2 = area[key]
  const base = area[String(city.base_year)]
  const last = String(years[years.length - 1])
  const pct = km2 !== undefined && base ? (km2 / base - 1) * 100 : 0
  const pctText = `${pct >= 0 ? '+' : '−'}${fmtNum(Math.abs(pct), lang, 2)} %`
  const urb = city.stats.urban_population_million?.[key]
  const v = city.validation
  const times = v.baseline_random ? v.figure_of_merit / v.baseline_random : 0
  const vsNear = v.baseline_proximity ? v.figure_of_merit / v.baseline_proximity : 0
  const cityShort = city.name.split(',')[0]

  // Crecimiento vertical: lo existente gana altura (solo en el escenario integrado); 'Solo población' crece en horizontal.
  const vert = city.vertical
  const integrated = scenario === 'integrated'
  const baseKey = String(city.base_year)
  const hExist = vert ? (integrated ? vert.mean_height_existing_m[key] : vert.mean_height_existing_m[baseKey]) : undefined
  const hExist0 = vert?.mean_height_existing_m[baseKey]
  const hMax = vert ? (integrated ? vert.max_height_m[key] : vert.max_height_m[baseKey]) : undefined
  const volume = vert ? (integrated ? vert.volume_million_m3[key] : vert.volume_million_m3_population_only[key]) : undefined
  const volVert = vert && integrated ? vert.volume_from_vertical_million_m3[key] ?? 0 : 0
  const dH = hExist !== undefined && hExist0 ? hExist - hExist0 : 0
  const dHtext = `${dH >= 0 ? '+' : '−'}${fmtNum(Math.abs(dH), lang, 3)} m`

  const drivers = city.drivers
  const rows = drivers ? Object.keys(drivers.table).sort() : []
  type Row = { year: string } & DriverRow
  const tableRows: Row[] = drivers ? rows.map((y) => ({ year: y, ...drivers.table[y] })) : []
  const f1 = (n: number, d = 3) => fmtNum(n, lang, d)
  const cols: Column<Row>[] = [
    { id: 'y', header: T.colYear, cell: (r) => r.year, csv: (r) => r.year },
    { id: 'u', header: T.colUrbanPop, align: 'right', cell: (r) => f1(r.urban_population_million), csv: (r) => r.urban_population_million },
    { id: 'g', header: T.colGdp, align: 'right', cell: (r) => f1(r.gdp_per_capita_usd, 4), csv: (r) => r.gdp_per_capita_usd },
    { id: 'a', header: T.colAgr, align: 'right', cell: (r) => f1(r.agricultural_employment_share * 100, 3), csv: (r) => r.agricultural_employment_share * 100 },
    { id: 'c', header: T.colClimate, align: 'right', cell: (r) => f1(r.climate_stress, 2), csv: (r) => r.climate_stress },
    { id: 'p', header: T.colPush, align: 'right', cell: (r) => f1(r.migration_push_multiplier, 3), csv: (r) => r.migration_push_multiplier },
    { id: 'k', header: T.colBuilt, align: 'right', cell: (r) => f1(r.built_km2_integrated, 4), csv: (r) => r.built_km2_integrated },
    { id: 'kp', header: T.colBuiltPop, align: 'right', cell: (r) => f1(r.built_km2_population_only, 4), csv: (r) => r.built_km2_population_only },
  ]
  const lastRow = drivers ? drivers.table[rows[rows.length - 1]] : null
  const noStress = !lastRow || lastRow.climate_stress === 0

  // Tabla "Qué pasaría si": estrés climático × empuje migratorio, y elasticidad del ingreso.
  const sens = drivers?.sensitivity_built_km2_2050 ?? {}
  const stresses = ['0.0', '0.5', '1.0']
  const kappas = ['0.25', '0.5', '1.0']
  type SRow = { s: string; vals: (number | undefined)[] }
  const sensRows: SRow[] = stresses.map((s) => ({ s, vals: kappas.map((k) => sensValue(sens, `stress_2050=${s},kappa=${k}`)) }))
  const sensCols: Column<SRow>[] = [
    { id: 's', header: T.sensStress, cell: (r) => fmtNum(Number(r.s), lang, 2) },
    ...kappas.map((k, i): Column<SRow> => ({
      id: `k${k}`,
      header: `${T.sensPush} ${fmtNum(Number(k), lang, 2)}`,
      align: 'right',
      cell: (r) => (r.vals[i] === undefined ? '—' : `${fmtNum(r.vals[i] as number, lang, 4)} km²`),
    })),
  ]
  type GRow = { g: string; val: number | undefined; used: boolean }
  const gammaUsed = Number(drivers?.assumptions?.gamma ?? 0.2)
  const gammas = ['0.0', '0.2', '0.4']
  const gammaRows: GRow[] = gammas.map((g) => ({ g, val: sensValue(sens, `gamma=${g},stress_2050=0`), used: Math.abs(Number(g) - gammaUsed) < 1e-9 }))
  const gammaCols: Column<GRow>[] = [
    { id: 'g', header: T.sensIncome, cell: (r) => fmtNum(Number(r.g), lang, 2) + (r.used ? ` · ${T.sensCurrent}` : '') },
    { id: 'v', header: `km² ${years[years.length - 1]}`, align: 'right', cell: (r) => (r.val === undefined ? '—' : `${fmtNum(r.val, lang, 4)} km²`) },
  ]

  // Efecto vertical por año: m(t) = (PIB(t)/PIB(base))^θ, altura media de lo existente y volumen.
  type VRow = { year: string; gdp: number | undefined; m: number | undefined; h: number | undefined; vol: number | undefined; volv: number | undefined }
  const vertRows: VRow[] = vert
    ? years.map((y) => {
        const k = String(y)
        return {
          year: k, gdp: drivers?.table[k]?.gdp_per_capita_usd, m: vert.multiplier[k],
          h: vert.mean_height_existing_m[k], vol: vert.volume_million_m3[k], volv: vert.volume_from_vertical_million_m3[k],
        }
      })
    : []
  const vertCols: Column<VRow>[] = [
    { id: 'y', header: T.colYear, cell: (r) => r.year, csv: (r) => r.year },
    { id: 'g', header: T.colGdp, align: 'right', cell: (r) => (r.gdp === undefined ? '—' : f1(r.gdp, 4)), csv: (r) => r.gdp ?? '' },
    { id: 'm', header: T.colMult, align: 'right', cell: (r) => (r.m === undefined ? '—' : f1(r.m, 3)), csv: (r) => r.m ?? '' },
    { id: 'h', header: T.colHeightExisting, align: 'right', cell: (r) => (r.h === undefined ? '—' : f1(r.h, 3)), csv: (r) => r.h ?? '' },
    { id: 'v', header: T.colVolume, align: 'right', cell: (r) => (r.vol === undefined ? '—' : f1(r.vol, 4)), csv: (r) => r.vol ?? '' },
    { id: 'vv', header: T.colVolumeVertical, align: 'right', cell: (r) => (r.volv === undefined ? '—' : f1(r.volv, 3)), csv: (r) => r.volv ?? '' },
  ]
  // Sensibilidad vertical: volumen en el último año según la elasticidad θ.
  type TRow = { th: string; val: number | undefined; used: boolean }
  const thetaUsed = vert?.theta ?? 0.5
  const thetaRows: TRow[] = ['0.0', '0.5', '1.0'].map((t) => ({
    th: t, val: vert?.sensitivity_volume_2050_million_m3?.[`theta=${t}`], used: Math.abs(Number(t) - thetaUsed) < 1e-9,
  }))
  const thetaCols: Column<TRow>[] = [
    { id: 't', header: T.sensTheta, cell: (r) => fmtNum(Number(r.th), lang, 2) + (r.used ? ` · ${T.sensCurrent}` : '') },
    { id: 'v', header: `${T.kpiVolume} ${years[years.length - 1]} (${T.kpiVolumeUnit})`, align: 'right', cell: (r) => (r.val === undefined ? '—' : fmtNum(r.val, lang, 4)) },
  ]

  return (
    <section className="city3d" aria-label={T.title}>
      <div className="city3d-head">
        <h3 className="city3d-title">{T.title} · {city.name}</h3>
        <span className="city3d-badge">{T.badge}</span>
      </div>
      <p className="muted small city3d-intro">{T.intro}</p>

      {hasBase && (
        <div className="scen" role="group" aria-label={T.scenarioAria}>
          <button
            type="button" role="switch" className={`scen-switch${scenario === 'population_only' ? ' right' : ''}`}
            aria-checked={scenario === 'population_only'} aria-label={T.scenarioAria}
            onClick={() => setScenario((s) => (s === 'integrated' ? 'population_only' : 'integrated'))}
          >
            <span className="scen-thumb" aria-hidden="true" />
            <span className={`scen-opt${scenario === 'integrated' ? ' on' : ''}`}>
              <b>{T.scenIntegrated}</b>
              <small>{areaI[last] !== undefined ? T.scenIn2050(fmtNum(areaI[last], lang, 4)) : ''}</small>
            </span>
            <span className={`scen-opt${scenario === 'population_only' ? ' on' : ''}`}>
              <b>{T.scenPopulation}</b>
              <small>{areaP[last] !== undefined ? T.scenIn2050(fmtNum(areaP[last], lang, 4)) : ''}</small>
            </span>
          </button>
        </div>
      )}

      <div className="city3d-map-wrap">
        <div ref={wrapRef} className="city3d-map" role="img" aria-label={T.mapLabel} />
        <div className="city3d-legend" aria-hidden="true">
          <span><i className="sw sw-base" />{T.legendBase} {city.base_year}</span>
          <span><i className="sw sw-proj" />{T.legendHorizontal}</span>
          <span><i className="sw sw-pulse" />{T.legendPulse}</span>
          {vert && integrated && <span><i className="sw sw-vert" />{T.legendVertical}</span>}
        </div>
        <div className="city3d-hbar" aria-hidden="true">
          <span className="city3d-hbar-title">{T.legendHeight}</span>
          <span className="city3d-hbar-row">
            <b className="num">{HEIGHT_STOPS[0][0]} m</b>
            <i className="bar" style={{ background: `linear-gradient(90deg, ${HEIGHT_STOPS.map(([h, c]) => `${c} ${Math.round(((h - HEIGHT_STOPS[0][0]) / (HEIGHT_STOPS[HEIGHT_STOPS.length - 1][0] - HEIGHT_STOPS[0][0])) * 100)}%`).join(', ')})` }} />
            <b className="num">{HEIGHT_STOPS[HEIGHT_STOPS.length - 1][0]}+ m</b>
          </span>
        </div>
      </div>

      <div className="city3d-view">
        <label className="city3d-exag">
          <span>{T.exagLabel}: <b className="num">{exag}×</b></span>
          <input type="range" min={1} max={12} step={1} value={exag} aria-label={T.exagLabel}
            aria-valuetext={`${exag}×`} onChange={(e) => setExag(Number(e.target.value))} />
        </label>
        <Button variant="secondary" aria-pressed={rotating} onClick={() => setRotating((r) => !r)}>
          {rotating ? T.rotateStop : T.rotate}
        </Button>
        <p className="muted small city3d-exag-note">{T.exagNote}</p>
      </div>

      <div className="city3d-controls">
        <Button
          variant="secondary" className="city3d-play" aria-pressed={playing}
          onClick={() => {
            if (!playing && yearIdx >= years.length - 1) setYearIdx(0)
            if (!playing) rise(0, 1200) // las alturas vuelven a crecer desde el suelo al reproducir
            setPlaying((p) => !p)
          }}
        >
          {playing ? T.pause : T.play}
        </Button>
        <div className="city3d-slider">
          <input
            type="range" min={0} max={years.length - 1} step={1} value={yearIdx}
            aria-label={T.yearAria} aria-valuetext={String(year)}
            onChange={(e) => { setPlaying(false); setYearIdx(Number(e.target.value)) }}
          />
          <div className="city3d-ticks" aria-hidden="true">
            {years.map((y, i) => (
              <button type="button" key={y} tabIndex={-1} className={i === yearIdx ? 'on' : ''}
                onClick={() => { setPlaying(false); setYearIdx(i) }}>{y}</button>
            ))}
          </div>
        </div>
        <div className="city3d-only">
          <Switch checked={onlyProjected} onChange={setOnlyProjected}>{T.onlyProjected}</Switch>
        </div>
      </div>

      <div className="kpi-grid city3d-kpis">
        <Kpi label={T.built} value={km2 !== undefined ? `${fmtNum(km2, lang, 4)} km²` : '—'} num>
          <em className="muted small">{year === city.base_year ? `${T.year} ${year}` : `${pctText} ${T.change} ${city.base_year}`}</em>
        </Kpi>
        {urb !== undefined && (
          <Kpi label={T.urbanPop} value={`${fmtNum(urb, lang, 3)} ${T.urbanPopUnit}`} num>
            <em className="muted small">{T.year} {year}</em>
          </Kpi>
        )}
        {vert && hExist !== undefined && (
          <Kpi label={T.kpiHeight} value={`${fmtNum(hExist, lang, 3)} m`} num>
            <em className="muted small">{year === city.base_year || !integrated ? T.kpiHeightBase(city.base_year) : `${dHtext} ${T.change} ${city.base_year}`}</em>
          </Kpi>
        )}
        {vert && hMax !== undefined && (
          <Kpi label={T.kpiMax} value={`${fmtNum(hMax, lang, 3)} m`} num>
            <em className="muted small">{T.kpiMaxNote}</em>
          </Kpi>
        )}
        {vert && volume !== undefined && (
          <Kpi label={T.kpiVolume} value={`${fmtNum(volume, lang, 4)} ${T.kpiVolumeUnit}`} num>
            <em className="muted small">{integrated ? T.kpiVolumeVertical(fmtNum(volVert, lang, 3)) : T.kpiVolumeHorizontal}</em>
          </Kpi>
        )}
        <Kpi label={T.year} value={year} num>
          <em className="muted small">
            {visible !== null ? `${visible.toLocaleString(lang === 'es' ? 'es' : 'en-US')} ${lang === 'es' ? 'celdas visibles' : 'visible cells'}` : ''}
          </em>
        </Kpi>
      </div>
      {vert && <p className="muted small city3d-heights-note">{T.heightsNote}</p>}
      <p className="sr-only" aria-live="polite">{km2 !== undefined ? T.summary(year, fmtNum(km2, lang, 4), pctText, city.base_year) : ''}</p>

      {drivers && (
        <Disclosure title={T.driversTitle} className="city3d-how city3d-drivers">
          <h4 className="stat-sub-title">{T.driversTable}</h4>
          <DataTable
            columns={cols} rows={tableRows} rowKey={(r) => r.year} ariaLabel={T.driversTable}
            csvName={`ciudad-${city.id}-variables`} csvLabel={lang === 'es' ? 'Descargar CSV' : 'Download CSV'}
          />
          {vert && (
            <>
              <h4 className="stat-sub-title">{T.verticalTitle}</h4>
              <p className="small muted">{T.verticalNote(fmtNum(vert.theta, lang, 2))}</p>
              <DataTable
                columns={vertCols} rows={vertRows} rowKey={(r) => r.year} ariaLabel={T.verticalTitle}
                csvName={`ciudad-${city.id}-vertical`} csvLabel={lang === 'es' ? 'Descargar CSV' : 'Download CSV'}
              />
            </>
          )}
          <h4 className="stat-sub-title">{T.climateTitle}</h4>
          <ul className="small city3d-climate">
            {Object.entries(drivers.climate).map(([k, c]) => (
              <li key={k}>
                {T.climateItem(
                  c.label,
                  verdictLabel(c.full_period.verdict, lang),
                  verdictLabel(c.verdict, lang),
                  c.used_period_start,
                  fmtNum(c.weight, lang, 2),
                  c.break_detected && c.break_year ? T.climateBreak(c.break_year) : T.climateNoBreak,
                )}
              </li>
            ))}
          </ul>
          <p className="small">
            {T.driversNotice} {noStress ? T.driversNoStress(cityShort) : T.driversStress(cityShort)}
          </p>
          <h4 className="stat-sub-title">{T.sensTitle}</h4>
          <p className="small muted">{T.sensNote}</p>
          <DataTable columns={sensCols} rows={sensRows} rowKey={(r) => r.s} ariaLabel={`${T.sensTitle}: ${T.sensStress}`} />
          <DataTable columns={gammaCols} rows={gammaRows} rowKey={(r) => r.g} ariaLabel={`${T.sensTitle}: ${T.sensIncome}`} />
          {vert && <DataTable columns={thetaCols} rows={thetaRows} rowKey={(r) => r.th} ariaLabel={`${T.sensTitle}: ${T.sensTheta}`} />}
        </Disclosure>
      )}

      <Disclosure title={T.how} className="city3d-how">
        <h4 className="stat-sub-title">{T.methodTitle}</h4>
        <p className="small">{T.method}</p>
        {vert && <p className="small">{T.methodVertical(vert.height_year)}</p>}
        <h4 className="stat-sub-title">{T.reliabilityTitle}</h4>
        <p className="small">
          {T.reliability(v.fit, v.test, fmtNum(v.auc, lang, 3), fmtNum(times, lang, 2), fmtNum(vsNear, lang, 2))}
        </p>
        <h4 className="stat-sub-title">{T.caveatsTitle}</h4>
        <ul className="small">{T.caveats.map((c) => <li key={c}>{c}</li>)}</ul>
        <h4 className="stat-sub-title">{T.sources}</h4>
        <ul className="small">{city.sources.map((s) => <li key={s}>{s}</li>)}</ul>
      </Disclosure>
    </section>
  )
}
