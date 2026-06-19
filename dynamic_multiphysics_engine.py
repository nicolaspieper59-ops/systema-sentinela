#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SYSTEMA SENTINELA v10.6.0 — NOYAU EXTRACTEUR VECTORIEL ITRS DE421 SANS SIMPLIFICATION
"""

import os
import sys
import json
import math
from datetime import datetime, timedelta, timezone
from skyfield.api import Loader
from skyfield.framelib import itrs

def conversion_securisee_float(valeur_str, valeur_secours):
    if not valeur_str or not valeur_str.strip():
        return valeur_secours
    try:
        return float(valeur_str)
    except ValueError:
        return valeur_secours

def main():
    lat_target = conversion_securisee_float(sys.argv[1] if len(sys.argv) > 1 else None, 43.284356)
    lon_target = conversion_securisee_float(sys.argv[2] if len(sys.argv) > 2 else None, 5.358507)
    alt_target = conversion_securisee_float(sys.argv[3] if len(sys.argv) > 3 else None, 99.3100)

    loader = Loader(os.getcwd(), verbose=False)
    eph = loader('de421.bsp')
    ts = loader.timescale(builtin=True)

    aujourdhui = datetime.now(timezone.utc).date()
    date_base = datetime(aujourdhui.year, aujourdhui.month, aujourdhui.day, 0, 0, tzinfo=timezone.utc)

    corps_celestes = {
        'soleil': eph['sun'], 'lune': eph['moon'], 'mercure': eph['mercury barycenter'],
        'venus': eph['venus barycenter'], 'mars': eph['mars barycenter'],
        'jupiter': eph['jupiter barycenter'], 'saturne': eph['saturn barycenter'],
        'uranus': eph['uranus barycenter'], 'neptune': eph['neptune barycenter']
    }

    matrice_24h = {name: [] for name in corps_celestes.keys()}
    metadata_24h = []

    print(f"[JPL INTEGRITY] Génération des tenseurs de précision ITRS pour la date du : {aujourdhui}")

    for minute in range(1440):
        instant = date_base + timedelta(minutes=minute)
        t = ts.from_datetime(instant)
        terre_position = eph['earth'].at(t)

        # Calcul des caractéristiques globales de l'écliptique à cette minute exacte
        soleil_obs = terre_position.observe(eph['sun']).apparent()
        ra_sun, _, _ = soleil_obs.radec()
        _, lon_ecliptic, _ = soleil_obs.ecliptic_latlon()
        
        eot = (lon_ecliptic.degrees / 15.0 - ra_sun.hours) * 60.0
        if eot > 720.0: eot -= 1440.0
        elif eot < -720.0: eot += 1440.0

        t_siecles = (t.tt - 2451545.0) / 36525.0
        eccentricity = 0.016708634 - 0.000042037 * t_siecles
        obliquity = 23.439291 - 0.013004167 * t_siecles

        metadata_24h.append({
            "m": minute,
            "eot": float(eot),
            "ecc": float(eccentricity),
            "obl": float(obliquity),
            "solong": float(lon_ecliptic.degrees)
        })

        # Extraction vectorielle tridimensionnelle pure
        for nom, cible in corps_celestes.items():
            astre_apparent = terre_position.observe(cible).apparent()
            x_m, y_m, z_m = astre_apparent.frame_xyz(itrs).m

            matrice_24h[nom].append({
                "x": float(x_m),
                "y": float(y_m),
                "z": float(z_m)
            })

    payload = {
        "INFRASTRUCTURE": "SYSTEMA SENTINELA INTERFACE v10.6.0",
        "DATE_REF": aujourdhui.isoformat(),
        "EPOCH_GENERATION": datetime.now(timezone.utc).isoformat(),
        "STATION_BASE_GPS": {"lat": lat_target, "lon": lon_target, "alt": alt_target},
        "METADATA_CHRONO": metadata_24h,
        "DATA": matrice_24h
    }

    with open("flux_live.json", "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
    print("[SUCCESS] Matrice multiphysique atomique sauvegardée sous 'flux_live.json'.")

if __name__ == "__main__":
    main()
