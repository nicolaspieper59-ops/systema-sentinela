#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import os
import sys
import json
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from skyfield.api import Loader, wgs84
from skyfield.framelib import itrs

def telecharger_noyau_if_missing(filename):
    if not os.path.exists(filename) or os.path.getsize(filename) < 1000000:
        url = f"https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/{filename}"
        print(f"[INFO] Téléchargement du noyau {filename} depuis la NASA...")
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=60) as response, open(filename, 'wb') as out_file:
            out_file.write(response.read())
        print(f"[INFO] Téléchargement terminé ({os.path.getsize(filename)} octets).")

def Obtenir_corps(eph, nom_standard):
    # Gestion des différences d'indexation entre noyaux JPL
    candidats = [nom_standard, f"{nom_standard} barycenter"]
    for c in candidats:
        if c in eph:
            return eph[c]
    raise KeyError(f"Impossible de trouver '{nom_standard}' dans le fichier BSP.")

def main():
    if len(sys.argv) < 4:
        print("[ERREUR] Usage : python3 dynamic_multiphysics_engine.py <lat> <lon> <alt_m>")
        sys.exit(1)

    lat_target = float(sys.argv[1])
    lon_target = float(sys.argv[2])
    alt_target = float(sys.argv[3])

    kernel_path = 'de440s.bsp'
    try:
        telecharger_noyau_if_missing(kernel_path)
    except Exception as e:
        print(f"[ERREUR CRITIQUE] Échec du téléchargement du fichier BSP : {e}")
        sys.exit(1)

    loader = Loader(os.getcwd(), verbose=False)
    eph = loader(kernel_path)
    ts = loader.timescale(builtin=True)

    aujourdhui = datetime.now(timezone.utc).date()
    date_base = datetime(aujourdhui.year, aujourdhui.month, aujourdhui.day, 0, 0, tzinfo=timezone.utc)
    station_base = wgs84.latlon(lat_target, lon_target, elevation_m=alt_target)

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
        try:
            corps_celestes[cle_json] = Obtenir_corps(eph, nom_jpl)
        except KeyError as e:
            print(f"[ERREUR] Clé non trouvée : {e}")
            sys.exit(1)

    matrice_24h = {name: [] for name in corps_celestes.keys()}

    # Pas de 1 minute sur 24h (1441 points)
    for minute in range(1441):
        instant = date_base + timedelta(minutes=minute)
        t = ts.from_datetime(instant)
        position_observateur = station_base.at(t)

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
