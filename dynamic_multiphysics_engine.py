#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SYSTEMA SENTINELA - CONDUITE DE DONNÉES STRICTES JPL DE440
ZÉRO CALCUL INTERNE APPLICATIF - EXTRACTION AZIMUT / ÉLÉVATION / DÉCLINAISON EN BRUT
"""

import json
import sys
import time
from skyfield.api import Topos, load

def extraire_matrice_horizon_jpl():
    # Chargement des éphémérides officielles JPL
    eph = load('de440.bsp')
    ts = load.timescale()
    
    # Coordonnées réelles validées par votre S10e à Marseille
    lat = 43.287991
    lon = 5.354912
    alt = 98.40
    
    # Horloge synchrone pour l'acquisition
    timestamp_actuel = time.time()
    t = ts.tai_bn(jd=2440587.5 + (timestamp_actuel / 86400.0))
    
    observer = eph['earth'] + Topos(latitude_degrees=lat, longitude_degrees=lon, elevation_m=alt)
    
    # Illumination de la lune (Pourcentage brut du JPL)
    fraction_lune = observer.at(t).observe(eph['moon']).apparent().fraction_illuminated(eph['sun'])
    pourcentage_lune = float(fraction_lune * 100)
    
    # Catalogue complet des 9 astres requis
    catalog_corps = {
        "soleil": eph['sun'], "lune": eph['moon'], "mercure": eph['mercury'],
        "venus": eph['venus'], "mars": eph['mars barycenter'], "jupiter": eph['jupiter barycenter'],
        "saturne": eph['saturn barycenter'], "uranus": eph['uranus barycenter'], "neptune": eph['neptune barycenter']
    }
    
    streams = {}
    for nom, cible in catalog_corps.items():
        astre_observe = observer.at(t).observe(cible).apparent()
        
        # Récupération des coordonnées horizontales natives (Azimut, Élévation)
        alt_horiz, az_horiz, _ = astre_observe.altaz()
        
        # Récupération de la déclinaison native
        _, dec, _ = astre_observe.radec()
        
        # Formatage en chaînes de caractères figées (ZÉRO calcul requis par l'interface)
        streams[nom] = {
            "azimut_deg": f"{az_horiz.degrees:.6f}°",
            "elevation_deg": f"{alt_horiz.degrees:.6f}°",
            "declinaison_deg": f"{dec.degrees:+.6f}°"
        }

    output = {
        "METADATA": {
            "source": "JPL DE440 Strict",
            "horodatage_utc": t.utc_strftime('%Y-%m-%d %H:%M:%S UTC')
        },
        "DONNEES_SPECIFIQUES_LUNE": {
            "illumination_pourcentage": pourcentage_lune
        },
        "DATA_STREAMS": streams
    }
    
    # Sauvegarde locale du flux pour le déploiement ou l'intégration
    with open('flux_live.json', 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=4, ensure_ascii=False)
        
    print(json.dumps(output, indent=4, ensure_ascii=False))

if __name__ == "__main__":
    extraire_matrice_horizon_jpl()
