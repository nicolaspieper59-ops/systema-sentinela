#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import requests
import json
import re
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
    print(f"[INFO] SENTINELA - Alignement vectoriel avec le JPL NASA : {aujourdhui}")
    
    LONGITUDE = 5.36
    LATITUDE = 43.28
    ALTITUDE_KM = 0.100  
    ALTITUDE_METRES = ALTITUDE_KM * 1000.0
    
    ASTRES = { "SOLEIL": "10", "LUNE": "301", "JUPITER": "599" }
    MATRICE_FINALE = {"SOLEIL": {}, "LUNE": {}, "JUPITER": {}}

    for nom_astre, id_nasa in ASTRES.items():
        url = "https://ssd-api.jpl.nasa.gov/horizons.api"
        
        # CONFIGURATION DUAL-MODE : Pour contourner les caprices des filtres du serveur CGI de la NASA
        modes_parametres = [
            # Mode A : Spécification officielle stricte (Tout encapsulé dans des guillemets simples)
            {
                "format": "json", "COMMAND": f"'{id_nasa}'", "OBJ_DATA": "'NO'", "MAKE_EPHEM": "'YES'",
                "EPHEM_TYPE": "'OBSERVER'", "CENTER": "'coord@399'", "SITE_COORD": f"'{LONGITUDE},{LATITUDE},{ALTITUDE_KM}'",
                "START_TIME": f"'{aujourdhui} 00:00'", "STOP_TIME": f"'{aujourdhui} 23:59'", "STEP_SIZE": "'1m'",
                "QUANTITIES": "'4,9,20'", "REF_SYSTEM": "'J2000'", "ANG_FORMAT": "'DEG'"
            },
            # Mode B : Format hybride résilient (Seulement les structures complexes entre guillemets simples)
            {
                "format": "json", "COMMAND": id_nasa, "OBJ_DATA": "NO", "MAKE_EPHEM": "YES",
                "EPHEM_TYPE": "OBSERVER", "CENTER": "coord@399", "SITE_COORD": f"'{LONGITUDE},{LATITUDE},{ALTITUDE_KM}'",
                "START_TIME": f"'{aujourdhui} 00:00'", "STOP_TIME": f"'{aujourdhui} 23:59'", "STEP_SIZE": "1m",
                "QUANTITIES": "4,9,20", "REF_SYSTEM": "J2000", "ANG_FORMAT": "DEG"
            }
        ]
        
        texte_brut = ""
        for idx_mode, params in enumerate(modes_parametres):
            try:
                print(f"[TRY] Tentative d'acquisition {nom_astre} via Protocole Réseau {chr(65 + idx_mode)}...")
                response = requests.get(url, params=params, timeout=20)
                if response.status_code == 200:
                    json_res = response.json()
                    texte_brut = json_res.get("result", "")
                    if "$$SOE" in texte_brut and "$$EOE" in texte_brut:
                        print(f"[OK] Connexion établie avec succès via le Protocole {chr(65 + idx_mode)}.")
                        break
            except Exception as e:
                print(f"[WARN] Échec protocole {chr(65 + idx_mode)} : {e}")
                continue
        
        if "$$SOE" in texte_brut and "$$EOE" in texte_brut:
            bloc_donnees = texte_brut.split("$$SOE")[1].split("$$EOE")[0]
            lignes = bloc_donnees.strip().split("\n")
            
            for ligne in lignes:
                if not ligne.strip():
                    continue
                
                # RECHERCHE CHIRURGICALE DE L'HEURE (HH:MM)
                match_heure = re.search(r'(\d{2}:\d{2})', ligne)
                if not match_heure:
                    continue
                    
                cle_heure_minute = match_heure.group(1)
                reste_de_la_ligne = ligne[match_heure.end():]
                
                # EXTRACTEUR REGEX ABSOLU : Capture tous les nombres (positifs, négatifs, décimaux)
                # Ignore totalement les indicateurs parasites de la NASA (*, m, A, etc.)
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
            print(f"[SUCCÈS] {nom_astre} : {len(MATRICE_FINALE[nom_astre])} vecteurs synchronisés.")
        else:
            print(f"[CRITICAL] Rejet total des paquets de la NASA pour {nom_astre}. Trame illisible.")

    # Sauvegarde forcée de la matrice
    with open("orbites.json", "w", encoding="utf-8") as f:
        json.dump(MATRICE_FINALE, f, indent=4, ensure_ascii=False)
    print("[FLUX COMPLET] Fichier 'orbites.json' écrit avec succès à la racine.")

if __name__ == "__main__":
    executer_acquisition()
