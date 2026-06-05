import requests

url = "https://ssd-api.jpl.nasa.gov/horizons.api"
params = {
    "format": "json",
    "COMMAND": "10",
    "OBJ_DATA": "NO",
    "MAKE_EPHEM": "YES",
    "EPHEM_TYPE": "OBSERVER",
    "CENTER": "coord@399",
    "SITE_COORD": "5.36,43.28,0.100",
    "START_TIME": "'2026-06-05 00:00'",
    "STOP_TIME": "'2026-06-05 00:05'",
    "STEP_SIZE": "1m",
    "QUANTITIES": "4,9,20",
    "REF_SYSTEM": "J2000",
    "ANG_FORMAT": "DEG"
}

res = requests.get(url, params=params)
print("STATUS CODE:", res.status_code)
data = res.json()
print("RESULTAT BRUT NASA :", data.get("result", "")[:1000]) # Affiche les 1000 premiers caractères
