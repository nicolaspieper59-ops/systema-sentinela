#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SYSTEMA SENTINELA v8.5.9 — MOTEUR GÉODÉSIQUE MULTIPHYSIQUE REFORMATÉ
REDUCTION DE LA CHARGE RE-ROUTAGE DES NOYAUX JPL CP-421
"""

import sys
import json
import math
import os
import ssl
import certifi
from datetime import datetime, timezone, timedelta
import numpy as np
from skyfield.api import load, wgs84
from skyfield.almanac import find_discrete, sunrise_sunset

A_WGS84 = 6378137.0           
F_WGS84 = 1.0 / 298.257223563 
E2_WGS84 = 2.0 * F_WGS84 - F_WGS84**2

def calculer_rayons_courbure(lat_rad):
    denom = 1.0 - E2_WGS84 * math.sin(lat_rad)**2
    return A_WGS84 * (1.0 - E2_WGS84) / (denom * math.sqrt(denom)), A_WGS84 / math.sqrt(denom)

def coordonnees_geodesiques_vers_ecef(lat_deg, lon_deg, alt_m):
    lat = math.radians(lat_deg)
    lon = math.radians(lon_deg)
    _, N = calculer_rayons_courbure(lat)
    x = (N + alt_m) * math.cos(lat) * math.cos(lon)
    y = (N + alt_m) * math.cos(lat) * math.sin(lon)
    z = (N * (1.0 - E2_WGS84) + alt_m) * math.sin(lat)
    return np.array([x, y, z])

def utc_vers_lmt(dt_utc, lon_deg):
    decalage_secondes = (lon_deg / 15.0) * 3600.0
    return dt_utc + timedelta(seconds=decalage_secondes)

def calculer_instant_coucher_lmt(ts, eph, station, cible_name, date_pivot, lon_deg):
    t0 = ts.from_datetime(date_pivot.replace(hour=0, minute=0, second=0, microsecond=0))
    t1 = ts.from_datetime(date_pivot.replace(hour=23, minute=59, second=59, microsecond=0))
    target = eph[cible_name] if cible_name in eph else cible_name
    f = sunrise_sunset(eph, station, target)
    t, y = find_discrete(t0, t1, f)
    
    for ti, yi in zip(t, y):
        if yi == 0:
            return utc_vers_lmt(ti.utc_datetime(), lon_deg).strftime("%H:%M:%S")
    return "N/A"

def executer_moteur_v859():
    mode_recouvrement = sys.argv[1].upper() if len(sys.argv) > 1 else "MARSEILLE_FIXE"
    
    pression_surface, temperature_surface_k, e_vapeur_eau = 1013.25, 288.15, 12.0
    LAT_INIT, LON_INIT, ALT_NOMINALE = 43.284356, 5.358507, 99.3100
    
    if mode_recouvrement == "AVION":
        altitude_geo, pression_surface, temperature_surface_k, e_vapeur_eau = 10600.0, 238.4, 218.8, 0.01
    elif mode_recouvrement == "TRAIN":
        altitude_geo = ALT_NOMINALE + 20.0
    elif mode_recouvrement == "VOITURE":
        altitude_geo = ALT_NOMINALE
    elif mode_recouvrement == "BATEAU":
        altitude_geo, e_vapeur_eau = 0.0, 22.0
    else:
        altitude_geo = ALT_NOMINALE

    try:
        # Forçage des certificats d'environnement d'exécution
        context_ssl = ssl.create_default_context(cafile=certifi.where())
        load_sky = load.build_downloader(verbose=True, context=context_ssl)
        
        # Passage sur de421.bsp (16 Mo) pour éviter le timeout réseau de GitHub
        eph = load_sky('de421.bsp')
        ts = load_sky.timescale(builtin=True)
    except Exception as e:
        sys.stderr.write(f"[FATAL INITIALISATION] Erreur de chargement des noyaux de calcul : {str(e)}\n")
        sys.exit(1)
    
    try:
        epoch_actuelle = datetime.now(timezone.utc)
        instant_utc = ts.from_datetime(epoch_actuelle)
        
        pos_base_m = coordonnees_geodesiques_vers_ecef(LAT_INIT, LON_INIT, altitude_geo)
        station_wgs = wgs84.latlon(LAT_INIT, LON_INIT, elevation_m=altitude_geo)
        station_inst = eph['earth'] + station_wgs

        apparent_sun = eph['earth'].at(instant_utc).observe(eph['sun']).apparent()
        ra_sun, _, _ = apparent_sun.radec()
        _, lon_ecliptic, _ = apparent_sun.ecliptic_latlon()
        
        eot_minutes = (lon_ecliptic.degrees / 15.0 - ra_sun.hours) * 60.0
        if eot_minutes > 720.0: eot_minutes -= 1440.0
        elif eot_minutes < -720.0: eot_minutes += 1440.0

        t_centuries = (instant_utc.tt - 2451545.0) / 36525.0
        eccentricity = 0.016708634 - 0.000042037 * t_centuries
        obliquity_deg = 23.439291 - 0.013004167 * t_centuries

        # Mappage adapté pour la compatibilité de421.bsp
        corps_identifiants = {
            'soleil': 'sun', 'lune': 'moon', 'mercure': 'mercury', 'venus': 'venus',
            'mars': 'mars', 'jupiter': 'jupiter barycenter', 'saturne': 'saturn barycenter',
            'uranus': 'uranus barycenter', 'neptune': 'neptune barycenter'
        }
        
        couchers_lmt = {}
        flux_astres = {}
        
        for nom, id_jpl in corps_identifiants.items():
            try:
                couchers_lmt[nom] = calculer_instant_coucher_lmt(ts, eph, station_wgs, id_jpl, epoch_actuelle, LON_INIT)
            except Exception:
                couchers_lmt[nom] = "N/A"
                
            try:
                obs = station_inst.at(instant_utc).observe(eph[id_jpl]).apparent()
                alt_brute, az, dist = obs.altaz()
                
                E_deg = max(0.01, alt_brute.degrees)
                tan_E = math.tan(math.radians(E_deg))
                delay_dry = 0.002277 * pression_surface
                delay_wet = 0.002277 * (1255.0 / temperature_surface_k + 0.05) * e_vapeur_eau
                refraction_deg = math.degrees((delay_dry + delay_wet) / (tan_E * A_WGS84))
                
                flux_astres[nom] = {
                    "azimut_deg": float(az.degrees),
                    "elevation_deg": float(alt_brute.degrees + refraction_deg),
                    "distance_precision_m": float(dist.m)
                }
            except Exception:
                continue

        payload = {
            "METADATA": {
                "infrastructure": "SYSTEMA SENTINELA v8.5.9 — LIGHTWEIGHT METROLOGY",
                "mode_environnement_execution": mode_recouvrement,
                "epoch_utc": epoch_actuelle.isoformat().replace("+00:00", "Z"),
                "equation_of_time_min": float(eot_minutes),
                "eccentricity": float(eccentricity),
                "obliquity_deg": float(obliquity_deg),
                "solar_longitude_deg": float(lon_ecliptic.degrees)
            },
            "COUCHERS_LMT": couchers_lmt,
            "MATRICE_ECEF_REEL": {
                "X_mètres": float(pos_base_m[0]),
                "Y_mètres": float(pos_base_m[1]),
                "Z_mètres": float(pos_base_m[2])
            },
            "DATA_STREAMS": flux_astres
        }

        with open("flux_live.json", "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=4, ensure_ascii=False)
        print("[METROLOGY OK] flux_live.json généré.")
        
    except Exception as e:
        sys.stderr.write(f"[FATAL CALCUL] Erreur durant l'exécution mathématique : {str(e)}\n")
        sys.exit(1)

if __name__ == "__main__":
    executer_moteur_v859()
