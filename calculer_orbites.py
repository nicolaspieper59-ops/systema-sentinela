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
    
    ASTRES = { "SOLEIL": "10", "LUNE": "301", "JUPITER": "599" }
    MATRICE_FINALE = {}

    for nom_astre, id_nasa in ASTRES.items():
        url = "https://ssd-api.jpl.nasa.gov/horizons.api"
        
        # CORRECTIF ABSOLU : Aucun guillemet simple, transmission brute des chaînes de caractères
        params = {
            "format": "json",
            "COMMAND": id_nasa,
            "OBJ_DATA": "NO",
            "MAKE_EPHEM": "YES",
            "EPHEM_TYPE": "OBSERVER",
            "CENTER": "coord",
            "SITE_COORD": f"{LONGITUDE},{LATITUDE},{ALTITUDE_KM}",
            "START_TIME": f"{aujourdhui} 00:00",
            "STOP_TIME": f"{aujourdhui} 23:59",
            "STEP_SIZE": "1m",
            "QUANTITIES": "4,9,20",
            "REF_SYSTEM": "J2000",
            "ANG_FORMAT": "DEG"
        }
        
        print(f"[REQUÊTE] Transmission des vecteurs pour {nom_astre}...")
        try:
            response = requests.get(url, params=params, timeout=20)
            if response.status_code != 200:
                print(f"[ERREUR] Code HTTP de secours : {response.status_code}")
                sys.exit(1)
                
            data_json = response.json()
            texte_brut = data_json.get("result", "")
            
            # FAIL-SAFE : Si la structure est absente, on stoppe le pipeline pour analyser l'erreur
            if "$$SOE" not in texte_brut or "$$EOE" not in texte_brut:
                print(f"\n[ECHEC CRITIQUE] Rejet des paramètres par la NASA pour l'astre {nom_astre} !")
                print("===================== DIAGNOSTIC EXTRÉMAL DE LA NASA =====================")
                print(texte_brut[:1500])
                print("==========================================================================")
                sys.exit(1)
                
            MATRICE_FINALE[nom_astre] = {}
            bloc_donnees = texte_brut.split("$$SOE")[1].split("$$EOE")[0]
            lignes = bloc_donnees.strip().split("\n")
            
            for ligne in lignes:
                if not ligne.strip():
                    continue
                    
                match_heure = re.search(r'(\d{2}:\d{2})', ligne)
                if not match_heure:
                    continue
                    
                cle_heure_minute = match_heure.group(1)
                reste_de_la_ligne = ligne[match_heure.end():]
                
                # Extraction par Regex insensible aux caractères physiques parasites (*, m, etc.)
                numeriques = [float(val) for val in re.findall(r'[-+]?\d*\.\d+|\d+', reste_de_la_ligne)]
                
                if len(numeriques) >= 2:
                    azimuth = numeriques[0]
                    elevation_brute = numeriques[1]
                    mag = numeriques[2] if len(numeriques) >= 3 else 0.0
                    dist_terre_ua = numeriques[3] if len(numeriques) >= 4 else 1.0
                    vitesse_relative = numeriques[4] if len(numeriques) >= 5 else 0.0
                    
                    elevation_corrigee = calculer_refraction_dynamique(elevation_brute, ALTITUDE_METRES)
                    if nom_astre == "LUNE":
                        elevation_corrigee = appliquer_parallaxe_lune(elevation_corrigee, ALTITUDE_METRES)

                    MATRICE_FINALE[nom_astre][cle_heure_minute] = [
                        azimuth, elevation_corrigee, mag, dist_terre_ua, vitesse_relative
                    ]
            print(f"[SUCCÈS] {nom_astre} synchronisé : {len(MATRICE_FINALE[nom_astre])} points.")
            
        except Exception as e:
            print(f"[EXCEPTION] Rupture sur {nom_astre} : {e}")
            sys.exit(1)

    # Écriture de la nouvelle matrice
    with open("orbites.json", "w", encoding="utf-8") as f:
        json.dump(MATRICE_FINALE, f, indent=4, ensure_ascii=False)
    print("[MIGRATION EFFECTUÉE] 'orbites.json' mis à jour avec les coordonnées réelles.")

if __name__ == "__main__":
    executer_acquisition()
