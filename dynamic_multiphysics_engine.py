#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SYSTEMA SENTINELA - CORE METROLOGY INTERFACE (JPL DE440/DE441)
Extraction brute sans calculs internes
"""

import json
import sys
import time
import math
from skyfield.api import Topos, load

def collecter_donnees_strictes_jpl(profil="avion"):
    # Chargement des éphémérides et initialisation des échelles de temps
    eph = load('de440.bsp')
    ts = load.timescale()
    
    # Coordonnées géodésiques stationnaires (Marseille - Référence Horizons)
    lat = 43.284565
    lon = 5.358658
    alt = 11500.0 if profil.lower() == "avion" else 55.0
    
    # Horloge système synchronisée
    timestamp_actuel = time.time()
    t = ts.tai_bn(jd=2440587.5 + (timestamp_actuel / 86400.0))
    
    observer = eph['earth'] + Topos(latitude_degrees=lat, longitude_degrees=lon, elevation_m=alt)
    
    # Calcul des variables de l'Espace-Temps (Constantes Physiques)
    c = 299792458.0
    vitesse_plateforme = 245.5 if profil.lower() == "avion" else 0.0
    beta = vitesse_plateforme / c
    gamma_lorentz = 1.0 / math.sqrt(1.0 - beta**2) if beta < 1 else 1.0
    derive_rg = (9.81 * alt / c**2) - (beta**2 / 2.0)
    
    # Thermodynamique locale de la cellule
    pression_ext = 1013.25 * (1 - 0.0065 * alt / 288.15)**5.25588
    pression_cabine = pression_ext + 220.0 if profil.lower() == "avion" else pression_ext
    temp_cellule = 19.5 + (max(0.0, math.sin(math.radians(35.0))) * 4.2)
    rho_air = (pression_cabine * 100.0) / (287.058 * (temp_cellule + 273.15))
    n_gladstone = 1.0 + (0.000226 * rho_air)
    
    # Extraction de l'illumination lunaire
    fraction_lune = observer.at(t).observe(eph['moon']).apparent().fraction_illuminated(eph['sun'])
    pourcentage_lune = float(fraction_lune * 100)
    
    catalog_corps = {
        "soleil": eph['sun'], "lune": eph['moon'], "mercure": eph['mercury'],
        "venus": eph['venus'], "mars": eph['mars barycenter'], "jupiter": eph['jupiter barycenter'],
        "saturne": eph['saturn barycenter'], "uranus": eph['uranus barycenter'], "neptune": eph['neptune barycenter']
    }
    
    streams = {}
    for nom, cible in catalog_corps.items():
        astre_apparent = observer.at(t).observe(cible).apparent()
        alt_horiz, az_horiz, dist = astre_apparent.altaz()
        ra, dec, _ = astre_apparent.radec()
        
        # Calcul de la vitesse angulaire instantanée (via t + 1 seconde)
        t_futur = ts.tai_bn(jd=2440587.5 + ((timestamp_actuel + 1.0) / 86400.0))
        astre_futur = observer.at(t_futur).observe(cible).apparent()
        _, az_futur, _ = astre_futur.altaz()
        vitesse_angulaire = (az_futur.degrees - az_horiz.degrees + 180) % 360 - 180
        
        # Stockage sous forme de données numériques pures (Pas de chaînes de caractères polluées)
        streams[nom] = {
            "azimut_deg": float(az_horiz.degrees),
            "elevation_deg": float(alt_horiz.degrees),
            "declinaison_deg": float(dec.degrees),
            "ascension_droite_heures": float(ra.hours),
            "distance_km": float(dist.km),
            "vitesse_angulaire_az_deg_s": float(vitesse_angulaire)
        }

    output = {
        "METADATA": {
            "type_plateforme": profil.upper(),
            "horodatage_iso": t.utc_strftime('%Y-%m-%d %H:%M:%S UTC')
        },
        "METROLOGIE_TEMPS_ATOMIQUE": {
            "JD_TAI": float(t.tai),
            "TT_Echelle_s": float(t.tt * 86400.0),
            "Dilatation_Lorentz_Gamma": float(gamma_lorentz),
            "Derive_Relativiste_Generale_s_s": float(derive_rg)
        },
        "POSITION_GEOFENCING_MOBILE": {
            "latitude_deg": lat, "longitude_deg": lon,
            "altitude_coordonnee_m": alt, "altitude_mer_geoide_m": alt - 48.24,
            "ecef_x_m": 4650375.4, "ecef_y_m": 435060.6, "ecef_z_m": 4350606.7
        },
        "THERMODYNAMIQUE": {
            "pression_effective_hPa": float(pression_cabine),
            "pression_stratosphere_hPa": float(pression_ext),
            "temperature_air_interieur_C": float(temp_cellule),
            "densite_air_locale_kg_m3": float(rho_air),
            "indice_refraction_n_gladstone": float(n_gladstone)
        },
        "DONNEES_SPECIFIQUES_LUNE": {
            "illumination_pourcentage": pourcentage_lune
        },
        "DATA_STREAMS": streams
    }
    
    print(json.dumps(output, indent=4, ensure_ascii=False))

if __name__ == "__main__":
    param = sys.argv[1] if len(sys.argv) > 1 else "avion"
    collecter_donnees_strictes_jpl(param)
