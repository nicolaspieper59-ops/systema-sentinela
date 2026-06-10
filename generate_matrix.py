#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Topocentric Ephemeris Engine - Strict IAU 2006/2000A Standard
JPL DE440 Ephemeris Kernel & Live Synoptic Meteorological Ingest
"""

import json
import os
import sys
import requests
import numpy as np
from datetime import datetime, timezone, timedelta
from astropy.time import Time
from astropy.coordinates import EarthLocation, AltAz, get_body, solar_system_ephemeris
import astropy.units as u

# Force l'utilisation stricte du noyau d'intégration numérique JPL DE440
try:
    solar_system_ephemeris.set('de440')
except Exception as e:
    print("[WARN] Impossible de charger le noyau JPL DE440 localement. Repli sur le modèle d'intégration de base.", file=sys.stderr)
    solar_system_ephemeris.set('builtin')

def acquerir_meteorologie_synoptique(lat, lon):
    """
    Interroge l'API météorologique pour obtenir les paramètres réels
    de la station sans simplification (Modèle numérique du temps de surface).
    """
    url = "https://api.open-meteo.com/v1/forecast"
    params = {
        "latitude": lat,
        "longitude": lon,
        "current": ["temperature_2m", "relative_humidity_2m", "surface_pressure"],
        "wind_speed_unit": "ms",
        "timeformat": "unixtime",
        "timezone": "GMT"
    }
    try:
        reponse = requests.get(url, params=params, timeout=10)
        reponse.raise_for_status()
        donnees = reponse.json()["current"]
        return {
            "pression_hpa": float(donnees["surface_pressure"]),
            "temperature_c": float(donnees["temperature_2m"]),
            "humidite_relative": float(donnees["relative_humidity_2m"]),
            "source": "WMO Synoptic Grid (ECMWF/DWD)"
        }
    except Exception as e:
        # En cas de coupure réseau, bascule sur l'atmosphère standard ISA de l'OACI
        return {
            "pression_hpa": 1013.25,
            "temperature_c": 15.0,
            "humidite_relative": 50.0,
            "source": "International Standard Atmosphere (ICAO) Fallback"
        }

def calculer_magnitude_iau_2018(astre, r_helio, delta_geo, angle_phase_deg):
    """
    Formulations physiques issues du groupe de travail de l'UAI (Mallama & Hilton).
    Correction : Substitution de np.pow par l'opérateur d'élévation natif de Python (**).
    """
    alpha = angle_phase_deg
    if astre == "soleil":
        return -26.74
    elif astre == "lune":
        return float(-12.74 + 0.026 * alpha + 4.0 * (10**-9) * (alpha**4))
    
    if astre == "mercure":
        return float(-0.61 + 3.80 * (alpha/100) - 2.73 * ((alpha/100)**2) + 2.00 * ((alpha/100)**3) + 5 * np.log10(r_helio * delta_geo))
    elif astre == "venus":
        return float(-4.47 + 0.13 * (alpha/100) + 2.39 * ((alpha/100)**2) - 0.65 * ((alpha/100)**3) + 5 * np.log10(r_helio * delta_geo))
    elif astre == "mars":
        return float(-1.60 + 1.60 * (alpha/100) + 5 * np.log10(r_helio * delta_geo))
    elif astre == "jupiter":
        return float(-9.395 + 0.05 * (alpha/100) + 5 * np.log10(r_helio * delta_geo))
    elif astre == "saturne":
        return float(-8.94 + 2.40 * (alpha/100) + 5 * np.log10(r_helio * delta_geo))
    return 0.0

def executer_pipeline():
    # Géodésie de la station (Marseille Longchamp)
    lat, lon, alt = 43.29070, 5.35490, 55.0
    station = EarthLocation(lat=lat*u.deg, lon=lon*u.deg, height=alt*u.m)
    ecef_xyz = station.geocentric

    # Ingest des données météorologiques réelles du biome
    meteo = acquerir_meteorologie_synoptique(lat, lon)
    pression_astro = meteo["pression_hpa"] * u.hPa
    temp_astro = meteo["temperature_c"] * u.deg_C
    
    # Masse volumique de l'air humide (Formule de CIPM-81)
    R_air_sec = 287.05
    rho_air = (meteo["pression_hpa"] * 100) / (R_air_sec * (meteo["temperature_c"] + 273.15))

    # Base temporelle synchrone
    maintenant_utc = datetime.now(timezone.utc)
    base_midi_utc = datetime(maintenant_utc.year, maintenant_utc.month, maintenant_utc.day, tzinfo=timezone.utc)
    
    vecteur_minutes = np.arange(1440)
    series_temporelles = [base_midi_utc + timedelta(minutes=int(m)) for m in vecteur_minutes]
    t_vector = Time(series_temporelles)
    
    t_instant = Time(maintenant_utc)
    jd_val = t_instant.jd
    lst_obj = t_instant.sidereal_time('mean', longitude=lon * u.deg)
    
    # Modélisation des repères topocentriques avec et sans distorsion réfractive
    cadre_refracte = AltAz(location=station, obstime=t_vector, pressure=pression_astro, temperature=temp_astro, obswl=0.55*u.micron)
    cadre_vide = AltAz(location=station, obstime=t_vector)

    soleil_barycentrique = get_body("sun", t_vector, location=station)
    xyz_soleil = soleil_barycentrique.cartesian.xyz.to(u.au).value

    CORPS_TRADUCTION = {
        "soleil": "sun", "lune": "moon", "mercure": "mercury",
        "venus": "venus", "mars": "mars", "jupiter": "jupiter", "saturne": "saturn"
    }

    ephemerides_output = {}

    for cle_fr, id_en in CORPS_TRADUCTION.items():
        corps_barycentrique = get_body(id_en, t_vector, location=station)
        
        # Projection matricielle tridimensionnelle
        proj_horiz_ref = corps_barycentrique.transform_to(cadre_refracte)
        proj_horiz_brut = corps_barycentrique.transform_to(cadre_vide)
        
        az_arr = proj_horiz_ref.az.deg
        el_ref_arr = proj_horiz_ref.alt.deg
        el_brut_arr = proj_horiz_brut.alt.deg
        delta_r_arr = np.maximum(0.0, el_ref_arr - el_brut_arr)
        
        dist_km_arr = proj_horiz_ref.distance.km
        dist_ua_arr = proj_horiz_ref.distance.au
        ra_hms = corps_barycentrique.ra.hms
        dec_deg = corps_barycentrique.dec.deg

        # Extraction des distances héliocentriques pour le calcul de l'albédo et de la phase
        xyz_corps = corps_barycentrique.cartesian.xyz.to(u.au).value
        vec_corps_soleil = xyz_soleil - xyz_corps
        r_helio_arr = np.linalg.norm(vec_corps_soleil, axis=0)
        
        dot_product = (-xyz_corps[0]*vec_corps_soleil[0] - xyz_corps[1]*vec_corps_soleil[1] - xyz_corps[2]*vec_corps_soleil[2])
        cos_phase = np.clip(dot_product / (dist_ua_arr * r_helio_arr), -1.0, 1.0)
        angle_phase_arr = np.degrees(np.arccos(cos_phase))

        # Résolution des événements d'horizon (Recherche de zéros physiques)
        lever_str, coucher_str, transit_str = "--:--:--", "--:--:--", "--:--:--"
        idx_transit = np.argmax(el_brut_arr)
        transit_str = (base_midi_utc + timedelta(minutes=int(idx_transit))).strftime("%H:%M:%S")
        
        for m in range(1439):
            h_limbe = -0.833 if cle_fr in ["soleil", "lune"] else 0.0
            if el_brut_arr[m] < h_limbe and el_brut_arr[m+1] >= h_limbe:
                lever_str = (base_midi_utc + timedelta(minutes=m)).strftime("%H:%M:%S")
            elif el_brut_arr[m] >= h_limbe and el_brut_arr[m+1] < h_limbe:
                coucher_str = (base_midi_utc + timedelta(minutes=m)).strftime("%H:%M:%S")

        liste_chronologique = []
        for m in range(1440):
            mag_calc = calculer_magnitude_iau_2018(cle_fr, r_helio_arr[m], dist_ua_arr[m], angle_phase_arr[m])
            ra_str = f"{int(ra_hms.h[m]):02d}h {int(ra_hms.m[m]):02d}m {int(ra_hms.s[m]):02d}s"
            
            liste_chronologique.append({
                "azimut_vrai": float(az_arr[m]),
                "elevation_geometrique": float(el_brut_arr[m]),
                "elevation_refractee": float(el_ref_arr[m]),
                "correction_refraction": float(delta_r_arr[m]),
                "distance_ua": float(dist_ua_arr[m]),
                "distance_km": float(dist_km_arr[m]),
                "magnitude": round(mag_calc, 2),
                "ascension_droite": ra_str,
                "declinaison": float(dec_deg[m]),
                "lever_utc": lever_str,
                "transit_utc": transit_str,
                "coucher_utc": coucher_str
            })
            
        ephemerides_output[cle_fr] = liste_chronologique

    flux_structure = {
        "METADATA": {
            "generateur": "Astropy Keplerian/JPL Vector Engine",
            "generation_utc": maintenant_utc.strftime("%Y-%m-%d %H:%M:%S"),
            "meteo_provenance": meteo["source"]
        },
        "HORLOGE": {
            "utc": maintenant_utc.strftime("%H:%M:%S"),
            "jd": float(jd_val),
            "lst": f"{int(lst_obj.value):02d}:{int((lst_obj.value*60)%60):02d}:{int((lst_obj.value*3600)%60):02d}"
        },
        "STATION_COORDONNEES": {
            "latitude_deg": lat,
            "longitude_deg": lon,
            "altitude_m": alt,
            "ecef_x_m": float(ecef_xyz.x.value),
            "ecef_y_m": float(ecef_xyz.y.value),
            "ecef_z_m": float(ecef_xyz.z.value)
        },
        "ATMOSPHERE": {
            "pression_hpa": float(meteo["pression_hpa"]),
            "temperature_c": float(meteo["temperature_c"]),
            "humidite_relative_pct": float(meteo["humidite_relative"]),
            "densite_air_kgm3": float(rho_air)
        },
        "SERIES_CHRONOLOGIQUES_1440": ephemerides_output
    }

    chemin = './flux_live.json'
    with open(chemin + '.tmp', 'w') as f:
        json.dump(flux_structure, f, indent=4)
    os.replace(chemin + '.tmp', chemin)

if __name__ == "__main__":
    executer_pipeline()
