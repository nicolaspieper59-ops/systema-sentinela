#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SYSTEMA SENTINELA v8.9.7 - Module de Filtrage par Capture Vectorielle
Correction définitive des décalages d'indices induits par les marqueurs de la NASA.
"""

import requests
import json
import sys
import re
from datetime import datetime, timezone

def executer_acquisition():
    aujourdhui = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    print(f"[SENTINELA v8.9.7] Lancement du filtrage géodésique pour : {aujourdhui} UTC")

    SITE_GEODETIQUE = "5.36,43.28,0.100" 
    ASTRES = { "SOLEIL": "10", "LUNE": "301", "JUPITER": "599" }
    MATRICE_FINALE = {}

    # RegEx de découpage : Capture la date (G1) et l'heure HH:MM (G2)
    regex_ligne_temps = re.compile(r"^\s*(\d{4}-[A-Za-z]{3}-\d{2})\s+(\d{2}:\d{2})")
    # RegEx d'extraction physique : Capture uniquement les flottants signés/scientifiques ou les 'n.a.'
    regex_valeurs_physiques = re.compile(r"(?i)n\.a\.|[-+]?\d+\.\d+(?:[eE][-+]?\d+)?|[-+]?\d+")

    for nom_astre, id_nasa in ASTRES.items():
        print(f"[JPL-NASA] Interrogation de l'axe : {nom_astre}...")
        MATRICE_FINALE[nom_astre] = {}
        
        url = "https://ssd-api.jpl.nasa.gov/horizons.api"
        params = {
            "format": "json",
            "COMMAND": id_nasa,
            "OBJ_DATA": "NO",
            "MAKE_EPHEM": "YES",
            "EPHEM_TYPE": "OBSERVER",
            "CENTER": "coord@399",
            "SITE_COORD": SITE_GEODETIQUE,
            "START_TIME": f"{aujourdhui}T00:00",
            "STOP_TIME": f"{aujourdhui}T23:59",
            "STEP_SIZE": "1m",
            "QUANTITIES": "4,9,20", 
            "REF_SYSTEM": "J2000",
            "ANG_FORMAT": "DEG"
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
                    match_temps = regex_ligne_temps.match(ligne)
                    if not match_temps:
                        continue
                    
                    cle_heure_minute = match_temps.group(2) # Extrait strictement "HH:MM"
                    
                    # Extraction des données physiques dans le reste de la ligne
                    reste_de_la_ligne = ligne[match_temps.end():]
                    tokens_physiques = regex_valeurs_physiques.findall(reste_de_la_ligne)
                    
                    # Conversion typée de la ligne de données
                    numeriques = []
                    for val in tokens_physiques:
                        if val.lower() == 'n.a.':
                            numeriques.append('n.a.')
                        else:
                            numeriques.append(float(val))

                    # Validation stricte du set d'éphémérides (6 valeurs requises pour les qtés 4,9,20)
                    if len(numeriques) >= 6:
                        azimuth = numeriques[0]
                        elevation = numeriques[1]
                        
                        mag = numeriques[2]
                        if mag == 'n.a.':
                            mag = -26.74 if nom_astre == "SOLEIL" else (-12.0 if nom_astre == "LUNE" else 0.0)
                        
                        dist_terre_ua = numeriques[4]    # Index 4 : True Distance (Delta)
                        vitesse_relative = numeriques[5] # Index 5 : True Range-rate (Del-Dot)
                        
                        # Normalisation de l'unité de distance lunaire (UA en kilomètres)
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
                
                print(f"[OK] {compteur_points} paquets vectorisés pour {nom_astre}")
            else:
                print(f"[FAIL] Balises de flux absentes pour {nom_astre}")
                
        except Exception as e:
            print(f"[ERREUR] Rupture cinétique de l'axe {nom_astre} : {e}")

    total_points = sum([len(MATRICE_FINALE[a]) for a in MATRICE_FINALE])
    if total_points == 0:
        print("[CRITICAL] Matrice vide. Annulation de l'écriture disque.")
        sys.exit(1)

    with open("orbites.json", "w", encoding="utf-8") as f:
        json.dump(MATRICE_FINALE, f, indent=4, ensure_ascii=False)
    print(f"[SUCCESS] Base de données éphémérides mise à jour.")

if __name__ == "__main__":
    executer_acquisition()
