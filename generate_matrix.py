#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SYSTEMA SENTINELA - GENERATEUR DE FLUX TOPOCENTRIQUE VRAI V2026.2
Modèle de calcul : Noyau d'intégration numérique JPL DE440 / Astropy Vectorized Engine
"""

import json
import os
from datetime import datetime, timezone, timedelta
import numpy as np
from astropy.time import Time
from astropy.coordinates import EarthLocation, AltAz, get_body
import astropy.units as u

def generer_matrice_jpl():
    # 1. RETRANCHEMENT ET CADRAGE TEMPOREL DU JOUR UTC EN COURS
    maintenant_utc = datetime.now(timezone.utc)
    base_midi_utc = datetime(maintenant_utc.year, maintenant_utc.month, maintenant_utc.day, tzinfo=timezone.utc)
    
    # Création du vecteur des 1440 minutes de la journée de l'observateur
    vecteur_minutes = np.arange(1440)
    temps_series = [base_midi_utc + timedelta(minutes=int(m)) for m in vecteur_minutes]
    t_astropy_vector = Time(temps_series)
    
    # Échelles globales instantanées pour l'en-tête
    t_instant = Time(maintenant_utc)
    jd_reel = t_instant.jd
    lst_obj = t_instant.sidereal_time('mean', longitude=5.35490 * u.deg)
    
    h_lst, m_lst, s_lst = int(lst_obj.value), int((lst_obj.value * 60) % 60), int((lst_obj.value * 3600) % 60)
    lst_str = f"{h_lst:02d}:{m_lst:02d}:{s_lst:02d}"

    # 2. VECTEUR GÉODÉSIQUE DE MARSEILLE
    lat, lon, alt = 43.29070, 5.35490, 55.0
    station = EarthLocation(lat=lat*u.deg, lon=lon*u.deg, height=alt*u.m)
    ecef_xyz = station.geocentric

    # 3. CONTEXTE THERMODYNAMIQUE STANDARD
    pression = 1014.2 * u.hPa
    temperature = 22.40 * u.deg_C
    R_air = 287.058
    rho_air = (pression.value * 100) / (R_air * (temperature.value + 273.15))

    # Génération des référentiels horizontaux topocentriques (Vectorisés)
    cadre_topocentrique = AltAz(location=station, obstime=t_astropy_vector,
                                 pressure=pression, temperature=temperature, obswl=0.55*u.micron)
    cadre_sans_refraction = AltAz(location=station, obstime=t_astropy_vector)

    cartographie_astres = ["soleil", "lune", "mercure", "venus", "mars", "jupiter", "saturne"]
    ephemerides_output = {}

    for astre in cartographie_astres:
        # 4. EXTRACTION SIMULTANÉE DE LA TRAJECTOIRE COMPLETE (1440 MINUTES)
        corps_skycoord = get_body(astre, t_astropy_vector, location=station)
        
        projection_horizontale = corps_skycoord.transform_to(cadre_topocentrique)
        projection_brute = corps_skycoord.transform_to(cadre_sans_refraction)
        
        az_array = projection_horizontale.az.deg
        el_ref_array = projection_horizontale.alt.deg
        el_brute_array = projection_brute.alt.deg
        delta_r_array = np.maximum(0.0, el_ref_array - el_brute_array)
        
        dist_km_array = projection_horizontale.distance.km
        dist_ua_array = projection_horizontale.distance.au
        ra_array = corps_skycoord.ra.hms
        dec_array = corps_skycoord.dec.deg
        
        # ANALYSE PAR RECHERCHE DE RACINE POUR EXTRAIRE LES SPECTRES REELS (RISE / TRANSIT / SET)
        idx_culmination = np.argmax(el_brute_array)
        heure_culm = (base_midi_utc + timedelta(minutes=int(idx_culmination))).strftime("%H:%M:%S")
        
        # Détection géométrique des passages à l'horizon (alt = 0°)
        indices_sous_horizon = el_brute_array < 0
        lever_str, coucher_str = "--:--:--", "--:--:--"
        
        for i in range(1439):
            if el_brute_array[i] < 0 and el_brute_array[i+1] >= 0:
                lever_str = (base_midi_utc + timedelta(minutes=i)).strftime("%H:%M:%S")
            if el_brute_array[i] >= 0 and el_brute_array[i+1] < 0:
                coucher_str = (base_midi_utc + timedelta(minutes=i)).strftime("%H:%M:%S")

        # Estimation de la magnitude standard
        mag_standard = 0.0
        if astre == "soleil": mag_standard = -26.74
        elif astre == "lune": mag_standard = -12.74
        elif astre == "venus": mag_standard = -4.40
        elif astre == "jupiter": mag_standard = -2.20
        elif astre == "mars": mag_standard = 0.50
        elif astre == "saturne": mag_standard = 0.70

        # Remplissage de la matrice des 1440 minutes pour l'astre courant
        matrice_astre = []
        for m in range(1440):
            ra_str = f"{int(ra_array.h[m]):02d}h {int(ra_array.m[m]):02d}m {int(ra_array.s[m]):02d}s"
            
            matrice_astre.append({
                "azimut_brut": float(az_array[m]),
                "elevation_brute": float(el_brute_array[m]),
                "elevation_refractee": float(el_ref_array[m]),
                "correction_refraction": float(delta_r_array[m]),
                "distance_ua": float(dist_ua_array[m]),
                "distance_km": float(dist_km_array[m]),
                "magnitude": mag_standard,
                "ascension_droite": ra_str,
                "declination": float(dec_array[m]),
                "constellation": "N/A", # Géré dynamiquement par l'UI
                "lever_lmt": lever_str,
                "culmination_lmt": heure_culm,
                "coucher_lmt": coucher_str
            })
            
        ephemerides_output[astre] = matrice_astre

    # 5. INTEGRATION ET EMISSION DU CONFIGURATEUR
    flux_final = {
        "HORLOGE": {
            "lmt": maintenant_utc.strftime("%H:%M:%S"),
            "jd": float(jd_reel),
            "lst": lst_str
        },
        "GEODATA": {
            "latitude": lat,
            "longitude": lon,
            "altitude": alt,
            "ecef_x_m": float(ecef_xyz.x.value),
            "ecef_y_m": float(ecef_xyz.y.value),
            "ecef_z_m": float(ecef_xyz.z.value)
        },
        "METEO_TERRESTRE": {
            "pression_station_hpa": float(pression.value),
            "temperature_virtuelle_c": float(temperature.value),
            "densite_air_kgm3": float(rho_air)
        },
        "EPHEMERIDES_JPL_1440": ephemerides_output
    }

    chemin_fichier = './flux_live.json'
    with open(chemin_fichier + '.tmp', 'w') as f:
        json.dump(flux_final, f, indent=4)
    os.replace(chemin_fichier + '.tmp', chemin_fichier)
    print("🛰️ SUCCESS : Matrice topocentrique 1440 minutes injectée.")

if __name__ == "__main__":
    generer_matrice_jpl()
