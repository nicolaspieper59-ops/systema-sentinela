#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SYSTEMA SENTINELA v9.0.0 — REAL-TIME METROLOGY STREAM
Moteur dynamique haute fréquence sans profil figé
"""

import os
import sys
import time
import json
import math
from datetime import datetime, timezone
import numpy as np

try:
    from skyfield.api import Loader, wgs84
except ImportError:
    print("[ERREUR] Installez d'abord les dépendances : pip install skyfield numpy")
    sys.exit(1)

# Constantes Géodésiques WGS84
A_WGS84 = 6378137.0           
F_WGS84 = 1.0 / 298.257223563 
E2_WGS84 = 2.0 * F_WGS84 - F_WGS84**2

def initialiser_noyaux():
    rep = os.getcwd()
    loader = Loader(rep, verbose=False)
    try:
        eph = loader('de421.bsp')
        ts = loader.timescale(builtin=True)
        return eph, ts
    except Exception as e:
        print(f"[ERR] Téléchargez de421.bsp manuellement dans le dossier : {e}")
        sys.exit(1)

def calculer_ecef(lat_deg, lon_deg, alt_m):
    lat = math.radians(lat_deg)
    lon = math.radians(lon_deg)
    denom = 1.0 - E2_WGS84 * math.sin(lat)**2
    N = A_WGS84 / math.sqrt(denom)
    x = (N + alt_m) * math.cos(lat) * math.cos(lon)
    y = (N + alt_m) * math.cos(lat) * math.sin(lon)
    z = (N * (1.0 - E2_WGS84) + alt_m) * math.sin(lat)
    return [x, y, z]

def executer_radar_continu():
    eph, ts = initialiser_noyaux()
    print("[ONLINE] Moteur Sentinela en écoute active (Fréquence : 2Hz)...")
    
    # Position initiale (Marseille), modifiable dynamiquement par un flux GPS
    lat_actuelle = 43.284356
    lon_actuelle = 5.358507
    alt_actuelle = 99.3100

    try:
        while True:
            # 1. Capture du temps précis à la milliseconde
            epoch_main = datetime.now(timezone.utc)
            instant_utc = ts.from_datetime(epoch_main)
            
            # --- Simulation d'un déplacement dynamique réel (Optionnel) ---
            # En situation réelle, remplace ces 3 lignes par la lecture d'un port série GPS (NMEA)
            lon_actuelle += 0.0001  # Simule un déplacement vers l'Est
            alt_actuelle = 99.3100 + (10 * math.sin(time.time() / 5)) # Oscillation d'altitude
            # --------------------------------------------------------------

            pos_ecef = calculer_ecef(lat_actuelle, lon_actuelle, alt_actuelle)
            station_wgs = wgs84.latlon(lat_actuelle, lon_actuelle, elevation_m=alt_actuelle)
            station_inst = eph['earth'] + station_wgs

            # Calcul des paramètres solaires globaux
            apparent_sun = eph['earth'].at(instant_utc).observe(eph['sun']).apparent()
            ra_sun, _, _ = apparent_sun.radec()
            _, lon_ecliptic, _ = apparent_sun.ecliptic_latlon()
            eot_minutes = (lon_ecliptic.degrees / 15.0 - ra_sun.hours) * 60.0
            if eot_minutes > 720.0: eot_minutes -= 1440.0
            elif eot_minutes < -720.0: eot_minutes += 1440.0

            corps = {
                'soleil': eph['sun'], 'lune': eph['moon'], 'mars': eph['mars barycenter']
            }
            
            flux_live = {}
            for nom, cible in corps.items():
                obs = station_inst.at(instant_utc).observe(cible).apparent()
                alt_brute, az, dist = obs.altaz()
                flux_live[nom] = {
                    "azimut": round(az.degrees, 4),
                    "elevation": round(alt_brute.degrees, 4),
                    "distance_m": f"{dist.m:.4e}"
                }

            # Génération de la trame de télémétrie unifiée
            telemetrie = {
                "timestamp": epoch_main.isoformat(),
                "position_recepteur": {
                    "latitude": lat_actuelle, "longitude": lon_actuelle, "altitude": alt_actuelle,
                    "ecef": pos_ecef
                },
                "astronomie": {
                    "equation_of_time_min": round(eot_minutes, 6),
                    "solar_longitude_deg": round(lon_ecliptic.degrees, 4)
                },
                "targets": flux_live
            }

            # Écriture flash (I/O fluide)
            with open("flux_live.json", "w", encoding="utf-8") as f:
                json.dump(telemetrie, f, indent=2)

            # Affichage console pour monitoring pro
            print(f"[{epoch_main.strftime('%H:%M:%S.%f')[:-3]}] ECEF_Z: {pos_ecef[2]:.2f}m | Sun_Alt: {flux_live['soleil']['elevation']}°", end="\r")
            
            # Fréquence de rafraîchissement (0.5s)
            time.sleep(0.5)

    except KeyboardInterrupt:
        print("\n[OFFLINE] Arrêt du flux métrologique.")

if __name__ == "__main__":
    executer_radar_continu()
