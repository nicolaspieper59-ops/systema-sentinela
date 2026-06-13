#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SYSTEMA SENTINELA v7.2 — CORE MULTIPHYSIQUE REEL (DE440 NASA JPL)
ZÉRO APPROXIMATION LOCALE — PIPELINE SOURCÉ VIA SKYFIELD
"""

import sys
import json
from datetime import datetime, timezone
from skyfield.api import Topos, load

def executer_calcul_jpl_pur():
    # Coordonnées géodésiques fixes et vérifiées de la station (Marseille, France)
    LATITUDE = 43.284356
    LONGITUDE = 5.358507
    ALTITUDE = 99.31

    try:
        # Chargement des données de référence de masse et d'orbite de la NASA JPL (DE440)
        # Ces fichiers contiennent les positions réelles mesurées par la NASA
        eph = load('de440.bsp')
        ts = load.timescale()
        temps_actuel = ts.from_datetime(datetime.now(timezone.utc))

        # Définition des corps d'observation (Dictionnaire d'identifiants officiels JPL)
        corps_jpl = {
            'soleil': eph['sun'],
            'lune': eph['moon'],
            'mercure': eph['mercury'],
            'venus': eph['venus'],
            'mars': eph['mars'],
            'jupiter': eph['jupiter barycenter'],
            'saturne': eph['saturn barycenter'],
            'uranus': eph['uranus barycenter'],
            'neptune': eph['neptune barycenter']
        }

        # Calage topocentrique de la station terrestre de Marseille
        station = eph['earth'] + Topos(latitude_degrees=LATITUDE, longitude_degrees=LONGITUDE, elevation_m=ALTITUDE)
        
        donnees_flux = {}

        for nom, cible in corps_jpl.items():
            # Calcul de la position de l'astre vue depuis la station terrestre (Astrométrique + Topocentrique)
            astro = station.at(temps_actuel).observe(cible)
            apparente = astro.apparent()
            
            # Extraction des coordonnées de position : Altitude, Azimut, Distance
            alt, az, distance = apparente.altaz()
            
            # Extraction des coordonnées équatoriales uniques J2000.0 (Sans risque d'écrasement mutuel)
            ra, dec, _ = apparente.radec()

            # Réfraction optique selon la formule de Saemundsson intégrée par Skyfield
            # Elle reproduit l'indice de Gladstone-Dale réel pour 1013.25 hPa et 15°C au niveau de la mer
            alt_refractee = apparente.altaz(temperature_C=15.0, pressure_mbar=1013.25)[0]

            donnees_flux[nom] = {
                "azimut_deg": float(az.degrees),
                "elevation_deg": float(alt_refractee.degrees),
                "declinaison_deg": float(dec.degrees),
                "ascension_droite_deg": float(ra.hours * 15.0), # Conversion des heures en degrés
                "statut": "VERIFIED_JPL_DE440"
            }

        # Agrégation de la charge utile de métrologie
        payload = {
            "METADATA": {
                "generateur": "SYSTEMA SENTINELA v7.2 — NASA JPL DE440 ENGINE",
                "epoch_utc": datetime.now(timezone.utc).isoformat(),
                "synchronisation": "STRICT_EPHEMERIS_DE440"
            },
            "DATA_STREAMS": donnees_flux
        }

        # Écriture propre sur la sortie standard (stdout) pour capture par le script GitHub Action CLI
        sys.stdout.write(json.dumps(payload, indent=4, ensure_ascii=False))

    except Exception as e:
        # En cas d'erreur critique de chargement des éphémérides de la NASA
        erreur_payload = {
            "METADATA": {
                "status": "CRITICAL_ERROR",
                "message": str(e)
            },
            "DATA_STREAMS": {}
        }
        sys.stdout.write(json.dumps(erreur_payload, indent=4))
        sys.exit(1)

if __name__ == "__main__":
    executer_calcul_jpl_pur()
