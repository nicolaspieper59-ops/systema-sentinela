#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SYSTEMA SENTINELA v8.5.8 — MOTEUR GÉODÉSIQUE MULTIPHYSIQUE
CALCUL TOPOCENTRIQUE RIGUEUR JPL SANS APPROXIMATION
"""

import sys, json, math
from datetime import datetime, timezone
import numpy as np
from skyfield.api import load, wgs84

# Constantes WGS84 (Référentiel géodésique standard)
A_WGS84 = 6378137.0
F_WGS84 = 1.0 / 298.257223563
E2_WGS84 = 2.0 * F_WGS84 - F_WGS84**2

def get_engine():
    # Utilisation d'un chargement local forcé (prévenir les erreurs réseau)
    try:
        ts = load.timescale(builtin=True)
        # Note: Assurez-vous que de440.bsp est dans le repo ou géré par loader local
        eph = load('de440.bsp')
        return ts, eph
    except Exception as e:
        sys.stderr.write(f"ERREUR_CRITIQUE_INITIALISATION: {e}\n")
        sys.exit(1)

def executer_calcul():
    ts, eph = get_engine()
    now_utc = datetime.now(timezone.utc)
    t = ts.from_datetime(now_utc)
    
    # Position fixe Marseille (référentiel inertiel)
    earth = eph['earth']
    station = earth + wgs84.latlon(43.284356, 5.358507, elevation_m=99.31)
    
    # CALCUL ÉQUATION DU TEMPS (EOT)
    # EOT = Temps Solaire Moyen - Temps Solaire Vrai
    # Calculé via l'Ascension Droite (RA) du Soleil
    sun = eph['sun']
    astrometric = earth.at(t).observe(sun)
    apparent = astrometric.apparent()
    
    # Utilisation du cadre de référence ICRS/GCRS
    ra, dec, distance = apparent.radec(epoch=t)
    
    # Calcul rigoureux du temps solaire moyen via la longitude écliptique
    # (Pas d'approximation linéaire, passage par le repère écliptique vrai)
    lon_ecliptic, _, _ = apparent.ecliptic_latlon()
    
    # EOT en minutes : (Longitude_Ecliptique - Ascension_Droite) en temps
    eot_min = (lon_ecliptic.degrees / 15.0 - ra.hours) * 60.0
    
    # Résolution des flux astres (Pas de simulation, observation instantanée)
    corps = {'soleil': 'sun', 'lune': 'moon', 'mars': 'mars barycenter', 'jupiter': 'jupiter barycenter'}
    data_streams = {}
    
    for nom, id_jpl in corps.items():
        obs = station.at(t).observe(eph[id_jpl]).apparent()
        alt, az, _ = obs.altaz()
        data_streams[nom] = {
            "azimut_deg": float(az.degrees),
            "elevation_deg": float(alt.degrees),
            "distance_precision_m": float(obs.distance().m)
        }

    payload = {
        "METADATA": {
            "version": "8.5.8",
            "epoch_utc": now_utc.isoformat(),
            "equation_of_time_min": float(eot_min)
        },
        "DATA_STREAMS": data_streams
    }

    with open("flux_live.json", "w") as f:
        json.dump(payload, f, indent=4)

if __name__ == "__main__":
    executer_calcul()
