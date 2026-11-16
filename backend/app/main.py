"""API del Detective de tendencias del sistema Tierra. Arranque: uv run uvicorn app.main:app --reload"""

from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from app.catalog import (
    CONCERNS,
    DATA_NOTE,
    DEMOS,
    INDICATOR_BY_KEY,
    INDICATORS,
    PLACE_TYPES,
    REGION_BY_ID,
    REGIONS,
    THEMES,
    VARIABLE_BY_KEY,
    VARIABLES,
    Demo,
    Indicator,
    Region,
    Variable,
    recommend,
)
from app.config import get_settings
from app.services import (
    ai,
    demography,
    forecast,
    meteomatics,
    places,
    power,
    relate,
    satellite,
    trends,
    worldbank,
)

settings = get_settings()
app = FastAPI(title="DATEX", version="0.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_methods=["*"],
    allow_headers=["*"],
)


class Catalog(BaseModel):
    themes: dict[str, str]
    variables: list[Variable]
    regions: list[Region]
    demos: list[Demo]
    first_year: int
    last_year: int
    data_note: str
    indicators: list[Indicator]
    countries: dict[str, str]
    concerns: dict[str, str]
    place_types: dict[str, str]
    demography: list[demography.DemographicIndicator]


class TrendResponse(BaseModel):
    source: str  # nasa-power | muestra-local
    lat: float
    lon: float
    result: trends.TrendResult


class ScanResponse(BaseModel):
    source: str
    lat: float
    lon: float
    results: list[trends.TrendResult]


class RegionTrend(BaseModel):
    region: Region
    source: str
    result: trends.TrendResult | None
    error: str | None = None


def _check_period(start: int, end: int) -> None:
    if start < power.FIRST_YEAR or end > power.last_full_year() or end <= start:
        raise HTTPException(
            422, f"El periodo debe estar entre {power.FIRST_YEAR} y {power.last_full_year()}"
        )
    if end - start + 1 < trends.MIN_YEARS:
        raise HTTPException(422, f"Se necesitan al menos {trends.MIN_YEARS} años de datos")


def _variable(key: str) -> Variable:
    variable = VARIABLE_BY_KEY.get(key.upper())
    if variable is None:
        raise HTTPException(404, f"Variable desconocida: {key}")
    return variable


async def _monthly(lat: float, lon: float) -> tuple[dict, str]:
    try:
        return await power.get_monthly(lat, lon)
    except power.PowerUnavailable as exc:
        raise HTTPException(502, str(exc)) from exc


Lat = Query(ge=-90, le=90, description="Latitud en grados")
Lon = Query(ge=-180, le=180, description="Longitud en grados")


@app.get("/api/health")
def server_health() -> dict:
    """Estado del servidor y qué integraciones opcionales tienen claves configuradas."""
    return {
        "status": "ok",
        "integrations": {
            "nasa_power": True,  # no requiere clave
            "meteomatics": bool(settings.meteomatics_username),
            "earthdata": bool(settings.earthdata_username),
            "firebase": bool(settings.firebase_project_id),
            "ia_claude": bool(settings.anthropic_api_key),
        },
    }


@app.get("/api/catalog")
def catalog() -> Catalog:
    """Variables, temas, regiones de ejemplo y demostraciones para la interfaz."""
    return Catalog(
        themes=THEMES,
        variables=VARIABLES,
        regions=REGIONS,
        demos=DEMOS,
        first_year=power.FIRST_YEAR,
        last_year=power.last_full_year(),
        data_note=DATA_NOTE,
        indicators=INDICATORS,
        countries=places.all_countries(),
        concerns=CONCERNS,
        place_types=PLACE_TYPES,
        demography=demography.DEMOGRAPHY,
    )


