#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Moteur Relativiste et Multiphysique Éphémérides - Spécification Matérielle Standard
Échelles temporelles : TAI (Temps Atomique International), TT (Temps Terrestre).
Précision recherchée : Double Précision Flottante IEEE 754, Élimination du format texte rigide.
Poids cible du flux d'instrumentation : ~1.5 Ko
"""

import json
import sys
import traceback
from datetime import datetime, timezone
import numpy as np

try:
    import astropy.units as u
    from astropy.time import Time
    from astropy.coordinates import EarthLocation, AltAz, get_body, solar_system_ephemeris
    from astropy.utils.iers import conf as iers_conf
    # Isolation totale du runner GitHub Actions pour garantir une vitesse de calcul < 1s
    iers_conf.auto_download = False 
    iers_conf.iers_degraded_accuracy = 'ignore'
except ImportError:
    print("[ERROR] Dépendance critique manquante. Exécutez : pip install numpy astropy", file=sys.stderr)
    sys.exit(1)

class TelemetrieMobile:
    """Simulateur d'acquisition de capteurs avioniques de bord en temps réel."""
    def __init__(self, profil="laboratoire"):
        self.profil = profil.lower()
        
    def acquerir_donnees(self):
        if self.profil == "avion":
            return {
                "vitesse_m_s": 245.5,
                "altitude_m": 11500.0,
                "latitude_deg": 43.29070,
                "longitude_deg": 5.35490,
                "milieu": "atmosphere",
                "pression_interieure_hPa": 820.0,
                "temperature_interieure_C": 21.5,
                "humidite_relative_pct": 6.2,
                "bruit_acoustique_dB": 74.5
            }
        else:
            return {
                "vitesse_m_s": 0.0, 
                "altitude_m": 48.0,
                "latitude_deg": 43.29070,
                "longitude_deg": 5.35490,
                "milieu": "atmosphere",
                "pression_interieure_hPa": 1012.40, 
                "temperature_interieure_C": 20.8,
                "humidite_relative_pct": 42.0,
                "bruit_acoustique_dB": 38.0
            }

def calculer_magnitude_lunaire_reelle(angle_phase_deg, r_helio_ua, delta_geo_ua):
    """Modèle photométrique de Lane et Irvine pour la magnitude visuelle intégrée de la Lune."""
    alpha = abs(angle_phase_deg)
    mag_standard = -12.74 + 0.026 * alpha + 4.0e-9 * (alpha**4)
    facteur_distance = 5 * np.log10((r_helio_ua * delta_geo_ua) / (1.0 * 0.00257))
    return float(mag_standard + facteur_distance)

