import requests
import json
from datetime import datetime, timezone

# 1. Forcer la date du jour en UTC pur pour aligner l'horloge atomique
aujourdhui = datetime.now(timezone.utc).strftime('%Y-%m-%d')

ASTRES = {
    "SOLEIL": "10",
    "LUNE": "301",
    "JUPITER": "599"
}

MATRICE_FINALE = {}

for nom_astre, id_nasa in ASTRES.items():
    print(f"[SENTINELA-BACKEND] Échantillonnage balistique : {nom_astre}...")
    MATRICE_FINALE[nom_astre] = {}
    
    url = "https://ssd-api.jpl.nasa.gov/horizons.api"
    params = {
        "format": "json",
        "COMMAND": f"'{id_nasa}'",
        "OBJ_DATA": "NO",
        "MAKE_EPHEM": "YES",
        "EPHEM_TYPE": "OBSERVER",
        "CENTER": "coord@399",
        "SITE_COORD": "'5.36,43.28,0.100'", # Coordonnées de la station
        
        # FORCE : Demande explicite d'une courbe complète de 24h
        "START_TIME": f"'{aujourdhui} 00:00'",
        "STOP_TIME": f"'{aujourdhui} 23:59'",
        
        "STEP_SIZE": "'1m'", # Échantillonnage à la minute
        "QUANTITIES": "'4'",
        "REF_SYSTEM": "'J2000'",
        "ANG_FORMAT": "'DEG'"
    }
    
    try:
        response = requests.get(url, params=params, timeout=10).json()
        texte_brut = response.get("result", "")
        
        if "$$SOE" in texte_brut and "$$EOE" in texte_brut:
            # Isolation du bloc de données utile
            bloc_donnees = texte_brut.split("$$SOE")[1].split("$$EOE")[0]
            lignes = bloc_donnees.strip().split("\n")
            
            for ligne in lignes:
                if not ligne.strip(): 
                    continue
                
                colonnes = ligne.split()
                # Format standard Horizons : YYYY-Mon-DD HH:MM Azimuth Elevation
                # Exemple : ['2026-Jun-04', '06:00', '95.2341', '12.4567']
                if len(colonnes) >= 4:
                    cle_heure_minute = colonnes[1] # Extrait "HH:MM"
                    
                    try:
                        azimuth = float(colonnes[2])
                        elevation = float(colonnes[3])
                        
                        # Stockage indexé par la clé de minute pure
                        MATRICE_FINALE[nom_astre][cle_heure_minute] = [azimuth, elevation]
                    except ValueError:
                        continue
        else:
            print(f"[ERREUR] Balises $$SOE absentes pour {nom_astre}")
            
    except Exception as e:
        print(f"[CRITICAL] Échec de la liaison JPL pour {nom_astre}: {e}")

# 2. Validation de sécurité : Interdire l'écriture si le dictionnaire est défaillant
compte_cles = sum([len(MATRICE_FINALE[a]) for a in MATRICE_FINALE])
if compte_cles == 0:
    raise RuntimeError("Alerte critique : La matrice générée est vide. Déploiement avorté.")

# 3. Sauvegarde finale (Vérifier que cette instruction est bien HORS de la boucle for)
with open("orbites.json", "w", encoding="utf-8") as f:
    json.dump(MATRICE_FINALE, f, indent=4)

print(f"[SUCCESS] Matrice mise à jour avec {compte_cles} coordonnées cinématiques.")
