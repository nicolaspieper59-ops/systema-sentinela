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

def obtenir_meteo_reelle():
    return {
        "tempC": 18.5,
        "presHpa": 1018.5,
        "extinctionCoeff": 0.25
    }

def main():
    lat_target = float(sys.argv[1]) if len(sys.argv) > 1 else 43.284356
    lon_target = float(sys.argv[2]) if len(sys.argv) > 2 else 5.358507
    alt_brute = float(sys.argv[3]) if len(sys.argv) > 3 else 49.81
    
    jours_total = 7
    if "--days" in sys.argv:
        try:
            jours_total = int(sys.argv[sys.argv.index("--days") + 1])
        except (ValueError, IndexError):
            pass

    meteo = obtenir_meteo_reelle()

    kernel_path = 'de440s.bsp'
    if not os.path.exists(kernel_path):
        sys.exit(1)

    loader = Loader(os.getcwd(), verbose=False)
    eph = loader(kernel_path)
    ts = loader.timescale(builtin=True)

    aujourdhui = datetime.now(timezone.utc).date()
    date_base = datetime(aujourdhui.year, aujourdhui.month, aujourdhui.day, 0, 0, tzinfo=timezone.utc)
    terre = eph['earth']

    # --- CALCUL DE L'ALMANACH EXACT (Phases & Saisons) ---
    t0 = ts.from_datetime(date_base)
    t1 = ts.from_datetime(date_base + timedelta(days=jours_total))

    # Phases lunaires
    phases_idx, phases_t = almanac.find_moon_phases(eph, t0, t1)
    phase_noms = ["Nouvelle Lune", "Premier Quartier", "Pleine Lune", "Dernier Quartier"]
    lune_phases_events = []
    for p_idx, p_t in zip(phases_idx, phases_t):
        lune_phases_events.append({
            "type": int(p_idx),
            "nom": phase_noms[p_idx],
            "utc": p_t.utc_iso(),
            "timestamp": p_t.utc_datetime().timestamp()
        })

    # Saisons astronomiques
    seasons_idx, seasons_t = almanac.find_seasons(eph, t0, t1)
    season_noms = ["Équinoxe de Printemps", "Solstice d'Été", "Équinoxe d'Automne", "Solstice d'Hiver"]
    seasons_events = []
    for s_idx, s_t in zip(seasons_idx, seasons_t):
        seasons_events.append({
            "type": int(s_idx),
            "nom": season_noms[s_idx],
            "utc": s_t.utc_iso(),
            "timestamp": s_t.utc_datetime().timestamp()
        })

    mapping_astres = {
        'soleil': ('sun', -26.74), 'lune': ('moon', -12.74),
        'mercure': ('mercury', -0.42), 'venus': ('venus', -4.40),
        'mars': ('mars', -1.52), 'jupiter': ('jupiter', -2.20),
        'saturne': ('saturn', 0.46), 'uranus': ('uranus', 5.68),
        'neptune': ('neptune', 7.78)
    }

    donnees_brutes = {name: {"timestamps": [], "positions": [], "mag": mag} for name, (_, mag) in mapping_astres.items()}

    total_minutes = jours_total * 1440 + 1
    for minute in range(0, total_minutes, 10):
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
        t_arr = np.array(donnees["timestamps"], dtype=float)
        x_c = np.array([p[0] for p in donnees["positions"]], dtype=float)
        y_c = np.array([p[1] for p in donnees["positions"]], dtype=float)
        z_c = np.array([p[2] for p in donnees["positions"]], dtype=float)

        arcs = []
        t_courant = t_arr[0]
        t_fin = t_arr[-1]
        pas_arc = 14400

        while t_courant < t_fin:
            t_suiv = min(t_courant + pas_arc, t_fin)
            masque = (t_arr >= t_courant) & (t_arr <= t_suiv)
            if np.sum(masque) >= 2:
                t_arc = t_arr[masque]
                pos_arc = np.column_stack((x_c[masque], y_c[masque], z_c[masque]))
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
                    if np.max(err_3d) <= 0.05:
                        break
                    degre += 2

                arcs.append({
                    "t_start": float(t_min), "t_end": float(t_max),
                    "degre_final": int(degre),
                    "cx": fit_x.coef.tolist(), "cy": fit_y.coef.tolist(), "cz": fit_z.coef.tolist(),
                    "mag": donnees["mag"]
                })
            t_courant = t_suiv
        matrice_chebyshev[nom] = arcs

    payload = {
        "INFRASTRUCTURE": f"SYSTEMA SENTINELA — STELLARIUM-GRADE ATMOSPHERE ({jours_total} JOURS)",
        "GENERATION_TIMESTAMP_MS": int(time.time() * 1000),
        "STATION_BASE_GPS": {"lat": lat_target, "lon": lon_target, "alt": alt_brute},
        "METEO_REELLE": meteo,
        "ALMANACH": {
            "phases_lunaires": lune_phases_events,
            "saisons": seasons_events
        },
        "DATA": matrice_chebyshev
    }

    with open("flux_live.json", "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(',', ':'))
    print("flux_live.json généré avec les éphémérides DE440s et l'almanach complet.")

if __name__ == "__main__":
    main()
