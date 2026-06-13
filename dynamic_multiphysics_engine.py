#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SYSTEMA SENTINELA v7.1 — MOTEUR DE CAPTURE EXCLUSIF NASA JPL HORIZONS
ZÉRO CALCUL LOCAL — SOURCAGE PUR HORIZONS
"""

import json
import time
import re
import requests

def collecter_flux_pur_jpl():
    # Coordonnées géodésiques de la station (Marseille, France)
    LATITUDE = "43.284356"
    LONGITUDE = "5.358507"
    ALTITUDE = "99.31"
    
    # Les 9 corps célestes du cahier des charges avec leurs ID de cible de la NASA
    ASTRES = {
        "soleil": "10", "lune": "301", "mercure": "199", "venus": "299",
        "mars": "499", "jupiter": "599", "saturne": "699", "uranus": "799", "neptune": "899"
    }
    
    maintenant = time.time()
    # Format de temps requis par Horizons : YYYY-MMM-DD HH:MM
    date_debut = time.strftime("%Y-%b-%d %H:%M", time.gmtime(maintenant))
    date_fin = time.strftime("%Y-%b-%d %H:%M", time.gmtime(maintenant + 120)) # Marge de 2 min

    donnees_brutes_jpl = {}
    print(f"[*] Requête d'éphémérides de haute précision auprès de la NASA...")
    print(f"[*] Station Topocentrique : Lat {LATITUDE}, Lon {LONGITUDE}, Alt {ALTITUDE}m")

    for nom, target_id in ASTRES.items():
        url = "https://ssd-api.jpl.nasa.gov/horizons.api"
        query_params = {
            "format": "json",
            "COMMAND": f"'{target_id}'",
            "OBJ_DATA": "NO",
            "MAKE_EPHEM": "YES",
            "EPHEM_TYPE": "OBSERVER",
            "CENTER": f"'coord@{LONGITUDE},{LATITUDE},{ALTITUDE}'",
            "COORD_TYPE": "GEODETIC",
            "START_TIME": f"'{date_debut}'",
            "STOP_TIME": f"'{date_fin}'",
            "STEP_SIZE": "1m",
            "QUANTITIES": "1,4",  # 1 = Ascension Droite / Déclinaison, 4 = Azimut / Élévation Apparente
            "ANG_FORMAT": "DEG"   # Demande explicite des données en degrés décimaux
        }
        
        try:
            r = requests.get(url, params=query_params, timeout=15)
            if r.status_code == 200:
                payload = r.json()
                result_text = payload.get("result", "")
                
                # Isolation stricte du segment de données délimité par la NASA ($$SOE = Start Of Ephemeris)
                if "$$SOE" in result_text and "$$EOE" in result_text:
                    data_segment = result_text.split("$$SOE")[1].split("$$EOE")[0].strip()
                    premiere_ligne = data_segment.split("\n")[0].strip()
                    
                    # Découpage de la ligne de données nettoyée des espaces multiples
                    colonnes = re.split(r'\s+', premiere_ligne)
                    
                    # Structure standard de l'API Horizons (QUANTITIES='1,4' & ANG_FORMAT='DEG') :
                    # [0] Date_Index | [1] Heure_Index | [2] R.A. | [3] DEC | [4] AZIMUT | [5] ELEVATION
                    ra_extraction = float(colonnes[2])
                    dec_extraction = float(colonnes[3])
                    az_extraction = float(colonnes[4])
                    el_extraction = float(colonnes[5])
                    
                    donnees_brutes_jpl[nom] = {
                        "azimut_deg": az_extraction,
                        "elevation_deg": el_extraction,
                        "declinaison_deg": dec_extraction,
                        "ascension_droite_deg": ra_extraction,
                        "statut": "VERIFIED_JPL_DATA"
                    }
                    print(f"  [Extraction Réussie] -> {nom.upper()} via ID {target_id}")
                else:
                    print(f"  [Erreur Structure] Balises $$SOE/$$EOE introuvables pour {nom}")
            else:
                print(f"  [Erreur HTTP {r.status_code}] Impossible de joindre l'API pour {nom}")
        except Exception as e:
            print(f"  [Erreur Réseau/Format] Échec critique sur l'astre {nom}: {e}")

    # Exportation finale de la structure matricielle vers le fichier d'échange
    payload_final = {
        "METADATA": {
            "generateur": "SYSTEMA SENTINELA v7.1 MOTEUR PUR",
            "horodatage_unix_ms": int(maintenant * 1000),
            "synchronisation": "STRICT_JPL_HORIZONS_ONLY"
        },
        "DATA_STREAMS": donnees_brutes_jpl
    }

    with open("flux_live.json", "w", encoding="utf-8") as f:
        json.dump(payload_final, f, indent=4, ensure_ascii=False)
    print("[+] Enregistrement du fichier d'échange 'flux_live.json' terminé.")

if __name__ == "__main__":
    collecter_flux_pur_jpl()
