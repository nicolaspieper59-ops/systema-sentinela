#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import requests
import json
import re
from datetime import datetime, timezone

def executer_acquisition():
    # CALCUL DYNAMIQUE AUTOMATIQUE : Récupère la date du jour (Ex: "2026-06-05")
    aujourdhui = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    print(f"[INFO] Initialisation de la matrice SENTINELA pour la date : {aujourdhui}")
    
    SITE_GEODETIQUE = "5.36,43.28,0.100" # Marseille (Longitude, Latitude, Altitude en km)
    ASTRES = { "SOLEIL": "10", "LUNE": "301", "JUPITER": "599" }
    MATRICE_FINALE = {}

    # Support du rembourrage par espace de la NASA pour les jours à un chiffre (ex: "Jun- 5")
    regex_ligne_temps = re.compile(r"^\s*(\d{4}-[A-Za-z]{3}-\s*\d+)\s+(\d{2}:\d{2})")
    regex_valeurs_physiques = re.compile(r"(?i)n\.a\.|[-+]?\d+\.\d+(?:[eE][-+]?\d+)?|[-+]?\d+")

    for nom_astre, id_nasa in ASTRES.items():
        MATRICE_FINALE[nom_astre] = {}
        
        url = "https://ssd-api.jpl.nasa.gov/horizons.api"
        
        # CORRECTIF CRITIQUE : Encapsulation stricte de CHAQUE paramètre dans des guillemets simples requis par le JPL
        params = {
            "format": "json",
            "COMMAND": f"'{id_nasa}'",
            "OBJ_DATA": "'NO'",
            "MAKE_EPHEM": "'YES'",
            "EPHEM_TYPE": "'OBSERVER'",
            "CENTER": "'coord@399'",
            "SITE_COORD": f"'{SITE_GEODETIQUE}'",
            "START_TIME": f"'{aujourdhui} 00:00'",
            "STOP_TIME": f"'{aujourdhui} 23:59'",
            "STEP_SIZE": "'1m'",
            "QUANTITIES": "'4,9,20'",
            "REF_SYSTEM": "'J2000'",
            "ANG_FORMAT": "'DEG'"
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
                        
                        # Conversion de distance pour la Lune (UA vers km si nécessaire)
                        if nom_astre == "LUNE" and dist_terre_ua > 1:
                            dist_terre_ua = dist_terre_ua / 149597870.7

                        MATRICE_FINALE[nom_astre][cle_heure_minute] = [
                            azimuth, elevation, mag, dist_terre_ua, vitesse_relative
                        ]
            else:
                # Log de diagnostic en cas de rejet par la NASA
                print(f"[ATTENTION] Balises $$SOE/$$EOE introuvables pour {nom_astre}. Extrait de la réponse : {texte_brut[:300]}")

        except Exception as e:
            print(f"[ERREUR] Échec d'acquisition réseau pour {nom_astre} : {e}")

    with open("orbites.json", "w", encoding="utf-8") as f:
        json.dump(MATRICE_FINALE, f, indent=4, ensure_ascii=False)
    print(f"[SUCCÈS] Matrice SENTINELA synchronisée pour la date du {aujourdhui}")

if __name__ == "__main__":
    executer_acquisition()
