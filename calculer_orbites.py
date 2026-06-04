#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SYSTEMA SENTINELA v8.9.8 - Correctif de Tolérance Géodésique
Élimination absolue des marqueurs de transition de la NASA (*, m, t, p, A)
"""

import requests
import json
import sys
import re
from datetime import datetime, timezone

def executer_acquisition():
    aujourdhui = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    print(f"[SENTINELA v8.9.8] Initialisation du filtrage robuste pour : {aujourdhui} UTC")

    # Coordonnées du site (Marseille : Long 5.36, Lat 43.28, Alt 100m)
    SITE_GEODETIQUE = "5.36,43.28,0.100" 
    ASTRES = { "SOLEIL": "10", "LUNE": "301", "JUPITER": "599" }
    MATRICE_FINALE = {}

    regex_ligne_temps = re.compile(r"^\s*(\d{4}-[A-Za-z]{3}-\d{2})\s+(\d{2}:\d{2})")
    regex_valeurs_physiques = re.compile(r"(?i)n\.a\.|[-+]?\d+\.\d+(?:[eE][-+]?\d+)?|[-+]?\d+")

    for nom_astre, id_nasa in ASTRES.items():
        print(f"[JPL-NASA] Téléchargement du vecteur de cible : {nom_astre}...")
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
                    
                    cle_heure_minute = match_temps.group(2)
                    
                    # CORRECTION V8.9.8 : Neutralisation des métacaractères collés aux valeurs
                    reste = ligne[match_temps.end():]
                    reste_nettoye = re.sub(r'\s+[a-zA-Z\*]\s+', ' ', reste)
                    reste_nettoye = re.sub(r'([0-9])([a-zA-Z\*]+)(\s+|$)', r'\1 ', reste_nettoye)
                    
                    tokens_physiques = regex_valeurs_physiques.findall(reste_nettoye)
                    
                    numeriques = []
                    for val in tokens_physiques:
                        if val.lower() == 'n.a.':
                            numeriques.append('n.a.')
                        else:
                            try:
                                numeriques.append(float(val))
                            except ValueError:
                                continue

                    # Validation dynamique (Prise en compte des lignes à 5 ou 6 variables)
                    if len(numeriques) >= 5:
                        azimuth = numeriques[0]
                        elevation = numeriques[1]
                        
                        if len(numeriques) == 5:
                            # Reconstitution de la magnitude par défaut si colonne masquée par un marqueur
                            mag = -26.74 if nom_astre == "SOLEIL" else (-12.0 if nom_astre == "LUNE" else 0.0)
                            dist_terre_ua = numeriques[3]
                            vitesse_relative = numeriques[4]
                        else:
                            mag = numeriques[2]
                            if mag == 'n.a.':
                                mag = -26.74 if nom_astre == "SOLEIL" else (-12.0 if nom_astre == "LUNE" else 0.0)
                            dist_terre_ua = numeriques[4]
                            vitesse_relative = numeriques[5]
                        
                        if nom_astre == "LUNE" and dist_terre_ua > 1:
                            dist_terre_ua = dist_terre_ua / 149597870.7

                        MATRICE_FINALE[nom_astre][cle_heure_minute] = [
                            azimuth, elevation, mag, dist_terre_ua, vitesse_relative
                        ]
                        compteur_points += 1
                
                print(f"[OK] {compteur_points} paquets indexés pour {nom_astre}")
            else:
                print(f"[FAIL] Balises éphémérides $$SOE/$$EOE introuvables pour {nom_astre}")
                
        except Exception as e:
            print(f"[ERREUR] Échec critique axe {nom_astre} : {e}")

    if sum([len(MATRICE_FINALE[a]) for a in MATRICE_FINALE]) == 0:
        print("[CRITICAL] Erreur structurelle globale. Fichier avorté.")
        sys.exit(1)

    with open("orbites.json", "w", encoding="utf-8") as f:
        json.dump(MATRICE_FINALE, f, indent=4, ensure_ascii=False)
    print(f"[SUCCESS] Base de données éphémérides v8.9.8 générée.")

if __name__ == "__main__":
    executer_acquisition()
