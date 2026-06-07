import csv
import math
from datetime import datetime, timezone
from skyfield.api import Topos, load

# Initialisation des éphémérides de la NASA
EPH = load('de421.bsp')
TS = load.timescale()

ASTRES = {"sun": EPH['sun'], "moon": EPH['moon'], "jupiter": EPH['jupiter barycenter']}

def generer_matrice_laboratoire():
    # Paramètres de vol initiaux
    timestamp_start = 1780754400  # Date fixe de référence en juin 2026
    lat_initiale = 43.2891
    lon_initiale = 5.3572
    alt_m = 9500.0
    vitesse_kms = 0.2775  # ~1000 km/h
    vitesse_deg_sec = 0.00356
    
    with open("matrice_jpl_brute.csv", mode="w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        # En-tête correspondant exactement au parseur JavaScript
        writer.writerow([
            "timestamp", "lat", "lon", "alt", "speed",
            "sol_az", "sol_el", "lun_az", "lun_el", "jup_az", "jup_el",
            "pression", "temp", "g_eff", "g_eotvos", "uv", "ir"
        ])
        
        # Génération de 1440 points (échantillonnage toutes les minutes)
        for i in range(1440):
            ts = timestamp_start + (i * 60)
            current_lat = lat_initiale
            current_lon = lon_initiale + (i * 60 * vitesse_deg_sec)
            
            # Calculs atmosphériques physiques standards
            pression = 1013.25 * math.pow(1.0 - (0.0065 * alt_m) / 288.15, 5.255)
            temp = 288.15 - (0.0065 * alt_m) - 273.15
            
            # Gravimétrie et effet Eötvös
            lat_rad = math.radians(current_lat)
            g_sol = 9.780327 * (1 + 0.0053024 * math.sin(lat_rad)**2)
            g_alt = g_sol * ((6371000.0 / (6371000.0 + alt_m)) ** 2)
            g_eotvos = (2.0 * 7.292115e-5 * (vitesse_kms * 1000.0) * math.cos(lat_rad))
            g_effective = g_alt - g_eotvos
            
            # Éphémérides de la NASA via Skyfield
            moment_utc = datetime.fromtimestamp(ts, tz=timezone.utc)
            t_skyfield = TS.from_datetime(moment_utc)
            pos_mobile = EPH['earth'] + Topos(latitude_degrees=current_lat, longitude_degrees=current_lon, elevation_m=alt_m)
            
            coords = {}
            for astre_name, astre_obj in ASTRES.items():
                obs = pos_mobile.at(t_skyfield).observe(astre_obj).apparent()
                alt, az, _ = obs.altaz()
                coords[f"{astre_name}_az"] = az.degrees
                coords[f"{astre_name}_el"] = alt.degrees

            # Modélisation simplifiée du rayonnement pour l'exportation
            cos_zenith = math.cos(math.radians(90.0 - coords["sun_el"])) if coords["sun_el"] > 0 else 0
            uv = max(0, 12.5 * cos_zenith)
            ir = max(0, 611.0 * cos_zenith)
            
            writer.writerow([
                ts, round(current_lat, 5), round(current_lon, 5), round(alt_m, 1), round(vitesse_kms * 3600, 1),
                round(coords["sun_az"], 4), round(coords["sun_el"], 4),
                round(coords["moon_az"], 4), round(coords["moon_el"], 4),
                round(coords["jupiter_az"], 4), round(coords["jupiter_el"], 4),
                round(pression, 1), round(temp, 2), round(g_effective, 4), round(g_eotvos, 4),
                round(uv, 2), round(ir, 1)
            ])

    print("[SUCCÈS] Matrice déterministe générée avec succès sous le nom 'matrice_jpl_brute.csv'.")

if __name__ == "__main__":
    generer_matrice_laboratoire()
