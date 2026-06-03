import json
import urllib.request
import math
from datetime import datetime, timezone

# Configuration Station (Marseille - Maille AuroraMap)
LATITUDE = "43.28"
LONGITUDE = "5.36"
ALTITUDE = "0.099" # En km pour le JPL (99 mètres)

def obtenir_meteo_reelle():
    """Récupère les conditions barométriques et thermiques réelles de Marseille via une API publique"""
    meteo = {"pression": 1013.25, "temperature": 15.0}
    
    url = f"https://api.openmeteo.com/v1/forecast?latitude={LATITUDE}&longitude={LONGITUDE}&current_weather=true&surface_pressure=true"
    
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req) as response:
            donnees = json.loads(response.read().decode('utf-8'))
            if "current_weather" in donnees:
                current = donnees["current_weather"]
                if "temperature" in current:
                    meteo["temperature"] = current["temperature"]
                
                # Récupération de la pression de surface au sol
                if "surface_pressure" in current:
                    meteo["pression"] = current["surface_pressure"]
                elif "surface_pressure" in donnees.get("hourly", {}):
                    meteo["pression"] = donnees["hourly"]["surface_pressure"][0]
            print(f"[METEO CLOUD] Alignement validé : T={meteo['temperature']}°C | P={meteo['pression']}hPa")
    except Exception as e:
        print(f"[WARNING] Impossible de joindre les satellites météo ({e}). Utilisation du standard ISPM.")
        
    return meteo

def recuperer_jpl_nasa(id_astre):
    """Télécharge la matrice géocentrique de la NASA et extrait les coordonnées brutes"""
    aujourdhui = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    url = (
        "https://ssd-api.jpl.nasa.gov/horizons.api?"
        "format=json&"
        f"COMMAND='{id_astre}'&"
        "OBJ_DATA='NO'&"
        "MAKE_EPHEM='YES'&"
        "EPHEM_TYPE='OBSERVER'&"
        f"CENTER='coord@399'&"
        f"SITE_COORD='{LONGITUDE},{LATITUDE},{ALTITUDE}'&"
        f"START_TIME='{aujourdhui} 00:00'&"
        f"STOP_TIME='{aujourdhui} 23:59'&"
        "STEP_SIZE='1m'&"
        "QUANTITIES='4'&"
        "REF_SYSTEM='J2000'&"
        "ANG_FORMAT='DEG'"
    )
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req) as response:
            donnees = json.loads(response.read().decode('utf-8'))
            raw_result = donnees['result']
            
            if '$$SOE' not in raw_result or '$$EOE' not in raw_result:
                print(f"[ERROR] Balises de données absentes dans la réponse JPL pour l'astre {id_astre}")
                return []
                
            lignes = raw_result.split('$$SOE')[1].split('$$EOE')[0].strip().split('\n')
            
            liste_points = []
            for ligne in lignes:
                if not ligne.strip(): 
                    continue
                elements = ligne.split()
                if len(elements) >= 4:
                    try:
                        # Nettoyage des marqueurs d'états d'observation de la NASA (*, t, m...)
                        az_str = elements[2].replace('*','').replace('t','').replace('m','')
                        alt_str = elements[3].replace('*','').replace('t','').replace('m','')
                        liste_points.append({"az": float(az_str), "alt": float(alt_str)})
                    except ValueError:
                        continue
            return liste_points
    except Exception as e:
        print(f"[ERROR] Échec JPL pour l'astre {id_astre} : {e}")
        return []

def corriger_refraction_thermique(alt_brute, pression, temp):
    """Calcule la déviation optique induite par l'atmosphère locale à Marseille"""
    if alt_brute < -0.5: 
        return alt_brute
    alt_deg = max(0.0, alt_brute)
    
    denominateur = math.tan(math.radians(alt_deg + (7.31 / (alt_deg + 4.4))))
    if abs(denominateur) < 1e-6: 
        return alt_brute
    cotangente = 1.0 / denominateur
    
    # Loi des gaz parfaits : ajustement de la densité de la couche d'air
    facteur_air = (pression / 1013.25) * (288.15 / (273.15 + temp))
    refraction = (cotangente / 60.0) * facteur_air
    return alt_brute + refraction

def main():
    print("[SYSTEM] Démarrage de la fusion cinématique Cloud...")
    meteo = obtenir_meteo_reelle()
    
    print("[NASA] Téléchargement des matrices JPL (Soleil, Lune, Jupiter)...")
    nasa_soleil = recuperer_jpl_nasa("10")
    nasa_lune = recuperer_jpl_nasa("301")
    nasa_jupiter = recuperer_jpl_nasa("599")
    
    if not nasa_soleil or not nasa_lune or not nasa_jupiter:
        print("[CRITICAL] Annulation : Vecteurs d'éphémérides de la NASA indisponibles.")
        return

    manifeste_final = {"SOLEIL": {}, "LUNE": {}, "JUPITER": {}}
    
    # Détermination de la longueur de sécurité commune pour couvrir les 1440 minutes
    taille_commune = min(1440, len(nasa_soleil), len(nasa_lune), len(nasa_jupiter))
    
    for i in range(taille_commune):
        heures = i // 60
        minutes = i % 60
        
        # Standardisation stricte de la chaîne d'indexation (ex: "18:20", "02:05")
        cle_minute = f"{heures:02d}:{minutes:02d}"
        
        # Application du modèle de correction atmosphérique
        alt_sol = corriger_refraction_thermique(nasa_soleil[i]["alt"], meteo["pression"], meteo["temperature"])
        manifeste_final["SOLEIL"][cle_minute] = [round(nasa_soleil[i]["az"], 2), round(alt_sol, 2)]
        
        alt_lun = corriger_refraction_thermique(nasa_lune[i]["alt"], meteo["pression"], meteo["temperature"])
        manifeste_final["LUNE"][cle_minute] = [round(nasa_lune[i]["az"], 2), round(alt_lun, 2)]
        
        alt_jup = corriger_refraction_thermique(nasa_jupiter[i]["alt"], meteo["pression"], meteo["temperature"])
        manifeste_final["JUPITER"][cle_minute] = [round(nasa_jupiter[i]["az"], 2), round(alt_jup, 2)]

    # Intégration du repère temporel de référence absolue (Timestamp Unix en ms)
    structure_production = {
        "TIMESTAMP_REF": int(datetime.now(timezone.utc).timestamp() * 1000),
        "DONNEES": manifeste_final
    }

    # Écriture physique sur l'espace disque du conteneur de build
    with open("orbites.json", "w", encoding="utf-8") as f:
        json.dump(structure_production, f, indent=2, ensure_ascii=False)
        
    print(f"[SUCCESS] Télémétrie prête. {taille_commune} minutes indexées avec succès dans orbites.json.")

if __name__ == "__main__":
    main()
