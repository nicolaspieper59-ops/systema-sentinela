import requests
import json
import sys
from datetime import datetime, timezone

def executer_acquisition():
    # Date du jour en UTC pur
    aujourdhui = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    print(f"[SENTINELA] Initialisation du cycle pour : {aujourdhui} UTC")

    ASTRES = {
        "SOLEIL": "10",
        "LUNE": "301",
        "JUPITER": "599"
    }

    MATRICE_FINALE = {}

    for nom_astre, id_nasa in ASTRES.items():
        print(f"[SENTINELA] Requête NASA Horizons : {nom_astre}...")
        MATRICE_FINALE[nom_astre] = {}
        
        url = "https://ssd-api.jpl.nasa.gov/horizons.api"
        params = {
            "format": "json",
            "COMMAND": f"'{id_nasa}'",
            "OBJ_DATA": "NO",
            "MAKE_EPHEM": "YES",
            "EPHEM_TYPE": "OBSERVER",
            "CENTER": "coord@399",
            "SITE_COORD": "'5.36,43.28,0.100'", # Marseille : Longitude, Latitude, Altitude (km)
            "START_TIME": f"'{aujourdhui} 00:00'",
            "STOP_TIME": f"'{aujourdhui} 23:59'",
            "STEP_SIZE": "'1m'",  # 1 point par minute (1440 points/jour)
            "QUANTITIES": "'4'",  # Azimut et Élévation apparents
            "REF_SYSTEM": "'J2000'",
            "ANG_FORMAT": "'DEG'"
        }
        
        try:
            response = requests.get(url, params=params, timeout=15)
            if response.status_code != 200:
                continue
                
            data_json = response.json()
            texte_brut = data_json.get("result", "")
            
            if "$$SOE" in texte_brut and "$$EOE" in texte_brut:
                bloc_donnees = texte_brut.split("$$SOE")[1].split("$$EOE")[0]
                lignes = bloc_donnees.strip().split("\n")
                
                for ligne in lignes:
                    if not ligne.strip(): 
                        continue
                    colonnes = ligne.split()
                    if len(colonnes) >= 4:
                        cle_heure_minute = colonnes[1] # "HH:MM"
                        
                        # Filtrage des caractères parasites de la NASA (*, m, A...)
                        valeurs_numeriques = []
                        for element in colonnes[2:]:
                            try:
                                valeurs_numeriques.append(float(element))
                            except ValueError:
                                continue
                        
                        if len(valeurs_numeriques) >= 2:
                            MATRICE_FINALE[nom_astre][cle_heure_minute] = [valeurs_numeriques[0], valeurs_numeriques[1]]
        except Exception as e:
            print(f"[ERREUR] Liaison coupée pour {nom_astre}: {e}")

    # Écriture du fichier sur le disque
    try:
        with open("orbites.json", "w", encoding="utf-8") as f:
            json.dump(MATRICE_FINALE, f, indent=4, ensure_ascii=False)
        print("[SUCCESS] Le fichier 'orbites.json' a été créé avec succès !")
    except IOError as e:
        print(f"[CRITICAL] Échec d'écriture : {e}")

if __name__ == "__main__":
    executer_acquisition()
