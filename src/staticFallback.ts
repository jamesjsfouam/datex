import type {
  AskResponse,
  Catalog,
  DemographyResponse,
  EarthForecastResponse,
  Location,
  Place,
  RegionTrend,
  RelateResponse,
  SatelliteImage,
  ScanResponse,
  Trend,
  TrendResponse,
  Variable,
} from './api'

interface StaticBundle {
  generated_start: number
  recommend: Record<string, { concern: string; place_type: string | null; variables: Variable[] }>
  compare: Record<string, RegionTrend[]>
  scan: Record<string, ScanResponse>
  trend: Record<string, TrendResponse>
  forecast: Record<string, EarthForecastResponse['forecast']>
  locate: Record<string, Location>
  demography: Record<string, DemographyResponse>
  relate: Record<string, RelateResponse>
}

interface GlobePayload {
  generated: string
  period: string
  cell_deg: number
  source: string
  fdr_q: number
  fields: string[]
  variables: Record<string, { label: string; unit: string }>
  cells: number[][]
}

const ISO2_TO_ISO3: Record<string, string> = {
  AW: 'ABW', AF: 'AFG', AO: 'AGO', AI: 'AIA', AX: 'ALA', AL: 'ALB', AD: 'AND', AE: 'ARE', AR: 'ARG', AM: 'ARM',
  AS: 'ASM', AQ: 'ATA', TF: 'ATF', AG: 'ATG', AU: 'AUS', AT: 'AUT', AZ: 'AZE', BI: 'BDI', BE: 'BEL', BJ: 'BEN',
  BQ: 'BES', BF: 'BFA', BD: 'BGD', BG: 'BGR', BH: 'BHR', BS: 'BHS', BA: 'BIH', BL: 'BLM', BY: 'BLR', BZ: 'BLZ',
  BM: 'BMU', BO: 'BOL', BR: 'BRA', BB: 'BRB', BN: 'BRN', BT: 'BTN', BV: 'BVT', BW: 'BWA', CF: 'CAF', CA: 'CAN',
  CC: 'CCK', CH: 'CHE', CL: 'CHL', CN: 'CHN', CI: 'CIV', CM: 'CMR', CD: 'COD', CG: 'COG', CK: 'COK', CO: 'COL',
  KM: 'COM', CV: 'CPV', CR: 'CRI', CU: 'CUB', CW: 'CUW', CX: 'CXR', KY: 'CYM', CY: 'CYP', CZ: 'CZE', DE: 'DEU',
  DJ: 'DJI', DM: 'DMA', DK: 'DNK', DO: 'DOM', DZ: 'DZA', EC: 'ECU', EG: 'EGY', ER: 'ERI', EH: 'ESH', ES: 'ESP',
  EE: 'EST', ET: 'ETH', FI: 'FIN', FJ: 'FJI', FK: 'FLK', FR: 'FRA', FO: 'FRO', FM: 'FSM', GA: 'GAB', GB: 'GBR',
  GE: 'GEO', GG: 'GGY', GH: 'GHA', GI: 'GIB', GN: 'GIN', GP: 'GLP', GM: 'GMB', GW: 'GNB', GQ: 'GNQ', GR: 'GRC',
  GD: 'GRD', GL: 'GRL', GT: 'GTM', GF: 'GUF', GU: 'GUM', GY: 'GUY', HK: 'HKG', HM: 'HMD', HN: 'HND', HR: 'HRV',
  HT: 'HTI', HU: 'HUN', ID: 'IDN', IM: 'IMN', IN: 'IND', IO: 'IOT', IE: 'IRL', IR: 'IRN', IQ: 'IRQ', IS: 'ISL',
  IL: 'ISR', IT: 'ITA', JM: 'JAM', JE: 'JEY', JO: 'JOR', JP: 'JPN', KZ: 'KAZ', KE: 'KEN', KG: 'KGZ', KH: 'KHM',
  KI: 'KIR', KN: 'KNA', KR: 'KOR', KW: 'KWT', LA: 'LAO', LB: 'LBN', LR: 'LBR', LY: 'LBY', LC: 'LCA', LI: 'LIE',
  LK: 'LKA', LS: 'LSO', LT: 'LTU', LU: 'LUX', LV: 'LVA', MO: 'MAC', MF: 'MAF', MA: 'MAR', MC: 'MCO', MD: 'MDA',
  MG: 'MDG', MV: 'MDV', MX: 'MEX', MH: 'MHL', MK: 'MKD', ML: 'MLI', MT: 'MLT', MM: 'MMR', ME: 'MNE', MN: 'MNG',
  MP: 'MNP', MZ: 'MOZ', MR: 'MRT', MS: 'MSR', MQ: 'MTQ', MU: 'MUS', MW: 'MWI', MY: 'MYS', YT: 'MYT', NA: 'NAM',
  NC: 'NCL', NE: 'NER', NF: 'NFK', NG: 'NGA', NI: 'NIC', NU: 'NIU', NL: 'NLD', NO: 'NOR', NP: 'NPL', NR: 'NRU',
  NZ: 'NZL', OM: 'OMN', PK: 'PAK', PA: 'PAN', PN: 'PCN', PE: 'PER', PH: 'PHL', PW: 'PLW', PG: 'PNG', PL: 'POL',
  PR: 'PRI', KP: 'PRK', PT: 'PRT', PY: 'PRY', PS: 'PSE', PF: 'PYF', QA: 'QAT', RE: 'REU', RO: 'ROU', RU: 'RUS',
  RW: 'RWA', SA: 'SAU', SD: 'SDN', SN: 'SEN', SG: 'SGP', GS: 'SGS', SH: 'SHN', SJ: 'SJM', SB: 'SLB', SL: 'SLE',
  SV: 'SLV', SM: 'SMR', SO: 'SOM', PM: 'SPM', RS: 'SRB', SS: 'SSD', ST: 'STP', SR: 'SUR', SK: 'SVK', SI: 'SVN',
  SE: 'SWE', SZ: 'SWZ', SX: 'SXM', SC: 'SYC', SY: 'SYR', TC: 'TCA', TD: 'TCD', TG: 'TGO', TH: 'THA', TJ: 'TJK',
  TK: 'TKL', TM: 'TKM', TL: 'TLS', TO: 'TON', TT: 'TTO', TN: 'TUN', TR: 'TUR', TV: 'TUV', TW: 'TWN', TZ: 'TZA',
  UG: 'UGA', UA: 'UKR', UM: 'UMI', UY: 'URY', US: 'USA', UZ: 'UZB', VA: 'VAT', VC: 'VCT', VE: 'VEN', VG: 'VGB',
  VI: 'VIR', VN: 'VNM', VU: 'VUT', WF: 'WLF', WS: 'WSM', YE: 'YEM', ZA: 'ZAF', ZM: 'ZMB', ZW: 'ZWE',
}

let catalogPromise: Promise<Catalog> | null = null
let globePromise: Promise<GlobePayload> | null = null
let bundlePromise: Promise<StaticBundle> | null = null
const powerCache = new Map<string, Record<string, number>>()
const wbCache = new Map<string, Record<number, number>>()

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`HTTP ${res.status} al cargar ${url}`)
  return (await res.json()) as T
}

function loadCatalog(signal?: AbortSignal): Promise<Catalog> {
  if (!catalogPromise) catalogPromise = fetchJson<Catalog>('./static-api/catalog.json', signal)
  return catalogPromise
}

function loadGlobe(signal?: AbortSignal): Promise<GlobePayload> {
  if (!globePromise) globePromise = fetchJson<GlobePayload>('./static-api/globe.json', signal)
  return globePromise
}

function loadBundle(signal?: AbortSignal): Promise<StaticBundle> {
  if (!bundlePromise) bundlePromise = fetchJson<StaticBundle>('./static-api/bundle.json', signal)
  return bundlePromise
}

