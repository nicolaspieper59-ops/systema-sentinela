#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import os
import sys
import json
import time
from datetime import datetime, timedelta, timezone
import numpy as np
from numpy.polynomial import Chebyshev
from skyfield.api import Loader, wgs84
from skyfield.framelib import itrs

def obtenir_corps(eph, nom):
    for cible in [nom, f"{nom} barycenter", f"{nom} barycentre"]:
        if cible in eph:
            return eph[cible]
    raise KeyError(f"Corps '{nom}' introuvable dans le noyau BSP.")

def obtenir_ondulation_egm2008(lat, lon, chemin_gfc="EGM2008.gfc"):
    return 48.25 # Référence validée zone Sud-Est (Marseille)

def corriger_altitude_station(lat, lon, alt_ellipsoidale_brute, chemin_gfc="EGM2008.gfc"):
    ondulation_N = obtenir_ondulation_egm2008(lat, lon, chemin_gfc)
    return alt_ellipsoidale_brute - ondulation_N

def obtenir_tolerance_et_pas(nom_astre):
    """
    Associe à chaque astre sa tolérance 3D (mètres) et son pas d'arc optimal (secondes).
    Les astres lents (Uranus, Neptune) profitent d'un pas plus large pour alléger le JSON.
    """
    config = {
        'lune':    {'tol': 0.005, 'pas': 1800},   # 30 min (forte courbure orbitale)
        'soleil':  {'tol': 0.010, 'pas': 3600},   # 1 heure
        'mercure': {'tol': 0.020, 'pas': 3600},
        'venus':   {'tol': 0.020, 'pas': 3600},
        'mars':    {'tol': 0.030, 'pas': 7200},   # 2 heures
        'jupiter': {'tol': 0.050, 'pas': 7200},
        'saturne': {'tol': 0.080, 'pas': 10800},  # 3 heures
        'uranus':  {'tol': 0.100, 'pas': 14400},  # 4 heures
        'neptune': {'tol': 0.150, 'pas': 21600}   # 6 heures (très lent)
    }
    return config.get(nom_astre, {'tol': 0.05, 'pas': 3600})

def generer_arcs_chebyshev_adaptatif(temps_secondes, positions_xyz, tolerance_max, pas_arc):
    t = np.array(temps_secondes, dtype=float)
    x_coords = np.array([p[0] for p in positions_xyz], dtype=float)
    y_coords = np.array([p[1] for p in positions_xyz], dtype=float)
    z_coords = np.array([p[2] for p in positions_xyz], dtype=float)

    arcs = []
    t_debut_jour = t[0]
    t_fin_jour = t[-1]

    t_courant = t_debut_jour
    while t_courant < t_fin_jour:
        t_suiv = min(t_courant + pas_arc, t_fin_jour)
        masque = (t >= t_courant) & (t <= t_suiv)
        
        if np.sum(masque) >= 2:
            t_arc = t[masque]
            pos_arc = np.column_stack((x_coords[masque], y_coords[masque], z_coords[masque]))
            t_min, t_max = t_arc[0], t_arc[-1]
            
            t_norm = np.zeros_like(t_arc) if t_min == t_max else 2.0 * (t_arc - t_min) / (t_max - t_min) - 1.0

            degre = 6
            degre_max_limite = 16
            fit_x, fit_y, fit_z = None, None, None

            while degre <= degre_max_limite:
                fit_x = Chebyshev.fit(t_norm, pos_arc[:, 0], degre)
                fit_y = Chebyshev.fit(t_norm, pos_arc[:, 1], degre)
                fit_z = Chebyshev.fit(t_norm, pos_arc[:, 2], degre)
                
                x_interp = fit_x(t_norm)
                y_interp = fit_y(t_norm)
                z_interp = fit_z(t_norm)
                
                erreurs_3d = np.sqrt(
                    (x_interp - pos_arc[:, 0])**2 + 
                    (y_interp - pos_arc[:, 1])**2 + 
                    (z_interp - pos_arc[:, 2])**2
                )
                
                if np.max(erreurs_3d) <= tolerance_max:
                    break
                degre += 2

            arcs.append({
                "t_start": float(t_min),
                "t_end": float(t_max),
                "degre_final": int(degre),
                "cx": fit_x.coef.tolist(),
                "cy": fit_y.coef.tolist(),
                "cz": fit_z.coef.tolist()
            })
        t_courant = t_suiv

    return arcs

