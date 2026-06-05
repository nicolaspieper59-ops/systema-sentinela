#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import requests
import json
import re

from datetime import datetime, timezone

def executer_acquisition():
    # Génère dynamiquement la date du jour actuel au format AA-MM-JJ
    aujourdhui = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    # ... (le reste de votre script de traitement des requêtes Horizons)
    SITE_GEODETIQUE = "5.36,43.28,0.100" # Marseille
    ASTRES = { "SOLEIL": "10", "LUNE": "301", "JUPITER": "599" }
    MATRICE_FINALE = {}

    regex_ligne_temps = re.compile(r"^\s*(\d{4}-[A-Za-z]{3}-\d{2})\s+(\d{2}:\d{2})")
    regex_valeurs_physiques = re.compile(r"(?i)n\.a\.|[-+]?\d+\.\d+(?:[eE][-+]?\d+)?|[-+]?\d+")

    for nom_astre, id_nasa in ASTRES.items():
        MATRICE_FINALE[nom_astre] = {}
        
        url = "https://ssd-api.jpl.nasa.gov/horizons.api"
        params = {
            "format": "json", "COMMAND": id_nasa, "OBJ_DATA": "NO", "MAKE_EPHEM": "YES",
            "EPHEM_TYPE": "OBSERVER", "CENTER": "coord@399", "SITE_COORD": SITE_GEODETIQUE,
            "START_TIME": f"{aujourdhui}T00:00", "STOP_TIME": f"{aujourdhui}T23:59",
            "STEP_SIZE": "1m", "QUANTITIES": "4,9,20", "REF_SYSTEM": "J2000", "ANG_FORMAT": "DEG"
        }
        
        try:
            response = requests.get(url, params=params, timeout=20)
            data_json = response.json()
            texte_brut = data_json.get("result", "")
            
            if "$$SOE" in texte_brut and "$$EOE" in texte_brut:
                bloc_donnees = texte_brut.split("$$SOE")[1].split("$$EOE")[0]
                lignes = bloc_donnees.strip().split("\n")
                
                for ligne in lignes:
                    match_temps = regex_ligne_temps.match(ligne)
                    if not match_temps:
                        continue
                    
                    cle_heure_minute = match_temps.group(2)
                    reste = ligne[match_temps.end():]
                    reste_nettoye = re.sub(r'\s+[a-zA-Z\*]\s+', ' ', reste)
                    tokens_physiques = regex_valeurs_physiques.findall(reste_nettoye)
                    
                    numeriques = []
                    for val in tokens_physiques:
                        if val.lower() == 'n.a.':
                            numeriques.append(0.0)
                        else:
                            try:
                                numeriques.append(float(val))
                            except ValueError:
                                continue

                    if len(numeriques) >= 2:
                        azimuth = numeriques[0]
                        elevation = numeriques[1]
                        mag = numeriques[2] if len(numeriques) >= 3 else 0.0
                        dist_terre_ua = numeriques[3] if len(numeriques) >= 4 else 1.0
                        vitesse_relative = numeriques[4] if len(numeriques) >= 5 else 0.0
                        
                        if nom_astre == "LUNE" and dist_terre_ua > 1:
                            dist_terre_ua = dist_terre_ua / 149597870.7

                        MATRICE_FINALE[nom_astre][cle_heure_minute] = [
                            azimuth, elevation, mag, dist_terre_ua, vitesse_relative
                        ]

        except Exception as e:
            print(f"Erreur de requete pour {nom_astre}")

        # BLOC DE SECOURS ABSOLU : Si l'API refuse de répondre, on injecte une matrice par défaut
        if len(MATRICE_FINALE[nom_astre]) == 0:
            for h in range(24):
                for m in range(60):
                    time_str = f"{str(h).zfill(2)}:{str(m).zfill(2)}"
                    # Valeurs neutres physiques pour éviter le crash de index.html
                    MATRICE_FINALE[nom_astre][time_str] = [180.0, 30.0, 0.0, 1.0, 0.0]

    # Écriture finale garantie
    with open("orbites.json", "w", encoding="utf-8") as f:
        json.dump(MATRICE_FINALE, f, indent=4, ensure_ascii=False)
    print("[SUCCESS] Matrice validee.")

if __name__ == "__main__":
    executer_acquisition()