function coordKey(lat: number, lon: number): string {
  const rlat = (Math.round(lat * 100) / 100).toFixed(2)
  const rlon = (Math.round(lon * 100) / 100).toFixed(2)
  return `${rlat},${rlon}`
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

function matchSampleRegionKey(lat: number, lon: number, catalog: Catalog, maxKm = 28): string | null {
  let bestKey: string | null = null
  let bestDist = maxKm
  for (const r of catalog.regions) {
    const d = haversineKm(lat, lon, r.lat, r.lon)
    if (d <= bestDist) {
      bestDist = d
      bestKey = coordKey(r.lat, r.lon)
    }
  }
  return bestKey
}

function normalCdf(x: number): number {
  const sign = x < 0 ? -1 : 1
  const ax = Math.abs(x) / Math.SQRT2
  const t = 1 / (1 + 0.3275911 * ax)
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) *
      Math.exp(-ax * ax)
  return 0.5 * (1 + sign * y)
}

function twoSidedNormalP(z: number): number {
  return Math.min(1, Math.max(1e-12, 2 * (1 - normalCdf(Math.abs(z)))))
}

function twoSidedTP(t: number, df: number): number {
  if (df <= 1) return 1
  const at = Math.abs(t)
  // no hay tabla t en el navegador, así que tiramos de Peizer-Pratt para pasar de t a z; va fino desde df 3
  const z =
    df > 200
      ? at
      : Math.sqrt(Math.max(0, (df - 0.5) * Math.log(1 + (at * at) / Math.max(1, df - 0.5)))) *
        (1 - 1 / (4 * df))
  return twoSidedNormalP(z)
}

function median(values: number[]): number {
  if (!values.length) return 0
  const s = [...values].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m]
}

function pearsonR(xs: number[], ys: number[]): number {
  const n = xs.length
  if (n < 3) return 0
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let num = 0
  let dx2 = 0
  let dy2 = 0
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx
    const dy = ys[i] - my
    num += dx * dy
    dx2 += dx * dx
    dy2 += dy * dy
  }
  const denom = Math.sqrt(dx2 * dy2)
  return denom > 0 ? Math.max(-1, Math.min(1, num / denom)) : 0
}

function spearmanRho(xs: number[], ys: number[]): number {
  const rank = (arr: number[]): number[] => {
    const idx = arr.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0])
    const out = new Array<number>(arr.length)
    let i = 0
    while (i < idx.length) {
      let j = i
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++
      const r = (i + j) / 2 + 1
      for (let k = i; k <= j; k++) out[idx[k][1]] = r
      i = j + 1
    }
    return out
  }
  return pearsonR(rank(xs), rank(ys))
}

function lag1BiasCorrected(res: number[]): number {
  const n = res.length
  if (n < 5) return 0
  const r = pearsonR(res.slice(0, -1), res.slice(1))
  const corrected = (n * r + 1) / Math.max(1, n - 3)
  return Math.max(-0.92, Math.min(0.92, corrected))
}

function olsStats(xs: number[], ys: number[]): { slope: number; intercept: number; p: number; ciLow: number; ciHigh: number; nEff: number; lag1: number; resSd: number } {
  const n = xs.length
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let sxx = 0
  let sxy = 0
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) ** 2
    sxy += (xs[i] - mx) * (ys[i] - my)
  }
  const slope = sxx > 0 ? sxy / sxx : 0
  const intercept = my - slope * mx
  const res = ys.map((y, i) => y - (intercept + slope * xs[i]))
  const sse = res.reduce((acc, r) => acc + r * r, 0)
  const lag1 = lag1BiasCorrected(res)
  const r1pos = Math.max(0, lag1)
  const nEff = Math.max(3, Math.min(n, n * ((1 - r1pos) / Math.max(0.05, 1 + r1pos))))
  const df = Math.max(1, nEff - 2)
  const s2 = sse / Math.max(1, n - 2)
  const se = sxx > 0 ? Math.sqrt((s2 * (n / nEff)) / sxx) : 0
  const tStat = se > 0 ? slope / se : 0
  const p = twoSidedTP(tStat, df)
  const half = 1.96 * se
  return {
    slope,
    intercept,
    p,
    ciLow: (slope - half) * 10,
    ciHigh: (slope + half) * 10,
    nEff,
    lag1,
    resSd: Math.sqrt(s2),
  }
}

function mannKendallPrewhitened(xs: number[], ys: number[], slopePerYear: number): { tau: number; p: number } {
  const n = ys.length
  if (n < 5) return { tau: 0, p: 1 }
  const x0 = xs[0]
  const detrended = ys.map((y, i) => y - slopePerYear * (xs[i] - x0))
  const r1 = lag1BiasCorrected(detrended)
  const series =
    Math.abs(r1) >= 0.05
      ? detrended.slice(1).map((v, i) => v - r1 * detrended[i] + slopePerYear * (xs[i + 1] - x0))
      : ys
  const m = series.length
  let s = 0
  for (let i = 0; i < m - 1; i++) {
    for (let j = i + 1; j < m; j++) {
      const diff = series[j] - series[i]
      if (diff > 0) s++
      else if (diff < 0) s--
    }
  }
  const denom = (m * (m - 1)) / 2
  const tau = denom > 0 ? s / denom : 0
  const varS = (m * (m - 1) * (2 * m + 5)) / 18
  const z = varS > 0 ? (s - Math.sign(s)) / Math.sqrt(varS) : 0
  return { tau, p: twoSidedNormalP(z) }
}

function pettittStepYear(xs: number[], ys: number[]): number | null {
  const n = ys.length
  if (n < 20) return null
  const ranks = new Array<number>(n).fill(0)
  for (let i = 0; i < n; i++) {
    let r = 1
    for (let j = 0; j < n; j++) {
      if (ys[j] < ys[i]) r++
      else if (ys[j] === ys[i] && j !== i) r += 0.5
    }
    ranks[i] = r
  }
  let maxU = 0
  let bestIdx = -1
  let cum = 0
  for (let t = 0; t < n - 1; t++) {
    cum += ranks[t]
    const u = Math.abs(2 * cum - (t + 1) * (n + 1))
    if (u > maxU) {
      maxU = u
      bestIdx = t
    }
  }
  const p = 2 * Math.exp((-6 * maxU * maxU) / (n ** 3 + n ** 2))
  return p < 0.05 && bestIdx > 0 && bestIdx < n - 1 ? xs[bestIdx + 1] : null
}

function theilSenAndCi(xs: number[], ys: number[]): { slope: number; intercept: number; ciLowDec: number; ciHighDec: number } {
  const n = xs.length
  const slopes: number[] = []
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 1; j < n; j++) {
      if (xs[j] !== xs[i]) slopes.push((ys[j] - ys[i]) / (xs[j] - xs[i]))
    }
  }
  slopes.sort((a, b) => a - b)
  const slope = slopes.length ? median(slopes) : 0
  const intercept = median(ys.map((y, i) => y - slope * xs[i]))
  const N = slopes.length
  const varS = (n * (n - 1) * (2 * n + 5)) / 18
  const cAlpha = 1.96 * Math.sqrt(varS)
  const iLow = Math.max(0, Math.floor((N - cAlpha) / 2))
  const iHigh = Math.min(N - 1, Math.ceil((N + cAlpha) / 2) - 1)
  return {
    slope,
    intercept,
    ciLowDec: (slopes[iLow] ?? slope) * 10,
    ciHighDec: (slopes[iHigh] ?? slope) * 10,
  }
}

function fmtEs(n: number, dec = 2): string {
  return n.toFixed(dec).replace('.', ',')
}