@app.get("/api/trend")
async def trend(
    variable: str,
    lat: float = Lat,
    lon: float = Lon,
    start: int = 1990,
    end: int = Query(default_factory=power.last_full_year),
) -> TrendResponse:
    """Serie temporal y análisis de tendencia de una variable en un punto."""
    _check_period(start, end)
    var = _variable(variable)
    monthly, source = await _monthly(lat, lon)
    try:
        result = trends.analyze(var, monthly[var.key], start, end)
    except (trends.InsufficientData, KeyError) as exc:
        raise HTTPException(422, str(exc)) from exc
    return TrendResponse(source=source, lat=lat, lon=lon, result=result)


@app.get("/api/scan")
async def scan(
    lat: float = Lat,
    lon: float = Lon,
    start: int = 1990,
    end: int = Query(default_factory=power.last_full_year),
) -> ScanResponse:
    """Analiza todas las variables de un punto y las ordena por evidencia de tendencia."""
    _check_period(start, end)
    monthly, source = await _monthly(lat, lon)
    return ScanResponse(
        source=source, lat=lat, lon=lon, results=trends.scan(monthly, start, end)
    )


@app.get("/api/compare")
async def compare(
    variable: str,
    start: int = 1990,
    end: int = Query(default_factory=power.last_full_year),
) -> list[RegionTrend]:
    """Misma variable en todas las regiones de ejemplo: ¿la tendencia es igual en todas partes?"""
    _check_period(start, end)
    var = _variable(variable)
    out = []
    for region in REGIONS:
        try:
            monthly, source = await power.get_monthly(region.lat, region.lon)
            result = trends.analyze(var, monthly[var.key], start, end, include_series=False)
            out.append(RegionTrend(region=region, source=source, result=result))
        except (power.PowerUnavailable, trends.InsufficientData, KeyError) as exc:
            out.append(RegionTrend(region=region, source="", result=None, error=str(exc)))
    return out


class RelateResponse(BaseModel):
    earth_source: str
    indicator_source: str
    country: str
    country_label: str
    indicator: Indicator
    indicator_trend: trends.TrendResult | None
    relation: relate.Relation


@app.get("/api/relate")
async def relate_endpoint(
    variable: str,
    indicator: str,
    country: str,
    lat: float = Lat,
    lon: float = Lon,
    place: str = "",
    start: int = 1990,
    end: int = Query(default_factory=power.last_full_year),
    lag: int = Query(0, ge=0, le=2, description="Rezago en años (0, 1 o 2) aplicado al indicador"),
    exclude_2020_2021: bool = Query(False, description="Excluir choque global 2020-2021"),
) -> RelateResponse:
    """Relación año a año entre una variable de la Tierra y un indicador socioeconómico del país."""
    _check_period(start, end)
    var = _variable(variable)
    ind = INDICATOR_BY_KEY.get(indicator)
    if ind is None:
        raise HTTPException(404, f"Indicador desconocido: {indicator}")
    country = country.upper()
    country_label = places.country_name(country)
    if country_label is None:
        raise HTTPException(404, f"País desconocido: {country}")

    monthly, earth_source = await _monthly(lat, lon)
    earth = trends.annual_means(monthly.get(var.key, {}), start, end)
    try:
        raw, ind_source = await worldbank.get_indicator(country, ind.key)
    except worldbank.WorldBankUnavailable as exc:
        raise HTTPException(502, str(exc)) from exc
    series = {y: v for y, v in raw.items() if start <= y <= end}

    as_variable = Variable(key=ind.key, label=ind.label, unit=ind.unit, theme="society",
                           definition=ind.definition, ratio_scale=ind.ratio_scale)
    try:
        ind_trend = trends.analyze_annual(as_variable, list(series), list(series.values()), False)
    except trends.InsufficientData:
        ind_trend = None
    try:
        relation = relate.relate(
            var.label, earth, ind.label, series,
            place or f"{lat:.2f}, {lon:.2f}", country_label,
            lag=lag, exclude_2020_2021=exclude_2020_2021,
        )
    except relate.InsufficientOverlap as exc:
        raise HTTPException(422, str(exc)) from exc
    return RelateResponse(
        earth_source=earth_source,
        indicator_source=ind_source,
        country=country,
        country_label=country_label,
        indicator=ind,
        indicator_trend=ind_trend,
        relation=relation,
    )


