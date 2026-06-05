#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import requests
import json
import re
import math
from datetime import datetime, timezone

# --- NOYAU DE CALCUL PHYSIQUE (TRADUIT DE ASTRONOMICALCORE.CPP) ---
def calculer_refraction_dynamique(altitude_brute_deg, altitude_observateur_m):
    if altitude_brute_deg < -0.5: 
        return altitude_brute_deg # L'astre est trop bas sous l'horizon
    
    # Équation de nivellement barométrique ISA
    pression_hpa = 1013.25 * math.pow(1.0 - (0.0065 * altitude_observateur_m) / 288.15, 5.255)
    temperature_kelvin = 288.15 - (0.0065 * altitude_observateur_m)

    # Formule empirique de Bennett pour la cotangente
    angle_rad = (altitude_brute_deg + 7.31 / (altitude_brute_deg + 4.4)) * (math.pi / 180.0)
    cotangente = 1.0 / math.tan(angle_rad)
    correction_arcmin = (cotangente / 60.0) * (pression_hpa / 1013.25) * (288.15 / temperature_kelvin)

    return altitude_brute_deg + correction_arcmin

def appliquer_parallaxe_lune(altitude_apparente_deg, altitude_observateur_m):
    RAYON_TERRE_KM = 6378.137
    DISTANCE_LUNE_KM = 384400.0
    
    rayon_local = RAYON_TERRE_KM + (altitude_observateur_m / 1000.0)
    pi_parallaxe = math.asin(RAYON_TERRE_KM / DISTANCE_LUNE_KM)
    
    altitude_rad = altitude_apparente_deg * math.pi / 180.0
    correction_parallaxe = pi_parallaxe * math.cos(altitude_rad) * (rayon_local / RAYON_TERRE_KM)
    
    return altitude_apparente_deg - (correction_parallaxe * 180.0 / math.pi)


# --- COLLECTEUR ET PARSEUR PRINCIPAL ---
def executer_acquisition():
    aujourdhui = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    print(f"[INFO] Initialisation de la matrice SENTINELA pour la date : {aujourdhui}")
    
    # Coordonnées géodésiques de Marseille
    LONGITUDE = 5.36
    LATITUDE = 43.28
    ALTITUDE_KM = 0.100  # 100 mètres d'altitude
    ALTITUDE_METRES = ALTITUDE_KM * 1000.0
    
    SITE_GEODETIQUE = f"{LONGITUDE},{LATITUDE},{ALTITUDE_KM}"
    ASTRES = { "SOLEIL": "10", "LUNE": "301", "JUPITER": "599" }
    MATRICE_FINALE = {}

    regex_ligne_temps = re.compile(r"^\s*(\d{4}-[A-Za-z]{3}-\s*\d+)\s+(\d{2}:\d{2})")
    regex_valeurs_physiques = re.compile(r"(?i)n\.a\.|[-+]?\d+\.\d+(?:[eE][-+]?\d+)?|[-+]?\d+")

    for nom_astre, id_nasa in ASTRES.items():
        MATRICE_FINALE[nom_astre] = {}
        url = "https://ssd-api.jpl.nasa.gov/horizons.api"
        
        params = {
            "format": "json",
            "COMMAND": f"'{id_nasa}'",
            "OBJ_DATA": "'NO'",
            "MAKE_EPHEM": "'YES'",
            "EPHEM_TYPE": "'OBSERVER'",
            "CENTER": "'coord@399'",
            "SITE_COORD": f"'{SITE_GEODETIQUE}'",
            "START_TIME": f"'{aujourdhui} 00:00'",
            "STOP_TIME": f"'{aujourdhui} 23:59'",
            "STEP_SIZE": "'1m'",
            "QUANTITIES": "'4,9,20'",
            "REF_SYSTEM": "'J2000'",
            "ANG_FORMAT": "'DEG'"
        }
        
        try:
            response = requests.get(url, params=params, timeout=20)
            data_json = response.json()
            texte_brut = data_json.get("result", "")
            
            if "$$SOE" in texte_brut and "$$EOE" in texte_brut:
                bloc_donnees = texte_brut.split("$$SOE")[1].split("$$EOE")[0]
                lignes = bloc_donnees.strip().split("\n")
                
                for ligne in lignes:
                    match_temps = regex_ligne_temps.match(ligne)
                    if not match_temps:
                        continue
                    
                    cle_heure_minute = match_temps.group(2)
                    reste = ligne[match_temps.end():]
                    reste_nettoye = re.sub(r'\s+[a-zA-Z\*]\s+', ' ', reste)
                    tokens_physiques = regex_valeurs_physiques.findall(reste_nettoye)
                    
                    numeriques = []
                    for val in tokens_physiques:
                        if val.lower() == 'n.a.':
                            numeriques.append(0.0)
                        else:
                            try:
                                numeriques.append(float(val))
                            except ValueError:
                                continue

                    if len(numeriques) >= 2:
                        azimuth = numeriques[0]
                        elevation_brute = numeriques[1]
                        mag = numeriques[2] if len(numeriques) >= 3 else 0.0
                        dist_terre_ua = numeriques[3] if len(numeriques) >= 4 else 1.0
                        vitesse_relative = numeriques[4] if len(numeriques) >= 5 else 0.0
                        
                        # --- APPLICATION DES CORRECTIONS PHYSIQUES RECHERCHÉES ---
                        # 1. Réfraction atmosphérique dynamique pour tous les astres
                        elevation_corrigee = calculer_refraction_dynamique(elevation_brute, ALTITUDE_METRES)
                        
                        # 2. Correction de la parallaxe topocentrique spécifique à la Lune
                        if nom_astre == "LUNE":
                            elevation_corrigee = appliquer_parallaxe_lune(elevation_corrigee, ALTITUDE_METRES)
                            if dist_terre_ua > 1:
                                dist_terre_ua = dist_terre_ua / 149597870.7

                        MATRICE_FINALE[nom_astre][cle_heure_minute] = [
                            azimuth, elevation_corrigee, mag, dist_terre_ua, vitesse_relative
                        ]
            else:
                print(f"[ATTENTION] Éphémérides indisponibles pour {nom_astre}.")

        except Exception as e:
            print(f"[ERREUR] Échec réseau pour {nom_astre} : {e}")

    with open("orbites.json", "w", encoding="utf-8") as f:
        json.dump(MATRICE_FINALE, f, indent=4, ensure_ascii=False)
    print(f"[SUCCÈS] Matrice SENTINELA synchronisée (Physique Topocentrique Active) pour {aujourdhui}")

if __name__ == "__main__":
    executer_acquisition()
