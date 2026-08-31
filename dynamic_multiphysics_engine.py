#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import os
import sys
import json
import time
from datetime import datetime, timedelta, timezone
from skyfield.api import Loader, wgs84
from skyfield.framelib import itrs

def main():
    if len(sys.argv) < 4:
        print("[ERREUR CRITIQUE] Usage obligatoire : python3 build_ephemerides.py <lat> <lon> <alt_m>")
        sys.exit(1)

    lat_target = float(sys.argv[1])
    lon_target = float(sys.argv[2])
    alt_target = float(sys.argv[3])
    
    loader = Loader(os.getcwd(), verbose=False)
    kernel_path = 'de440s.bsp'
    
    if not os.path.exists(kernel_path):
        loader.download(kernel_path)
        
    eph = loader(kernel_path)
    ts = loader.timescale(builtin=True)
    
    aujourdhui = datetime.now(timezone.utc).date()
    date_base = datetime(aujourdhui.year, aujourdhui.month, aujourdhui.day, 0, 0, tzinfo=timezone.utc)
    station_base = wgs84.latlon(lat_target, lon_target, elevation_m=alt_target)

    corps_celestes = {
        'soleil': eph['sun'], 
        'lune': eph['moon'],
        'mercure': eph['mercury'],
        'venus': eph['venus'], 
        'mars': eph['mars barycenter'],
        'jupiter': eph['jupiter barycenter'], 
        'saturne': eph['saturn barycenter'],
        'uranus': eph['uranus barycenter'], 
        'neptune': eph['neptune barycenter']
    }

    matrice_24h = {name: [] for name in corps_celestes.keys()}

    for minute in range(1441):
        instant = date_base + timedelta(minutes=minute)
        t = ts.from_datetime(instant)
        position_observateur = station_base.at(t)

        for nom, cible in corps_celestes.items():
            astre_apparent = position_observateur.observe(cible).apparent()
            x_km, y_km, z_km = astre_apparent.frame_xyz(itrs).km
            matrice_24h[nom].append([
                round(float(x_km), 3), 
                round(float(y_km), 3), 
                round(float(z_km), 3)
            ])

    payload = {
        "INFRASTRUCTURE": "SYSTEMA SENTINELA — DE440s ECEF TOPOCENTRIQUE",
        "GENERATION_TIMESTAMP_MS": int(time.time() * 1000),
        "DATE_REF": aujourdhui.isoformat(),
        "STATION_BASE_GPS": {"lat": lat_target, "lon": lon_target, "alt": alt_target},
        "DATA": matrice_24h
    }

    with open("flux_live.json", "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(',', ':'))

if __name__ == "__main__":
    main()
