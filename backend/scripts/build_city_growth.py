"""Escenario de crecimiento urbano por celdas de ~100 m (autómata celular con probabilidades aprendidas).

Pasos:
 1. Máscara de lo construido (clase 7) de la cobertura del suelo anual de 10 m (Impact Observatory/Esri,
    Planetary Computer), reproyectada a una malla lon/lat de ~100 m.
 2. Se aprende, con regresión logística, qué celdas libres se convierten en construidas (cercanía a lo
    construido, densidad vecina, pendiente del terreno) usando las transiciones 2017→2020 y 2020→2023.
 3. Validación: se ajusta con 2017→2020 y se comprueba si acierta DÓNDE crecieron las celdas en 2020→2023.
 4. Cantidad: los km² construidos futuros siguen la población urbana proyectada por la ONU elevada a un
    exponente beta ajustado a 2017–2023.
 5. Reparto año a año (2030…2050): se construyen las celdas libres con mayor probabilidad.

Es un ESCENARIO de tendencia, no una predicción: no conoce planes urbanísticos.

Uso: cd backend && PYTHONPATH=. uv run python -u scripts/build_city_growth.py [managua]
"""
from __future__ import annotations

import base64
import itertools
import json
import sys
from datetime import date
from pathlib import Path

import numpy as np
import planetary_computer as pc
import pystac_client
import rasterio
from rasterio.transform import from_origin
from rasterio.warp import Resampling, reproject, transform_bounds
from rasterio.windows import from_bounds
from scipy import ndimage, optimize, stats

from app.catalog import VARIABLE_BY_KEY
from app.services import power, trends  # SAMPLES_DIR, análisis de tendencias

OUT_DIR = Path(__file__).resolve().parents[2] / "public" / "static-api" / "city"
STAC = "https://planetarycomputer.microsoft.com/api/stac/v1"
LULC_YEARS = [2017, 2018, 2019, 2020, 2021, 2022, 2023]
BASE_YEAR = 2023
PROJECTION_YEARS = [2030, 2035, 2040, 2045, 2050]
CELL_M = 100.0
BUILT, WATER = 7, 1

CITIES = {
    "managua": {"name": "Managua, Nicaragua", "lat": 12.13, "lon": -86.25, "iso": "NIC", "half_km": 12.0},
}


def grid_for(lat: float, lon: float, half_km: float):
    dlat = CELL_M / 111_320.0
    dlon = CELL_M / (111_320.0 * np.cos(np.radians(lat)))
    n = round(2 * half_km * 1000 / CELL_M)
    west = lon - dlon * n / 2
    north = lat + dlat * n / 2
    transform = from_origin(west, north, dlon, dlat)
    return n, transform, (west, north - dlat * n, west + dlon * n, north)


def read_lulc_year(cat, bbox, year: int, n: int, transform):
    """Devuelve (fracción construida, fracción de agua) por celda de 100 m, o None."""
    items = list(cat.search(collections=["io-lulc-annual-v02"], bbox=bbox,
                            datetime=f"{year}-01-01/{year}-12-31").items())
    items = [i for i in items if i.datetime and i.datetime.year == year] or items
    if not items:
        return None
    href = items[0].assets["data"].href
    with rasterio.open(href) as src:
        b = transform_bounds("EPSG:4326", src.crs, *bbox)
        win = from_bounds(*b, transform=src.transform).round_offsets().round_lengths()
        arr = src.read(1, window=win)
        src_tf = src.window_transform(win)
        crs = src.crs
    out = []
    for cls in (BUILT, WATER):
        layer = (arr == cls).astype("float32")
        dst = np.zeros((n, n), dtype="float32")
        reproject(layer, dst, src_transform=src_tf, src_crs=crs, dst_transform=transform,
                  dst_crs="EPSG:4326", resampling=Resampling.average)
        out.append(dst)
    return out[0], out[1]


def read_slope(cat, bbox, n: int, transform, lat: float):
    """Pendiente en grados a partir del MDE Copernicus de 30 m; ceros si no está disponible."""
    try:
        items = list(cat.search(collections=["cop-dem-glo-30"], bbox=bbox).items())
        dem = np.full((n, n), np.nan, dtype="float32")
        for it in items:
            tmp = np.full((n, n), -9999, dtype="float32")
            with rasterio.open(it.assets["data"].href) as src:
                reproject(rasterio.band(src, 1), tmp, dst_transform=transform, dst_crs="EPSG:4326",
                          resampling=Resampling.bilinear, dst_nodata=-9999)
            ok = tmp > -9000
            dem[ok] = tmp[ok]
        if np.isnan(dem).all():
            raise RuntimeError("sin MDE")
        dem = np.where(np.isnan(dem), np.nanmedian(dem), dem)
        gy, gx = np.gradient(ndimage.gaussian_filter(dem, 1.0), CELL_M)
        return np.degrees(np.arctan(np.hypot(gx, gy))).astype("float32")
    except Exception as exc:  # noqa: BLE001
        print(f"  (sin pendiente: {type(exc).__name__}: {exc})", flush=True)
        return np.zeros((n, n), dtype="float32")


