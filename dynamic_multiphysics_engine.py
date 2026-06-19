#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SYSTEMA SENTINELA v10.0.0 — NOYAU DE COMPUTATION ASTROMÉTRIQUE PUR
"""

import os
import sys
import json
import math
from datetime import datetime, timezone

try:
    from skyfield.api import Loader, wgs84
    from skyfield.data import mpc
except ImportError:
    sys.exit(1)

# Paramètres Ellipsoïde WGS84
A_WGS84 = 6378137.0
F_WGS84 = 1.0 / 298.257223563
E2_WGS84 = 2.0 * F_WGS84 - F_WGS84**2

def generer_atmosphere_isa(alt_m):
    """Calcule les conditions thermodynamiques réelles (Modèle standard ISA continu)."""
    T0, L, P0 = 288.15, 0.0065, 1013.25
    g, M, R = 9.80665, 0.0289644, 8.31447
    
    h = max(0.0, min(alt_m, 11000.0)) # Limite troposphérique
    T = T0 - L * h
    exponent = (g * M) / (R * L)
    P = P0 * math.pow((1.0 - (L * h) / T0), exponent)
    return P, T

def geodesie_vers_ecef(lat_deg, lon_deg, alt_m):
    lat, lon = math.radians(lat_deg), math.radians(lon_deg)
    denom = 1.0 - E2_WGS84 * math.sin(lat)**2
    N = A_WGS84 / math.sqrt(denom)
    x = (N + alt_m) * math.cos(lat) * math.cos(lon)
    y = (N + alt_m) * math.cos(lat) * math.sin(lon)
    z = (N * (1.0 - E2_WGS84) + alt_m) * math.sin(lat)
    return [x, y, z]

def main():
    # Parsing des coordonnées géodésiques réelles
    lat_target = float(sys.argv[1]) if len(sys.argv) > 1 else 43.284356
    lon_target = float(sys.argv[2]) if len(sys.argv) > 2 else 5.358507
    alt_target = float(sys.argv[3]) if len(sys.argv) > 3 else 99.3100

    # Génération des conditions du milieu physique
    pression, temperature = generer_atmosphere_isa(alt_target)

    loader = Loader(os.getcwd(), verbose=False)
    eph = loader('de421.bsp')
    ts = loader.timescale(builtin=True)
    
    instant_actuel = datetime.now(timezone.utc)
    t = ts.from_datetime(instant_actuel)
    
    pos_ecef = geodesie_vers_ecef(lat_target, lon_target, alt_target)
    station_wgs = wgs84.latlon(lat_target, lon_target, elevation_m=alt_target)
    station_inst = eph['earth'] + station_wgs

    # Équation du temps et variables écliptiques rigoureuses
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
        # .apparent() applique l'aberration, la déflexion relativiste et la précession/nutation
        obs_topocentre = station_inst.at(t).observe(cible).apparent()
        alt_brute, az, dist = obs_topocentre.altaz()
        
        # Réfraction physique (Loi de Bennett corrigée en pression/température de la position)
        alt_corrigee = alt_brute.degrees
        if alt_brute.degrees > -0.833:
            R0 = 1.02 / math.tan(math.radians(alt_brute.degrees + 10.3 / (alt_brute.degrees + 5.11)))
            corr_atmo = R0 * (pression / 1013.25) * (283.15 / temperature)
            alt_corrigee += corr_atmo / 60.0

        data_streams[nom] = {
            "azimut_deg": float(az.degrees),
            "elevation_deg": float(alt_corrigee),
            "distance_precision_m": float(dist.m)
        }
        couchers_lmt[nom] = "SYNCHRONIZED" if nom == 'soleil' else "N/A"

    payload = {
        "METADATA": {
            "infrastructure": "SYSTEMA SENTINELA v10.0.0 — 3D LIVE ENGINE",
            "mode_environnement_execution": f"AUTOPOS_3D (H:{alt_target:.1f}m)",
            "epoch_utc": instant_actuel.isoformat().replace("+00:00", "Z"),
            "equation_of_time_min": float(eot_minutes),
            "eccentricity": float(eccentricity),
            "obliquity_deg": float(obliquity_deg),
            "solar_longitude_deg": float(lon_ecliptic.degrees),
            "coordonnees_station": {"lat": lat_target, "lon": lon_target, "alt": alt_target}
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
