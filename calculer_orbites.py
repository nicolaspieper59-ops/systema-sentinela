#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SYSTEMA SENTINELA v8.6.4 - Module d'Acquisition Cinématique Purifié
Correction du protocole d'encodage des requêtes REST de l'API JPL Horizons
"""

import requests
import json
import sys
from datetime import datetime, timezone

def executer_acquisition():
    # Alignement temporel sur l'horloge absolue (UTC)
    aujourdhui = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    print(f"[SENTINELA-ENGINE] Initialisation du cycle pour le repère : {aujourdhui} UTC")

    ASTRES = {
        "SOLEIL": "10",
        "LUNE": "301",
        "JUPITER": "599"
    }

    MATRICE_FINALE = {}

    for nom_astre, id_nasa in ASTRES.items():
        print(f"[SENTINELA-ENGINE] Interrogation du vecteur : {nom_astre} (ID: {id_nasa})...")
        MATRICE_FINALE[nom_astre] = {}
        
        url = "https://ssd-api.jpl.nasa.gov/horizons.api"
        
        # PARAMÈTRES NETTOYÉS : Suppression des guillemets simples littéraux parasites
        params = {
            "format": "json",
            "COMMAND": id_nasa,
            "OBJ_DATA": "NO",
            "MAKE_EPHEM": "YES",
            "EPHEM_TYPE": "OBSERVER",
            "CENTER": "coord@399",
            "SITE_COORD": "5.36,43.28,0.100",  # Marseille : Longitude, Latitude, Altitude (km)
            "START_TIME": f"{aujourdhui} 00:00",
            "STOP_TIME": f"{aujourdhui} 23:59",
            "STEP_SIZE": "1m",                  # Résolution stricte à la minute
            "QUANTITIES": "4",                  # Éléments recherchés : Azimut + Élévation
            "REF_SYSTEM": "J2000",
            "ANG_FORMAT": "DEG"
        }
        
        try:
            response = requests.get(url, params=params, timeout=15)
            
            if response.status_code != 200:
                print(f"[ERREUR] HTTP {response.status_code} sur l'astre {nom_astre}")
                continue
                
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
                        cle_heure_minute = colonnes[1]  # Extraction de la clé "HH:MM"
                        
                        # Filtrage dynamique des marqueurs d'ombrage ou de transition visuelle de la NASA (*, m, A, etc.)
                        valeurs_numeriques = []
                        for element in colonnes[2:]:
                            try:
                                valeurs_numeriques.append(float(element))
                            except ValueError:
                                continue
                        
                        if len(valeurs_numeriques) >= 2:
                            azimuth = valeurs_numeriques[0]
                            elevation = valeurs_numeriques[1]
                            MATRICE_FINALE[nom_astre][cle_heure_minute] = [azimuth, elevation]
                            compteur_points += 1
                
                print(f"[SUCCESS] {compteur_points} coordonnées injectées pour {nom_astre}")
            else:
                print(f"[ERREUR] Flux de données illisible ou rejeté par la NASA pour {nom_astre}")
                if "error" in data_json:
                    print(f"[NASA-DIAGNOSTIC] {data_json['error']}")
                
        except Exception as e:
            print(f"[CRITICAL] Rupture de liaison avec l'API JPL pour {nom_astre}: {e}")

    # Protocole de validation de la matrice de données
    compte_total_cles = sum([len(MATRICE_FINALE[a]) for a in MATRICE_FINALE])
    print(f"[TÉLÉMÉTRIE] Analyse de fin de cycle : {compte_total_cles} points physiques générés.")

    if compte_total_cles == 0:
        print("[CRITICAL] Échec global : La matrice finale est vide. Avortement du déploiement.")
        sys.exit(1)

    # Sauvegarde physique sur l'espace disque du Runner GitHub Actions
    try:
        with open("orbites.json", "w", encoding="utf-8") as f:
            json.dump(MATRICE_FINALE, f, indent=4, ensure_ascii=False)
        print("[SUCCESS] Matrice d'éphémérides 'orbites.json' mise à jour.")
    except IOError as e:
        print(f"[CRITICAL] Échec d'écriture du fichier de sortie : {e}")
        sys.exit(1)

if __name__ == "__main__":
    executer_acquisition()
