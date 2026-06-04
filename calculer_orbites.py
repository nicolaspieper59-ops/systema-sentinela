#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SYSTEMA SENTINELA v8.9.1 - Module d'Acquisition Robuste JPL-NASA
Nettoyage chirurgical des lignes asymétriques du JPL Horizons.
"""

import requests
import json
import sys
import re
from datetime import datetime, timezone

def executer_acquisition():
    aujourdhui = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    print(f"[SENTINELA v8.9.1] Initialisation du flux pour : {aujourdhui} UTC")

    # Coordonnées géodésiques de test (Marseille)
    SITE_GEODETIQUE = "5.36,43.28,0.100" 

    ASTRES = {
        "SOLEIL": "10",
        "LUNE": "301",
        "JUPITER": "599"
    }

    MATRICE_FINALE = {}

    for nom_astre, id_nasa in ASTRES.items():
        print(f"[JPL] Extraction de l'astre : {nom_astre}...")
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
            "QUANTITIES": "'4,9,20'", # 4=Az/Alt, 9=Mag, 20=Distance & Vitesse relative
            "REF_SYSTEM": "'J2000'",
            "ANG_FORMAT": "'DEG'"
        }
        
        try:
            response = requests.get(url, params=params, timeout=30)
            data_json = response.json()
            texte_brut = data_json.get("result", "")
            
            if "$$SOE" in texte_brut and "$$EOE" in texte_brut:
                bloc_donnees = texte_brut.split("$$SOE")[1].split("$$EOE")[0]
                lignes = bloc_donnees.strip().split("\n")
                
                compteur_points = 0
                for ligne in lignes:
                    if not ligne.strip(): 
                        continue
                    
                    # Nettoyage absolu des marqueurs visuels de la NASA (*, n, t, m)
                    ligne_nettoyee = re.sub(re.compile(r'[*ntm]'), ' ', ligne)
                    colonnes = ligne_nettoyee.split()
                    
                    if len(colonnes) >= 7:
                        # Format attendu : [Date, Heure, Az, Alt, Mag, Distance, Vitesse]
                        cle_heure_minute = colonnes[1] # "HH:MM"
                        
                        try:
                            azimuth = float(colonnes[2])
                            elevation = float(colonnes[3])
                            
                            # Sécurité d'extraction pour la Magnitude (le Soleil ou la Lune saturent parfois les colonnes)
                            mag = float(colonnes[4]) if colonnes[4] != 'n.a.' else ( -26.74 if nom_astre == "SOLEIL" else -12.0 )
                            
                            dist_terre_ua = float(colonnes[5])
                            vitesse_relative = float(colonnes[6])
                            
                            if nom_astre == "LUNE":
                                # La lune renvoie sa distance en UA ou en unités directes du JPL, standardisation en UA
                                if dist_terre_ua > 1: dist_terre_ua = dist_terre_ua / 149597870.7

                            MATRICE_FINALE[nom_astre][cle_heure_minute] = [
                                azimuth,          # [0]
                                elevation,        # [1]
                                mag,              # [2]
                                dist_terre_ua,    # [3]
                                vitesse_relative  # [4]
                            ]
                            compteur_points += 1
                        except Exception:
                            continue
                
                print(f"[OK] {compteur_points} paquets valides pour {nom_astre}")
            else:
                print(f"[FAIL] Balises manquantes pour {nom_astre}")
                
        except Exception as e:
            print(f"[ERREUR] Interruption de liaison : {e}")

    # Sauvegarde finale sécurisée
    if sum([len(MATRICE_FINALE[a]) for a in MATRICE_FINALE]) == 0:
        print("[CRITICAL] Aucun astre n'a pu être extrait. Avortement pour préserver l'ancienne base.")
        sys.exit(1)

    with open("orbites.json", "w", encoding="utf-8") as f:
        json.dump(MATRICE_FINALE, f, indent=4, ensure_ascii=False)
    print("[SUCCESS] Nouveau fichier 'orbites.json' écrit avec succès.")

if __name__ == "__main__":
    executer_acquisition()
