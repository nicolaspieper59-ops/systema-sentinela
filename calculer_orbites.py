#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SYSTEMA SENTINELA v8.9.4 - Module d'Acquisition Filtré JPL-NASA
Filtre numérique sélectif pour parer le conflit des noms de mois (Jun/Mar/May).
"""

import requests
import json
import sys
from datetime import datetime, timezone

def executer_acquisition():
    aujourdhui = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    print(f"[SENTINELA v8.9.4] Lancement de l'acquisition pour : {aujourdhui} UTC")

    # Coordonnées géodésiques terrestres (Ajustables)
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
            "QUANTITIES": "'4,9,20'", 
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
                    tokens = ligne.strip().split()
                    if len(tokens) < 4:
                        continue
                    
                    # 1. Extraction propre de l'horloge en ignorant les drapeaux collés (*m, *t)
                    token_temps = tokens[1]
                    cle_heure_minute = "".join([c for c in token_temps if c.isdigit() or c == ':'])
                    
                    # 2. Extraction sélective des valeurs numériques associées
                    numeriques = []
                    for t in tokens[2:]:
                        # On préserve uniquement les caractères mathématiques ou l'indicateur n.a.
                        composants_valides = "".join([c for c in t if c.isdigit() or c in '.-+eEna'])
                        if composants_valides == 'n.a.':
                            numeriques.append('n.a.')
                        else:
                            try:
                                numeriques.append(float(composants_valides))
                            except ValueError:
                                continue # Ignore les résidus de drapeaux de la NASA (m, n, t, *)

                    # Vérification de la présence du set minimal de données (Az, Alt, Mag, Dist, Vit)
                    if len(numeriques) >= 5:
                        azimuth = numeriques[0]
                        elevation = numeriques[1]
                        
                        # Traitement des exceptions de magnitude pour le Soleil/Lune
                        mag = numeriques[2] if numeriques[2] != 'n.a.' else (-26.74 if nom_astre == "SOLEIL" else -12.0)
                        dist_terre_ua = numeriques[3]
                        vitesse_relative = numeriques[4]
                        
                        if nom_astre == "LUNE" and dist_terre_ua > 1:
                            dist_terre_ua = dist_terre_ua / 149597870.7

                        MATRICE_FINALE[nom_astre][cle_heure_minute] = [
                            azimuth,          # [0]
                            elevation,        # [1]
                            mag,              # [2]
                            dist_terre_ua,    # [3]
                            vitesse_relative  # [4]
                        ]
                        compteur_points += 1
                
                print(f"[OK] {compteur_points} paquets valides générés pour {nom_astre}")
            else:
                print(f"[FAIL] Balises de flux absentes pour {nom_astre}")
                
        except Exception as e:
            print(f"[ERREUR] Rupture physique de la liaison : {e}")

    # Sécurité anti-écrasement
    total_points = sum([len(MATRICE_FINALE[a]) for a in MATRICE_FINALE])
    if total_points == 0:
        print("[CRITICAL] Base de données vide détectée. Interdiction d'écriture.")
        sys.exit(1)

    with open("orbites.json", "w", encoding="utf-8") as f:
        json.dump(MATRICE_FINALE, f, indent=4, ensure_ascii=False)
    print(f"[SUCCESS] Super-matrice mise à jour avec {total_points} positions temporelles.")

if __name__ == "__main__":
    executer_acquisition()
