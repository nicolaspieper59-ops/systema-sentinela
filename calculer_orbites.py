#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SYSTEMA SENTINELA v8.6.5 - Module d'Acquisition Cinématique Purifié
Correction définitive de l'alignement des requêtes REST et gestion du fuseau horaire.
"""

import requests
import json
import sys
from datetime import datetime, timezone

def executer_acquisition():
    # Définition de la date du jour UTC
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
        
        # PARAMÈTRES ISO : Utilisation du caractère 'T' pour éviter les espaces blancs non encodés
        params = {
            "format": "json",
            "COMMAND": f"'{id_nasa}'", # Horizons exige parfois des guillemets simples internes sur l'API brute
            "OBJ_DATA": "'NO'",
            "MAKE_EPHEM": "'YES'",
            "EPHEM_TYPE": "'OBSERVER'",
            "CENTER": "'coord@399'",
            "SITE_COORD": "'5.36,43.28,0.100'",  # Longitude, Latitude, Altitude (km)
            "START_TIME": f"'{aujourdhui}T00:00'",
            "STOP_TIME": f"'{aujourdhui}T23:59'",
            "STEP_SIZE": "'1m'",
            "QUANTITIES": "'4'",
            "REF_SYSTEM": "'J2000'",
            "ANG_FORMAT": "'DEG'"
        }
        
        try:
            # Envoi avec chaîne brute d'URL encodée
            response = requests.get(url, params=params, timeout=20)
            
            if response.status_code != 200:
                print(f"[REJET] Code HTTP {response.status_code} reçu de la NASA.")
                continue
                
            data_json = response.json()
            
            # Gestion des erreurs internes renvoyées par l'API NASA sous forme de JSON valide
            if "error" in data_json or "message" in data_json:
                print(f"[AFFICHEUR NASA] Diagnostic direct : {data_json.get('error', data_json.get('message'))}")
                # Tentative secondaire sans guillemets si le serveur refuse la syntaxe stricte
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
                        cle_heure_minute = colonnes[1]  # Format "HH:MM"
                        
                        # Extraction robuste des coordonnées malgré les symboles NASA (*, m, t)
                        valeurs_numeriques = []
                        for element in colonnes[2:]:
                            # Nettoie les caractères de transition visuelle (ex: "124.52*m" -> "124.52")
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
                print(f"[ALERT] Structure $$SOE absente pour {nom_astre}. Vérifiez vos logs d'API.")
                
        except Exception as e:
            print(f"[CRITICAL] Erreur de communication réseau : {e}")

    # Contrôle global de la matrice avant écrasement
    compte_total_cles = sum([len(MATRICE_FINALE[a]) for a in MATRICE_FINALE])
    print(f"[BILAN] {compte_total_cles} coordonnées physiques totales calculées.")

    if compte_total_cles == 0:
        print("[FAIL] Matrice vide. Sauvegarde annulée pour préserver l'ancien état.")
        sys.exit(1)

    # Enregistrement du fichier final
    try:
        with open("orbites.json", "w", encoding="utf-8") as f:
            json.dump(MATRICE_FINALE, f, indent=4, ensure_ascii=False)
        print("[SUCCESS] Le fichier 'orbites.json' est prêt à être publié.")
    except IOError as e:
        print(f"[FATAL] Impossible d'écrire sur le disque : {e}")
        sys.exit(1)

if __name__ == "__main__":
    executer_acquisition()
