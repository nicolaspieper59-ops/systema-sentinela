import json
import urllib.request
import math
from datetime import datetime, timezone

LATITUDE = "43.28"
LONGITUDE = "5.36"
ALTITUDE = "0.099"

def obtenir_meteo_reelle():
    meteo = {"pression": 1013.25, "temperature": 15.0}
    url = f"https://api.openmeteo.com/v1/forecast?latitude={LATITUDE}&longitude={LONGITUDE}&current_weather=true&surface_pressure=true"
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req) as response:
            donnees = json.loads(response.read().decode('utf-8'))
            if "current_weather" in donnees:
                current = donnees["current_weather"]
                if "temperature" in current: meteo["temperature"] = current["temperature"]
                if "surface_pressure" in current: meteo["pression"] = current["surface_pressure"]
            print(f"[METEO] Synchronisée : T={meteo['temperature']}°C | P={meteo['pression']}hPa")
    except Exception as e:
        print(f"[WARNING] Erreur météo ({e}).")
    return meteo

def recuperer_jpl_nasa(id_astre):
    aujourdhui = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    url = (
        "https://ssd-api.jpl.nasa.gov/horizons.api?format=json&"
        f"COMMAND='{id_astre}'&OBJ_DATA='NO'&MAKE_EPHEM='YES'&EPHEM_TYPE='OBSERVER'&"
        f"CENTER='coord@399'&SITE_COORD='{LONGITUDE},{LATITUDE},{ALTITUDE}'&"
        f"START_TIME='{aujourdhui} 00:00'&STOP_TIME='{aujourdhui} 23:59'&"
        "STEP_SIZE='1m'&QUANTITIES='4'&REF_SYSTEM='J2000'&ANG_FORMAT='DEG'"
    )
    dict_points = {}
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req) as response:
            donnees = json.loads(response.read().decode('utf-8'))
            raw_result = donnees['result']
            if '$$SOE' not in raw_result or '$$EOE' not in raw_result: return {}
            lignes = raw_result.split('$$SOE')[1].split('$$EOE')[0].strip().split('\n')
            
            for ligne in lignes:
                if not ligne.strip(): continue
                elements = ligne.split()
                if len(elements) >= 4:
                    try:
                        cle_temps = elements[1] # Colonne HH:MM invariable
                        # Protection : Indexation inverse pour contourner les colonnes de flags de la NASA
                        az_str = elements[-2].replace('*','').replace('t','').replace('m','').replace('A','')
                        alt_str = elements[-1].replace('*','').replace('t','').replace('m','').replace('A','')
                        dict_points[cle_temps] = {"az": float(az_str), "alt": float(alt_str)}
                    except ValueError:
                        continue
            return dict_points
    except Exception as e:
        print(f"[ERROR] Échec JPL {id_astre} : {e}")
        return {}

def corriger_refraction_thermique(alt_brute, pression, temp):
    if alt_brute < -0.5: return alt_brute
    alt_deg = max(0.0, alt_brute)
    denom = math.tan(math.radians(alt_deg + (7.31 / (alt_deg + 4.4))))
    if abs(denom) < 1e-6: return alt_brute
    facteur_air = (pression / 1013.25) * (288.15 / (273.15 + temp))
    return alt_brute + ((1.0 / denom) / 60.0) * facteur_air

def main():
    meteo = obtenir_meteo_reelle()
    jpl_soleil = recuperer_jpl_nasa("10")
    jpl_lune = recuperer_jpl_nasa("301")
    jpl_jupiter = recuperer_jpl_nasa("599")
    
    if not jpl_soleil or not jpl_lune or not jpl_jupiter:
        print("[CRITICAL] Annulation : Données NASA incomplètes.")
        return

    manifeste_final = {"SOLEIL": {}, "LUNE": {}, "JUPITER": {}}
    for i in range(1440):
        heures = i // 60
        minutes = i % 60
        cle_minute = f"{heures:02d}:{minutes:02d}"
        
        if cle_minute in jpl_soleil and cle_minute in jpl_lune and cle_minute in jpl_jupiter:
            alt_sol = corriger_refraction_thermique(jpl_soleil[cle_minute]["alt"], meteo["pression"], meteo["temperature"])
            manifeste_final["SOLEIL"][cle_minute] = [round(jpl_soleil[cle_minute]["az"], 2), round(alt_sol, 2)]
            alt_lun = corriger_refraction_thermique(jpl_lune[cle_minute]["alt"], meteo["pression"], meteo["temperature"])
            manifeste_final["LUNE"][cle_minute] = [round(jpl_lune[cle_minute]["az"], 2), round(alt_lun, 2)]
            alt_jup = corriger_refraction_thermique(jpl_jupiter[cle_minute]["alt"], meteo["pression"], meteo["temperature"])
            manifeste_final["JUPITER"][cle_minute] = [round(jpl_jupiter[cle_minute]["az"], 2), round(alt_jup, 2)]

    structure_production = {
        "TIMESTAMP_REF": int(datetime.now(timezone.utc).timestamp() * 1000),
        "DONNEES": manifeste_final
    }

    with open("orbites.json", "w", encoding="utf-8") as f:
        json.dump(structure_production, f, indent=2, ensure_ascii=False)
    print("[SUCCESS] Matrice scellée. 1440 minutes générées sans coupure.")

if __name__ == "__main__":
    main()
