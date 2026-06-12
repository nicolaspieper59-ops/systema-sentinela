#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import json
import sys
import math
import time
from skyfield.api import Topos, load

class RecepteurGeodesiqueGNSS:
    def __init__(self, profil="avion"):
        self.profil = profil.lower()
        
    def capturer_vecteur_brut(self):
        a = 6378137.0
        f = 1.0 / 298.257223563
        e2 = 2 * f - f**2
        
        lat = 43.29070
        lon = 5.35490
        
        if self.profil == "avion":
            altitude_ellipsoidale = 11500.0
            vitesse = 245.5
            separation_geoide_m = 48.24 
            altitude_orthometrique_vray = altitude_ellipsoidale - separation_geoide_m
            pression_ext = 1013.25 * (1 - 0.0065 * altitude_ellipsoidale / 288.15)**5.25588
            temp_ext = 15.0 - (0.0065 * altitude_ellipsoidale)
            temp_interieure_c = 21.0
            pression_interieure_hpa = pression_ext + 200.0
        else:
            altitude_ellipsoidale = 48.0
            vitesse = 0.0
            separation_geoide_m = 48.24
            altitude_orthometrique_vray = altitude_ellipsoidale - separation_geoide_m
            pression_ext = 1012.4
            temp_ext = 20.8
            temp_interieure_c = 20.8
            pression_interieure_hpa = 1012.4

        lat_rad = math.radians(lat)
        lon_rad = math.radians(lon)
        N = a / math.sqrt(1.0 - e2 * math.sin(lat_rad)**2)
        
        X = (N + altitude_ellipsoidale) * math.cos(lat_rad) * math.cos(lon_rad)
        Y = (N + altitude_ellipsoidale) * math.cos(lat_rad) * math.sin(lon_rad)
        Z = (N * (1.0 - e2) + altitude_ellipsoidale) * math.sin(lat_rad)

        timestamp_atomique = time.time() + 37.0 

        return {
            "timestamp_coaxial_tai": timestamp_atomique, 
            "lat_deg": lat,
            "lon_deg": lon,
            "alt_wgs84_m": altitude_ellipsoidale,
            "alt_physique_mer_m": altitude_orthometrique_vray,
            "ecef_x": X,
            "ecef_y": Y,
            "ecef_z": Z,
            "vitesse_m_s": vitesse,
            "pression_exterieure_hPa": pression_ext,
            "temperature_exterieure_C": temp_ext,
            "pression_interieure_hPa": pression_interieure_hpa,
            "temperature_interieure_C": temp_interieure_c
        }

def executer_calcul_absolu(profil="laboratoire"):
    materiel = RecepteurGeodesiqueGNSS(profil)
    sat = materiel.capturer_vecteur_brut()
    
    eph = load('de440.bsp')
    ts = load.timescale()
    
    t = ts.tai_bn(jd=2440587.5 + (sat["timestamp_coaxial_tai"] / 86400.0))
    t_plus_1s = ts.tai_bn(jd=2440587.5 + ((sat["timestamp_coaxial_tai"] + 1.0) / 86400.0))
    
    c = 299792458.0
    beta = sat["vitesse_m_s"] / c
    gamma_lorentz = 1.0 / math.sqrt(1.0 - beta**2) if beta < 1 else 1.0
    rg_shift = (9.81 * sat["alt_wgs84_m"] / c**2) - (beta**2 / 2.0)

    observer = eph['earth'] + Topos(latitude_degrees=sat["lat_deg"],
                                    longitude_degrees=sat["lon_deg"],
                                    elevation_m=sat["alt_wgs84_m"])
    
    r_specifique_air = 287.058
    temp_k = sat["temperature_interieure_C"] + 273.15
    rho_air = (sat["pression_interieure_hPa"] * 100.0) / (r_specifique_air * temp_k)
    n_gladstone = 1.0 + (0.226e-3 * rho_air)

    corps_celestes = {
        "soleil": eph['sun'],
        "lune": eph['moon']
    }
    
    streams_output = {}
    
    for nom, corps in corps_celestes.items():
        position_astrométrique = observer.at(t).observe(corps).apparent()
        alt_geo, az_geo, dist = position_astrométrique.altaz()
        
        pos_plus_1s = observer.at(t_plus_1s).observe(corps).apparent()
        _, az_geo_1s, _ = pos_plus_1s.altaz()
        
        vitesse_angulaire = (az_geo_1s.degrees - az_geo.degrees + 180) % 360 - 180
        
        alt_ref, _, _ = position_astrométrique.altaz(temperature_C=sat["temperature_exterieure_C"], pressure_mbar=sat["pression_exterieure_hPa"])
        delta_refraction = max(0.0, alt_ref.degrees - alt_geo.degrees)
        
        magnitude = -26.74 if nom == "soleil" else -12.74

        streams_output[nom] = {
            "instant_present": {
                "azimut_vrai_deg": float(az_geo.degrees),
                "elevation_geometrique_deg": float(alt_geo.degrees),
                "elevation_refractee_corrigee_deg": float(alt_ref.degrees),
                "delta_refraction_deg": float(delta_refraction),
                "distance_km": float(dist.km),
                "magnitude_visuelle_reelle": magnitude
            },
            "cinematique_instantanee": {
                "vitesse_angulaire_azimut_deg_s": float(vitesse_angulaire)
            },
            "metrologie_evenementielle": {
                "jd_tt_transit_estime": float(t.tt - ((az_geo.degrees - 180.0) / 360.0))
            }
        }

    flux_final = {
        "METADATA": {
            "generateur": "Systema Sentinela Geodetic Core v2",
            "type_plateforme": profil.upper()
        },
        "METROLOGIE_TEMPS_ATOMIQUE": {
            "ISO_UTC": t.utc_strftime('%Y-%m-%d %H:%M:%S'),
            "JD_TAI": float(t.tai),
            "TT_Echelle_s": float(t.tt * 86400.0),
            "Dilatation_Lorentz_Gamma": float(gamma_lorentz),
            "Derive_Relativiste_Generale_s_s": float(rg_shift)
        },
        "POSITION_GEOFENCING_MOBILE": {
            "latitude_deg": float(sat["lat_deg"]),
            "longitude_deg": float(sat["lon_deg"]),
            "altitude_coordonnee_m": float(sat["alt_wgs84_m"]),
            "altitude_mer_geoide_m": float(sat["alt_physique_mer_m"]),
            "ecef_x_m": float(sat["ecef_x"]),
            "ecef_y_m": float(sat["ecef_y"]),
            "ecef_z_m": float(sat["ecef_z"])
        },
        "THERMODYNAMIQUE_HABITACLE_SERRE": {
            "pression_effective_hPa": float(sat["pression_interieure_hPa"]),
            "temperature_air_interieur_C": float(sat["temperature_interieure_C"]),
            "densite_air_locale_kg_m3": float(rho_air),
            "indice_refraction_n_gladstone": float(n_gladstone),
            "pression_stratosphere_exterieure_hPa": float(sat["pression_exterieure_hPa"])
        },
        "DATA_STREAMS": streams_output
    }

    print(json.dumps(flux_final, indent=4, ensure_ascii=False))

if __name__ == "__main__":
    param = sys.argv[1] if len(sys.argv) > 1 else "laboratoire"
    executer_calcul_absolu(param)
