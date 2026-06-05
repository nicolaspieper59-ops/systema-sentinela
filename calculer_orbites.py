#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import requests
import json
import re
import math
import os
import shutil
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
    print(f"[INFO] SENTINELA - Alignement des flux temporels avec le JPL : {aujourdhui}")
    
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
            response = requests.get(url, params=params, timeout=20)
            if response.status_code != 200:
                print(f"[ERREUR] Échec de la liaison HTTP {response.status_code} - {nom_astre}")
                continue
                
            data_json = response.json()
            texte_brut = data_json.get("result", "")
            
            if "$$SOE" in texte_brut and "$$EOE" in texte_brut:
                bloc_donnees = texte_brut.split("$$SOE")[1].split("$$EOE")[0]
                lignes = bloc_donnees.strip().split("\n")
                
                for ligne in lignes:
                    ligne_nettoye = ligne.strip()
                    if not ligne_nettoye:
                        continue
                        
                    elements = ligne_nettoye.split()
                    index_heure = -1
                    for idx, elem in enumerate(elements):
                        if ":" in elem and len(elem) == 5:
                            index_heure = idx
                            break
                    
                    if index_heure == -1:
                        continue
                        
                    cle_heure_minute = elements[index_heure].strip()
                    donnees_apres_heure = elements[index_heure + 1:]
                    
                    numeriques = []
                    for token in donnees_apres_heure:
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
                        mag = numeriques[2] if len(numeriques) >= 3 else 0.0
                        dist_terre_ua = numeriques[3] if len(numeriques) >= 4 else 1.0
                        vitesse_relative = numeriques[4] if len(numeriques) >= 5 else 0.0
                        
                        elevation_corrigee = calculer_refraction_dynamique(elevation_brute, ALTITUDE_METRES)
                        if nom_astre == "LUNE":
                            elevation_corrigee = appliquer_parallaxe_lune(elevation_corrigee, ALTITUDE_METRES)

                        MATRICE_FINALE[nom_astre][cle_heure_minute] = [
                            azimuth, elevation_corrigee, mag, dist_terre_ua, vitesse_relative
                        ]
                print(f"[SUCCÈS] {nom_astre} synchronisé (Points : {len(MATRICE_FINALE[nom_astre])}).")
            else:
                print(f"[ATTENTION] Trame rejetée par la NASA pour l'astre : {nom_astre}")
        except Exception as e:
            print(f"[ERREUR D'ANALYSE] Conflit sur {nom_astre} : {e}")

    # Préparation et isolation de la zone de production web
    if MATRICE_FINALE.get("SOLEIL") and len(MATRICE_FINALE["SOLEIL"]) > 0:
        os.makedirs("public", exist_ok=True)
        
        # Enregistrement du fichier de données épuré
        with open("public/orbites.json", "w", encoding="utf-8") as f:
            json.dump(MATRICE_FINALE, f, indent=4, ensure_ascii=False)
            
        # Duplication automatique sécurisée des fichiers de l'interface
        if os.path.exists("index.html"):
            shutil.copy("index.html", "public/index.html")
        if os.path.exists("manifest.json"):
            shutil.copy("manifest.json", "public/manifest.json")
            
        print("[SUCCÈS VECTORIEL] Tous les artefacts web ont été migrés vers le dossier ./public/")
    else:
        print("[CRITIQUE] Les flux de données de la NASA sont invalides. Déploiement suspendu.")

if __name__ == "__main__":
    executer_acquisition()