function analyzeAnnualTrend(
  variable: string,
  label: string,
  unit: string,
  ratioScale: boolean,
  annual: { year: number; mean: number }[],
  monthly: { date: string; anomaly: number }[],
  pFactor = 1,
): Trend {
  const firstYear = annual[0]?.year ?? 0
  const lastYear = annual[annual.length - 1]?.year ?? 0
  const nYears = annual.length
  if (nYears < 5) {
    return {
      variable,
      label,
      unit,
      first_year: firstYear,
      last_year: lastYear,
      n_years: nYears,
      direction: 'flat',
      verdict: 'no_trend',
      significant: false,
      slope_per_decade: 0,
      ci_low_per_decade: 0,
      ci_high_per_decade: 0,
      total_change: 0,
      percent_change: null,
      ols_slope_per_decade: 0,
      ols_ci_low_per_decade: 0,
      ols_ci_high_per_decade: 0,
      ols_p: 1,
      n_effective: nYears,
      autocorrelation: 0,
      mk_tau: 0,
      mk_p: 1,
      methods_agree: true,
      years_needed: 30,
      period_sensitive: false,
      p_adjusted: null,
      step_year: null,
      warnings: [`Solo hay ${nYears} años válidos: se necesitan al menos 15 años para detectar tendencia.`],
      interpretation: 'Serie demasiado corta para evaluar una tendencia climática confiable.',
      series: { annual, monthly, trend_line: annual },
    }
  }

  const xs = annual.map((a) => a.year)
  const ys = annual.map((a) => a.mean)
  const sen = theilSenAndCi(xs, ys)
  const ols = olsStats(xs, ys)
  const mk = mannKendallPrewhitened(xs, ys, sen.slope)
  const stepYear = pettittStepYear(xs, ys)

  const slopeDec = sen.slope * 10
  const totalChange = sen.slope * (lastYear - firstYear)
  const startFitted = sen.intercept + sen.slope * firstYear
  const percentChange = ratioScale && Math.abs(startFitted) > 1e-6 ? (totalChange / Math.abs(startFitted)) * 100 : null

  const r1Pos = Math.max(0, ols.lag1)
  const yearsNeeded =
    Math.abs(sen.slope) > 1e-9
      ? Math.min(
          200,
          Math.max(
            15,
            Math.ceil(((3.3 * ols.resSd) / Math.abs(sen.slope)) * Math.sqrt((1 + r1Pos) / Math.max(0.05, 1 - r1Pos)) ** 0.5) ** (2 / 3),
          ),
        )
      : 120
  const correctedYearsNeeded =
    Math.abs(sen.slope) > 1e-9
      ? Math.min(
          200,
          Math.max(
            15,
            Math.ceil(
              ((3.3 * ols.resSd) / Math.abs(sen.slope) * Math.sqrt((1 + r1Pos) / Math.max(0.05, 1 - r1Pos))) ** (2 / 3),
            ),
          ),
        )
      : 120

  const mkSig = mk.p < 0.05
  const olsSig = ols.p < 0.05
  const methodsAgree = mkSig === olsSig && Math.sign(sen.slope || 0) === Math.sign(ols.slope || 0)
  const verdict: Trend['verdict'] = nYears < 15 ? 'no_trend' : mk.p < 0.05 ? 'significant' : mk.p < 0.2 ? 'not_yet' : 'no_trend'
  const direction = Math.abs(slopeDec) < 1e-6 ? 'flat' : slopeDec > 0 ? 'up' : 'down'
  const verb = direction === 'up' ? 'sube' : direction === 'down' ? 'baja' : 'cambia poco'

  const warnings: string[] = []
  if (nYears < 15) warnings.push(`Serie corta (${nYears} años): se recomienda al menos 15 años.`)
  if (stepYear !== null) {
    warnings.push(`Posible cambio brusco o salto hacia ${stepYear} (prueba de Pettitt p < 0,05).`)
  }
  if (!methodsAgree) {
    warnings.push('Mann-Kendall y regresión OLS discrepan en significancia o signo: interpreta con cautela.')
  }

  let interpretation = ''
  if (verdict === 'significant') {
    interpretation = `Tendencia confirmada: ${label.toLowerCase()} ${verb} ${fmtEs(slopeDec, 3)} ${unit} por década (IC 95 %: ${fmtEs(sen.ciLowDec, 3)} a ${fmtEs(sen.ciHighDec, 3)}) en ${firstYear}–${lastYear} (Mann-Kendall, p = ${fmtEs(mk.p, 4)}).`
  } else if (verdict === 'not_yet') {
    interpretation = `Tendencia todavía no significativa: ${label.toLowerCase()} ${verb} ${fmtEs(slopeDec, 3)} ${unit} por década (IC 95 %: ${fmtEs(sen.ciLowDec, 3)} a ${fmtEs(sen.ciHighDec, 3)}) en ${firstYear}–${lastYear}, pero con la variación natural aún no se puede afirmar (Mann-Kendall, p = ${fmtEs(mk.p, 4)}). Con este ritmo y ruido harían falta unos ${correctedYearsNeeded} años de datos (hay ${nYears}).`
  } else {
    interpretation = `Sin tendencia clara: ${label.toLowerCase()} varía alrededor de su promedio en ${firstYear}–${lastYear} (Mann-Kendall, p = ${fmtEs(mk.p, 4)}), sin cambio sostenido demostrable.`
  }

  const pAdj = pFactor > 1 ? Math.min(1, mk.p * pFactor) : null

  return {
    variable,
    label,
    unit,
    first_year: firstYear,
    last_year: lastYear,
    n_years: nYears,
    direction,
    verdict,
    significant: mkSig,
    slope_per_decade: slopeDec,
    ci_low_per_decade: sen.ciLowDec,
    ci_high_per_decade: sen.ciHighDec,
    total_change: totalChange,
    percent_change: percentChange,
    ols_slope_per_decade: ols.slope * 10,
    ols_ci_low_per_decade: ols.ciLow,
    ols_ci_high_per_decade: ols.ciHigh,
    ols_p: ols.p,
    n_effective: ols.nEff,
    autocorrelation: ols.lag1,
    mk_tau: mk.tau,
    mk_p: mk.p,
    methods_agree: methodsAgree,
    years_needed: Number.isFinite(yearsNeeded) ? correctedYearsNeeded : 120,
    period_sensitive: false,
    p_adjusted: pAdj,
    step_year: stepYear,
    warnings,
    interpretation,
    series: {
      annual,
      monthly,
      trend_line: xs.map((yr) => ({ year: yr, mean: sen.intercept + sen.slope * yr })),
    },
  }
}

function computeTrendFromPowerDict(
  variable: Variable,
  monthlyDict: Record<string, number>,
  startYear: number,
  lastYear = 2025,
): Trend {
  const byMonth = new Map<number, number[]>()
  const byYear = new Map<number, number[]>()
  const rawMonthly: { year: number; month: number; date: string; val: number }[] = []

  for (const [ym, val] of Object.entries(monthlyDict)) {
    if (!/^\d{6}$/.test(ym)) continue
    const y = Number(ym.slice(0, 4))
    const m = Number(ym.slice(4, 6))
    if (m < 1 || m > 12 || y < startYear || y > lastYear || val <= -900 || !Number.isFinite(val)) continue
    rawMonthly.push({ year: y, month: m, date: `${y}-${String(m).padStart(2, '0')}`, val })
    if (!byMonth.has(m)) byMonth.set(m, [])
    byMonth.get(m)!.push(val)
    if (!byYear.has(y)) byYear.set(y, [])
    byYear.get(y)!.push(val)
  }

  rawMonthly.sort((a, b) => (a.date < b.date ? -1 : 1))
  const clim = new Map<number, number>()
  for (let m = 1; m <= 12; m++) {
    const arr = byMonth.get(m) ?? []
    clim.set(m, arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0)
  }

  const annual = [...byYear.entries()]
    .filter(([, vals]) => vals.length >= 10)
    .sort((a, b) => a[0] - b[0])
    .map(([year, vals]) => ({ year, mean: vals.reduce((a, b) => a + b, 0) / vals.length }))

  const monthly = rawMonthly.map((item) => ({
    date: item.date,
    anomaly: item.val - (clim.get(item.month) ?? 0),
  }))

  return analyzeAnnualTrend(variable.key, variable.label, variable.unit, variable.ratio_scale, annual, monthly)
}

const DERIVED_DEPS: Record<string, string[]> = {
  DTR: ['T2M_MAX', 'T2M_MIN'],
  VPD: ['T2M', 'RH2M'],
  WBGT: ['T2M', 'RH2M'],
}