@app.get("/api/worldbank/available")
async def worldbank_available(country: str, start: int = 1990) -> dict[str, object]:
    """Lista de indicadores del Banco Mundial con datos suficientes para el país elegido."""
    code = country.upper()
    if places.country_name(code) is None:
        raise HTTPException(404, f"País desconocido: {code}")
    keys = await worldbank.available_indicators(code, start=start, min_years=relate.MIN_OVERLAP)
    return {"country": code, "indicators": keys}


@app.get("/api/regions/{region_id}")
def region(region_id: str) -> Region:
    if region_id not in REGION_BY_ID:
        raise HTTPException(404, "Región desconocida")
    return REGION_BY_ID[region_id]


@app.get("/api/weather")
async def weather(lat: float, lon: float, parameters: str = "t_2m:C,uv:idx") -> dict:
    """Tiempo actual con Meteomatics (opcional, requiere claves en .env)."""
    try:
        return await meteomatics.query(lat, lon, parameters.split(","))
    except meteomatics.MeteomaticsNotConfigured as exc:
        raise HTTPException(503, str(exc)) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(502, "Meteomatics no respondió") from exc




# --- Cualquier lugar del mundo ---------------------------------------------------------------


@app.get("/api/places/search")
async def places_search(q: str = Query(min_length=2, max_length=100)) -> list[places.Place]:
    """Busca lugares por nombre (ciudades, pueblos, regiones) en todo el mundo."""
    try:
        return await places.search(q)
    except places.PlacesUnavailable as exc:
        raise HTTPException(502, str(exc)) from exc


@app.get("/api/places/locate")
def places_locate(lat: float = Lat, lon: float = Lon) -> places.Location:
    """País y lugar habitado más cercano a una coordenada (sin conexión)."""
    return places.locate(round(lat, 4), round(lon, 4))


class Recommendation(BaseModel):
    concern: str
    place_type: str | None
    variables: list[Variable]


@app.get("/api/recommend")
def recommend_variables(concern: str, place_type: str | None = None) -> Recommendation:
    """Recomendador por reglas: de una preocupación y un tipo de lugar a 3 variables como máximo."""
    if concern not in CONCERNS:
        raise HTTPException(404, f"Preocupación desconocida: {concern}")
    if place_type is not None and place_type not in PLACE_TYPES:
        raise HTTPException(404, f"Tipo de lugar desconocido: {place_type}")
    keys = recommend(concern, place_type)
    return Recommendation(concern=concern, place_type=place_type,
                          variables=[VARIABLE_BY_KEY[k] for k in keys])


# --- Previsiones (escenario si el ritmo continúa) ----------------------------------------------


MAX_HORIZON = 2100


class EarthForecastResponse(BaseModel):
    source: str
    variable: Variable
    history: list[trends.AnnualPoint]
    forecast: forecast.Forecast


@app.get("/api/forecast")
async def earth_forecast(
    variable: str,
    lat: float = Lat,
    lon: float = Lon,
    start: int = 1990,
    to_year: int = Query(2050, le=MAX_HORIZON),
) -> EarthForecastResponse:
    """Escenario: valor de la variable si continuara el ritmo lineal observado."""
    var = _variable(variable)
    end = power.last_full_year()
    _check_period(start, end)
    monthly, source = await _monthly(lat, lon)
    annual = trends.annual_means(monthly.get(var.key, {}), start, end)
    try:
        fc = forecast.linear_forecast(list(annual), list(annual.values()), to_year, var.label, var.unit,
                                      forecast.bounds_for(var.unit, var.ratio_scale))
    except forecast.ForecastError as exc:
        raise HTTPException(422, str(exc)) from exc
    return EarthForecastResponse(
        source=source, variable=var,
        history=[trends.AnnualPoint(year=y, mean=v) for y, v in annual.items()],
        forecast=fc,
    )


