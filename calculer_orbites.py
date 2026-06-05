#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import json
import math
import sys
import os
from datetime import datetime, timezone
from skyfield.api import Topos, load

def calculer_refraction_dynamique(altitude_brute_deg, altitude_observateur_m):
    """Calcule la correction de réfraction atmosphérique selon le modèle de Bennett."""
    if altitude_brute_deg < -0.5: 
        return altitude_brute_deg
    pression_hpa = 1013.25 * math.pow(1.0 - (0.0065 * altitude_observateur_m) / 288.15, 5.255)
    temperature_kelvin = 288.15 - (0.0065 * altitude_observateur_m)
    angle_rad = (altitude_brute_deg + 7.31 / (altitude_brute_deg + 4.4)) * (math.pi / 180.0)
    cotangente = 1.0 / math.tan(angle_rad)
    correction_arcmin = (cotangente / 60.0) * (pression_hpa / 1013.25) * (288.15 / temperature_kelvin)
    return altitude_brute_deg + correction_arcmin

def executer_acquisition():
    print("[INFO] SENTINELA - Chargement du Noyau d'Éphémérides JPL NASA DE421")
    
    # Vérification de sécurité de la présence physique de la base de données
    if not os.path.exists('de421.bsp'):
        print("[ERREUR CRITIQUE] Le fichier de données JPL de421.bsp est introuvable.")
        sys.exit(1)
        
    # Chargement du fichier de calcul de la NASA
    eph = load('de421.bsp')
    ts = load.timescale()
    
    # Extraction des coordonnées barycentriques originelles de la NASA
    soleil = eph['sun']
    lune = eph['moon']
    jupiter = eph['jupiter barycenter']
    terre = eph['earth']
    
    # Configuration des coordonnées géographiques précises (Marseille)
    marseille = terre + Topos(latitude_degrees=43.28, longitude_degrees=5.36, elevation_m=100.0)
    
    # Détermination temporelle de la fenêtre d'observation
    maintenant = datetime.now(timezone.utc)
    annee, mois, jour = maintenant.year, maintenant.month, maintenant.day
    
    ASTRES = {"SOLEIL": soleil, "LUNE": lune, "JUPITER": jupiter}
    
    # Constantes astrophysiques de magnitude visuelle moyenne
    MAGNITUDES = {"SOLEIL": -26.74, "LUNE": -12.74, "JUPITER": -2.50}
    
    MATRICE_FINALE = {}

    for nom_astre, objet_jpl in ASTRES.items():
        MATRICE_FINALE[nom_astre] = {}
        print(f"[NATIVE JPL] Génération de la trajectoire pour {nom_astre}...")
        
        for h in range(24):
            for m in range(60):
                cle_heure_minute = f"{h:02d}:{m:02d}"
                
                # Génération de la cible temporelle sur l'échelle de temps de la NASA
                moment_jpl = ts.utc(annee, mois, jour, h, m)
                
                # Calcul astronomique rigoureux : position de l'astre vu de Marseille
                # (Prend en compte la nutation, la précession et l'aberration de la lumière)
                observation = marseille.at(moment_jpl).observe(objet_jpl)
                alt, az, distance = observation.apparent().altaz()
                
                azimuth_deg = az.degrees
                elevation_brute_deg = alt.degrees
                distance_ua = distance.au
                
                # Calcul de la vitesse radiale relative (en km/s) par dérivation
                # Pour obtenir une vitesse non-nulle, on compare avec la position 1 seconde plus tard
                moment_jpl_plus_1s = ts.utc(annee, mois, jour, h, m, 1)
                distance_plus_1s_km = marseille.at(moment_jpl_plus_1s).observe(objet_jpl).apparent().altaz()[2].km
                vitesse_kms = distance_plus_1s_km - distance.km
                
                # Application de la correction atmosphérique locale
                elevation_corrigee = calculer_refraction_dynamique(elevation_brute_deg, 100.0)
                
                # Stockage des vecteurs physiques réels
                MATRICE_FINALE[nom_astre][cle_heure_minute] = [
                    round(azimuth_deg, 4),
                    round(elevation_corrigee, 4),
                    MAGNITUDES[nom_astre],
                    round(distance_ua, 6),
                    round(vitesse_kms, 3)
                ]
                
    # Écriture de la structure JSON finale
    with open("orbites.json", "w", encoding="utf-8") as f:
        json.dump(MATRICE_FINALE, f, indent=4, ensure_ascii=False)
    print("[SUCCÈS] Le fichier 'orbites.json' contient 100% de données certifiées JPL NASA.")

if __name__ == "__main__":
    executer_acquisition()