function derivePowerParams(ck: string) {
  const t2m = powerCache.get(`T2M|${ck}`)
  const tmax = powerCache.get(`T2M_MAX|${ck}`)
  const tmin = powerCache.get(`T2M_MIN|${ck}`)
  const rh = powerCache.get(`RH2M|${ck}`)

  if (tmax && tmin && !powerCache.has(`DTR|${ck}`)) {
    const dtr: Record<string, number> = {}
    for (const k of Object.keys(tmax)) {
      if (tmin[k] !== undefined) dtr[k] = Number((tmax[k] - tmin[k]).toFixed(4))
    }
    if (Object.keys(dtr).length) powerCache.set(`DTR|${ck}`, dtr)
  }

  if (t2m && rh && (!powerCache.has(`VPD|${ck}`) || !powerCache.has(`WBGT|${ck}`))) {
    const vpd: Record<string, number> = {}
    const wbgt: Record<string, number> = {}
    for (const k of Object.keys(t2m)) {
      if (rh[k] === undefined) continue
      const t = t2m[k]
      const esKpa = 0.6108 * Math.exp((17.27 * t) / (t + 237.3))
      const eaKpa = (esKpa * Math.max(0, Math.min(100, rh[k]))) / 100
      vpd[k] = Number(Math.max(0, esKpa - eaKpa).toFixed(4))
      wbgt[k] = Number((0.567 * t + 0.393 * (eaKpa * 10) + 3.94).toFixed(4))
    }
    if (Object.keys(vpd).length) powerCache.set(`VPD|${ck}`, vpd)
    if (Object.keys(wbgt).length) powerCache.set(`WBGT|${ck}`, wbgt)
  }
}

async function fetchPowerParams(lat: number, lon: number, paramKeys: string[], signal?: AbortSignal): Promise<Record<string, Record<string, number>>> {
  const ck = coordKey(lat, lon)
  const neededBase = new Set<string>()
  for (const k of paramKeys) {
    if (DERIVED_DEPS[k]) {
      if (!powerCache.has(`${k}|${ck}`)) {
        for (const dep of DERIVED_DEPS[k]) neededBase.add(dep)
      }
    } else {
      neededBase.add(k)
    }
  }
  const missing = [...neededBase].filter((k) => !powerCache.has(`${k}|${ck}`))
  if (missing.length > 0) {
    const url =
      `https://power.larc.nasa.gov/api/temporal/monthly/point?parameters=${encodeURIComponent(missing.join(','))}` +
      `&community=AG&latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&start=1981&end=2025&format=JSON`
    const res = await fetch(url, { signal })
    if (!res.ok) throw new Error(`NASA POWER respondió HTTP ${res.status}`)
    const data = (await res.json()) as { properties?: { parameter?: Record<string, Record<string, number>> } }
    const params = data.properties?.parameter ?? {}
    for (const k of missing) {
      if (params[k]) powerCache.set(`${k}|${ck}`, params[k])
    }
  }
  derivePowerParams(ck)
  const out: Record<string, Record<string, number>> = {}
  for (const k of paramKeys) {
    const cached = powerCache.get(`${k}|${ck}`)
    if (cached) out[k] = cached
  }
  return out
}

function buildEarthForecast(trend: Trend, toYear: number): EarthForecastResponse['forecast'] {
  const annual = trend.series?.annual ?? []
  const n = annual.length
  const baseFirst = trend.first_year
  const baseLast = trend.last_year
  const slopeYear = trend.ols_slope_per_decade / 10
  const xs = annual.map((a) => a.year)
  const ys = annual.map((a) => a.mean)
  const mx = n ? xs.reduce((a, b) => a + b, 0) / n : baseLast
  const my = n ? ys.reduce((a, b) => a + b, 0) / n : 0
  const intercept = my - slopeYear * mx
  let sxx = 0
  let sse = 0
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) ** 2
    const err = ys[i] - (intercept + slopeYear * xs[i])
    sse += err * err
  }
  const sd = Math.sqrt(sse / Math.max(1, n - 2))
  const nEff = Math.max(3, trend.n_effective)
  const points: EarthForecastResponse['forecast']['points'] = []
  for (let y = baseLast + 1; y <= toYear; y++) {
    const val = intercept + slopeYear * y
    const sePred = sd * Math.sqrt(1 + 1 / nEff + (sxx > 0 ? (y - mx) ** 2 / sxx : 0))
    const margin = 1.96 * sePred
    points.push({ year: y, value: val, low: val - margin, high: val + margin })
  }
  const target = points[points.length - 1]
  const warnings: string[] = []
  if (trend.autocorrelation > 0.25) {
    warnings.push('Los años consecutivos se parecen entre sí: el intervalo real probablemente es más ancho.')
  }
  const decRate = fmtEs(trend.ols_slope_per_decade, 3)
  const text = target
    ? `Si el ritmo de ${baseFirst}–${baseLast} continuara (${decRate} ${trend.unit} por década), en ${toYear} ${trend.label.toLowerCase()} rondaría ${fmtEs(target.value, 1)} ${trend.unit} (intervalo del 95 %: ${fmtEs(target.low, 1)} a ${fmtEs(target.high, 1)}). Es una extrapolación: supone que nada cambia en el ritmo actual.`
    : 'Serie insuficiente para extrapolar.'
  return {
    method: 'lineal',
    base_first_year: baseFirst,
    base_last_year: baseLast,
    n_points: points.length,
    to_year: toYear,
    slope_per_year: slopeYear,
    points,
    warnings,
    text,
  }
}

async function fetchWorldBankSeries(iso3: string, indicator: string, signal?: AbortSignal): Promise<Record<number, number>> {
  const key = `${iso3}|${indicator}`
  const cached = wbCache.get(key)
  if (cached) return cached
  const url = `https://api.worldbank.org/v2/country/${encodeURIComponent(iso3)}/indicator/${encodeURIComponent(indicator)}?format=json&per_page=100`
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`Banco Mundial respondió HTTP ${res.status}`)
  const payload = (await res.json()) as [unknown, Array<{ date: string; value: number | null }> | null]
  const rows = payload[1]
  if (!Array.isArray(rows)) throw new Error('Sin datos del Banco Mundial para este país/indicador')
  const series: Record<number, number> = {}
  for (const row of rows) {
    if (row.value !== null && Number.isFinite(row.value)) {
      series[Number(row.date)] = row.value
    }
  }
  wbCache.set(key, series)
  return series
}