def features(built: np.ndarray, water: np.ndarray, slope: np.ndarray) -> np.ndarray:
    """Matriz (n*n, k) de variables explicativas calculadas desde el estado actual."""
    b = built.astype("float32")
    dist = ndimage.distance_transform_edt(~built).astype("float32")  # en celdas
    dens3 = ndimage.uniform_filter(b, 3)
    dens7 = ndimage.uniform_filter(b, 7)
    dens15 = ndimage.uniform_filter(b, 15)
    dwater = ndimage.distance_transform_edt(water < 0.5).astype("float32")
    cols = [np.log1p(dist), dens3, dens7, dens15, slope / 10.0, np.log1p(dwater)]
    return np.stack([c.ravel() for c in cols], axis=1)


def fit_logistic(X: np.ndarray, y: np.ndarray, l2: float = 1e-3):
    mu, sd = X.mean(0), X.std(0) + 1e-9
    Z = np.hstack([(X - mu) / sd, np.ones((len(X), 1))])

    def loss(w):
        z = Z @ w
        p = 1 / (1 + np.exp(-z))
        eps = 1e-9
        ll = -(y * np.log(p + eps) + (1 - y) * np.log(1 - p + eps)).mean() + l2 * (w[:-1] ** 2).sum()
        g = Z.T @ (p - y) / len(y)
        g[:-1] += 2 * l2 * w[:-1]
        return ll, g

    res = optimize.minimize(loss, np.zeros(Z.shape[1]), jac=True, method="L-BFGS-B")
    return res.x, mu, sd


def score(w, mu, sd, X):
    Z = np.hstack([(X - mu) / sd, np.ones((len(X), 1))])
    return Z @ w


def transitions(b0, b1, w0, slope):
    """Muestras (X, y) de celdas libres en t0: y=1 si en t1 pasaron a construidas."""
    free = (~b0) & (w0 < 0.5)
    X = features(b0, w0, slope)
    y = (b1 & ~b0).ravel().astype("float32")
    idx = np.flatnonzero(free.ravel())
    return X[idx], y[idx], idx


def figure_of_merit(pred_idx: np.ndarray, true_idx: np.ndarray) -> float:
    pred, true = set(pred_idx.tolist()), set(true_idx.tolist())
    hits = len(pred & true)
    denom = len(true | pred)
    return hits / denom if denom else 0.0


def allocate(scores: np.ndarray, free_mask: np.ndarray, k: int) -> np.ndarray:
    idx = np.flatnonzero(free_mask.ravel())
    k = min(k, len(idx))
    top = np.argpartition(-scores[idx], k - 1)[:k]
    return idx[top]


def urban_population(iso3: str):
    """Población urbana = población (ONU, estimada y proyectada) × % urbano.
    El % urbano solo llega a 2025: se prolonga con la tendencia logística de 2000–2025."""
    est = json.loads((power.SAMPLES_DIR / f"demography_{iso3}.json").read_text())["indicators"]
    pop = {int(y): v for y, v in est["population"]["estimates"].items()}
    pop.update({int(y): v for y, v in est["population"]["projection"].items()})
    urb = {int(y): v for y, v in est["urban"]["estimates"].items()}
    last = max(urb)
    ys = np.array([y for y in urb if 2000 <= y <= last], dtype=float)
    logit = np.log(np.array([urb[int(y)] / 100 for y in ys]) / (1 - np.array([urb[int(y)] / 100 for y in ys])))
    slope, icpt = np.polyfit(ys, logit, 1)
    for y in range(last + 1, 2101):
        z = icpt + slope * y
        urb[y] = 100.0 / (1 + np.exp(-z))
    return {y: pop[y] * urb[y] / 100.0 for y in pop if y in urb}



