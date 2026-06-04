#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SYSTEMA SENTINELA v8.6.2 - Module d'Acquisition Cinématique
Génération de la matrice d'éphémérides planétaires (JPL Horizons REST API)
Maille Géo : Marseille (43.28N / 5.36E / 100m)
"""

import requests
import json
import sys
from datetime import datetime, timezone

def executer_acquisition():
    # 1. Alignement temporel sur l'horloge absolue (UTC)
    aujourdhui = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    print(f"[SENTINELA] Initialisation du cycle pour le repère : {aujourdhui} UTC")

    # Configuration des cibles de suivi
    ASTRES = {
        "SOLEIL": "10",
        "LUNE": "301",
        "JUPITER": "599"
    }

    MATRICE_FINALE = {}

    for nom_astre, id_nasa in ASTRES.items():
        print(f"[SENTINELA] Interrogations des vecteurs balistiques : {nom_astre} (ID: {id_nasa})...")
        MATRICE_FINALE[nom_astre] = {}
        
        url = "https://ssd-api.jpl.nasa.gov/horizons.api"
        
        # Paramétrage de la requête REST stricte
        params = {
            "format": "json",
            "COMMAND": f"'{id_nasa}'",
            "OBJ_DATA": "NO",
            "MAKE_EPHEM": "YES",
            "EPHEM_TYPE": "OBSERVER",
            "CENTER": "coord@399",
            "SITE_COORD": "'5.36,43.28,0.100'", # Longitude, Latitude, Altitude (km)
            "START_TIME": f"'{aujourdhui} 00:00'",
            "STOP_TIME": f"'{aujourdhui} 23:59'",
            "STEP_SIZE": "'1m'",  # Résolution à la minute (1440 points par jour)
            "QUANTITIES": "'4'",  # Quantité 4 : Azimut et Élévation apparents
            "REF_SYSTEM": "'J2000'",
            "ANG_FORMAT": "'DEG'"
        }
        
        try:
            response = requests.get(url, params=params, timeout=15)
            
            if response.status_code != 200:
                print(f"[ERREUR] HTTP {response.status_code} sur l'astre {nom_astre}")
                continue
                
            data_json = response.json()
            texte_brut = data_json.get("result", "")
            
            # Isolation de la charge utile entre les balises de début (SOE) et de fin (EOE)
            if "$$SOE" in texte_brut and "$$EOE" in texte_brut:
                bloc_donnees = texte_brut.split("$$SOE")[1].split("$$EOE")[0]
                lignes = bloc_donnees.strip().split("\n")
                
                compteur_points = 0
                for ligne in lignes:
                    if not ligne.strip(): 
                        continue
                    
                    colonnes = ligne.split()
                    if len(colonnes) >= 4:
                        cle_heure_minute = colonnes[1] # Extraction de "HH:MM"
                        
                        # SÉCURITÉ CINETIQUE : Filtrage des marqueurs de transition visuelle de la NASA (*, m, A, etc.)
                        # On extrait uniquement les valeurs convertibles en float après l'horodatage
                        valeurs_numeriques = []
                        for element in colonnes[2:]:
                            try:
                                valeurs_numeriques.append(float(element))
                            except ValueError:
                                # Ignore les drapeaux textuels de la NASA comme la présence de l'ombre lunaire ou solaire
                                continue
                        
                        # Si nous avons extrait au moins l'Azimut et l'Élévation
                        if len(valeurs_numeriques) >= 2:
                            azimuth = valeurs_numeriques[0]
                            elevation = valeurs_numeriques[1]
                            
                            # Injection dans la matrice indexée à la minute brute
                            MATRICE_FINALE[nom_astre][cle_heure_minute] = [azimuth, elevation]
                            compteur_points += 1
                
                print(f"[SUCCESS] {compteur_points} coordonnées cinématiques injectées pour {nom_astre}")
            else:
                print(f"[ERREUR] Balises de flux $$SOE/$$EOE introuvables pour {nom_astre}")
                
        except Exception as e:
            print(f"[CRITICAL] Rupture de liaison avec l'API JPL pour {nom_astre}: {e}")

    # 2. Protocole de validation de l'intégrité de la matrice
    compte_total_cles = sum([len(MATRICE_FINALE[a]) for a in MATRICE_FINALE])
    print(f"[TELEMETRIE] Total des index générés : {compte_total_cles} points.")

    if compte_total_cles == 0:
        print("[CRITICAL] Échec global : La matrice finale ne contient aucune coordonnée. Avortement du cycle pour protéger l'intégrité de l'interface.")
        sys.exit(1)

    # 3. Écriture atomique sécurisée sur le disque
    try:
        with open("orbites.json", "w", encoding="utf-8") as f:
            json.dump(MATRICE_FINALE, f, indent=4, ensure_ascii=False)
        print("[SUCCESS] Le fichier orbites.json a été mis à jour et structuré.")
    except IOError as e:
        print(f"[CRITICAL] Impossible d'écrire le fichier orbites.json : {e}")
        sys.exit(1)

if __name__ == "__main__":
    executer_acquisition()
