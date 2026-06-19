#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SYSTEMA SENTINELA v9.3.5 — NOYAU CLOUD MULTIPHYSIQUE DYNAMIQUE
"""

import os
import sys
import json
import math
from datetime import datetime, timezone

try:
    from skyfield.api import Loader, wgs84
except ImportError:
    sys.stderr.write("[ERROR] Skyfield manquant.\n")
    sys.exit(1)

# Constantes de l'ellipsoïde de référence WGS84
A_WGS84 = 6378137.0           
F_WGS84 = 1.0 / 298.257223563 
E2_WGS84 = 2.0 * F_WGS84 - F_WGS84**2

def coordonnees_geodesiques_vers_ecef(lat_deg, lon_deg, alt_m):
    """Calcule le vecteur de position géocentrique ECEF."""
    lat = math.radians(lat_deg)
    lon = math.radians(lon_deg)
    denom = 1.0 - E2_WGS84 * math.sin(lat)**2
    N = A_WGS84 / math.sqrt(denom)
    x = (N + alt_m) * math.cos(lat) * math.cos(lon)
    y = (N + alt_m) * math.cos(lat) * math.sin(lon)
    z = (N * (1.0 - E2_WGS84) + alt_m) * math.sin(lat)
    return [x, y, z]

def main():
    # Récupération sécurisée de l'argument du profil injecté par GitHub Actions
    if len(sys.argv) > 1:
        mode_actuel = sys.argv[1].upper()
    else:
        mode_actuel = "MARSEILLE_FIXE"
        
    valid_modes = ["MARSEILLE_FIXE", "AVION", "TRAIN", "VOITURE", "BATEAU"]
    if mode_actuel not in valid_modes:
        mode_actuel = "MARSEILLE_FIXE"

    # Coordonnées topocentriques de référence (Marseille)
    LAT_INIT, LON_INIT, ALT_NOMINALE = 43.284356, 5.358507, 99.3100
    alt_ajustee = ALT_NOMINALE
    
    # Paramétrage des couches physiques atmosphériques selon le profil
    if mode_actuel == "AVION":
        alt_ajustee = 10600.0
    elif mode_actuel == "TRAIN":
        alt_ajustee = ALT_NOMINALE + 20.0
    elif mode_actuel == "VOITURE":
        alt_ajustee = ALT_NOMINALE  # Profil urbain au niveau du sol
    elif mode_actuel == "BATEAU":
        alt_ajustee = 0.0           # Niveau moyen des mers

    # Initialisation du chargeur Skyfield autonome
    loader = Loader(os.getcwd(), verbose=False)
    eph = loader('de421.bsp')
    ts = loader.timescale(builtin=True)
    
    instant_actuel = datetime.now(timezone.utc)
    t = ts.from_datetime(instant_actuel)
    
    # Résolution mathématique des repères spatialisés
    pos_ecef = coordonnees_geodesiques_vers_ecef(LAT_INIT, LON_INIT, alt_ajustee)
    station_wgs = wgs84.latlon(LAT_INIT, LON_INIT, elevation_m=alt_ajustee)
    station_inst = eph['earth'] + station_wgs

    # Équation du Temps et mécanique céleste globale
    soleil_obs = eph['earth'].at(t).observe(eph['sun']).apparent()
    ra_sun, _, _ = soleil_obs.radec()
    _, lon_ecliptic, _ = soleil_obs.ecliptic_latlon()
    
    eot_minutes = (lon_ecliptic.degrees / 15.0 - ra_sun.hours) * 60.0
    if eot_minutes > 720.0: eot_minutes -= 1440.0
    elif eot_minutes < -720.0: eot_minutes += 1440.0

    t_centuries = (t.tt - 2451545.0) / 36525.0
    eccentricity = 0.016708634 - 0.000042037 * t_centuries
    obliquity_deg = 23.439291 - 0.013004167 * t_centuries

    # Matrice d'acquisition des astres du système solaire
    corps_celestes = {
        'soleil': eph['sun'], 'lune': eph['moon'], 'mercure': eph['mercury barycenter'],
        'venus': eph['venus barycenter'], 'mars': eph['mars barycenter'],
        'jupiter': eph['jupiter barycenter'], 'saturne': eph['saturn barycenter'],
        'uranus': eph['uranus barycenter'], 'neptune': eph['neptune barycenter']
    }
    
    data_streams = {}
    couchers_lmt = {}
    
    for nom, cible in corps_celestes.items():
        obs_topocentre = station_inst.at(t).observe(cible).apparent()
        alt_brute, az, dist = obs_topocentre.altaz()
        
        data_streams[nom] = {
            "azimut_deg": float(az.degrees),
            "elevation_deg": float(alt_brute.degrees),
            "distance_precision_m": float(dist.m)
        }
        # Marqueur de synchronisation
        couchers_lmt[nom] = "SYNCHRONIZED" if nom == 'soleil' else "N/A"

    # Construction du document de sortie
    payload = {
        "METADATA": {
            "infrastructure": "SYSTEMA SENTINELA v9.3.5 — CLOUD-NATIVE",
            "mode_environnement_execution": mode_actuel,
            "epoch_utc": instant_actuel.isoformat().replace("+00:00", "Z"),
            "equation_of_time_min": float(eot_minutes),
            "eccentricity": float(eccentricity),
            "obliquity_deg": float(obliquity_deg),
            "solar_longitude_deg": float(lon_ecliptic.degrees)
        },
        "COUCHERS_LMT": couchers_lmt,
        "MATRICE_ECEF_REEL": {
            "X_metres": pos_ecef[0], "Y_metres": pos_ecef[1], "Z_metres": pos_ecef[2]
        },
        "DATA_STREAMS": data_streams
    }

    # Écriture physique du fichier tampon
    with open("flux_live.json", "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=4, ensure_ascii=False)
    print(f"[SUCCESS] Flux généré sous le profil {mode_actuel} à l'étape {payload['METADATA']['epoch_utc']}")

if __name__ == "__main__":
    main()