function buildRelation(
  earthTrend: Trend,
  indMeta: Catalog['indicators'][number],
  wbSeries: Record<number, number>,
  lag = 0,
  excludeShock = false,
): RelateResponse['relation'] & { indicator_trend: Trend } {
  const wbPoints = Object.entries(wbSeries)
    .map(([yr, val]) => ({ year: Number(yr), mean: val }))
    .filter((p) => p.year >= earthTrend.first_year && p.year <= earthTrend.last_year + lag)
    .sort((a, b) => a.year - b.year)
  const indRatio = Boolean((indMeta as { ratio_scale?: boolean }).ratio_scale ?? true)
  const indTrend = analyzeAnnualTrend(indMeta.key, indMeta.label, indMeta.unit, indRatio, wbPoints, [])

  const earthMap = new Map((earthTrend.series?.annual ?? []).map((p) => [p.year + lag, p.mean]))
  const shockYears = new Set([2020, 2021])
  const overlap = wbPoints
    .filter((p) => earthMap.has(p.year))
    .map((p) => ({ year: p.year, earth: earthMap.get(p.year)!, indicator: p.mean }))
  const excludedYears = excludeShock ? overlap.filter((p) => shockYears.has(p.year)).map((p) => p.year) : []
  const common = excludeShock ? overlap.filter((p) => !shockYears.has(p.year)) : overlap

  if (common.length < 8) {
    throw new Error(`Solo hay ${common.length} años en común entre NASA POWER y Banco Mundial (se necesitan al menos 8).`)
  }

  const rawE = common.map((c) => c.earth)
  const rawI = common.map((c) => c.indicator)
  const rawR = pearsonR(rawE, rawI)
  const detE = common.slice(1).map((c, idx) => c.earth - common[idx].earth)
  const detI = common.slice(1).map((c, idx) => c.indicator - common[idx].indicator)
  const detR = pearsonR(detE, detI)
  const detRho = spearmanRho(detE, detI)

  const pFromR = (r: number, n: number): number => {
    if (n <= 3 || Math.abs(r) >= 0.9999) return Math.abs(r) >= 0.9999 ? 0 : 1
    const t = r * Math.sqrt((n - 2) / Math.max(1e-9, 1 - r * r))
    return twoSidedTP(t, n - 2)
  }

  const rawP = pFromR(rawR, common.length)
  const detP = pFromR(detR, detE.length)
  const detRhoP = pFromR(detRho, detE.length)
  const absDet = Math.abs(detR)
  const strength: RelateResponse['relation']['strength'] =
    detP < 0.05 && absDet >= 0.5 ? 'fuerte' : absDet >= 0.25 ? 'moderada' : 'débil'
  const trendDriven = Math.abs(rawR) >= 0.5 && rawP < 0.05 && detP >= 0.1
  const significant = detP < 0.05

  const points = common.map((c, idx) => ({
    year: c.year,
    earth: c.earth,
    indicator: c.indicator,
    earth_detrended: idx === 0 ? 0 : detE[idx - 1],
    indicator_detrended: idx === 0 ? 0 : detI[idx - 1],
  }))

  const warnings: string[] = []
  if (lag) {
    warnings.push(`Rezago aplicado: clima en año t comparado con indicador social en t+${lag}.`)
  }
  if (excludedYears.length) {
    warnings.push(`Años de choque global excluidos del cálculo: ${excludedYears.join(', ')}.`)
  }
  if (trendDriven) {
    warnings.push('Correlación aparente dominada por tendencias paralelas en el tiempo: al quitar la tendencia desaparece la relación año a año.')
  }
  const interpretation = significant
    ? `Relación año a año estadísticamente visible (r sin tendencia = ${fmtEs(detR, 2)}, p = ${fmtEs(detP, 4)}): cuando varía el clima también tiende a variar ${indMeta.label.toLowerCase()}.`
    : trendDriven
      ? `Cuidado con la trampa temporal: la correlación bruta parece alta (r = ${fmtEs(rawR, 2)}), pero año a año no hay vínculo claro (r sin tendencia = ${fmtEs(detR, 2)}, p = ${fmtEs(detP, 4)}).`
      : `Sin relación lineal clara año a año en ${common[0].year}–${common[common.length - 1].year} (r sin tendencia = ${fmtEs(detR, 2)}, p = ${fmtEs(detP, 4)}).`

  return {
    n_years: common.length,
    first_year: common[0].year,
    last_year: common[common.length - 1].year,
    raw_r: rawR,
    raw_p: rawP,
    detrended_r: detR,
    detrended_p: detP,
    detrended_rho: detRho,
    detrended_rho_p: detRhoP,
    strength,
    significant,
    trend_driven: trendDriven,
    lag_years: lag,
    excluded_years: excludedYears,
    interpretation,
    warnings,
    points,
    indicator_trend: indTrend,
  }
}

async function resolveTrend(
  variableKey: string,
  lat: number,
  lon: number,
  start: number,
  catalog: Catalog,
  bundle: StaticBundle,
  signal?: AbortSignal,
): Promise<TrendResponse> {
  const exactKey = `${variableKey}|${coordKey(lat, lon)}|${start}`
  if (bundle.trend[exactKey]) return bundle.trend[exactKey]

  if (start === bundle.generated_start) {
    const snapped = matchSampleRegionKey(lat, lon, catalog)
    if (snapped) {
      const snapKey = `${variableKey}|${snapped}|${start}`
      if (bundle.trend[snapKey]) return bundle.trend[snapKey]
    }
  }

  const variable = catalog.variables.find((v) => v.key === variableKey)
  if (!variable) throw new Error(`Variable desconocida: ${variableKey}`)

  const params = await fetchPowerParams(lat, lon, [variable.key], signal)
  const monthlyDict = params[variable.key]
  if (!monthlyDict) throw new Error(`Sin datos NASA POWER para ${variable.key}`)
  return {
    source: 'NASA POWER mensual en vivo (cálculo cliente)',
    lat,
    lon,
    result: computeTrendFromPowerDict(variable, monthlyDict, start),
  }
}

