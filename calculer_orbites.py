#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SYSTEMA SENTINELA v8.9.0 - Module d'Acquisition Total JPL-NASA
Extraction tridimensionnelle, métrique et physique complète.
"""

import requests
import json
import sys
from datetime import datetime, timezone

def executer_acquisition():
    aujourdhui = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    print(f"[SENTINELA] Connexion Corridor JPL pour la date : {aujourdhui} UTC")

    # Utilisation des coordonnées exactes de votre profil (ex: Groenland ou Marseille)
    # Remplacer par 5.36,43.28,0.100 pour Marseille si nécessaire
    SITE_GEODETIQUE = "5.36,43.28,0.100" 

    ASTRES = {
        "SOLEIL": "10",
        "LUNE": "301",
        "JUPITER": "599"
    }

    MATRICE_FINALE = {}

    for nom_astre, id_nasa in ASTRES.items():
        print(f"[JPL] Extraction des vecteurs physiques pour {nom_astre}...")
        MATRICE_FINALE[nom_astre] = {}
        
        url = "https://ssd-api.jpl.nasa.gov/horizons.api"
        
        params = {
            "format": "json",
            "COMMAND": f"'{id_nasa}'",
            "OBJ_DATA": "'NO'",
            "MAKE_EPHEM": "'YES'",
            "EPHEM_TYPE": "'OBSERVER'",
            "CENTER": "'coord@399'",
            "SITE_COORD": f"'{SITE_GEODETIQUE}'",
            "START_TIME": f"'{aujourdhui}T00:00'",
            "STOP_TIME": f"'{aujourdhui}T23:59'",
            "STEP_SIZE": "'1m'",
            "QUANTITIES": "'4,9,19,20,23'", # Flux total JPL
            "REF_SYSTEM": "'J2000'",
            "ANG_FORMAT": "'DEG'"
        }
        
        try:
            response = requests.get(url, params=params, timeout=30)
            data_json = response.json()
            
            if "error" in data_json or "message" in data_json or response.status_code != 200:
                params_alt = {k: v.replace("'", "") for k, v in params.items()}
                response = requests.get(url, params=params_alt, timeout=30)
                data_json = response.json()

            texte_brut = data_json.get("result", "")
            
            if "$$SOE" in texte_brut and "$$EOE" in texte_brut:
                bloc_donnees = texte_brut.split("$$SOE")[1].split("$$EOE")[0]
                lignes = bloc_donnees.strip().split("\n")
                
                compteur_points = 0
                for ligne in lignes:
                    if not ligne.strip(): 
                        continue
                    
                    # Nettoyage des caractères de découpe du JPL
                    colonnes = ligne.replace("*", " ").replace("m", " ").replace("t", " ").split()
                    
                    if len(colonnes) >= 8:
                        cle_heure_minute = colonnes[1] # "HH:MM"
                        
                        try:
                            azimuth = float(colonnes[2])
                            elevation = float(colonnes[3])
                            magnitude = float(colonnes[4])
                            
                            # Distances et vitesses héliocentriques / géocentriques
                            # Le JPL fournit la distance à la Terre en UA (colonne 6 ou 7 selon l'astre)
                            dist_terre_ua = float(colonnes[5]) if nom_astre != "LUNE" else float(colonnes[5]) / 149597870.7
                            vitesse_relative = float(colonnes[6]) # km/s (Range-rate)
                            
                            # Stockage de la matrice physique complète par minute
                            MATRICE_FINALE[nom_astre][cle_heure_minute] = [
                                azimuth,          # [0]
                                elevation,        # [1]
                                magnitude,        # [2]
                                dist_terre_ua,    # [3]
                                vitesse_relative  # [4]
                            ]
                            compteur_points += 1
                        except (ValueError, IndexError):
                            continue
                
                print(f"[OK] {compteur_points} paquets JPL mémorisés pour {nom_astre}")
            else:
                print(f"[ALERT] Segment $$SOE introuvable pour {nom_astre}.")
                
        except Exception as e:
            print(f"[CRITICAL] Rupture liaison JPL : {e}")

    # Enregistrement de la super-matrice
    try:
        with open("orbites.json", "w", encoding="utf-8") as f:
            json.dump(MATRICE_FINALE, f, indent=4, ensure_ascii=False)
        print("[SUCCESS] Base de données 100% JPL synchronisée.")
    except IOError as e:
        print(f"[FATAL] Échec disque : {e}")
        sys.exit(1)

if __name__ == "__main__":
    executer_acquisition()
