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
    # Détermination de la date UTC
    aujourdhui = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    print(f"[INFO] Alignement SENTINELA - Date : {aujourdhui}")
    
    LONGITUDE = 5.36
    LATITUDE = 43.28
    ALTITUDE_KM = 0.100  
    ALTITUDE_METRES = ALTITUDE_KM * 1000.0
    
    ASTRES = { "SOLEIL": "10", "LUNE": "301", "JUPITER": "599" }
    MATRICE_FINALE = {}

    for nom_astre, id_nasa in ASTRES.items():
        MATRICE_FINALE[nom_astre] = {}
        url = "https://ssd-api.jpl.nasa.gov/horizons.api"
        
        params = {
            "format": "json",
            "COMMAND": f"'{id_nasa}'",
            "OBJ_DATA": "'NO'",
            "MAKE_EPHEM": "'YES'",
            "EPHEM_TYPE": "'OBSERVER'",
            "CENTER": "'coord@399'",
            "SITE_COORD": f"'{LONGITUDE},{LATITUDE},{ALTITUDE_KM}'",
            "START_TIME": f"'{aujourdhui} 00:00'",
            "STOP_TIME": f"'{aujourdhui} 23:59'",
            "STEP_SIZE": "'1m'",
            "QUANTITIES": "'4,9,20'",
            "REF_SYSTEM": "'J2000'",
            "ANG_FORMAT": "'DEG'"
        }
        
        try:
            response = requests.get(url, params=params, timeout=20)
            data_json = response.json()
            texte_brut = data_json.get("result", "")
            
            if "$$SOE" in texte_brut and "$$EOE" in texte_brut:
                bloc_donnees = texte_brut.split("$$SOE")[1].split("$$EOE")[0]
                lignes = bloc_donnees.strip().split("\n")
                
                for ligne in lignes:
                    ligne_nettoye = ligne.strip()
                    if not ligne_nettoye:
                        continue
                        
                    # Split par n'importe quel bloc d'espaces consécutifs
                    elements = ligne_nettoye.split()
                    
                    # Une ligne valide Horizons contient la date (Ex: 2026-Jun-05) et l'heure (Ex: 12:34)
                    # On cherche l'élément contenant l'horaire "XX:XX"
                    index_heure = -1
                    for idx, elem in enumerate(elements):
                        if ":" in elem and len(elem) == 5:
                            index_heure = idx
                            break
                    
                    if index_heure == -1:
                        continue
                        
                    cle_heure_minute = elements[index_heure].strip()
                    
                    # Les données numériques se trouvent juste après l'heure
                    # On extrait tout ce qui suit et on nettoie les marqueurs de la NASA (*, A, t, etc.)
                    donnees_apres_heure = elements[index_heure + 1:]
                    
                    numeriques = []
                    for token in donnees_apres_heure:
                        # Supprime les caractères non numériques parasites attachés aux chiffres (ex: "145.23*")
                        token_propre = re.sub(r'[^\d\.\+\-eEnNaA\/]', '', token)
                        if not token_propre or token_propre.lower() == 'n.a.':
                            numeriques.append(0.0)
                        else:
                            try:
                                numeriques.append(float(token_propre))
                            except ValueError:
                                continue

                    if len(numeriques) >= 2:
                        azimuth = numeriques[0]
                        elevation_brute = numeriques[1]
                        
                        # Indices adaptatifs selon la réponse (Magnitude, Distance, Vitesse)
                        mag = numeriques[2] if len(numeriques) >= 3 else 0.0
                        dist_terre_ua = numeriques[3] if len(numeriques) >= 4 else 1.0
                        vitesse_relative = numeriques[4] if len(numeriques) >= 5 else 0.0
                        
                        elevation_corrigee = calculer_refraction_dynamique(elevation_brute, ALTITUDE_METRES)
                        if nom_astre == "LUNE":
                            elevation_corrigee = appliquer_parallaxe_lune(elevation_corrigee, ALTITUDE_METRES)

                        MATRICE_FINALE[nom_astre][cle_heure_minute] = [
                            azimuth, elevation_corrigee, mag, dist_terre_ua, vitesse_relative
                        ]
                        
                print(f"[SUCCÈS] {nom_astre} : {len(MATRICE_FINALE[nom_astre])} points indexés.")
            else:
                print(f"[ATTENTION] Structure Horizons absente pour {nom_astre}.")
        except Exception as e:
            print(f"[ERREUR] Échec de traitement sur {nom_astre} : {e}")

    # Enregistrement final sécurisé
    if MATRICE_FINALE.get("SOLEIL") and len(MATRICE_FINALE["SOLEIL"]) > 0:
        with open("orbites.json", "w", encoding="utf-8") as f:
            json.dump(MATRICE_FINALE, f, indent=4, ensure_ascii=False)
        print("[SUCCÈS] Fichier 'orbites.json' mis à jour avec succès.")
    else:
        print("[ERREUR CRITIQUE] Matrice vide. Sauvegarde bloquée.")

if __name__ == "__main__":
    executer_acquisition()
