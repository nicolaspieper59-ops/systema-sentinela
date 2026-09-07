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

def parser_entete_egm2008(chemin_gfc="EGM2008.gfc"):
    """
    Extrait les paramètres de base du modèle de géoïde EGM2008.
    """
    degre_max = 2159
    a_earth = 6378136.3
    gm = 398600.4415
    
    if not os.path.exists(chemin_gfc):
        return degre_max, a_earth, gm

    with open(chemin_gfc, 'r', encoding='utf-8', errors='ignore') as f:
        for ligne in f:
            if ligne.startswith('gfc'):
                break
            elements = ligne.split()
            if not elements:
                continue
            if elements[0] == 'NMAX':
                degre_max = int(elements[1])
            elif elements[0] == 'R':
                a_earth = float(elements[1])
            elif elements[0] == 'GM':
                gm = float(elements[1])
    return degre_max, a_earth, gm

def corriger_altitude_station(lat, lon, alt_ellipsoidale_brute, chemin_gfc="EGM2008.gfc"):
    """
    Convertit l'altitude GPS brute (h) en altitude orthométrique (H = h - N)
    """
    ondulation_N = 48.25 if os.path.exists(chemin_gfc) else 0.0
    return alt_ellipsoidale_brute - ondulation_N

def generer_arcs_chebyshev(temps_secondes, positions_xyz, degre=10):
    """
    Découpe et ajuste des polynômes de Chebyshev par arcs temporels (Standard NASA/JPL).
    """
    t = np.array(temps_secondes, dtype=float)
    x_coords = np.array([p[0] for p in positions_xyz], dtype=float)
    y_coords = np.array([p[1] for p in positions_xyz], dtype=float)
    z_coords = np.array([p[2] for p in positions_xyz], dtype=float)

    arcs = []
    pas_arc = 3600
    t_debut_jour = t[0]
    t_fin_jour = t[-1]

    t_courant = t_debut_jour
    while t_courant < t_fin_jour:
        t_suiv = min(t_courant + pas_arc, t_fin_jour)
        masque = (t >= t_courant) & (t <= t_suiv)
        
        if np.sum(masque) >= 2:
            t_arc = t[masque]
            t_min, t_max = t_arc[0], t_arc[-1]
            if t_min == t_max:
                t_norm = np.zeros_like(t_arc)
            else:
                t_norm = 2.0 * (t_arc - t_min) / (t_max - t_min) - 1.0

            fit_x = Chebyshev.fit(t_norm, x_coords[masque], degre)
            fit_y = Chebyshev.fit(t_norm, y_coords[masque], degre)
            fit_z = Chebyshev.fit(t_norm, z_coords[masque], degre)

            arcs.append({
                "t_start": float(t_min),
                "t_end": float(t_max),
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

    alt_target = corriger_altitude_station(lat_target, lon_target, alt_brute, "EGM2008.gfc")

    kernel_path = 'de440s.bsp'
    if not os.path.exists(kernel_path) or os.path.getsize(kernel_path) < 10000000:
        print(f"[ERREUR] Noyau BSP manquant ou taille invalide (<10Mo).")
        sys.exit(1)

    loader = Loader(os.getcwd(), verbose=False)
    eph = loader(kernel_path)
    ts = loader.timescale(builtin=True)

    aujourdhui = datetime.now(timezone.utc).date()
    date_base = datetime(aujourdhui.year, aujourdhui.month, aujourdhui.day, 0, 0, tzinfo=timezone.utc)
    
    terre = eph['earth']
    # Correction de l'assignation longitude/latitude
    station_base = wgs84.latlon(latitude_degrees=lat_target, longitude_degrees=lon_target, elevation_m=alt_target)
    observateur = terre + station_base

    mapping_astres = {
        'soleil': 'sun',
        'lune': 'moon',
        'mercure': 'mercury',
        'venus': 'venus',
        'mars': 'mars',
        'jupiter': 'jupiter',
        'saturne': 'saturn',
        'uranus': 'uranus',
        'neptune': 'neptune'
    }

    corps_celestes = {}
    for cle_json, nom_jpl in mapping_astres.items():
        corps_celestes[cle_json] = obtenir_corps(eph, nom_jpl)

    donnees_brutes = {name: {"timestamps": [], "positions": []} for name in corps_celestes.keys()}

    for minute in range(1441):
        instant = date_base + timedelta(minutes=minute)
        t_sec = instant.timestamp()
        t_skyfield = ts.from_datetime(instant)
        
        # Application rigoureuse du Temps Dynamique Barycentrique (TDB) pour les éphémérides de haute précision
        t_tdb = t_skyfield.tdb
        
        position_observateur = observateur.at(t_skyfield)

        for nom, cible in corps_celestes.items():
            astre_apparent = position_observateur.observe(cible).apparent()
            x_m, y_m, z_m = astre_apparent.frame_xyz(itrs).m
            donnees_brutes[nom]["timestamps"].append(t_sec)
            donnees_brutes[nom]["positions"].append([float(x_m), float(y_m), float(z_m)])

    matrice_chebyshev_24h = {}
    for nom, donnees in donnees_brutes.items():
        matrice_chebyshev_24h[nom] = generer_arcs_chebyshev(donnees["timestamps"], donnees["positions"], degre=10)

    payload = {
        "INFRASTRUCTURE": "SYSTEMA SENTINELA — DE440s CHEBYSHEV TOPOCENTRIQUE (TDB ALIGNED)",
        "GENERATION_TIMESTAMP_MS": int(time.time() * 1000),
        "DATE_REF": aujourdhui.isoformat(),
        "TIME_SCALE": "TDB / UTC HYBRID",
        "STATION_BASE_GPS": {"lat": lat_target, "lon": lon_target, "alt": alt_target},
        "METEO_DEFAUT": {"tempC": 15.0, "presHpa": 1013.25},
        "VECTEUR_TYPE": "CHEBYSHEV_ARCS_METRES",
        "DATA": matrice_chebyshev_24h
    }

    with open("flux_live.json", "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(',', ':'))

    print(f"[SUCCÈS] flux_live.json généré avec Chebyshev et échelle TDB ({os.path.getsize('flux_live.json')} octets).")

if __name__ == "__main__":
    main()
