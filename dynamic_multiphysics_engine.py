#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SYSTEMA SENTINELA — EXTRACTEUR TOPOCENTRIQUE OFFICIEL (DE440s)
Matrice d'état 24h ECEF (km) pour worker_astronomie.js
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
    
    loader = Loader(os.getcwd(), verbose=False)
    
    kernel_path = 'de440s.bsp'
    if not os.path.exists(kernel_path):
        print(f"[AVERTISSEMENT] Téléchargement du noyau {kernel_path}...")
        loader.download(kernel_path)
        
    eph = loader(kernel_path)
    ts = loader.timescale(builtin=True)
    
    aujourdhui = datetime.now(timezone.utc).date()
    date_base = datetime(aujourdhui.year, aujourdhui.month, aujourdhui.day, 0, 0, tzinfo=timezone.utc)

    station_base = wgs84.latlon(lat_target, lon_target, elevation_m=alt_target)

    # Sélection prioritaire des corps exacts (défaillance sur barycentre si indisponible)
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

    print(f"[EXÉCUTION] Génération matrice ECEF (km) DE440s pour {lat_target}, {lon_target}...")

    for minute in range(1441):
        instant = date_base + timedelta(minutes=minute)
        t = ts.from_datetime(instant)
        position_observateur = station_base.at(t)

        for nom, cible in corps_celestes.items():
            astre_apparent = position_observateur.observe(cible).apparent()
            # frame_xyz(itrs).km garantit la compatibilité directe avec le worker JS (km)
            x_km, y_km, z_km = astre_apparent.frame_xyz(itrs).km
            matrice_24h[nom].append({
                "x": round(float(x_km), 3), 
                "y": round(float(y_km), 3), 
                "z": round(float(z_km), 3)
            })

    payload = {
        "INFRASTRUCTURE": "SYSTEMA SENTINELA — DE440s TOPOCENTRIQUE COMPLET",
        "GENERATION_TIMESTAMP_MS": int(time.time() * 1000),
        "DATE_REF": aujourdhui.isoformat(),
        "STATION_BASE_GPS": {"lat": lat_target, "lon": lon_target, "alt": alt_target},
        "DATA": matrice_24h
    }

    # Écriture minifiée sans indentation pour optimiser les performances réseau du Web Worker
    with open("flux_live.json", "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(',', ':'))
        
    print(f"[SUCCESS] flux_live.json généré (Coordonnées ECEF en kilomètres).")

if __name__ == "__main__":
    main()
