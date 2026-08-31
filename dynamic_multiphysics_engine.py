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
        script_name = os.path.basename(sys.argv[0])
        print(f"[ERREUR CRITIQUE] Usage obligatoire : python3 {script_name} <lat> <lon> <alt_m>")
        sys.exit(1)

    try:
        lat_target = float(sys.argv[1])
        lon_target = float(sys.argv[2])
        alt_target = float(sys.argv[3])
    except ValueError as e:
        print(f"[ERREUR CRITIQUE] Coordonnées GPS invalides : {e}")
        sys.exit(1)

    loader = Loader(os.getcwd(), verbose=False)
    kernel_path = 'de440s.bsp'
    
    # Téléchargement sécurisé du noyau DE440s
    if not os.path.exists(kernel_path):
        print(f"[INFO] Téléchargement du noyau DE440s ({kernel_path})...")
        try:
            loader.download(kernel_path)
        except Exception as e:
            print(f"[ERREUR CRITIQUE] Échec du téléchargement de {kernel_path} : {e}")
            sys.exit(1)

    try:
        eph = loader(kernel_path)
        ts = loader.timescale(builtin=True)
    except Exception as e:
        print(f"[ERREUR CRITIQUE] Impossible de charger le fichier BSP : {e}")
        sys.exit(1)

    aujourdhui = datetime.now(timezone.utc).date()
    date_base = datetime(aujourdhui.year, aujourdhui.month, aujourdhui.day, 0, 0, tzinfo=timezone.utc)
    station_base = wgs84.latlon(lat_target, lon_target, elevation_m=alt_target)

    # Identifiants exacts des corps célestes dans le noyau JPL DE440s
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

    # Génération des 1441 points (00:00 à 24:00 UTC inclus)
    for minute in range(1441):
        instant = date_base + timedelta(minutes=minute)
        t = ts.from_datetime(instant)
        position_observateur = station_base.at(t)

        for nom, cible in corps_celestes.items():
            astre_apparent = position_observateur.observe(cible).apparent()
            # Coordonnées ECEF en MÈTRES (pour concorder avec astro_engine.cpp)
            x_m, y_m, z_m = astre_apparent.frame_xyz(itrs).m
            matrice_24h[nom].append([
                round(float(x_m), 2), 
                round(float(y_m), 2), 
                round(float(z_m), 2)
            ])

    payload = {
        "INFRASTRUCTURE": "SYSTEMA SENTINELA — DE440s ECEF TOPOCENTRIQUE",
        "GENERATION_TIMESTAMP_MS": int(time.time() * 1000),
        "DATE_REF": aujourdhui.isoformat(),
        "STATION_BASE_GPS": {"lat": lat_target, "lon": lon_target, "alt": alt_target},
        "VECTEUR_TYPE": "TOPOCENTRIQUE_METRES",
        "DATA": matrice_24h
    }

    output_file = "flux_live.json"
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(',', ':'))

    print(f"[SUCCÈS] Matrice {output_file} générée avec succès ({os.path.getsize(output_file)} octets).")

if __name__ == "__main__":
    main()
