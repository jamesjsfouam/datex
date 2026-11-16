"""Indicadores socioeconómicos anuales por país desde la API abierta del Banco Mundial.

No requiere clave, pero a veces responde muy lento: hay caché en memoria y, para los
países de las regiones de ejemplo, muestras guardadas en app/data/samples/worldbank_<ISO3>.json.
"""
from __future__ import annotations

import asyncio
import json
import time
from collections import OrderedDict

import httpx

from app.catalog import INDICATORS
from app.services.power import FIRST_YEAR, SAMPLES_DIR, last_full_year

WB_URL = "https://api.worldbank.org/v2/country/{country}/indicator/{indicator}"
CACHE_TTL_S = 24 * 3600
MAX_CACHE_ENTRIES = 512
TIMEOUT = httpx.Timeout(45.0)
FAST_TIMEOUT = httpx.Timeout(5.0)

_cache: OrderedDict[tuple[str, str], tuple[float, dict[int, float]]] = OrderedDict()


class WorldBankUnavailable(RuntimeError):
    pass


def _parse(payload: list) -> dict[int, float]:
    if len(payload) < 2 or not payload[1]:
        return {}
    return {
        int(row["date"]): float(row["value"])
        for row in payload[1]
        if row.get("value") is not None and str(row.get("date", "")).isdigit()
    }


async def _fetch_live(country: str, indicator: str, timeout: httpx.Timeout = TIMEOUT) -> dict[int, float]:
    params = {"format": "json", "date": f"{FIRST_YEAR}:{last_full_year()}", "per_page": 100}
    async with httpx.AsyncClient(timeout=timeout) as client:
        r = await client.get(WB_URL.format(country=country, indicator=indicator), params=params)
        r.raise_for_status()
        return _parse(r.json())


def _sample(country: str, indicator: str) -> dict[int, float] | None:
    path = SAMPLES_DIR / f"worldbank_{country}.json"
    if not path.exists():
        return None
    series = json.loads(path.read_text())["indicators"].get(indicator)
    return {int(y): float(v) for y, v in series.items()} if series else None


async def get_indicator(country: str, indicator: str) -> tuple[dict[int, float], str]:
    """Devuelve ({año: valor}, origen) con origen 'banco-mundial' o 'muestra-local'."""
    key = (country.upper(), indicator)
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < CACHE_TTL_S:
        return hit[1], "banco-mundial"
    sample = _sample(*key)
    try:
        # Si ya existe muestra local, evita bloquear 45 s esperando al Banco Mundial
        data = await _fetch_live(*key, timeout=FAST_TIMEOUT if sample is not None else TIMEOUT)
    except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
        if sample is not None:
            return sample, "muestra-local"
        raise WorldBankUnavailable(
            "El Banco Mundial no respondió y no hay muestra local para este país"
        ) from exc
    _cache[key] = (time.time(), data)
    _cache.move_to_end(key)
    while len(_cache) > MAX_CACHE_ENTRIES:
        _cache.popitem(last=False)
    return data, "banco-mundial"


async def fetch_all(country: str) -> dict[str, dict[int, float]]:
    """Todos los indicadores del catálogo para un país (usado al generar muestras)."""
    out = {}
    for ind in INDICATORS:
        for attempt in range(2):
            try:
                out[ind.key] = await _fetch_live(country, ind.key)
                break
            except httpx.HTTPError:
                if attempt == 1:
                    raise
    return out


async def available_indicators(country: str, start: int = 1990, min_years: int = 10) -> list[str]:
    """Devuelve las claves de indicadores con al menos `min_years` datos desde `start`."""
    async def _check(key: str) -> str | None:
        try:
            raw, _ = await get_indicator(country, key)
        except WorldBankUnavailable:
            return None
        count = sum(1 for y in raw if y >= start)
        return key if count >= min_years else None

    results = await asyncio.gather(*(_check(ind.key) for ind in INDICATORS))
    return [k for k in results if k is not None]
