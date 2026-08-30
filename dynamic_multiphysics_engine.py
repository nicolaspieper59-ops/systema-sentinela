#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SYSTEMA SENTINELA — EXTRACTEUR TOPOCENTRIQUE OFFICIEL (DE440s)
Intégration complète : Soleil, Lune, et Planètes majeures VSOP/ELP.
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
    
    # Vérification et chargement sécurisé du noyau BSP local
    kernel_path = 'de440s.bsp'
    if not os.path.exists(kernel_path):
        print(f"[AVERTISSEMENT] Le fichier {kernel_path} est introuvable localement.")
        # Téléchargement via la méthode officielle de skyfield si absent
        loader.download(kernel_path)
        
    eph = loader(kernel_path)
        
    ts = loader.timescale(builtin=True)
    aujourdhui = datetime.now(timezone.utc).date()
    date_base = datetime(aujourdhui.year, aujourdhui.month, aujourdhui.day, 0, 0, tzinfo=timezone.utc)

    station_base = wgs84.latlon(lat_target, lon_target, elevation_m=alt_target)

    # Dictionnaire validé incluant la Lune et les planètes majeures
    corps_celestes = {
        'soleil': eph['sun'], 
        'lune': eph['moon'],
        'mercure': eph['mercury barycenter'],
        'venus': eph['venus barycenter'], 
        'mars': eph['mars barycenter'],
        'jupiter': eph['jupiter barycenter'], 
        'saturne': eph['saturn barycenter'],
        'uranus': eph['uranus barycenter'], 
        'neptune': eph['neptune barycenter']
    }

    matrice_24h = {name: [] for name in corps_celestes.keys()}

    print(f"[EXÉCUTION] Calcul topocentrique WGS84 pour Lat:{lat_target}, Lon:{lon_target}...")

    for minute in range(1441):
        instant = date_base + timedelta(minutes=minute)
        t = ts.from_datetime(instant)
        position_observateur = station_base.at(t)

        for nom, cible in corps_celestes.items():
            astre_apparent = position_observateur.observe(cible).apparent()
            x_m, y_m, z_m = astre_apparent.frame_xyz(itrs).m
            matrice_24h[nom].append({"x": float(x_m), "y": float(y_m), "z": float(z_m)})

    payload = {
        "INFRASTRUCTURE": "SYSTEMA SENTINELA — DE440s TOPOCENTRIQUE COMPLET",
        "GENERATION_TIMESTAMP_MS": int(time.time() * 1000),
        "DATE_REF": aujourdhui.isoformat(),
        "STATION_BASE_GPS": {"lat": lat_target, "lon": lon_target, "alt": alt_target},
        "DATA": matrice_24h
    }

    with open("flux_live.json", "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
        
    print(f"[SUCCESS] flux_live.json généré avec succès (Soleil, Lune, Planètes).")

if __name__ == "__main__":
    main()
