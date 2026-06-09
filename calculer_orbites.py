import json
import math
from datetime import datetime, timezone

def calculer_jour_julien(dt):
    # Calcul rigoureux du Jour Julien pour l'affichage de référence
    year, month, day = dt.year, dt.month, dt.day
    hour, minute, second = dt.hour, dt.minute, dt.second
    
    if month <= 2:
        year -= 1
        month += 12
        
    A = math.floor(year / 100)
    B = 2 - A + math.floor(A / 4)
    
    j_fraction = (hour + (minute / 60.0) + (second / 3600.0)) / 24.0
    jd = math.floor(365.25 * (year + 4716)) + math.floor(30.6001 * (month + 1)) + day + j_fraction + B - 1524.5
    return jd

def generer_flux_production():
    maintenant = datetime.now(timezone.utc)
    
    # Calcul de l'index minute de la journée de référence (0 à 1439)
    index_1440 = (maintenant.hour * 60) + maintenant.minute
    
    # Simulation des listes de 1440 points (à lier à votre AstronomicalCore.cpp / CSV)
    # Remplacer les boucles d'exemple ci-dessous par l'extraction réelle de vos structures
    def generer_noeud_astre_exemple(base_az, base_el):
        return [{
            "azimut_brut": base_az + (i * 0.1) % 360,
            "elevation_brute": base_el + math.sin(i * 0.004) * 45,
            "elevation_refractee": base_el + math.sin(i * 0.004) * 45 + 0.02,
            "correction_refraction": 0.02,
            "distance_ua": 1.0 + (i * 0.001),
            "distance_km": 149597870.7 * (1.0 + (i * 0.001)),
            "magnitude": -26.7 if base_az == 100 else 1.5,
            "ascension_droite": f"{int((i/60)%24)}h {int(i%60)}m 00s",
            "declination": math.sin(i * 0.002) * 23.44,
            "constellation": "Gemini",
            "lever_lmt": "06:12:45",
            "culmination_lmt": "13:22:10",
            "coucher_lmt": "21:34:02"
        } for i in range(1440)]

    payload = {
        "HORLOGE": {
            "utc": maintenant.strftime("%H:%M:%S"),
            "lmt": maintenant.strftime("%H:%M:%S"),  # À corriger selon le fuseau de la station
            "jd": calculer_jour_julien(maintenant),
            "lst": maintenant.strftime("%H:%M:%S"),  # À lier à votre fonction Temps Sidéral Local
            "index_1440": index_1440
        },
        "GEODATA": {
            "latitude": 43.2907,
            "longitude": 5.3549,
            "altitude": 55.0
        },
        "METEO_TERRESTRE": {
            "pression_station_hpa": 1014.2,
            "temperature_virtuelle_c": 22.4,
            "densite_air_kgm3": 1.204
        },
        "EPHEMERIDES_JPL_1440": {
            "SUN": generer_noeud_astre_exemple(100, 20),
            "MOON": generer_noeud_astre_exemple(120, -10),
            "MERCURY": generer_noeud_astre_exemple(90, 5),
            "VENUS": generer_noeud_astre_exemple(80, 15),
            "MARS": generer_noeud_astre_exemple(150, 40),
            "JUPITER": generer_noeud_astre_exemple(210, 35),
            "SATURN": generer_noeud_astre_exemple(240, -5)
        }
    }

    with open("flux_live.json", "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

if __name__ == "__main__":
    generer_flux_production()