# --- Demografía (cualquier país) ----------------------------------------------------------------


class DemographyResponse(BaseModel):
    source: str
    country: str
    country_label: str
    indicator: demography.DemographicIndicator
    history: list[trends.AnnualPoint]
    un_projection: list[trends.AnnualPoint]  # proyección oficial de la ONU (variante media)
    trend: trends.TrendResult | None
    forecast: forecast.Forecast | None
    un_value_at_horizon: float | None


@app.get("/api/demography")
async def demography_endpoint(
    country: str,
    indicator: str = "population",
    start: int = 1990,
    to_year: int = Query(2050, le=MAX_HORIZON),
) -> DemographyResponse:
    """Serie demográfica de un país, su tendencia, nuestra extrapolación y la proyección de la ONU."""
    ind = demography.DEMOGRAPHY_BY_KEY.get(indicator)
    if ind is None:
        raise HTTPException(404, f"Indicador desconocido: {indicator}")
    iso3 = country.upper()
    label = places.country_name(iso3)
    if label is None:
        raise HTTPException(404, f"País desconocido: {country}")
    try:
        est, proj, source = await demography.get_series(iso3, ind.key)
    except demography.DemographyUnavailable as exc:
        raise HTTPException(502, str(exc)) from exc
    window = {y: v for y, v in sorted(est.items()) if y >= start}
    as_var = Variable(key=ind.key, label=ind.label, unit=ind.unit, theme="society",
                      definition=ind.definition, ratio_scale=ind.ratio_scale)
    try:
        trend = trends.analyze_annual(as_var, list(window), list(window.values()), include_series=False)
    except trends.InsufficientData:
        trend = None
    try:
        fc = forecast.linear_forecast(list(window), list(window.values()), to_year, ind.label, ind.unit,
                                      forecast.bounds_for(ind.unit, ind.ratio_scale))
    except forecast.ForecastError:
        fc = None
    return DemographyResponse(
        source=source, country=iso3, country_label=label, indicator=ind,
        history=[trends.AnnualPoint(year=y, mean=v) for y, v in sorted(est.items())],
        un_projection=[trends.AnnualPoint(year=y, mean=v) for y, v in sorted(proj.items()) if y <= to_year],
        trend=trend, forecast=fc, un_value_at_horizon=proj.get(to_year),
    )


# --- Satélite (cualquier punto) -----------------------------------------------------------------


DEFAULT_IMAGE_YEARS = [1990, 2000, 2010, 2016, 2020, 2025]


@app.get("/api/satellite/timeline")
async def satellite_timeline(
    lat: float = Lat,
    lon: float = Lon,
    years: str = ",".join(map(str, DEFAULT_IMAGE_YEARS)),
    half_km: float = Query(8.0, ge=1, le=40),
) -> list[satellite.SatelliteImage]:
    """Imagen de satélite con menos nubes de cada año, recortada alrededor del punto."""
    try:
        wanted = sorted({int(y) for y in years.split(",") if y.strip()})
    except ValueError as exc:
        raise HTTPException(422, "Años no válidos") from exc
    if not wanted or len(wanted) > 12 or wanted[0] < 1984 or wanted[-1] > power.last_full_year() + 1:
        raise HTTPException(422, "Elige entre 1 y 12 años entre 1984 y el año actual")
    try:
        return await satellite.timeline(lat, lon, wanted, half_km)
    except satellite.SatelliteUnavailable as exc:
        raise HTTPException(502, str(exc)) from exc


class LandCoverResponse(BaseModel):
    land_cover: satellite.LandCover
    built_forecast: forecast.Forecast | None


