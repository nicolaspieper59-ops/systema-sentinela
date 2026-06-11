#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Universal Dynamic Ephemeris & Multiphysics Integration Engine
Scalable for Terrestrial Vehicles, Aircraft, and Spacecraft.
Standard: IAU 2006/2000A, TAI Scale, Gladstone-Dale & Lorentz Transformations.
"""

import json
import os
import sys
import traceback
from datetime import datetime, timezone, timedelta
import numpy as np

try:
    import astropy.units as u
    from astropy.time import Time
    from astropy.coordinates import EarthLocation, AltAz, get_body, solar_system_ephemeris
    from astropy.utils.iers import conf as iers_conf
    # Sécurisation du runner (pas de requêtes IERS réseau bloquantes)
    iers_conf.auto_download = False 
    iers_conf.iers_degraded_accuracy = 'ignore'
except ImportError:
    print("[ERROR] La bibliothèque 'astropy' est requise. Installez-la via pip: pip install astropy", file=sys.stderr)
    sys.exit(1)

class VehiculeEnvironnement:
    """
    Simule l'acquisition en temps réel des données de bord du véhicule
    (Bus de données CAN, ARINC 429 ou Télémétrie Spatiale).
    """
    def __init__(self, type_vehicule="laboratoire"):
        self.type_vehicule = type_vehicule.lower()
        
    def acquerir_telemetrie_dynamique(self):
        if self.type_vehicule == "avion":
            return {
                "vitesse_m_s": 250.0,          # ~900 km/h
                "altitude_m": 10000.0,         # Altitude de croisière
                "latitude_deg": 43.29070,      # Position dynamique
                "longitude_deg": 5.35490,
                "milieu": "atmosphere",
                "pression_interieure_hPa": 800.0, # Pressurisation cabine
                "temperature_interieure_C": 22.0, # Régulation thermique
                "humidite_relative_pct": 5.0,    # Air très sec d'altitude
                "champ_electrostatique_V_m": 4500.0, # Friction aérodynamique
                "bruit_acoustique_dB": 78.0,     # Bruit de réacteur
                "attenuation_vitrage_db": -2.1   # Hublot acrylique
            }
        elif self.type_vehicule == "vaisseau_spatial":
            return {
                "vitesse_m_s": 7660.0,         # Vitesse orbitale ISS (7.66 km/s)
                "altitude_m": 420000.0,        # Orbite basse LEO
                "latitude_deg": 0.0,           # Équatorial
                "longitude_deg": 0.0,
                "milieu": "vide",              # Pas de réfraction atmosphérique externe
                "pression_interieure_hPa": 1013.25, # Atmosphère artificielle
                "temperature_interieure_C": 21.0,
                "humidite_relative_pct": 45.0,
                "champ_electrostatique_V_m": 150.0,
                "bruit_acoustique_dB": 60.0,
                "attenuation_vitrage_db": -0.8   # Quartz trempé haute pureté
            }
        else: # "laboratoire", "voiture", "train" au sol
            return {
                "vitesse_m_s": 0.0 if self.type_vehicule == "laboratoire" else 35.0, 
                "altitude_m": 55.0,
                "latitude_deg": 43.29070,
                "longitude_deg": 5.35490,
                "milieu": "atmosphere",
                "pression_interieure_hPa": 1013.25, 
                "temperature_interieure_C": 38.5,  # Surchauffé par effet de serre solaire
                "humidite_relative_pct": 40.0,
                "champ_electrostatique_V_m": 800.0,
                "bruit_acoustique_dB": 68.0,
                "attenuation_vitrage_db": -1.2
            }

def calculer_magnitude_lunaire_reelle(angle_phase_deg, r_helio_ua, delta_geo_ua):
    """ Loi photométrique empirique non-linéaire de la Lune (Effet d'opposition). """
    alpha = abs(angle_phase_deg)
    mag_standard = -12.74 + 0.026 * alpha + 4.0e-9 * (alpha**4)
    facteur_distance = 5 * np.log10((r_helio_ua * delta_geo_ua) / (1.0 * 0.00257))
    return float(mag_standard + facteur_distance)

def executer_pipeline_multiphysique(type_vehicule="laboratoire"):
    vehicule = VehiculeEnvironnement(type_vehicule)
    capteurs = vehicule.acquerir_telemetrie_dynamique()
    
    # Métrologie du Temps Atomique
    maintenant_utc = datetime.now(timezone.utc)
    t_utc = Time(maintenant_utc, scale='utc')
    
    t_tai = t_utc.tai
    t_tt = t_utc.tt
    jd_tai = t_tai.jd
    
    # Correction Relativiste de Lorentz
    c = 299792458.0 
    beta = capteurs["vitesse_m_s"] / c
    facteur_lorentz_gamma = 1.0 / np.sqrt(1.0 - beta**2)
    
    # Géodésie Dynamique (Coordonnées de l'instrument)
    loc_station = EarthLocation(
        lat=capteurs["latitude_deg"]*u.deg, 
        lon=capteurs["longitude_deg"]*u.deg, 
        height=capteurs["altitude_m"]*u.m
    )
    
    # Physique de la Réfraction Interne (Effet de serre + Acoustique)
    p_acoustique_pascal = 2e-5 * (10**(capteurs["bruit_acoustique_dB"]/20))
    p_totale_hpa = capteurs["pression_interieure_hPa"] + (p_acoustique_pascal / 100.0)
    
    t_interieure_k = capteurs["temperature_interieure_C"] + 273.15
    R_air_sec = 287.05
    rho_air_interieur = (p_totale_hpa * 100) / (R_air_sec * t_interieure_k)
    
    # Équation de Gladstone-Dale pour l'indice de réfraction du milieu intérieur
    constant_gladstone_dale = 0.226e-3 
    indice_n_interieur = 1.0 + (constant_gladstone_dale * rho_air_interieur)
    
    try:
        solar_system_ephemeris.set('de440')
    except Exception:
        solar_system_ephemeris.set('builtin')

    # Configuration des cadres d'observation optiques à l'instant t
    if capteurs["milieu"] == "vide":
        cadre_optique = AltAz(location=loc_station, obstime=t_utc)
    else:
        cadre_optique = AltAz(
            location=loc_station, obstime=t_utc, 
            pressure=p_totale_hpa*u.hPa, temperature=capteurs["temperature_interieure_C"]*u.deg_C, 
            relative_humidity=(capteurs["humidite_relative_pct"]/100.0), obswl=0.55*u.micron
        )
        
    cadre_vide = AltAz(location=loc_station, obstime=t_utc)

    # Positions barycentriques
    soleil_barycentrique = get_body("sun", t_utc, location=loc_station)
    xyz_soleil = soleil_barycentrique.icrs.cartesian.xyz.to(u.au).value

    CORPS_CELESTES = {"soleil": "sun", "lune": "moon"}
    ephemerides_output = {}

    for cle_fr, id_en in CORPS_CELESTES.items():
        corps = get_body(id_en, t_utc, location=loc_station)
        
        proj_optique = corps.transform_to(cadre_optique)
        proj_brut = corps.transform_to(cadre_vide)
        
        az_arr = float(proj_optique.az.deg)
        el_optique_arr = float(proj_optique.alt.deg)
        el_brut_arr = float(proj_brut.alt.deg)
        delta_r_arr = float(max(0.0, el_optique_arr - el_brut_arr))
        
        dist_ua_arr = float(proj_optique.distance.au)
        dist_km_arr = float(proj_optique.distance.km)

        if cle_fr == "soleil":
            angle_phase_arr = 0.0
            mag_arr = -26.74
        else:
            xyz_corps = corps.icrs.cartesian.xyz.to(u.au).value
            vec_corps_soleil = xyz_soleil - xyz_corps
            r_helio_arr = float(np.linalg.norm(vec_corps_soleil))
            
            dot_product = float(-xyz_corps[0]*vec_corps_soleil[0] - xyz_corps[1]*vec_corps_soleil[1] - xyz_corps[2]*vec_corps_soleil[2])
            denominateur = dist_ua_arr * r_helio_arr
            if denominateur == 0: denominateur = 1e-12
            
            cos_phase = np.clip(dot_product / denominateur, -1.0, 1.0)
            angle_phase_arr = float(np.degrees(np.arccos(cos_phase)))
            mag_arr = calculer_magnitude_lunaire_reelle(angle_phase_arr, r_helio_arr, dist_ua_arr)

        ephemerides_output[cle_fr] = {
            "azimut_vrai_deg": az_arr,
            "elevation_geometrique_deg": el_brut_arr,
            "elevation_refractee_corrigee_deg": el_optique_arr,
            "delta_refraction_deg": delta_r_arr,
            "distance_km": dist_km_arr,
            "magnitude_visuelle_reelle": round(mag_arr, 2),
            "angle_phase_deg": angle_phase_arr
        }

    flux_structure = {
        "METADATA": {
            "generateur": "Astropy Dynamic Vehicle Multiphysics Engine",
            "type_plateforme": capteurs["milieu"].upper() if type_vehicule == "vaisseau_spatial" else type_vehicule.upper()
        },
        "METROLOGIE_TEMPS_ATOMIQUE": {
            "ISO_UTC": maintenant_utc.strftime("%Y-%m-%d %H:%M:%S"),
            "JD_TAI": float(jd_tai),
            "TT_Echelle_s": float(t_tt.jd * 86400.0),
            "Dilatation_Lorentz_Gamma": float(facteur_lorentz_gamma)
        },
        "POSITION_GEOFENCING_MOBILE": {
            "latitude_deg": float(capteurs["latitude_deg"]),
            "longitude_deg": float(capteurs["longitude_deg"]),
            "altitude_coordonnee_m": float(capteurs["altitude_m"]),
            "ecef_x_m": float(loc_station.x.value),
            "ecef_y_m": float(loc_station.y.value),
            "ecef_z_m": float(loc_station.z.value)
        },
        "THERMODYNAMIQUE_HABITACLE_SERRE": {
            "pression_effective_hPa": float(p_totale_hpa),
            "temperature_air_interieur_C": float(capteurs["temperature_interieure_C"]),
            "densite_air_locale_kg_m3": float(rho_air_interieur),
            "indice_refraction_n_gladstone": float(indice_n_interieur)
        },
        "COUPLAGES_ELECTROMAGNETIQUES_STATIQUES": {
            "champ_electrostatique_surface_V_m": float(capteurs["champ_electrostatique_V_m"]),
            "attenuation_vitrage_spectrale_dB": float(capteurs["attenuation_vitrage_db"]),
            "bruit_acoustique_pression_Pa": float(p_acoustique_pascal)
        },
        "DATA_STREAMS": ephemerides_output
    }

    print(json.dumps(flux_structure, indent=4, ensure_ascii=False))

if __name__ == "__main__":
    choix_plateforme = sys.argv[1] if len(sys.argv) > 1 else "avion"
    try:
        executer_pipeline_multiphysique(choix_plateforme)
    except Exception as e:
        print(f"[CRITICAL] Effondrement du pipeline multiphysique : {e}", file=sys.stderr)
        traceback.print_exc()
        sys.exit(1)
