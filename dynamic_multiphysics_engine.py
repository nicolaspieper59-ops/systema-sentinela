#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import os
import sys
import json
import time
from datetime import datetime, timedelta, timezone
from skyfield.api import Loader, wgs84
from skyfield.framelib import itrs

def Obtenir_corps(eph, nom):
    for cible in [nom, f"{nom} barycenter", f"{nom} barycentre"]:
        if cible in eph:
            return eph[cible]
    raise KeyError(f"Corps '{nom}' introuvable dans le noyau BSP.")

def main():
    # Gestion des valeurs par défaut si les arguments sont absents ou invalides
    try:
        lat_target = float(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].strip() != "" else 43.284356
        lon_target = float(sys.argv[2]) if len(sys.argv) > 2 and sys.argv[2].strip() != "" else 5.358507
        alt_target = float(sys.argv[3]) if len(sys.argv) > 3 and sys.argv[3].strip() != "" else 99.31
    except ValueError:
        lat_target, lon_target, alt_target = 43.284356, 5.358507, 99.31

    kernel_path = 'de440s.bsp'
    if not os.path.exists(kernel_path) or os.path.getsize(kernel_path) < 10000000:
        print(f"[ERREUR] Noyau BSP manquant ou taille invalide (<10Mo).")
        sys.exit(1)

    loader = Loader(os.getcwd(), verbose=False)
    eph = loader(kernel_path)
    ts = loader.timescale(builtin=True)

    aujourdhui = datetime.now(timezone.utc).date()
    date_base = datetime(aujourdhui.year, aujourdhui.month, aujourdhui.day, 0, 0, tzinfo=timezone.utc)
    
    # Correction : Association de la Terre avec la position topographique WGS84
    terre = eph['earth']
    station_base = wgs84.latlon(lat_target, lon_target, elevation_m=alt_target)
    observateur = terre + station_base

    mapping_astres = {
        'soleil': 'sun',
        'lune': 'moon',
        'mercure': 'mercury',
        'venus': 'venus',
        'mars': 'mars',
        'jupiter': 'jupiter',
        'saturne': 'saturn',
        'uranus': 'uranus',
        'neptune': 'neptune'
    }

    corps_celestes = {}
    for cle_json, nom_jpl in mapping_astres.items():
        corps_celestes[cle_json] = Obtenir_corps(eph, nom_jpl)

    matrice_24h = {name: [] for name in corps_celestes.keys()}

    for minute in range(1441):
        instant = date_base + timedelta(minutes=minute)
        t = ts.from_datetime(instant)
        
        # Calcul de la position de l'observateur topocentrique
        position_observateur = observateur.at(t)

        for nom, cible in corps_celestes.items():
            astre_apparent = position_observateur.observe(cible).apparent()
            x_m, y_m, z_m = astre_apparent.frame_xyz(itrs).m
            matrice_24h[nom].append([
                round(float(x_m), 1),
                round(float(y_m), 1),
                round(float(z_m), 1)
            ])

    payload = {
        "INFRASTRUCTURE": "SYSTEMA SENTINELA — DE440s ECEF TOPOCENTRIQUE",
        "GENERATION_TIMESTAMP_MS": int(time.time() * 1000),
        "DATE_REF": aujourdhui.isoformat(),
        "STATION_BASE_GPS": {"lat": lat_target, "lon": lon_target, "alt": alt_target},
        "VECTEUR_TYPE": "TOPOCENTRIQUE_METRES",
        "DATA": matrice_24h
    }

    with open("flux_live.json", "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(',', ':'))

    print(f"[SUCCÈS] flux_live.json généré ({os.path.getsize('flux_live.json')} octets).")

if __name__ == "__main__":
    main()
