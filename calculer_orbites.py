import json
from datetime import datetime

# ... Vos calculs extraits de matrice_jpl_brute.csv et AstronomicalCore ...
# Chaque liste (soleil_1440, lune_1440, etc.) doit contenir exactement 1440 entrées.

payload = {
    "METADONNEES": {
        "timestamp_utc": datetime.utcnow().isoformat() + "Z",
        "latitude": 43.2907,
        "longitude": 5.3549,
        "altitude_m": 55.0,
        "points_par_jour": 1440
    },
    "METEO_TERRESTRE": {
        "pression_mer_hpa": 1014.25,  # À lier à votre flux Meteoblue/OWM si dynamique
        "temperature_c": 22.4,
        "humidite_pct": 61.0,
        "vent_vrai_vitesse_kmh": 22.2,
        "vent_vrai_direction_deg": 290.0
    },
    "DYNAMIQUE_VEHICULE": {
        "vitesse_gps_kmh": 0.0,
        "cap_magnetique_brut_deg": 0.0
    },
    "METEO_SPATIALE": {
        "indice_kp": 2.3,
        "vent_solaire_kms": 415.0,
        "declinaison_wmm_deg": 1.63
    },
    "EPHEMERIDES_JPL_1440": {
        "SOLEIL": soleil_1440,    # Liste de 1440 dicts : [{"az": x, "el": y, "dist_ua": z}, ...]
        "LUNE": lune_1440,        # Liste de 1440 dicts : [{"az": x, "el": y, "phase_pct": p}, ...]
        "MERCURE": mercure_1440,  # Liste de 1440 dicts : [{"az": x, "el": y}, ...]
        "VENUS": venus_1440,
        "MARS": mars_1440,
        "JUPITER": jupiter_1440,
        "SATURNE": saturne_1440
    }
}

# Écriture locale sur le runner GitHub avant le Push automatique
with open("flux_live.json", "w", encoding="utf-8") as f:
    json.dump(payload, f, ensure_ascii=False, indent=2)
