#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import os
import sys
import json
import time
from datetime import datetime, timedelta, timezone
import numpy as np
from numpy.polynomial import Chebyshev
from skyfield.api import Loader
from skyfield.framelib import itrs
from skyfield import almanac

def obtenir_ondulation_egm2008_approchee(lat, lon):
    rad_lat = np.radians(lat)
    rad_lon = np.radians(lon)
    return 17.0 * np.sin(rad_lat) - 11.0 * np.cos(2.0 * rad_lon) + 3.0 * np.sin(3.0 * rad_lat)

def generer_arcs_chebyshev_adaptatif(temps_secondes, positions_xyz, tolerance_max, pas_arc):
    t = np.array(temps_secondes, dtype=float)
    x_coords = np.array([p[0] for p in positions_xyz], dtype=float)
    y_coords = np.array([p[1] for p in positions_xyz], dtype=float)
    z_coords = np.array([p[2] for p in positions_xyz], dtype=float)

    arcs = []
    t_courant = t[0]
    t_fin = t[-1]

    while t_courant < t_fin:
        t_suiv = min(t_courant + pas_arc, t_fin)
        masque = (t >= t_courant) & (t <= t_suiv)
        
        if np.sum(masque) >= 2:
            t_arc = t[masque]
            pos_arc = np.column_stack((x_coords[masque], y_coords[masque], z_coords[masque]))
            t_min, t_max = t_arc[0], t_arc[-1]
            t_norm = np.zeros_like(t_arc) if t_min == t_max else 2.0 * (t_arc - t_min) / (t_max - t_min) - 1.0

            degre = 6
            while degre <= 16:
                fit_x = Chebyshev.fit(t_norm, pos_arc[:, 0], degre)
                fit_y = Chebyshev.fit(t_norm, pos_arc[:, 1], degre)
                fit_z = Chebyshev.fit(t_norm, pos_arc[:, 2], degre)
                err_3d = np.sqrt((fit_x(t_norm) - pos_arc[:, 0])**2 + 
                                 (fit_y(t_norm) - pos_arc[:, 1])**2 + 
                                 (fit_z(t_norm) - pos_arc[:, 2])**2)
                if np.max(err_3d) <= tolerance_max:
                    break
                degre += 2

            arcs.append({
                "t_start": float(t_min), "t_end": float(t_max),
                "degre_final": int(degre),
                "cx": fit_x.coef.tolist(), "cy": fit_y.coef.tolist(), "cz": fit_z.coef.tolist()
            })
        t_courant = t_suiv
    return arcs

