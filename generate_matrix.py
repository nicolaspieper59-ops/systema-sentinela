#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Calculateur d'Éphémérides Topocentriques Haute Précision - Standard UAI 2000/2006
Calcul des coordonnées horizontales locales (Az, El) incluant la réfraction de Bennett.
"""

import json
import os
from datetime import datetime, timezone, timedelta
import numpy as np
from astropy.time import Time
from astropy.coordinates import EarthLocation, AltAz, get_body
import astropy.units as u

def calculer_magnitude_planetaire(astre, r_helio, delta_geo, angle_phase_deg):
    """Calcule la magnitude visuelle apparente réelle selon les modèles de l'UAI."""
    i = angle_phase_deg / 100.0
    if astre == "soleil":
        return -26.74
    elif astre == "lune":
        # Formule de phase de la Lune (Allen's Astrophysical Quantities)
        return float(-12.74 + 2.24 * np.abs(i) + 0.003 * (i**4))
    
    # Modèles d'opposition et de phase de Müller / Mallama
    if astre == "mercure":
        mag = -0.42 + 3.80 * i - 2.73 * (i**2) + 2.00 * (i**3)
    elif astre == "venus":
        mag = -4.40 + 0.09 * i + 2.39 * (i**2) - 0.65 * (i**3)
    elif astre == "mars":
        mag = -1.52 + 1.60 * i
    elif astre == "jupiter":
        mag = -9.40 + 0.50 * i
    elif astre == "saturne":
        mag = -8.88 + 4.40 * i  # Contribution moyenne des anneaux exclue pour stabilité
    else:
        mag = 0.0
        
    return float(mag + 5 * np.log10(r_helio * delta_geo))

def generer_donnees_astronomiques():
    maintenant_utc = datetime.now(timezone.utc)
    base_midi_utc = datetime(maintenant_utc.year, maintenant_utc.month, maintenant_utc.day, tzinfo=timezone.utc)
    
    # Vecteur temps discret (1440 minutes de la journée UTC)
    vecteur_minutes = np.arange(1440)
    series_temporelles = [base_midi_utc + timedelta(minutes=int(m)) for m in vecteur_minutes]
    t_vector = Time(series_temporelles)
    
    # Temps instantané station
    t_instant = Time(maintenant_utc)
    jd_val = t_instant.jd
    lst_obj = t_instant.sidereal_time('mean', longitude=5.35490 * u.deg)
    
    h_lst, m_lst, s_lst = int(lst_obj.value), int((lst_obj.value * 60) % 60), int((lst_obj.value * 3600) % 60)
    lst_str = f"{h_lst:02d}:{m_lst:02d}:{s_lst:02d}"

    # Coordonnées géodésiques de la station (Marseille Longchamp)
    lat, lon, alt = 43.29070, 5.35490, 55.0
    station = EarthLocation(lat=lat*u.deg, lon=lon*u.deg, height=alt*u.m)
    ecef_xyz = station.geocentric

    # Profil atmosphérique local standard pour la réfraction
    pression = 1014.2 * u.hPa
    temperature = 22.40 * u.deg_C
    R_air = 287.058
    rho_air = (pression.value * 100) / (R_air * (temperature.value + 273.15))

    cadre_topocentrique = AltAz(location=station, obstime=t_vector, pressure=pression, temperature=temperature, obswl=0.55*u.micron)
    cadre_sans_refraction = AltAz(location=station, obstime=t_vector)

    # Récupération de la position de référence du Soleil pour le calcul vectoriel des phases planétaires
    soleil_geo = get_body("sun", t_vector, location=station)
    xyz_soleil = soleil_geo.cartesian.xyz.to(u.au).value

    catalogue_corps = ["soleil", "lune", "mercure", "venus", "mars", "jupiter", "saturne"]
    ephemerides_output = {}

    for corps in catalogue_corps:
        corps_coords = get_body(corps, t_vector, location=station)
        
        proj_horiz = corps_coords.transform_to(cadre_topocentrique)
        proj_brute = corps_coords.transform_to(cadre_sans_refraction)
        
        az_arr = proj_horiz.az.deg
        el_ref_arr = proj_horiz.alt.deg
        el_brut_arr = proj_brute.alt.deg
        delta_r_arr = np.maximum(0.0, el_ref_arr - el_brut_arr)
        
        dist_km_arr = proj_horiz.distance.km
        dist_ua_arr = proj_horiz.distance.au
        ra_hms = corps_coords.ra.hms
        dec_deg = corps_coords.dec.deg

        # Résolution de la géométrie tridimensionnelle de l'astre (Phase et distance héliocentrique)
        xyz_corps = corps_coords.cartesian.xyz.to(u.au).value
        vec_corps_soleil = xyz_soleil - xyz_corps
        r_helio_arr = np.linalg.norm(vec_corps_soleil, axis=0)
        
        dot_product = (-xyz_corps[0]*vec_corps_soleil[0] - xyz_corps[1]*vec_corps_soleil[1] - xyz_corps[2]*vec_corps_soleil[2])
        cos_phase = np.clip(dot_product / (dist_ua_arr * r_helio_arr), -1.0, 1.0)
        angle_phase_arr = np.degrees(np.arccos(cos_phase))

        # Algorithme de détection de croisement d'horizon (Heures de Lever/Coucher vraies)
        lever_str, coucher_str, transit_str = "--:--:--", "--:--:--", "--:--:--"
        idx_transit = np.argmax(el_brut_arr)
        transit_str = (base_midi_utc + timedelta(minutes=int(idx_transit))).strftime("%H:%M:%S")
        
        for m in range(1439):
            if el_brut_arr[m] < 0 and el_brut_arr[m+1] >= 0:
                lever_str = (base_midi_utc + timedelta(minutes=m)).strftime("%H:%M:%S")
            elif el_brut_arr[m] >= 0 and el_brut_arr[m+1] < 0:
                coucher_str = (base_midi_utc + timedelta(minutes=m)).strftime("%H:%M:%S")

        # Génération de la série chronologique par minute
        liste_chronologique = []
        for m in range(1440):
            mag_calc = calculer_magnitude_planetaire(corps, r_helio_arr[m], dist_ua_arr[m], angle_phase_arr[m])
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
            
        ephemerides_output[corps] = liste_chronologique

    # Construction du schéma d'échange JSON normalisé
    flux_structure = {
        "METADATA": {
            "generateur": "Astropy Core Vector Engine",
            "generation_utc": maintenant_utc.strftime("%Y-%m-%d %H:%M:%S")
        },
        "HORLOGE": {
            "utc": maintenant_utc.strftime("%H:%M:%S"),
            "jd": float(jd_val),
            "lst": lst_str
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
            "pression_hpa": float(pression.value),
            "temperature_c": float(temperature.value),
            "densite_air_kgm3": float(rho_air)
        },
        "SERIES_CHRONOLOGIQUES_1440": ephemerides_output
    }

    chemin = './flux_live.json'
    with open(chemin + '.tmp', 'w') as f:
        json.dump(flux_structure, f, indent=4)
    os.replace(chemin + '.tmp', chemin)

if __name__ == "__main__":
    generer_donnees_astronomiques()