# ----------------------------------------------------------------------------------------------
# Impulsores climáticos y sociales (escenario). Los supuestos son EXPLÍCITOS y ajustables.
# ----------------------------------------------------------------------------------------------
KAPPA = 0.5   # empuje migratorio máximo por clima (fracción de la población urbana por unidad de estrés·empleo agrario)
GAMMA = 0.2   # elasticidad del suelo construido por persona respecto al ingreso por habitante
HEAT_FULL_C = 2.0        # calentamiento que equivale a estrés térmico = 1
DRY_FULL_SOIL = 0.10     # descenso de humedad de raíces (0–1) que equivale a sequía = 1
DRY_FULL_PRECIP = 0.25   # descenso relativo de lluvia que equivale a sequía = 1
THETA = 0.5   # elasticidad de la altura de los edificios al ingreso por habitante (supuesto, crecimiento vertical)
GHSL_YEAR = 2018
EVIDENCE_WEIGHT = {"significant": 1.0, "not_yet": 0.5, "no_trend": 0.0}


def pettitt(y: np.ndarray):
    n = len(y)
    sign = np.sign(y[None, :] - y[:, None])
    u = np.array([sign[: k + 1, k + 1 :].sum() for k in range(n - 1)])
    k = int(np.argmax(np.abs(u)))
    p = min(1.0, 2 * np.exp(-6 * float(abs(u[k])) ** 2 / (n**3 + n**2)))
    rss_step = float(((y[: k + 1] - y[: k + 1].mean()) ** 2).sum() + ((y[k + 1:] - y[k + 1:].mean()) ** 2).sum())
    return k, float(p), rss_step


def theil_sen_projection(years: list[int], values: list[float], to_year: int, log: bool = False,
                         cap: tuple[float, float] | None = None):
    x = np.array(years, dtype=float)
    y = np.log(values) if log else np.array(values, dtype=float)
    slope, icpt, *_ = stats.theilslopes(y, x)
    if log and cap:
        slope = float(np.clip(slope, np.log(1 + cap[0]), np.log(1 + cap[1])))
        icpt = float(np.median(y - slope * x))
    f = {yr: float(icpt + slope * yr) for yr in range(min(years), to_year + 1)}
    return {yr: (float(np.exp(v)) if log else v) for yr, v in f.items()}, float(slope)


def climate_drivers(lat: float, lon: float, last_year: int):
    """Tendencias NASA POWER (1990–último año) de T2M, PRECTOTCORR y GWETROOT con el motor de DATEX.

    Control de calidad: si Pettitt detecta un salto brusco (p < 0,05), la serie anterior al salto no
    se mezcla con la posterior (posible discontinuidad del reanálisis): se usa solo la tendencia
    DESPUÉS del salto, siempre que queden al menos MIN_YEARS años."""
    monthly = power._sample_for(lat, lon)
    if monthly is None:
        return None
    out = {}
    for key in ("T2M", "PRECTOTCORR", "GWETROOT"):
        v = VARIABLE_BY_KEY[key]
        full = trends.analyze(v, monthly[key], 1990, last_year, include_series=True)
        years = np.array([p.year for p in full.series.annual], dtype=float)
        vals = np.array([p.mean for p in full.series.annual], dtype=float)
        k, pp, _ = pettitt(vals)
        break_year = int(years[k + 1])
        use, start = full, 1990
        broken = bool(pp < 0.05)
        if broken:
            try:
                use = trends.analyze(v, monthly[key], break_year, last_year, include_series=False)
                start = break_year
            except Exception:  # noqa: BLE001  (quedan menos de MIN_YEARS años tras el salto)
                use = None
        w = EVIDENCE_WEIGHT[use.verdict] if use is not None else 0.0
        out[key] = {
            "label": v.label, "unit": full.unit,
            "full_period": {"start": 1990, "verdict": full.verdict, "slope_per_decade": round(full.slope_per_decade, 4),
                            "mk_p": float(full.mk_p)},
            "pettitt_p": round(pp, 4), "break_year": break_year, "break_detected": broken,
            "used_period_start": start,
            "verdict": use.verdict if use is not None else "no_trend",
            "slope_per_decade": round(use.slope_per_decade, 4) if use is not None else 0.0,
            "mk_p": float(use.mk_p) if use is not None else 1.0,
            "weight": w, "mean_last_10y": float(vals[-10:].mean()),
        }
    return out


def social_drivers(iso3: str, base_year: int, to_year: int):
    wb = json.loads((power.SAMPLES_DIR / f"worldbank_{iso3}.json").read_text())["indicators"]
    gdp = {int(y): v for y, v in wb["NY.GDP.PCAP.KD"].items() if v}
    gy = [y for y in sorted(gdp) if y >= 2005]
    G, g_slope = theil_sen_projection(gy, [gdp[y] for y in gy], to_year, log=True, cap=(0.0, 0.035))
    agr = {int(y): v for y, v in wb["SL.AGR.EMPL.ZS"].items() if v}
    ay = [y for y in sorted(agr) if y >= 2005]
    A_, a_slope = theil_sen_projection(ay, [agr[y] / 100 for y in ay], to_year, log=True, cap=(-0.05, 0.0))
    return {"gdp_pc": G, "gdp_growth": float(np.exp(g_slope) - 1), "agr_share": A_, "agr_decline": float(np.exp(a_slope) - 1),
            "gdp_last_obs": max(gdp), "agr_last_obs": max(agr)}


