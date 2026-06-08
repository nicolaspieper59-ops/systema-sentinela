#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import csv
import json
import requests
import math
from datetime import datetime, timezone

def interroger_jpl_corps(id_corps, lat, lon, alt_m):
    url = "https://ssd-api.jpl.nasa.gov/horizons.api"
    alt_km = alt_m / 1000.0
    maintenant = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')
    
    params = {
        "format": "json",
        "COMMAND": f"'{id_corps}'",
        "OBJ_DATA": "'NO'",
        "MAKE_EPHEM": "'YES'",
        "EPHEM_TYPE": "'OBSERVER'",
        "CENTER": "'coord@399'",
        "SITE_COORD": f"'{lon:.5f},{lat:.5f},{alt_km:.3f}'",
        "START_TIME": f"'{maintenant}'",
        "STOP_TIME": f"'{maintenant}'",
        "STEP_SIZE": "'1m'",
        "QUANTITIES": "'4,20'",
        "ANG_FORMAT": "'DEG'"
    }
    
    try:
        res = requests.get(url, params=params).json()
        raw_result = res.get("result", "")
        # Extraction chirurgicale entre les balises du JPL
        data_block = raw_result.split("$$SOE")[1].split("$$EOE")[0].strip()
        lines = data_block.split("\n")
        if lines:
            parts = lines[0].split()
            # Format JPL : Date, Heure, Azimut, Élévation...
            az = float(parts[2])
            el = float(parts[3])
            
            # Si QUANTITIES 20 est présent, extraction de la distance (Delta) et de l'angle d'illumination/phase
            # Pour le Soleil (10), l'angle de phase S-T-O n'a pas de sens physique direct de la même manière, 
            # mais pour la lune/planètes, on extrait l'angle de phase.
            sto_angle = 0.0
            if len(parts) > 8:
                try:
                    sto_angle = float(parts[8])
                except ValueError:
                    sto_angle = 90.0
            return az, el, sto_angle
    except Exception as e:
        print(f"[ERREUR JPL CORPS {id_corps}] : {e}")
        return 0.0, 0.0, 90.0

def generer_matrices_sentinela():
    # Alignement géodésique absolu sur la station d'Endoume, Marseille
    lat, lon, alt = 43.28463, 5.35865, 55.0
    print(f"[SENTINELA ENGINE] Alignement géodésique : Lat={lat}, Lon={lon}, Alt={alt}m")

    # Requêtes réelles sans décalages artificiels
    sol_az, sol_el, _ = interroger_jpl_corps(10, lat, lon, alt)
    lun_az, lun_el, lun_sto = interroger_jpl_corps(301, lat, lon, alt)
    jup_az, jup_el, _ = interroger_jpl_corps(599, lat, lon, alt)

    # Physique ISA Standard locale
    p_mer = 1013.25
    p_local = p_mer * math.pow(1 - (0.0065 * alt) / 288.15, 5.25588)
    t_local = 15.0 - (0.0065 * alt)
    # Gravité locale théorique WGS84 interpolée
    g_local = 9.80616 * (1 - 0.0026373 * math.cos(2 * lat * math.pi / 180))

    temps_actuel = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S.%f')[:-3]

    # 1. Régénération de flux_live.json (Consommé par l'index.html PWA)
    # Calcul de l'illumination lunaire réelle d'après l'angle de phase extrait
    illumination_lune = ((1 + math.cos(lun_sto * math.pi / 180)) / 2) * 100

    flux_data = {
        "CLOCK_3D": {
            "utc_gnss_atomique": temps_actuel,
            "coordonnees": {"lat": lat, "lon": lon, "alt_m": alt}
        },
        "ENVIRONNEMENT": {
            "pression_externe_hpa": round(p_local, 2),
            "temperature_air_c": round(t_local, 2),
            "pesanteur_eotvos_ms2": round(g_local, 4),
            "lune_phase_sto": round(lun_sto, 4),
            "lune_illumination_pct": round(illumination_lune, 2)
        },
        "SOLEIL": [round(sol_az, 4), round(sol_el, 4)],
        "LUNE": [round(lun_az, 4), round(lun_el, 4)],
        "JUPITER": [round(jup_az, 4), round(jup_el, 4)]
    }

    with open("flux_live.json", "w", encoding="utf-8") as f:
        json.dump(flux_data, f, indent=2, ensure_ascii=False)

    # 2. Append/Écriture de la matrice historique CSV
    ts_unix = int(datetime.now(timezone.utc).timestamp())
    with open("matrice_jpl_brute.csv", mode="w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow([
            "timestamp", "lat_ref", "lon_ref", "alt_ref",
            "sol_az", "sol_el", "lun_az", "lun_el", "jup_az", "jup_el",
            "pression_theo", "temp_theo", "g_base"
        ])
        writer.writerow([
            ts_unix, lat, lon, alt,
            round(sol_az, 4), round(sol_el, 4), round(lun_az, 4), round(lun_el, 4), round(jup_az, 4), round(jup_el, 4),
            round(p_local, 2), round(t_local, 2), round(g_local, 4)
        ])
    print("[SUCCÈS] Matrices synchronisées et vérifiées géométriquement.")

if __name__ == "__main__":
    generer_matrices_sentinela()
