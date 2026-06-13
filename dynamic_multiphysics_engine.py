#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SYSTEMA SENTINELA — MOTEUR COMPOSITE PRO 
INTERRIGATION DIRECTE NASA JPL HORIZONS & GÉNÉRATION DU MATRICIEL XYZ/HORIZON
"""

import json
import math
import time
import requests

def obtenir_flux_jpl_horizons():
    # Coordonnées de calage de la station de Marseille (issues des specs matérielles)
    LATITUDE = "43.284565"
    LONGITUDE = "5.358658"
    ALTITUDE = "98.40"
    
    # Catalogue complet des 9 astres requis avec leurs ID de cible NASA
    ASTRES_JPL = {
        "soleil": "10", "lune": "301", "mercure": "199", "venus": "299",
        "mars": "499", "jupiter": "599", "saturne": "699", "uranus": "799", "neptune": "899"
    }
    
    timestamp_actuel = time.time()
    # Formatage du temps pour l'API JPL (Chrono synchronisé)
    date_utc = time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime(timestamp_actuel))
    date_fin_utc = time.strftime("%Y-%m-%d %H:%M:%I", time.gmtime(timestamp_actuel + 60))

    donnees_streams = {}
    print(f"[*] Initialisation de la capture JPL Horizons pour : {date_utc} UTC")

    for nom, id_jpl in ASTRES_JPL.items():
        url = "https://ssd-api.jpl.nasa.gov/horizons.api"
        parametres = {
            "format": "json",
            "COMMAND": f"'{id_jpl}'",
            "OBJ_DATA": "NO",
            "MAKE_EPHEM": "YES",
            "EPHEM_TYPE": "OBSERVER",
            "CENTER": f"'coord@{LONGITUDE},{LATITUDE},{ALTITUDE}'",
            "COORD_TYPE": "GEODETIC",
            "START_TIME": f"'{date_utc}'",
            "STOP_TIME": f"'{date_fin_utc}'",
            "STEP_SIZE": "1m",
            "QUANTITIES": "4,1,9",  # 4=Az/El, 1=RA/DEC, 9=Illumination (pour la Lune)
        }
        
        try:
            reponse = requests.get(url, params=parametres, timeout=10)
            if reponse.status_code == 200:
                res_json = reponse.json()
                lignes_data = res_json.get("result", "").split("$$SOE")[1].split("$$EOE")[0].strip()
                colonnes = lignes_data.split("\n")[0].split(",")
                
                # Extraction des variables angulaires natives
                ra_str = colonnes[2].strip()   # Ascension Droite
                dec_str = colonnes[3].strip()  # Déclinaison
                az_str = colonnes[4].strip()   # Azimut
                el_str = colonnes[5].strip()   # Élévation
                
                illum_lune = 0.0
                if nom == "lune" and len(colonnes) > 6:
                    illum_lune = float(colonnes[6].strip())

                donnees_streams[nom] = {
                    "azimut_deg": float(az_str),
                    "elevation_deg": float(el_str),
                    "declinaison_deg": float(dec_str),
                    "ascension_droite_deg": float(ra_str),
                    "illumination": illum_lune if nom == "lune" else None
                }
        except Exception as e:
            print(f"[ERR] Échec de la capture en ligne de l'astre {nom}: {e}")
            # Mode dégradé : Injection de valeurs neutres, le JS prendra le relais via VSOP87
            donnees_streams[nom] = None

    # Structuration du fichier de sortie conforme aux spécifications SENTINELA
    output_payload = {
        "METADATA": {
            "source": "NASA JPL Horizons Coordinate Engine",
            "epoch_j2000_utc": 946727968000,
            "delta_t_s": 69.2,
            "horodatage_utc": date_utc + " UTC"
        },
        "DATA_STREAMS": donnees_streams
    }

    with open("flux_live.json", "w", encoding="utf-8") as f:
        json.dump(output_payload, f, indent=4, ensure_ascii=False)
    print("[+] Fichier 'flux_live.json' mis à jour avec succès.")

if __name__ == "__main__":
    obtenir_flux_jpl_horizons()