@app.get("/api/satellite/landcover")
async def satellite_landcover(
    lat: float = Lat,
    lon: float = Lon,
    half_km: float = Query(8.0, ge=1, le=40),
    to_year: int = Query(2035, le=MAX_HORIZON),
) -> LandCoverResponse:
    """Cobertura del suelo año a año y escenario de la zona construida si el ritmo continúa."""
    try:
        lc = await satellite.land_cover(lat, lon, half_km)
    except satellite.SatelliteUnavailable as exc:
        raise HTTPException(502, str(exc)) from exc
    fc = None
    if len(lc.years) >= forecast.MIN_POINTS:
        try:
            fc = forecast.linear_forecast(
                [y.year for y in lc.years], [y.shares["Zona construida"] for y in lc.years],
                to_year, "Zona construida", "% del área", (0.0, 100.0))
        except forecast.ForecastError:
            fc = None
    return LandCoverResponse(land_cover=lc, built_forecast=fc)


# --- IA: de la pregunta al catálogo, y explicación de resultados ----------------------------


class AskRequest(BaseModel):
    question: str = Field(min_length=3, max_length=500)


class AskResponse(BaseModel):
    interpretation: ai.Interpretation
    variables: list[Variable]
    places: list[places.Place]


@app.post("/api/ask")
async def ask(body: AskRequest) -> AskResponse:
    """Pregunta libre → preocupación y tipo de lugar del catálogo → variables recomendadas."""
    interp = await ai.interpret(body.question)
    found: list[places.Place] = []
    if interp.place_query:
        try:
            found = await places.search(interp.place_query, count=5)
        except places.PlacesUnavailable:
            found = []
    keys = recommend(interp.concern, interp.place_type)
    return AskResponse(interpretation=interp, variables=[VARIABLE_BY_KEY[k] for k in keys], places=found)


class ExplainRequest(BaseModel):
    kind: str = Field(pattern="^(trend|demography|landcover|relate)$")
    variable: str | None = None
    indicator: str | None = None
    country: str | None = None
    lat: float | None = Field(None, ge=-90, le=90)
    lon: float | None = Field(None, ge=-180, le=180)
    place: str = ""
    start: int = 1990
    to_year: int = Field(2050, le=MAX_HORIZON)
    lang: str = Field("es", pattern="^(es|en)$")


def _forecast_facts(fc: forecast.Forecast | None) -> dict:
    if fc is None:
        return {}
    end = fc.points[-1]
    return {
        "forecast_text": fc.text,
        "scenario": {"year": end.year, "value": round(end.value, 4), "low_95": round(end.low, 4),
                     "high_95": round(end.high, 4), "based_on": f"{fc.base_first_year}-{fc.base_last_year}"},
        "forecast_warnings": fc.warnings,
    }


def _trend_facts(t: trends.TrendResult | None) -> dict:
    if t is None:
        return {}
    return {
        "verdict": t.verdict, "interpretation": t.interpretation,
        "period": f"{t.first_year}-{t.last_year}", "slope_per_decade": round(t.slope_per_decade, 5),
        "ci95_per_decade": [round(t.ci_low_per_decade, 5), round(t.ci_high_per_decade, 5)],
        "total_change": round(t.total_change, 5), "percent_change": t.percent_change,
        "mann_kendall_p": round(t.mk_p, 5), "years_needed": t.years_needed,
        "period_sensitive": t.period_sensitive, "warnings": t.warnings,
    }


def _need(value, name: str):
    if value is None:
        raise HTTPException(422, f"Falta el parámetro {name}")
    return value


