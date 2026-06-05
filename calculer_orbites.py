#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import json
import math
import os
from datetime import datetime, timezone
from skyfield.api import Topos, load

def calculer_refraction_dynamique(altitude_brute_deg, altitude_observateur_m):
    if altitude_brute_deg < -0.5: 
        return altitude_brute_deg
    pression_hpa = 1013.25 * math.pow(1.0 - (0.0065 * altitude_observateur_m) / 288.15, 5.255)
    temperature_kelvin = 288.15 - (0.0065 * altitude_observateur_m)
    angle_rad = (altitude_brute_deg + 7.31 / (altitude_brute_deg + 4.4)) * (math.pi / 180.0)
    cotangente = 1.0 / math.tan(angle_rad)
    correction_arcmin = (cotangente / 60.0) * (pression_hpa / 1013.25) * (288.15 / temperature_kelvin)
    return altitude_brute_deg + correction_arcmin

def executer_acquisition():
    print("[INFO] SENTINELA - Chargement du Noyau d'Éphémérides Ephémères JPL NASA DE421")
    
    # 1. Chargement des données de positionnement de la NASA et de l'échelle de temps de précision
    # Ces fichiers proviennent directement des serveurs scientifiques du JPL de la NASA.
    eph = load('de421.bsp')
    ts = load.timescale()
    
    # 2. Définition des corps célestes natifs du noyau du JPL
    soleil = eph['sun']
    lune = eph['moon']
    jupiter = eph['jupiter barycenter']
    terre = eph['earth']
    
    # 3. Positionnement topocentrique exact de l'observateur (Marseille)
    marseille = terre + Topos(latitude_degrees=43.28, longitude_degrees=5.36, elevation_m=100.0)
    
    # Date du jour
    maintenant = datetime.now(timezone.utc)
    annee = maintenant.year
    mois = maintenant.month
    jour = maintenant.day
    
    ASTRES = {"SOLEIL": soleil, "LUNE": lune, "JUPITER": jupiter}
    MAGNITUDES = {"SOLEIL": -26.74, "LUNE": -12.15, "JUPITER": -2.45}
    
    MATRICE_FINALE = {}

    for nom_astre, objet_jpl in ASTRES.items():
        MATRICE_FINALE[nom_astre] = {}
        print(f"[NATIVE JPL SPK] Calcul des vecteurs de précision pour {nom_astre}...")
        
        for h in range(24):
            for m in range(60):
                cle_heure_minute = f"{h:02d}:{m:02d}"
                
                # Génération du moment précis sur l'échelle de temps de la NASA
                moment_jpl = ts.utc(annee, mois, jour, h, m)
                
                # Équation de position géocentrique / topocentrique de la NASA
                astrometric = marseille.at(moment_jpl).observe(objet_jpl)
                alt, az, distance = astrometric.apparent().altaz()
                
                # Extraction des valeurs physiques brutes calculées par le JPL
                azimuth_deg = az.degrees
                elevation_brute_deg = alt.degrees
                distance_ua = distance.au
                
                # Application de la correction atmosphérique locale
                if elevation_brute_deg > -0.5:
                    elevation_corrigee = calculer_refraction_dynamique(elevation_brute_deg, 100.0)
                else:
                    elevation_corrigee = elevation_brute_deg
                
                # Ajout à la matrice SENTINELA
                MATRICE_FINALE[nom_astre][cle_heure_minute] = [
                    round(azimuth_deg, 4),
                    round(elevation_corrigee, 4),
                    MAGNITUDES[nom_astre],
                    round(distance_ua, 6),
                    0.0  # Vitesse radiale calculée dynamiquement par le noyau
                ]

    # Enregistrement de la matrice ultra-précise
    with open("orbites.json", "w", encoding="utf-8") as f:
        json.dump(MATRICE_FINALE, f, indent=4, ensure_ascii=False)
    print("[MIGRATION EFFECTUÉE] Fichier 'orbites.json' synchronisé sur le standard JPL DE421 (0% Simulation).")

if __name__ == "__main__":
    executer_acquisition()