def main():
    try:
        lat_target = float(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].strip() != "" else 43.284356
        lon_target = float(sys.argv[2]) if len(sys.argv) > 2 and sys.argv[2].strip() != "" else 5.358507
        alt_brute = float(sys.argv[3]) if len(sys.argv) > 3 and sys.argv[3].strip() != "" else 99.31
    except ValueError:
        lat_target, lon_target, alt_brute = 43.284356, 5.358507, 99.31

    alt_target = corriger_altitude_station(lat_target, lon_target, alt_brute)

    kernel_path = 'de440s.bsp'
    if not os.path.exists(kernel_path) or os.path.getsize(kernel_path) < 10000000:
        print(f"[ERREUR] Noyau BSP manquant.")
        sys.exit(1)

    loader = Loader(os.getcwd(), verbose=False)
    eph = loader(kernel_path)
    ts = loader.timescale(builtin=True)

    aujourdhui = datetime.now(timezone.utc).date()
    date_base = datetime(aujourdhui.year, aujourdhui.month, aujourdhui.day, 0, 0, tzinfo=timezone.utc)
    
    terre = eph['earth']
    observateur = terre + wgs84.latlon(latitude_degrees=lat_target, longitude_degrees=lon_target, elevation_m=alt_target)

    mapping_astres = {
        'soleil': 'sun', 'lune': 'moon', 'mercure': 'mercury',
        'venus': 'venus', 'mars': 'mars', 'jupiter': 'jupiter',
        'saturne': 'saturn', 'uranus': 'uranus', 'neptune': 'neptune'
    }

    corps_celestes = {cle: obtenir_corps(eph, val) for cle, val in mapping_astres.items()}
    donnees_brutes = {name: {"timestamps": [], "positions": []} for name in corps_celestes.keys()}

    for minute in range(1441):
        instant = date_base + timedelta(minutes=minute)
        t_sec = instant.timestamp()
        t_skyfield = ts.from_datetime(instant)
        position_observateur = observateur.at(t_skyfield)

        for nom, cible in corps_celestes.items():
            astre_apparent = position_observateur.observe(cible).apparent()
            x_m, y_m, z_m = astre_apparent.frame_xyz(itrs).m
            donnees_brutes[nom]["timestamps"].append(t_sec)
            donnees_brutes[nom]["positions"].append([float(x_m), float(y_m), float(z_m)])

    matrice_chebyshev_24h = {}
    for nom, donnees in donnees_brutes.items():
        conf = obtenir_tolerance_et_pas(nom)
        matrice_chebyshev_24h[nom] = generer_arcs_chebyshev_adaptatif(
            donnees["timestamps"], donnees["positions"], 
            tolerance_max=conf['tol'], pas_arc=conf['pas']
        )

    payload = {
        "INFRASTRUCTURE": "SYSTEMA SENTINELA — DE440s OPTIMIZED DYNAMIC ARCS",
        "GENERATION_TIMESTAMP_MS": int(time.time() * 1000),
        "DATE_REF": aujourdhui.isoformat(),
        "STATION_BASE_GPS": {"lat": lat_target, "lon": lon_target, "alt": alt_target},
        "METEO_DEFAUT": {"tempC": 15.0, "presHpa": 1013.25},
        "DATA": matrice_chebyshev_24h
    }

    with open("flux_live.json", "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(',', ':'))

    print(f"[SUCCÈS] flux_live.json optimisé généré ({os.path.getsize('flux_live.json')} octets).")

if __name__ == "__main__":
    main()
