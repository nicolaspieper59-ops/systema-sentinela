#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SYSTEMA SENTINELA v9.3.0 — CLOUD-NATIVE ENGINE
"""

import os
import sys
import json
import math
from datetime import datetime, timezone
import numpy as np

try:
    from skyfield.api import Loader, wgs84
except ImportError:
    sys.exit(1)

A_WGS84 = 6378137.0           
F_WGS84 = 1.0 / 298.257223563 
E2_WGS84 = 2.0 * F_WGS84 - F_WGS84**2

def coordonnees_geodesiques_vers_ecef(lat_deg, lon_deg, alt_m):
    lat = math.radians(lat_deg)
    lon = math.radians(lon_deg)
    denom = 1.0 - E2_WGS84 * math.sin(lat)**2
    N = A_WGS84 / math.sqrt(denom)
    x = (N + alt_m) * math.cos(lat) * math.cos(lon)
    y = (N + alt_m) * math.cos(lat) * math.sin(lon)
    z = (N * (1.0 - E2_WGS84) + alt_m) * math.sin(lat)
    return [x, y, z]

def main():
    # Capture du profil passé par le workflow GitHub Actions
    mode_actuel = sys.argv[1].upper() if len(sys.argv) > 1 else "MARSEILLE_FIXE"
    
    LAT_INIT, LON_INIT, ALT_NOMINALE = 43.284356, 5.358507, 99.3100
    pression, temperature, humidite_vapeur, alt_ajustee = 1013.25, 288.15, 12.0, ALT_NOMINALE
    
    if mode_actuel == "AVION":
        alt_ajustee, pression, temperature, humidite_vapeur = 10600.0, 238.4, 218.8, 0.01
    elif mode_actuel == "TRAIN":
        alt_ajustee = ALT_NOMINALE + 20.0
    elif mode_actuel == "BATEAU":
        alt_ajustee, humidite_vapeur = 0.0, 22.0

    loader = Loader(os.getcwd(), verbose=False)
    eph = loader('de421.bsp')
    ts = loader.timescale(builtin=True)
    
    instant_actuel = datetime.now(timezone.utc)
    t = ts.from_datetime(instant_actuel)
    
    pos_ecef = coordonnees_geodesiques_vers_ecef(LAT_INIT, LON_INIT, alt_ajustee)
    station_inst = eph['earth'] + wgs84.latlon(LAT_INIT, LON_INIT, elevation_m=alt_ajustee)

    soleil_obs = eph['earth'].at(t).observe(eph['sun']).apparent()
    ra_sun, _, _ = soleil_obs.radec()
    _, lon_ecliptic, _ = soleil_obs.ecliptic_latlon()
    
    eot_minutes = (lon_ecliptic.degrees / 15.0 - ra_sun.hours) * 60.0
    if eot_minutes > 720.0: eot_minutes -= 1440.0
    elif eot_minutes < -720.0: eot_minutes += 1440.0

    t_centuries = (t.tt - 2451545.0) / 36525.0
    eccentricity = 0.016708634 - 0.000042037 * t_centuries
    obliquity_deg = 23.439291 - 0.013004167 * t_centuries

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
        couchers_lmt[nom] = "SYNCHRONIZED" if nom == 'soleil' else "N/A"

    payload = {
        "METADATA": {
            "infrastructure": "SYSTEMA SENTINELA v9.3.0 — CLOUD-NATIVE",
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

    with open("flux_live.json", "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=4, ensure_ascii=False)

if __name__ == "__main__":
    main()
