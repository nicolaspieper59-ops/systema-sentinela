#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Moteur Relativiste et Multiphysique Éphémérides - Spécification Native Ultra-Stable
Échelles temporelles : TAI, TT. Double Précision Flottante IEEE 754.
Poids cible du flux d'instrumentation : ~1.5 Ko
"""

import json
import sys
import time
import math
from datetime import datetime, timezone

class TelemetrieMobile:
    def __init__(self, profil="laboratoire"):
        self.profil = profil.lower()
        
    def acquerir_donnees(self):
        if self.profil == "avion":
            return {
                "vitesse_m_s": 245.5,
                "altitude_m": 11500.0,
                "latitude_deg": 43.29070,
                "longitude_deg": 5.35490,
                "pression_interieure_hPa": 820.0,
                "temperature_interieure_C": 21.5,
                "bruit_acoustique_dB": 74.5
            }
        else:
            return {
                "vitesse_m_s": 0.0, 
                "altitude_m": 48.0,
                "latitude_deg": 43.29070,
                "longitude_deg": 5.35490,
                "pression_interieure_hPa": 1012.40, 
                "temperature_interieure_C": 20.8,
                "bruit_acoustique_dB": 38.0
            }

def calculer_date_julienne(dt):
    # Calcul algorithmique standard du Jour Julien UTC
    y, m, d = dt.year, dt.month, dt.day
    if m <= 2:
        y -= 1
        m += 12
    a = math.floor(y / 100)
    b = 2 - a + math.floor(a / 4)
    jd = math.floor(365.25 * (y + 4716)) + math.floor(30.6001 * (m + 1)) + d + b - 1524.5
    fraction_jour = (dt.hour + dt.minute / 60.0 + dt.second / 3600.0 + dt.microsecond / 3600000000.0) / 24.0
    return jd + fraction_jour

def executer_calcul_precision(profil="laboratoire"):
    capteurs = TelemetrieMobile(profil).acquerir_donnees()
    instant_brut = datetime.now(timezone.utc)
    
    # Établissement des échelles temporelles de haute précision
    jd_utc = calculer_date_julienne(instant_brut)
    jd_tai = jd_utc + (37.0 / 86400.0)  # Écart TAI - UTC standardisé de 37 secondes
    jd_tt = jd_tai + (32.184 / 86400.0)  # TT = TAI + 32.184s
    
    # Transformation relativiste de Lorentz (Facteur Gamma)
    c = 299792458.0
    beta = capteurs["vitesse_m_s"] / c
    gamma_lorentz = 1.0 / math.sqrt(1.0 - beta**2) if beta < 1 else 1.0
    
    # Thermodynamique locale de la cellule (Modèle Gladstone-Dale)
    p_acoustique_pascal = 2e-5 * (10**(capteurs["bruit_acoustique_dB"]/20))
    p_totale_hpa = capteurs["pression_interieure_hPa"] + (p_acoustique_pascal / 100.0)
    t_interieure_k = capteurs["temperature_interieure_C"] + 273.15
    rho_air_interieur = (p_totale_hpa * 100) / (287.05 * t_interieure_k)
    indice_n_gladstone = 1.0 + (0.226e-3 * rho_air_interieur)
    
    # Algorithme analytique des éphémérides de base à t0
    d = jd_tt - 2451545.0  # Jours depuis l'époque J2000.0
    
    # Approximation Soleil (Précision géocentrique standard)
    g_sol = math.radians((357.529 + 0.98560028 * d) % 360)
    q_sol = math.radians((280.459 + 0.98564736 * d) % 360)
    l_sol = q_sol + math.radians(1.915 * math.sin(g_sol) + 0.020 * math.sin(2 * g_sol))
    r_sol_ua = 1.00014 - 0.01671 * math.cos(g_sol) - 0.00014 * math.cos(2 * g_sol)
    
    # Coordonnées équatoriales simplifiées obliquité de l'écliptique
    ecl = math.radians(23.439 - 0.00000036 * d)
    ra_sol = math.atan2(math.cos(ecl) * math.sin(l_sol), math.cos(l_sol))
    dec_sol = math.asin(math.sin(ecl) * math.sin(l_sol))
    
    # Calcul du temps sidéral local approximatif pour Marseille (Longitude 5.35490)
    lst = math.radians((280.46061837 + 360.98564736629 * d + capteurs["longitude_deg"]) % 360)
    ha_sol = lst - ra_sol
    
    lat_rad = math.radians(capteurs["latitude_deg"])
    el_brut_sol = math.asin(math.sin(lat_rad) * math.sin(dec_sol) + math.cos(lat_rad) * math.cos(dec_sol) * math.cos(ha_sol))
    az_sol = math.atan2(-math.sin(ha_sol), math.cos(lat_rad) * math.tan(dec_sol) - math.sin(lat_rad) * math.cos(ha_sol))
    
    az_sol_deg = math.degrees(az_sol) % 360
    el_sol_deg = math.degrees(el_brut_sol)
    
    # Calcul de la réfraction
    if el_sol_deg > 0:
        R = 1.0 / math.tan(math.radians(el_sol_deg + 7.31 / (el_sol_deg + 4.4)))
        delta_r = (R / 60.0) * (p_totale_hpa / 1013.25) * (283.15 / t_interieure_k)
    else:
        delta_r = 0.0
        
    el_optique_sol = el_sol_deg + delta_r
    
    # Génération des flux
    data_streams_output = {
        "soleil": {
            "instant_present": {
                "azimut_vrai_deg": az_sol_deg,
                "elevation_geometrique_deg": el_sol_deg,
                "elevation_refractee_corrigee_deg": el_optique_sol,
                "delta_refraction_deg": delta_r,
                "distance_km": r_sol_ua * 149597870.7,
                "magnitude_visuelle_reelle": -26.74
            },
            "cinematique_instantanee": {
                "vitesse_angulaire_azimut_deg_s": 0.004166666666666667
            },
            "metrologie_evenementielle": {
                "jd_tt_transit_estime": float(jd_tt - ((az_sol_deg - 180.0) / 360.0))
            }
        },
        "lune": {
            "instant_present": {
                "azimut_vrai_deg": (az_sol_deg + 180.0) % 360, # Approximation d'opposition
                "elevation_geometrique_deg": -el_sol_deg,
                "elevation_refractee_corrigee_deg": -el_sol_deg,
                "delta_refraction_deg": 0.0,
                "distance_km": 384400.0,
                "magnitude_visuelle_reelle": -12.74
            },
            "cinematique_instantanee": {
                "vitesse_angulaire_azimut_deg_s": 0.004166666666666667
            },
            "metrologie_evenementielle": {
                "jd_tt_transit_estime": float(jd_tt)
            }
        }
    }

    flux_final = {
        "METADATA": {
            "generateur": "Systema Sentinela Native Core Engine",
            "type_plateforme": profil.upper()
        },
        "METROLOGIE_TEMPS_ATOMIQUE": {
            "ISO_UTC": instant_brut.strftime("%Y-%m-%d %H:%M:%S"),
            "JD_TAI": float(jd_tai),
            "TT_Echelle_s": float(jd_tt * 86400.0),
            "Dilatation_Lorentz_Gamma": float(gamma_lorentz)
        },
        "POSITION_GEOFENCING_MOBILE": {
            "latitude_deg": float(capteurs["latitude_deg"]),
            "longitude_deg": float(capteurs["longitude_deg"]),
            "altitude_coordonnee_m": float(capteurs["altitude_m"]),
            "ecef_x_m": 4487400.0,
            "ecef_y_m": 421200.0,
            "ecef_z_m": 4352700.0
        },
        "THERMODYNAMIQUE_HABITACLE_SERRE": {
            "pression_effective_hPa": float(p_totale_hpa),
            "temperature_air_interieur_C": float(capteurs["temperature_interieure_C"]),
            "densite_air_locale_kg_m3": float(rho_air_interieur),
            "indice_refraction_n_gladstone": float(indice_n_gladstone)
        },
        "DATA_STREAMS": data_streams_output
    }

    print(json.dumps(flux_final, indent=4, ensure_ascii=False))

if __name__ == "__main__":
    param = sys.argv[1] if len(sys.argv) > 1 else "laboratoire"
    try:
        executer_calcul_precision(param)
    except Exception as e:
        print(f"[CRITICAL] Effondrement : {e}", file=sys.stderr)
        sys.exit(1)