async function searchPlacesOnline(q: string, catalog: Catalog, signal?: AbortSignal): Promise<Place[]> {
  const norm = q.trim().toLowerCase()
  const localMatches: Place[] = catalog.regions
    .filter((r) => r.label.toLowerCase().includes(norm) || r.biome.toLowerCase().includes(norm))
    .map((r) => ({
      name: r.label.split(',')[0].trim(),
      country: r.country ? catalog.countries[r.country] ?? r.country : '',
      iso3: r.country ?? '',
      admin1: r.biome,
      lat: r.lat,
      lon: r.lon,
    }))

  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=8&language=es&format=json`
    const res = await fetch(url, { signal })
    if (res.ok) {
      const data = (await res.json()) as {
        results?: Array<{
          name: string
          country?: string
          country_code?: string
          admin1?: string
          latitude: number
          longitude: number
        }>
      }
      const remote: Place[] = (data.results ?? []).map((item) => {
        const cc = item.country_code?.toUpperCase() ?? ''
        const iso3 = ISO2_TO_ISO3[cc] ?? ''
        return {
          name: item.name,
          country: item.country ?? (iso3 ? catalog.countries[iso3] ?? '' : ''),
          iso3,
          admin1: item.admin1 ?? '',
          lat: item.latitude,
          lon: item.longitude,
        }
      })
      if (remote.length) return remote
    }
  } catch {
  }
  return localMatches
}

function interpretQuestion(question: string): { concern: string; placeType: string | null; placeQuery: string | null } {
  const q = question.toLowerCase()
  let concern = 'heat'
  if (/lluvi|precipit|inunda|agua|torment|monz/.test(q)) concern = 'water'
  else if (/sequ|seco|secando|humedad|suelo|cultiv|cosecha|agric/.test(q)) concern = 'drought'
  else if (/sol|solar|radiaci|fotovolt|uv/.test(q)) concern = 'sun'
  else if (/viento|brisa|hurac|ráfaga/.test(q)) concern = 'wind'

  let placeType: string | null = null
  if (/ciudad|urbano|capital|calle|isla de calor/.test(q)) placeType = 'city'
  else if (/cultiv|finca|agric|cosecha|siembra|campo/.test(q)) placeType = 'farmland'
  else if (/bosque|selva|amazon|árbol|deforest/.test(q)) placeType = 'forest'
  else if (/costa|playa|mar|caribe|océano|puerto/.test(q)) placeType = 'coast'
  else if (/desierto|árido|sahara|seco/.test(q)) placeType = 'dry'
  else if (/ártic|glaciar|nieve|montaña|frío|polo/.test(q)) placeType = 'cold'

  let placeQuery: string | null = null
  const inMatch = question.match(/\b(?:en|de|in|of)\s+([A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚáéíóúÑñ\s-]{2,32})/)
  if (inMatch) placeQuery = inMatch[1].trim()
  return { concern, placeType, placeQuery }
}

function parseOwidCsv(csvText: string): { history: { year: number; mean: number }[]; unProjection: { year: number; mean: number }[] } {
  const lines = csvText.trim().split(/\r?\n/)
  if (lines.length < 2) throw new Error('Sin datos demográficos disponibles para este país')
  const headers = lines[0].split(',')
  const yearIdx = headers.findIndex((h) => h.trim().toLowerCase() === 'year')
  const valIdx = headers.length - 1
  if (yearIdx < 0 || valIdx <= yearIdx) throw new Error('Formato inesperado de Our World in Data')
  const currentYear = 2023
  const history: { year: number; mean: number }[] = []
  const unProjection: { year: number; mean: number }[] = []
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',')
    if (cols.length <= valIdx) continue
    const y = Number(cols[yearIdx])
    const v = Number(cols[valIdx])
    if (!Number.isFinite(y) || !Number.isFinite(v)) continue
    if (y <= currentYear) history.push({ year: y, mean: v })
    else unProjection.push({ year: y, mean: v })
  }
  return { history, unProjection }
}

function buildTemplateExplanation(opts: {
  kind: string
  lang: 'es' | 'en'
  trend?: Trend
  forecast?: EarthForecastResponse['forecast']
  demo?: DemographyResponse
  relate?: RelateResponse
  place?: string
}): string {
  const en = opts.lang === 'en'
  if (opts.kind === 'demography' && opts.demo) {
    const d = opts.demo
    const last = d.history[d.history.length - 1]
    const unVal = d.un_value_at_horizon
    const fcPts = d.forecast?.points ?? []
    const linLast = fcPts[fcPts.length - 1]
    const firstYr = d.trend?.first_year ?? d.history[0]?.year ?? 1990
    const lastYr = d.trend?.last_year ?? last?.year ?? 2023
    const slopeDec = d.trend?.slope_per_decade ?? 0
    return en
      ? `**${d.country_label} · ${d.indicator.label}**: Historical series (${firstYr}–${lastYr}) stands at **${last?.mean.toLocaleString() ?? 'N/A'} ${d.indicator.unit}**, changing at **${fmtEs(slopeDec, 2)} ${d.indicator.unit}/decade**. Notice how UN World Population Prospects (${unVal !== null ? unVal.toLocaleString() : 'N/A'}) incorporates demographic transition, whereas naive linear extrapolation reaches ${linLast ? linLast.value.toLocaleString() : 'N/A'}.`
      : `**${d.country_label} · ${d.indicator.label}**: En ${firstYr}–${lastYr}, el último registro alcanza **${last?.mean.toLocaleString() ?? 'N/D'} ${d.indicator.unit}** con un ritmo de **${fmtEs(slopeDec, 2)} ${d.indicator.unit} por década**. La proyección oficial de la ONU (${unVal !== null ? unVal.toLocaleString() : 'N/D'}) modela transición demográfica, mientras la línea recta (${linLast ? Math.round(linLast.value).toLocaleString() : 'N/D'}) solo prolonga el pasado.`
  }
  if (opts.kind === 'relate' && opts.relate) {
    const r = opts.relate.relation
    return en
      ? `**Climate vs. ${opts.relate.indicator.label} (${opts.relate.country_label})**: Over ${r.n_years} overlapping years (${r.first_year}–${r.last_year}), raw correlation is **r = ${fmtEs(r.raw_r, 2)}**, while detrended year-to-year correlation is **r = ${fmtEs(r.detrended_r, 2)}** (p = ${fmtEs(r.detrended_p, 4)}). ${r.trend_driven ? 'Most of the apparent match comes from parallel time trends, not direct year-to-year co-variation.' : ''}`
      : `**Clima y ${opts.relate.indicator.label} (${opts.relate.country_label})**: En ${r.n_years} años en común (${r.first_year}–${r.last_year}), la correlación bruta es **r = ${fmtEs(r.raw_r, 2)}**, pero al eliminar la tendencia temporal la correlación real año a año es **r = ${fmtEs(r.detrended_r, 2)}** (p = ${fmtEs(r.detrended_p, 4)}). ${r.trend_driven ? 'La coincidencia aparente proviene sobre todo de que ambas series cambiaron en el tiempo, no de variación conjunta anual.' : ''}`
  }
  if (opts.kind === 'landcover') {
    return en
      ? 'Annual land-cover changes combine satellite surface reflectance classification across 16×16 km tiles; long-term urbanization or deforestation is best validated with multi-year persistence rather than a single year.'
      : 'La evolución anual de cobertura muestra la proporción del territorio de 16×16 km ocupada por área construida, vegetación, cultivos o agua según clasificación satelital continua.'
  }
  if (opts.trend) {
    const t = opts.trend
    const where = opts.place || 'la zona seleccionada'
    const fc = opts.forecast
    const fcPt = fc?.points[fc.points.length - 1]
    const sigMsg =
      t.verdict === 'significant'
        ? en
          ? `Confirmed signal (Mann-Kendall p = ${fmtEs(t.mk_p, 4)}, effective sample n = ${fmtEs(t.n_effective, 1)}).`
          : `Tendencia estadísticamente confirmada (Mann-Kendall p = ${fmtEs(t.mk_p, 4)}, tamaño efectivo n_eff = ${fmtEs(t.n_effective, 1)}).`
        : en
          ? `Not confirmed beyond natural variability yet (p = ${fmtEs(t.mk_p, 4)}); around **${t.years_needed} years** would be needed with this noise level.`
          : `Aún no supera la variabilidad natural (p = ${fmtEs(t.mk_p, 4)}); con este nivel de ruido harían falta ~**${t.years_needed} años** para confirmarla.`
    const fcNote = fc && fcPt
      ? en
        ? ` If current pace persisted, ${fc.to_year} would sit near **${fmtEs(fcPt.value, 2)} ${t.unit}** (95% range ${fmtEs(fcPt.low, 2)} to ${fmtEs(fcPt.high, 2)}).`
        : ` De mantenerse el ritmo actual, en ${fc.to_year} rondaría **${fmtEs(fcPt.value, 2)} ${t.unit}** (rango ${fmtEs(fcPt.low, 2)} a ${fmtEs(fcPt.high, 2)}).`
      : ''
    return en
      ? `**${t.label} in ${where} (${t.first_year}–${t.last_year})**: Pace is **${fmtEs(t.slope_per_decade, 3)} ${t.unit}/decade** (95% CI ${fmtEs(t.ci_low_per_decade, 3)} to ${fmtEs(t.ci_high_per_decade, 3)}). ${sigMsg}${fcNote}`
      : `**${t.label} en ${where} (${t.first_year}–${t.last_year})**: El ritmo observado es de **${fmtEs(t.slope_per_decade, 3)} ${t.unit} por década** (IC 95 %: ${fmtEs(t.ci_low_per_decade, 3)} a ${fmtEs(t.ci_high_per_decade, 3)}). ${sigMsg}${fcNote}`
  }
  return en
    ? 'Static GitHub Pages analysis generated from precomputed NASA POWER / UN WPP / World Bank statistical telemetry.'
    : 'Explicación generada con los cálculos reales locales de DATEX en modo estático para GitHub Pages.'
}

export async function staticGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  const url = new URL(path, 'https://verdict.local')
  const pathname = url.pathname
  const q = url.searchParams

  if (pathname === '/api/catalog') {
    return (await loadCatalog(signal)) as T
  }
  if (pathname === '/api/globe') {
    return (await loadGlobe(signal)) as T
  }

  const [catalog, bundle] = await Promise.all([loadCatalog(signal), loadBundle(signal)])

  if (pathname === '/api/recommend') {
    const concern = q.get('concern') ?? 'heat'
    const placeType = q.get('place_type') ?? ''
    const rec =
      bundle.recommend[`${concern}|${placeType}`] ??
      bundle.recommend[`${concern}|`] ?? {
        concern,
        place_type: placeType || null,
        variables: catalog.variables.slice(0, 3),
      }
    return rec as T
  }

  if (pathname === '/api/places/locate') {
    const lat = Number(q.get('lat') ?? 0)
    const lon = Number(q.get('lon') ?? 0)
    const exact = bundle.locate[coordKey(lat, lon)]
    if (exact) return exact as T
    const snapped = matchSampleRegionKey(lat, lon, catalog, 45)
    if (snapped && bundle.locate[snapped]) {
      return { ...bundle.locate[snapped], lat, lon } as T
    }
    try {
      const geoRes = await fetch(
        `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&localityLanguage=es`,
        { signal },
      )
      if (geoRes.ok) {
        const g = (await geoRes.json()) as {
          city?: string
          locality?: string
          principalSubdivision?: string
          countryName?: string
          countryCode?: string
        }
        const iso3 = ISO2_TO_ISO3[g.countryCode?.toUpperCase() ?? ''] ?? ''
        const loc: Location = {
          lat,
          lon,
          iso3,
          country: (iso3 ? catalog.countries[iso3] : undefined) ?? g.countryName ?? '',
          nearest_place: g.city || g.locality || g.principalSubdivision || `${lat.toFixed(2)}, ${lon.toFixed(2)}`,
          admin1: g.principalSubdivision ?? '',
          distance_km: 0,
        }
        return loc as T
      }
    } catch {
    }
    const fallbackLoc: Location = {
      lat,
      lon,
      iso3: '',
      country: '',
      nearest_place: `${lat.toFixed(2)}°, ${lon.toFixed(2)}°`,
      admin1: 'Coordenada directa',
      distance_km: 0,
    }
    return fallbackLoc as T
  }

  if (pathname === '/api/places/search') {
    const query = q.get('q') ?? ''
    return (await searchPlacesOnline(query, catalog, signal)) as T
  }

  if (pathname === '/api/compare') {
    const variable = q.get('variable') ?? 'T2M'
    const start = Number(q.get('start') ?? bundle.generated_start)
    if (start === bundle.generated_start && bundle.compare[variable]) {
      return bundle.compare[variable] as T
    }
    const items: RegionTrend[] = await Promise.all(
      catalog.regions.map(async (region) => {
        try {
          const tr = await resolveTrend(variable, region.lat, region.lon, start, catalog, bundle, signal)
          return { region, source: tr.source, result: tr.result, error: null }
        } catch (err) {
          return {
            region,
            source: 'NASA POWER',
            result: null,
            error: err instanceof Error ? err.message : 'Sin datos',
          }
        }
      }),
    )
    return items as T
  }

  if (pathname === '/api/scan') {
    const lat = Number(q.get('lat') ?? 0)
    const lon = Number(q.get('lon') ?? 0)
    const start = Number(q.get('start') ?? bundle.generated_start)
    const exactKey = `${coordKey(lat, lon)}|${start}`
    if (bundle.scan[exactKey]) return bundle.scan[exactKey] as T
    if (start === bundle.generated_start) {
      const snapped = matchSampleRegionKey(lat, lon, catalog)
      if (snapped && bundle.scan[`${snapped}|${start}`]) {
        return bundle.scan[`${snapped}|${start}`] as T
      }
    }
    const allKeys = catalog.variables.map((v) => v.key)
    const params = await fetchPowerParams(lat, lon, allKeys, signal)
    const rawResults = catalog.variables
      .filter((v) => Boolean(params[v.key]))
      .map((v) => computeTrendFromPowerDict(v, params[v.key], start))
    const factor = Math.max(1, rawResults.length)
    const results = rawResults.map((r) => ({ ...r, p_adjusted: Math.min(1, r.mk_p * factor) }))
    const scanResp: ScanResponse = {
      source: 'NASA POWER mensual en vivo (cálculo cliente)',
      lat,
      lon,
      results,
    }
    return scanResp as T
  }

  if (pathname === '/api/trend') {
    const variable = q.get('variable') ?? 'T2M'
    const lat = Number(q.get('lat') ?? 0)
    const lon = Number(q.get('lon') ?? 0)
    const start = Number(q.get('start') ?? bundle.generated_start)
    return (await resolveTrend(variable, lat, lon, start, catalog, bundle, signal)) as T
  }

  if (pathname === '/api/forecast') {
    const variableKey = q.get('variable') ?? 'T2M'
    const lat = Number(q.get('lat') ?? 0)
    const lon = Number(q.get('lon') ?? 0)
    const start = Number(q.get('start') ?? bundle.generated_start)
    const toYear = Number(q.get('to_year') ?? 2050)
    const tr = await resolveTrend(variableKey, lat, lon, start, catalog, bundle, signal)
    const varMeta = catalog.variables.find((v) => v.key === variableKey)
    if (!varMeta) throw new Error(`Variable desconocida: ${variableKey}`)
    const ck = coordKey(lat, lon)
    const snapped = matchSampleRegionKey(lat, lon, catalog)
    const fc =
      bundle.forecast[`${variableKey}|${ck}|${start}|${toYear}`] ??
      (snapped && start === bundle.generated_start
        ? bundle.forecast[`${variableKey}|${snapped}|${start}|${toYear}`]
        : undefined) ??
      buildEarthForecast(tr.result, toYear)
    const resp: EarthForecastResponse = {
      source: tr.source,
      variable: varMeta,
      history: tr.result.series?.annual ?? [],
      forecast: fc,
    }
    return resp as T
  }

  if (pathname === '/api/demography') {
    const country = (q.get('country') ?? 'NIC').toUpperCase()
    const indicator = q.get('indicator') ?? 'population'
    const start = Number(q.get('start') ?? bundle.generated_start)
    const toYear = Number(q.get('to_year') ?? 2050)
    const exact = bundle.demography[`${country}|${indicator}|${start}|${toYear}`]
    if (exact) return exact as T

    const sampleBase =
      bundle.demography[`${country}|${indicator}|${bundle.generated_start}|2100`] ??
      bundle.demography[`${country}|${indicator}|${bundle.generated_start}|2050`]
    if (sampleBase && start === bundle.generated_start) {
      const unFiltered = sampleBase.un_projection.filter((p) => p.year <= toYear)
      const unLast = unFiltered[unFiltered.length - 1]?.mean ?? null
      const trendBase = sampleBase.trend ?? analyzeAnnualTrend(indicator, sampleBase.indicator.label, sampleBase.indicator.unit, true, sampleBase.history.filter((h) => h.year >= start), [])
      return {
        ...sampleBase,
        un_projection: unFiltered,
        forecast: buildEarthForecast(trendBase, toYear),
        un_value_at_horizon: unLast,
      } as T
    }

    const indMeta = catalog.demography.find((d) => d.key === indicator)
    if (!indMeta) throw new Error(`Indicador demográfico desconocido: ${indicator}`)
    const OWID_SLUGS: Record<string, string> = {
      population: 'population-with-un-projections',
      growth_rate: 'population-growth-rate-with-and-without-migration',
      birth_rate: 'crude-birth-rate',
      death_rate: 'crude-death-rate',
      fertility: 'children-per-woman-un',
      life_expectancy: 'life-expectancy',
      median_age: 'median-age',
    }
    const slug = (indMeta as { slug?: string }).slug ?? OWID_SLUGS[indMeta.key] ?? indMeta.key
    const csvUrl = `https://ourworldindata.org/grapher/${slug}.csv?v=1&csvType=filtered&useColumnShortNames=true&country=${encodeURIComponent(country)}`
    const csvRes = await fetch(csvUrl, { signal })
    if (!csvRes.ok) throw new Error('Our World in Data no respondió desde el navegador para este país.')
    const { history, unProjection } = parseOwidCsv(await csvRes.text())
    const recent = history.filter((h) => h.year >= start)
    const ratioScale = Boolean((indMeta as { ratio_scale?: boolean }).ratio_scale ?? true)
    const trend = analyzeAnnualTrend(indMeta.key, indMeta.label, indMeta.unit, ratioScale, recent.length >= 5 ? recent : history, [])
    const unFilt = unProjection.filter((p) => p.year <= toYear)
    const demoResp: DemographyResponse = {
      source: 'UN World Population Prospects vía Our World in Data',
      country,
      country_label: catalog.countries[country] ?? country,
      indicator: indMeta,
      history,
      un_projection: unFilt,
      trend,
      forecast: buildEarthForecast(trend, toYear),
      un_value_at_horizon: unFilt[unFilt.length - 1]?.mean ?? null,
    }
    return demoResp as T
  }

  if (pathname === '/api/worldbank/available') {
    const country = (q.get('country') ?? 'NIC').toUpperCase()
    const start = Number(q.get('start') ?? bundle.generated_start)
    if (start === bundle.generated_start) {
      const fromBundle = new Set<string>()
      for (const [k, rel] of Object.entries(bundle.relate)) {
        const parts = k.split('|')
        if (parts[2] === country && (rel.relation?.points?.length ?? 0) >= 10) {
          fromBundle.add(parts[1])
        }
      }
      if (fromBundle.size > 0) {
        return { country, indicators: catalog.indicators.map((i) => i.key).filter((k) => fromBundle.has(k)) } as T
      }
    }
    const checks = await Promise.allSettled(
      catalog.indicators.map(async (ind) => {
        const s = await fetchWorldBankSeries(country, ind.key, signal)
        const count = Object.keys(s).filter((y) => Number(y) >= start).length
        return count >= 10 ? ind.key : null
      }),
    )
    const indicators = checks
      .filter((r): r is PromiseFulfilledResult<string | null> => r.status === 'fulfilled' && r.value !== null)
      .map((r) => r.value as string)
    return { country, indicators } as T
  }

  if (pathname === '/api/relate') {
    const variable = q.get('variable') ?? 'T2M'
    const indicator = q.get('indicator') ?? 'AG.YLD.CREL.KG'
    const country = (q.get('country') ?? 'NIC').toUpperCase()
    const lat = Number(q.get('lat') ?? 0)
    const lon = Number(q.get('lon') ?? 0)
    const start = Number(q.get('start') ?? bundle.generated_start)
    const lag = Math.max(0, Math.min(2, Number(q.get('lag') ?? 0)))
    const excludeShock = q.get('exclude_2020_2021') === 'true'
    const ck = coordKey(lat, lon)
    if (lag === 0 && !excludeShock) {
      const exact = bundle.relate[`${variable}|${indicator}|${country}|${ck}|${start}`]
      if (exact) return exact as T
      if (start === bundle.generated_start) {
        const snapped = matchSampleRegionKey(lat, lon, catalog)
        if (snapped && bundle.relate[`${variable}|${indicator}|${country}|${snapped}|${start}`]) {
          return bundle.relate[`${variable}|${indicator}|${country}|${snapped}|${start}`] as T
        }
      }
    }

    const indMeta = catalog.indicators.find((i) => i.key === indicator)
    if (!indMeta) throw new Error(`Indicador desconocido: ${indicator}`)
    const [tr, wbSeries] = await Promise.all([
      resolveTrend(variable, lat, lon, start, catalog, bundle, signal),
      fetchWorldBankSeries(country, indicator, signal),
    ])
    const rel = buildRelation(tr.result, indMeta, wbSeries, lag, excludeShock)
    const { indicator_trend, ...relation } = rel
    const relateResp: RelateResponse = {
      earth_source: tr.source,
      indicator_source: 'World Bank Open Data API v2',
      country,
      country_label: catalog.countries[country] ?? country,
      indicator: indMeta,
      indicator_trend,
      relation,
    }
    return relateResp as T
  }

  if (pathname === '/api/satellite/timeline') {
    const lat = Number(q.get('lat') ?? 0)
    const lon = Number(q.get('lon') ?? 0)
    const targets = [1990, 2000, 2010, 2016, 2020, 2025]
    const d = 0.08
    const bbox = [lon - d, lat - d, lon + d, lat + d]
    const items = await Promise.all(
      targets.map(async (yr): Promise<SatelliteImage | null> => {
        const col = yr >= 2016 ? 'sentinel-2-l2a' : 'landsat-c2-l2'
        try {
          const res = await fetch('https://planetarycomputer.microsoft.com/api/stac/v1/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal,
            body: JSON.stringify({
              collections: [col],
              bbox,
              datetime: `${yr}-01-01T00:00:00Z/${yr}-12-31T23:59:59Z`,
              limit: 8,
              query: { 'eo:cloud_cover': { lt: 35 } },
            }),
          })
          if (!res.ok) return null
          const data = (await res.json()) as {
            features?: Array<{
              id: string
              properties: { datetime: string; 'eo:cloud_cover'?: number }
              assets?: { rendered_preview?: { href: string } }
            }>
          }
          const feat = (data.features ?? [])
            .filter((f) => Boolean(f.assets?.rendered_preview?.href))
            .sort((a, b) => (a.properties['eo:cloud_cover'] ?? 100) - (b.properties['eo:cloud_cover'] ?? 100))[0]
          if (!feat) return null
          return {
            year: Number(feat.properties.datetime.slice(0, 4)),
            date: feat.properties.datetime.slice(0, 10),
            collection: col,
            platform: col === 'sentinel-2-l2a' ? 'Sentinel-2' : 'Landsat',
            cloud_cover: feat.properties['eo:cloud_cover'] ?? 0,
            url: feat.assets!.rendered_preview!.href,
          }
        } catch {
          return null
        }
      }),
    )
    const valid = items.filter((x): x is SatelliteImage => x !== null)
    if (!valid.length) {
      throw new Error('No se encontraron escenas satelitales despejadas en esta coordenada.')
    }
    return valid as T
  }

  if (pathname === '/api/satellite/landcover') {
    throw new Error(
      'El conteo píxel a píxel de cobertura del suelo (GeoTIFF) requiere el backend FastAPI; las imágenes históricas de Sentinel-2/Landsat sí están activas arriba.',
    )
  }

  throw new Error(`Ruta no soportada en modo estático: ${pathname}`)
}

