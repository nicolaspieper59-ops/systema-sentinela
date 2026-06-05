#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import requests
import json
import re
import sys
import math
from datetime import datetime, timezone

def calculer_refraction_dynamique(altitude_brute_deg, altitude_observateur_m):
    if altitude_brute_deg < -0.5: 
        return altitude_brute_deg
    pression_hpa = 1013.25 * math.pow(1.0 - (0.0065 * altitude_observateur_m) / 288.15, 5.255)
    temperature_kelvin = 288.15 - (0.0065 * altitude_observateur_m)
    angle_rad = (altitude_brute_deg + 7.31 / (altitude_brute_deg + 4.4)) * (math.pi / 180.0)
    cotangente = 1.0 / math.tan(angle_rad)
    correction_arcmin = (cotangente / 60.0) * (pression_hpa / 1013.25) * (288.15 / temperature_kelvin)
    return altitude_brute_deg + correction_arcmin

def appliquer_parallaxe_lune(altitude_apparente_deg, altitude_observateur_m):
    RAYON_TERRE_KM = 6378.137
    DISTANCE_LUNE_KM = 384400.0
    rayon_local = RAYON_TERRE_KM + (altitude_observateur_m / 1000.0)
    pi_parallaxe = math.asin(RAYON_TERRE_KM / DISTANCE_LUNE_KM)
    altitude_rad = altitude_apparente_deg * math.pi / 180.0
    correction_parallaxe = pi_parallaxe * math.cos(altitude_rad) * (rayon_local / RAYON_TERRE_KM)
    return altitude_apparente_deg - (correction_parallaxe * 180.0 / math.pi)

def executer_acquisition():
    aujourdhui = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    print(f"[INFO] SENTINELA - Alignement vectoriel (Date : {aujourdhui})")
    
    LONGITUDE = 5.36
    LATITUDE = 43.28
    ALTITUDE_KM = 0.100  
    ALTITUDE_METRES = ALTITUDE_KM * 1000.0
    
    ASTRES = { "SOLEIL": "10" } # Test unique sur le Soleil pour obtenir le diagnostic
    MATRICE_FINALE = {}

    for nom_astre, id_nasa in ASTRES.items():
        # Utilisation de paramètres standards nettoyés de tout guillemet parasite
        url = "https://ssd-api.jpl.nasa.gov/horizons.api"
        params = {
            "format": "json",
            "COMMAND": id_nasa,
            "OBJ_DATA": "NO",
            "MAKE_EPHEM": "YES",
            "EPHEM_TYPE": "OBSERVER",
            "CENTER": "coord@399",
            "SITE_COORD": f"{LONGITUDE},{LATITUDE},{ALTITUDE_KM}",
            "START_TIME": f"{aujourdhui} 00:00",
            "STOP_TIME": f"{aujourdhui} 23:59",
            "STEP_SIZE": "1m",
            "QUANTITIES": "4,9,20",
            "REF_SYSTEM": "J2000",
            "ANG_FORMAT": "DEG"
        }
        
        try:
            print(f"[REQUÊTE DIAGNOSTIC] Envoi des paramètres standardisés pour {nom_astre}...")
            response = requests.get(url, params=params, timeout=20)
            data_json = response.json()
            texte_brut = data_json.get("result", "")
            
            # Affichage forcé de la réponse de la NASA dans les logs GitHub pour voir l'erreur exacte
            print("\n======================= STRIP LOGS DE LA NASA =======================")
            if texte_brut:
                print(texte_brut[:2000])
            else:
                print(json.dumps(data_json, indent=2))
            print("=====================================================================\n")
            
            if "$$SOE" not in texte_brut:
                sys.exit(1) # Provoque le rouge volontaire après avoir écrit les logs
                
        except Exception as e:
            print(f"[EXCEPTION] Erreur brute : {e}")
            if 'response' in locals() and hasattr(response, 'text'):
                print(response.text[:1000])
            sys.exit(1)

if __name__ == "__main__":
    executer_acquisition()