@app.post("/api/explain")
async def explain(body: ExplainRequest) -> ai.Explanation:
    """Explicación en lenguaje llano de un resultado. Las cifras se recalculan aquí: la IA solo
    recibe lo que calculó el motor, nunca números enviados por el navegador."""
    end = power.last_full_year()
    facts: dict = {"kind": body.kind}
    if body.lat is not None and body.lon is not None:
        loc = places.locate(round(body.lat, 4), round(body.lon, 4))
        facts["place"] = body.place or loc.nearest_place or f"{body.lat:.2f}, {body.lon:.2f}"
        facts["country"] = loc.country
        facts["coordinates"] = [round(body.lat, 3), round(body.lon, 3)]

    if body.kind == "trend":
        lat, lon = _need(body.lat, "lat"), _need(body.lon, "lon")
        res = await trend(variable=_need(body.variable, "variable"), lat=lat, lon=lon, start=body.start, end=end)
        var = VARIABLE_BY_KEY[res.result.variable]
        facts |= {"variable": var.label, "unit": var.unit, "definition": var.definition,
                  "source": var.source, "reliability": var.reliability, **_trend_facts(res.result)}
        try:
            fc = await earth_forecast(variable=var.key, lat=lat, lon=lon, start=body.start, to_year=body.to_year)
            facts |= _forecast_facts(fc.forecast)
        except HTTPException:
            pass
    elif body.kind == "demography":
        res = await demography_endpoint(country=_need(body.country, "country"),
                                        indicator=body.indicator or "population",
                                        start=body.start, to_year=body.to_year)
        facts |= {"country": res.country_label, "indicator": res.indicator.label, "unit": res.indicator.unit,
                  "definition": res.indicator.definition, "source": "ONU World Population Prospects (Our World in Data)",
                  "latest": {"year": res.history[-1].year, "value": res.history[-1].mean} if res.history else None,
                  "un_projection_at_horizon": res.un_value_at_horizon,
                  **_trend_facts(res.trend), **_forecast_facts(res.forecast)}
    elif body.kind == "landcover":
        lat, lon = _need(body.lat, "lat"), _need(body.lon, "lon")
        res = await satellite_landcover(lat=lat, lon=lon, half_km=8.0, to_year=body.to_year)
        yrs = res.land_cover.years
        facts |= {"source": "Cobertura del suelo anual de Impact Observatory/Esri (Sentinel-2, 10 m)",
                  "area_km2": res.land_cover.area_km2,
                  "first": yrs[0].model_dump() if yrs else None, "last": yrs[-1].model_dump() if yrs else None,
                  "warnings": res.land_cover.warnings,
                  "interpretation": "Porcentaje del cuadro que es zona construida, cultivos, árboles, etc., por año.",
                  **_forecast_facts(res.built_forecast)}
    else:  # relate
        res = await relate_endpoint(variable=_need(body.variable, "variable"),
                                    indicator=_need(body.indicator, "indicator"),
                                    country=_need(body.country, "country"),
                                    lat=_need(body.lat, "lat"), lon=_need(body.lon, "lon"),
                                    place=body.place, start=body.start, end=end)
        rel = res.relation
        facts |= {"indicator": res.indicator.label, "country": res.country_label,
                  "interpretation": rel.interpretation, "year_to_year_r": round(rel.detrended_r, 3),
                  "year_to_year_p": round(rel.detrended_p, 5), "apparent_r": round(rel.raw_r, 3),
                  "trend_driven": rel.trend_driven, "warnings": rel.warnings,
                  "note": "Una correlación no demuestra causa."}
    return await ai.explain(facts, lang=body.lang)


# --- Globo 3D: malla global precalculada (scripts/build_globe.py) ----------------------------

GLOBE_FILE = Path(__file__).resolve().parent / "data" / "globe.json"


@app.get("/api/globe")
def globe() -> FileResponse:
    """Malla de celdas de 5° con pendiente, p, veredicto y control FDR por variable."""
    if not GLOBE_FILE.exists():
        raise HTTPException(404, "La malla del globo aún no se ha generado (scripts/build_globe.py)")
    return FileResponse(GLOBE_FILE, media_type="application/json",
                        headers={"Cache-Control": "public, max-age=3600"})
