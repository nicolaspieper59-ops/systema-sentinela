#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SYSTEMA SENTINELA v12.6.2 — NOYAU EXTRACTEUR ITRS TOPOCENTRIQUE SYNCHRONISÉ
Fichier : dynamic_multiphysics_engine.py
Correction : Stabilité d'exécution et robustesse du typage des métadonnées astronomiques
"""
import os
import sys
import json
import time
import math
from datetime import datetime, timedelta, timezone
from skyfield.api import Loader, wgs84
from skyfield.framelib import itrs

def conversion_securisee_float(valeur_str, valeur_secours):
    if not valeur_str or not valeur_str.strip():
        return valeur_secours
    try:
        return float(valeur_str)
    except ValueError:
        return valeur_secours

def main():
    # Coordonnées cibles par défaut : Marseille (Notre-Dame de la Garde)
    lat_target = conversion_securisee_float(sys.argv[1] if len(sys.argv) > 1 else None, 43.284356)
    lon_target = conversion_securisee_float(sys.argv[2] if len(sys.argv) > 2 else None, 5.358507)
    alt_target = conversion_securisee_float(sys.argv[3] if len(sys.argv) > 3 else None, 99.31)
    temp_target = conversion_securisee_float(sys.argv[4] if len(sys.argv) > 4 else None, 31.7)

    loader = Loader(os.getcwd(), verbose=False)
    try:
        eph = loader('de421.bsp')
    except Exception:
        eph = loader('https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/de421.bsp')
        
    ts = loader.timescale(builtin=True)
    aujourdhui = datetime.now(timezone.utc).date()
    date_base = datetime(aujourdhui.year, aujourdhui.month, aujourdhui.day, 0, 0, tzinfo=timezone.utc)

    # Définition de l'observateur topocentrique exact sur la surface terrestre
    station_marseille = wgs84.latlon(lat_target, lon_target, elevation_m=alt_target)

    corps_celestes = {
        'soleil': eph['sun'], 'lune': eph['moon'], 'mercure': eph['mercury barycenter'],
        'venus': eph['venus barycenter'], 'mars': eph['mars barycenter'],
        'jupiter': eph['jupiter barycenter'], 'saturne': eph['saturn barycenter'],
        'uranus': eph['uranus barycenter'], 'neptune': eph['neptune barycenter']
    }

    matrice_24h = {name: [] for name in corps_celestes.keys()}
    metadata_24h = []

    for minute in range(1440):
        instant = date_base + timedelta(minutes=minute)
        t = ts.from_datetime(instant)
        
        # 1. CALCUL DE L'ÉQUATION DU TEMPS HAUTE PRÉCISION (IAU)
        T = (t.tt - 2451545.0) / 36525.0
        L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T**2
        L0_heures = (L0 % 360.0) / 15.0

        sol_geocentrique = eph['earth'].at(t).observe(eph['sun']).apparent()
        ra_sun, _, _ = sol_geocentrique.radec()
        
        eot = (L0_heures - ra_sun.hours) * 60.0  # Résultat en minutes
        if eot > 720.0: eot -= 1440.0
        elif eot < -720.0: eot += 1440.0

        eccentricity = 0.016708634 - 0.000042037 * T
        obliquity = 23.439291 - 0.013004167 * T
        _, lon_ecliptic, _ = sol_geocentrique.ecliptic_latlon()

        metadata_24h.append({
            "m": minute, "eot": float(eot), "ecc": float(eccentricity),
            "obl": float(obliquity), "solong": float(lon_ecliptic.degrees)
        })

        # 2. EXTRACTEUR DES VECTEURS D'ÉTAT GÉOCENTRIQUES ITRS
        position_centre_terre = eph['earth'].at(t)
        for nom, cible in corps_celestes.items():
            astre_apparent = position_centre_terre.observe(cible).apparent()
            x_m, y_m, z_m = astre_apparent.frame_xyz(itrs).m
            matrice_24h[nom].append({"x": float(x_m), "y": float(y_m), "z": float(z_m)})

    now_utc = datetime.now(timezone.utc)
    reference_chrono_ms = int((now_utc - date_base).total_seconds() * 1000)

    payload = {
        "INFRASTRUCTURE": "SYSTEMA SENTINELA v12.6.2",
        "GENERATION_TIMESTAMP_MS": int(time.time() * 1000),
        "REFERENCE_CHRONO_MS": reference_chrono_ms,
        "DATE_REF": aujourdhui.isoformat(),
        "STATION_BASE_GPS": {"lat": lat_target, "lon": lon_target, "alt": alt_target},
        "STATION_BASE_THERMO": {"temp_celsius": temp_target},
        "METADATA_CHRONO": metadata_24h,
        "DATA": matrice_24h
    }

    with open("flux_live.json", "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
    print(f"[SUCCESS] Matrice stabilisée pour Marseille ({lat_target}, {lon_target}) avec {len(metadata_24h)} points.")

if __name__ == "__main__":
    main()
