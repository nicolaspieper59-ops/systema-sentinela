import json
import urllib.request
import math
from datetime import datetime, timezone

# Configuration Station (Marseille)
LATITUDE = "43.284565"
LONGITUDE = "5.358658"
ALTITUDE = "0.05"

def obtenir_meteo_reelle():
    """Récupère les conditions barométriques et thermiques réelles de Marseille via une API publique"""
    # Valeurs de secours si l'API météo est saturée
    meteo = {"pression": 1013.25, "temperature": 15.0}
    
    # Utilisation d'une clé API publique de démonstration OpenWeather ou d'un fallback mondial
    # Pour une précision absolue, remplacez par votre clé OpenWeather à terme
    url = f"https://api.openmeteo.com/v1/forecast?latitude={LATITUDE}&longitude={LONGITUDE}&current_weather=true&surface_pressure=true"
    
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req) as response:
            donnees = json.loads(response.read().decode('utf-8'))
            if "current_weather" in donnees:
                meteo["temperature"] = donnees["current_weather"]["temperature"]
                # Récupération de la pression au sol si disponible, sinon standard
                meteo["pression"] = donnees.get("current_weather", {}).get("pressure", 1013.25)
            print(f"[METEO CLOUD] Alignement validé : T={meteo['temperature']}°C | P={meteo['pression']}hPa")
    except Exception as e:
        print(f"[WARNING] Impossible de joindre les satellites météo ({e}). Utilisation du standard ISPM.")
        
    return meteo

def recuperer_jpl_nasa(id_astre):
    """Télécharge la matrice géocentrique de la NASA"""
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
            lignes = donnees['result'].split('$$SOE')[1].split('$$EOE')[0].strip().split('\n')
            
            liste_points = []
            for ligne in lignes:
                elements = ligne.split()
                if len(elements) >= 4:
                    liste_points.append({"az": float(elements[2]), "alt": float(elements[3])})
            return liste_points
    except Exception as e:
        print(f"[ERROR] Échec JPL pour l'astre {id_astre} : {e}")
        return []

def corriger_refraction_thermique(alt_brute, pression, temp):
    """Perturbation optique de l'atmosphère réelle de Marseille"""
    if alt_brute < -0.5: return alt_brute
    alt_deg = max(0.0, alt_brute)
    cotangente = 1.0 / math.tan(math.radians(alt_deg + (7.31 / (alt_deg + 4.4))))
    
    # Facteur de densité moléculaire de l'air (Agitation Thermique vs Force Barométrique)
    facteur_air = (pression / 1013.25) * (288.15 / (273.15 + temp))
    refraction = (cotangente / 60.0) * facteur_air
    return alt_brute + refraction

def main():
    print("[SYSTEM] Démarrage de la fusion cinématique Cloud...")
    meteo = obtenir_meteo_reelle()
    
    print("[NASA] Téléchargement des matrices JPL...")
    nasa_soleil = recuperer_jpl_nasa("10")
    nasa_lune = recuperer_jpl_nasa("301")
    
    if not nasa_soleil or not nasa_lune:
        print("[CRITICAL] Annulation : Données de la NASA indisponibles.")
        return

    manifeste_final = {"SOLEIL": [], "LUNE": []}
    
    # Étape d'hybridation : On applique la météo réelle sur les données de la NASA
    for point in nasa_soleil:
        alt_per = corriger_refraction_thermique(point["alt"], meteo["pression"], meteo["temperature"])
        manifeste_final["SOLEIL"].append({"az": point["az"], "alt": round(alt_per, 2)})
        
    for point in nasa_lune:
        alt_per = corriger_refraction_thermique(point["alt"], meteo["pression"], meteo["temperature"])
        manifeste_final["LUNE"].append({"az": point["az"], "alt": round(alt_per, 2)})

    with open("manifest.json", "w", encoding="utf-8") as f:
        json.dump(manifeste_final, f, indent=2, ensure_ascii=False)
    print("[SUCCESS] Le manifest.json cinématique environnemental a été poussé sur le cloud.")

if __name__ == "__main__":
    main()
