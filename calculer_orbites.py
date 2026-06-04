`#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SYSTEMA SENTINELA v8.7.0 - Module d'Acquisition Cinématique Purifié
Moteur d'acquisition pour calcul différentiel continu
"""

import requests
import json
import sys
from datetime import datetime, timezone

def executer_acquisition():
    aujourdhui = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    print(f"[SENTINELA] Initialisation du cycle pour la date : {aujourdhui} UTC")

    ASTRES = {
        "SOLEIL": "10",
        "LUNE": "301",
        "JUPITER": "599"
    }

    MATRICE_FINALE = {}

    for nom_astre, id_nasa in ASTRES.items():
        print(f"[SENTINELA] Téléchargement des vecteurs : {nom_astre} (ID: {id_nasa})...")
        MATRICE_FINALE[nom_astre] = {}
        
        url = "https://ssd-api.jpl.nasa.gov/horizons.api"
        
        params = {
            "format": "json",
            "COMMAND": f"'{id_nasa}'",
            "OBJ_DATA": "'NO'",
            "MAKE_EPHEM": "'YES'",
            "EPHEM_TYPE": "'OBSERVER'",
            "CENTER": "'coord@399'",
            "SITE_COORD": "'5.36,43.28,0.100'",
            "START_TIME": f"'{aujourdhui}T00:00'",
            "STOP_TIME": f"'{aujourdhui}T23:59'",
            "STEP_SIZE": "'1m'",
            "QUANTITIES": "'4'",
            "REF_SYSTEM": "'J2000'",
            "ANG_FORMAT": "'DEG'"
        }
        
        try:
            response = requests.get(url, params=params, timeout=20)
            data_json = response.json()
            
            if "error" in data_json or "message" in data_json or response.status_code != 200:
                params_alt = {k: v.replace("'", "") for k, v in params.items()}
                response = requests.get(url, params=params_alt, timeout=20)
                data_json = response.json()

            texte_brut = data_json.get("result", "")
            
            if "$$SOE" in texte_brut and "$$EOE" in texte_brut:
                bloc_donnees = texte_brut.split("$$SOE")[1].split("$$EOE")[0]
                lignes = bloc_donnees.strip().split("\n")
                
                compteur_points = 0
                for ligne in lignes:
                    if not ligne.strip(): 
                        continue
                    
                    colonnes = ligne.split()
                    if len(colonnes) >= 4:
                        cle_heure_minute = colonnes[1]
                        
                        valeurs_numeriques = []
                        for element in colonnes[2:]:
                            clean_element = ''.join(c for c in element if c.isdigit() or c in ['.', '-'])
                            try:
                                valeurs_numeriques.append(float(clean_element))
                            except ValueError:
                                continue
                        
                        if len(valeurs_numeriques) >= 2:
                            azimuth = valeurs_numeriques[0]
                            elevation = valeurs_numeriques[1]
                            MATRICE_FINALE[nom_astre][cle_heure_minute] = [azimuth, elevation]
                            compteur_points += 1
                
                print(f"[OK] {compteur_points} lignes mémorisées pour {nom_astre}")
            else:
                print(f"[ALERT] Structure $$SOE absente pour {nom_astre}.")
                
        except Exception as e:
            print(f"[CRITICAL] Erreur réseau : {e}")

    compte_total_cles = sum([len(MATRICE_FINALE[a]) for a in MATRICE_FINALE])
    if compte_total_cles == 0:
        print("[FAIL] Matrice vide. Avortement.")
        sys.exit(1)

    try:
        with open("orbites.json", "w", encoding="utf-8") as f:
            json.dump(MATRICE_FINALE, f, indent=4, ensure_ascii=False)
        print("[SUCCESS] Fichier 'orbites.json' prêt.")
    except IOError as e:
        print(f"[FATAL] Échec écriture : {e}")
        sys.exit(1)

if __name__ == "__main__":
    executer_acquisition()