def main():
    lat_target = float(sys.argv[1]) if len(sys.argv) > 1 else 43.284356
    lon_target = float(sys.argv[2]) if len(sys.argv) > 2 else 5.358507
    alt_brute = float(sys.argv[3]) if len(sys.argv) > 3 else 49.81
    
    # Gestion de l'argument optionnel --days
    jours_total = 7
    if "--days" in sys.argv:
        try:
            jours_total = int(sys.argv[sys.argv.index("--days") + 1])
        except (ValueError, IndexError):
            pass

    alt_ortho = alt_brute - obtenir_ondulation_egm2008_approchee(lat_target, lon_target)
    kernel_path = 'de440s.bsp'
    if not os.path.exists(kernel_path):
        sys.exit(1)

    loader = Loader(os.getcwd(), verbose=False)
    eph = loader(kernel_path)
    ts = loader.timescale(builtin=True)

    aujourdhui = datetime.now(timezone.utc).date()
    date_base = datetime(aujourdhui.year, aujourdhui.month, aujourdhui.day, 0, 0, tzinfo=timezone.utc)
    terre = eph['earth']

    mapping_astres = {
        'soleil': ('sun', -26.74), 'lune': ('moon', -12.74),
        'mercure': ('mercury', -0.42), 'venus': ('venus', -4.40),
        'mars': ('mars', -1.52), 'jupiter': ('jupiter', -2.20),
        'saturne': ('saturn', 0.46), 'uranus': ('uranus', 5.68),
        'neptune': ('neptune', 7.78)
    }

    donnees_brutes = {name: {"timestamps": [], "positions": [], "mag": mag} for name, (_, mag) in mapping_astres.items()}

    total_minutes = jours_total * 1440 + 1
    for minute in range(0, total_minutes, 10): # Échantillonnage optimisé à 10 min pour tenir sur 7 jours
        instant = date_base + timedelta(minutes=minute)
        t_sec = instant.timestamp()
        t_skyfield = ts.from_datetime(instant)

        for nom, (code_jpl, _) in mapping_astres.items():
            corps = eph[code_jpl] if code_jpl in eph else eph[f"{code_jpl} barycenter"]
            pos_geocentrique = terre.at(t_skyfield).observe(corps).apparent()
            x_m, y_m, z_m = pos_geocentrique.frame_xyz(itrs).m

            donnees_brutes[nom]["timestamps"].append(t_sec)
            donnees_brutes[nom]["positions"].append([float(x_m), float(y_m), float(z_m)])

    matrice_chebyshev = {}
    for nom, donnees in donnees_brutes.items():
        arcs = generer_arcs_chebyshev_adaptatif(donnees["timestamps"], donnees["positions"], 0.05, 14400)
        for arc in arcs:
            arc["mag"] = donnees["mag"]
        matrice_chebyshev[nom] = arcs

    # --- CALCUL DES ÉPHÉMÉRIDES ALMANACH (Phases lunaires & Saisons) ---
    t0 = ts.utc(aujourdhui.year, aujourdhui.month, aujourdhui.day)
    t1 = ts.utc(aujourdhui.year + 1, aujourdhui.month, aujourdhui.day)

    try:
        phases, valeurs_phases = almanac.find_discrete(t0, t1, almanac.moon_phases(eph))
        next_new_moon = next((t.utc_iso() for t, v in zip(phases, valeurs_phases) if v == 0), "--")
        next_full_moon = next((t.utc_iso() for t, v in zip(phases, valeurs_phases) if v == 2), "--")
    except Exception:
        next_new_moon, next_full_moon = "--", "--"

    try:
        saisons, valeurs_saisons = almanac.find_discrete(t0, t1, almanac.seasons(eph))
        eq_mar = next((t.utc_iso() for t, v in zip(saisons, valeurs_saisons) if v == 0), "--")
        sol_jun = next((t.utc_iso() for t, v in zip(saisons, valeurs_saisons) if v == 1), "--")
        eq_sep = next((t.utc_iso() for t, v in zip(saisons, valeurs_saisons) if v == 2), "--")
        sol_dec = next((t.utc_iso() for t, v in zip(saisons, valeurs_saisons) if v == 3), "--")
    except Exception:
        eq_mar, sol_jun, eq_sep, sol_dec = "--", "--", "--", "--"

    payload = {
        "INFRASTRUCTURE": f"SYSTEMA SENTINELA — DE440s GEOCENTRIC ({jours_total} JOURS HORS-LIGNE)",
        "GENERATION_TIMESTAMP_MS": int(time.time() * 1000),
        "DATE_REF": aujourdhui.isoformat(),
        "STATION_BASE_GPS": {"lat": lat_target, "lon": lon_target, "alt": alt_ortho},
        "METEO_DEFAUT": {"tempC": 15.0, "presHpa": 1013.25},
        "ALMANAC": {
            "NEXT_NEW_MOON": next_new_moon,
            "NEXT_FULL_MOON": next_full_moon,
            "MAR_EQUINOX": eq_mar,
            "JUN_SOLSTICE": sol_jun,
            "SEP_EQUINOX": eq_sep,
            "DEC_SOLSTICE": sol_dec
        },
        "DATA": matrice_chebyshev
    }

    with open("flux_live.json", "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(',', ':'))

if __name__ == "__main__":
    main()
