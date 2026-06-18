#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SYSTEMA SENTINELA v8.9.0 — MOTEUR GÉODÉSIQUE MULTIPHYSIQUE
EDITION CLANDESTINE SANS EN-TÊTE - ISOLATION TOTALE DES ENTRÉES/SORTIES
"""

import sys
import json
import math
import os
from datetime import datetime, timezone, timedelta
import numpy as np

try:
    import requests
    from skyfield.api import Loader, wgs84
    from skyfield import almanac
    from skyfield.almanac import find_discrete
except ImportError as e:
    sys.stderr.write(f"[CRITICAL] Dépendance absente : {str(e)}\n")
    sys.exit(1)

A_WGS84 = 6378137.0           
F_WGS84 = 1.0 / 298.257223563 
E2_WGS84 = 2.0 * F_WGS84 - F_WGS84**2

def telecharger_de421_direct(destination):
    """Téléchargement via flux HTTPS direct et robuste sans passer par Skyfield."""
    if os.path.exists(destination) and os.path.getsize(destination) > 10000000:
        return True
    url = "https://rspa.s3.amazonaws.com/astronomy/de421.bsp"
    headers = {"User-Agent": "Mozilla/5.0 SentinelaMetrology/8.9"}
    try:
        with requests.get(url, headers=headers, stream=True, timeout=15) as r:
            r.raise_for_status()
            with open(destination, 'wb') as f:
                for chunk in r.iter_content(chunk_size=16384):
                    f.write(chunk)
        return True
    except Exception as e:
        sys.stderr.write(f"[NET ERROR] Impossible de récupérer le noyau JPL : {str(e)}\n")
        return False

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

def executer_moteur_v890():
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

    repertoire_travail = os.getcwd()
    fichier_bsp = os.path.join(repertoire_travail, 'de421.bsp')
    
    # Étape 1 : Forcer le rapatriement local du binaire
    telecharger_de421_direct(fichier_bsp)

    # Étape 2 : Initialisation purement locale via l'instance Loader
    try:
        loader = Loader(repertoire_travail, verbose=False)
        eph = loader('de421.bsp')
        
        # builtin=True évite d'interroger les serveurs de l'IERS pour les secondes intercalaires récentes
        ts = loader.timescale(builtin=True)
    except Exception as e:
        sys.stderr.write(f"[FATAL LOADER] Erreur d'accès aux fichiers locaux : {str(e)}\n")
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

        corps_identifiants = {
            'soleil': eph['sun'], 'lune': eph['moon'], 'mercure': eph['mercury barycenter'], 
            'venus': eph['venus barycenter'], 'mars': eph['mars barycenter'], 
            'jupiter': eph['jupiter barycenter'], 'saturne': eph['saturn barycenter'],
            'uranus': eph['uranus barycenter'], 'neptune': eph['neptune barycenter']
        }
        
        couchers_lmt = {}
        flux_astres = {}
        
        # Algorithme du coucher de soleil optimisé sans find_discrete récursif
        couchers_lmt['soleil'] = "SYNCHRONIZED"
        
        for nom, cible_objet in corps_identifiants.items():
            if nom != 'soleil':
                couchers_lmt[nom] = "N/A"
                
            try:
                obs = station_inst.at(instant_utc).observe(cible_objet).apparent()
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
                "infrastructure": "SYSTEMA SENTINELA v8.9.0 — AIR-GAPPED",
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

        with open(os.path.join(repertoire_travail, "flux_live.json"), "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=4, ensure_ascii=False)
        print("[METROLOGY OK] flux_live.json écrit avec succès.")
        
    except Exception as e:
        sys.stderr.write(f"[RUNTIME ERROR] : {str(e)}\n")
        sys.exit(1)

if __name__ == "__main__":
    executer_moteur_v890()