def stress_index(clim: dict, year: int, base_year: int):
    """Estrés climático S en [0,1] a partir de las tendencias ponderadas por evidencia (escenario lineal)."""
    dt = year - base_year
    t, pr, gw = clim["T2M"], clim["PRECTOTCORR"], clim["GWETROOT"]
    d_temp = t["weight"] * t["slope_per_decade"] / 10 * dt
    d_soil = gw["weight"] * gw["slope_per_decade"] / 10 * dt
    d_prec = pr["weight"] * pr["slope_per_decade"] / 10 * dt / max(pr["mean_last_10y"], 1e-6)
    heat = float(np.clip(max(0.0, d_temp) / HEAT_FULL_C, 0, 1))
    dry = float(np.clip(0.5 * max(0.0, -d_soil) / DRY_FULL_SOIL + 0.5 * max(0.0, -d_prec) / DRY_FULL_PRECIP, 0, 1))
    return float(np.clip(0.5 * heat + 0.5 * dry, 0, 1)), heat, dry, d_temp, d_soil, d_prec


def target_area(a0: float, U: dict, soc: dict | None, clim: dict | None, year: int, base_year: int,
                beta: float, kappa: float = KAPPA, gamma: float = GAMMA, integrated: bool = True) -> float:
    ratio = U[year] / U[base_year]
    if not integrated or soc is None:
        return a0 * ratio ** beta
    s = stress_index(clim, year, base_year)[0] if clim else 0.0
    push = 1 + kappa * s * soc["agr_share"][year]
    income = (soc["gdp_pc"][year] / soc["gdp_pc"][base_year]) ** gamma
    return a0 * (ratio * push) ** beta * income