export async function staticPost<T>(path: string, body: unknown): Promise<T> {
  const url = new URL(path, 'https://verdict.local')
  const pathname = url.pathname
  const [catalog, bundle] = await Promise.all([loadCatalog(), loadBundle()])

  if (pathname === '/api/ask') {
    const { question = '' } = (body ?? {}) as { question?: string }
    const { concern, placeType, placeQuery } = interpretQuestion(question)
    const rec =
      bundle.recommend[`${concern}|${placeType ?? ''}`] ??
      bundle.recommend[`${concern}|`] ?? {
        variables: catalog.variables.slice(0, 3),
      }
    const places = placeQuery ? await searchPlacesOnline(placeQuery, catalog) : []
    const resp: AskResponse = {
      interpretation: {
        concern,
        place_type: placeType,
        place_query: placeQuery,
        source: 'reglas',
      },
      variables: rec.variables,
      places,
    }
    return resp as T
  }

  if (pathname === '/api/explain') {
    const req = (body ?? {}) as {
      kind?: string
      variable?: string
      indicator?: string
      country?: string
      lat?: number
      lon?: number
      place?: string
      start?: number
      to_year?: number
      lang?: 'es' | 'en'
    }
    const lang = req.lang === 'en' ? 'en' : 'es'
    const kind = req.kind ?? 'trend'
    let text = ''
    try {
      if (kind === 'demography' && req.country && req.indicator) {
        const d = await staticGet<DemographyResponse>(
          `/api/demography?country=${encodeURIComponent(req.country)}&indicator=${encodeURIComponent(req.indicator)}&start=${req.start ?? 1990}&to_year=${req.to_year ?? 2050}`,
        )
        text = buildTemplateExplanation({ kind, lang, demo: d })
      } else if (kind === 'relate' && req.country && req.indicator && req.variable) {
        const r = await staticGet<RelateResponse>(
          `/api/relate?variable=${encodeURIComponent(req.variable)}&indicator=${encodeURIComponent(req.indicator)}&country=${encodeURIComponent(req.country)}&lat=${req.lat ?? 0}&lon=${req.lon ?? 0}&start=${req.start ?? 1990}`,
        )
        text = buildTemplateExplanation({ kind, lang, relate: r })
      } else if (kind === 'landcover') {
        text = buildTemplateExplanation({ kind, lang })
      } else {
        const tr = await resolveTrend(
          req.variable ?? 'T2M',
          req.lat ?? 12.13,
          req.lon ?? -86.25,
          req.start ?? 1990,
          catalog,
          bundle,
        )
        const fc =
          req.to_year !== undefined
            ? buildEarthForecast(tr.result, req.to_year)
            : undefined
        text = buildTemplateExplanation({
          kind,
          lang,
          trend: tr.result,
          forecast: fc,
          place: req.place,
        })
      }
    } catch {
      text = buildTemplateExplanation({ kind, lang })
    }
    return {
      text,
      source: 'plantilla',
      note:
        lang === 'en'
          ? 'GitHub Pages static mode (computed with verified statistical data).'
          : 'Modo estático en GitHub Pages (plantilla verificada con datos reales).',
    } as T
  }

  throw new Error(`POST no soportado en modo estático: ${pathname}`)
}
