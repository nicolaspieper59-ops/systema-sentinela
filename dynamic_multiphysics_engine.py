#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SYSTEMA SENTINELA — NOYAU EXTRACTEUR ITRS CORRIGÉ
Correction : Injection propre des paramètres de station et structuration JSON unifiée.
"""
import os
import sys
import json
import time
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
    lat_target = conversion_securisee_float(sys.argv[1] if len(sys.argv) > 1 else None, 43.284356)
    lon_target = conversion_securisee_float(sys.argv[2] if len(sys.argv) > 2 else None, 5.358507)
    alt_target = conversion_securisee_float(sys.argv[3] if len(sys.argv) > 3 else None, 99.31)
    temp_target = conversion_securisee_float(sys.argv[4] if len(sys.argv) > 4 else None, 15.0)

    loader = Loader(os.getcwd(), verbose=False)
    try:
        eph = loader('de440s.bsp')
    except Exception:
        eph = loader('https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/de440s.bsp')
        
    ts = loader.timescale(builtin=True)
    aujourdhui = datetime.now(timezone.utc).date()
    date_base = datetime(aujourdhui.year, aujourdhui.month, aujourdhui.day, 0, 0, tzinfo=timezone.utc)

    station_base = wgs84.latlon(lat_target, lon_target, elevation_m=alt_target)

    corps_celestes = {
        'soleil': eph['sun'], 'lune': eph['moon'], 'mercure': eph['mercury barycenter'],
        'venus': eph['venus barycenter'], 'mars': eph['mars barycenter'],
        'jupiter': eph['jupiter barycenter'], 'saturne': eph['saturn barycenter'],
        'uranus': eph['uranus barycenter'], 'neptune': eph['neptune barycenter']
    }

    matrice_24h = {name: [] for name in corps_celestes.keys()}
    metadata_24h = []

    for minute in range(1441):
        instant = date_base + timedelta(minutes=minute)
        t = ts.from_datetime(instant)
        
        position_centre_terre = eph['earth'].at(t)
        for nom, cible in corps_celestes.items():
            astre_apparent = position_centre_terre.observe(cible).apparent()
            x_m, y_m, z_m = astre_apparent.frame_xyz(itrs).m
            matrice_24h[nom].append({"x": float(x_m), "y": float(y_m), "z": float(z_m)})

    payload = {
        "INFRASTRUCTURE": "SYSTEMA SENTINELA — DE440s CORRIGÉ",
        "GENERATION_TIMESTAMP_MS": int(time.time() * 1000),
        "DATE_REF": aujourdhui.isoformat(),
        "STATION_BASE_GPS": {"lat": lat_target, "lon": lon_target, "alt": alt_target},
        "DATA": matrice_24h
    }

    with open("flux_live.json", "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
    print(f"[SUCCESS] Flux unifié DE440s généré proprement.")

if __name__ == "__main__":
    main()