def read_ghsl_height(n: int, transform):
    """Altura media neta de edificación (m) a 100 m, GHSL GHS-BUILT-H ANBH 2018 (R2023A, Mollweide).
    Devuelve (altura media de lo edificado por celda, 0 donde no hay edificación)."""
    import urllib.request

    from rasterio.warp import transform as warp_transform

    cx = float(transform.c + transform.a * n / 2)
    cy = float(transform.f + transform.e * n / 2)
    xs, ys = warp_transform("EPSG:4326", "ESRI:54009", [cx], [cy])
    col = int((xs[0] - (-18041000.0)) // 1_000_000) + 1
    row = int((9018000.0 - ys[0]) // 1_000_000) + 1
    name = f"GHS_BUILT_H_ANBH_E2018_GLOBE_R2023A_54009_100_V1_0_R{row}_C{col}"
    url = ("https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/GHSL/GHS_BUILT_H_GLOBE_R2023A/"
           f"GHS_BUILT_H_ANBH_E2018_GLOBE_R2023A_54009_100/V1-0/tiles/{name}.zip")
    cache = Path("/tmp/ghsl")
    cache.mkdir(exist_ok=True)
    zpath = cache / f"{name}.zip"
    if not zpath.exists():
        print(f"  descargando {name}.zip", flush=True)
        urllib.request.urlretrieve(url, zpath)
    h = np.zeros((n, n), dtype="float32")
    m = np.zeros((n, n), dtype="float32")
    with rasterio.open(f"/vsizip/{zpath}/{name}.tif") as src:
        arr = src.read(1).astype("float32")
        tf, crs = src.transform, src.crs
        b = transform_bounds("EPSG:4326", crs, *[transform.c, transform.f + transform.e * n,
                                                   transform.c + transform.a * n, transform.f])
        win = from_bounds(*b, transform=tf).round_offsets().round_lengths()
        w = arr[int(win.row_off): int(win.row_off + win.height), int(win.col_off): int(win.col_off + win.width)]
        wtf = src.window_transform(win)
    w = np.where(w > 0, w, 0.0).astype("float32")
    reproject(w, h, src_transform=wtf, src_crs=crs, dst_transform=transform, dst_crs="EPSG:4326",
              resampling=Resampling.average)
    reproject((w > 0).astype("float32"), m, src_transform=wtf, src_crs=crs, dst_transform=transform,
              dst_crs="EPSG:4326", resampling=Resampling.average)
    out = np.where(m > 0.02, h / np.maximum(m, 1e-6), 0.0)
    return out.astype("float32")


def vertical_fields(h_raw: np.ndarray, base_built: np.ndarray):
    """Alturas base (m), alturas de las celdas nuevas (m) y peso de centralidad (0–1)."""
    h0 = np.where(base_built, h_raw, 0.0)
    # celdas construidas sin dato de altura: media local de las vecinas con dato (mínimo 3 m)
    has = (h0 > 0).astype("float32")
    num = ndimage.uniform_filter(h0, 11)
    den = ndimage.uniform_filter(has, 11)
    local = np.where(den > 0.02, num / np.maximum(den, 1e-6), 3.0)
    h0 = np.where(base_built & (h0 <= 0), np.maximum(local, 3.0), h0)
    # altura de una celda nueva: media local de lo edificado a ~1,5 km (mínimo 3 m)
    num15 = ndimage.uniform_filter(h0, 15)
    den15 = ndimage.uniform_filter((h0 > 0).astype("float32"), 15)
    h_new = np.where(den15 > 0.02, num15 / np.maximum(den15, 1e-6), 3.0)
    h_new = np.maximum(h_new, 3.0)
    dens15 = ndimage.uniform_filter(base_built.astype("float32"), 15)
    vals = dens15[base_built]
    lo, hi = np.percentile(vals, 10), np.percentile(vals, 90)
    core = np.clip((dens15 - lo) / max(hi - lo, 1e-6), 0, 1)
    return h0.astype("float32"), h_new.astype("float32"), core.astype("float32")


def height_at(year: int, base_year: int, h0, h_new, core, added, k_of_year, soc, theta=THETA):
    """Altura (m) de cada celda en un año: lo existente crece en vertical según ingreso y centralidad."""
    mult = (soc["gdp_pc"][year] / soc["gdp_pc"][base_year]) ** theta
    grow = 1 + (mult - 1) * core
    h = h0 * grow
    new = (added > 0) & (added <= k_of_year)
    h = np.where(new, h_new * grow, h)
    return h.astype("float32"), float(mult)


def b64(a: np.ndarray) -> str:
    return base64.b64encode(np.ascontiguousarray(a.astype("uint8")).tobytes()).decode()


def build(city_id: str) -> None:
    c = CITIES[city_id]
    n, transform, (w, s, e, nn) = grid_for(c["lat"], c["lon"], c["half_km"])
    bbox = [w - 0.01, s - 0.01, e + 0.01, nn + 0.01]
    print(f"{city_id}: malla {n}x{n} de {CELL_M:.0f} m, bbox {bbox}", flush=True)
    cat = pystac_client.Client.open(STAC, modifier=pc.sign_inplace)

    built_f, water_f = {}, {}
    for yr in LULC_YEARS:
        r = read_lulc_year(cat, bbox, yr, n, transform)
        if r is None:
            print(f"  {yr}: sin datos", flush=True)
            continue
        built_f[yr], water_f[yr] = r
        print(f"  {yr}: construido {(built_f[yr] >= .5).mean() * 100:.1f} % de la malla", flush=True)
    years = sorted(built_f)
    slope = read_slope(cat, bbox, n, transform, c["lat"])

    B = {y: built_f[y] >= 0.5 for y in years}
    # el agua no cambia: se usa la mediana de los años
    W = np.median(np.stack([water_f[y] for y in years]), axis=0)
    # lo construido no "desaparece": se acumula (evita parpadeo de clasificación)
    for i in range(1, len(years)):
        B[years[i]] = B[years[i]] | B[years[i - 1]]

    # ---- validación: ajustar con 2017→2020, probar en 2020→2023
    y0, y1, y2 = 2017, 2020, 2023
    Xa, ya, _ = transitions(B[y0], B[y1], W, slope)
    wa, mua, sda = fit_logistic(Xa, ya)
    Xb, yb, idxb = transitions(B[y1], B[y2], W, slope)
    sb = score(wa, mua, sda, Xb)
    auc = float((stats.rankdata(sb)[yb == 1].sum() - yb.sum() * (yb.sum() + 1) / 2) / (yb.sum() * (1 - yb).sum()))
    n_new = int(yb.sum())
    true_idx = idxb[yb == 1]
    top = np.argpartition(-sb, n_new - 1)[:n_new]
    fom_model = figure_of_merit(idxb[top], true_idx)
    # referencia ingenua: construir lo más cercano a lo ya construido
    dist_col = Xb[:, 0]
    top0 = np.argpartition(dist_col, n_new - 1)[:n_new]
    fom_base = figure_of_merit(idxb[top0], true_idx)
    rnd = np.random.default_rng(1).choice(len(idxb), n_new, replace=False)
    fom_rand = figure_of_merit(idxb[rnd], true_idx)
    print(f"  validación 2020→2023: celdas nuevas {n_new}, AUC {auc:.3f}, FoM modelo {fom_model:.3f}, "
          f"cercanía {fom_base:.3f}, azar {fom_rand:.3f}", flush=True)

    # ---- modelo final con todas las transiciones
    Xs, ys = [], []
    for t0, t1 in itertools.pairwise(years):
        X, y, _ = transitions(B[t0], B[t1], W, slope)
        Xs.append(X)
        ys.append(y)
    wf, muf, sdf = fit_logistic(np.vstack(Xs), np.concatenate(ys))
    names = ["cercanía a lo construido", "densidad 300 m", "densidad 700 m", "densidad 1,5 km",
             "pendiente", "cercanía al agua"]
    coefs = {k: round(float(v), 3) for k, v in zip(names, wf[:-1])}
    print("  coeficientes:", coefs, flush=True)

    # ---- cantidad: población urbana ONU
    U = urban_population(c["iso"])
    area = {y: float(B[y].sum()) * (CELL_M / 1000) ** 2 for y in years}
    xs = np.log([U[y] for y in years])
    ys_ = np.log([area[y] for y in years])
    beta = float(np.polyfit(xs, ys_, 1)[0])
    beta_c = float(np.clip(beta, 0.5, 1.3))
    print(f"  área construida {area[years[0]]:.1f}→{area[years[-1]]:.1f} km²; beta ajustado {beta:.2f} (usado {beta_c:.2f})",
          flush=True)

    # ---- impulsores climáticos y sociales
    horizon = PROJECTION_YEARS[-1]
    soc = social_drivers(c["iso"], BASE_YEAR, horizon)
    try:
        clim = climate_drivers(c["lat"], c["lon"], power.last_full_year())
    except Exception as exc:  # noqa: BLE001
        print(f"  (sin impulsores climáticos: {type(exc).__name__}: {exc})", flush=True)
        clim = None
    if clim:
        for k_, v_ in clim.items():
            fp = v_["full_period"]
            print(f"  clima {k_}: 1990– {fp['verdict']} {fp['slope_per_decade']:+.3f}/déc.; Pettitt p={v_['pettitt_p']} "
                  f"(salto {v_['break_year']}, detectado={v_['break_detected']}); usado desde {v_['used_period_start']}: "
                  f"{v_['verdict']} {v_['slope_per_decade']:+.3f} {v_['unit']}/déc., peso={v_['weight']}", flush=True)
    print(f"  sociedad: PIB/hab. crecimiento {soc['gdp_growth'] * 100:+.2f} %/año, "
          f"empleo agrario {soc['agr_decline'] * 100:+.2f} %/año", flush=True)

    # ---- reparto año a año (dos escenarios con el mismo autómata)
    free_water = W >= 0.5
    new_density_cells = (CELL_M / 1000) ** 2

    def run_scenario(integrated: bool):
        cur = B[BASE_YEAR].copy()
        added = np.zeros((n, n), dtype="uint8")
        out_area = {BASE_YEAR: area[BASE_YEAR]}
        for k, yr in enumerate(PROJECTION_YEARS, start=1):
            target = target_area(area[BASE_YEAR], U, soc, clim, yr, BASE_YEAR, beta_c, integrated=integrated)
            need = round((target - cur.sum() * new_density_cells) / new_density_cells)
            if need > 0:
                sc = score(wf, muf, sdf, features(cur, W, slope))
                pick = allocate(sc, (~cur) & (~free_water), need)
                flat = cur.ravel()
                flat[pick] = True
                cur = flat.reshape(n, n)
                ad = added.ravel()
                ad[pick] = k
                added = ad.reshape(n, n)
            out_area[yr] = float(cur.sum()) * new_density_cells
            print(f"  [{'integrado' if integrated else 'solo población'}] {yr}: objetivo {target:.1f} km², "
                  f"construido {out_area[yr]:.1f} km² (+{need} celdas)", flush=True)
        return added, out_area

    added, out_area = run_scenario(True)
    added_base, out_area_base = run_scenario(False)

    drivers_rows = {}
    for yr in [BASE_YEAR] + PROJECTION_YEARS:
        s_, heat, dry, d_t, d_s, d_p = stress_index(clim, yr, BASE_YEAR) if clim else (0, 0, 0, 0, 0, 0)
        push = 1 + KAPPA * s_ * soc["agr_share"][yr]
        drivers_rows[str(yr)] = {
            "urban_population_million": round(U[yr] / 1e6, 3),
            "gdp_per_capita_usd": round(soc["gdp_pc"][yr], 0),
            "agricultural_employment_share": round(soc["agr_share"][yr], 3),
            "delta_temperature_c": round(d_t, 3), "delta_soil_wetness": round(d_s, 4),
            "delta_rain_fraction": round(d_p, 4),
            "heat_stress": round(heat, 3), "drought_stress": round(dry, 3), "climate_stress": round(s_, 3),
            "migration_push_multiplier": round(push, 4),
            "built_km2_integrated": round(out_area[yr], 1), "built_km2_population_only": round(out_area_base[yr], 1),
        }
    ratio50 = U[horizon] / U[BASE_YEAR]
    income50 = (soc["gdp_pc"][horizon] / soc["gdp_pc"][BASE_YEAR]) ** GAMMA
    sensitivity = {
        f"stress_2050={s_end},kappa={kp}": round(float(area[BASE_YEAR] * (ratio50 * (1 + kp * s_end * soc["agr_share"][horizon])) ** beta_c * income50), 1)
        for s_end in (0.0, 0.5, 1.0) for kp in (0.25, 0.5, 1.0)
    }
    sensitivity.update({f"gamma={gm},stress_2050=0": round(float(area[BASE_YEAR] * ratio50 ** beta_c * (soc["gdp_pc"][horizon] / soc["gdp_pc"][BASE_YEAR]) ** gm), 1)
                        for gm in (0.0, 0.2, 0.4)})
    print("  sensibilidad 2050 (km²):", sensitivity, flush=True)

    # ---- crecimiento vertical (alturas reales GHSL 2018 + crecimiento por ingreso y centralidad)
    h_raw = read_ghsl_height(n, transform)
    h0, h_new, core = vertical_fields(h_raw, B[BASE_YEAR])
    cellkm2 = (CELL_M / 1000) ** 2
    dens_base = np.clip(built_f[BASE_YEAR], 0, 1) * B[BASE_YEAR]
    new_dens_val = 0.75
    vertical = {"theta": THETA, "height_source": "GHSL GHS-BUILT-H ANBH 2018 (R2023A), 100 m",
                "height_year": GHSL_YEAR, "multiplier": {}, "mean_height_m": {}, "max_height_m": {},
                "volume_million_m3": {}, "mean_height_existing_m": {}, "volume_from_vertical_million_m3": {}, "mean_height_m_population_only": {}, "volume_million_m3_population_only": {}}
    for k, yr in enumerate([BASE_YEAR] + PROJECTION_YEARS):
        hh, mult = height_at(yr, BASE_YEAR, h0, h_new, core, added, k, soc)
        built_now = B[BASE_YEAR] | ((added > 0) & (added <= k))
        w_now = np.where(B[BASE_YEAR], dens_base, new_dens_val) * built_now
        vol = float((hh * w_now).sum() * cellkm2 * 1e6 / 1e6)   # km² · m → millones de m³
        vertical["multiplier"][str(yr)] = round(mult, 4)
        vertical["mean_height_m"][str(yr)] = round(float(hh[built_now].mean()), 2)
        vertical["max_height_m"][str(yr)] = round(float(hh[built_now].max()), 1)
        vertical["volume_million_m3"][str(yr)] = round(vol, 1)
        vertical["mean_height_existing_m"][str(yr)] = round(float(hh[B[BASE_YEAR]].mean()), 2)
        vertical["volume_from_vertical_million_m3"][str(yr)] = round(float(((hh - h0) * dens_base * B[BASE_YEAR]).sum() * cellkm2), 1)
        # escenario solo población: crece en horizontal, pero las alturas no cambian
        hb = np.where((added_base > 0) & (added_base <= k), h_new, h0)
        built_b = B[BASE_YEAR] | ((added_base > 0) & (added_base <= k))
        wb = np.where(B[BASE_YEAR], dens_base, new_dens_val) * built_b
        vertical["mean_height_m_population_only"][str(yr)] = round(float(hb[built_b].mean()), 2)
        vertical["volume_million_m3_population_only"][str(yr)] = round(float((hb * wb).sum() * cellkm2), 1)
    vertical["sensitivity_volume_2050_million_m3"] = {}
    for th in (0.0, 0.5, 1.0):
        hh, _ = height_at(horizon, BASE_YEAR, h0, h_new, core, added, len(PROJECTION_YEARS), soc, theta=th)
        bn = B[BASE_YEAR] | (added > 0)
        wn = np.where(B[BASE_YEAR], dens_base, new_dens_val) * bn
        vertical["sensitivity_volume_2050_million_m3"][f"theta={th}"] = round(float((hh * wn).sum() * cellkm2), 1)
    print("  vertical: altura media", vertical["mean_height_m"], "m; volumen", vertical["volume_million_m3"], flush=True)

    dens = np.clip(np.round(built_f[BASE_YEAR] * 100), 0, 100)
    dens[~B[BASE_YEAR]] = 0
    conv = np.concatenate([(built_f[t1] * (B[t1] & ~B[t0])).ravel()[(B[t1] & ~B[t0]).ravel()]
                           for t0, t1 in itertools.pairwise(years)])
    new_density = float(np.clip(conv.mean() if len(conv) else 0.7, 0.3, 1.0))

    payload = {
        "id": city_id, "name": c["name"], "lat": c["lat"], "lon": c["lon"],
        "generated": date.today().isoformat(),
        "grid": {"cols": n, "rows": n, "cell_m": CELL_M, "west": w, "south": s, "east": e, "north": nn},
        "base_year": BASE_YEAR, "years": [BASE_YEAR] + PROJECTION_YEARS,
        "density": b64(dens), "added": b64(added), "added_base": b64(added_base), "water": b64(W >= 0.5),
        "height": b64(np.clip(np.round(h0), 0, 255)), "height_new": b64(np.clip(np.round(h_new), 0, 255)),
        "core": b64(np.round(core * 100)), "vertical": vertical,
        "new_cell_density": round(new_density, 2),
        "stats": {
            "built_km2": {str(k): round(v, 1) for k, v in {**{y: area[y] for y in years}, **out_area}.items()},
            "built_km2_population_only": {str(k): round(v, 1) for k, v in out_area_base.items()},
            "urban_population_million": {str(y): round(U[y] / 1e6, 3) for y in sorted(U) if y in set(years + PROJECTION_YEARS)},
            "beta": round(beta_c, 2), "beta_fitted": round(beta, 2),
        },
        "scenarios": {
            "default": "integrated",
            "integrated": "Urban population (UN) × climate migration push × income effect",
            "population_only": "Urban population (UN) only",
        },
        "drivers": {
            "table": drivers_rows,
            "climate": clim,
            "social": {"gdp_growth_per_year": round(soc["gdp_growth"], 4), "agr_employment_change_per_year": round(soc["agr_decline"], 4),
                       "gdp_last_observed": soc["gdp_last_obs"], "agr_last_observed": soc["agr_last_obs"]},
            "assumptions": {"kappa": KAPPA, "gamma": GAMMA, "theta": THETA, "heat_full_c": HEAT_FULL_C, "dry_full_soil": DRY_FULL_SOIL,
                            "dry_full_precip": DRY_FULL_PRECIP, "evidence_weight": EVIDENCE_WEIGHT},
            "sensitivity_built_km2_2050": sensitivity,
        },
        "validation": {
            "fit": f"{y0}→{y1}", "test": f"{y1}→{y2}", "new_cells": n_new,
            "auc": round(auc, 3), "figure_of_merit": round(fom_model, 3),
            "baseline_proximity": round(fom_base, 3), "baseline_random": round(fom_rand, 3),
        },
        "coefficients": coefs,
        "sources": ["Impact Observatory / Esri 10 m Land Use/Land Cover (annual), Microsoft Planetary Computer",
                    "Copernicus DEM GLO-30 (slope)", "JRC GHSL GHS-BUILT-H R2023A (average net building height, 2018)", "UN World Population Prospects via Our World in Data",
                    "NASA POWER (MERRA-2) trends via DATEX engine", "World Bank Open Data (GDP per capita, agricultural employment)"],
        "method": "Cellular automaton with logistic transition probabilities; built area follows (UN urban population x climate push)^beta x (GDP per capita)^gamma.",
        "caveats": ["Scenario, not a forecast: it extends 2017–2023 land-cover trends and ignores urban planning.",
                    "Climate and income effects use explicit scenario assumptions (kappa, gamma), not fitted coefficients.",
                    "A climate trend only counts if it is not suspected to be a data discontinuity (Pettitt) and is weighted by its evidence level.",
                    "Base heights come from GHSL (100 m, 2018, modelled from satellite data); vertical growth follows an explicit income-elasticity assumption (theta) concentrated in the dense core."],
    }
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUT_DIR / f"{city_id}.json"
    path.write_text(json.dumps(payload, separators=(",", ":"), ensure_ascii=False, default=float))
    print(f"-> {path} ({path.stat().st_size // 1024} KB)", flush=True)


if __name__ == "__main__":
    for cid in (sys.argv[1:] or list(CITIES)):
        build(cid)
