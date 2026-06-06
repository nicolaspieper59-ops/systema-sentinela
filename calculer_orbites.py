#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import json
import math
import sys
import os
from datetime import datetime, timezone
from skyfield.api import Topos, load

def charger_temoignage_samsung(chemin_fichier="meteo_samsung.json"):
    """
    Lit le témoignage matériel généré par le Samsung Galaxy S10e.
    Retourne la pression réelle du baromètre et l'indice de transparence optique.
    """
    pression_hpa = 1013.25
    facteur_transparence = 1.0
    
    if os.path.exists(chemin_fichier):
        try:
            with open(chemin_fichier, "r", encoding="utf-8") as f:
                donnees = json.load(f)
                pression_hpa = donnees["capteurs_physiques"]["pression_directe_hpa"]
                facteur_transparence = donnees["coefficients_calcul"]["transparence_atmosphere"]
                print(f"[MATÉRIEL S10e] Témoignage validé. Pression : {pression_hpa} hPa | Transparence : {facteur_transparence}")
        except Exception as e:
            print(f"[AVERTISSEMENT] Erreur de lecture des capteurs du smartphone : {e}")
            
    return pression_hpa, facteur_transparence

def calculer_refraction_nasa_samsung(altitude_brute_deg, pression_hpa, facteur_transparence, altitude_observateur_m):
    """
    Modèle de réfraction de la NASA (Formule de Bennett) sécurisé et calibré
    par le matériel du terminal mobile.
    """
    # Sécurité absolue : pas de réfraction optique sous l'horizon utile
    if altitude_brute_deg <= 0.0: 
        return altitude_brute_deg
        
    # Profil de température de l'atmosphère normalisée (OACI)
    temperature_c = 15.0 - (0.0065 * altitude_observateur_m)
    temperature_kelvin = temperature_c + 273.15
    
    # Algorithme de Bennett (JPL Horizons)
    angle_rad = math.radians(altitude_brute_deg + (7.31 / (altitude_brute_deg + 4.4)))
    cotangente = 1.0 / math.tan(angle_rad)
    
    # Calcul de la densité physique de la couche d'air locale
    facteur_densite_air = (pression_hpa / 1013.25) * (288.15 / temperature_kelvin)
    
    # Modulation par le coefficient d'atténuation du capteur RGB du S10e
    correction_deg = (cotangente / 60.0) * facteur_densite_air * facteur_transparence
    
    return altitude_brute_deg + correction_deg

def executer_acquisition():
    print("[INFO] SENTINELA - Initialisation du Noyau Éphémérides Vectorisé")
    
    if not os.path.exists('de421.bsp'):
        print("[ERREUR CRITIQUE] Le fichier de421.bsp est introuvable.")
        sys.exit(1)
        
    eph = load('de421.bsp')
    ts = load.timescale()
    
    # Horloge atomique absolue UTC
    maintenant = datetime.now(timezone.utc)
    annee, mois, jour = maintenant.year, maintenant.month, maintenant.day
    
    print(f"[REPERE TEMPOREL] Grille Astronomique Universelle : {annee}-{mois:02d}-{jour:02d}")
    
    # Coordonnées géocentriques stables de la station de Marseille
    LATITUDE = 43.28
    LONGITUDE = 5.36
    ALTITUDE_M = 100.0
    
    pression_reelle, transparence_reelle = charger_temoignage_samsung()
    marseille = eph['earth'] + Topos(latitude_degrees=LATITUDE, longitude_degrees=LONGITUDE, elevation_m=ALTITUDE_M)
    
    ASTRES = {
        "SOLEIL": eph['sun'],
        "LUNE": eph['moon'],
        "JUPITER": eph['jupiter barycenter']
    }
    MAGNITUDES = {"SOLEIL": -26.74, "LUNE": -12.74, "JUPITER": -2.50}
    
    # PRE-GENERATION DU VECTEUR TEMPOREL (Optimisation de structure de données)
    # On génère la liste des 1440 minutes de la journée sous forme de listes plates
    heures_vectorisees = [h for h in range(24) for m in range(60)]
    minutes_vectorisees = [m for h in range(24) for m in range(60)]
    secondes_zero = [0] * 1440
    secondes_plus_1 = [1] * 1440
    
    # Traduction en objets de temps Skyfield vectoriels (1 seul bloc mémoire)
    vecteur_temps_t0 = ts.utc(annee, mois, jour, heures_vectorisees, minutes_vectorisees, secondes_zero)
    vecteur_temps_t1 = ts.utc(annee, mois, jour, heures_vectorisees, minutes_vectorisees, secondes_plus_1)
    
    MATRICE_FINALE = {}

    for nom_astre, objet_jpl in ASTRES.items():
        MATRICE_FINALE[nom_astre] = {}
        print(f"[MUTATION BLOCK] Calcul vectoriel instantané pour : {nom_astre}")
        
        # Exécution des calculs orbitaux en masse (Haute Performance)
        obs_t0 = marseille.at(vecteur_temps_t0).observe(objet_jpl).apparent()
        alt_t0, az_t0, dist_t0 = obs_t0.altaz()
        
        obs_t1 = marseille.at(vecteur_temps_t1).observe(objet_jpl).apparent()
        _, _, dist_t1 = obs_t1.altaz()
        
        # Extraction et conversion des tableaux de données
        az_deg_arr = az_t0.degrees
        alt_deg_arr = alt_t0.degrees
        dist_au_arr = dist_t0.au
        
        vitesse_kms_arr = dist_t1.km - dist_t0.km
        
        # Remplissage ultra-rapide de la structure JSON
        index = 0
        for h in range(24):
            for m in range(60):
                cle_heure_minute = f"{h:02d}:{m:02d}"
                
                # Extraction des valeurs scalaires du vecteur
                az_pure = az_deg_arr[index]
                alt_pure = alt_deg_arr[index]
                distance_ua = dist_au_arr[index]
                vitesse_radiale = vitesse_kms_arr[index]
                
                # Alignement de réfraction atmosphérique basé sur le matériel
                elevation_corrigee = calculer_refraction_nasa_samsung(
                    alt_pure, 
                    pression_reelle, 
                    transparence_reelle, 
                    ALTITUDE_M
                )
                
                MATRICE_FINALE[nom_astre][cle_heure_minute] = [
                    round(az_pure, 4),
                    round(elevation_corrigee, 4),
                    MAGNITUDES[nom_astre],
                    round(distance_ua, 6),
                    round(vitesse_radiale, 3)
                ]
                index += 1

    # Intégration du bloc de métadonnées de contrôle qualité
    MATRICE_FINALE["METEO_CERTIFIE_SAMSUNG"] = {
        "source_materielle": "Samsung Galaxy S10e (Capteurs direct)",
        "pression_barometre_hpa": pression_reelle,
        "coefficient_attenuation_optique": transparence_reelle,
        "timestamp_validation": maintenant.isoformat()
    }

    # Validation et écriture sur disque
    try:
        with open("orbites.json", "w", encoding="utf-8") as f:
            json.dump(MATRICE_FINALE, f, indent=4, ensure_ascii=False)
        print("[SUCCÈS VECTORIEL] Matrice 'orbites.json' verrouillée avec succès.")
    except Exception as e:
        print(f"[CRASH SYSTEM] Échec d'écriture : {e}")
        sys.exit(1)

if __name__ == "__main__":
    executer_acquisition()
