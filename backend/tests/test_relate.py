import numpy as np
import pytest

from app.services import relate

YEARS = list(range(1990, 2024))


def series(values) -> dict[int, float]:
    return {y: float(v) for y, v in zip(YEARS, values)}


def test_shared_year_to_year_signal_is_detected():
    rng = np.random.default_rng(0)
    shock = rng.normal(0, 1, len(YEARS))  # p. ej. años secos y húmedos
    earth = series(0.02 * np.arange(len(YEARS)) + shock)
    crop = series(2000 + 30 * np.arange(len(YEARS)) + 150 * shock + rng.normal(0, 40, len(YEARS)))
    r = relate.relate("Humedad del suelo", earth, "Rendimiento", crop, "Somoto", "Nicaragua")
    assert r.significant and r.detrended_r > 0.8 and r.strength == "fuerte"
    assert "por encima" in r.interpretation and not r.trend_driven


def _unrelated_trends(seed: int):
    rng = np.random.default_rng(seed)
    t = np.arange(len(YEARS))
    temp = series(26 + 0.03 * t + rng.normal(0, 0.15, len(YEARS)))
    gdp = series(1500 + 40 * t + rng.normal(0, 30, len(YEARS)))
    return relate.relate("Temperatura", temp, "PIB por persona", gdp, "Managua", "Nicaragua")


def test_two_unrelated_trends_are_flagged_as_trend_driven():
    r = _unrelated_trends(seed=3)
    assert r.raw_p < 0.05 and r.raw_r > 0.7  # parece una relación fuerte...
    assert r.trend_driven and not r.significant  # ...pero no lo es año a año
    assert "cambian con el tiempo" in r.interpretation


def test_year_to_year_false_positive_rate_is_near_alpha():
    results = [_unrelated_trends(seed=s) for s in range(200)]
    false_positives = sum(r.significant for r in results)
    assert false_positives <= 20  # alfa = 5 % → se esperan ~10 de 200
    assert all(r.trend_driven for r in results)  # la correlación aparente siempre se explica


def test_negative_relation_wording():
    rng = np.random.default_rng(2)
    shock = rng.normal(0, 1, len(YEARS))
    r = relate.relate("Temperatura máxima", series(shock), "Producción", series(-shock + rng.normal(0, 0.2, len(YEARS))),
                      "Managua", "Nicaragua")
    assert r.detrended_r < -0.8 and "por debajo" in r.interpretation


def test_only_common_years_are_used_and_minimum_enforced():
    a = {y: float(y % 7) for y in range(1990, 2024)}
    b = {y: float(y % 5) for y in range(2015, 2024)}
    with pytest.raises(relate.InsufficientOverlap):
        relate.relate("A", a, "B", b, "X", "Y")
    b = {y: float((y * 3) % 11) for y in range(2005, 2030)}
    r = relate.relate("A", a, "B", b, "X", "Y")
    assert (r.first_year, r.last_year, r.n_years) == (2005, 2023, 19)
    assert any("Pocos años" in w for w in r.warnings)


def test_constant_series_is_rejected():
    with pytest.raises(relate.InsufficientOverlap):
        relate.relate("A", series(np.ones(len(YEARS))), "B", series(np.arange(len(YEARS))), "X", "Y")


def test_lag_and_exclude_2020_2021():
    rng = np.random.default_rng(12)
    earth_vals = rng.normal(0, 1, len(YEARS))
    earth = series(earth_vals)
    # El indicador responde al año anterior (lag=1) y tiene un choque extremo en 2020-2021
    ind = {YEARS[k + 1]: earth_vals[k] * 2.0 for k in range(len(YEARS) - 1)}
    ind[2020] = 50.0
    ind[2021] = -50.0

    r = relate.relate("A", earth, "B", ind, "Managua", "Nicaragua", lag=1, exclude_2020_2021=True)
    assert r.lag_years == 1
    assert r.excluded_years == [2020, 2021]
    assert "Managua" in r.spatial_note and "Nicaragua" in r.spatial_note
    assert r.significant and r.detrended_r > 0.9


@pytest.mark.asyncio
async def test_available_indicators_filters_empty_and_short(monkeypatch):
    from app.services import worldbank

    async def fake_get_indicator(country: str, key: str):
        if key == "AG.YLD.CREL.KG":
            return {y: float(y) for y in range(1995, 2020)}, "muestra-local"
        if key == "NY.GDP.PCAP.KD":
            return {y: float(y) for y in range(2018, 2023)}, "muestra-local"  # menos de 10 años
        raise worldbank.WorldBankUnavailable("sin datos")

    monkeypatch.setattr(worldbank, "get_indicator", fake_get_indicator)
    avail = await worldbank.available_indicators("NIC", start=1990, min_years=10)
    assert avail == ["AG.YLD.CREL.KG"]