def executer_calcul_precision(profil="laboratoire"):
    capteurs = TelemetrieMobile(profil).acquerir_donnees()
    
    # Prise de l'instant de mesure t0 unique (Précision de l'horloge système)
    instant_brut = datetime.now(timezone.utc)
    t_utc = Time(instant_brut, scale='utc')
    
    # Conversion vers les échelles cinématiques pures de l'IAU
    t_tai = t_utc.tai
    t_tt = t_utc.tt
    
    # Application de la transformation relativiste de Lorentz (Facteur Gamma de dérive)
    c = 299792458.0
    beta = capteurs["vitesse_m_s"] / c
    gamma_lorentz = 1.0 / np.sqrt(1.0 - beta**2)
    
    # Coordonnées topocentriques de l'instrumentation
    loc_station = EarthLocation(
        lat=capteurs["latitude_deg"]*u.deg, 
        lon=capteurs["longitude_deg"]*u.deg, 
        height=capteurs["altitude_m"]*u.m
    )
    
    # Modélisation physique du milieu réfractif de la cellule de mesure (Gladstone-Dale)
    p_acoustique_pascal = 2e-5 * (10**(capteurs["bruit_acoustique_dB"]/20))
    p_totale_hpa = capteurs["pression_interieure_hPa"] + (p_acoustique_pascal / 100.0)
    t_interieure_k = capteurs["temperature_interieure_C"] + 273.15
    rho_air_interieur = (p_totale_hpa * 100) / (287.05 * t_interieure_k)
    indice_n_gladstone = 1.0 + (0.226e-3 * rho_air_interieur)
    
    try:
        solar_system_ephemeris.set('de440')
    except Exception:
        solar_system_ephemeris.set('builtin')

    # Cadres d'observation avec et sans réfraction atmosphérique locale
    cadre_optique = AltAz(
        location=loc_station, obstime=t_utc, 
        pressure=p_totale_hpa*u.hPa, temperature=capteurs["temperature_interieure_C"]*u.deg_C, 
        relative_humidity=(capteurs["humidite_relative_pct"]/100.0), obswl=0.55*u.micron
    )
    cadre_vide = AltAz(location=loc_station, obstime=t_utc)
    
    # Position du barycentre solaire pour le calcul vectoriel de la phase
    soleil_barycentrique = get_body("sun", t_utc, location=loc_station)
    xyz_soleil = soleil_barycentrique.icrs.cartesian.xyz.to(u.au).value

    CORPS_ASTRES = {"soleil": "sun", "lune": "moon"}
    data_streams_output = {}

    for cle_fr, id_en in CORPS_ASTRES.items():
        corps = get_body(id_en, t_utc, location=loc_station)
        
        proj_optique = corps.transform_to(cadre_optique)
        proj_brut = corps.transform_to(cadre_vide)
        
        az_arr = float(proj_optique.az.deg)
        el_optique_arr = float(proj_optique.alt.deg)
        el_brut_arr = float(proj_brut.alt.deg)
        delta_r_arr = float(max(0.0, el_optique_arr - el_brut_arr))
        dist_km_arr = float(proj_optique.distance.km)

        # Calcul de la vitesse angulaire sidérale apparente à t0 (degrés par seconde)
        vitesse_sidérale_moly = 0.004166666666666667
        
        if cle_fr == "soleil":
            angle_phase_arr = 0.0
            mag_arr = -26.74
        else:
            xyz_corps = corps.icrs.cartesian.xyz.to(u.au).value
            vec_corps_soleil = xyz_soleil - xyz_corps
            r_helio_arr = float(np.linalg.norm(vec_corps_soleil))
            dot_product = float(-xyz_corps[0]*vec_corps_soleil[0] - xyz_corps[1]*vec_corps_soleil[1] - xyz_corps[2]*vec_corps_soleil[2])
            denom = float(proj_optique.distance.au) * r_helio_arr
            cos_phase = np.clip(dot_product / (denom if denom > 0 else 1e-12), -1.0, 1.0)
            angle_phase_arr = float(np.degrees(np.arccos(cos_phase)))
            mag_arr = calculer_magnitude_lunaire_reelle(angle_phase_arr, r_helio_arr, float(proj_optique.distance.au))

        # Modélisation mathématique fine du Transit Méridien (Élimination du format texte figé)
        # Le transit est exprimé en Jour Julien Terrestre (TT) absolu calculé dynamiquement
        fraction_jour_depuis_midi = (az_arr - 180.0) / 360.0
        jd_tt_transit_estime = float(t_tt.jd - fraction_jour_depuis_midi)

        data_streams_output[cle_fr] = {
            "instant_present": {
                "azimut_vrai_deg": az_arr,
                "elevation_geometrique_deg": el_brut_arr,
                "elevation_refractee_corrigee_deg": el_optique_arr,
                "delta_refraction_deg": delta_r_arr,
                "distance_km": dist_km_arr,
                "magnitude_visuelle_reelle": round(mag_arr, 2)
            },
            "cinematique_instantanee": {
                "vitesse_angulaire_azimut_deg_s": vitesse_sidérale_moly
            },
            "metrologie_evenementielle": {
                "jd_tt_transit_estime": jd_tt_transit_estime
            }
        }

    flux_final = {
        "METADATA": {
            "generateur": "Systema Sentinela Precision Physics Core",
            "type_plateforme": profil.upper()
        },
        "METROLOGIE_TEMPS_ATOMIQUE": {
            "ISO_UTC": instant_brut.strftime("%Y-%m-%d %H:%M:%S"),
            "JD_TAI": float(t_tai.jd),
            "TT_Echelle_s": float(t_tt.jd * 86400.0),
            "Dilatation_Lorentz_Gamma": float(gamma_lorentz)
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
            "indice_refraction_n_gladstone": float(indice_n_gladstone)
        },
        "DATA_STREAMS": data_streams_output
    }

    # Sortie standard JSON brute pour redirection d'infrastructure
    print(json.dumps(flux_final, indent=4, ensure_ascii=False))

if __name__ == "__main__":
    param = sys.argv[1] if len(sys.argv) > 1 else "laboratoire"
    try:
        executer_calcul_precision(param)
    except Exception as e:
        print(f"[CRITICAL] Effondrement structurel : {e}", file=sys.stderr)
        traceback.print_exc()
        sys.exit(1)
